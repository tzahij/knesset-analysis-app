import re
import logging
from flask import Blueprint, jsonify, request
from src.python.data.database import get_db_connection, release_db_connection

bp = Blueprint("members", __name__)
logger = logging.getLogger(__name__)

MEMBER_PROTOCOL_SINCE_DATE = "2022-01-01"


def _flatten_contacts(contacts_json):
    """Convert raw contacts JSONB {platform: [{href, value, ...}]} into a flat list."""
    if not isinstance(contacts_json, dict):
        return []
    result = []
    uid = 0
    for platform, items in contacts_json.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            href = item.get("href", "") or ""
            if not href:
                continue
            uid += 1
            result.append({
                "id": f"{platform}-{uid}",
                "platform": platform,
                "href": href,
                "value": item.get("value", "") or item.get("label", "") or "",
                "label": item.get("label", "") or "",
            })
    return result


def _party_slug(name: str) -> str:
    """Generate a URL-friendly slug from a party name."""
    s = re.sub(r'["\u05F4\u05F3\']+', '', name or '')
    s = re.sub(r'[^\w\s-]', ' ', s, flags=re.UNICODE)
    return re.sub(r'\s+', '-', s).strip('-').lower()


@bp.route("/api/members")
def get_members():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Members grouped by party, with protocol count from utterances
            cur.execute("""
                SELECT
                    p.id   AS party_id,
                    p.name AS party_name,
                    m.slug,
                    m.name,
                    COUNT(DISTINCT mu.protocol_id) AS protocol_count
                FROM party p
                LEFT JOIN member m ON m.party_id = p.id
                LEFT JOIN member_utterance mu ON mu.member_slug = m.slug
                GROUP BY p.id, p.name, m.slug, m.name
                ORDER BY p.name ASC, m.name ASC
            """)
            rows = cur.fetchall()

        parties_map = {}
        total_members = 0

        for party_id, party_name, m_slug, m_name, proto_count in rows:
            party_slug = _party_slug(party_name)
            if party_slug not in parties_map:
                parties_map[party_slug] = {
                    "name": party_name,
                    "slug": party_slug,
                    "memberCount": 0,
                    "members": [],
                }
            if m_slug:
                total_members += 1
                parties_map[party_slug]["memberCount"] += 1
                parties_map[party_slug]["members"].append({
                    "slug": m_slug,
                    "routeSlug": m_slug,  # slug IS the id (member-001 etc)
                    "name": m_name,
                    "partyName": party_name,
                    "protocolCount": proto_count or 0,
                })


        return jsonify({
            "sinceDate": MEMBER_PROTOCOL_SINCE_DATE,
            "memberCount": total_members,
            "parties": list(parties_map.values()),
            # Status stub — real indexing is done by the batch pipeline
            "status": {"status": "completed", "processedProtocols": 0, "totalProtocols": 0, "matchedProtocols": 0, "lastIndexedAt": None},
            "utteranceFilesBulkStatus": {"status": "idle"},
            "analysisBulkStatus": {"status": "idle", "configured": False},
        })
    except Exception as e:
        logger.error(f"GET /api/members error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/members/<slug>")
