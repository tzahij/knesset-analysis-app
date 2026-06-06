import os
import json
import re
import time
import logging
import requests
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytz
from dotenv import load_dotenv
from google import genai

# Configuration Environment Variables
GEMINI_MAX_RETRIES = int(os.environ.get('GEMINI_MAX_RETRIES', 6))
GEMINI_RETRY_INITIAL_DELAY = float(os.environ.get('GEMINI_RETRY_INITIAL_DELAY', 4.0))
SCRAPER_DOWNLOAD_TIMEOUT = int(os.environ.get('SCRAPER_DOWNLOAD_TIMEOUT', 60))
DOWNLOAD_MAX_RETRIES = int(os.environ.get('DOWNLOAD_MAX_RETRIES', 3))


logger = logging.getLogger("GeminiRetry")

def call_gemini_with_retry(client, model, prompt, config=None, max_retries=GEMINI_MAX_RETRIES, initial_delay=GEMINI_RETRY_INITIAL_DELAY):
    """
    Calls the Gemini API using the provided genai.Client with exponential backoff retry.
    Handles transient errors and 429 (Resource Exhausted) rate limits on the free tier.
    """
    delay = initial_delay
    for attempt in range(1, max_retries + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            # Auto-parse JSON if config specifies JSON output
            if config and getattr(config, 'response_mime_type', None) == "application/json":
                text = response.text
                try:
                    return json.loads(text)
                except json.JSONDecodeError as jde:
                    # Fallback to try stripping markdown blocks
                    if "```json" in text:
                        match = re.search(r'```json(.*?)```', text, re.DOTALL)
                        if match:
                            try:
                                return json.loads(match.group(1).strip())
                            except json.JSONDecodeError:
                                pass
                    raise jde
            return response.text
        except Exception as e:
            err_msg = str(e)
            logger.warning(f"[Attempt {attempt}/{max_retries}] Gemini API call failed: {err_msg}")
            
            if attempt == max_retries:
                logger.error("Max retries reached. Failing Gemini API call.")
                raise e
            
            if "429" in err_msg or "quota" in err_msg.lower() or "resourceexhausted" in err_msg.lower():
                logger.error(f"Rate limit hit (429 Resource Exhausted). Stopping execution.")
                raise SystemExit(f"Stopping execution: Gemini API Rate Limit / Quota Exceeded.\nError: {err_msg}")
            else:
                logger.info(f"Retrying in {delay:.1f}s...")
                
            time.sleep(delay)
            delay *= 2.0


def initialize_gemini_client(default_model="gemini-2.5-flash", override_model=None):
    """
    Resolves project root, loads environment variables from .env and .env.local,
    verifies GEMINI_API_KEY, and returns an initialized genai.Client and active model_name.
    """
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    load_dotenv(os.path.join(project_root, ".env"))
    load_dotenv(os.path.join(project_root, ".env.local"), override=True)
    
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not found in environment")
        
    client = genai.Client(api_key=api_key)
    
    # Priority: 1) explicit override, 2) ANALYSIS_MODEL env var, 3) default_model
    model_name = override_model or os.environ.get("ANALYSIS_MODEL") or default_model
    return client, model_name



DATE_TIME_ZONE = pytz.timezone("Asia/Jerusalem")


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

def download_file(url, timeout=SCRAPER_DOWNLOAD_TIMEOUT, max_retries=DOWNLOAD_MAX_RETRIES):
    import time
    delay = 2.0
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, timeout=timeout, stream=True)
            response.raise_for_status()
            
            # Read the whole thing to sniff
            content = response.content
            format_info = sniff_format(content)
            
            return content, format_info
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError, requests.exceptions.HTTPError) as e:
            if attempt == max_retries:
                raise e
            logger.warning(f"Download failed for {url} (attempt {attempt}/{max_retries}): {e}. Retrying in {delay}s...")
            time.sleep(delay)
            delay *= 2.0
