"""
Page routes — serve the correct HTML file for each frontend URL path.
This is a multi-page app; each route returns its own HTML file.
"""
import os
import logging
from flask import Blueprint, send_from_directory, redirect

bp = Blueprint("pages", __name__)
logger = logging.getLogger(__name__)

# Resolve public dir relative to this file's location
_public = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "public")
)


def _page(filename):
    return send_from_directory(_public, filename)


# ---------- Main nav pages ----------

@bp.route("/members")
def members_page():
    return _page("members.html")


@bp.route("/members/<slug>")
def member_page(slug):
    return _page("member.html")


@bp.route("/know-your-mk")
def know_your_mk_page():
    return _page("know-your-mk.html")


@bp.route("/talk-to-your-representatives")
def talk_page():
    return _page("talk-to-your-representatives.html")


@bp.route("/comparisons")
def comparisons_page():
    return _page("comparisons.html")


@bp.route("/how-we-know")
def how_we_know_page():
    return _page("how-we-know.html")


# ---------- Protocol explorer pages ----------

@bp.route("/plenum")
def plenum_page():
    return _page("explorer.html")


@bp.route("/committees")
def committees_page():
    return _page("explorer.html")


@bp.route("/laws")
def laws_page():
    return _page("explorer.html")


@bp.route("/surprising-votes")
def surprising_votes_page():
    return _page("explorer.html")


@bp.route("/protocol/<document_id>")
def protocol_page(document_id):
    return _page("protocol.html")


@bp.route("/committee-protocol/<document_id>")
def committee_protocol_page(document_id):
    return _page("protocol.html")


# ---------- Law pages ----------

@bp.route("/law/<path:bill_id>")
def law_page(bill_id):
    # Strip /surprising-votes/... sub-paths to still serve law.html
    return _page("law.html")


@bp.route("/law/<path:bill_id>/surprising-votes/<member_slug>/explanation/view")
def law_surprise_explanation_view(bill_id, member_slug):
    return _page("law-surprise-explanation.html")


# ---------- Misc ----------

@bp.route("/fact-checks")
def fact_checks_page():
    return redirect("/")
