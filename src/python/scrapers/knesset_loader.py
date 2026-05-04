import os
import requests
import math
from datetime import datetime
import pytz
import sys

from utils import (
    format_date_parts,
    normalize_search_text,
    map_with_concurrency,
    download_file,
    sanitize_filename,
    ensure_directory,
    file_exists,
)

ODATA_BASE_URL = (
    "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentPlenumSession"
)
GROUP_TYPE_ID = 28
PAGE_SIZE = 100
CONCURRENCY = 6


def normalize_file_url(file_url):
    url = str(file_url or "")
    return url.replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/")


def normalize_protocol_record(entry):
    session = entry.get("KNS_PlenumSession") or {}
    start_date = session.get("StartDate")
    date_parts = format_date_parts(start_date)

    date_sort_value = 0
    if start_date:
        try:
            # handle dates like /Date(12345)/ or standard ISO strings
            if start_date.startswith("/Date("):
                ts = int(start_date[6:-2]) / 1000.0
                date_sort_value = ts * 1000
            else:
                date_sort_value = (
                    datetime.fromisoformat(
                        start_date.replace("Z", "+00:00")
                    ).timestamp()
                    * 1000
                )
        except:
            pass

    search_terms = [
        date_parts["dateKey"],
        date_parts["shortDateLabel"],
        date_parts["longDateLabel"],
        date_parts["timeLabel"],
        session.get("Name", ""),
        str(session.get("Number", "")),
        str(session.get("KnessetNum", "")),
    ]

    return {
        "documentId": str(entry.get("DocumentPlenumSessionID", "")),
        "plenumSessionId": str(
            session.get("PlenumSessionID") or entry.get("PlenumSessionID") or ""
        ),
        "sessionNumber": session.get("Number"),
        "knessetNumber": session.get("KnessetNum"),
        "title": session.get("Name") or "ישיבת מליאה",
        "startDate": start_date,
        "finishDate": session.get("FinishDate"),
        "isSpecialMeeting": bool(session.get("IsSpecialMeeting")),
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
        "searchText": normalize_search_text(" ".join([t for t in search_terms if t])),
    }


