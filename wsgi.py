"""
Gunicorn WSGI entry point for Linux production.

Usage:
    gunicorn --workers 4 --threads 2 --bind 0.0.0.0:3000 wsgi:app
"""
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.python.api import create_app

app = create_app()
