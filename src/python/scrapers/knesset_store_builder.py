import os
import sys
import argparse
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

# Add project root to path
project_root = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..")
)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.python.data.database import get_db_connection
from src.python.scrapers.knesset_loader import KnessetLoader
from src.python.scrapers.committee_loader import CommitteeLoader
from src.python.scrapers.law_loader import LawLoader
from src.python.scrapers.members_loader import MembersLoader
from src.python.scrapers.votes_loader import VotesLoader
from src.python.scrapers.knesset_processor import KnessetProcessor

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("StoreBuilder")


def run_scraper_stage(conn, data_dir, threads):
    logger.info("--- Stage 1: Scraping & Syncing Data ---")

    knesset_loader = KnessetLoader(data_dir)
    committee_loader = CommitteeLoader(data_dir)
    law_loader = LawLoader(data_dir)
    members_loader = MembersLoader(data_dir)
    votes_loader = VotesLoader(data_dir)

    # 1. Metadata Sync
    logger.info("Syncing metadata...")
    members_loader.build_directory(conn)
    plenum_items = knesset_loader.sync(conn)
    committee_items = committee_loader.sync(conn)
    law_items = law_loader.sync(conn)

    # 2. File Downloads
    missing_plenum = knesset_loader.get_missing_items(plenum_items)
    missing_committee = committee_loader.get_missing_items(committee_items)
    missing_laws = law_loader.get_missing_tasks(law_items)

    total_tasks = len(missing_plenum) + len(missing_committee) + len(missing_laws)
    logger.info(f"Scheduled {total_tasks} missing file sync tasks.")

    if total_tasks > 0:
        with ThreadPoolExecutor(max_workers=threads) as executor:
            futures = []
            for item in missing_plenum:
                futures.append(
                    executor.submit(knesset_loader.ensure_protocol_file, item)
                )
            for item in missing_committee:
                futures.append(
                    executor.submit(committee_loader.ensure_protocol_file, item)
                )
            for item, kind in missing_laws:
                futures.append(
                    executor.submit(law_loader.ensure_law_document_file, item, kind)
                )

            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    logger.error(f"Task failed: {e}")

    # 3. Votes Sync
    logger.info("Syncing votes...")
    with ThreadPoolExecutor(max_workers=threads) as executor:
        votes_loader.sync_votes(executor, conn)

    conn.commit()
    logger.info("Scraper stage completed.")


def run_analysis_stage(conn, data_dir, model, dry_run):
    logger.info("--- Stage 2: Running Analysis ---")
    processor = KnessetProcessor(data_dir, model_name=model)
    processor.analyze_pending_laws(conn, dry_run=dry_run)
    logger.info("Analysis stage completed.")


def main():
    parser = argparse.ArgumentParser(description="Knesset Store Builder")
    parser.add_argument(
        "--sync-only", action="store_true", help="Run only the scraper stage"
    )
    parser.add_argument(
        "--analyze-only", action="store_true", help="Run only the analysis stage"
    )
    parser.add_argument(
        "--threads", type=int, default=5, help="Concurrent sync threads"
    )
    parser.add_argument(
        "--model", type=str, default="gemini-1.5-flash", help="AI model for analysis"
    )
    parser.add_argument("--dry-run", action="store_true", help="Dry run for analysis")
    parser.add_argument(
        "--data-dir", type=str, default=None, help="Custom data directory"
    )

    args = parser.parse_args()

    # Path resolution
    if args.data_dir:
        data_dir = os.path.abspath(args.data_dir)
    else:
        data_dir = os.path.join(project_root, "data")

    logger.info(f"Starting Knesset Store Builder (Data Dir: {data_dir})")

    conn = get_db_connection()
    try:
        if not args.analyze_only:
            run_scraper_stage(conn, data_dir, args.threads)

        if not args.sync_only:
            run_analysis_stage(conn, data_dir, args.model, args.dry_run)

    except Exception as e:
        logger.error(f"Critical error during build: {e}")
        traceback_str = "".join(traceback.format_tb(e.__traceback__))
        logger.error(traceback_str)
    finally:
        conn.close()

    logger.info("Knesset Store Builder finished.")


if __name__ == "__main__":
    import traceback

    main()
