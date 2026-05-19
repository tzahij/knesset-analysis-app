import os
import json
import sys
sys.path.insert(0, r"c:\Users\tzahi\Downloads\kneset\Israeli Knesset")
from src.python.data.database import get_db_connection

def update_local_paths():
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Mapping of directory to source_type
    dirs = {
        "data/committee-raw": "committee",
        "data/plenum-raw": "plenum"
    }
    
    total_updated = 0
    for d, source_type in dirs.items():
        if not os.path.exists(d):
            print(f"Directory {d} not found.")
            continue
            
        print(f"Scanning {d}...")
        count = 0
        for filename in os.listdir(d):
            if filename.endswith(".json"):
                filepath = os.path.join(d, filename)
                try:
                    with open(filepath, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    
                    local_path = meta.get("localFilePath", "")
                    doc_id = meta.get("documentId")
                    ext = meta.get("extension", ".pdf" if local_path.endswith(".pdf") else ".docx")
                    
                    if doc_id:
                        # Construct the CORRECT absolute path based on the current machine
                        new_local_path = os.path.abspath(os.path.join(d, f"{doc_id}{ext}"))
                        
                        # Update database
                        cur.execute(
                            "UPDATE protocol SET local_file_path = %s WHERE document_id = %s AND source_type = %s",
                            (new_local_path, str(doc_id), source_type)
                        )
                        count += 1
                        total_updated += 1
                        
                        # Update JSON metadata file so the wrong path is gone forever
                        if new_local_path != local_path:
                            meta["localFilePath"] = new_local_path
                            with open(filepath, "w", encoding="utf-8") as f:
                                json.dump(meta, f, ensure_ascii=False, indent=2)
                                
                except Exception as e:
                    print(f"Error reading {filepath}: {e}")
                    
        print(f"Updated {count} {source_type} protocols.")
        
    conn.commit()
    cur.close()
    conn.close()
    print(f"Total records updated: {total_updated}")

if __name__ == "__main__":
    update_local_paths()