def get_member_details(slug):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Member core info
            cur.execute("""
                SELECT m.slug, m.name, p.name, m.contacts
                FROM member m
                LEFT JOIN party p ON m.party_id = p.id
                WHERE m.slug = %s
            """, (slug,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Member not found"}), 404

            m_slug, m_name, party_name, contacts = row

            # Analysis (from separate table)
            cur.execute("""
                SELECT analysis_summary, analysis_model, last_analyzed_at
                FROM member_analysis
                WHERE member_slug = %s
            """, (slug,))
            ana_row = cur.fetchone()
            analysis = ana_row[0] if ana_row else None
            analysis_model = ana_row[1] if ana_row else None
            last_analyzed_at = ana_row[2].isoformat() if ana_row and ana_row[2] else None

            # Protocol stats from utterances (ignores short utterances by design)
            cur.execute("""
                SELECT
                    COUNT(DISTINCT mu.protocol_id)                                           AS total_protocols,
                    COUNT(DISTINCT CASE WHEN pr.source_type='plenum'    THEN mu.protocol_id END) AS plenum_protocols,
                    COUNT(DISTINCT CASE WHEN pr.source_type='committee' THEN mu.protocol_id END) AS committee_protocols
                FROM member_utterance mu
                JOIN protocol pr ON pr.document_id = mu.protocol_id
                WHERE mu.member_slug = %s
            """, (slug,))
            stats_row = cur.fetchone()
            stats = {
                "totalProtocols": stats_row[0] or 0,
                "plenumProtocols": stats_row[1] or 0,
                "committeeProtocols": stats_row[2] or 0,
            }

            # Most recent protocols this member appeared in
            cur.execute("""
                SELECT DISTINCT
                    pr.document_id,
                    pr.source_type,
                    pr.protocol_date,
                    pr.session_number,
                    pr.committee_name,
                    pr.knesset_number
                FROM member_utterance mu
                JOIN protocol pr ON pr.document_id = mu.protocol_id
                WHERE mu.member_slug = %s
                ORDER BY pr.protocol_date DESC
                LIMIT 50
            """, (slug,))

            protocols = []
            for (doc_id, source, proto_date, session_num, committee_name, knesset_num) in cur.fetchall():
                date_str = proto_date.isoformat() if proto_date else ""
                short_date = f"{proto_date.day}.{proto_date.month}.{proto_date.year}" if proto_date else ""
                if source == "plenum":
                    source_label = "מליאה"
                    title = f"ישיבת מליאה מס' {session_num}" if session_num else f"ישיבת מליאה"
                    description = f"כנסת {knesset_num}" if knesset_num else ""
                    reader_url = f"/protocol/{doc_id}"
                else:
                    source_label = "ועדה"
                    title = committee_name or "ישיבת ועדה"
                    description = f"ישיבה מס' {session_num}" if session_num else ""
                    reader_url = f"/committee-protocol/{doc_id}"

                protocols.append({
                    "documentId": doc_id,
                    "source": source,
                    "sourceLabel": source_label,
                    "date": date_str,
                    "shortDateLabel": short_date,
                    "title": title,
                    "description": description,
                    "sessionNumber": session_num,
                    "committeeName": committee_name,
                    "readerUrl": reader_url,
                    "downloadUrl": f"/api/protocols/{doc_id}/download" if source == "plenum" else f"/api/committee-protocols/{doc_id}/download",
                })

        # Build the analysis envelope the JS frontend expects:
        #   payload.analyses[sourceType] = { status: {...}, analysis: {...} }
        # We have a single analysis from the DB — expose it as both "full" and "small"
        # so the source-type tab switcher works without errors.
        contact_list = _flatten_contacts(contacts)

        if analysis:
            analysis_record = {
                "status": {
                    "status": "completed",
                    "model": analysis_model or "",
                    "generatedAt": last_analyzed_at,
                    "isStale": False,
                    "configured": True,
                },
                "analysis": analysis,
            }
        else:
            analysis_record = {
                "status": {
                    "status": "idle",
                    "configured": False,
                },
                "analysis": None,
            }

        return jsonify({
            "sinceDate": MEMBER_PROTOCOL_SINCE_DATE,
            "isPartial": False,
            "member": {
                "slug": m_slug,
                "routeSlug": m_slug,
                "name": m_name,
                "partyName": party_name,
                "partySlug": _party_slug(party_name),
            },
            "contact": {
                "hasContacts": len(contact_list) > 0,
                "contacts": contact_list,
            },
            "stats": stats,
            "protocols": protocols,
            # Legacy flat fields (kept for backward compat with older JS reads)
            "analysis": analysis,
            "analysisModel": analysis_model,
            "lastAnalyzedAt": last_analyzed_at,
            # Enveloped analyses — both sourceTypes share the single DB analysis
            "analyses": {
                "full": analysis_record,
                "small": analysis_record,
            },
            # Utterance files: replaced by DB-based utterances — no separate files
            "utteranceFile": {"status": "idle"},
            "utteranceFiles": {
                "full": {"status": "idle"},
                "small": {"status": "idle"},
            },
            "status": {
                "status": "completed",
                "processedProtocols": stats["totalProtocols"],
                "totalProtocols": stats["totalProtocols"],
                "matchedProtocols": stats["totalProtocols"],
                "lastIndexedAt": None,
            },
        })
    except Exception as e:
        logger.error(f"GET /api/members/{slug} error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/member-contact-directory")
def get_contact_directory():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.slug, m.name, p.name, m.contacts
                FROM member m
                LEFT JOIN party p ON m.party_id = p.id
                ORDER BY m.name ASC
            """)
            rows = cur.fetchall()

        members = [
            {
                "slug": r[0],
                "name": r[1],
                "partyName": r[2],
                "contacts": r[3] or {},
            }
            for r in rows
        ]
        return jsonify({"members": members})
    except Exception as e:
        logger.error(f"GET /api/member-contact-directory error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/members/<slug>/utterance-file/text")
def get_member_utterances_text(slug):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM member WHERE slug = %s", (slug,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Member not found"}), 404
            name = row[0]

            cur.execute("""
                SELECT mu.utterance_text, pr.protocol_date, pr.source_type
                FROM member_utterance mu
                JOIN protocol pr ON pr.document_id = mu.protocol_id
                WHERE mu.member_slug = %s
                ORDER BY pr.protocol_date DESC
            """, (slug,))
            utterances = cur.fetchall()

        if not utterances:
            return jsonify({"error": "No utterances found"}), 404

        lines = [f"חבר הכנסת: {name}", f"טווח הסריקה: החל מ-{MEMBER_PROTOCOL_SINCE_DATE}", ""]
        for text, date, source in utterances:
            date_str = date.isoformat() if date else ""
            lines.append(f"--- {date_str} ({source}) ---")
            lines.append(text)
            lines.append("")

        return "\n".join(lines), 200, {"Content-Type": "text/plain; charset=utf-8"}
    except Exception as e:
        logger.error(f"GET /api/members/{slug}/utterance-file/text error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)
