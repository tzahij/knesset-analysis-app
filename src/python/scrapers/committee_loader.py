import os
import requests
import math
from datetime import datetime
from dateutil.relativedelta import relativedelta
import pytz
import sys

# Ensure we can import from the current directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import (
    format_date_parts,
    normalize_search_text,
    map_with_concurrency,
    download_file,
    sanitize_filename,
    ensure_directory,
    file_exists
)

ODATA_BASE_URL = "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentCommitteeSession"
GROUP_TYPE_ID = 23
PAGE_SIZE = 100
CONCURRENCY = 6

def normalize_file_url(file_url):
    url = str(file_url or "")
    return url.replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/")

def create_five_years_ago_start_date():
    date = datetime.now() - relativedelta(years=5)
    return date.replace(hour=0, minute=0, second=0, microsecond=0)

def normalize_committee_protocol_record(entry):
    session = entry.get("KNS_CommitteeSession") or {}
    committee = session.get("KNS_Committee") or {}
    start_date = session.get("StartDate")
    date_parts = format_date_parts(start_date)
    
    date_sort_value = 0
    if start_date:
        try:
            if start_date.startswith("/Date("):
                ts = int(start_date[6:-2]) / 1000.0
                date_sort_value = ts * 1000
            else:
                date_sort_value = datetime.fromisoformat(start_date.replace("Z", "+00:00")).timestamp() * 1000
        except:
            pass

    committee_name = committee.get("Name")
    title = f"{committee_name} - {date_parts['shortDateLabel']}" if committee_name else f"פרוטוקול ועדה - {date_parts['shortDateLabel']}"
    
    search_terms = [
        date_parts["dateKey"],
        date_parts["shortDateLabel"],
        date_parts["longDateLabel"],
        date_parts["timeLabel"],
        committee.get("Name", ""),
        committee.get("CategoryDesc", ""),
        committee.get("CommitteeTypeDesc", ""),
        committee.get("AdditionalTypeDesc", ""),
        session.get("TypeDesc", ""),
        str(session.get("Number", "")),
        str(session.get("KnessetNum", ""))
    ]
    
    return {
        "documentId": str(entry.get("DocumentCommitteeSessionID", "")),
        "committeeSessionId": str(session.get("CommitteeSessionID") or entry.get("CommitteeSessionID") or ""),
        "committeeId": str(committee.get("CommitteeID") or session.get("CommitteeID") or ""),
        "sessionNumber": session.get("Number"),
        "knessetNumber": session.get("KnessetNum"),
        "title": title,
        "startDate": start_date,
        "finishDate": session.get("FinishDate"),
        "fileUrl": normalize_file_url(entry.get("FilePath")),
        "applicationLabel": entry.get("ApplicationDesc") or "DOC",
        "groupTypeId": entry.get("GroupTypeID"),
        "groupTypeDescription": entry.get("GroupTypeDesc") or "",
        "lastUpdatedDate": entry.get("LastUpdatedDate"),
        "year": date_parts["year"],
        "dateKey": date_parts["dateKey"],
        "timeKey": date_parts["timeKey"],
        "shortDateLabel": date_parts["shortDateLabel"],
        "longDateLabel": date_parts["longDateLabel"],
        "timeLabel": date_parts["timeLabel"],
        "dateSortValue": date_sort_value,
        "committeeName": committee.get("Name") or "ועדה לא מזוהה",
        "committeeCategory": committee.get("CategoryDesc") or committee.get("Name") or "",
        "committeeTypeDescription": committee.get("CommitteeTypeDesc") or "סוג ועדה לא זמין",
        "committeeAdditionalTypeDescription": committee.get("AdditionalTypeDesc") or "",
        "sessionTypeDescription": session.get("TypeDesc") or "",
        "statusDescription": session.get("StatusDesc") or "",
        "location": session.get("Location") or "",
        "note": session.get("Note") or "",
        "searchText": normalize_search_text(" ".join([t for t in search_terms if t]))
    }

