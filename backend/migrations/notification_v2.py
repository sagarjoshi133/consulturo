"""ConsultUro 2.0 — Phase B migration shim (Mongo-first).

Runs on every boot:
  • Ensures indexes for the three new collections
    (device_installations, notification_inbox, notification_outbox).

Runs ONCE (guarded by schema_migrations):
  • Backfills device_installations from legacy push_tokens rows that
    carry a native device_token. Rows without installation_id get a
    synthetic "legacy:<token-prefix>" key so future real registrations
    from the same install supersede them naturally.
  • Backfills notification_inbox from the last 60 days of the legacy
    notifications collection (capped at 2000 rows).

Idempotent and non-destructive — legacy collections are never touched.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from db import db

MIGRATION_NAME = "002_notification_v2_backfill"


async def run_notification_v2_migration() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    summary: Dict[str, Any] = {"indexes": "ok"}

    # ── Indexes (idempotent, every boot) ─────────────────────────────
    try:
        await db.device_installations.create_index(
            [("user_id", 1), ("installation_id", 1)], unique=True
        )
        await db.device_installations.create_index("last_seen_at")
        await db.notification_inbox.create_index([("user_id", 1), ("created_at", -1)])
        await db.notification_inbox.create_index([("user_id", 1), ("read", 1)])
        await db.notification_outbox.create_index([("status", 1), ("next_attempt_at", 1)])
        await db.notification_outbox.create_index("created_at")
    except Exception as e:
        summary["indexes"] = f"error: {str(e)[:200]}"

    # ── One-time backfill ────────────────────────────────────────────
    done = await db.schema_migrations.find_one({"name": MIGRATION_NAME})
    if done:
        summary["backfill"] = "already_applied"
        return summary

    installs = 0
    async for t in db.push_tokens.find(
        {"device_token": {"$exists": True, "$nin": [None, ""]}}, {"_id": 0}
    ):
        uid = t.get("user_id")
        tok = t.get("device_token")
        if not uid or not tok:
            continue
        inst = t.get("installation_id") or f"legacy:{tok[:48]}"
        try:
            await db.device_installations.update_one(
                {"user_id": uid, "installation_id": inst},
                {
                    "$set": {
                        "user_id": uid,
                        "installation_id": inst,
                        "platform": t.get("platform") or "android",
                        "device_token": tok,
                        "transport": t.get("transport") or "emergent_native",
                        "email": t.get("email"),
                        "role": t.get("role"),
                        "last_seen_at": t.get("updated_at") or now,
                    },
                    "$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "created_at": t.get("created_at") or now,
                        "backfilled": True,
                    },
                },
                upsert=True,
            )
            installs += 1
        except Exception:
            continue
    summary["device_installations_backfilled"] = installs

    inbox = 0
    cutoff = now - timedelta(days=60)
    rows = await db.notifications.find(
        {"created_at": {"$gte": cutoff}}, {"_id": 0}
    ).sort("created_at", -1).to_list(length=2000)
    for n in rows:
        if not n.get("id") or not n.get("user_id"):
            continue
        try:
            await db.notification_inbox.update_one(
                {"id": n["id"]},
                {"$setOnInsert": {**n, "source_type": "notification", "backfilled": True}},
                upsert=True,
            )
            inbox += 1
        except Exception:
            continue
    summary["notification_inbox_backfilled"] = inbox

    await db.schema_migrations.insert_one({
        "name": MIGRATION_NAME,
        "applied_at": now,
        **{k: v for k, v in summary.items() if k != "indexes"},
    })
    summary["backfill"] = "applied"
    return summary
