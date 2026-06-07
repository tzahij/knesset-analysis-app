import logging
logger = logging.getLogger(__name__)

import os
import requests
import math
from datetime import datetime
from dateutil.relativedelta import relativedelta
import pytz
import sys

from src.python.scrapers.utils import (
    format_date_parts,
    normalize_search_text,
    map_with_concurrency,
    download_file,
    sanitize_filename
)

from src.python.scrapers.base_loader import BaseODataLoader

# Configuration Environment Variables
SCRAPER_KNESSET_PAGE_SIZE = int(os.environ.get('SCRAPER_KNESSET_PAGE_SIZE', 100))
SCRAPER_CONCURRENCY = int(os.environ.get('SCRAPER_CONCURRENCY', 6))


ODATA_BASE_URL = (
    "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_DocumentPlenumSession"
)
GROUP_TYPE_ID = 28
PAGE_SIZE = SCRAPER_KNESSET_PAGE_SIZE
CONCURRENCY = SCRAPER_CONCURRENCY


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


class KnessetLoader(BaseODataLoader):
    def __init__(self, conn):
        super().__init__(conn)
        self.window_start = (datetime.now() - relativedelta(years=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        date_str = self.window_start.strftime("%Y-%m-%dT00:00:00")
        self.window_start_literal = f"datetime'{date_str}'"

    def fetch_metadata(self):
        filter_query = f"GroupTypeID eq {GROUP_TYPE_ID} and KNS_PlenumSession/StartDate ge {self.window_start_literal}"
        logger.info(f"Fetching all plenum protocols from scratch (last 1 year)...")

        try:
            count_url = f"{ODATA_BASE_URL}/$count?$filter={filter_query}"
            total = self.fetch_protocol_count(count_url)
        except Exception as e:
            logger.error(f"Error fetching count: {e}. Defaulting to 0 items to fetch.")
            total = 0

        logger.info(f"Found {total} plenum items.")

        if total == 0:
            return []

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
        new_items = [item for page in pages for item in page]
        new_items.sort(
            key=lambda x: (x.get("dateSortValue", 0), int(x.get("documentId", 0))),
            reverse=True,
        )

        return new_items

    def save_metadata_to_db(self, items):
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
                        INSERT INTO protocol (document_id, source_type, knesset_number, protocol_date, session_number, url, last_updated_date)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (document_id) DO NOTHING
                    """, (doc_id, "plenum", item.get("knessetNumber"), p_date, item.get("sessionNumber"), item.get("fileUrl"), last_updated))
            self.conn.commit()
            logger.info(f"Saved {len(items)} plenum protocols to database.")
        except Exception as e:
            logger.error(f"Database error while saving plenum protocols: {e}")

    def query_missing_files_from_db(self):
        try:
            with self.conn.cursor() as cur:
                cur.execute("""
                    SELECT document_id, url 
                    FROM protocol 
                    WHERE source_type = 'plenum' AND url IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM file f WHERE f.entity_type = 'P' AND f.id = protocol.document_id)
                """)
                rows = cur.fetchall()
            return [{"documentId": r[0], "fileUrl": r[1]} for r in rows]
        except Exception as e:
            logger.error(f"Error querying missing files: {e}")
            return []

    def save_file_to_db(self, task, content, extension, local_conn):
        from src.python.utils.text_extraxtor import extract_text_from_bytes
        text = extract_text_from_bytes(content, extension) if content else None
        with local_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO file (entity_type, id, file_type, file) 
                VALUES ('P', %s, %s, %s)
                ON CONFLICT (entity_type, id) DO UPDATE SET file = EXCLUDED.file, file_type = EXCLUDED.file_type
                """,
                (str(task["documentId"]), extension.replace('.', ''), content)
            )
            cur.execute(
                "UPDATE protocol SET parsed_text = %s WHERE document_id = %s",
                (text, str(task["documentId"]))
            )

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "data")
    conn = get_db_connection()
    try:
        loader = KnessetLoader(conn)
        loader.sync_metadata()
        loader.download_missing_files()
    finally:
        conn.close()
