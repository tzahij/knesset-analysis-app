import os
import json
import re
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytz

DATE_TIME_ZONE = pytz.timezone("Asia/Jerusalem")

def ensure_directory(dir_path):
    os.makedirs(dir_path, exist_ok=True)

def file_exists(file_path):
    return os.path.exists(file_path)

def read_json(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)

def write_json(file_path, data):
    ensure_directory(os.path.dirname(file_path))
    temp_file_path = f"{file_path}.tmp"
    with open(temp_file_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    try:
        os.replace(temp_file_path, file_path)
    except OSError:
        # Fallback if replace fails (e.g., cross-device link issues or Windows permissions)
        if os.path.exists(file_path):
            os.remove(file_path)
        os.rename(temp_file_path, file_path)

def sanitize_filename(value):
    s = str(value)
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', s)
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace(' ', '_')
    return s

def normalize_search_text(value):
    s = str(value or "").lower()
    s = re.sub(r'[.,/\\-]+', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def format_date_parts(iso_value):
    if not iso_value:
        return {
            "year": None,
            "dateKey": "unknown-date",
            "timeKey": None,
            "shortDateLabel": "תאריך לא זמין",
            "longDateLabel": "תאריך לא זמין",
            "timeLabel": ""
        }
    
    try:
        if iso_value.endswith('Z'):
            iso_value = iso_value[:-1] + '+00:00'
        dt = datetime.fromisoformat(iso_value)
        if dt.tzinfo is None:
            # Assume UTC if no timezone is provided by OData
            dt = dt.replace(tzinfo=pytz.UTC)
        
        # Convert to Jerusalem time
        dt = dt.astimezone(DATE_TIME_ZONE)
    except (ValueError, TypeError):
        return {
            "year": None,
            "dateKey": "unknown-date",
            "timeKey": None,
            "shortDateLabel": "תאריך לא זמין",
            "longDateLabel": "תאריך לא זמין",
            "timeLabel": ""
        }

    year = dt.year
    date_key = dt.strftime("%Y-%m-%d")
    time_label = dt.strftime("%H:%M")
    time_key = time_label.replace(":", "-")
    
    # Python doesn't have a built-in Hebrew locale for strftime that works reliably across platforms
    # We will build simple manual labels or basic representations.
    # To fully mimic JS:
    months_he = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"]
    days_he = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
    
    # 0 is Monday in Python weekday(), but Sunday is 0 in JS/Hebrew standard.
    # Python weekday(): 0=Mon, 1=Tue, ..., 6=Sun
    # Hebrew weekday: 0=Sun, 1=Mon, ..., 6=Sat
    heb_weekday_idx = (dt.weekday() + 1) % 7 
    
    short_date_label = f"{dt.day:02d} ב{months_he[dt.month - 1]} {year}"
    long_date_label = f"יום {days_he[heb_weekday_idx]}, {dt.day} ב{months_he[dt.month - 1]} {year}"

    return {
        "year": year,
        "dateKey": date_key,
        "timeKey": time_key,
        "shortDateLabel": short_date_label,
        "longDateLabel": long_date_label,
        "timeLabel": time_label
    }

def map_with_concurrency(items, concurrency, worker_func):
    results = [None] * len(items)
    with ThreadPoolExecutor(max_workers=min(concurrency, len(items) or 1)) as executor:
        # Submit all tasks and keep track of their index
        future_to_idx = {executor.submit(worker_func, item, idx): idx for idx, item in enumerate(items)}
        
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                # To match JS roughly, we could raise or capture. We'll raise to fail fast.
                raise e
    return results

BINARY_DOC_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

def sniff_format(buffer):
    if buffer[:2] == b"PK":
        return {
            "format": "docx",
            "extension": ".docx",
            "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
    if buffer[:len(BINARY_DOC_SIGNATURE)] == BINARY_DOC_SIGNATURE:
        return {
            "format": "doc",
            "extension": ".doc",
            "contentType": "application/msword",
        }
    return {
        "format": "doc",
        "extension": ".doc",
        "contentType": "application/msword",
    }

def download_file(url, target_path, timeout=60):
    response = requests.get(url, timeout=timeout, stream=True)
    response.raise_for_status()
    
    # Read the whole thing to sniff
    content = response.content
    format_info = sniff_format(content)
    
    # If the target_path doesn't have an extension, we might want to add it
    # but the caller usually provides the full path with extension based on OData.
    # Actually, the Node.js code sniffs to determine the CORRECT extension.
    
    with open(target_path, "wb") as f:
        f.write(content)
        
    return format_info
