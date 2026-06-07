import os
import sys
import argparse
import logging
import traceback

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

from src.python.data.database import db_connection
from src.python.scrapers.knesset_scraper import run_scraper_stage
from src.python.analyzers.knesset_analyzer import run_analysis_stage

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("StoreBuilder")


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
        "--threads", type=int, default=1, help="Concurrent sync threads"
    )
    parser.add_argument(
        "--model", type=str, default="gemini-2.5-flash", help="AI model for analysis (overrides ANALYSIS_MODEL env var)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Dry run for analysis")
    parser.add_argument(
        "--data-dir", type=str, default=None, help="Custom data directory"
    )

    args = parser.parse_args()

    # Path resolution

    try:
        with db_connection() as conn:
            if not args.analyze_only:
                run_scraper_stage(conn, args.threads)

            if not args.sync_only:
                run_analysis_stage(conn, args.model, args.dry_run)

    except Exception as e:
        logger.error(f"Critical error during build: {e}")
        traceback_str = "".join(traceback.format_tb(e.__traceback__))
        logger.error(traceback_str)

    logger.info("Knesset Store Builder finished.")


if __name__ == "__main__":
    main()
