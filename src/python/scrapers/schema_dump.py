import os
import sys
import psycopg2
from dotenv import load_dotenv

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, project_root)
load_dotenv(os.path.join(project_root, ".env"))

db_host = os.environ.get("PGHOST", "localhost")
db_name = os.environ.get("PGDATABASE", "knesset")
db_user = os.environ.get("PGUSER", "postgres")
db_pass = os.environ.get("PGPASSWORD", "sa")

conn = psycopg2.connect(host=db_host, dbname=db_name, user=db_user, password=db_pass)
cur = conn.cursor()

cur.execute("""
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
""")
tables = cur.fetchall()

print("Tables in database:")
for t in tables:
    table_name = t[0]
    print(f"\n--- {table_name} ---")
    cur.execute(f"""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = '{table_name}'
    """)
    for col in cur.fetchall():
        print(f"  {col[0]}: {col[1]}")

conn.close()