class CommitteeLoader:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.window_start = create_five_years_ago_start_date()
        date_str = self.window_start.strftime("%Y-%m-%dT00:00:00")
        self.window_start_literal = f"datetime'{date_str}'"

    def fetch_json(self, url):
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()

    def fetch_text(self, url):
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.text

    def get_latest_update_date(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(last_updated_date) FROM protocol WHERE source_type = 'committee'")
                row = cur.fetchone()
                if row and row[0]:
                    dt = row[0]
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=pytz.UTC)
                    return dt
        except Exception as e:
            print(f"Error fetching latest update date from DB: {e}")
        return None

    def fetch_protocol_count(self, filter_query):
        count_url = f"{ODATA_BASE_URL}/$count?$filter={filter_query}"
        raw_count = self.fetch_text(count_url)
        return int(raw_count)

    def fetch_protocols_metadata(self, conn):
        latest_date = self.get_latest_update_date(conn)
        
        filter_query = f"GroupTypeID eq {GROUP_TYPE_ID} and KNS_CommitteeSession/StartDate ge {self.window_start_literal}"
        
        if latest_date:
            date_str = latest_date.strftime("%Y-%m-%dT%H:%M:%S")
            filter_query += f" and LastUpdatedDate gt datetime'{date_str}'"
            print(f"Fetching committee updates since {date_str}...")
        else:
            print("Fetching all committee protocols from scratch (last 5 years)...")

        try:
            total = self.fetch_protocol_count(filter_query)
        except Exception as e:
            print(f"Error fetching count: {e}. Defaulting to 0 items to fetch.")
            total = 0

        print(f"Found {total} new or updated items.")
        
        if total == 0:
            return []

        page_count = math.ceil(total / PAGE_SIZE)
        page_indexes = list(range(page_count))

        def worker(page_index, idx):
            skip = page_index * PAGE_SIZE
            query = f"$filter={filter_query}&$expand=KNS_CommitteeSession,KNS_CommitteeSession/KNS_Committee&$top={PAGE_SIZE}&$skip={skip}&$format=json"
            page_url = f"{ODATA_BASE_URL}?{query}"
            data = self.fetch_json(page_url)
            
            items = data.get("value", [])
            return [normalize_committee_protocol_record(entry) for entry in items]

        pages = map_with_concurrency(page_indexes, CONCURRENCY, worker)
        
        # Flatten
        new_items = [item for page in pages for item in page]
        
        # Sort
        new_items.sort(key=lambda x: (x.get("dateSortValue", 0), int(x.get("documentId", 0))), reverse=True)
        
        return new_items

    def build_download_basename(self, protocol):
        segments = [protocol.get("dateKey")]
        if protocol.get("committeeName"):
            segments.append(protocol["committeeName"])
        if protocol.get("committeeTypeDescription"):
            segments.append(protocol["committeeTypeDescription"])
        segments.append(f"protocol-{protocol.get('documentId')}")
        return sanitize_filename("__".join([str(s) for s in segments if s]))

    def get_missing_items(self, items):
        # Items are ONLY the newly fetched items
        raw_dir = os.path.join(self.data_dir, "committee-raw")
        
        try:
            existing_files = set(os.listdir(raw_dir)) if os.path.exists(raw_dir) else set()
        except OSError:
            existing_files = set()
            
        missing = []
        cutoff_ts = (datetime.now().timestamp() - (5 * 365.25 * 24 * 3600)) * 1000
        
        for item in items:
            if item.get("dateSortValue", 0) < cutoff_ts:
                continue
            if not item.get("fileUrl"):
                continue
            doc_id = str(item["documentId"])
            if f"{doc_id}.json" not in existing_files:
                missing.append(item)
        return missing

    def ensure_protocol_file(self, protocol):
        raw_dir = os.path.join(self.data_dir, "committee-raw")
        ensure_directory(raw_dir)
        
        doc_id = str(protocol["documentId"])
        meta_path = os.path.join(raw_dir, f"{doc_id}.json")
        
        if not protocol.get("fileUrl"):
            return None

        temp_path = os.path.join(raw_dir, f"{doc_id}.tmp")
        try:
            format_info = download_file(protocol["fileUrl"], temp_path)
            
            extension = format_info["extension"]
            local_file_path = os.path.join(raw_dir, f"{doc_id}{extension}")
            
            if file_exists(local_file_path):
                os.remove(local_file_path)
            os.rename(temp_path, local_file_path)
            
            download_name = f"{self.build_download_basename(protocol)}{extension}"
            
            meta = {
                "documentId": doc_id,
                "originalUrl": protocol["fileUrl"],
                "localFilePath": local_file_path,
                "format": format_info["format"],
                "extension": extension,
                "contentType": format_info["contentType"],
                "downloadName": download_name,
                "savedAt": datetime.now(pytz.UTC).isoformat()
            }
            
            import json
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            return meta
        except Exception as e:
            if file_exists(temp_path):
                os.remove(temp_path)
            print(f"Error downloading committee protocol {doc_id}: {e}")
            return None

    def sync(self, conn):
        items = self.fetch_protocols_metadata(conn)
        if not items:
            return []
        
        # Save to DB
        try:
            with conn.cursor() as cur:
                for item in items:
                    doc_id = str(item.get("documentId"))
                    p_date = item.get("startDate")
                    if p_date and "T" in p_date:
                        p_date = datetime.fromisoformat(p_date.replace("Z", "+00:00")).replace(tzinfo=None)
                    
                    file_type = str(item.get("applicationLabel", "")).lower()
                    if file_type not in ["pdf", "doc"]:
                        file_type = "doc"
                        
                    title = item.get("title", "")
                    committee_name = title.split("-")[0].strip() if "-" in title else title
                    
                    last_updated = item.get("lastUpdatedDate")
                    if last_updated and "T" in last_updated:
                        try:
                            last_updated = datetime.fromisoformat(last_updated.replace("Z", "+00:00")).replace(tzinfo=None)
                        except:
                            last_updated = None

                    cur.execute("""
                        INSERT INTO protocol (document_id, source_type, knesset_number, protocol_date, session_number, committee_name, file_type, url, last_updated_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (document_id) DO UPDATE SET
                            last_updated_date = EXCLUDED.last_updated_date,
                            url = EXCLUDED.url
                    """, (doc_id, "committee", item.get("knessetNumber"), p_date, item.get("sessionNumber"), committee_name, file_type, item.get("fileUrl"), last_updated))
            conn.commit()
            print(f"Saved {len(items)} new/updated committee protocols to database.")
        except Exception as e:
            print(f"Database error while saving committee protocols: {e}")
            
        return items

if __name__ == "__main__":
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    loader = CommitteeLoader(data_dir)
    loader.sync()
