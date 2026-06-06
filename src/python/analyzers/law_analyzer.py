import os
import sys
import json
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json
from google import genai
from google.genai import types
import docx
import pdfplumber
import concurrent.futures
from src.python.scrapers.utils import call_gemini_with_retry, initialize_gemini_client

# Configuration Environment Variables
RATE_LIMIT_SLEEP_SECONDS = int(os.environ.get('RATE_LIMIT_SLEEP_SECONDS', 4))
MAX_LAW_CONTENT_CHARS = int(os.environ.get('MAX_LAW_CONTENT_CHARS', 50000))
GEMINI_RETRY_INITIAL_DELAY = float(os.environ.get('GEMINI_RETRY_INITIAL_DELAY', 4.0))
CONCURRENT_ANALYSIS_WORKERS = int(os.environ.get('CONCURRENT_ANALYSIS_WORKERS', 5))

# Setup logging
logger = logging.getLogger("LawAnalyser")

# Constants
LAW_AXIS_DEFINITIONS = [
    {"key": "religiousSecular", "label": "דתי מול חילוני", "lowLabel": "חילוני", "highLabel": "דתי"},
    {"key": "socialismCapitalism", "label": "סוציאליזם מול קפיטליזם", "lowLabel": "סוציאליסטי", "highLabel": "קפיטליסטי"},
    {"key": "doveHawk", "label": "יוני מול נצי", "lowLabel": "יוני", "highLabel": "נצי"},
    {"key": "liberalDemocracyAuthoritarianism", "label": "דמוקרטיה ליברלית מול סמכותנות", "lowLabel": "דמוקרטיה ליברלית", "highLabel": "סמכותנות"},
]

_axis_schema = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "score": types.Schema(type=types.Type.INTEGER),
        "explanationBullets": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(type=types.Type.STRING)
        ),
        "evidence": types.Schema(
            type=types.Type.ARRAY,
            items=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "quote": types.Schema(type=types.Type.STRING),
                    "explanation": types.Schema(type=types.Type.STRING)
                }
            )
        )
    }
)

LAW_ANALYSIS_SCHEMA = types.Schema(
    type=types.Type.OBJECT,
    properties={
        "overallSummary": types.Schema(type=types.Type.STRING),
        "religiousSecular": _axis_schema,
        "socialismCapitalism": _axis_schema,
        "doveHawk": _axis_schema,
        "liberalDemocracyAuthoritarianism": _axis_schema,
    }
)

def build_analysis_instructions():
    return " ".join([
        "אתה מנתח חוקים של הכנסת וכותב בעברית טבעית, בהירה ומדויקת.",
        "הישען רק על החומר שסופק לך מתוך נוסח החוק, התקציר הרשמי והמטא-דאטה.",
        "אל תשתמש בידע חיצוני ואל תנחש פרטים שלא עולים מהטקסט.",
        "עליך לקבוע היכן החוק ממוקם על ארבעה צירים אידיאולוגיים.",
        "בכל הצירים: 1 מייצג את הקוטב הראשון ו-10 מייצג את הקוטב השני.",
        "דתי מול חילוני: 1 = חילוני, 10 = דתי.",
        "סוציאליזם מול קפיטליזם: 1 = סוציאליסטי, 10 = קפיטליסטי.",
        "יוני מול נצי: 1 = יוני, 10 = נצי.",
        "דמוקרטיה ליברלית מול סמכותנות: 1 = דמוקרטיה ליברלית, 10 = סמכותנות.",
        "לכל ציר החזר ציון אחד, 2 עד 4 בולטים שמסבירים את הציון, ו-1 עד 3 מובאות קצרות.",
        "overallSummary חייב להיות פסקה קצרה אחת שמסבירה מה החוק מנסה לקדם.",
        "הקפד להשתמש במירכאות כפולות תקינות (escaped quotes) בתוך טקסטים. אל תשתמש במירכאות כפולות לא מוברחות בתוך ערכי JSON.",
        "החזר JSON תקף בלבד, ללא שגיאות תחביר או פסיקים חסרים.",
    ])

class LawAnalyser:
    def __init__(self, conn, model_name="gemini-2.5-flash"):
        self.conn = conn

        self.client, self.model_name = initialize_gemini_client(
            default_model="gemini-2.5-flash", override_model=model_name
        )

    def analyze_pending_laws(self, dry_run=False):
        logger.info("--- Analyzing laws with AI ---")
        
        with self.conn.cursor() as cur:
            # Only select laws that have extracted parsed_text
            cur.execute("SELECT bill_id, title, summary_law, parsed_text FROM law WHERE (status IS NULL OR status != 'analyzed') AND parsed_text IS NOT NULL")
            pending = cur.fetchall()

        logger.info(f"Found {len(pending)} laws requiring analysis.")
        
        if dry_run:
            for bill_id, title, summary, local_path in pending:
                logger.info(f"[DRY RUN] Would analyze bill {bill_id}: {title}")
            return

        def process_law(law_data):
            bill_id, title, summary, content = law_data
            if not content or not content.strip():
                logger.warning(f"Parsed text is empty for bill {bill_id}, skipping analysis.")
                return None
            
            logger.info(f"Analyzing bill {bill_id}: {title}...")
            analysis = self._call_gemini(title, summary, content)
            
            update_summary = None
            if not summary and analysis and "overallSummary" in analysis:
                update_summary = f"**תקציר זה נוצר על ידי בינה מלאכותית:**\n\n{analysis['overallSummary']}"
                
            return bill_id, title, analysis, update_summary

        success_count = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_ANALYSIS_WORKERS) as executor:
            future_to_law = {executor.submit(process_law, p): p for p in pending}
            for future in concurrent.futures.as_completed(future_to_law):
                try:
                    res = future.result()
                    if res and res[2]: # Has valid analysis
                        bill_id, title, analysis, update_summary = res
                        self._update_db(bill_id, analysis, update_summary)
                        logger.info(f"Successfully processed and saved bill {bill_id}.")
                        success_count += 1
                except Exception as e:
                    logger.error(f"Error analyzing law: {e}")

        logger.info(f"Successfully processed and saved {success_count} laws.")

    def _call_gemini(self, title, summary, content):
        prompt = build_analysis_instructions()
        input_data = f"כותרת: {title}\nתקציר: {summary}\n\nנוסח החוק:\n{content[:MAX_LAW_CONTENT_CHARS]}"
        try:
            return call_gemini_with_retry(
                client=self.client,
                model=self.model_name,
                prompt=f"{prompt}\n\nחומר לניתוח:\n{input_data}",
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=LAW_ANALYSIS_SCHEMA
                ),
                initial_delay=GEMINI_RETRY_INITIAL_DELAY
            )
        except Exception:
            # Errors are already logged in call_gemini_with_retry
            return None

    def _update_db(self, bill_id, analysis, update_summary=None):
        with self.conn.cursor() as cur:
            if update_summary:
                cur.execute(
                    "UPDATE law SET analysis_summary = %s, status = 'analyzed', analysis_model = %s, summary_law = %s WHERE bill_id = %s",
                    (Json(analysis), self.model_name, update_summary, str(bill_id)),
                )
            else:
                cur.execute(
                    "UPDATE law SET analysis_summary = %s, status = 'analyzed', analysis_model = %s WHERE bill_id = %s",
                    (Json(analysis), self.model_name, str(bill_id)),
                )
        self.conn.commit()


if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    conn = get_db_connection()
    try:
        processor = LawAnalyser(conn)
        processor.analyze_pending_laws()
    finally:
        conn.close()
