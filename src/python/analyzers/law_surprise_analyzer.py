import os
import sys
import json
import logging
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json
from google import genai
from google.genai import types
from pydantic import BaseModel
import concurrent.futures

from src.python.scrapers.utils import call_gemini_with_retry, initialize_gemini_client
from src.python.analyzers.member_analyzer import MemberAnalyzer

# Configuration Environment Variables
GEMINI_RETRY_INITIAL_DELAY = float(os.environ.get('GEMINI_RETRY_INITIAL_DELAY', 4.0))
CONCURRENT_ANALYSIS_WORKERS = int(os.environ.get('CONCURRENT_ANALYSIS_WORKERS', 5))
SURPRISE_THRESHOLD = int(os.environ.get('SURPRISE_THRESHOLD', 7))
MIN_SUBSTANTIATED_VOTE_COUNT = 5
MAX_LAW_CONTENT_CHARS = int(os.environ.get('MAX_LAW_CONTENT_CHARS', 45000))
MAX_MEMBER_CONTEXT_CHARS = int(os.environ.get('MAX_MEMBER_CONTEXT_CHARS', 90000))

logger = logging.getLogger("LawSurpriseAnalyzer")

# Define the expected structured output schema
class Hypothesis(BaseModel):
    title: str
    explanation: str
    memberEvidence: list[str]
    lawEvidence: list[str]

class ExplanationSchema(BaseModel):
    bottomLine: str
    hypotheses: list[Hypothesis]
    caution: str

class MemberExplanationSchema(BaseModel):
    memberSlug: str
    explanation: ExplanationSchema

class BatchExplanationSchema(BaseModel):
    explanations: list[MemberExplanationSchema]

# Axis mapping between Law Analysis and Member Analysis
AXIS_MAPPING = [
    {"law_key": "religiousSecular", "member_key": "religiousVsSecular", "label": "דתי מול חילוני"},
    {"law_key": "socialismCapitalism", "member_key": "socialismVsCapitalism", "label": "סוציאליזם מול קפיטליזם"},
    {"law_key": "doveHawk", "member_key": "dovishVsHawkish", "label": "יוני מול נצי"},
    {"law_key": "liberalDemocracyAuthoritarianism", "member_key": "liberalDemocracyVsAuthoritarianism", "label": "דמוקרטיה ליברלית מול סמכותנות"},
]

def build_instructions():
    return " ".join([
        "אתה פרשן פוליטי זהיר וחד, הכותב בעברית טבעית, ברורה ותמציתית.",
        "המטרה שלך היא להסביר הצבעות בעד שנראות מפתיעות ביחס לעמדות הליבה של מספר חברי כנסת.",
        "אתה תקבל את נוסח החוק ותקצירו פעם אחת, ולאחר מכן רשימה של חברי כנסת עם אוסף האמירות והפערים של כל אחד מהם.",
        "עבור כל חבר כנסת ברשימה, עליך להציע השערות סבירות שמיישבות את הפער בין עמדות החבר לבין ההצבעה בפועל.",
        "הישען רק על שני מקורות: אוסף האמירות של אותו חבר כנסת ונוסח/תקציר החוק. אל תשתמש בידע חיצוני.",
        "ההשערות יכולות לכלול: הבחנה בין עיקרון רחב לנוסח ספציפי, פרגמטיות, פשרה נקודתית, דגש סקטוריאלי, היבט מנהלי, או מסגור אסטרטגי.",
        "לכל חבר כנסת, פלט את המבנה הבא (שמור על השדה memberSlug כפי שסופק):",
        "- bottomLine: פסקה קצרה המסבירה בקול ישר מה הפתרון הסביר ביותר לפער.",
        "- hypotheses: 2 עד 4 השערות קצרות המשלבות ראיות מדברי החבר ומתוך החוק.",
        "- caution: משפט קצר המבהיר שמדובר בפרשנות מושכלת.",
        "החזר JSON תקף המכיל רשימה של הסברים לכל החברים לפי הסכמה."
    ])

