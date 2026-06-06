import os
import sys
import json
import time
import logging
from datetime import datetime
from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
from psycopg2.extras import Json
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
import concurrent.futures
from src.python.scrapers.utils import call_gemini_with_retry, initialize_gemini_client

# Configuration Environment Variables
MEMBER_ANALYSIS_MAX_UTTERANCES = int(os.environ.get('MEMBER_ANALYSIS_MAX_UTTERANCES', 100))
MEMBER_ANALYSIS_MIN_WORDS = int(os.environ.get('MEMBER_ANALYSIS_MIN_WORDS', 50))
MEMBER_ANALYSIS_DECAY_RATE = float(os.environ.get('MEMBER_ANALYSIS_DECAY_RATE', 0.20))
MEMBER_ANALYSIS_MIN_DAYS = int(os.environ.get('MEMBER_ANALYSIS_MIN_DAYS', 30))
MEMBER_ANALYSIS_MIN_NEW_UTTERANCES = int(os.environ.get('MEMBER_ANALYSIS_MIN_NEW_UTTERANCES', 10))
RATE_LIMIT_SLEEP_SECONDS = int(os.environ.get('RATE_LIMIT_SLEEP_SECONDS', 4))
MAX_MEMBER_CONTEXT_CHARS = int(os.environ.get('MAX_MEMBER_CONTEXT_CHARS', 200000))
GEMINI_RETRY_INITIAL_DELAY = float(os.environ.get('GEMINI_RETRY_INITIAL_DELAY', 4.0))
CONCURRENT_ANALYSIS_WORKERS = int(os.environ.get('CONCURRENT_ANALYSIS_WORKERS', 5))

logger = logging.getLogger("MemberAnalyser")

MEMBER_PROTOCOL_SINCE_DATE = (datetime.now() - relativedelta(years=1)).strftime("%Y-%m-%d")

AXIS_LABELS = {
    "religiousSecular": "דתי מול חילוני",
    "socialismCapitalism": "סוציאליזם מול קפיטליזם",
    "doveHawk": "יוני מול נצי",
    "liberalDemocracyAuthoritarianism": "דמוקרטיה ליברלית מול סמכותנות",
}

# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------

