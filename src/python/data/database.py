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
    
    try:
        from flask import has_app_context, g
        if has_app_context():
            if 'db_conn' not in g:
                g.db_conn = _pool.getconn()
            return g.db_conn
    except ImportError:
        pass
        
    return _pool.getconn()

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

