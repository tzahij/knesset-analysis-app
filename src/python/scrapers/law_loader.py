import os
import requests
from datetime import datetime
import pytz
import sys

# Ensure we can import from the current directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import (
    format_date_parts,
    normalize_search_text,
    file_exists,
    read_json,
    write_json,
    download_file,
    sanitize_filename,
    ensure_directory
)

ODATA_BASE_URL = "http://knesset.gov.il/Odata/ParliamentInfo.svc/KNS_Bill"
FINAL_READING_STATUS_ID = 118
PAGE_SIZE = 50
MAX_PAGES = 500

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

def build_query(skip):
    return f"$filter=StatusID eq {FINAL_READING_STATUS_ID}&$expand=KNS_Status,KNS_DocumentBills&$orderby=PublicationDate desc&$top={PAGE_SIZE}&$skip={skip}&$format=json"

class LawLoader:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.cache_file = os.path.join(data_dir, "laws.json")

    def fetch_json(self, url):
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return response.json()

    def load_existing_cache(self, conn):
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT bill_id FROM law")
                rows = cur.fetchall()
            return [{"billId": str(r[0])} for r in rows]
        except Exception as e:
            print(f"Error loading cache from DB: {e}")
            return []

    def fetch_recent_passed_laws(self, conn):
        existing_items = self.load_existing_cache(conn)
        existing_by_bill_id = {item["billId"]: item for item in existing_items}
        
        all_new_items = []
        seen_bill_ids = set(existing_by_bill_id.keys())
        
        print(f"Loaded {len(seen_bill_ids)} existing laws. Fetching updates...")

        # We paginate through the descending list. 
        # Once a full page yields zero NEW items, we assume we've caught up completely.
        for page_index in range(MAX_PAGES):
            skip = page_index * PAGE_SIZE
            page_url = f"{ODATA_BASE_URL}?{build_query(skip)}"
            
            data = self.fetch_json(page_url)
            page_items_raw = data.get("value", [])
            
            if not page_items_raw:
                break
                
            page_items = [normalize_law_record(entry) for entry in page_items_raw]
            new_items_in_page = 0
            
            for item in page_items:
                if not item or item.get("statusId") != FINAL_READING_STATUS_ID:
                    continue
                
                bill_id = item["billId"]
                if bill_id in seen_bill_ids:
                    continue
                
                seen_bill_ids.add(bill_id)
                all_new_items.append(item)
                new_items_in_page += 1

            # If we fetched a page but none of the items were new to us, we've hit the point where
            # our local cache overlaps with the API data. We can stop.
            if new_items_in_page == 0 and len(page_items) > 0:
                print(f"Page {page_index} had 0 new items. Delta sync complete.")
                break

            if len(page_items_raw) < PAGE_SIZE:
                break

        if not all_new_items:
            print("No new laws found.")
            return existing_items

        print(f"Found {len(all_new_items)} new laws.")
        
        for item in all_new_items:
            existing_by_bill_id[item["billId"]] = item
            
        merged_items = list(existing_by_bill_id.values())

        # Sort
        merged_items.sort(key=lambda x: (x.get("dateSortValue", 0), int(x.get("billId", 0))), reverse=True)

        return merged_items

    def build_download_basename(self, law, kind):
        segments = [law.get("dateKey"), law.get("title")]
        segments.append(f"bill-{law.get('billId')}")
        return sanitize_filename("__".join([str(s) for s in segments if s]))

    def get_missing_tasks(self, items):
        raw_dir = os.path.join(self.data_dir, "law-raw")
        
        cutoff_ts = (datetime.now().timestamp() - (5 * 365.25 * 24 * 3600)) * 1000
        
        if not file_exists(raw_dir):
            existing_files = set()
        else:
            try:
                existing_files = set(os.listdir(raw_dir))
            except OSError:
                existing_files = set()
                
        missing_tasks = []
        for item in items:
            if item.get("dateSortValue", 0) < cutoff_ts:
                continue
                
            if item.get("hasOfficialPdf"):
                doc = item.get("officialPdfDocument")
                if doc and doc.get("fileUrl"):
                    doc_id = str(doc.get("documentId") or f"{item['billId']}-pdf")
                    if f"{doc_id}.json" not in existing_files:
                        missing_tasks.append((item, "pdf"))
            
            if item.get("hasWordDocument"):
                doc = item.get("wordDocument")
                if doc and doc.get("fileUrl"):
                    doc_id = str(doc.get("documentId") or f"{item['billId']}-word")
                    if f"{doc_id}.json" not in existing_files:
                        missing_tasks.append((item, "word"))
                        
        return missing_tasks

    def ensure_law_document_file(self, law, kind):
        raw_dir = os.path.join(self.data_dir, "law-raw")
        ensure_directory(raw_dir)
        
        doc = law.get("officialPdfDocument") if kind == "pdf" else law.get("wordDocument")
        if not doc or not doc.get("fileUrl"):
            return None
            
        doc_id = str(doc.get("documentId") or f"{law['billId']}-{kind}")
        meta_path = os.path.join(raw_dir, f"{doc_id}.json")
        
        if file_exists(meta_path):
            try:
                meta = read_json(meta_path)
                if meta.get("localFilePath") and file_exists(meta["localFilePath"]):
                    return meta
            except:
                pass

        temp_path = os.path.join(raw_dir, f"{doc_id}.tmp")
        try:
            format_info = download_file(doc["fileUrl"], temp_path)
            
            extension = format_info["extension"]
            local_file_path = os.path.join(raw_dir, f"{doc_id}{extension}")
            
            if file_exists(local_file_path):
                os.remove(local_file_path)
            os.rename(temp_path, local_file_path)
            
            download_name = f"{self.build_download_basename(law, kind)}{extension}"
            
            meta = {
                "documentId": doc_id,
                "billId": law["billId"],
                "kind": kind,
                "originalUrl": doc["fileUrl"],
                "localFilePath": local_file_path,
                "format": format_info["format"],
                "extension": extension,
                "contentType": format_info["contentType"],
                "downloadName": download_name,
                "savedAt": datetime.now(pytz.UTC).isoformat()
            }
            
            write_json(meta_path, meta)
            return meta
        except Exception as e:
            if file_exists(temp_path):
                os.remove(temp_path)
            print(f"Error downloading law {kind} for bill {law['billId']}: {e}")
            return None

    def sync(self, conn):
        items = self.fetch_recent_passed_laws(conn)
        
        try:
            with conn.cursor() as cur:
                for law in items:
                    bill_id = str(law.get("billId"))
                    if not law.get("title") or not law.get("publicationDate"):
                        continue
                    
                    # Need to parse ISO string back to date for DB or let Postgres cast it
                    pub_date = law.get("publicationDate")
                    if pub_date and "T" in pub_date:
                        pub_date = datetime.fromisoformat(pub_date.replace("Z", "+00:00")).replace(tzinfo=None)
                        
                    file_type = ""
                    url = ""
                    if law.get("hasOfficialPdf"):
                        file_type = "pdf"
                        url = law.get("officialPdfDocument", {}).get("fileUrl", "")
                    elif law.get("hasWordDocument"):
                        file_type = "doc"
                        url = law.get("wordDocument", {}).get("fileUrl", "")
                        
                    cur.execute("""
                        INSERT INTO law (bill_id, title, publication_date, knesset_number, file_type, url)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (bill_id) DO UPDATE SET
                            title = EXCLUDED.title,
                            publication_date = EXCLUDED.publication_date,
                            knesset_number = EXCLUDED.knesset_number,
                            file_type = EXCLUDED.file_type,
                            url = EXCLUDED.url
                    """, (bill_id, law.get("title"), pub_date, law.get("knessetNumber"), file_type, url))
            conn.commit()
            print(f"Saved {len(items)} laws to database.")
        except Exception as e:
            print(f"Database error while saving laws: {e}")
        return items

if __name__ == "__main__":
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    loader = LawLoader(data_dir)
    loader.sync()
