"""ConsultUro — Mongo client + db handle.

Single import target for every router/service module so we don't
re-instantiate the Motor client on every import. Keeps the same
behaviour as the original `client = AsyncIOMotorClient(MONGO_URL); db
= client[DB_NAME]` in server.py.

NOTE: server.py still maintains its own `client` / `db` references
for backward compatibility. The two point at the same Mongo
instance — Motor's connection pool is process-wide.
"""
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
# DB_NAME MUST be provided by the environment. We deliberately do
# NOT ship a hardcoded fallback so a deploy that forgot to set it
# fails fast instead of silently booting against the wrong database.
DB_NAME = os.environ.get("DB_NAME")
if not DB_NAME:
    raise RuntimeError(
        "DB_NAME env var is required. Set DB_NAME in the deployment "
        "environment (or in backend/.env for local dev)."
    )

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]
