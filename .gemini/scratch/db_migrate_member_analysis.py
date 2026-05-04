"""
Migration: Split member table into member + member_analysis.
- Preserves existing analysis_summary and analysis_model data.
- Drops analysis columns from member table.
- Creates member_analysis table.
"""
import os, sys
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, '.env.local'), override=True)

from src.python.data.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()

print("Step 1: Creating member_analysis table...")
cur.execute("""
    CREATE TABLE IF NOT EXISTS member_analysis (
        member_slug VARCHAR(255) PRIMARY KEY REFERENCES member(slug) ON DELETE CASCADE,
        analysis_summary JSONB,
        analysis_model VARCHAR(255),
        last_analyzed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
""")

print("Step 2: Migrating existing analysis data from member -> member_analysis...")
cur.execute("""
    INSERT INTO member_analysis (member_slug, analysis_summary, analysis_model, last_analyzed_at, updated_at)
    SELECT slug, analysis_summary, analysis_model,
           CASE WHEN analysis_summary IS NOT NULL THEN updated_at ELSE NULL END,
           updated_at
    FROM member
    WHERE analysis_summary IS NOT NULL OR analysis_model IS NOT NULL
    ON CONFLICT (member_slug) DO NOTHING
""")
rows_migrated = cur.rowcount
print(f"   Migrated {rows_migrated} existing analysis records.")

print("Step 3: Dropping analysis columns from member table...")
cur.execute("ALTER TABLE member DROP COLUMN IF EXISTS analysis_summary")
cur.execute("ALTER TABLE member DROP COLUMN IF EXISTS analysis_model")
cur.execute("ALTER TABLE member DROP COLUMN IF EXISTS status")

conn.commit()
cur.close()
conn.close()
print("Migration complete.")
