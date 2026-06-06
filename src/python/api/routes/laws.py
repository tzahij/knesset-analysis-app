import logging
import os
from flask import Blueprint, jsonify, request, send_file
from src.python.data.database import get_db_connection, release_db_connection


# Configuration Environment Variables
PYTHON_API_LAW_PAGE_SIZE = int(os.environ.get('PYTHON_API_LAW_PAGE_SIZE', 50))


bp = Blueprint("laws", __name__)
logger = logging.getLogger(__name__)

PAGE_SIZE = PYTHON_API_LAW_PAGE_SIZE


def _law_row_to_dict(row):
    keys = [
        "billId", "title", "publicationDate", "knessetNumber", "status",
        "voteMatchStatus", "fileType", "url", "fetchedAt",
        "analysisSummary", "summaryLaw", "analysisModel",
    ]
    d = dict(zip(keys, row))
    if d.get("publicationDate"):
        d["publicationDate"] = d["publicationDate"].isoformat()
    if d.get("fetchedAt"):
        d["fetchedAt"] = d["fetchedAt"].isoformat()
        
    d["hasOfficialPdf"] = d.get("fileType") == "pdf"
    d["hasWordDocument"] = d.get("fileType") in ("doc", "docx")
    
    d["statusDesc"] = None
    d["publicationSeriesDesc"] = "ספר החוקים"
    d["lawId"] = d.get("knessetNumber")
    
    return d

LAW_AXIS_DEFINITIONS = [
    {"key": "religiousSecular", "label": "דתי מול חילוני", "lowLabel": "חילוני", "highLabel": "דתי"},
    {"key": "socialismCapitalism", "label": "סוציאליזם מול קפיטליזם", "lowLabel": "סוציאליסטי", "highLabel": "קפיטליסטי"},
    {"key": "doveHawk", "label": "יוני מול נצי", "lowLabel": "יוני", "highLabel": "נצי"},
    {"key": "liberalDemocracyAuthoritarianism", "label": "דמוקרטיה ליברלית מול סמכותנות", "lowLabel": "דמוקרטיה ליברלית", "highLabel": "סמכותנות"},
]

MEMBER_AXIS_MAPPING = {
    "religiousSecular": "religiousVsSecular",
    "socialismCapitalism": "socialismVsCapitalism",
    "doveHawk": "dovishVsHawkish",
    "liberalDemocracyAuthoritarianism": "liberalDemocracyVsAuthoritarianism"
}

def _compute_surprise_diffs(law_analysis, member_analysis):
    all_axis_diffs = []
    surprise_axes = []
    max_diff = 0
    
    if not law_analysis or not member_analysis:
        return max_diff, all_axis_diffs, surprise_axes
        
    law_scores = law_analysis if isinstance(law_analysis, dict) else {}
    member_scores = member_analysis.get('quantitativeAnalysis', {}).get('textBased', {}) if isinstance(member_analysis, dict) else {}
    
    for axis in LAW_AXIS_DEFINITIONS:
        law_key = axis["key"]
        member_key = MEMBER_AXIS_MAPPING.get(law_key)
        
        law_score_obj = law_scores.get(law_key)
        mem_score_obj = member_scores.get(member_key)
        
        if not law_score_obj or not mem_score_obj:
            continue
            
        l_score = law_score_obj.get("score")
        m_score = mem_score_obj.get("score")
        
        if l_score is None or m_score is None:
            continue
            
        diff = abs(int(l_score) - int(m_score))
        if diff > max_diff:
            max_diff = diff
            
        axis_diff_obj = {
            "key": law_key,
            "label": axis["label"],
            "lowLabel": axis["lowLabel"],
            "highLabel": axis["highLabel"],
            "lawScore": l_score,
            "memberScore": m_score,
            "difference": diff
        }
        all_axis_diffs.append(axis_diff_obj)
        if diff >= 7:
            surprise_axes.append(axis_diff_obj)
            
    return max_diff, all_axis_diffs, surprise_axes


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

            cur.execute(f"""
                SELECT l.bill_id, l.title, l.publication_date, l.knesset_number, l.status,
                       l.vote_match_status, f.file_type, l.url, l.fetched_at,
                       l.analysis_summary, l.summary_law, l.analysis_model
                FROM law l
                LEFT JOIN file f ON f.id = l.bill_id AND f.entity_type = 'L'
                {where.replace('publication_date', 'l.publication_date')}
                ORDER BY l.publication_date DESC
            """, params)
            laws = [_law_row_to_dict(r) for r in cur.fetchall()]

            # Available years
            cur.execute("SELECT DISTINCT EXTRACT(YEAR FROM publication_date)::int FROM law ORDER BY 1 DESC")
            years = [r[0] for r in cur.fetchall()]
            
            # Last sync date
            cur.execute("SELECT MAX(fetched_at) FROM law")
            max_fetched = cur.fetchone()[0]
            synced_at = max_fetched.isoformat() if max_fetched else None

        return jsonify({
            "items": laws,
            "total": total,
            "page": 1,
            "pageSize": len(laws),
            "years": years,
            "metadata": {
                "syncedAt": synced_at
            }
        })
    except Exception as e:
        logger.error(f"GET /api/laws error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/surprising-votes")
