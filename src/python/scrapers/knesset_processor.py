import os
import sys
import json
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import Json
import google.generativeai as genai
import docx
import pdfplumber

# Add project root to path for imports
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Setup logging
logger = logging.getLogger("KnessetProcessor")

# Constants
LAW_AXIS_DEFINITIONS = [
    {"key": "religiousSecular", "label": "דתי מול חילוני", "lowLabel": "חילוני", "highLabel": "דתי"},
    {"key": "socialismCapitalism", "label": "סוציאליזם מול קפיטליזם", "lowLabel": "סוציאליסטי", "highLabel": "קפיטליסטי"},
    {"key": "doveHawk", "label": "יוני מול נצי", "lowLabel": "יוני", "highLabel": "נצי"},
    {"key": "liberalDemocracyAuthoritarianism", "label": "דמוקרטיה ליברלית מול סמכותנות", "lowLabel": "דמוקרטיה ליברלית", "highLabel": "סמכותנות"},
]

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
        "החזר JSON תקף בלבד.",
    ])

def extract_text(file_path):
    if not file_path or not os.path.exists(file_path):
        return ""
    ext = file_path.lower().split('.')[-1]
    try:
        if ext == 'pdf':
            with pdfplumber.open(file_path) as pdf:
                return "\n".join([page.extract_text() or "" for page in pdf.pages]).strip()
        elif ext == 'docx':
            doc = docx.Document(file_path)
            return "\n".join([p.text for p in doc.paragraphs]).strip()
    except Exception as e:
        logger.error(f"Error extracting text from {file_path}: {e}")
    return ""

class KnessetProcessor:
    def __init__(self, data_dir, model_name="gemini-1.5-flash"):
        self.data_dir = data_dir
        self.raw_dir = os.path.join(data_dir, "law-raw")
        self.analysis_dir = os.path.join(data_dir, "law-analyses")
        os.makedirs(self.analysis_dir, exist_ok=True)

        load_dotenv(os.path.join(project_root, ".env"))
        load_dotenv(os.path.join(project_root, ".env.local"), override=True)

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)

    def analyze_pending_laws(self, conn, dry_run=False):
        logger.info("--- Analyzing laws with AI ---")
        file_map = self._build_file_map()
        
        with conn.cursor() as cur:
            cur.execute("SELECT bill_id, title, summary_law FROM law WHERE status IS NULL OR status != 'analyzed'")
            pending = cur.fetchall()

        logger.info(f"Found {len(pending)} laws requiring analysis.")
        for bill_id, title, summary in pending:
            if dry_run:
                logger.info(f"[DRY RUN] Would analyze bill {bill_id}: {title}")
                continue

            local_path = file_map.get(str(bill_id))
            if not local_path:
                logger.warning(f"No local file found for bill {bill_id}, skipping analysis.")
                continue

            logger.info(f"Analyzing bill {bill_id}: {title}...")
            content = extract_text(local_path)
            
            analysis = self._call_gemini(title, summary, content)
            if analysis:
                self._update_db(conn, bill_id, analysis)
                self._save_markdown(bill_id, title, analysis)
                logger.info(f"Successfully processed bill {bill_id}.")
            
            time.sleep(1) # Rate limit protection

    def _build_file_map(self):
        mapping = {}
        if not os.path.exists(self.raw_dir): return mapping
        for file in os.listdir(self.raw_dir):
            if file.endswith(".json"):
                try:
                    with open(os.path.join(self.raw_dir, file), "r", encoding="utf-8") as f:
                        meta = json.load(f)
                        bill_id = str(meta.get("billId"))
                        local_path = meta.get("localFilePath")
                        if bill_id and local_path:
                            if bill_id not in mapping or local_path.lower().endswith(".pdf"):
                                mapping[bill_id] = local_path
                except: continue
        return mapping

    def _call_gemini(self, title, summary, content):
        prompt = build_analysis_instructions()
        input_data = f"כותרת: {title}\nתקציר: {summary}\n\nנוסח החוק:\n{content[:50000]}"
        try:
            response = self.model.generate_content(
                f"{prompt}\n\nחומר לניתוח:\n{input_data}",
                generation_config={"response_mime_type": "application/json"},
            )
            return json.loads(response.text)
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            return None

    def _update_db(self, conn, bill_id, analysis):
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE law SET analysis_summary = %s, status = 'analyzed' WHERE bill_id = %s",
                (Json(analysis), str(bill_id)),
            )
        conn.commit()

    def _save_markdown(self, bill_id, title, analysis):
        md_path = os.path.join(self.analysis_dir, f"{bill_id}__analysis.md")
        lines = [f"# {title}", "", f"**מזהה הצעת חוק:** {bill_id}", "", "## סיכום", "", analysis.get("overallSummary", ""), ""]
        axes = analysis.get("axes", {})
        for axis_def in LAW_AXIS_DEFINITIONS:
            axis_data = axes.get(axis_def["key"], {})
            if axis_data:
                lines.append(f"### {axis_def['label']}")
                lines.append(f"- **ציון:** {axis_data.get('score')}/10")
                for bullet in axis_data.get("explanationBullets", []):
                    lines.append(f"- {bullet}")
                lines.append("")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
