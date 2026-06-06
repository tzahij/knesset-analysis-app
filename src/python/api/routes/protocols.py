import logging
import os
from flask import Blueprint, jsonify, request, send_file
from src.python.data.database import get_db_connection, release_db_connection


# Configuration Environment Variables
PYTHON_API_PROTOCOL_PAGE_SIZE = int(os.environ.get('PYTHON_API_PROTOCOL_PAGE_SIZE', 50))


bp = Blueprint("protocols", __name__)
logger = logging.getLogger(__name__)

PAGE_SIZE = PYTHON_API_PROTOCOL_PAGE_SIZE


def _protocol_row_to_dict(row):
    keys = [
        "documentId", "sourceType", "knessetNumber", "protocolDate",
        "sessionNumber", "committeeName", "committeeTypeDescription",
        "fileType", "url", "status",
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
                SELECT p.document_id, p.source_type, p.knesset_number, p.protocol_date,
                       p.session_number, p.committee_name, p.committee_type_description,
                       f.file_type, p.url, p.status,
                       p.last_updated_date, p.fetched_at, p.has_extracted_utterances
                FROM protocol p
                LEFT JOIN file f ON f.id = p.document_id AND f.entity_type = %s
                {where.replace('protocol_date', 'p.protocol_date').replace('source_type', 'p.source_type')}
                ORDER BY p.protocol_date DESC
            """, ['P' if source_type == 'plenum' else 'C'] + params)
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
                SELECT p.document_id, p.source_type, p.knesset_number, p.protocol_date,
                       p.session_number, p.committee_name, p.committee_type_description,
                       f.file_type, p.url, p.status,
                       p.last_updated_date, p.fetched_at, p.has_extracted_utterances,
                       p.parsed_text
                FROM protocol p
                LEFT JOIN file f ON f.id = p.document_id AND f.entity_type = %s
                WHERE p.document_id = %s AND p.source_type = %s
            """, ('P' if source_type == 'plenum' else 'C', document_id, source_type))
            row = cur.fetchone()
        return row
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
    row = _get_protocol_by_id(document_id, source_type)
    if not row:
        return jsonify({"error": "Protocol not found"}), 404

    parsed_text = row[13] # parsed_text

    if not parsed_text:
        return jsonify({"error": "Content not available"}), 404
        
    paragraphs = []
    if parsed_text:
        paragraphs = [p.strip() for p in re.split(r'\n{2,}', parsed_text) if p.strip()]
        
    protocol_dict = _protocol_row_to_dict(row[:13])
    file_type = row[7] # file_type
    
    return jsonify({
        "documentId": document_id, 
        "protocol": protocol_dict,
        "paragraphs": paragraphs,
        "extension": file_type
    })


def _handle_fetch_protocol(document_id, source_type):
    row = _get_protocol_by_id(document_id, source_type)
    if not row:
        return jsonify({"error": "Protocol not found in database"}), 404
        
    parsed_text = row[14]
    if not parsed_text:
        return jsonify({"error": "Text not available in database"}), 404
        
    return jsonify({"text": parsed_text})


def _handle_download_protocol(document_id, source_type):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            file_type_val = 'P' if source_type == 'plenum' else 'C'
            cur.execute("""
                SELECT f.file, f.file_type, p.url 
                FROM protocol p 
                LEFT JOIN file f ON f.id = p.document_id AND f.entity_type = %s 
                WHERE p.document_id = %s AND p.source_type = %s
            """, (file_type_val, document_id, source_type))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Protocol not found"}), 404
            
            file_blob, p_file_type, url = row
            if not file_blob:
                return jsonify({"error": "File not found on server"}), 404
                
            import io
            return send_file(
                io.BytesIO(file_blob),
                as_attachment=(p_file_type and p_file_type.lower() != "pdf"),
                download_name=f"protocol_{document_id}.{p_file_type or 'pdf'}"
            )
    except Exception as e:
        logger.error(f"Download protocol error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)

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


@bp.route("/api/protocols/<document_id>/fetch")
def fetch_protocol(document_id):
    return _handle_fetch_protocol(document_id, "plenum")


@bp.route("/api/protocols/<document_id>/download")
def download_plenum_protocol(document_id):
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


@bp.route("/api/committee-protocols/<document_id>/fetch")
def fetch_committee_protocol(document_id):
    return _handle_fetch_protocol(document_id, "committee")


@bp.route("/api/committee-protocols/<document_id>/download")
def download_committee_protocol(document_id):
    return _handle_download_protocol(document_id, "committee")
