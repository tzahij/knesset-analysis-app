import sys
sys.path.insert(0, r"c:\Users\tzahi\Downloads\kneset\Israeli Knesset")
from src.python.data.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT document_id, source_type, protocol_date, committee_name, committee_type_description FROM protocol WHERE document_id LIKE '%11449178%'")
rows = cur.fetchall()
print('Rows:', rows)
