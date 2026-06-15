import logging
import random
from datetime import datetime
from flask import Blueprint, jsonify
from src.python.data.database import get_db_connection, release_db_connection

bp = Blueprint("landing", __name__)
logger = logging.getLogger(__name__)

# Axis metadata (matches the JS LAW_AXIS_DEFINITIONS)
AXIS_DEFINITIONS = [
    {
        "key": "religiousSecular",
        "dbKey": "religiousVsSecular",
        "label": "דתי מול חילוני",
        "lowLabel": "חילוני",
        "highLabel": "דתי",
    },
    {
        "key": "socialismCapitalism",
        "dbKey": "socialismVsCapitalism",
        "label": "סוציאליזם מול קפיטליזם",
        "lowLabel": "סוציאליסטי",
        "highLabel": "קפיטליסטי",
    },
    {
        "key": "doveHawk",
        "dbKey": "dovishVsHawkish",
        "label": "יוני מול נצי",
        "lowLabel": "יוני",
        "highLabel": "נצי",
    },
    {
        "key": "liberalDemocracyAuthoritarianism",
        "dbKey": "liberalDemocracyVsAuthoritarianism",
        "label": "דמוקרטיה ליברלית מול סמכותנות",
        "lowLabel": "דמוקרטי",
        "highLabel": "סמכותני",
    },
]

KNOW_YOUR_MK_VIEWS = {
    "explicit": {
        "key": "explicit",
        "label": "עמדות מפורשות",
        "shortLabel": "מפורש",
        "eyebrow": "על סמך הטקסט",
        "disclaimer": "התצוגה הזו מציגה את חברי הכנסת רק לפי מה שהם אומרים במפורש בציטוטים שנותחו.",
        "analysisPath": "textBased",
    },
    "implicit": {
        "key": "implicit",
        "label": "עמדות משתמעות",
        "shortLabel": "משתמע",
        "eyebrow": "בין השורות",
        "disclaimer": "התצוגה הזו מציגה את חברי הכנסת לפי ההערכה המשתמעת שנגזרה מן הניתוח.",
        "analysisPath": "betweenTheLines",
    },
}


def _isoformat(dt):
    return dt.isoformat() if dt and hasattr(dt, "isoformat") else str(dt) if dt else None


# ---------------------------------------------------------------------------
# /api/landing  — overview counts + category cards + newsline + quote feed
# ---------------------------------------------------------------------------