def laws_surprising_votes():
    year = request.args.get("year", type=int)
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            where_clause = "WHERE EXTRACT(YEAR FROM l.publication_date) = %s" if year else ""
            params = [year] if year else []
            
            cur.execute(f"""
                SELECT l.bill_id, l.title, l.publication_date, l.knesset_number, l.status,
                       l.vote_match_status, f.file_type, l.url, l.fetched_at,
                       l.analysis_summary, l.summary_law, l.analysis_model,
                       COUNT(lse.member_slug) as surprisingVoteCount,
                       json_agg(json_build_object('memberName', m.name, 'routeSlug', m.slug, 'partyName', p.name, 'memberAnalysis', ma.analysis_summary)) as surprisingMembersList
                FROM law l
                LEFT JOIN file f ON f.id = l.bill_id AND f.entity_type = 'L'
                JOIN law_surprise_explanation lse ON lse.bill_id = l.bill_id
                JOIN member m ON m.slug = lse.member_slug
                LEFT JOIN party p ON p.id = m.party_id
                LEFT JOIN member_analysis ma ON ma.member_slug = lse.member_slug
                {where_clause}
                GROUP BY l.bill_id, f.file_type
                ORDER BY l.publication_date DESC NULLS LAST
            """, params)
            
            laws = []
            total_surprising_votes = 0
            for r in cur.fetchall():
                # Extract law basic dict (first 13 columns match _law_row_to_dict)
                d = _law_row_to_dict(r[:12])
                d["surprisingVoteCount"] = r[12]
                
                members_list = r[13] or []
                top_members = []
                max_law_diff = 0
                
                for m_obj in members_list:
                    mem_analysis = m_obj.get("memberAnalysis")
                    max_diff, _, _ = _compute_surprise_diffs(d.get("analysisSummary"), mem_analysis)
                    
                    if max_diff > max_law_diff:
                        max_law_diff = max_diff
                        
                    top_members.append({
                        "memberName": m_obj.get("memberName"),
                        "partyName": m_obj.get("partyName"),
                        "routeSlug": m_obj.get("routeSlug"),
                        "maximumDifference": max_diff
                    })
                
                top_members.sort(key=lambda x: x["maximumDifference"], reverse=True)
                d["topSurprisingMembers"] = top_members[:3]
                d["maximumDifference"] = max_law_diff
                total_surprising_votes += r[12]
                laws.append(d)

        return jsonify({
            "items": laws,
            "summary": {
                "lawsWithSurprisingVotes": len(laws),
                "totalSurprisingVotes": total_surprising_votes
            }
        })
    except Exception as e:
        logger.error(f"GET /api/laws/surprising-votes error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>")
