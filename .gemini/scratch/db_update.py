import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('.env')

conn = psycopg2.connect(
    host=os.environ.get('PGHOST', 'localhost'), 
    dbname=os.environ.get('PGDATABASE', 'knesset'), 
    user=os.environ.get('PGUSER', 'postgres'), 
    password=os.environ.get('PGPASSWORD', 'sa')
)
cur = conn.cursor()

cur.execute('ALTER TABLE protocol ADD COLUMN IF NOT EXISTS has_extracted_utterances BOOLEAN DEFAULT FALSE')

cur.execute('''
CREATE TABLE IF NOT EXISTS member_utterance (
    id SERIAL PRIMARY KEY, 
    member_slug VARCHAR(255) REFERENCES member(slug) ON DELETE CASCADE, 
    protocol_id VARCHAR(50) REFERENCES protocol(document_id) ON DELETE CASCADE, 
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('plenum', 'committee')), 
    protocol_date DATE, 
    utterance_text TEXT NOT NULL, 
    word_count INTEGER, 
    analysis_summary JSONB, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
)
''')

conn.commit()
conn.close()
print('DB updated')
