"""
Migration: Import existing member-analysis JSON files into the member_analysis table.

The JS files use slug format: {party}--{member-name-hyphenated}
We match against DB member name + party name by normalising spaces → hyphens.

Priority: prefer 'analysis-small' files; fall back to 'analysis' (full) files.
"""
import os
import sys
import json
import unicodedata

sys.stdout.reconfigure(encoding='utf-8')

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))
load_dotenv(os.path.join(project_root, '.env.local'), override=True)

from src.python.data.database import get_db_connection
from psycopg2.extras import Json

ANALYSES_DIR = os.path.join(project_root, 'data', 'member-analyses')


def normalize_slug_part(text):
    """
    Convert member/party name to the hyphenated form used in JS slugs.
    The JS code uses sanitizeFilename then replaces spaces with hyphens.
    Key transformations:
      - Strip quotes (" ' ״ ׳)
      - Replace runs of non-alpha/digit/space with space
      - Collapse spaces, strip, lowercase, replace space with hyphen
    """
    if not text:
        return ''
    # Remove Hebrew geresh/gershayim and standard quotes
    text = text.replace('"', '').replace("'", '').replace('״', '').replace('׳', '').replace('\"', '')
    # Replace any non-letter/digit/space characters with a space
    import re
    text = re.sub(r'[^\w\s]', ' ', text, flags=re.UNICODE)
    # Collapse whitespace, lowercase, convert spaces to hyphens
    text = re.sub(r'\s+', ' ', text).strip().lower().replace(' ', '-')
    return text


def js_slug_from_db(name, party_name):
    """Reconstruct the JS slug format: {party}--{member-name}"""
    return f"{normalize_slug_part(party_name)}--{normalize_slug_part(name)}"


def load_analysis_files():
    """
    Returns dict: js_slug -> (file_path, is_small, data)
    Prefers 'analysis-small' over 'analysis' (full).
    """
    results = {}
    if not os.path.isdir(ANALYSES_DIR):
        print(f"ERROR: Directory not found: {ANALYSES_DIR}")
        return results

    for filename in sorted(os.listdir(ANALYSES_DIR)):
        if not filename.endswith('.json'):
            continue
        filepath = os.path.join(ANALYSES_DIR, filename)
        try:
            with open(filepath, encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            print(f"  SKIP (unreadable): {filename}: {e}")
            continue

        js_slug = data.get('memberSlug', '')
        if not js_slug:
            print(f"  SKIP (no memberSlug): {filename}")
            continue

        is_small = data.get('sourceType') == 'small'

        # Keep best file per slug: small beats full
        existing = results.get(js_slug)
        if existing is None or (is_small and not existing[1]):
            results[js_slug] = (filepath, is_small, data)

    return results


def main():
    conn = get_db_connection()
    cur = conn.cursor()

    # Build lookup: js_slug -> db_slug
    cur.execute("""
        SELECT m.slug, m.name, p.name
        FROM member m
        LEFT JOIN party p ON m.party_id = p.id
    """)
    db_members = cur.fetchall()

    js_to_db = {}
    name_to_db = {}  # fallback: normalized member name -> db_slug
    for db_slug, name, party_name in db_members:
        key = js_slug_from_db(name, party_name)
        js_to_db[key] = db_slug
        # Fallback: just the name part (after the '--' separator)
        name_key = normalize_slug_part(name)
        name_to_db[name_key] = db_slug

    print(f"DB members: {len(db_members)}")

    analysis_files = load_analysis_files()
    print(f"Analysis JSON files (unique slugs): {len(analysis_files)}")

    matched = 0
    skipped_no_match = 0
    skipped_no_analysis = 0

    for js_slug, (filepath, is_small, data) in sorted(analysis_files.items()):
        db_slug = js_to_db.get(js_slug)
        if not db_slug:
            # Fallback: match by member name part only (handles parties with special chars)
            name_part = js_slug.split('--', 1)[-1] if '--' in js_slug else js_slug
            db_slug = name_to_db.get(name_part)
        if not db_slug:
            print(f"  NO MATCH: js_slug={js_slug}")
            skipped_no_match += 1
            continue

        # Extract the actual analysis payload — it's nested under 'analysis' or 'profile' key
        analysis_payload = data.get('analysis') or data.get('profile')
        if not analysis_payload:
            # Sometimes the whole object IS the analysis (older format)
            # Strip metadata keys and treat the rest as the payload
            meta_keys = {
                'version', 'sourceType', 'sourceLabel', 'memberSlug', 'memberName',
                'partyName', 'generatedAt', 'startedAt', 'provider', 'model',
                'sourceUtterancePath', 'sourceUtteranceGeneratedAt',
            }
            analysis_payload = {k: v for k, v in data.items() if k not in meta_keys}

        if not analysis_payload:
            print(f"  SKIP (no analysis payload): {js_slug}")
            skipped_no_analysis += 1
            continue

        model = data.get('model', 'unknown')
        generated_at = data.get('generatedAt')

        cur.execute("""
            INSERT INTO member_analysis
                (member_slug, analysis_summary, analysis_model, last_analyzed_at, updated_at)
            VALUES (%s, %s, %s,
                COALESCE(%s::timestamptz, NOW()),
                NOW()
            )
            ON CONFLICT (member_slug) DO UPDATE SET
                analysis_summary  = EXCLUDED.analysis_summary,
                analysis_model    = EXCLUDED.analysis_model,
                last_analyzed_at  = EXCLUDED.last_analyzed_at,
                updated_at        = NOW()
        """, (db_slug, Json(analysis_payload), model, generated_at))

        scope = 'small' if is_small else 'full'
        print(f"  OK [{scope}]: {data.get('memberName', js_slug)} -> {db_slug}")
        matched += 1

    conn.commit()
    cur.close()
    conn.close()

    print()
    print(f"=== Done ===")
    print(f"Imported:       {matched}")
    print(f"No DB match:    {skipped_no_match}")
    print(f"No payload:     {skipped_no_analysis}")


if __name__ == '__main__':
    main()
