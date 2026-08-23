"""Comm V2 legacy `broadcasts` + `broadcast_inbox` → V2 collections.

Rerunnable & idempotent. Uses `comm_migration_map` to dedupe on
(source_collection, source_id). Never touches or mutates legacy rows —
only reads and copies.

Runs on every boot but bails out fast once the marker
`_status:broadcasts_backfilled` is present.

Mapping (legacy → v2):
    broadcasts.broadcast_id                  → comm_broadcasts.id
    broadcasts.title / body                  → comm_broadcasts.title / body
    broadcasts.target ∈ {all,patients,staff} → audience_mode
        all      → "both"
        patients → "patients"
        staff    → "staff"
    broadcasts.status                        → state
        pending_approval → "pending_approval"
        approved         → "approved"
        sent             → "completed"
        rejected         → "rejected"
    author_id                                → created_by_user_id
    approved_by / approved_at                → approved_by_user_id / approved_at
    rejected_by / rejected_at / reject_reason→ rejected_by_user_id / rejected_at / rejection_reason
    sent_at                                  → dispatch_completed_at & frozen_at (best-effort)
    sent_count                               → recipient_count_frozen

    broadcast_inbox.inbox_id                 → comm_broadcast_recipients.id (regenerated)
    broadcast_inbox.broadcast_id / user_id   → same fields on v2 recipient row
    read_at                                  → read_at (also app_opened_at because legacy
                                                mixed those two states)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

_STATUS_MAP = {
    "pending_approval": "pending_approval",
    "approved":         "approved",
    "sent":             "completed",
    "rejected":         "rejected",
}
_TARGET_MAP = {
    "all":      "both",
    "patients": "patients",
    "staff":    "staff",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _already_completed(db, marker: str) -> bool:
    row = await db.comm_migration_map.find_one(
        {"source_collection": "_status", "source_id": marker},
        {"_id": 0, "created_at": 1},
    )
    return bool(row)


async def _mark_completed(db, *, marker: str, count: int) -> None:
    await db.comm_migration_map.update_one(
        {"source_collection": "_status", "source_id": marker},
        {"$set": {"source_collection": "_status", "source_id": marker,
                   "target_id": None, "count": count,
                   "created_at": _now()}},
        upsert=True,
    )


async def _backfill_broadcasts(db) -> Dict[str, Any]:
    scanned = 0
    mirrored = 0
    skipped = 0
    errors = 0
    cursor = db.broadcasts.find({}, {"_id": 0}).sort("created_at", 1)
    async for doc in cursor:
        scanned += 1
        try:
            legacy_id = doc.get("broadcast_id")
            if not legacy_id:
                skipped += 1
                continue
            # Idempotency
            mapped = await db.comm_migration_map.find_one(
                {"source_collection": "broadcasts", "source_id": legacy_id},
                {"_id": 0, "target_id": 1},
            )
            if mapped:
                skipped += 1
                continue
            state = _STATUS_MAP.get((doc.get("status") or "").lower(), "draft")
            audience_mode = _TARGET_MAP.get((doc.get("target") or "").lower(), "both")
            now = _now()
            v2_id = legacy_id  # reuse legacy id — no collision because prefix is `bc_`
            v2 = {
                "id": v2_id,
                "state": state,
                "title": (doc.get("title") or "")[:200],
                "body": (doc.get("body") or "")[:4000],
                "category": "announcements",
                "audience_mode": audience_mode,
                "selected_patient_user_ids": [],
                "scheduled_at": None,
                "action_type": "open_broadcast",
                "created_by_user_id": doc.get("author_id"),
                "created_by_role": None,
                "approved_by_user_id": doc.get("approved_by"),
                "approved_at": doc.get("approved_at"),
                "rejected_by_user_id": doc.get("rejected_by"),
                "rejected_at": doc.get("rejected_at"),
                "rejection_reason": doc.get("reject_reason"),
                "cancelled_by_user_id": None,
                "cancelled_at": None,
                "dispatch_started_at": doc.get("sent_at"),
                "dispatch_completed_at": doc.get("sent_at"),
                "frozen_at": doc.get("approved_at") or doc.get("sent_at"),
                "recipient_count_frozen": int(doc.get("sent_count") or 0),
                "created_at": doc.get("created_at") or now,
                "updated_at": doc.get("sent_at") or doc.get("approved_at")
                                or doc.get("created_at") or now,
                "schema_version": 1,
                "migrated_from_legacy": True,
                "legacy_clinic_id": doc.get("clinic_id"),
            }
            try:
                await db.comm_broadcasts.insert_one(v2)
                mirrored += 1
            except Exception:
                # already inserted (partial re-run); still record map row
                pass
            await db.comm_migration_map.update_one(
                {"source_collection": "broadcasts", "source_id": legacy_id},
                {"$set": {"source_collection": "broadcasts",
                           "source_id": legacy_id,
                           "target_id": v2_id,
                           "target_collection": "comm_broadcasts",
                           "created_at": _now()}},
                upsert=True,
            )
        except Exception:
            errors += 1
    return {"scanned": scanned, "mirrored": mirrored,
            "skipped": skipped, "errors": errors}


async def _backfill_recipients(db) -> Dict[str, Any]:
    """Copy `broadcast_inbox` rows into `comm_broadcast_recipients`.

    Best-effort: we treat every legacy row as `provider_accepted`
    because the legacy path only wrote to broadcast_inbox AFTER the
    push send call — that's the closest V2 delivery_status. Excluded
    recipients simply don't exist in legacy data.
    """
    scanned = 0
    mirrored = 0
    skipped = 0
    errors = 0
    try:
        exists = await db.broadcast_inbox.estimated_document_count()
    except Exception:
        exists = 0
    if not exists:
        return {"scanned": 0, "mirrored": 0, "skipped": 0, "errors": 0,
                "note": "broadcast_inbox collection empty or missing"}

    async for doc in db.broadcast_inbox.find({}, {"_id": 0}).sort("created_at", 1):
        scanned += 1
        try:
            legacy_id = doc.get("inbox_id")
            bid = doc.get("broadcast_id")
            uid = doc.get("user_id")
            if not (legacy_id and bid and uid):
                skipped += 1
                continue
            mapped = await db.comm_migration_map.find_one(
                {"source_collection": "broadcast_inbox", "source_id": legacy_id},
                {"_id": 0, "target_id": 1},
            )
            if mapped:
                skipped += 1
                continue
            new_id = str(uuid.uuid4())
            read_at = doc.get("read_at")
            row = {
                "id": new_id,
                "broadcast_id": bid,
                "user_id": uid,
                "role": None,
                "has_active_installation_at_freeze": False,
                "excluded_reason": None,
                "delivery_status": "provider_accepted",   # legacy inbox rows
                                                            # were only written
                                                            # AFTER send()
                "inbox_item_id": None,
                "push_event_id": None,
                "provider_accepted_at": doc.get("created_at"),
                "provider_error_code": None,
                "app_opened_at": read_at,
                "read_at": read_at,
                "created_at": doc.get("created_at") or _now(),
                "migrated_from_legacy": True,
            }
            try:
                await db.comm_broadcast_recipients.insert_one(row)
                mirrored += 1
            except Exception:
                # unique(broadcast_id,user_id) collision — already exists
                pass
            await db.comm_migration_map.update_one(
                {"source_collection": "broadcast_inbox", "source_id": legacy_id},
                {"$set": {"source_collection": "broadcast_inbox",
                           "source_id": legacy_id,
                           "target_id": new_id,
                           "target_collection": "comm_broadcast_recipients",
                           "created_at": _now()}},
                upsert=True,
            )
        except Exception:
            errors += 1

    return {"scanned": scanned, "mirrored": mirrored,
            "skipped": skipped, "errors": errors}


async def run_broadcasts_backfill(db, *, force: bool = False) -> Dict[str, Any]:
    if not force and await _already_completed(db, "broadcasts_backfilled"):
        return {"skipped": "already_backfilled"}
    bcasts = await _backfill_broadcasts(db)
    recips = await _backfill_recipients(db)
    total = int(bcasts.get("mirrored", 0)) + int(recips.get("mirrored", 0))
    await _mark_completed(db, marker="broadcasts_backfilled", count=total)
    return {"broadcasts": bcasts, "recipients": recips}
