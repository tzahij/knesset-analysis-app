import logging
logger = logging.getLogger(__name__)

import os
import json
import re
from datetime import datetime, timedelta
import requests
import concurrent.futures
import sys
from psycopg2.extras import execute_batch

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.python.scrapers.member_registry import resolve_member_by_name

# Configuration Environment Variables
PYTHON_LAW_MATCH_MAX_DAYS = int(os.environ.get('PYTHON_LAW_MATCH_MAX_DAYS', 90))
SCRAPER_VOTES_TIMEOUT = int(os.environ.get('SCRAPER_VOTES_TIMEOUT', 30))
VOTES_SEARCH_WINDOW_DAYS_BEFORE = int(os.environ.get('VOTES_SEARCH_WINDOW_DAYS_BEFORE', 21))
VOTES_SEARCH_WINDOW_DAYS_AFTER = int(os.environ.get('VOTES_SEARCH_WINDOW_DAYS_AFTER', 7))
CONCURRENT_VOTES_WORKERS = int(os.environ.get('CONCURRENT_VOTES_WORKERS', 5))


VOTES_API_BASE_URL = "https://knesset.gov.il/WebSiteApi/knessetapi/Votes"
PRINT_API_BASE_URL = "https://knesset.gov.il/WebSiteApi/knessetapi/PrintPdf"
LAW_VOTE_CACHE_VERSION = 1
LAW_MATCH_MAX_DAYS = PYTHON_LAW_MATCH_MAX_DAYS

def normalize_search_text(value):
    val = str(value or "")
    val = re.sub(r'[\u0591-\u05C7]', '', val) # remove niqqud
    val = re.sub(r'[^\w\sא-ת]', ' ', val)
    return re.sub(r'\s+', ' ', val).strip()

def normalize_vote_title(value):
    val = str(value or "")
    val = re.sub(r'[“”„‟"׳״\']', '', val)
    val = re.sub(r'[–—−]', '-', val)
    return normalize_search_text(val)

def parse_date_value(value):
    if not value: return None
    try:
        if "T" in value:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        return datetime.strptime(value.split(" ")[0], "%Y-%m-%d")
    except:
        return None

def is_third_reading_acceptance(vote_record):
    decision = vote_record.get("decision", "")
    accepted = vote_record.get("acceptedText", "")
    text = f"{decision} {accepted}"
    if not re.search(r'קריאה\s+שלישית', text):
        return False
    if re.search(r'להכנה\s+לקריאה', text):
        return False
    return True

