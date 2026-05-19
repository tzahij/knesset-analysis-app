import json, os, sys
sys.path.insert(0, r"c:\Users\tzahi\Downloads\kneset\Israeli Knesset")
from src.python.data.database import get_db_connection
from src.python.data.migrate_to_postgres import parse_date

conn = get_db_connection()
cur = conn.cursor()
cur.execute("SELECT document_id FROM protocol WHERE source_type='committee'")
db_ids = set(r[0] for r in cur.fetchall())

with open('data/committee-protocols.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    items = data.get('items', [])

json_ids = [str(item.get('documentId')) for item in items]
unique_json_ids = set(json_ids)

print(f'Total items in JSON: {len(items)}')
print(f'Unique items in JSON: {len(unique_json_ids)}')
print(f'Items in DB: {len(db_ids)}')

missing_in_db = [item for item in items if str(item.get('documentId')) not in db_ids]
print(f'Missing in DB: {len(missing_in_db)}')

reasons = {'no_startDate': 0, 'invalid_startDate': 0}
for item in missing_in_db:
    sd = item.get('startDate')
    if not sd:
        reasons['no_startDate'] += 1
    else:
        p_date = parse_date(sd)
        if not p_date:
            reasons['invalid_startDate'] += 1

print('Reasons for missing:', reasons)
