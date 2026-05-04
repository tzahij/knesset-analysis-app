import os, sys, psycopg2
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
load_dotenv('.env')
conn = psycopg2.connect(host=os.environ['PGHOST'], dbname=os.environ['PGDATABASE'], user=os.environ['PGUSER'], password=os.environ['PGPASSWORD'])
cur = conn.cursor()
for table in ('law', 'vote_event', 'vote_record', 'protocol', 'law_surprise_explanation'):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name=%s ORDER BY ordinal_position", (table,))
    print(f"{table}: {[r[0] for r in cur.fetchall()]}")
conn.close()
