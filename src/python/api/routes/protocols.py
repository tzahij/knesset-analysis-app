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
    for date_key in ("protocolDate", "lastUpdatedDate", "fetchedAt"):
        if d.get(date_key):
            d[date_key] = d[date_key].isoformat() if hasattr(d[date_key], "isoformat") else str(d[date_key])
    d.pop("localFilePath", None)
    return d


def _get_protocols(source_type, year=None, page=1):
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

            params_paged = params + [PAGE_SIZE, (page - 1) * PAGE_SIZE]
            cur.execute(f"""
                SELECT document_id, source_type, knesset_number, protocol_date,
                       session_number, committee_name, committee_type_description,
                       file_type, url, local_file_path, status,
                       last_updated_date, fetched_at, has_extracted_utterances
                FROM protocol {where}
                ORDER BY protocol_date DESC
                LIMIT %s OFFSET %s
            """, params_paged)
            items = [_protocol_row_to_dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT DISTINCT EXTRACT(YEAR FROM protocol_date)::int
                FROM protocol WHERE source_type = %s
                ORDER BY 1 DESC
            """, [source_type])
            years = [r[0] for r in cur.fetchall()]

        return {"items": items, "total": total, "page": page, "pageSize": PAGE_SIZE, "years": years}
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


# ------------- Plenum -------------

@bp.route("/api/protocols")
def get_protocols():
    try:
        year = request.args.get("year", type=int)
        page = max(1, request.args.get("page", 1, type=int))
        return jsonify(_get_protocols("plenum", year, page))
    except Exception as e:
        logger.error(f"GET /api/protocols error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/protocols/<document_id>")
def get_protocol(document_id):
    row = _get_protocol_by_id(document_id, "plenum")
    if not row:
        return jsonify({"error": "Protocol not found"}), 404
    return jsonify({"protocol": _protocol_row_to_dict(row)})


@bp.route("/api/protocols/<document_id>/content")
def get_protocol_content(document_id):
    path = _get_protocol_path(document_id, "plenum")
    if not path:
        return jsonify({"error": "Protocol not found"}), 404
    text = extract_text(path)
    if not text:
        return jsonify({"error": "Content not available"}), 404
    return jsonify({"documentId": document_id, "content": text})


@bp.route("/api/protocols/<document_id>/download")
def download_protocol(document_id):
    import os
    path = _get_protocol_path(document_id, "plenum")
    if not path or not os.path.exists(path):
        return jsonify({"error": "Protocol file not found"}), 404
    ext = os.path.splitext(path)[1]
    return send_file(path, as_attachment=True, download_name=f"{document_id}{ext}")


# ------------- Committee -------------

@bp.route("/api/committee-protocols")
def get_committee_protocols():
    try:
        year = request.args.get("year", type=int)
        page = max(1, request.args.get("page", 1, type=int))
        return jsonify(_get_protocols("committee", year, page))
    except Exception as e:
        logger.error(f"GET /api/committee-protocols error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/committee-protocols/<document_id>")
def get_committee_protocol(document_id):
    row = _get_protocol_by_id(document_id, "committee")
    if not row:
        return jsonify({"error": "Committee protocol not found"}), 404
    return jsonify({"protocol": _protocol_row_to_dict(row)})


@bp.route("/api/committee-protocols/<document_id>/content")
def get_committee_protocol_content(document_id):
    path = _get_protocol_path(document_id, "committee")
    if not path:
        return jsonify({"error": "Committee protocol not found"}), 404
    text = extract_text(path)
    if not text:
        return jsonify({"error": "Content not available"}), 404
    return jsonify({"documentId": document_id, "content": text})


@bp.route("/api/committee-protocols/<document_id>/download")
def download_committee_protocol(document_id):
    import os
    path = _get_protocol_path(document_id, "committee")
    if not path or not os.path.exists(path):
        return jsonify({"error": "Committee protocol file not found"}), 404
    ext = os.path.splitext(path)[1]
    return send_file(path, as_attachment=True, download_name=f"{document_id}{ext}")
