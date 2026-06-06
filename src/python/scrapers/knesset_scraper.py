import os
import sys
import argparse
import logging
import traceback
from psycopg2.extensions import connection as Connection

# Add project root to path
project_root = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

from src.python.data.database import get_db_connection
from src.python.scrapers.knesset_loader import KnessetLoader
from src.python.scrapers.committee_loader import CommitteeLoader
from src.python.scrapers.law_loader import LawLoader
from src.python.scrapers.members_loader import MembersLoader
from src.python.scrapers.votes_loader import VotesLoader

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("Scraper")


def run_scraper_stage(conn: Connection, threads: int) -> None:
    logger.info("--- Stage 1: Scraping & Syncing Data ---")

    knesset_loader = KnessetLoader(conn)
    committee_loader = CommitteeLoader(conn)
    law_loader = LawLoader(conn)
    members_loader = MembersLoader(conn)
    votes_loader = VotesLoader(conn)

    # 1. Plenum Sync & Download
    logger.info("Syncing plenum protocols...")
    knesset_loader.sync_metadata()
    conn.commit()
    logger.info("Downloading missing plenum protocols...")
    knesset_loader.download_missing_files(threads)
    
    # 2. Committee Sync & Download
    logger.info("Syncing committee protocols...")
    committee_loader.sync_metadata()
    conn.commit()
    logger.info("Downloading missing committee protocols...")
    committee_loader.download_missing_files(threads)
    
    # 3. Law Sync & Download
    logger.info("Syncing laws...")
    law_loader.sync_metadata()
    conn.commit()
    logger.info("Downloading missing law files...")
    law_loader.download_missing_files(threads)

    # Commit file updates before syncing votes in case votes rollback
    conn.commit()

    # 4. Votes Sync
    logger.info("Syncing votes...")
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=threads) as executor:
        votes_loader.sync_votes(executor)

    # 5. Utterances Sync
    logger.info("Extracting Member Utterances...")
    from src.python.scrapers.utterances_loader import UtteranceLoader
    utterance_loader = UtteranceLoader(conn)
    utterance_loader.sync()

    conn.commit()
    logger.info("Scraper stage completed.")


def main():
    parser = argparse.ArgumentParser(description="Knesset Data Scraper")
    parser.add_argument(
        "--threads", type=int, default=5, help="Concurrent sync threads"
    )
    parser.add_argument(
        "--data-dir", type=str, default=None, help="Custom data directory"
    )

    args = parser.parse_args()

    # Path resolution

    conn = get_db_connection()
    try:
        run_scraper_stage(conn, args.threads)
    except Exception as e:
        logger.error(f"Critical error during sync: {e}")
        traceback_str = "".join(traceback.format_tb(e.__traceback__))
        logger.error(traceback_str)
    finally:
        conn.close()

    logger.info("Knesset Scraper finished.")


if __name__ == "__main__":
    main()
