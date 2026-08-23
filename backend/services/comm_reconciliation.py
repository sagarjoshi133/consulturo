"""Comm V2 reconciliation reports.

Non-invasive: only READS from both legacy and V2 collections and
returns per-domain counters + sample diffs.

Called by:
  * `/api/v2/communications/admin/reconciliation/report`
  * `tests/smoke_comm8_migration.py`

Report shape:
  {
    "notifications_inbox": {
       "legacy_total": int,
       "legacy_migratable": int,        # excludes personal_message kinds
       "v2_total_from_legacy": int,     # rows whose item_type starts with 'legacy:'
       "v2_orphans": int,               # in V2 but no map row (native V2 items)
       "missing": [ {legacy_id, kind, user_id} ... up to 20 ],
       "delta": legacy_migratable - v2_total_from_legacy,
    },
    "messages": {...},
    "broadcasts": {...},
    "broadcast_recipients": {...},
  }
"""
from __future__ import annotations

from typing import Any, Dict, List

_MSG_KINDS = ["personal", "personal_message"]


async def _notifications_report(db) -> Dict[str, Any]:
    legacy_total = await db.notifications.estimated_document_count()
    legacy_migratable = await db.notifications.count_documents(
        {"kind": {"$nin": _MSG_KINDS}}
    )
    v2_from_legacy = await db.comm_inbox_items.count_documents(
        {"item_type": {"$regex": "^legacy:"}}
    )
    # Sample missing rows: legacy notifications with no migration map row.
    mapped_ids = set()
    async for m in db.comm_migration_map.find(
        {"source_collection": "notifications"},
        {"_id": 0, "source_id": 1},
    ).limit(200000):
        if m.get("source_id"):
            mapped_ids.add(m["source_id"])
    missing: List[Dict[str, Any]] = []
    async for n in db.notifications.find(
        {"kind": {"$nin": _MSG_KINDS}},
        {"_id": 0, "id": 1, "kind": 1, "user_id": 1, "created_at": 1},
    ).sort("created_at", 1).limit(50000):
        nid = n.get("id")
        if nid and nid not in mapped_ids:
            missing.append({"legacy_id": nid, "kind": n.get("kind"),
                             "user_id": n.get("user_id")})
        if len(missing) >= 20:
            break
    return {
        "legacy_total": int(legacy_total),
        "legacy_migratable": int(legacy_migratable),
        "v2_total_from_legacy": int(v2_from_legacy),
        "missing_sample": missing,
        "delta": int(legacy_migratable) - int(v2_from_legacy),
        "ok": int(legacy_migratable) == int(v2_from_legacy),
    }


async def _messages_report(db) -> Dict[str, Any]:
    legacy_total = await db.notifications.count_documents(
        {"kind": {"$in": _MSG_KINDS}}
    )
    v2_total = await db.comm_messages.count_documents({"migrated_from_legacy": True})
    convo_total = await db.comm_conversations.count_documents({})
    # Non-migratable = neither party is a patient. We can't easily
    # cheap-count without join; expose the mapped count instead.
    mapped_count = await db.comm_migration_map.count_documents(
        {"source_collection": "notifications_personal"}
    )
    return {
        "legacy_personal_total": int(legacy_total),
        "v2_migrated_messages": int(v2_total),
        "v2_conversations": int(convo_total),
        "mapped_rows": int(mapped_count),
        "delta_mapped_vs_v2": int(mapped_count) - int(v2_total),
        "ok": int(mapped_count) == int(v2_total),
    }


async def _broadcasts_report(db) -> Dict[str, Any]:
    legacy_total = await db.broadcasts.estimated_document_count()
    v2_total = await db.comm_broadcasts.estimated_document_count()
    v2_from_legacy = await db.comm_broadcasts.count_documents(
        {"migrated_from_legacy": True}
    )
    # Per-status breakdown legacy vs V2 (migrated only).
    async def _bucket(coll, field: str, filt: Dict[str, Any]) -> Dict[str, int]:
        out: Dict[str, int] = {}
        async for row in coll.aggregate([
            {"$match": filt},
            {"$group": {"_id": f"${field}", "n": {"$sum": 1}}},
        ]):
            out[str(row["_id"])] = int(row["n"])
        return out

    legacy_by_status = await _bucket(db.broadcasts, "status", {})
    v2_by_state_from_legacy = await _bucket(
        db.comm_broadcasts, "state", {"migrated_from_legacy": True}
    )
    mapped = await db.comm_migration_map.count_documents(
        {"source_collection": "broadcasts"}
    )
    return {
        "legacy_total": int(legacy_total),
        "legacy_by_status": legacy_by_status,
        "v2_total": int(v2_total),
        "v2_from_legacy": int(v2_from_legacy),
        "v2_by_state_from_legacy": v2_by_state_from_legacy,
        "mapped_rows": int(mapped),
        "delta_legacy_vs_v2": int(legacy_total) - int(v2_from_legacy),
        "ok": int(legacy_total) == int(v2_from_legacy),
    }


async def _broadcast_recipients_report(db) -> Dict[str, Any]:
    try:
        legacy_total = await db.broadcast_inbox.estimated_document_count()
    except Exception:
        legacy_total = 0
    v2_total = await db.comm_broadcast_recipients.estimated_document_count()
    v2_from_legacy = await db.comm_broadcast_recipients.count_documents(
        {"migrated_from_legacy": True}
    )
    mapped = await db.comm_migration_map.count_documents(
        {"source_collection": "broadcast_inbox"}
    )
    return {
        "legacy_total": int(legacy_total),
        "v2_total": int(v2_total),
        "v2_from_legacy": int(v2_from_legacy),
        "mapped_rows": int(mapped),
        "delta_legacy_vs_v2": int(legacy_total) - int(v2_from_legacy),
        "ok": int(legacy_total) == int(v2_from_legacy),
    }


async def build_report(db) -> Dict[str, Any]:
    """Overall reconciliation report. Non-invasive."""
    notif = await _notifications_report(db)
    msgs = await _messages_report(db)
    bcast = await _broadcasts_report(db)
    recips = await _broadcast_recipients_report(db)
    all_ok = bool(notif.get("ok") and msgs.get("ok")
                    and bcast.get("ok") and recips.get("ok"))
    return {
        "ok": all_ok,
        "notifications_inbox": notif,
        "messages": msgs,
        "broadcasts": bcast,
        "broadcast_recipients": recips,
    }