def build_analysis_instructions(member_name, party_name):
    return " ".join([
        "אתה פרשן פוליטי ישראלי חד, מתוחכם, שקול וישיר שכותב בעברית טבעית ורהוטה.",
        f"אתה מנתח את חבר הכנסת {member_name} מסיעת {party_name}.",
        "הישען רק על החומר שסופק לך.",
        "החזר בתחילת הפלט סעיף overallProfile עם שני טקסטים בלבד: פסקה אחת של דיוקן כולל, בוטה, ישיר וחד שמאגד גם את העמדות המפורשות וגם את מה שמשתמע בין השורות; ופסקה שנייה שמסבירה כיצד הדמות הזו צפויה להיתפס בהקשר היסטורי.",
        "הפסקה הראשונה חייבת לחבר יחד בין מה שנאמר במפורש לבין מה שנרמז, ולהסביר בקול ברור איזה טיפוס פוליטי עומד כאן מול הקורא.",
        "הפסקה השנייה חייבת להסביר איך סביר שיזכרו את הפוליטיקאי הזה, באיזה מחנה תודעתי ימוקם, ומה יהיה מקור הכוח או המחלוקת סביבו בהקשר היסטורי.",
        "גם לשתי פסקאות הסיכום חייבות להיות ראיות מתוך הציטוטים.",
        "בנוסף לכל הסעיפים הקיימים, החזר גם סעיף highlightedQuotes.",
        "בסעיף highlightedQuotes חייבות להופיע שלוש קבוצות נפרדות: innermostEmotions, surprisingInnerWorldOrHistory, benevolentTowardOthers.",
        "בקבוצת innermostEmotions בחר ציטוטים שמשקפים רגשות, תחושות, פגיעות, כאב, גאווה, חרדה, תקווה, עלבון, חמלה או עולם רגשי פנימי של הדובר.",
        "בקבוצת surprisingInnerWorldOrHistory בחר ציטוטים שחושפים משהו מפתיע, בלתי צפוי או לא טריוויאלי על העולם הפנימי, הביוגרפיה, הזיכרון האישי, ההיסטוריה האישית או החוויה הפנימית של הדובר.",
        "בקבוצת benevolentTowardOthers בחר רק ציטוטים שמבטאים יחס מיטיב, מפרגן, נדיב, מגונן, אמפתי או טוב כלפי אחרים בכנסת. אל תכלול ציטוטים סרקסטיים, עוקצניים, דו-משמעיים או כאלה שיש ספק אם הם נאמרו בכנות.",
        "בכל אחת משלוש הקבוצות החזר 2 עד 6 פריטים אם החומר מאפשר זאת; אם אין די חומר, החזר פחות, אך אל תמציא.",
        "לכל פריט בשלוש הקבוצות חייבים להיות quote, protocolHeading ו-explanation, כאשר explanation מסביר בקצרה ובבהירות למה הציטוט שייך דווקא לקטגוריה הזאת.",
        "בשלוש הקבוצות הקפד לבחור ציטוטים שיש להם ערך אנושי ופרשני ממשי, ולא רק משפטים כלליים או טכניים.",
        "לאחר מכן חלק את הפלט בדיוק לשני אזורי ניתוח: 'על סמך הטקסט' ו'בין השורות'.",
        "בתוך כל אחד משני האזורים חייבים להופיע בדיוק שלושה תתי-מדורים: 'עמדות ליבה', 'פרופיל פסיכולוגי', 'עימותים ואי-הלימה'.",
        "בכל אחד משלושת תתי-המדורים החזר מערך bullets של תובנות קצרות, חדות, ברורות וקלות להבנה. אל תכתוב פסקאות ארוכות ואל תאחד כמה רעיונות לנקודה אחת.",
        "בכל תת-מדור רצוי 3 עד 6 נקודות, וכל נקודה צריכה לכלול טענה אחת ברורה בלבד.",
        "כל נקודה חייבת להיות מעוגנת ראייתית מתוך הציטוטים.",
        "במדור 'בין השורות' מותר לפרש, אבל רק אם הפרשנות נשענת על דפוסים, בחירות לשון, הדגשים חוזרים, הימנעויות או פערים עקביים בחומר.",
        "אל תמציא עובדות חיצוניות, אל תסתמך על ידע כללי, ואל תכתוב סיסמאות ריקות.",
        "הראיות חייבות להיות ציטוטים קצרים יחסית עם כותרת הפרוטוקול שממנה נלקחו.",
        "הניתוח הכמותי חייב להישאר נפרד משני אזורי הניתוח, ובכל ציר החזר ציון אחד, 2 עד 4 נימוקים קצרים בבולטים שמסבירים למה הציון ניתן, וראיות תומכות.",
        "כתוב בנוסח שמתאים להצגה בכרטיסיות ובפאנלים UI: בהיר, היררכי, חד וברור כבר במבט ראשון.",
        "בציר דתי מול חילוני: 1 = חילוני מאוד, 10 = דתי מאוד.",
        "בציר סוציאליזם מול קפיטליזם: 1 = סוציאליסטי מאוד, 10 = קפיטליסטי מאוד.",
        "בציר יוני מול נצי: 1 = יוני מאוד, 10 = נצי מאוד.",
        "בציר דמוקרטיה ליברלית מול סמכותנות: 1 = דמוקרטיה ליברלית מאוד, 10 = סמכותני מאוד.",
        "הקפד להשתמש במירכאות כפולות תקינות (escaped quotes) בתוך טקסטים.",
        "החזר JSON תקף בלבד.",
    ])

# ---------------------------------------------------------------------------
# Structured Output Schemas
# ---------------------------------------------------------------------------

class HighlightedQuoteItem(BaseModel):
    quote: str
    protocolHeading: str
    explanation: str

class HighlightedQuotes(BaseModel):
    innermostEmotions: list[HighlightedQuoteItem]
    benevolentTowardOthers: list[HighlightedQuoteItem]
    surprisingInnerWorldOrHistory: list[HighlightedQuoteItem]

class QualitativeInsightItem(BaseModel):
    point: str
    evidence: list[HighlightedQuoteItem]

class QualitativeInsightGroup(BaseModel):
    bullets: list[QualitativeInsightItem]

class QualitativeLayer(BaseModel):
    coreStances: QualitativeInsightGroup
    psychologicalProfile: QualitativeInsightGroup
    clashesAndIncongruencies: QualitativeInsightGroup

class QuantitativeAxis(BaseModel):
    score: int
    explanationBullets: list[str]
    evidence: list[HighlightedQuoteItem]

class QuantitativeLayer(BaseModel):
    dovishVsHawkish: QuantitativeAxis
    religiousVsSecular: QuantitativeAxis
    socialismVsCapitalism: QuantitativeAxis
    liberalDemocracyVsAuthoritarianism: QuantitativeAxis

class QuantitativeAnalysis(BaseModel):
    textBased: QuantitativeLayer
    betweenTheLines: QuantitativeLayer

class OverallProfile(BaseModel):
    historicalPerception: str
    comprehensivePortrait: str

class MemberAnalysisSchema(BaseModel):
    overallProfile: OverallProfile
    highlightedQuotes: HighlightedQuotes
    analysisByExplicitText: QualitativeLayer
    analysisBetweenTheLines: QualitativeLayer
    quantitativeAnalysis: QuantitativeAnalysis


