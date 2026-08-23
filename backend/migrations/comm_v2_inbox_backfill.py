"""Comm V2 legacy → comm_inbox_items migration (Comm-3).

Rerunnable and idempotent. Uses `comm_migration_map` to dedupe on
(source_collection, source_id). Never touches legacy `notifications`
rows — only reads and copies.

Runs on every boot but bails out fast once the marker
`_status:notifications_backfilled` is present.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from services import comm_inbox


async def _already_completed(db) -> bool:
    row = await db.comm_migration_map.find_one(
        {"source_collection": "_status", "source_id": "notifications_backfilled"},
        {"_id": 0, "created_at": 1},
    )
    return bool(row)


async def _mark_completed(db, *, count: int) -> None:
    await db.comm_migration_map.update_one(
        {"source_collection": "_status", "source_id": "notifications_backfilled"},
        {"$set": {"source_collection": "_status",
                   "source_id": "notifications_backfilled",
                   "target_id": None, "count": count,
                   "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )


async def run_notifications_backfill(db, *, force: bool = False) -> Dict[str, Any]:
    """Copy legacy `db.notifications` rows into `comm_inbox_items`.

    Idempotent — each source row is only ever mirrored once thanks to
    the unique (user_id, item_type, source_id) index + migration_map.
    """
    if not force and await _already_completed(db):
        return {"skipped": "already_backfilled"}

    scanned = 0
    mirrored = 0
    skipped_messages = 0
    errors = 0
    cursor = db.notifications.find({}, {"_id": 0}).sort("created_at", 1)
    async for doc in cursor:
        scanned += 1
        try:
            legacy_id = doc.get("id")
            if not legacy_id:
                continue
            # Already mirrored?
            map_row = await db.comm_migration_map.find_one(
                {"source_collection": "notifications", "source_id": legacy_id},
                {"_id": 0, "target_id": 1},
            )
            if map_row:
                continue
            # Skip personal-message kinds — Comm-4 owns those.
            cat = comm_inbox.kind_to_category(doc.get("kind"))
            if cat is None:
                skipped_messages += 1
                continue
            mirrored_id = await comm_inbox.mirror_from_legacy(db, legacy_doc=doc)
            if mirrored_id:
                mirrored += 1
                # If the original was already-read, propagate.
                if doc.get("read"):
                    now = datetime.now(timezone.utc)
                    await db.comm_inbox_items.update_one(
                        {"id": mirrored_id},
                        {"$set": {"read_at": doc.get("read_at") or now}},
                    )
                await db.comm_migration_map.update_one(
                    {"source_collection": "notifications", "source_id": legacy_id},
                    {"$set": {
                        "source_collection": "notifications",
                        "source_id": legacy_id,
                        "target_id": mirrored_id,
                        "created_at": datetime.now(timezone.utc),
                    }},
                    upsert=True,
                )
        except Exception:
            errors += 1

    result = {
        "scanned": scanned, "mirrored": mirrored,
        "skipped_messages": skipped_messages, "errors": errors,
    }
    await _mark_completed(db, count=mirrored)
    return result
