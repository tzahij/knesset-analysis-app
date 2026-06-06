"""
Stub endpoints for legacy JS-frontend calls that we've retired.
These return a safe no-op response so the UI degrades gracefully
instead of showing an error spinner.
"""
import logging
from flask import Blueprint, jsonify

bp = Blueprint("stubs", __name__)
logger = logging.getLogger(__name__)

# --- Auth (no-op: no auth required anymore) ---

@bp.route("/api/auth/session")
def auth_session():
    return jsonify({"authenticated": False, "role": None})


@bp.route("/api/auth/login", methods=["POST"])
def auth_login():
    return jsonify({"ok": False, "message": "Auth not required"}), 200


@bp.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    return jsonify({"ok": True})


# --- Admin triggers (replaced by batch pipeline) ---

_ADMIN_STUB = {"status": "not_available", "message": "This action is handled by the batch pipeline."}


@bp.route("/api/admin/<path:subpath>", methods=["GET", "POST"])
def admin_stub(subpath):
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/laws/refresh-status")
def laws_refresh_status():
    return jsonify({"status": "idle"})


@bp.route("/api/laws/refresh-all", methods=["POST"])
def laws_refresh_all():
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/laws/analysis/status")
def laws_analysis_status():
    return jsonify({"status": "idle"})


@bp.route("/api/laws/analysis/bulk", methods=["POST"])
def laws_analysis_bulk():
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/check-updates", methods=["POST"])
def check_updates():
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/download-all", methods=["GET", "POST"])
def download_all():
    return jsonify({"status": "idle"})


@bp.route("/api/download-all/status")
def download_all_status():
    return jsonify({"status": "idle"})


@bp.route("/api/committee-download-all", methods=["GET", "POST"])
def committee_download_all():
    return jsonify({"status": "idle"})


@bp.route("/api/committee-download-all/status")
def committee_download_all_status():
    return jsonify({"status": "idle"})


@bp.route("/api/members/utterance-files/bulk", methods=["POST"])
def members_utterance_files_bulk():
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/members/analyses/bulk", methods=["POST"])
def members_analyses_bulk():
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/members/<slug>/analysis", methods=["POST"])
def member_analysis_trigger(slug):
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/members/<slug>/utterance-file", methods=["POST"])
def member_utterance_file_trigger(slug):
    return jsonify(_ADMIN_STUB), 200


@bp.route("/api/members/<slug>/contact-report", methods=["POST"])
def member_contact_report(slug):
    return jsonify({"ok": True})


# --- Methodology (not yet ported) ---

@bp.route("/api/methodology")
def methodology():
    from datetime import datetime
    from dateutil.relativedelta import relativedelta
    since_date = (datetime.now() - relativedelta(years=1)).strftime("%Y-%m-%d")
    return jsonify({
        "sinceDate": since_date,
        "note": "Methodology endpoint not yet ported to Python.",
    })


@bp.route("/api/methodology/member-quote-files")
def methodology_member_quote_files():
    return jsonify({"items": []})


@bp.route("/api/methodology/recreate", methods=["POST"])
def methodology_recreate():
    return jsonify(_ADMIN_STUB), 200


# --- Fact-checks (not yet ported) ---

@bp.route("/api/fact-checks/status")
def fact_checks_status():
    return jsonify({"status": "idle", "items": []})


@bp.route("/api/fact-checks/process-new", methods=["POST"])
def fact_checks_process_new():
    return jsonify(_ADMIN_STUB), 200








def request_is_post():
    from flask import request as req
    return req.method == "POST"


# --- Member comparisons ---

@bp.route("/api/member-comparisons")
def member_comparisons():
    return jsonify({"items": []})
