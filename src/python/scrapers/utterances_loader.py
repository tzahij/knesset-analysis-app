import os
import sys
import logging
import docx
import re
import datetime
from psycopg2.extras import execute_batch

logger = logging.getLogger("UtteranceLoader")

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

from src.python.scrapers.member_registry import resolve_member_by_name

# Configuration Environment Variables
MIN_MEMBER_UTTERANCE_WORDS = int(os.environ.get('MIN_MEMBER_UTTERANCE_WORDS', 50))


MIN_MEMBER_UTTERANCE_WORDS = MIN_MEMBER_UTTERANCE_WORDS

class UtteranceLoader:
    def __init__(self, conn):
        self.conn = conn
        self.regex = re.compile(r'^<<\s*([^>]+?)\s*>>\s*(.+?)\s*:\s*<<\s*([^>]+?)\s*>>$')

    def process_document(self, document_id, source_type, protocol_date):
        import io
        try:
            with self.conn.cursor() as cur:
                entity_type = 'P' if source_type == 'plenum' else 'C'
                cur.execute("SELECT file, file_type FROM file WHERE id = %s AND entity_type = %s", (document_id, entity_type))
                row = cur.fetchone()
                
            if not row or not row[0]:
                return 0
                
            file_blob = row[0]
            file_type = row[1]
            
            if file_type not in ('doc', 'docx'):
                return 0
                
            doc = docx.Document(io.BytesIO(file_blob))
        except Exception as e:
            logger.warning(f"Could not read docx for {document_id}: {e}")
            return 0

        current_speaker_name = None
        current_paragraphs = []
        utterances_added = 0
        current_batch = []

        def save_current_utterance():
            nonlocal utterances_added
            if not current_speaker_name or not current_paragraphs:
                return

            text = "\n".join(current_paragraphs).strip()
            word_count = len(text.split())
            
            if word_count >= MIN_MEMBER_UTTERANCE_WORDS:
                member = resolve_member_by_name(current_speaker_name)
                if member:
                    db_slug = member.get('routeSlug', member.get('id', member['slug']))
                    try:
                        utterances_added += 1
                        current_batch.append((db_slug, document_id, text, word_count))
                    except Exception as e:
                        logger.error(f"Failed to prepare utterance for {db_slug}: {e}")

        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue

            match = self.regex.search(text)
            if match:
                # Save previous speaker's utterance
                save_current_utterance()
                
                # Start new speaker block
                current_speaker_name = match.group(2).strip()
                current_paragraphs = []
            else:
                if current_speaker_name:
                    current_paragraphs.append(text)

        # Save the very last speaker block
        save_current_utterance()
        
        return current_batch

    def sync(self):
        logger.info("Starting Utterances Extraction Sync...")
        
        try:
            with self.conn.cursor() as cur:
                cur.execute('''
                    SELECT document_id, source_type, protocol_date 
                    FROM protocol 
                    WHERE has_extracted_utterances = FALSE OR has_extracted_utterances IS NULL
                ''')
                pending_protocols = cur.fetchall()
        except Exception as e:
            logger.error(f"Error fetching pending protocols: {e}")
            return

        if not pending_protocols:
            logger.info("No pending protocols for utterance extraction.")
            return

        logger.info(f"Found {len(pending_protocols)} pending protocols.")
        
        processed_count = 0
        total_utterances = 0

        for doc_id, source_type, protocol_date in pending_protocols:
            utterances = self.process_document(doc_id, source_type, protocol_date)
            
            if utterances == 0: # 0 indicates parsing failed or missing file
                continue
            
            try:
                with self.conn.cursor() as cur:
                    # Clean up any partial inserts from previous crashes for this protocol
                    cur.execute("DELETE FROM member_utterance WHERE protocol_id = %s", (doc_id,))
                    
                    if utterances:
                        execute_batch(cur, '''
                            INSERT INTO member_utterance (
                                member_slug, protocol_id, utterance_text, word_count
                            ) VALUES (%s, %s, %s, %s)
                        ''', utterances)
                        total_utterances += len(utterances)
                    
                    cur.execute('''
                        UPDATE protocol SET has_extracted_utterances = TRUE 
                        WHERE document_id = %s
                    ''', (doc_id,))
                
                # Commit all utterances and the protocol status update in ONE atomic transaction
                self.conn.commit()
                processed_count += 1
            except Exception as e:
                logger.error(f"Transaction failed for protocol {doc_id}: {e}")
                self.conn.rollback()

        logger.info(f"Extracted {total_utterances} utterances from {processed_count} documents.")

if __name__ == "__main__":
    from src.python.data.database import get_db_connection
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    conn = get_db_connection()
    try:
        loader = UtteranceLoader(conn)
        loader.sync()
    finally:
        conn.close()
