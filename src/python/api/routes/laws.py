import logging
from flask import Blueprint, jsonify, request, send_file
from src.python.data.database import get_db_connection, release_db_connection
from src.python.utils.file_reader import extract_text

bp = Blueprint("laws", __name__)
logger = logging.getLogger(__name__)

PAGE_SIZE = 50


def _law_row_to_dict(row):
    keys = [
        "billId", "title", "publicationDate", "knessetNumber", "status",
        "voteMatchStatus", "fileType", "url", "localFilePath", "fetchedAt",
        "analysisSummary", "summaryLaw", "analysisModel",
    ]
    d = dict(zip(keys, row))
    if d.get("publicationDate"):
        d["publicationDate"] = d["publicationDate"].isoformat()
    if d.get("fetchedAt"):
        d["fetchedAt"] = d["fetchedAt"].isoformat()
    # Don't expose filesystem paths to clients
    d.pop("localFilePath", None)
    return d


@bp.route("/api/laws")
def get_laws():
    year = request.args.get("year", type=int)
    page = max(1, request.args.get("page", 1, type=int))
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            where = "WHERE EXTRACT(YEAR FROM publication_date) = %s" if year else ""
            params = [year] if year else []

            cur.execute(f"SELECT COUNT(*) FROM law {where}", params)
            total = cur.fetchone()[0]

            params_paged = params + [PAGE_SIZE, (page - 1) * PAGE_SIZE]
            cur.execute(f"""
                SELECT bill_id, title, publication_date, knesset_number, status,
                       vote_match_status, file_type, url, local_file_path, fetched_at,
                       analysis_summary, summary_law, analysis_model
                FROM law {where}
                ORDER BY publication_date DESC
                LIMIT %s OFFSET %s
            """, params_paged)
            laws = [_law_row_to_dict(r) for r in cur.fetchall()]

            # Available years
            cur.execute("SELECT DISTINCT EXTRACT(YEAR FROM publication_date)::int FROM law ORDER BY 1 DESC")
            years = [r[0] for r in cur.fetchall()]

        return jsonify({
            "items": laws,
            "total": total,
            "page": page,
            "pageSize": PAGE_SIZE,
            "years": years,
        })
    except Exception as e:
        logger.error(f"GET /api/laws error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>")
def get_law(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT bill_id, title, publication_date, knesset_number, status,
                       vote_match_status, file_type, url, local_file_path, fetched_at,
                       analysis_summary, summary_law, analysis_model
                FROM law WHERE bill_id = %s
            """, (bill_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found"}), 404
        return jsonify({"law": _law_row_to_dict(row)})
    except Exception as e:
        logger.error(f"GET /api/laws/{bill_id} error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>/analysis")
def get_law_analysis(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT bill_id, title, analysis_summary, analysis_model, status
                FROM law WHERE bill_id = %s
            """, (bill_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found"}), 404

            bill_id_db, title, analysis, model, status = row

            # Surprising votes for this law
            cur.execute("""
                SELECT lse.member_slug, m.name, p.name, lse.explanation,
                       vr.vote_type
                FROM law_surprise_explanation lse
                JOIN member m ON m.slug = lse.member_slug
                LEFT JOIN party p ON p.id = m.party_id
                LEFT JOIN vote_event ve ON ve.bill_id = lse.bill_id
                LEFT JOIN vote_record vr ON vr.vote_id = ve.vote_id
                    AND vr.member_slug = lse.member_slug
                WHERE lse.bill_id = %s
            """, (bill_id,))
            surprising_votes = [
                {
                    "memberSlug": r[0],
                    "memberName": r[1],
                    "partyName": r[2],
                    "explanation": r[3],
                    "voteType": r[4],
                }
                for r in cur.fetchall()
            ]

        return jsonify({
            "billId": bill_id_db,
            "title": title,
            "analysis": analysis,
            "analysisModel": model,
            "status": status,
            "surprisingVotes": surprising_votes,
        })
    except Exception as e:
        logger.error(f"GET /api/laws/{bill_id}/analysis error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>/votes")
def get_law_votes(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # Check law exists
            cur.execute("SELECT title FROM law WHERE bill_id = %s", (bill_id,))
            law_row = cur.fetchone()
            if not law_row:
                return jsonify({"error": "Law not found"}), 404

            cur.execute("""
                SELECT ve.vote_id, ve.item_title, ve.decision, ve.accepted_text,
                       ve.chairman_name, ve.session_number, ve.is_for_accepted,
                       ve.vote_date
                FROM vote_event ve
                WHERE ve.bill_id = %s
                ORDER BY ve.vote_date DESC
            """, (bill_id,))
            events = cur.fetchall()

            votes = []
            for (vote_id, item_title, decision, accepted_text,
                 chairman, session_num, is_for_accepted, vote_date) in events:
                cur.execute("""
                    SELECT vr.member_slug, m.name, p.name, vr.vote_type
                    FROM vote_record vr
                    JOIN member m ON m.slug = vr.member_slug
                    LEFT JOIN party p ON p.id = m.party_id
                    WHERE vr.vote_id = %s
                    ORDER BY vr.vote_type, m.name
                """, (vote_id,))
                records = [
                    {"memberSlug": r[0], "memberName": r[1], "partyName": r[2], "voteType": r[3]}
                    for r in cur.fetchall()
                ]
                votes.append({
                    "voteId": vote_id,
                    "itemTitle": item_title,
                    "decision": decision,
                    "acceptedText": accepted_text,
                    "chairmanName": chairman,
                    "sessionNumber": session_num,
                    "isForAccepted": is_for_accepted,
                    "voteDate": vote_date.isoformat() if vote_date else None,
                    "records": records,
                })

        return jsonify({"billId": bill_id, "title": law_row[0], "votes": votes})
    except Exception as e:
        logger.error(f"GET /api/laws/{bill_id}/votes error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>/content")
def get_law_content(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT title, local_file_path FROM law WHERE bill_id = %s", (bill_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found"}), 404
            title, path = row
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)

    text = extract_text(path)
    if not text:
        return jsonify({"error": "Content not available"}), 404
    return jsonify({"billId": bill_id, "title": title, "content": text})


@bp.route("/api/laws/<bill_id>/download")
def download_law(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            kind = request.args.get("kind", "pdf")
            cur.execute(
                "SELECT title, local_file_path, file_type FROM law WHERE bill_id = %s",
                (bill_id,)
            )
            row = cur.fetchone()
            if not row or not row[1]:
                return jsonify({"error": "Law file not found"}), 404
            title, path, _ = row
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)

    if not path or not __import__("os").path.exists(path):
        return jsonify({"error": "File not found on disk"}), 404

    import os
    ext = os.path.splitext(path)[1]
    download_name = f"{bill_id}{ext}"
    return send_file(path, as_attachment=True, download_name=download_name)
