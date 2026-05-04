import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('.env')

conn = psycopg2.connect(
    host=os.environ.get('PGHOST', 'localhost'), 
    dbname=os.environ.get('PGDATABASE', 'knesset'), 
    user=os.environ.get('PGUSER', 'postgres'), 
    password=os.environ.get('PGPASSWORD', 'sa')
)
cur = conn.cursor()

alter_statements = [
    "ALTER TABLE member ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending_analysis';",
    "ALTER TABLE member ADD COLUMN IF NOT EXISTS analysis_model VARCHAR(255);",
    "ALTER TABLE law ADD COLUMN IF NOT EXISTS analysis_model VARCHAR(255);",
    "ALTER TABLE protocol ADD COLUMN IF NOT EXISTS analysis_model VARCHAR(255);",
    "ALTER TABLE member_utterance ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending_analysis';",
    "ALTER TABLE member_utterance ADD COLUMN IF NOT EXISTS analysis_model VARCHAR(255);"
]

for stmt in alter_statements:
    try:
        cur.execute(stmt)
        print(f"Executed: {stmt}")
    except Exception as e:
        print(f"Error executing {stmt}: {e}")
        conn.rollback()

conn.commit()
conn.close()
print('DB schema fields added successfully')
