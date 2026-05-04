import sys, os, json, psycopg2
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv; load_dotenv('.env')
conn = psycopg2.connect(host=os.environ['PGHOST'], dbname=os.environ['PGDATABASE'], user=os.environ['PGUSER'], password=os.environ['PGPASSWORD'])
cur = conn.cursor()

# Check member slugs format
cur.execute("SELECT slug, name FROM member LIMIT 10")
print("=== Member slugs ===")
for r in cur.fetchall(): print(f"  {r[0]} | {r[1]}")

print("\n=== Contacts field ===")
cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='member' ORDER BY ordinal_position")
for r in cur.fetchall(): print(f"  {r[0]}: {r[1]}")

print("\n=== Party columns ===")
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='party' ORDER BY ordinal_position")
for r in cur.fetchall(): print(f"  {r[0]}")

conn.close()
