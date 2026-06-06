import logging
logger = logging.getLogger(__name__)

import os
import requests
from datetime import datetime
from dateutil.relativedelta import relativedelta
import pytz
import sys

from utils import (
    format_date_parts,
    normalize_search_text,
    download_file,
    sanitize_filename
)

from base_loader import BaseODataLoader

# Configuration Environment Variables
SCRAPER_LAW_PAGE_SIZE = int(os.environ.get('SCRAPER_LAW_PAGE_SIZE', 50))
SCRAPER_LAW_MAX_PAGES = int(os.environ.get('SCRAPER_LAW_MAX_PAGES', 500))


ODATA_BASE_URL = "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill"
FINAL_READING_STATUS_ID = 118
PAGE_SIZE = SCRAPER_LAW_PAGE_SIZE
MAX_PAGES = SCRAPER_LAW_MAX_PAGES

def normalize_file_url(file_url):
    url = str(file_url or "")
    url = url.replace("https://fs.knesset.gov.il//", "https://fs.knesset.gov.il/")
    url = url.replace("http://fs.knesset.gov.il//", "https://fs.knesset.gov.il/")
    return url

def get_file_extension(file_url, application_label):
    url_value = str(file_url or "").split("?")[0]
    _, file_extension = os.path.splitext(url_value)
    file_extension = file_extension.lower()

    if file_extension in [".pdf", ".doc", ".docx"]:
        return file_extension

    normalized_label = str(application_label or "").lower()

    if "docx" in normalized_label:
        return ".docx"
    if "doc" in normalized_label:
        return ".doc"
    if "pdf" in normalized_label:
        return ".pdf"

    return ""

def get_document_kind(extension, application_label):
    if extension == ".pdf":
        return "pdf"
    if extension in [".doc", ".docx"]:
        return "word"

    normalized_label = str(application_label or "").lower()
    if "pdf" in normalized_label:
        return "pdf"
    if "doc" in normalized_label:
        return "word"

    return "unknown"

def normalize_law_document(entry, index):
    nested_document = entry.get("KNS_Document") or {}
    file_url = normalize_file_url(entry.get("FilePath") or nested_document.get("FilePath") or "")

    if not file_url:
        return None

    application_label = entry.get("ApplicationDesc") or nested_document.get("ApplicationDesc") or ""
    extension = get_file_extension(file_url, application_label)
    kind = get_document_kind(extension, application_label)
    
    group_type_id = entry.get("GroupTypeID") or nested_document.get("GroupTypeID") or 0
    try:
        group_type_id = int(group_type_id)
    except (ValueError, TypeError):
        group_type_id = None
        
    group_type_description = entry.get("GroupTypeDesc") or nested_document.get("GroupTypeDesc") or ""
    
    document_id = (
        entry.get("DocumentID") or
        entry.get("DocumentBillID") or
        nested_document.get("DocumentID") or
        nested_document.get("DocumentBillID") or
        None
    )

    is_official_pdf = (kind == "pdf" and (group_type_id == 9 or "פרסום ברשומות" in group_type_description))
    is_preferred_word = (kind == "word" and (group_type_id == 8 or "נוסח לא רשמי" in group_type_description))

    return {
        "storageKey": f"{group_type_id or 'group'}-{document_id or index}-{kind}",
        "documentId": str(document_id) if document_id else None,
        "groupTypeId": group_type_id,
        "groupTypeDescription": group_type_description,
        "applicationLabel": application_label or extension.replace(".", "").upper() or "FILE",
        "fileUrl": file_url,
        "extension": extension,
        "kind": kind,
        "isOfficialPdf": is_official_pdf,
        "isPreferredWord": is_preferred_word,
    }

def select_preferred_pdf_document(documents):
    for doc in documents:
        if doc.get("kind") == "pdf" and doc.get("isOfficialPdf"):
            return doc
    for doc in documents:
        if doc.get("kind") == "pdf" and "פרסום ברשומות" in doc.get("groupTypeDescription", ""):
            return doc
    for doc in documents:
        if doc.get("kind") == "pdf":
            return doc
    return None

