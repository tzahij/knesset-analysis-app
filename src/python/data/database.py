import os
import psycopg2
import threading
from contextlib import contextmanager

from psycopg2 import pool

_pool = None
_pool_lock = threading.Lock()

def get_db_connection():
    """
    Returns a connection from the global ThreadedConnectionPool.
    Initializes the pool if it doesn't exist, using a lock to prevent race conditions.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                db_host = os.environ.get("PGHOST", "localhost")
                db_port = os.environ.get("PGPORT", "5432")
                db_name = os.environ.get("PGDATABASE", "knesset")
                db_user = os.environ.get("PGUSER", "postgres")
                db_pass = os.environ.get("PGPASSWORD", "sa")
                
                _pool = pool.ThreadedConnectionPool(
                    1, 20, # min/max connections
                    host=db_host,
                    port=db_port,
                    dbname=db_name,
                    user=db_user,
                    password=db_pass
                )
    
    def _get_valid_conn():
        # Try up to 3 times to get a healthy connection
        for _ in range(3):
            conn = _pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                conn.rollback()  # Reset any transaction state
                return conn
            except (psycopg2.OperationalError, psycopg2.InterfaceError):
                # Connection is dead (e.g. serverless DB closed it)
                _pool.putconn(conn, close=True)
        
        # Fallback if retries are exhausted
        return _pool.getconn()

    try:
        from flask import has_app_context, g
        if has_app_context():
            if 'db_conn' not in g:
                g.db_conn = _get_valid_conn()
            return g.db_conn
    except ImportError:
        pass
        
    return _get_valid_conn()

def release_db_connection(conn):
    """
    Returns a connection to the pool.
    In a Flask context, we let the app teardown handle this to ensure a single connection per request.
    """
    try:
        from flask import has_app_context
        if has_app_context():
            return
    except ImportError:
        pass

    if _pool and conn:
        _pool.putconn(conn)

@contextmanager
def db_connection():
    """
    Context manager that yields a database connection and guarantees
    its safe release back to the pool (or closure) when the block exits.
    """
    conn = get_db_connection()
    try:
        yield conn
    finally:
        release_db_connection(conn)