def get_law(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT l.bill_id, l.title, l.publication_date, l.knesset_number, l.status,
                       l.vote_match_status, f.file_type, l.url, l.fetched_at,
                       l.analysis_summary, l.summary_law, l.analysis_model
                FROM law l
                LEFT JOIN file f ON f.id = l.bill_id AND f.entity_type = 'L'
                WHERE l.bill_id = %s
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
                       vr.vote_type, ma.analysis_summary
                FROM law_surprise_explanation lse
                JOIN member m ON m.slug = lse.member_slug
                LEFT JOIN party p ON p.id = m.party_id
                LEFT JOIN vote_event ve ON ve.bill_id = lse.bill_id
                LEFT JOIN vote_record vr ON vr.vote_id = ve.vote_id
                    AND vr.member_slug = lse.member_slug
                LEFT JOIN member_analysis ma ON ma.member_slug = lse.member_slug
                WHERE lse.bill_id = %s
            """, (bill_id,))
            surprising_votes = []
            for r in cur.fetchall():
                member_slug, member_name, party_name, explanation, vote_label, member_analysis = r
                
                max_diff, all_axis_diffs, surprise_axes = _compute_surprise_diffs(analysis, member_analysis)
                
                surprising_votes.append({
                    "routeSlug": member_slug,
                    "memberName": member_name,
                    "partyName": party_name,
                    "voteLabel": vote_label,
                    "explanationRecord": {
                        "status": {"status": "success"},
                        "explanation": explanation.get("explanation") if isinstance(explanation, dict) else explanation
                    },
                    "maximumDifference": max_diff,
                    "allAxisDiffs": all_axis_diffs,
                    "surpriseAxes": surprise_axes
                })

        return jsonify({
            "billId": bill_id_db,
            "title": title,
            "analysis": analysis,
            "analysisModel": model,
            "status": status,
            "surprisingVotes": {
                "summary": {
                    "consideredSupportVotes": 0,
                    "surprisingSupportVotes": len(surprising_votes),
                    "skippedMissingMemberAnalysis": 0,
                    "skippedLowVoteCoverage": 0
                },
                "methodology": [],
                "surprisingVotes": surprising_votes,
                "threshold": 0
            },
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

            if not events:
                return jsonify({"billId": bill_id, "title": law_row[0], "votes": {"status": "not_found"}})

            accepted_events = [e for e in events if e[6]]
            event = accepted_events[0] if accepted_events else events[0]
            
            vote_id, item_title, decision, accepted_text, chairman, session_num, is_for_accepted, vote_date = event

            cur.execute("""
                SELECT vr.member_slug, m.name, p.name, vr.vote_type
                FROM vote_record vr
                JOIN member m ON m.slug = vr.member_slug
                LEFT JOIN party p ON p.id = m.party_id
                WHERE vr.vote_id = %s
                ORDER BY vr.vote_type, m.name
            """, (vote_id,))
            
            groups = {"for": [], "against": [], "abstained": [], "present": []}
            counters_dict = {"for": 0, "against": 0, "abstained": 0, "present": 0}
            
            for r in cur.fetchall():
                v_type = r[3]
                if v_type not in groups:
                    groups[v_type] = []
                groups[v_type].append({
                    "routeSlug": r[0],
                    "displayName": r[1],
                    "partyName": r[2],
                    "voteType": v_type
                })
                counters_dict[v_type] = counters_dict.get(v_type, 0) + 1
                
            counters_list = [
                {"title": "בעד", "count": counters_dict.get("for", 0)},
                {"title": "נגד", "count": counters_dict.get("against", 0)},
                {"title": "נמנעו", "count": counters_dict.get("abstained", 0)}
            ]
            
            vote_obj = {
                "voteId": vote_id,
                "itemTitle": item_title,
                "decision": decision,
                "acceptedText": accepted_text,
                "chairmanName": chairman,
                "sessionNumber": session_num,
                "voteDateStr": vote_date.strftime("%d/%m/%Y") if vote_date else "",
                "voteTimeStr": vote_date.strftime("%H:%M") if vote_date else "",
                "voteType": "קריאה שלישית" if is_for_accepted else "הצבעה",
                "groups": groups,
                "counters": counters_list
            }

            return jsonify({"billId": bill_id, "title": law_row[0], "votes": {"status": "matched", "vote": vote_obj}})
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
            cur.execute("""
                SELECT l.bill_id, l.title, l.publication_date, l.knesset_number, l.status,
                       l.vote_match_status, f.file_type, l.url, l.fetched_at,
                       l.analysis_summary, l.summary_law, l.analysis_model
                FROM law l
                LEFT JOIN file f ON f.id = l.bill_id AND f.entity_type = 'L'
                WHERE l.bill_id = %s
            """, (bill_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found"}), 404
                
            law_dict = _law_row_to_dict(row[:12])
            file_type = row[6] # file_type
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)

    parse_error = None
    paragraphs = []
        
    summary_law = law_dict.get("summaryLaw", "")
    if summary_law:
        import re
        summary_paragraphs = [p.strip() for p in re.split(r'\n{2,}', summary_law) if p.strip()]
    else:
        summary_paragraphs = []

    return jsonify({
        "law": law_dict,
        "hasReadableText": bool(paragraphs),
        "availableDownloads": {
            "pdf": file_type == "pdf",
            "word": file_type in ("doc", "docx"),
        },
        "summaryParagraphs": summary_paragraphs,
        "paragraphs": paragraphs,
        "parseError": parse_error
    })


@bp.route("/api/laws/<bill_id>/fetch")
def fetch_law(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT parsed_text FROM law WHERE bill_id = %s",
                (bill_id,)
            )
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found in database"}), 404
            parsed_text = row[0]
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)

    if not parsed_text:
        return jsonify({"error": "Text not available in database"}), 404

    return jsonify({"text": parsed_text})

@bp.route("/api/laws/<bill_id>/download")
def download_law(bill_id):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT f.file, f.file_type, l.url 
                FROM law l 
                LEFT JOIN file f ON f.id = l.bill_id AND f.entity_type = 'L' 
                WHERE l.bill_id = %s
            """, (bill_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Law not found"}), 404
            
            file_blob, p_file_type, url = row
            if not file_blob:
                return jsonify({"error": "File not found on server"}), 404
                
            import io
            return send_file(
                io.BytesIO(file_blob),
                as_attachment=(p_file_type and p_file_type.lower() != "pdf"),
                download_name=f"law_{bill_id}.{p_file_type or 'pdf'}"
            )
    except Exception as e:
        logger.error(f"GET /api/laws/{bill_id}/download error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)


@bp.route("/api/laws/<bill_id>/surprising-votes/<member_slug>/explanation", methods=["GET", "POST"])
def law_surprising_vote_explanation(bill_id, member_slug):
    if request.method == "POST":
        return jsonify({"status": "not_available", "message": "This action is handled by the batch pipeline."}), 200
        
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT l.bill_id, l.title, m.slug, m.name, p.name as party_name, e.explanation, e.created_at
                FROM law l
                JOIN member m ON m.slug = %s
                LEFT JOIN party p ON m.party_id = p.id
                LEFT JOIN law_surprise_explanation e ON e.bill_id = l.bill_id AND e.member_slug = m.slug
                WHERE l.bill_id = %s
            """, (member_slug, bill_id))
            row = cur.fetchone()
            
        if not row:
            return jsonify({"error": "Law or member not found"}), 404
            
        b_id, title, slug, member_name, party_name, explanation, created_at = row
        
        status_obj = {
            "status": "completed" if explanation else "not_surprising",
            "generatedAt": created_at.isoformat() if created_at else None
        }
            
        return jsonify({
            "explanation": explanation,
            "law": {"billId": b_id, "title": title},
            "member": {"slug": slug, "name": member_name, "partyName": party_name},
            "status": status_obj
        })
    except Exception as e:
        logger.error(f"GET /api/laws/{bill_id}/surprising-votes/{member_slug}/explanation error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        release_db_connection(conn)