def select_preferred_word_document(documents):
    for doc in documents:
        if doc.get("kind") == "word" and doc.get("isPreferredWord"):
            return doc
    for doc in documents:
        if doc.get("kind") == "word" and "נוסח לא רשמי" in doc.get("groupTypeDescription", ""):
            return doc
    for doc in documents:
        if doc.get("kind") == "word":
            return doc
    return None

def normalize_law_record(entry):
    publication_date = entry.get("PublicationDate") or entry.get("LastUpdatedDate")
    date_parts = format_date_parts(publication_date)
    
    docs_raw = entry.get("KNS_DocumentBills", [])
    if not isinstance(docs_raw, list):
        docs_raw = []
        
    documents = []
    for idx, doc_entry in enumerate(docs_raw):
        norm_doc = normalize_law_document(doc_entry, idx)
        if norm_doc:
            documents.append(norm_doc)

    official_pdf = select_preferred_pdf_document(documents)
    word_document = select_preferred_word_document(documents)

    date_sort_value = 0
    if publication_date:
        try:
            if publication_date.startswith("/Date("):
                ts = int(publication_date[6:-2]) / 1000.0
                date_sort_value = ts * 1000
            else:
                date_sort_value = datetime.fromisoformat(publication_date.replace("Z", "+00:00")).timestamp() * 1000
        except:
            pass

    status_desc = ""
    kns_status = entry.get("KNS_Status")
    if isinstance(kns_status, dict):
        status_desc = kns_status.get("Desc", "")

    try:
        status_id = int(entry.get("StatusID") or 0) or None
    except:
        status_id = None

    search_terms = [
        str(entry.get("BillID", "")),
        str(entry.get("LawID", "")),
        entry.get("Name", ""),
        entry.get("PublicationSeriesDesc", ""),
        status_desc,
        date_parts["shortDateLabel"],
        date_parts["longDateLabel"],
        date_parts["dateKey"]
    ]

    return {
        "billId": str(entry.get("BillID", "")),
        "lawId": str(entry.get("LawID")) if entry.get("LawID") else None,
        "title": entry.get("Name") or "חוק הכנסת",
        "publicationDate": publication_date,
        "publicationSeriesDesc": entry.get("PublicationSeriesDesc") or "",
        "statusId": status_id,
        "statusDesc": status_desc,
        "summaryLaw": entry.get("SummaryLaw") or "",
        "dateSortValue": date_sort_value,
        "year": date_parts["year"],
        "dateKey": date_parts["dateKey"],
        "shortDateLabel": date_parts["shortDateLabel"],
        "longDateLabel": date_parts["longDateLabel"],
        "documents": documents,
        "officialPdfDocument": official_pdf,
        "wordDocument": word_document,
        "hasOfficialPdf": bool(official_pdf and official_pdf.get("kind") == "pdf"),
        "hasWordDocument": bool(word_document),
        "searchText": normalize_search_text(" ".join([t for t in search_terms if t]))
    }

def build_query(skip, window_start_literal=None):
    filter_expr = f"StatusID eq {FINAL_READING_STATUS_ID}"
    if window_start_literal:
        filter_expr += f" and PublicationDate ge {window_start_literal}"
    return f"$filter={filter_expr}&$expand=KNS_Status,KNS_DocumentBills&$orderby=PublicationDate desc&$top={PAGE_SIZE}&$skip={skip}&$format=json"