class KnessetLoader:
    def __init__(self, data_dir, conn):
        self.data_dir = data_dir
        self.conn = conn

    def fetch_json(self, url):
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()

    def fetch_text(self, url):
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.text

    def get_latest_update_date(self):
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT MAX(last_updated_date) FROM protocol WHERE source_type = 'plenum'")
                row = cur.fetchone()
                # PostgreSQL returns datetime if it's a TIMESTAMP column
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

    def fetch_protocols_metadata(self):
        latest_date = self.get_latest_update_date()

        filter_query = f"GroupTypeID eq {GROUP_TYPE_ID}"
        if latest_date:
            # Format: datetime'YYYY-MM-DDTHH:MM:SS'
            date_str = latest_date.strftime("%Y-%m-%dT%H:%M:%S")
            filter_query += f" and LastUpdatedDate gt datetime'{date_str}'"
            print(f"Fetching updates since {date_str}...")
        else:
            print("Fetching all protocols from scratch...")

        try:
            total = self.fetch_protocol_count(filter_query)
        except Exception as e:
            print(f"Error fetching count: {e}. Defaulting to 0 items to fetch.")
            total = 0

        print(f"Found {total} new or updated items.")

        if total == 0:
            return []  # Nothing to update

        page_count = math.ceil(total / PAGE_SIZE)
        page_indexes = list(range(page_count))

        def worker(page_index, idx):
            skip = page_index * PAGE_SIZE
            query = f"$filter={filter_query}&$expand=KNS_PlenumSession&$top={PAGE_SIZE}&$skip={skip}&$format=json"
            page_url = f"{ODATA_BASE_URL}?{query}"
            data = self.fetch_json(page_url)

            items = data.get("value", [])
            return [normalize_protocol_record(entry) for entry in items]

        pages = map_with_concurrency(page_indexes, CONCURRENCY, worker)

        # Flatten
        new_items = [item for page in pages for item in page]

        # Sort by dateSortValue desc, then documentId desc
        new_items.sort(
            key=lambda x: (x.get("dateSortValue", 0), int(x.get("documentId", 0))),
            reverse=True,
        )

        return new_items

    def build_download_basename(self, protocol):
        segments = [protocol.get("dateKey")]
        if protocol.get("timeKey"):
            segments.append(protocol.get("timeKey"))
        if protocol.get("sessionNumber"):
            segments.append(f"session-{protocol.get('sessionNumber')}")
        segments.append(f"protocol-{protocol.get('documentId')}")
        return sanitize_filename("__".join([str(s) for s in segments if s]))

    def get_missing_items(self, items):
        # We assume `items` are ONLY the new items we just fetched that need downloading
        raw_dir = os.path.join(self.data_dir, "raw")

        try:
            existing_files = set(os.listdir(raw_dir)) if os.path.exists(raw_dir) else set()
        except OSError:
            existing_files = set()

        missing = []
        for item in items:
            if not item.get("fileUrl"):
                continue
            doc_id = str(item["documentId"])
            if f"{doc_id}.json" not in existing_files:
                missing.append(item)
        return missing

    def ensure_protocol_file(self, protocol):
        raw_dir = os.path.join(self.data_dir, "raw")
        ensure_directory(raw_dir)

        doc_id = str(protocol["documentId"])
        meta_path = os.path.join(raw_dir, f"{doc_id}.json")

        if not protocol.get("fileUrl"):
            return None

        # Determine temp path to sniff format
        # We'll use a temporary extension then rename
        temp_path = os.path.join(raw_dir, f"{doc_id}.tmp")
        try:
            format_info = download_file(protocol["fileUrl"], temp_path)

            extension = format_info["extension"]
            local_file_path = os.path.join(raw_dir, f"{doc_id}{extension}")

            # Rename temp to final
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
                "savedAt": datetime.now(pytz.UTC).isoformat(),
            }

            # Instead of write_json, we can just save it or ignore. 
            # If we don't save a JSON file, the next time get_missing_items runs, it might download again?
            # Wait, `get_missing_items` checks if `{doc_id}.json` exists to avoid redownloads.
            # So we DO need to write the small metadata JSON to `raw_dir` to cache the file download locally.
            import json
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
            return meta
        except Exception as e:
            if file_exists(temp_path):
                os.remove(temp_path)
            print(f"Error downloading protocol {doc_id}: {e}")
            return None

    def sync(self):
        items = self.fetch_protocols_metadata()
        if not items:
            return []
            
        # Save to DB
        try:
            with self.conn.cursor() as cur:
                for item in items:
                    doc_id = str(item.get("documentId"))
                    p_date = item.get("startDate")
                    if p_date and "T" in p_date:
                        p_date = datetime.fromisoformat(p_date.replace("Z", "+00:00")).replace(tzinfo=None)
                    
                    file_type = str(item.get("applicationLabel", "")).lower()
                    if file_type not in ["pdf", "doc", "docx"]:
                        file_type = "doc"
                        
                    last_updated = item.get("lastUpdatedDate")
                    if last_updated and "T" in last_updated:
                        try:
                            last_updated = datetime.fromisoformat(last_updated.replace("Z", "+00:00")).replace(tzinfo=None)
                        except:
                            last_updated = None

                    cur.execute("""
                        INSERT INTO protocol (document_id, source_type, knesset_number, protocol_date, session_number, file_type, url, last_updated_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (document_id) DO UPDATE SET
                            last_updated_date = EXCLUDED.last_updated_date,
                            url = EXCLUDED.url
                    """, (doc_id, "plenum", item.get("knessetNumber"), p_date, item.get("sessionNumber"), file_type, item.get("fileUrl"), last_updated))
            self.conn.commit()
            print(f"Saved {len(items)} new/updated plenum protocols to database.")
        except Exception as e:
            print(f"Database error while saving plenum protocols: {e}")
            
        return items


if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    data_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")
    )
    conn = get_db_connection()
    try:
        loader = KnessetLoader(data_dir, conn)
        loader.sync()
    finally:
        conn.close()