@bp.route("/api/landing")
def get_landing():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Protocol counts
            cur.execute("SELECT COUNT(*) FROM protocol WHERE source_type='plenum'")
            plenum_count = cur.fetchone()[0]

            cur.execute("SELECT COUNT(*) FROM protocol WHERE source_type='committee'")
            committee_count = cur.fetchone()[0]

            # Law counts
            cur.execute("SELECT COUNT(*) FROM law")
            law_count = cur.fetchone()[0]

            # Laws with surprising vote explanations
            cur.execute("SELECT COUNT(DISTINCT bill_id) FROM law_surprise_explanation")
            surprising_law_count = cur.fetchone()[0]

            # Member count
            cur.execute("SELECT COUNT(*) FROM member")
            member_count = cur.fetchone()[0]

            # Newsline: top 8 laws by surprising vote count
            cur.execute("""
                SELECT
                    l.bill_id,
                    l.title,
                    l.publication_date,
                    COUNT(lse.member_slug) AS surprising_count
                FROM law l
                JOIN law_surprise_explanation lse ON lse.bill_id = l.bill_id
                GROUP BY l.bill_id, l.title, l.publication_date
                ORDER BY surprising_count DESC, l.publication_date DESC
                LIMIT 8
            """)
            newsline_rows = cur.fetchall()

            # For each newsline law, get top 3 surprising members
            newsline = []
            for i, (bill_id, title, pub_date, surp_count) in enumerate(newsline_rows):
                cur.execute("""
                    SELECT m.slug, m.name, p.name
                    FROM law_surprise_explanation lse
                    JOIN member m ON m.slug = lse.member_slug
                    LEFT JOIN party p ON p.id = m.party_id
                    WHERE lse.bill_id = %s
                    LIMIT 3
                """, (bill_id,))
                top_members = [
                    {"slug": r[0], "name": r[1], "partyName": r[2]}
                    for r in cur.fetchall()
                ]
                newsline.append({
                    "rank": i + 1,
                    "billId": bill_id,
                    "title": title,
                    "publicationDate": _isoformat(pub_date),
                    "surprisingVoteCount": surp_count,
                    "topSurprisingMembers": top_members,
                    "href": f"/law/{bill_id}",
                })

            # Recent quote feed: pick up to 24 recent utterances with their member info
            cur.execute("""
                SELECT
                    mu.member_slug,
                    m.name,
                    p.name AS party_name,
                    mu.utterance_text,
                    pr.protocol_date,
                    pr.source_type
                FROM member_utterance mu
                JOIN member m ON m.slug = mu.member_slug
                JOIN protocol pr ON pr.document_id = mu.protocol_id
                LEFT JOIN party p ON p.id = m.party_id
                ORDER BY pr.protocol_date DESC, random()
                LIMIT 100
            """)
            all_utterances = cur.fetchall()

        # Pick one per member, max 24
        seen_members = set()
        quote_feed = []
        for m_slug, m_name, party_name, text, proto_date, source_type in all_utterances:
            if m_slug in seen_members:
                continue
            seen_members.add(m_slug)
            # Take first ~200 chars of utterance as a preview
            preview = (text[:250] + "…") if len(text) > 250 else text
            quote_feed.append({
                "memberSlug": m_slug,
                "memberName": m_name,
                "partyName": party_name,
                "quote": preview,
                "date": _isoformat(proto_date),
                "sourceType": source_type,
                "href": f"/members/{m_slug}",
            })
            if len(quote_feed) >= 24:
                break

        overview = {
            "plenumCount": plenum_count,
            "committeeCount": committee_count,
            "lawCount": law_count,
            "surprisingLawCount": surprising_law_count,
            "memberCount": member_count,
            "comparisonCount": 0,  # Phase 3
        }

        categories = [
            {
                "key": "plenum",
                "hebrewTitle": "ישיבות מליאה",
                "description": "פרוטוקולים רשמיים של מליאת הכנסת, עם עמוד קריאה ייעודי והורדת הקובץ המקורי.",
                "count": plenum_count,
                "unitLabel": "פרוטוקולים",
                "href": "#source-tabs",
                "sourceKey": "plenum",
                "tone": "plenum",
            },
            {
                "key": "committee",
                "hebrewTitle": "ישיבות ועדות הכנסת",
                "description": "דיוני ועדות, עם סינון לפי סוג ועדה ולפי שם הוועדה.",
                "count": committee_count,
                "unitLabel": "פרוטוקולים",
                "href": "#source-tabs",
                "sourceKey": "committee",
                "tone": "committee",
            },
            {
                "key": "laws",
                "hebrewTitle": "חוקים בקריאה שלישית",
                "description": "החוקים האחרונים שאושרו בקריאה שלישית, כולל נוסח קריא, הורדות, מפת הצבעות וניתוח אידיאולוגי.",
                "count": law_count,
                "unitLabel": "חוקים",
                "href": "#source-tabs",
                "sourceKey": "laws",
                "tone": "laws",
            },
            {
                "key": "votes",
                "hebrewTitle": "הצבעות מפתיעות",
                "description": "חוקים שבהם הצבעות התמיכה התנגשו עם הפרופיל האידיאולוגי של חברי הכנסת.",
                "count": surprising_law_count,
                "unitLabel": "חוקים",
                "href": "#source-tabs",
                "sourceKey": "laws",
                "lawMode": "surprising",
                "tone": "votes",
            },
            {
                "key": "members",
                "hebrewTitle": "חברי הכנסת",
                "description": "עמודי פרופיל לכל חבר כנסת, עם פרוטוקולים, קובצי אמירות, ניתוחי פרופיל וראיות בולטות.",
                "count": member_count,
                "unitLabel": "עמודים",
                "href": "/members",
                "tone": "members",
            },
            {
                "key": "contact-directory",
                "hebrewTitle": "דברו עם הנציגים שלכם!",
                "description": "ספריית קשר מהירה לכל חברי הכנסת, עם אייקונים לחיצים למייל, טלפון, וואטסאפ ורשתות חברתיות.",
                "count": member_count,
                "unitLabel": "חברי כנסת",
                "href": "/talk-to-your-representatives",
                "tone": "contact",
            },
        ]

        return jsonify({
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "overview": overview,
            "categories": categories,
            "newsline": {
                "items": newsline,
                "summary": f"{surprising_law_count} חוקים עם הצבעות מפתיעות",
            },
            "quoteFeed": {
                "count": len(quote_feed),
                "items": quote_feed,
            },
        })
    except Exception as e:
        logger.error(f"GET /api/landing error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


# ---------------------------------------------------------------------------
# /api/landing/spotlight  — randomly pick an analysed member for feature card
# ---------------------------------------------------------------------------

@bp.route("/api/landing/spotlight")
def get_spotlight():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Pick members with analysis, at random
            cur.execute("""
                SELECT
                    m.slug,
                    m.name,
                    p.name AS party_name,
                    m.contacts,
                    ma.analysis_summary,
                    ma.last_analyzed_at
                FROM member m
                JOIN member_analysis ma ON ma.member_slug = m.slug
                LEFT JOIN party p ON p.id = m.party_id
                WHERE ma.analysis_summary IS NOT NULL
                ORDER BY random()
                LIMIT 20
            """)
            candidates = cur.fetchall()

        if not candidates:
            return jsonify({"status": "missing"}), 200

        # Pick the first candidate that has an overallProfile
        chosen = None
        for slug, name, party_name, contacts, analysis, last_analyzed_at in candidates:
            if isinstance(analysis, dict) and analysis.get("overallProfile"):
                chosen = (slug, name, party_name, contacts, analysis, last_analyzed_at)
                break

        if not chosen:
            # Fall back to first candidate regardless
            chosen = candidates[0]
            slug, name, party_name, contacts, analysis, last_analyzed_at = chosen
        else:
            slug, name, party_name, contacts, analysis, last_analyzed_at = chosen

        # Protocol stats
        conn2 = get_db_connection()
        try:
            with conn2.cursor() as cur2:
                cur2.execute("""
                    SELECT
                        COUNT(DISTINCT mu.protocol_id),
                        COUNT(DISTINCT CASE WHEN pr.source_type='plenum'    THEN mu.protocol_id END),
                        COUNT(DISTINCT CASE WHEN pr.source_type='committee' THEN mu.protocol_id END)
                    FROM member_utterance mu
                    JOIN protocol pr ON pr.document_id = mu.protocol_id
                    WHERE mu.member_slug = %s
                """, (slug,))
                total_p, plenum_p, committee_p = cur2.fetchone()
        finally:
            release_db_connection(conn2)

        # Pick a highlighted quote
        highlighted_quote = _pick_highlighted_quote(analysis)

        # Parse contacts for spotlight
        contacts_list = []
        if isinstance(contacts, dict):
            for platform, items in contacts.items():
                if isinstance(items, list):
                    for item in items[:2]:
                        href = item.get("href", "") if isinstance(item, dict) else ""
                        if href:
                            contacts_list.append({"platform": platform, "href": href})
        contacts_list = contacts_list[:6]

        overall = analysis.get("overallProfile", {}) if isinstance(analysis, dict) else {}
        blunt = overall.get("bluntProfile", {})
        hist = overall.get("historicalContext", {})

        # Axis scores from textBased quantitative analysis
        quant = analysis.get("quantitativeAnalysis", {}) if isinstance(analysis, dict) else {}
        text_based = quant.get("textBased", {})
        axes = [
            {
                "key": ax["key"],
                "label": ax["label"],
                "lowLabel": ax["lowLabel"],
                "highLabel": ax["highLabel"],
                "directScore": text_based.get(ax["key"], {}).get("score") if isinstance(text_based, dict) else None,
            }
            for ax in AXIS_DEFINITIONS
        ]

        return jsonify({
            "status": "ready",
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "member": {
                "slug": slug,
                "name": name,
                "partyName": party_name,
                "href": f"/members/{slug}",
            },
            "summary": blunt.get("paragraph", "") if isinstance(blunt, dict) else "",
            "historicalContext": hist.get("paragraph", "") if isinstance(hist, dict) else "",
            "highlightedQuote": highlighted_quote,
            "stats": {
                "protocolCount": total_p or 0,
                "plenumProtocols": plenum_p or 0,
                "committeeProtocols": committee_p or 0,
            },
            "contacts": contacts_list,
            "axes": axes,
            "lastAnalyzedAt": _isoformat(last_analyzed_at),
        })
    except Exception as e:
        logger.error(f"GET /api/landing/spotlight error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


# ---------------------------------------------------------------------------
# /api/landing/know-your-mk  — all members with their axis scores
# ---------------------------------------------------------------------------

@bp.route("/api/landing/know-your-mk")
def get_know_your_mk():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    m.slug,
                    m.name,
                    p.name AS party_name,
                    ma.analysis_summary
                FROM member m
                JOIN member_analysis ma ON ma.member_slug = m.slug
                LEFT JOIN party p ON p.id = m.party_id
                WHERE ma.analysis_summary IS NOT NULL
                ORDER BY p.name, m.name
            """)
            rows = cur.fetchall()

        members = []
        for slug, name, party_name, analysis in rows:
            if not isinstance(analysis, dict):
                continue
            quant = analysis.get("quantitativeAnalysis", {})
            text_based = quant.get("textBased", {}) if isinstance(quant, dict) else {}
            between = quant.get("betweenTheLines", {}) if isinstance(quant, dict) else {}

            overall = analysis.get("overallProfile", {})
            blunt = overall.get("bluntProfile", {}) if isinstance(overall, dict) else {}

            def _axis_entry(axis_map, axis_def):
                if not isinstance(axis_map, dict):
                    return None
                db_key = axis_def.get("dbKey", axis_def["key"])
                ax = axis_map.get(db_key, {})
                if not isinstance(ax, dict):
                    return None
                score = ax.get("score")
                if score is None:
                    return None
                return {
                    "score": score,
                    "explanationBullets": (ax.get("explanationBullets") or [])[:3],
                }

            axes = {
                "explicit": {
                    k["key"]: _axis_entry(text_based, k)
                    for k in AXIS_DEFINITIONS
                },
                "implicit": {
                    k["key"]: _axis_entry(between, k)
                    for k in AXIS_DEFINITIONS
                },
            }

            members.append({
                "slug": slug,
                "routeSlug": slug,
                "name": name,
                "partyName": party_name,
                "href": f"/members/{slug}",
                "overallSummary": blunt.get("paragraph", "") if isinstance(blunt, dict) else "",
                "axes": axes,
            })

        party_options = sorted(set(m["partyName"] for m in members if m["partyName"]))

        return jsonify({
            "generatedAt": datetime.utcnow().isoformat() + "Z",
            "views": KNOW_YOUR_MK_VIEWS,
            "axes": AXIS_DEFINITIONS,
            "filters": {"parties": party_options},
            "summary": {
                "totalMembers": 133,
                "availableMembers": len(members),
                "missingMembers": max(0, 133 - len(members)),
            },
            "members": members,
        })
    except Exception as e:
        logger.error(f"GET /api/landing/know-your-mk error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pick_highlighted_quote(analysis):
    if not isinstance(analysis, dict):
        return None
    hq = analysis.get("highlightedQuotes", {})
    if not isinstance(hq, dict):
        return None
    for group_key in ("surprisingInnerWorldOrHistory", "innermostEmotions", "benevolentTowardOthers"):
        group = hq.get(group_key)
        # Support both list-of-items and nested {quotes: [...]} format
        if isinstance(group, list) and group:
            item = group[0]
        elif isinstance(group, dict):
            items = group.get("quotes") or group.get("items") or []
            item = items[0] if items else None
        else:
            item = None
        if item and isinstance(item, dict) and item.get("quote"):
            return {
                "quote": item.get("quote", ""),
                "protocolHeading": item.get("protocolHeading", ""),
                "explanation": item.get("explanation", ""),
            }
    return None
