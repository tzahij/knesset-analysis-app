import os
import sys

# 1. Force the database connection to use the test DB
os.environ["PGDATABASE"] = "knesset_test"

# Lower the thresholds so MemberProcessor actually triggers on just 1-2 protocols
os.environ["MEMBER_ANALYSIS_MIN_WORDS"] = "30"
os.environ["MEMBER_ANALYSIS_MIN_DAYS"] = "0"
os.environ["MEMBER_ANALYSIS_MIN_NEW_UTTERANCES"] = "1"

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, project_root)

from src.python.scrapers.knesset_store_builder import run_scraper_stage, run_analysis_stage
from src.python.data.database import get_db_connection

MOCK_DIR = os.path.join(project_root, "data_test", "test_mocks")
os.makedirs(MOCK_DIR, exist_ok=True)


def setup_db():
    conn = get_db_connection()
    with conn.cursor() as cur:
        print("Truncating transactional tables (keeping members/parties intact)...")
        # CASCADE ensures we clear member_utterance, member_analysis, etc.
        cur.execute("TRUNCATE TABLE law, protocol, vote_event, surprising_vote, law_surprise_explanation, member_utterance, member_analysis CASCADE;")
        conn.commit()
    return conn


if __name__ == "__main__":
    print("=====================================================")
    print("Starting E2E test with built-in API mocking...")
    print("Target DB: knesset_test")
    print(f"Mock Data Dir: {MOCK_DIR}")
    print("=====================================================")
    
    data_dir = os.path.join(project_root, "data_test")
    conn = setup_db()
    
    try:
        print("\n>>> Running Scraper Stage")
        # We pass the mock directory natively to the builder
        run_scraper_stage(conn, data_dir, threads=2, mock_api_dir=MOCK_DIR)
        
        print("\n>>> Running Analysis Stage")
        run_analysis_stage(conn, data_dir, model="gemini-2.5-flash", dry_run=False)
        
        print("\n>>> E2E Test Completed Successfully!")
        
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM law")
            print(f"Laws in DB: {cur.fetchone()[0]}")
            
            cur.execute("SELECT count(*) FROM protocol")
            print(f"Protocols in DB: {cur.fetchone()[0]}")
            
            cur.execute("SELECT count(*) FROM member_analysis")
            print(f"Member Analyses generated: {cur.fetchone()[0]}")
            
    except Exception as e:
        print(f"Test Failed: {e}")
    finally:
        conn.close()
