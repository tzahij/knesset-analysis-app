import os
import sys

# Add project root to path
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Set PGDATABASE to knesset_test before importing database
os.environ["PGDATABASE"] = "knesset_test"

from src.python.data.database import get_db_connection

def init_db():
    print("Checking/Initializing knesset_test database...")
    schema_path = os.path.join(project_root, "src", "python", "data", "schema.sql")
    
    with open(schema_path, "r", encoding="utf-8") as f:
        schema_sql = f.read()

    conn = get_db_connection()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            # Execute the schema. To be safe with existing indexes/tables, we split by semicolon
            # and ignore errors about objects already existing.
            statements = schema_sql.split(';')
            for stmt in statements:
                stmt = stmt.strip()
                if not stmt:
                    continue
                try:
                    cur.execute(stmt)
                except Exception as e:
                    if "already exists" in str(e):
                        continue
                    print(f"Warning: Statement failed: {stmt[:50]}... Error: {e}")
        print("Test database schema check/update complete.")
    except Exception as e:
        print(f"Failed to initialize database: {e}")
        sys.exit(1)
    finally:
        conn.close()

if __name__ == "__main__":
    init_db()
