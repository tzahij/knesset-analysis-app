import os
import sys
import logging
import docx
import re
import datetime

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

MIN_MEMBER_UTTERANCE_WORDS = 50

class UtteranceLoader:
    def __init__(self, data_dir, conn):
        self.data_dir = data_dir
        self.conn = conn
        self.regex = re.compile(r'^<<\s*([^>]+?)\s*>>\s*(.+?)\s*:\s*<<\s*([^>]+?)\s*>>$')

    def get_docx_path(self, document_id, source_type):
        """Construct the likely path to the docx file."""
        return os.path.join(self.data_dir, f"{source_type}-raw", f"{document_id}.docx")

    def process_document(self, document_id, source_type, protocol_date):
        docx_path = self.get_docx_path(document_id, source_type)
        if not os.path.exists(docx_path):
            return 0

        try:
            doc = docx.Document(docx_path)
        except Exception as e:
            logger.warning(f"Could not open docx {docx_path}: {e}")
            return 0

        current_speaker_name = None
        current_paragraphs = []
        utterances_added = 0

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
                        with self.conn.cursor() as cur:
                            cur.execute('''
                                INSERT INTO member_utterance (
                                    member_slug, protocol_id, source_type, protocol_date, utterance_text, word_count
                                ) VALUES (%s, %s, %s, %s, %s, %s)
                            ''', (
                                db_slug, document_id, source_type, protocol_date, text, word_count
                            ))
                        self.conn.commit()
                        utterances_added += 1
                    except Exception as e:
                        logger.error(f"Failed to insert utterance for {db_slug}: {e}")
                        self.conn.rollback()

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
        
        return utterances_added

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
            # We only process if the docx actually exists
            docx_path = self.get_docx_path(doc_id, source_type)
            if not os.path.exists(docx_path):
                continue
                
            utterances = self.process_document(doc_id, source_type, protocol_date)
            total_utterances += utterances
            
            try:
                with self.conn.cursor() as cur:
                    cur.execute('''
                        UPDATE protocol SET has_extracted_utterances = TRUE 
                        WHERE document_id = %s
                    ''', (doc_id,))
                self.conn.commit()
                processed_count += 1
            except Exception as e:
                logger.error(f"Failed to update protocol status for {doc_id}: {e}")
                self.conn.rollback()

        logger.info(f"Extracted {total_utterances} utterances from {processed_count} documents.")

if __name__ == "__main__":
    from src.python.data.database import get_db_connection
    data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "data"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    conn = get_db_connection()
    try:
        loader = UtteranceLoader(data_dir, conn)
        loader.sync()
    finally:
        conn.close()
