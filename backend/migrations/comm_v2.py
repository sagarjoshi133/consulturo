"""Communications V2 — MongoDB collection bootstrap.

Creates the `comm_*` collections' indexes ONCE per process. Idempotent
and safe on every boot. Never touches legacy collections and never
writes documents (only indexes).

Runs from server.py startup alongside the existing V1 migration shim.
"""
from __future__ import annotations

from typing import Any, Dict, List

from pymongo import ASCENDING, DESCENDING


async def _ensure_indexes(coll, specs: List[Dict[str, Any]]) -> List[str]:
    """Create each index in `specs` if it isn't already present by name.
    Each spec dict must include: {"name": str, "keys": [(field, dir), ...]}
    plus any pymongo kwargs (unique, sparse, partialFilterExpression, ...).
    Returns list of index names that were newly created (for logging).
    """
    existing = set()
    async for idx in coll.list_indexes():
        existing.add(idx.get("name"))
    created: List[str] = []
    for spec in specs:
        name = spec["name"]
        if name in existing:
            continue
        keys = spec["keys"]
        opts = {k: v for k, v in spec.items() if k not in ("name", "keys")}
        try:
            await coll.create_index(keys, name=name, **opts)
            created.append(name)
        except Exception as e:
            # Never crash the boot loop for an index cosmetic conflict.
            print(f"[comm_v2] skipped {coll.name}.{name}: {e}")
    return created


async def run_comm_v2_migration(db) -> Dict[str, Any]:
    """Bootstrap indexes for every Comm V2 collection.

    Returns {collection_name: [created_index_names]} for observability.
    """
    plan: Dict[str, List[Dict[str, Any]]] = {
        "comm_installations": [
            {"name": "installations_provider_tokenhash_unique",
             "keys": [("provider", ASCENDING), ("token_hash", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"token_hash": {"$type": "string"}}},
            {"name": "installations_user_status_lastseen",
             "keys": [("user_id", ASCENDING), ("status", ASCENDING), ("last_seen_at", DESCENDING)]},
            {"name": "installations_installation_id",
             "keys": [("installation_id", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"installation_id": {"$type": "string"}}},
        ],
        "comm_notification_preferences": [
            {"name": "prefs_user_unique",
             "keys": [("user_id", ASCENDING)], "unique": True},
        ],
        "comm_inbox_items": [
            {"name": "inbox_user_type_source_unique",
             "keys": [("user_id", ASCENDING), ("item_type", ASCENDING), ("source_id", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"source_id": {"$type": "string"}}},
            {"name": "inbox_user_readat_createdat",
             "keys": [("user_id", ASCENDING), ("read_at", ASCENDING), ("created_at", DESCENDING)]},
            {"name": "inbox_user_category",
             "keys": [("user_id", ASCENDING), ("category", ASCENDING), ("created_at", DESCENDING)]},
        ],
        "comm_conversations": [
            {"name": "conversations_patient_unique",
             "keys": [("patient_user_id", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"patient_user_id": {"$type": "string"}}},
            {"name": "conversations_state_updated",
             "keys": [("state", ASCENDING), ("last_activity_at", DESCENDING)]},
        ],
        "comm_conversation_participants": [
            {"name": "cp_conversation_user_unique",
             "keys": [("conversation_id", ASCENDING), ("user_id", ASCENDING)],
             "unique": True},
        ],
        "comm_messages": [
            {"name": "messages_conversation_seq",
             "keys": [("conversation_id", ASCENDING), ("sequence_number", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"sequence_number": {"$type": "int"}}},
            {"name": "messages_idempotency_unique",
             "keys": [("idempotency_key", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"idempotency_key": {"$type": "string"}}},
            {"name": "messages_conversation_created",
             "keys": [("conversation_id", ASCENDING), ("created_at", DESCENDING)]},
        ],
        "comm_message_receipts": [
            {"name": "receipts_message_participant_unique",
             "keys": [("message_id", ASCENDING), ("participant_user_id", ASCENDING)],
             "unique": True},
        ],
        "comm_attachments": [
            {"name": "attachments_message",
             "keys": [("message_id", ASCENDING)]},
        ],
        "comm_broadcasts": [
            {"name": "broadcasts_state_created",
             "keys": [("state", ASCENDING), ("created_at", DESCENDING)]},
            {"name": "broadcasts_scheduled_at",
             "keys": [("scheduled_at", ASCENDING)]},
        ],
        "comm_broadcast_recipients": [
            {"name": "bcast_recipients_broadcast_user_unique",
             "keys": [("broadcast_id", ASCENDING), ("user_id", ASCENDING)],
             "unique": True},
            {"name": "bcast_recipients_broadcast_status",
             "keys": [("broadcast_id", ASCENDING), ("delivery_status", ASCENDING)]},
        ],
        "comm_home_notices": [
            {"name": "notices_active_window_audience",
             "keys": [("is_active", ASCENDING), ("starts_at", ASCENDING),
                      ("ends_at", ASCENDING), ("audience_scope", ASCENDING)]},
        ],
        "comm_home_notice_dismissals": [
            {"name": "notice_dismissals_notice_user_unique",
             "keys": [("notice_id", ASCENDING), ("user_id", ASCENDING)],
             "unique": True},
        ],
        "comm_outbox": [
            {"name": "outbox_dedupe_unique",
             "keys": [("dedupe_key", ASCENDING)],
             "unique": True,
             "partialFilterExpression": {"dedupe_key": {"$type": "string"}}},
            {"name": "outbox_status_available_locked",
             "keys": [("status", ASCENDING), ("available_at", ASCENDING),
                      ("locked_until", ASCENDING)]},
            {"name": "outbox_event_type_created",
             "keys": [("event_type", ASCENDING), ("created_at", DESCENDING)]},
        ],
        "comm_delivery_attempts": [
            {"name": "attempts_event",
             "keys": [("event_id", ASCENDING), ("attempted_at", DESCENDING)]},
        ],
        "comm_dead_letters": [
            {"name": "dead_event_created",
             "keys": [("event_id", ASCENDING)], "unique": True,
             "partialFilterExpression": {"event_id": {"$type": "string"}}},
            {"name": "dead_created",
             "keys": [("created_at", DESCENDING)]},
        ],
        "comm_audit_log": [
            {"name": "audit_created",
             "keys": [("created_at", DESCENDING)]},
            {"name": "audit_actor_created",
             "keys": [("actor_user_id", ASCENDING), ("created_at", DESCENDING)]},
        ],
        "comm_migration_map": [
            {"name": "migmap_source_unique",
             "keys": [("source_collection", ASCENDING), ("source_id", ASCENDING)],
             "unique": True},
        ],
        "comm_flags": [
            {"name": "flags_key_unique",
             "keys": [("key", ASCENDING)], "unique": True},
        ],
    }

    results: Dict[str, List[str]] = {}
    for coll_name, specs in plan.items():
        try:
            coll = db[coll_name]
            created = await _ensure_indexes(coll, specs)
            if created:
                results[coll_name] = created
        except Exception as e:
            print(f"[comm_v2] {coll_name} bootstrap failed: {e}")

    # Detect transaction capability so downstream code can gate atomic writes.
    txn_capable = False
    try:
        info = await db.command("hello")
        if info.get("setName") or (info.get("msg") == "isdbgrid"):
            txn_capable = True
    except Exception:
        pass
    await db.comm_flags.update_one(
        {"key": "_mongo_transactions_supported"},
        {"$set": {"key": "_mongo_transactions_supported", "value": bool(txn_capable)}},
        upsert=True,
    )

    return {
        "created_indexes": results,
        "transactions_supported": txn_capable,
    }
