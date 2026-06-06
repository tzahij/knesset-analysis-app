import logging
import os
logger = logging.getLogger(__name__)

import requests
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from abc import ABC, abstractmethod

# Configuration Environment Variables
SCRAPER_REQUEST_TIMEOUT = int(os.environ.get('SCRAPER_REQUEST_TIMEOUT', 30))


class BaseODataLoader(ABC):
    def __init__(self, conn):
        self.conn = conn

    def fetch_json(self, url):
        response = requests.get(url, timeout=SCRAPER_REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()

    def fetch_text(self, url):
        response = requests.get(url, timeout=SCRAPER_REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.text

    def fetch_protocol_count(self, url):
        raw_count = self.fetch_text(url)
        return int(raw_count)

    @abstractmethod
    def fetch_metadata(self):
        """Fetches metadata items from OData API"""
        pass

    @abstractmethod
    def save_metadata_to_db(self, items):
        """Upserts metadata items into the database using ON CONFLICT DO NOTHING"""
        pass

    @abstractmethod
    def query_missing_files_from_db(self):
        """Queries the DB for rows missing from the file table and returns them as tasks"""
        pass

    @abstractmethod
    def save_file_to_db(self, task, content, extension, local_conn):
        """Saves the downloaded file content to the DB for the given task"""
        pass

    def ensure_file(self, task):
        """Downloads the file for a specific task and saves it to DB"""
        from utils import download_file
        
        doc_id = str(task.get("documentId") or task.get("billId"))
        file_url = task["fileUrl"]

        try:
            content, format_info = download_file(file_url)

            extension = format_info["extension"]

            # Use a new connection from the pool for thread-safety during concurrent downloads
            from src.python.data.database import db_connection
            with db_connection() as local_conn:
                self.save_file_to_db(task, content, extension, local_conn)
                local_conn.commit()
            return True
        except Exception as e:
            logger.error(f"Error downloading {self.__class__.__name__} file {doc_id}: {e}")
            raise e

    def sync_metadata(self):
        """Orchestrates metadata fetching and saving"""
        items = self.fetch_metadata()
        if items:
            self.save_metadata_to_db(items)
        return items

    def download_missing_files(self, threads=5):
        """Queries missing files from DB and downloads them using a ThreadPoolExecutor"""
        tasks = self.query_missing_files_from_db()
        total_tasks = len(tasks)
        logger.info(f"[{self.__class__.__name__}] Found {total_tasks} missing files to download from DB.")
        
        if not tasks:
            return

        completed = 0
        with ThreadPoolExecutor(max_workers=threads) as executor:
            future_to_task = {executor.submit(self.ensure_file, task): task for task in tasks}
            
            for future in as_completed(future_to_task):
                task = future_to_task[future]
                try:
                    future.result()
                    completed += 1
                    if completed % 100 == 0 or completed == total_tasks:
                        logger.info(f"[{self.__class__.__name__}] Download progress: {completed}/{total_tasks} ({(completed/total_tasks)*100:.1f}%)")
                except Exception as e:
                    logger.info(f"[{self.__class__.__name__}] Task failed for {task}: {e}")
