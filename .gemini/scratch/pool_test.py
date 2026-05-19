import psycopg2.pool
import os

db_host = os.environ.get("PGHOST", "localhost")
db_user = os.environ.get("PGUSER", "postgres")
db_pass = os.environ.get("PGPASSWORD", "sa")
db_name = os.environ.get("PGDATABASE", "knesset")
db_port = os.environ.get("PGPORT", "5432")

pool = psycopg2.pool.ThreadedConnectionPool(1, 20, host=db_host, user=db_user, password=db_pass, dbname=db_name, port=db_port)

conn1 = pool.getconn()
conn2 = pool.getconn()

print("conn1:", id(conn1))
print("conn2:", id(conn2))

pool.putconn(conn2)
try:
    pool.putconn(conn1)
    print("success")
except Exception as e:
    print("ERROR:", e)

try:
    pool.putconn(conn1)
except Exception as e:
    print("SECOND ERROR:", e)
