"""
Knesset API Server — entry point.

Dev (Windows):  python src/python/server.py
Prod (Linux):   gunicorn --workers 4 --threads 2 wsgi:app
"""
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

from src.python.api import create_app

# Configuration Environment Variables
PORT = int(os.environ.get('PORT', 3001))
SERVER_THREADS = int(os.environ.get('SERVER_THREADS', 8))


app = create_app()

if __name__ == "__main__":
    import logging
    from waitress import serve

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    port = PORT
    logging.getLogger("KnessetServer").info(f"Starting on http://0.0.0.0:{port} (Waitress, 8 threads)")
    serve(app, host="0.0.0.0", port=port, threads=SERVER_THREADS)
