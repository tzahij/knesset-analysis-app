import logging
from flask import Blueprint, jsonify, request, send_file
from src.python.data.database import get_db_connection, release_db_connection
from src.python.utils.file_reader import extract_text

bp = Blueprint("protocols", __name__)
logger = logging.getLogger(__name__)

PAGE_SIZE = 50


def _protocol_row_to_dict(row):
    keys = [
        "documentId", "sourceType", "knessetNumber", "protocolDate",
        "sessionNumber", "committeeName", "committeeTypeDescription",
        "fileType", "url", "localFilePath", "status",
        "lastUpdatedDate", "fetchedAt", "hasExtractedUtterances",
    ]
    d = dict(zip(keys, row))
    
    p_date = d.get("protocolDate")
    if p_date and hasattr(p_date, "year"):
        d["year"] = p_date.year
        months = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
        d["shortDateLabel"] = f"{p_date.day} ב{months[p_date.month - 1]} {p_date.year}"
        d["timeLabel"] = f"{p_date.hour:02d}:{p_date.minute:02d}" if hasattr(p_date, "hour") and (p_date.hour > 0 or p_date.minute > 0) else None
    else:
        d["year"] = None
        d["shortDateLabel"] = "תאריך לא זמין"
        d["timeLabel"] = None

    search_parts = [
        str(d.get("year", "")),
        str(d.get("sessionNumber", "")),
        d.get("committeeName", ""),
        d.get("committeeTypeDescription", ""),
        d.get("shortDateLabel", "")
    ]
    d["searchText"] = " ".join(filter(None, search_parts)).lower()

    for date_key in ("protocolDate", "lastUpdatedDate", "fetchedAt"):
        if d.get(date_key):
            d[date_key] = d[date_key].isoformat() if hasattr(d[date_key], "isoformat") else str(d[date_key])
            
    d.pop("localFilePath", None)
    return d


def _get_protocols(source_type, year=None):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            conditions = ["source_type = %s"]
            params = [source_type]
            if year:
                conditions.append("EXTRACT(YEAR FROM protocol_date) = %s")
                params.append(year)
            where = "WHERE " + " AND ".join(conditions)

            cur.execute(f"SELECT COUNT(*) FROM protocol {where}", params)
            total = cur.fetchone()[0]

            cur.execute(f"""
                SELECT document_id, source_type, knesset_number, protocol_date,
                       session_number, committee_name, committee_type_description,
                       file_type, url, local_file_path, status,
                       last_updated_date, fetched_at, has_extracted_utterances
                FROM protocol {where}
                ORDER BY protocol_date DESC
            """, params)
            items = [_protocol_row_to_dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT DISTINCT EXTRACT(YEAR FROM protocol_date)::int
                FROM protocol WHERE source_type = %s AND protocol_date IS NOT NULL
                ORDER BY 1 DESC
            """, [source_type])
            years = [r[0] for r in cur.fetchall()]

        return {"items": items, "total": total, "years": years}
    finally:
        release_db_connection(conn)


def _get_protocol_by_id(document_id, source_type):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT document_id, source_type, knesset_number, protocol_date,
                       session_number, committee_name, committee_type_description,
                       file_type, url, local_file_path, status,
                       last_updated_date, fetched_at, has_extracted_utterances
                FROM protocol
                WHERE document_id = %s AND source_type = %s
            """, (document_id, source_type))
            row = cur.fetchone()
        return row
    finally:
        release_db_connection(conn)


def _get_protocol_path(document_id, source_type):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT local_file_path FROM protocol WHERE document_id = %s AND source_type = %s",
                (document_id, source_type)
            )
            row = cur.fetchone()
        return row[0] if row else None
    finally:
        release_db_connection(conn)


# ------------- Shared Handlers -------------

def _handle_get_protocol(document_id, source_type):
    row = _get_protocol_by_id(document_id, source_type)
    if not row:
        return jsonify({"error": "Protocol not found"}), 404
    return jsonify({"protocol": _protocol_row_to_dict(row)})


def _handle_get_protocol_content(document_id, source_type):
    import os
    import re
    path = _get_protocol_path(document_id, source_type)
    if not path:
        return jsonify({"error": "Protocol not found"}), 404
        
    row = _get_protocol_by_id(document_id, source_type)
    if not row:
        return jsonify({"error": "Protocol not found"}), 404

    text = extract_text(path)
    if not text:
        return jsonify({"error": "Content not available"}), 404
        
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip()]
    ext = os.path.splitext(path)[1]
    
    return jsonify({
        "documentId": document_id, 
        "protocol": _protocol_row_to_dict(row),
        "paragraphs": paragraphs,
        "extension": ext
    })


def _handle_download_protocol(document_id, source_type):
    import os
    path = _get_protocol_path(document_id, source_type)
    if not path or not os.path.exists(path):
        return jsonify({"error": "Protocol file not found"}), 404
    ext = os.path.splitext(path)[1]
    return send_file(path, as_attachment=True, download_name=f"{document_id}{ext}")


# ------------- Plenum -------------

@bp.route("/api/protocols")
def get_protocols():
    try:
        year = request.args.get("year", type=int)
        return jsonify(_get_protocols("plenum", year))
    except Exception as e:
        logger.error(f"GET /api/protocols error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/protocols/<document_id>")
def get_protocol(document_id):
    return _handle_get_protocol(document_id, "plenum")


@bp.route("/api/protocols/<document_id>/content")
def get_protocol_content(document_id):
    return _handle_get_protocol_content(document_id, "plenum")


@bp.route("/api/protocols/<document_id>/download")
def download_protocol(document_id):
    return _handle_download_protocol(document_id, "plenum")


# ------------- Committee -------------

@bp.route("/api/committee-protocols")
def get_committee_protocols():
    try:
        year = request.args.get("year", type=int)
        return jsonify(_get_protocols("committee", year))
    except Exception as e:
        logger.error(f"GET /api/committee-protocols error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/committee-protocols/<document_id>")
def get_committee_protocol(document_id):
    return _handle_get_protocol(document_id, "committee")


@bp.route("/api/committee-protocols/<document_id>/content")
def get_committee_protocol_content(document_id):
    return _handle_get_protocol_content(document_id, "committee")


@bp.route("/api/committee-protocols/<document_id>/download")
def download_committee_protocol(document_id):
    return _handle_download_protocol(document_id, "committee")
