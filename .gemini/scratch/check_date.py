import sys
sys.path.insert(0, r"c:\Users\tzahi\Downloads\kneset\Israeli Knesset")
from src.python.data.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT document_id, source_type, committee_name, committee_type_description FROM protocol WHERE DATE(protocol_date) = '2026-04-16'")
rows = cur.fetchall()
print(f"Protocols on 2026-04-16: {len(rows)}")
for r in rows:
    print(r)