# ---------------------------------------------------------------------------
# Markdown helpers
# ---------------------------------------------------------------------------

def _format_evidence(evidence_list):
    if not evidence_list:
        return "אין כרגע ציטוטי ראיה זמינים."
    lines = []
    for item in evidence_list:
        heading = item.get('protocolHeading', 'פרוטוקול לא ידוע')
        quote = item.get('quote', '')
        explanation = item.get('explanation', '')
        lines.append(f"- **{heading}**")
        lines.append(f"  ציטוט: \"{quote}\"")
        lines.append(f"  הסבר: {explanation}")
    return "\n".join(lines)


def _format_bullets(bullets):
    if not bullets:
        return "- אין כרגע נתונים זמינים."
    return "\n".join([f"- {b}" for b in bullets])


def _format_insight_group(title, group):
    bullets = group.get('bullets', [])
    if not bullets:
        return f"### {title}\n- אין כרגע תובנות זמינות."
    sections = [f"### {title}"]
    for b in bullets:
        point = b.get('point', '')
        evidence = b.get('evidence', [])
        sections.append(f"- {point}")
        if evidence:
            sections.append(_format_evidence(evidence))
    return "\n\n".join(sections)


def _format_reading_layer(title, layer):
    return [
        f"## {title}",
        _format_insight_group("עמדות ליבה", layer.get('coreStances', {})),
        _format_insight_group("פרופיל פסיכולוגי", layer.get('psychologicalProfile', {})),
        _format_insight_group("עימותים ואי-הלימה", layer.get('clashesAndIncongruencies', {})),
    ]


def _format_axis(title, axis):
    score = axis.get('score', '?')
    bullets = axis.get('explanationBullets', [])
    evidence = axis.get('evidence', [])
    return [
        f"**{title}: {score}/10**",
        "**נימוקים:**",
        _format_bullets(bullets),
        "**ראיות:**",
        _format_evidence(evidence),
    ]


# ---------------------------------------------------------------------------
# Processor
# ---------------------------------------------------------------------------

