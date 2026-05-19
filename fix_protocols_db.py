import os
import json
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.python.data.database import get_db_connection
from src.python.data.migrate_to_postgres import parse_date

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "data"))

def fix_protocols():
    conn = get_db_connection()
    cur = conn.cursor()
    
    print("Altering protocol_date column to TIMESTAMP...")
    cur.execute("ALTER TABLE protocol ALTER COLUMN protocol_date TYPE TIMESTAMP")
    
    committee_path = os.path.join(DATA_DIR, "committee-protocols.json")
    if os.path.exists(committee_path):
        print("Updating committee protocols...")
        with open(committee_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            count = 0
            for item in data.get("items", []):
                doc_id = str(item.get("documentId"))
                p_date = parse_date(item.get("startDate"))
                c_desc = item.get("committeeTypeDescription")
                
                cur.execute("""
                    UPDATE protocol 
                    SET protocol_date = %s, committee_type_description = %s 
                    WHERE document_id = %s AND source_type = 'committee'
                """, (p_date, c_desc, doc_id))
                count += 1
            print(f"Updated {count} committee protocols.")

    plenum_path = os.path.join(DATA_DIR, "protocols.json")
    if os.path.exists(plenum_path):
        print("Updating plenum protocols...")
        with open(plenum_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            count = 0
            for item in data.get("items", []):
                doc_id = str(item.get("documentId"))
                p_date = parse_date(item.get("startDate"))
                
                cur.execute("""
                    UPDATE protocol 
                    SET protocol_date = %s 
                    WHERE document_id = %s AND source_type = 'plenum'
                """, (p_date, doc_id))
                count += 1
            print(f"Updated {count} plenum protocols.")

    conn.commit()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    fix_protocols()
