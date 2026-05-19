import os
import sys
import argparse
import logging
import time
import traceback
from psycopg2.extensions import connection as Connection
from concurrent.futures import ThreadPoolExecutor, as_completed

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
from src.python.scrapers.knesset_processor import KnessetProcessor
from src.python.scrapers.member_processor import MemberProcessor

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("StoreBuilder")


def run_scraper_stage(conn: Connection, data_dir: str, threads: int, mock_api_dir: str = None) -> None:
    logger.info("--- Stage 1: Scraping & Syncing Data ---")

    knesset_loader = KnessetLoader(data_dir, conn)
    committee_loader = CommitteeLoader(data_dir, conn)
    law_loader = LawLoader(data_dir, conn)
    members_loader = MembersLoader(data_dir, conn)
    votes_loader = VotesLoader(data_dir, conn)

    # Dynamic Test Mock Injection
    if mock_api_dir:
        import os, json
        logger.info(f"Test mode enabled: Injecting mocks from {mock_api_dir}")

        def mock_fetch_json(filename, original_fetch):
            def _fetch(self, url):
                mock_path = os.path.join(mock_api_dir, filename)
                if os.path.exists(mock_path):
                    logger.info(f"[Mock] Loading {filename}")
                    with open(mock_path, 'r', encoding='utf-8') as f:
                        return json.load(f)
                logger.warning(f"[Mock] {mock_path} not found. Falling back to real API.")
                return original_fetch(self, url)
            return _fetch

        def mock_fetch_count(filename, original_count):
            def _count(self, filter_query):
                mock_path = os.path.join(mock_api_dir, filename)
                if os.path.exists(mock_path):
                    with open(mock_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    return len(data.get("value", []))
                return original_count(self, filter_query)
            return _count

        # Bind mock functions to loader instances
        law_loader.fetch_json = mock_fetch_json("mock_laws_odata.json", law_loader.__class__.fetch_json).__get__(law_loader)
        committee_loader.fetch_json = mock_fetch_json("mock_committee_odata.json", committee_loader.__class__.fetch_json).__get__(committee_loader)
        committee_loader.fetch_protocol_count = mock_fetch_count("mock_committee_odata.json", committee_loader.__class__.fetch_protocol_count).__get__(committee_loader)
        knesset_loader.fetch_json = mock_fetch_json("mock_plenum_odata.json", knesset_loader.__class__.fetch_json).__get__(knesset_loader)
        knesset_loader.fetch_protocol_count = mock_fetch_count("mock_plenum_odata.json", knesset_loader.__class__.fetch_protocol_count).__get__(knesset_loader)

        original_vote_headers = votes_loader.__class__.fetch_vote_headers
        def mock_vote_headers(self, search_window):
            mock_path = os.path.join(mock_api_dir, "mock_votes_headers.json")
            if os.path.exists(mock_path):
                with open(mock_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return original_vote_headers(self, search_window)
        votes_loader.fetch_vote_headers = mock_vote_headers.__get__(votes_loader)

        original_vote_details = votes_loader.__class__.fetch_vote_details
        def mock_vote_details(self, vote_id):
            mock_path = os.path.join(mock_api_dir, f"mock_vote_details_{vote_id}.json")
            if os.path.exists(mock_path):
                with open(mock_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            return original_vote_details(self, vote_id)
        votes_loader.fetch_vote_details = mock_vote_details.__get__(votes_loader)

        # Skip member directory build to speed up tests since user provides the member DB
        def mock_build_directory(self):
            logger.info("[Mock] Skipping Members Directory sync.")
        members_loader.build_directory = mock_build_directory.__get__(members_loader)


    # 1. Metadata Sync
    logger.info("Syncing metadata...")
    members_loader.build_directory()
    plenum_items = knesset_loader.sync()
    committee_items = committee_loader.sync()
    law_items = law_loader.sync()

    # 2. File Downloads
    missing_plenum = knesset_loader.get_missing_items(plenum_items)
    missing_committee = committee_loader.get_missing_items(committee_items)
    missing_laws = law_loader.get_missing_tasks(law_items)

    total_tasks = len(missing_plenum) + len(missing_committee) + len(missing_laws)
    logger.info(f"Scheduled {total_tasks} missing file sync tasks.")

    if total_tasks > 0:
        with ThreadPoolExecutor(max_workers=threads) as executor:

            def get_id(i):
                return (
                    i.get("id", "unknown")
                    if isinstance(i, dict)
                    else getattr(i, "id", "unknown")
                )

            tasks = (
                [
                    (
                        knesset_loader.ensure_protocol_file,
                        (i,),
                        f"Plenum item {get_id(i)}",
                    )
                    for i in missing_plenum
                ]
                + [
                    (
                        committee_loader.ensure_protocol_file,
                        (i,),
                        f"Committee item {get_id(i)}",
                    )
                    for i in missing_committee
                ]
                + [
                    (
                        law_loader.ensure_law_document_file,
                        (i, k),
                        f"Law item {get_id(i)} ({k})",
                    )
                    for i, k in missing_laws
                ]
            )

            future_to_task = {}
            for func, args, name in tasks:
                future_to_task[executor.submit(func, *args)] = name

            for future in as_completed(future_to_task):
                task_name = future_to_task[future]
                try:
                    res = future.result()
                    if res and isinstance(res, dict):
                        # If a law download returned metadata, save local_file_path to DB
                        if "billId" in res and "localFilePath" in res:
                            with conn.cursor() as cur:
                                cur.execute("UPDATE law SET local_file_path = %s WHERE bill_id = %s", (res["localFilePath"], str(res["billId"])))
                except Exception as e:
                    logger.error(f"Task failed for {task_name}: {e}")

    # Commit file updates before syncing votes in case votes rollback
    conn.commit()

    # 3. Votes Sync
    logger.info("Syncing votes...")
    with ThreadPoolExecutor(max_workers=threads) as executor:
        votes_loader.sync_votes(executor)

    # 4. Utterances Sync
    logger.info("Extracting Member Utterances...")
    from src.python.scrapers.utterances_loader import UtteranceLoader
    utterance_loader = UtteranceLoader(data_dir, conn)
    utterance_loader.sync()

    conn.commit()
    logger.info("Scraper stage completed.")


def run_analysis_stage(
    conn: Connection, data_dir: str, model: str, dry_run: bool
) -> None:
    logger.info("--- Stage 2: Running Analysis ---")

    # Override model env var if explicitly passed
    if model:
        os.environ["ANALYSIS_MODEL"] = model

    # 1. Analyse Laws
    law_processor = KnessetProcessor(data_dir, conn, model_name=model)
    law_processor.analyze_pending_laws(dry_run=dry_run)

    # 2. Analyse Member Profiles (only members that are due per trigger rules)
    member_processor = MemberProcessor(data_dir, conn)
    member_processor.analyze_due_members(dry_run=dry_run)

    logger.info("Analysis stage completed.")


def main():
    parser = argparse.ArgumentParser(description="Knesset Store Builder")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--sync-only", action="store_true", help="Run only the scraper stage"
    )
    group.add_argument(
        "--analyze-only", action="store_true", help="Run only the analysis stage"
    )
    parser.add_argument(
        "--threads", type=int, default=5, help="Concurrent sync threads"
    )
    parser.add_argument(
        "--model", type=str, default="gemini-2.5-flash", help="AI model for analysis (overrides ANALYSIS_MODEL env var)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Dry run for analysis")
    parser.add_argument(
        "--data-dir", type=str, default=None, help="Custom data directory"
    )
    parser.add_argument(
        "--mock-dir", type=str, default=None, help="Directory containing mock OData JSON files for testing"
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
            run_scraper_stage(conn, data_dir, args.threads, args.mock_dir)

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
    main()
