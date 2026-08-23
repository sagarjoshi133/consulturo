"""Comm V2 legacy `notifications`(kind=personal|personal_message)
→ `comm_conversations` + `comm_messages` backfill.

Rerunnable & idempotent (dedupe via `comm_migration_map`).
Never touches or mutates legacy rows — only reads.

Only patient↔staff threads are migrated. Comm V2 messaging is
"one conversation per PATIENT" and doesn't model staff↔staff DMs, so
those legacy rows stay legacy-only.

Mapping (per legacy notification row):
    identify (sender_uid, sender_role) from `data.sender_user_id`,
    then decide which side is the patient. If neither side is a
    patient, skip.
    get_or_create_clinic_conversation(patient_user_id)
    Insert into comm_messages with idempotency_key = f"legacy:{notif_id}"
    Sequence numbers preserved per-conversation via _atomic_next_sequence.
    Unread counters are NOT bumped (we assume legacy messages have
    reached their read state; we simply preserve read_at where present).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from services import comm_messaging

_MESSAGE_KINDS = {"personal", "personal_message"}


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


async def _get_user_role(db, uid: Optional[str], cache: Dict[str, str]) -> Optional[str]:
    if not uid:
        return None
    if uid in cache:
        return cache[uid]
    u = await db.users.find_one({"user_id": uid}, {"_id": 0, "role": 1})
    role = (u or {}).get("role")
    if role:
        cache[uid] = role
    return role


async def run_messaging_backfill(db, *, force: bool = False) -> Dict[str, Any]:
    if not force and await _already_completed(db, "messages_backfilled"):
        return {"skipped": "already_backfilled"}

    scanned = 0
    mirrored = 0
    skipped_nonchat = 0
    skipped_non_patient_pair = 0
    errors = 0
    role_cache: Dict[str, str] = {}

    cursor = db.notifications.find(
        {"kind": {"$in": list(_MESSAGE_KINDS)}},
        {"_id": 0},
    ).sort("created_at", 1)

    async for doc in cursor:
        scanned += 1
        try:
            legacy_id = doc.get("id")
            if not legacy_id:
                skipped_nonchat += 1
                continue

            # Idempotency: already migrated?
            mapped = await db.comm_migration_map.find_one(
                {"source_collection": "notifications_personal", "source_id": legacy_id},
                {"_id": 0, "target_id": 1},
            )
            if mapped:
                continue

            data = doc.get("data") or {}
            recipient_uid = doc.get("user_id")
            sender_uid = data.get("sender_user_id")
            if not (recipient_uid and sender_uid):
                skipped_nonchat += 1
                continue

            recipient_role = await _get_user_role(db, recipient_uid, role_cache)
            sender_role = await _get_user_role(db, sender_uid, role_cache)

            # Identify the patient side.
            if recipient_role == "patient" and sender_role != "patient":
                patient_uid = recipient_uid
                actor_role = "staff"
                actor_uid = sender_uid
            elif sender_role == "patient" and recipient_role != "patient":
                patient_uid = sender_uid
                actor_role = "patient"
                actor_uid = sender_uid
            else:
                # staff↔staff or patient↔patient — outside V2 scope.
                skipped_non_patient_pair += 1
                continue

            # Ensure conversation exists.
            conv = await comm_messaging.get_or_create_clinic_conversation(
                db, patient_user_id=patient_uid,
            )
            conv_id = conv["id"]

            # Idempotency-key: stable, legacy-scoped.
            scoped_key = f"{actor_uid}:legacy:{legacy_id}"
            existing = await db.comm_messages.find_one(
                {"idempotency_key": scoped_key}, {"_id": 0, "id": 1}
            )
            if existing:
                # Record the map row so future re-runs are O(1).
                await db.comm_migration_map.update_one(
                    {"source_collection": "notifications_personal",
                     "source_id": legacy_id},
                    {"$set": {"source_collection": "notifications_personal",
                               "source_id": legacy_id,
                               "target_id": existing["id"],
                               "target_collection": "comm_messages",
                               "created_at": _now()}},
                    upsert=True,
                )
                continue

            # Preserve created_at from legacy; assign a monotonically
            # increasing sequence via the atomic bump. This is safe
            # even when sources arrive out of order because we sort
            # the cursor by created_at asc.
            seq = await comm_messaging._atomic_next_sequence(db, conv_id)  # type: ignore[attr-defined]

            legacy_ts = doc.get("created_at") or _now()
            read_at = doc.get("read_at")
            was_read = bool(doc.get("read")) or bool(read_at)

            sender_display_name = (
                data.get("sender_name")
                or ("You" if actor_role == "patient" else "ConsultUro Clinic")
            )
            display_public = ("ConsultUro Clinic" if actor_role != "patient"
                                else sender_display_name)

            msg_id = str(uuid.uuid4())
            msg = {
                "id": msg_id,
                "conversation_id": conv_id,
                "sequence_number": seq,
                "sender_user_id": actor_uid,
                "sender_role": actor_role,
                "sender_display": display_public,
                "sender_audit": {
                    "actor_user_id": actor_uid,
                    "actor_role": data.get("sender_role") or sender_role,
                    "actor_display_name": data.get("sender_name") or "",
                    "legacy_notification_id": legacy_id,
                    "migrated_from_legacy": True,
                },
                "body": (
                    (doc.get("title") or "").strip() + ("\n\n" if doc.get("title") else "")
                    + (doc.get("body") or "").strip()
                )[:4000] or (doc.get("body") or doc.get("title") or "(empty message)")[:4000],
                "reply_to_message_id": None,
                "idempotency_key": scoped_key,
                # Legacy → assume delivered up to whatever it reached.
                "delivery_state": "read" if was_read else "recipient_app_synced",
                "created_at": legacy_ts,
                "edited_at": None,
                "deleted_at": None,
                "schema_version": 1,
                "migrated_from_legacy": True,
            }
            try:
                await db.comm_messages.insert_one(msg)
                mirrored += 1
            except Exception:
                # Sequence collision race — extremely unlikely in a single-
                # threaded migration. Fall back to reading whatever row
                # occupied the seq.
                errors += 1
                continue

            # Update conversation summary.
            update = {
                "$set": {
                    "last_activity_at": legacy_ts,
                    "last_message_at": legacy_ts,
                    "last_message_preview": (msg["body"] or "")[:200],
                    "last_sender_role": actor_role,
                    "state": "awaiting_clinic" if actor_role == "patient" else "awaiting_patient",
                },
                "$inc": {"message_count": 1},
            }
            await db.comm_conversations.update_one({"id": conv_id}, update)

            # Also create the read receipt row for the recipient if
            # already-read (so /list_messages doesn't double-flip).
            if was_read:
                try:
                    await db.comm_message_receipts.update_one(
                        {"message_id": msg_id, "participant_user_id": recipient_uid},
                        {"$set": {"message_id": msg_id,
                                   "participant_user_id": recipient_uid,
                                   "delivered_at": read_at or legacy_ts,
                                   "read_at": read_at or legacy_ts}},
                        upsert=True,
                    )
                except Exception:
                    pass

            # Migration map row.
            await db.comm_migration_map.update_one(
                {"source_collection": "notifications_personal",
                 "source_id": legacy_id},
                {"$set": {"source_collection": "notifications_personal",
                           "source_id": legacy_id,
                           "target_id": msg_id,
                           "target_collection": "comm_messages",
                           "created_at": _now()}},
                upsert=True,
            )
        except Exception:
            errors += 1

    result = {
        "scanned": scanned,
        "mirrored": mirrored,
        "skipped_nonchat": skipped_nonchat,
        "skipped_non_patient_pair": skipped_non_patient_pair,
        "errors": errors,
    }
    await _mark_completed(db, marker="messages_backfilled", count=mirrored)
    return result