class LawLoader(BaseODataLoader):
    def __init__(self, conn):
        super().__init__(conn)
        self.window_start = (datetime.now() - relativedelta(years=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        date_str = self.window_start.strftime("%Y-%m-%dT00:00:00")
        self.window_start_literal = f"datetime'{date_str}'"

    def fetch_metadata(self):
        all_new_items = []
        
        logger.info("Fetching laws updates...")

        # We paginate through the descending list. 
        for page_index in range(MAX_PAGES):
            skip = page_index * PAGE_SIZE
            page_url = f"{ODATA_BASE_URL}?{build_query(skip, self.window_start_literal)}"
            
            data = self.fetch_json(page_url)
            page_items_raw = data.get("value", [])
            
            if not page_items_raw:
                break
                
            page_items = [normalize_law_record(entry) for entry in page_items_raw]
            
            for item in page_items:
                if not item or item.get("statusId") != FINAL_READING_STATUS_ID:
                    continue
                all_new_items.append(item)

            if len(page_items_raw) < PAGE_SIZE:
                break

        if not all_new_items:
            logger.info("No laws found.")
            return []

        logger.info(f"Found {len(all_new_items)} laws.")
        
        # Sort
        all_new_items.sort(key=lambda x: (x.get("dateSortValue", 0), int(x.get("billId", 0))), reverse=True)

        return all_new_items

    def save_metadata_to_db(self, items):
        try:
            with self.conn.cursor() as cur:
                for law in items:
                    bill_id = str(law.get("billId"))
                    if not law.get("title") or not law.get("publicationDate"):
                        continue
                    
                    # Need to parse ISO string back to date for DB or let Postgres cast it
                    pub_date = law.get("publicationDate")
                    if pub_date and "T" in pub_date:
                        pub_date = datetime.fromisoformat(pub_date.replace("Z", "+00:00")).replace(tzinfo=None)
                        
                    url = law.get("officialPdfDocument", {}).get("fileUrl", "") if law.get("hasOfficialPdf") else law.get("wordDocument", {}).get("fileUrl", "")
                        
                    cur.execute("""
                        INSERT INTO law (bill_id, title, publication_date, url, summary_law)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (bill_id) DO NOTHING
                    """, (bill_id, law.get("title"), pub_date, url, law.get("summaryLaw", "")))
            self.conn.commit()
            logger.info(f"Saved {len(items)} laws to database.")
        except Exception as e:
            logger.error(f"Database error while saving laws: {e}")

    def query_missing_files_from_db(self):
        try:
            with self.conn.cursor() as cur:
                cur.execute("""
                    SELECT bill_id, url 
                    FROM law 
                    WHERE url IS NOT NULL 
                      AND NOT EXISTS (SELECT 1 FROM file f WHERE f.entity_type = 'L' AND f.id = law.bill_id)
                """)
                rows = cur.fetchall()
            return [{
                "billId": r[0],
                "fileUrl": r[1],
                "documentId": f"{r[0]}"
            } for r in rows]
        except Exception as e:
            logger.error(f"Error querying missing law files: {e}")
            return []

    def build_download_basename(self, law, kind):
        segments = [law.get("dateKey"), law.get("title")]
        segments.append(f"bill-{law.get('billId')}")
        return sanitize_filename("__".join([str(s) for s in segments if s]))

    def save_file_to_db(self, task, content, extension, local_conn):
        from src.python.utils.text_extraxtor import extract_text_from_bytes
        text = extract_text_from_bytes(content, extension) if content else None
        with local_conn.cursor() as cur:
            # Save the file blob
            cur.execute(
                """
                INSERT INTO file (entity_type, id, file_type, file) 
                VALUES ('L', %s, %s, %s)
                ON CONFLICT (entity_type, id) DO UPDATE SET file = EXCLUDED.file, file_type = EXCLUDED.file_type
                """,
                (str(task["billId"]), extension.replace('.', ''), content)
            )
            # Update parsed text
            cur.execute(
                "UPDATE law SET parsed_text = %s WHERE bill_id = %s",
                (text, str(task["billId"]))
            )

if __name__ == "__main__":
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    sys.path.insert(0, project_root)
    from src.python.data.database import get_db_connection
    conn = get_db_connection()
    try:
        loader = LawLoader(conn)
        loader.sync_metadata()
        loader.download_missing_files()
    finally:
        conn.close()
