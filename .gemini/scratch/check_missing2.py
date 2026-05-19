import json, os, sys
sys.path.insert(0, r"c:\Users\tzahi\Downloads\kneset\Israeli Knesset")
from src.python.data.database import get_db_connection

conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT document_id FROM protocol WHERE source_type='committee'")
db_ids = set(r[0] for r in cur.fetchall())

with open('data/committee-protocols.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    items = data.get('items', [])

missing_in_db = [item for item in items if str(item.get('documentId')) not in db_ids]

with open('.gemini/scratch/missing.json', 'w', encoding='utf-8') as f:
    json.dump(missing_in_db, f, ensure_ascii=False, indent=2)
