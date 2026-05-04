from flask import Blueprint, jsonify

bp = Blueprint("health", __name__)


@bp.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "appId": "israeli-knesset-protocol-reader",
        "appName": "Israeli Knesset Analyzer",
    })
