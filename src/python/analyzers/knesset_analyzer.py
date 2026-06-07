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
from src.python.analyzers.law_analyzer import LawAnalyser
from src.python.analyzers.member_analyzer import MemberAnalyzer
from src.python.analyzers.law_surprise_analyzer import LawSurpriseAnalyzer

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("Analyzer")


def run_analysis_stage(
    conn: Connection, model: str, dry_run: bool
) -> None:
    logger.info("--- Stage 2: Running Analysis ---")

    # Override model env var if explicitly passed
    if model:
        os.environ["ANALYSIS_MODEL"] = model

    # 1. Analyse Laws
    law_analyser = LawAnalyser(conn, model_name=model)
    law_analyser.analyze_pending_laws(dry_run=dry_run)

    # 2. Analyse Member Profiles (only members that are due per trigger rules)
    member_analyzer = MemberAnalyzer(conn)
    member_analyzer.analyze_due_members(dry_run=dry_run)

    # 3. Analyze Surprising Votes (cross-reference laws and members)
    surprise_analyzer = LawSurpriseAnalyzer(conn, model_name=model)
    surprise_analyzer.analyze_missing_explanations(dry_run=dry_run)

    logger.info("Analysis stage completed.")


def main():
    parser = argparse.ArgumentParser(description="Knesset Data Analyzer")
    parser.add_argument(
        "--model", type=str, default="gemini-2.5-flash", help="AI model for analysis (overrides ANALYSIS_MODEL env var)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Dry run for analysis")
    parser.add_argument(
        "--data-dir", type=str, default=None, help="Custom data directory"
    )

    args = parser.parse_args()

    # Path resolution

    conn = get_db_connection()
    try:
        run_analysis_stage(conn, args.model, args.dry_run)
    except Exception as e:
        logger.error(f"Critical error during analysis: {e}")
        traceback_str = "".join(traceback.format_tb(e.__traceback__))
        logger.error(traceback_str)
    finally:
        conn.close()

    logger.info("Knesset Analyzer finished.")


if __name__ == "__main__":
    main()