class LawSurpriseAnalyzer:
    def __init__(self, conn, model_name="gemini-2.5-flash"):
        self.conn = conn
        self.client, self.model_name = initialize_gemini_client(
            default_model="gemini-2.5-flash", override_model=model_name
        )
        self.member_analyzer = MemberAnalyzer(conn)

    def analyze_missing_explanations(self, dry_run=False):
        logger.info("--- Analyzing Surprising Votes with AI ---")
        
        with self.conn.cursor() as cur:
            # Find all members with >= MIN_SUBSTANTIATED_VOTE_COUNT analyzed laws voted on
            cur.execute("""
                SELECT vr.member_slug
                FROM vote_record vr
                JOIN vote_event ve ON vr.vote_id = ve.vote_id
                JOIN law l ON ve.bill_id = l.bill_id
                WHERE l.analysis_summary IS NOT NULL
                GROUP BY vr.member_slug
                HAVING COUNT(DISTINCT l.bill_id) >= %s
            """, (MIN_SUBSTANTIATED_VOTE_COUNT,))
            substantiated_members = {row[0] for row in cur.fetchall()}

            # Find all laws that haven't been checked for surprises yet
            cur.execute("""
                SELECT bill_id FROM law 
                WHERE analysis_summary IS NOT NULL 
                  AND (surprises_analyzed IS NULL OR surprises_analyzed = FALSE)
            """)
            laws_to_check = [row[0] for row in cur.fetchall()]

            if not laws_to_check:
                logger.info("No unanalyzed laws found for surprises.")
                return

            logger.info(f"Found {len(laws_to_check)} laws to analyze for surprising votes.")

            # Get candidates
            cur.execute("""
                SELECT
                    l.bill_id, l.title, l.summary_law, l.analysis_summary, l.parsed_text,
                    m.slug, m.name, p.name, ma.analysis_summary
                FROM law l
                JOIN vote_event ve ON l.bill_id = ve.bill_id
                JOIN vote_record vr ON ve.vote_id = vr.vote_id
                JOIN member m ON vr.member_slug = m.slug
                LEFT JOIN party p ON m.party_id = p.id
                JOIN member_analysis ma ON ma.member_slug = m.slug
                WHERE l.analysis_summary IS NOT NULL
                  AND (l.surprises_analyzed IS NULL OR l.surprises_analyzed = FALSE)
                  AND ma.analysis_summary IS NOT NULL
                  AND vr.vote_type = 'for'
                  AND NOT EXISTS (
                      SELECT 1 FROM law_surprise_explanation lse
                      WHERE lse.bill_id = l.bill_id AND lse.member_slug = m.slug
                  )
            """)
            candidates_raw = cur.fetchall()

        candidates = []
        for row in candidates_raw:
            (bill_id, title, summary_law, law_analysis, law_content,
             member_slug, member_name, party_name, member_analysis) = row
            
            if member_slug not in substantiated_members:
                continue

            # Check if there is a 7+ point difference
            surprise_axes = []
            all_axis_diffs = []
            try:
                member_scores = member_analysis.get('quantitativeAnalysis', {}).get('textBased', {})
                for mapping in AXIS_MAPPING:
                    law_score_obj = law_analysis.get(mapping["law_key"])
                    mem_score_obj = member_scores.get(mapping["member_key"])
                    
                    if not law_score_obj or not mem_score_obj:
                        continue
                        
                    l_score = law_score_obj.get("score")
                    m_score = mem_score_obj.get("score")
                    
                    if l_score is None or m_score is None:
                        continue
                        
                    diff = abs(int(l_score) - int(m_score))
                    axis_info = f"{mapping['label']}: חוק {l_score}/10, חבר הכנסת {m_score}/10, פער {diff}/10"
                    all_axis_diffs.append(axis_info)
                    
                    if diff >= SURPRISE_THRESHOLD:
                        surprise_axes.append(axis_info)
                        
                if surprise_axes:
                    candidates.append({
                        "bill_id": bill_id,
                        "title": title,
                        "summary_law": summary_law,
                        "law_content": law_content,
                        "law_overall_summary": law_analysis.get('overallSummary', ''),
                        "member_slug": member_slug,
                        "member_name": member_name,
                        "party_name": party_name,
                        "surprise_axes": surprise_axes,
                        "all_axis_diffs": all_axis_diffs
                    })
            except Exception as e:
                logger.warning(f"Error parsing analysis for bill {bill_id}, member {member_slug}: {e}")

        logger.info(f"Found {len(candidates)} surprising votes requiring explanation.")

        if dry_run:
            for c in candidates:
                logger.info(f"[DRY RUN] Would explain surprising vote: {c['member_name']} on bill {c['bill_id']}")
            return

        from collections import defaultdict
        law_batches = defaultdict(list)
        for c in candidates:
            law_batches[c['bill_id']].append(c)

        def process_law_batch(bill_id, law_candidates):
            logger.info(f"Extracting context and analyzing surprising votes for bill {bill_id} ({len(law_candidates)} MKs)...")
            
            # Extract Law Content once
            first_c = law_candidates[0]
            law_content = first_c.get('law_content') or ""
            
            member_inputs = []
            for c in law_candidates:
                utterances = self.member_analyzer._select_utterances(c['member_slug'])
                member_context = "\n\n----------------------------------------\n\n".join(utterances)
                member_inputs.append("\n".join([
                    f"--- חבר כנסת: {c['member_name']} (slug: {c['member_slug']}) ---",
                    f"מפלגה: {c['party_name'] or 'לא זמין'}",
                    f"סף הפתעה: {SURPRISE_THRESHOLD} נקודות",
                    "כל הפערים:",
                    "\n".join(c['all_axis_diffs']) or "לא זמין",
                    "הצירים שיצרו את סימון ההצבעה כמפתיעה:",
                    "\n".join(c['surprise_axes']) or "לא זמין",
                    "קובץ אמירות:",
                    member_context[:MAX_MEMBER_CONTEXT_CHARS] or "לא זמין",
                    "----------------------------------------"
                ]))

            input_text = [
                f"החוק: {first_c['title']}",
                f"מספר הצעת חוק: {bill_id}",
                f"סיכום אידיאולוגי של החוק כפי שנותח קודם:",
                first_c['law_overall_summary'] or "לא זמין",
                "",
                f"תקציר ומטא-דאטה של החוק:",
                first_c['summary_law'] or "לא זמין",
                "",
                f"נוסח החוק:",
                law_content[:MAX_LAW_CONTENT_CHARS] or "לא זמין",
                "",
                "====== חברי כנסת להסבר ======",
                "\n\n".join(member_inputs)
            ]
            
            prompt = build_instructions()
            try:
                analysis = call_gemini_with_retry(
                    client=self.client,
                    model=self.model_name,
                    prompt=f"{prompt}\n\nחומר לניתוח:\n{chr(10).join(input_text)}",
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=BatchExplanationSchema
                    ),
                    initial_delay=GEMINI_RETRY_INITIAL_DELAY
                )
                return bill_id, analysis
            except Exception as e:
                logger.error(f"Error analyzing surprising votes for bill {bill_id}: {e}")
                return None

        failed_laws = set()
        success_count = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_ANALYSIS_WORKERS) as executor:
            future_to_batch = {executor.submit(process_law_batch, b_id, batch): b_id for b_id, batch in law_batches.items()}
            for future in concurrent.futures.as_completed(future_to_batch):
                b_id = future_to_batch[future]
                try:
                    res = future.result()
                    if res and res[1] and "explanations" in res[1]:
                        batch_analysis = res[1]
                        for mem_exp in batch_analysis["explanations"]:
                            member_slug = mem_exp["memberSlug"]
                            explanation = mem_exp["explanation"]
                            self._save_to_db(b_id, member_slug, explanation)
                        logger.info(f"Successfully processed and saved {len(batch_analysis['explanations'])} explanations for bill {b_id}.")
                        success_count += len(batch_analysis['explanations'])
                    else:
                        failed_laws.add(b_id)
                        logger.error(f"Failed to generate explanations for bill {b_id}")
                except Exception as e:
                    failed_laws.add(b_id)
                    logger.error(f"Error in future for bill {b_id}: {e}")

        logger.info(f"Successfully processed and saved {success_count} explanations.")

        successful_laws = [b for b in laws_to_check if b not in failed_laws]
        if not dry_run and successful_laws:
            with self.conn.cursor() as cur:
                cur.execute(
                    "UPDATE law SET surprises_analyzed = TRUE WHERE bill_id = ANY(%s)",
                    (successful_laws,)
                )
            self.conn.commit()
            logger.info(f"Marked {len(successful_laws)} laws as completely analyzed for surprises. {len(failed_laws)} laws had failures and will be retried.")

    def _save_to_db(self, bill_id, member_slug, explanation):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO law_surprise_explanation (bill_id, member_slug, explanation)
                VALUES (%s, %s, %s)
                ON CONFLICT (bill_id, member_slug) DO UPDATE SET
                    explanation = EXCLUDED.explanation
                """,
                (str(bill_id), member_slug, Json(explanation))
            )
        self.conn.commit()

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    conn = get_db_connection()
    try:
        processor = LawSurpriseAnalyzer(conn)
        processor.analyze_missing_explanations(dry_run=False)
    finally:
        conn.close()