class VotesLoader:
    def __init__(self, conn):
        self.conn = conn
        self.headers = {"User-Agent": "Mozilla/5.0 Codex", "Content-Type": "application/json;charset=UTF-8"}

    def fetch_vote_headers(self, search_window):
        body = {"SearchType": 2, "FromDate": search_window["fromDate"], "ToDate": search_window["toDate"]}
        try:
            resp = requests.post(f"{VOTES_API_BASE_URL}/GetVotesHeaders", json=body, headers=self.headers, timeout=SCRAPER_VOTES_TIMEOUT)
            if resp.status_code == 200:
                payload = resp.json()
                return payload.get("Table", [])
        except Exception as e:
            logger.error(f"Error fetching vote headers: {e}")
        return []

    def fetch_vote_details(self, vote_id):
        try:
            resp = requests.get(f"{VOTES_API_BASE_URL}/GetVoteDetails/{vote_id}", headers=self.headers, timeout=int(os.environ.get('SCRAPER_VOTES_TIMEOUT', 20)))
            if resp.status_code == 200:
                return resp.json()
        except:
            pass
        return None

    def build_vote_record(self, payload, vote_id, header):
        vote_header = payload.get("VoteHeader", [{}])[0] if payload.get("VoteHeader") else {}
        groups = {"for": [], "against": [], "abstained": [], "present": [], "other": []}
        
        for detail in payload.get("VoteDetails", []):
            title = str(detail.get("Title", "")).strip()
            bucket = "other"
            if "בעד" in title: bucket = "for"
            elif "נגד" in title: bucket = "against"
            elif "נמנע" in title: bucket = "abstained"
            elif "נוכח" in title: bucket = "present"
            
            groups[bucket].append({
                "rawName": detail.get("MkName", ""),
                "displayName": detail.get("MkName", ""),
                "partyName": detail.get("FactionName", ""),
                "resultTitle": title,
                "resultId": detail.get("VoteResultId")
            })
            
        counters = []
        for c in payload.get("VoteCounters", []):
            counters.append({
                "title": c.get("Title", ""),
                "count": c.get("countOfResult", 0),
                "order": c.get("rn"),
                "colorName": c.get("ColorName", "")
            })
            
        return {
            "voteId": str(vote_id),
            "voteDate": vote_header.get("VoteDate", header.get("VoteDate")),
            "itemTitle": vote_header.get("ItemTitle", header.get("ItemTitle")),
            "decision": vote_header.get("Decision", ""),
            "acceptedText": vote_header.get("AcceptedText", ""),
            "chairmanName": vote_header.get("ChairmanName", ""),
            "sessionNumber": vote_header.get("SessionNumber"),
            "isForAccepted": bool(vote_header.get("IsForAccepted")),
            "counters": counters,
            "groups": groups,
            "fetchedAt": datetime.utcnow().isoformat() + "Z"
        }

    def process_law(self, law, headers_by_title, detail_cache):
        normalized_title = normalize_vote_title(law.get("title"))
        law_date = parse_date_value(law.get("publicationDate"))
        candidates = headers_by_title.get(normalized_title, [])
        
        valid_candidates = []
        for h in candidates:
            h_date = parse_date_value(h.get("VoteDate"))
            if h_date and law_date and abs((h_date - law_date).days) <= LAW_MATCH_MAX_DAYS:
                valid_candidates.append(h)
                
        if not valid_candidates:
            return {
                "billId": str(law.get("billId")),
                "lawTitle": law.get("title"),
                "status": "unmatched",
                "matchedAt": datetime.utcnow().isoformat() + "Z"
            }
            
        accepted_votes = []
        for header in valid_candidates:
            vote_id = str(header.get("VoteId"))
            if vote_id not in detail_cache:
                payload = self.fetch_vote_details(vote_id)
                if payload:
                    detail_cache[vote_id] = self.build_vote_record(payload, vote_id, header)
            
            record = detail_cache.get(vote_id)
            if record and is_third_reading_acceptance(record):
                accepted_votes.append((header, record))
                
        if not accepted_votes:
            return {
                "billId": str(law.get("billId")),
                "lawTitle": law.get("title"),
                "status": "unmatched",
                "matchedAt": datetime.utcnow().isoformat() + "Z"
            }
            
        accepted_votes.sort(key=lambda x: parse_date_value(x[0].get("VoteDate")) or datetime.min, reverse=True)
        return {
            "billId": str(law.get("billId")),
            "lawTitle": law.get("title"),
            "status": "matched",
            "matchedAt": datetime.utcnow().isoformat() + "Z",
            "vote": accepted_votes[0][1],
            "cacheKey": f"{law.get('billId')}::{law.get('publicationDate','')}::{normalized_title}"
        }

    def sync_votes(self, executor):
        logger.info("Starting Votes sync...")
        
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT slug FROM member")
                valid_slugs = {r[0] for r in cur.fetchall()}
                
                # Only check laws that haven't been successfully matched or definitively unmatched
                cur.execute("SELECT bill_id, title, publication_date FROM law WHERE vote_match_status = 'pending'")
                rows = cur.fetchall()
            laws = [{"billId": str(r[0]), "title": r[1], "publicationDate": str(r[2]) if r[2] else None} for r in rows]
        except Exception as e:
            logger.error(f"Error loading laws from DB: {e}")
            return
            
        if not laws:
            logger.info("Empty laws in DB, skipping votes.")
            return
            
        pub_dates = [parse_date_value(l.get("publicationDate")) for l in laws]
        pub_dates = [d for d in pub_dates if d]
        
        if not pub_dates:
            return
            
        min_date = min(pub_dates)
        max_date = max(pub_dates)
        search_window = {
            "fromDate": (min_date - timedelta(days=VOTES_SEARCH_WINDOW_DAYS_BEFORE)).strftime("%Y-%m-%d"),
            "toDate": (max_date + timedelta(days=VOTES_SEARCH_WINDOW_DAYS_AFTER)).strftime("%Y-%m-%d")
        }
        
        raw_headers = self.fetch_vote_headers(search_window)
        headers_by_title = {}
        for h in raw_headers:
            title = normalize_vote_title(h.get("ItemTitle"))
            if title not in headers_by_title:
                headers_by_title[title] = []
            headers_by_title[title].append(h)
            
        detail_cache = {}
        
        logger.info(f"Found {len(laws)} laws needing vote resolution.")
        
        def run_law(law):
            return self.process_law(law, headers_by_title, detail_cache)
            
        results = []
        # Uses the passed-in global ThreadPoolExecutor
        futures = {executor.submit(run_law, law): law for law in laws}
        for future in concurrent.futures.as_completed(futures):
            try:
                res = future.result()
                if res:
                    results.append(res)
            except Exception as e:
                logger.error(f"Error processing law for votes: {e}")
            
        # Save to DB
        vote_events_to_insert = []
        vote_records_to_insert = []
        laws_to_update = []
        
        for res in results:
            laws_to_update.append((res.get("status", "pending"), res.get("billId")))
            
            if res.get("status") != "matched": continue
            vote = res.get("vote")
            if not vote: continue
            
            vote_id = vote.get("voteId")
            vote_date = parse_date_value(vote.get("voteDate"))
            if not vote_date: continue
            
            vote_events_to_insert.append((
                vote_id, str(res["billId"]), vote.get("itemTitle"), vote.get("decision"), vote.get("acceptedText"),
                vote.get("chairmanName"), vote.get("sessionNumber"), vote.get("isForAccepted"), vote_date
            ))
            
            groups = vote.get("groups", {})
            for vote_type, mk_list in groups.items():
                if vote_type not in ["for", "against", "abstained", "present"]: continue
                for mk in mk_list:
                    raw_name = mk.get("displayName") or mk.get("rawName")
                    if not raw_name: continue
                    
                    member = resolve_member_by_name(raw_name)
                    if member:
                        slug = member.get('routeSlug', member.get('id', member['slug']))
                        if slug in valid_slugs:
                            vote_records_to_insert.append((vote_id, slug, vote_type))

        try:
            with self.conn.cursor() as cur:
                if vote_events_to_insert:
                    execute_batch(cur, """
                        INSERT INTO vote_event (vote_id, bill_id, item_title, decision, accepted_text, chairman_name, session_number, is_for_accepted, vote_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (vote_id) DO NOTHING
                    """, vote_events_to_insert)
                
                if vote_records_to_insert:
                    execute_batch(cur, """
                        INSERT INTO vote_record (vote_id, member_slug, vote_type)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (vote_id, member_slug) DO UPDATE SET vote_type = EXCLUDED.vote_type
                    """, vote_records_to_insert)
                
                if laws_to_update:
                    execute_batch(cur,
                        "UPDATE law SET vote_match_status = %s WHERE bill_id = %s",
                        laws_to_update
                    )
            
            self.conn.commit()
            logger.info("Saved votes to database.")
            
        except Exception as e:
            logger.error(f"Database error while saving votes: {e}")

        logger.info(f"Finished Votes sync. Matched {len([r for r in results if r.get('status') == 'matched'])} new laws.")

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    conn = get_db_connection()
    try:
        loader = VotesLoader(conn)
        with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_VOTES_WORKERS) as executor:
            loader.sync_votes(executor)
    finally:
        conn.close()
