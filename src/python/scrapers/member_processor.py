import os
import sys
import json
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
from psycopg2.extras import Json
from google import genai
from google.genai import types

logger = logging.getLogger("MemberProcessor")

MEMBER_PROTOCOL_SINCE_DATE = "2022-01-01"

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
        "החזר JSON תקף בלבד.",
    ])


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

class MemberProcessor:
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

    def __init__(self, data_dir, conn):
        self.data_dir = data_dir
        self.conn = conn
        self.analysis_dir = os.path.join(data_dir, "member-analyses")
        os.makedirs(self.analysis_dir, exist_ok=True)

        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        load_dotenv(os.path.join(project_root, ".env"))
        load_dotenv(os.path.join(project_root, ".env.local"), override=True)

        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in environment")

        self.client = genai.Client(api_key=api_key)
        self.model_name = os.environ.get("ANALYSIS_MODEL", "gemini-2.5-flash")

        # Tuning parameters
        self.max_utterances = int(os.environ.get("MEMBER_ANALYSIS_MAX_UTTERANCES", 100))
        self.min_words = int(os.environ.get("MEMBER_ANALYSIS_MIN_WORDS", 50))
        self.decay_rate = float(os.environ.get("MEMBER_ANALYSIS_DECAY_RATE", 0.20))
        self.min_days = int(os.environ.get("MEMBER_ANALYSIS_MIN_DAYS", 30))
        self.min_new_utterances = int(os.environ.get("MEMBER_ANALYSIS_MIN_NEW_UTTERANCES", 10))

    # ------------------------------------------------------------------
    # Public entry point — called by knesset_store_builder after sync
    # ------------------------------------------------------------------

    def analyze_due_members(self, dry_run=False):
        """
        Check all members and run analysis on those that are due.
        A member is due when EITHER:
          - They have never been analysed (no row in member_analysis), OR
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
                    ma.last_analyzed_at
                FROM member m
                LEFT JOIN party p ON m.party_id = p.id
                LEFT JOIN member_analysis ma ON ma.member_slug = m.slug
            """)
            all_members = cur.fetchall()

        due = []
        for slug, name, party_name, last_analyzed_at in all_members:
            reason = self._due_reason(slug, last_analyzed_at)
            if reason:
                due.append((slug, name, party_name, reason))

        logger.info(f"Found {len(due)} members due for analysis.")

        for slug, name, party_name, reason in due:
            if dry_run:
                logger.info(f"[DRY RUN] Would analyse {name} ({slug}) — {reason}")
                continue

            logger.info(f"Analysing {name} ({slug}) — {reason}")
            utterances = self._select_utterances(slug)
            if not utterances:
                logger.warning(f"No qualifying utterances for {name}, skipping.")
                continue

            context_text = "\n\n----------------------------------------\n\n".join(utterances)
            analysis = self._call_gemini(name, party_name or "", context_text)
            if analysis:
                self._save_to_db(slug, analysis)
                self._save_markdown(slug, name, party_name or "", analysis)
                logger.info(f"Done: {name}.")

            time.sleep(1)  # rate-limit protection

    # ------------------------------------------------------------------
    # Trigger logic
    # ------------------------------------------------------------------

    def _due_reason(self, slug, last_analyzed_at):
        """
        Returns a human-readable reason string if the member is due, else None.
        """
        if last_analyzed_at is None:
            return "never analysed"

        with self.conn.cursor() as cur:
            # Condition 1: days elapsed
            cur.execute(
                "SELECT (CURRENT_DATE - %s::date) >= %s",
                (last_analyzed_at, self.min_days)
            )
            days_ok = cur.fetchone()[0]
            if not days_ok:
                return None  # Too soon — skip without checking utterances

            # Condition 2: new qualifying utterances since last analysis
            cur.execute(
                """
                SELECT COUNT(*)
                FROM member_utterance
                WHERE member_slug = %s
                  AND word_count >= %s
                  AND created_at > %s
                """,
                (slug, self.min_words, last_analyzed_at)
            )
            new_count = cur.fetchone()[0]

        if new_count >= self.min_new_utterances:
            return f"{new_count} new utterances since last analysis"
        return None

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
                SELECT utterance_text
                FROM (
                    SELECT
                        utterance_text,
                        word_count * POWER(
                            %(one_minus_decay)s,
                            GREATEST(0, (CURRENT_DATE - protocol_date)::float / 365.0)
                        ) AS score
                    FROM member_utterance
                    WHERE member_slug = %(slug)s
                      AND word_count >= %(min_words)s
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
            f"{context[:200000]}"
        )
        try:
            response = self.client.models.generate_content(
                model=self.model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                ),
            )
            return json.loads(response.text)
        except Exception as e:
            logger.error(f"Gemini API error for {name}: {e}")
            return None

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_to_db(self, slug, analysis):
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
                (slug, Json(analysis), self.model_name)
            )
        self.conn.commit()

    def _save_markdown(self, slug, name, party_name, analysis):
        filename = f"{slug}__analysis__from-{MEMBER_PROTOCOL_SINCE_DATE}.md"
        path = os.path.join(self.analysis_dir, filename)

        profile = analysis.get('overallProfile', {})
        blunt = profile.get('bluntProfile', {})
        hist = profile.get('historicalContext', {})

        lines = [
            f"# ניתוח פוליטי: {name}",
            "",
            f"**סיעה:** {party_name}",
            f"**מודל:** {self.model_name}",
            f"**נוצר בתאריך:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "",
            "## פרופיל כולל",
            "### דיוקן חד",
            blunt.get('paragraph', ''),
            _format_evidence(blunt.get('evidence', [])),
            "",
            "### הקשר היסטורי צפוי",
            hist.get('paragraph', ''),
            _format_evidence(hist.get('evidence', [])),
            "",
        ]

        sections = analysis.get('analysisSections', {})
        for key, label in [('textBased', 'על סמך הטקסט'), ('betweenTheLines', 'בין השורות')]:
            layer = sections.get(key, {})
            if layer:
                lines.extend(_format_reading_layer(label, layer))
                lines.append("")

        quant = analysis.get('quantitativeAnalysis', {})
        for key, label in [
            ('textBased', 'ניתוח כמותי - על סמך הטקסט'),
            ('betweenTheLines', 'ניתוח כמותי - בין השורות'),
        ]:
            data = quant.get(key, {})
            if data:
                lines.append(f"## {label}")
                for axis_key, axis_label in AXIS_LABELS.items():
                    axis_data = data.get(axis_key, {})
                    if axis_data:
                        lines.extend(_format_axis(axis_label, axis_data))
                        lines.append("")

        hq = analysis.get('highlightedQuotes', {})
        if hq:
            lines.append("## ציטוטים בולטים")
            for hq_key, hq_label in [
                ('innermostEmotions', 'רגשות ותחושות פנימיים'),
                ('surprisingInnerWorldOrHistory', 'עולם פנימי או היסטוריה אישית מפתיעים'),
                ('benevolentTowardOthers', 'יחס מיטיב לאחרים בכנסת'),
            ]:
                items = hq.get(hq_key, [])
                if items:
                    lines.append(f"### {hq_label}")
                    lines.append(_format_evidence(items))
                    lines.append("")

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Standalone entry point for testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    data_dir = os.path.abspath(os.path.join(project_root, "data"))
    conn = get_db_connection()
    try:
        processor = MemberProcessor(data_dir, conn)
        processor.analyze_due_members()
    finally:
        conn.close()