class MemberAnalyzer:
    """
    Analyses MK political profiles using Gemini.

    Configuration (all via environment variables with defaults):
        ANALYSIS_MODEL                  gemini-2.5-flash
        MEMBER_ANALYSIS_MAX_UTTERANCES  100
        MEMBER_ANALYSIS_MIN_WORDS       50
        MEMBER_ANALYSIS_DECAY_RATE      0.20   (per-year rate, applied at day granularity)
        MEMBER_ANALYSIS_MIN_DAYS        30
        MEMBER_ANALYSIS_MIN_NEW_UTTERANCES  10
    """

    def __init__(self, conn):
        self.conn = conn

        self.client, self.model_name = initialize_gemini_client(default_model="gemini-2.5-flash")

        # Tuning parameters
        self.max_utterances = MEMBER_ANALYSIS_MAX_UTTERANCES
        self.min_words = MEMBER_ANALYSIS_MIN_WORDS
        self.decay_rate = MEMBER_ANALYSIS_DECAY_RATE
        self.min_days = MEMBER_ANALYSIS_MIN_DAYS
        self.min_new_utterances = MEMBER_ANALYSIS_MIN_NEW_UTTERANCES

    # ------------------------------------------------------------------
    # Public entry point — called by knesset_store_builder after sync
    # ------------------------------------------------------------------

    def analyze_due_members(self, dry_run=False):
        """
        Check all members and run analysis on those that are due.
        A member is due when EITHER:
          - They have never been analyzed (no row in member_analysis), OR
          - Both conditions are true:
              1. At least MIN_DAYS have passed since last_analyzed_at
              2. At least MIN_NEW_UTTERANCES qualifying utterances have been
                 added since last_analyzed_at
        """
        logger.info("--- Member Analysis: checking due members ---")
        logger.info(
            f"Params: max_utterances={self.max_utterances}, min_words={self.min_words}, "
            f"decay_rate={self.decay_rate}, min_days={self.min_days}, "
            f"min_new_utterances={self.min_new_utterances}, model={self.model_name}"
        )

        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT
                    m.slug,
                    m.name,
                    p.name AS party_name,
                    CASE 
                        WHEN ma.last_analyzed_at IS NULL THEN 'never analysed'
                        ELSE COUNT(mu.member_slug)::text || ' new utterances since last analysis'
                    END as reason
                FROM member m
                LEFT JOIN party p ON m.party_id = p.id
                LEFT JOIN member_analysis ma ON ma.member_slug = m.slug
                LEFT JOIN member_utterance mu 
                    ON mu.member_slug = m.slug 
                   AND mu.word_count >= %(min_words)s 
                   AND mu.created_at > ma.last_analyzed_at
                WHERE 
                    ma.last_analyzed_at IS NULL
                    OR (CURRENT_DATE - ma.last_analyzed_at::date) >= %(min_days)s
                GROUP BY m.slug, m.name, p.name, ma.last_analyzed_at
                HAVING 
                    ma.last_analyzed_at IS NULL 
                    OR COUNT(mu.member_slug) >= %(min_new_utterances)s
            """, {
                'min_words': self.min_words,
                'min_days': self.min_days,
                'min_new_utterances': self.min_new_utterances
            })
            due = cur.fetchall()

        logger.info(f"Found {len(due)} members due for analysis.")

        if dry_run:
            for slug, name, party_name, reason in due:
                logger.info(f"[DRY RUN] Would analyse {name} ({slug}) — {reason}")
            return

        def process_member(member_data):
            slug, name, party_name, reason = member_data
            logger.info(f"Fetching context for {name} ({slug}) — {reason}")
            utterances = self._select_utterances(slug)
            if not utterances:
                logger.warning(f"No qualifying utterances for {name}, skipping.")
                return None
            
            context_text = "\n\n----------------------------------------\n\n".join(utterances)
            analysis = self._call_gemini(name, party_name or "", context_text)
            return slug, name, analysis

        success_count = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_ANALYSIS_WORKERS) as executor:
            future_to_member = {executor.submit(process_member, m): m for m in due}
            for future in concurrent.futures.as_completed(future_to_member):
                try:
                    res = future.result()
                    if res and res[2]: # Has valid analysis
                        slug, name, analysis = res
                        self._save_to_db(slug, analysis)
                        logger.info(f"Done and saved: {name}.")
                        success_count += 1
                except Exception as e:
                    logger.error(f"Error analyzing member: {e}")

        logger.info(f"Successfully processed and saved {success_count} members.")

    # ------------------------------------------------------------------
    # Trigger logic
    # ------------------------------------------------------------------


    # Smart utterance selection (SQL-scored)
    # ------------------------------------------------------------------

    def _select_utterances(self, slug):
        """
        Selects up to max_utterances utterances for a member.

        Each utterance is scored by:
            score = word_count * (1 - decay_rate) ^ (days_since / 365.0)

        Only utterances with word_count >= min_words are considered.
        The top N by score are returned (more words AND more recent = higher rank).
        """
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT ranked.utterance_text
                FROM (
                    SELECT
                        mu.utterance_text,
                        mu.word_count * POWER(
                            %(one_minus_decay)s,
                            GREATEST(0, (CURRENT_DATE - pr.protocol_date::date)::float / 365.0)
                        ) AS score
                    FROM member_utterance mu
                    JOIN protocol pr ON pr.document_id = mu.protocol_id
                    WHERE mu.member_slug = %(slug)s
                      AND mu.word_count >= %(min_words)s
                ) ranked
                ORDER BY score DESC
                LIMIT %(limit)s
                """,
                {
                    "slug": slug,
                    "min_words": self.min_words,
                    "one_minus_decay": 1.0 - self.decay_rate,
                    "limit": self.max_utterances,
                }
            )
            return [r[0] for r in cur.fetchall()]

    # ------------------------------------------------------------------
    # AI call
    # ------------------------------------------------------------------

    def _call_gemini(self, name, party_name, context):
        instructions = build_analysis_instructions(name, party_name)
        prompt = (
            f"{instructions}\n\n"
            f"להלן אוסף הציטוטים של חבר הכנסת מהפרוטוקולים:\n\n"
            f"{context[:MAX_MEMBER_CONTEXT_CHARS]}"
        )
        try:
            return call_gemini_with_retry(
                client=self.client,
                model=self.model_name,
                prompt=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=MemberAnalysisSchema
                ),
                initial_delay=GEMINI_RETRY_INITIAL_DELAY
            )
        except Exception:
            # Errors are already logged in call_gemini_with_retry
            return None

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_to_db(self, slug, analysis):
        from src.python.scripts.migrate_analysis_schema import normalize_analysis
        
        normalized_analysis = normalize_analysis(analysis)
        
        with self.conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO member_analysis
                    (member_slug, analysis_summary, analysis_model, last_analyzed_at, updated_at)
                VALUES
                    (%s, %s, %s, NOW(), NOW())
                ON CONFLICT (member_slug) DO UPDATE SET
                    analysis_summary  = EXCLUDED.analysis_summary,
                    analysis_model    = EXCLUDED.analysis_model,
                    last_analyzed_at  = EXCLUDED.last_analyzed_at,
                    updated_at        = EXCLUDED.updated_at
                """,
                (slug, Json(normalized_analysis), self.model_name)
            )
        self.conn.commit()



# ---------------------------------------------------------------------------
# Standalone entry point for testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    conn = get_db_connection()
    try:
        processor = MemberAnalyzer(conn)
        processor.analyze_due_members()
    finally:
        conn.close()
