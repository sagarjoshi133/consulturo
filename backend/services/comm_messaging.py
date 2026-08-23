"""Comm V2 — Patient ↔ Clinic Messaging.

Per spec:
    - One persistent "ConsultUro Clinic" conversation per patient
      (unique index on comm_conversations.patient_user_id).
    - Conversation states: open / awaiting_clinic / awaiting_patient /
      escalated_to_doctor / resolved / archived.
    - Message states: saved → recipient_inbox_created → push_queued →
      provider_accepted → recipient_app_synced → read. Delivery is
      NEVER declared solely on FCM 200.
    - Idempotency-Key REQUIRED for message create.
    - Patient can only access their own conversation. No
      patient-to-patient messaging.
    - Reception / nursing / doctor may reply on behalf of the "Clinic";
      the actual actor identity stays in `sender_audit` so we can prove
      who wrote what during any compliance review.
"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# ── State machines ──────────────────────────────────────────────

CONVERSATION_STATES = {
    "open",
    "awaiting_clinic",
    "awaiting_patient",
    "escalated_to_doctor",
    "resolved",
    "archived",
}

# state transitions the API allows (from → allowed to-states).
# NOTE: patient sending resets to awaiting_clinic; staff sending to
# awaiting_patient (business rule, applied in send_message, not by
# the caller).
_ALLOWED_TRANSITIONS = {
    "open":                {"awaiting_clinic", "awaiting_patient", "resolved", "archived"},
    "awaiting_clinic":     {"awaiting_patient", "escalated_to_doctor", "resolved", "archived"},
    "awaiting_patient":    {"awaiting_clinic", "escalated_to_doctor", "resolved", "archived"},
    "escalated_to_doctor": {"awaiting_patient", "awaiting_clinic", "resolved", "archived"},
    "resolved":            {"awaiting_clinic", "awaiting_patient", "open", "archived"},  # reopen
    "archived":            {"open", "awaiting_clinic", "awaiting_patient"},              # reopen
}

MESSAGE_STATES = [
    "saved",
    "recipient_inbox_created",
    "push_queued",
    "provider_accepted",
    "recipient_app_synced",
    "read",
]
_STATE_RANK = {s: i for i, s in enumerate(MESSAGE_STATES)}


def _now() -> datetime:
    return datetime.now(timezone.utc)


OWNER_TIER = {"super_owner", "primary_owner", "owner", "partner"}
STAFF_TIER = {"super_owner", "primary_owner", "owner", "partner",
               "doctor", "assistant", "reception", "nursing"}


def _sender_role(user: Dict[str, Any]) -> str:
    r = (user or {}).get("role") or ""
    if r == "patient":
        return "patient"
    if r in {"super_owner", "primary_owner", "owner", "partner", "doctor"}:
        return "doctor"       # any owner-tier + doctor can act as "doctor" in escalations
    if r in STAFF_TIER:
        return "staff"
    return "patient"          # fall-through: treat unknown role as patient


# ── Conversation get-or-create ──────────────────────────────────

async def get_or_create_clinic_conversation(db, *, patient_user_id: str) -> Dict[str, Any]:
    """Idempotent — one conversation per patient. Racy inserts collide
    on the unique(patient_user_id) index; whichever loses the race
    reads the row that won."""
    existing = await db.comm_conversations.find_one(
        {"patient_user_id": patient_user_id}, {"_id": 0},
    )
    if existing:
        return existing
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "patient_user_id": patient_user_id,
        "state": "open",
        "assigned_to_user_id": None,
        "last_activity_at": now,
        "last_message_at": None,
        "last_message_preview": None,
        "last_sender_role": None,
        "next_sequence_number": 1,
        "unread_for_patient": 0,
        "unread_for_clinic": 0,
        "message_count": 0,
        "created_at": now,
        "schema_version": 1,
    }
    try:
        await db.comm_conversations.insert_one(doc)
        # Also register the patient as a participant so cross-listing works.
        await db.comm_conversation_participants.update_one(
            {"conversation_id": doc["id"], "user_id": patient_user_id},
            {"$set": {
                "conversation_id": doc["id"],
                "user_id": patient_user_id,
                "role_in_conversation": "patient",
                "joined_at": now,
            }},
            upsert=True,
        )
        return doc
    except Exception:
        # Race — read the winner.
        return await db.comm_conversations.find_one(
            {"patient_user_id": patient_user_id}, {"_id": 0}) or doc


async def get_conversation(db, conversation_id: str) -> Optional[Dict[str, Any]]:
    return await db.comm_conversations.find_one(
        {"id": conversation_id}, {"_id": 0},
    )


async def _can_access_conversation(db, *, user: Dict[str, Any],
                                    conv: Dict[str, Any]) -> bool:
    """Patients: only their own. Staff/owner-tier: any conversation."""
    role = (user or {}).get("role") or ""
    uid = user.get("user_id") or user.get("id")
    if role in STAFF_TIER:
        return True
    return conv.get("patient_user_id") == uid


# ── Conversation list ──────────────────────────────────────────

def _encode_cursor(sort_key: Any, item_id: str) -> str:
    if isinstance(sort_key, datetime):
        sort_key = sort_key.isoformat()
    payload = json.dumps({"k": sort_key, "i": item_id})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> Optional[Tuple[Any, str]]:
    if not cursor:
        return None
    try:
        pad = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode((cursor + pad).encode()))
        k = payload.get("k")
        try:
            k = datetime.fromisoformat(k)
        except Exception:
            pass
        return k, str(payload["i"])
    except Exception:
        return None


async def list_conversations(
    db,
    *,
    user: Dict[str, Any],
    limit: int = 30,
    cursor: Optional[str] = None,
    state: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = None,
) -> Dict[str, Any]:
    """Staff view: paginate ALL conversations. Patient view: just their own.
    Order: unread first, then descending last_activity_at.
    """
    limit = max(1, min(100, int(limit or 30)))
    role = (user or {}).get("role") or ""
    uid = user.get("user_id") or user.get("id")

    if role not in STAFF_TIER:
        # Patient — one conversation. Cursor is a no-op.
        conv = await db.comm_conversations.find_one(
            {"patient_user_id": uid}, {"_id": 0},
        )
        items = [conv] if conv else []
        return {"items": items, "next_cursor": None, "count": len(items)}

    q: Dict[str, Any] = {}
    if state:
        if state not in CONVERSATION_STATES:
            state = None
        else:
            q["state"] = state
    if unread_only:
        q["unread_for_clinic"] = {"$gt": 0}
    if search:
        # Search on last_message_preview only — cheap on the index.
        # Anchored substring, case-insensitive.
        safe = re.escape(search.strip())[:80]
        if safe:
            q["last_message_preview"] = {"$regex": safe, "$options": "i"}

    dec = _decode_cursor(cursor)
    if dec:
        ts, iid = dec
        q["$or"] = [
            {"last_activity_at": {"$lt": ts}},
            {"last_activity_at": ts, "id": {"$lt": iid}},
        ]

    rows: List[Dict[str, Any]] = []
    async for r in db.comm_conversations.find(q, {"_id": 0}).sort([
        ("last_activity_at", -1),
        ("id", -1),
    ]).limit(limit + 1):
        rows.append(r)

    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        rows = rows[:limit]
        next_cursor = _encode_cursor(last["last_activity_at"], last["id"])

    # Enrich with patient display name (best-effort).
    if rows:
        pids = [r["patient_user_id"] for r in rows if r.get("patient_user_id")]
        users_map: Dict[str, Dict[str, Any]] = {}
        async for u in db.users.find({"user_id": {"$in": pids}},
                                       {"_id": 0, "user_id": 1, "name": 1,
                                        "email": 1, "phone": 1}):
            users_map[u["user_id"]] = u
        for r in rows:
            up = users_map.get(r.get("patient_user_id") or "") or {}
            r["patient_display_name"] = up.get("name") or up.get("email") or up.get("phone") or "Patient"

    # Unread-first: partition. (We keep the outer sort by activity so
    # in each group the newest floats up.)
    unread = [r for r in rows if (r.get("unread_for_clinic") or 0) > 0]
    read = [r for r in rows if (r.get("unread_for_clinic") or 0) == 0]
    ordered = unread + read

    return {
        "items": ordered,
        "next_cursor": next_cursor,
        "count": len(ordered),
    }


# ── Send message ───────────────────────────────────────────────

async def _atomic_next_sequence(db, conversation_id: str) -> int:
    """Bump next_sequence_number atomically and return the number to use."""
    from pymongo import ReturnDocument
    row = await db.comm_conversations.find_one_and_update(
        {"id": conversation_id},
        {"$inc": {"next_sequence_number": 1}},
        return_document=ReturnDocument.BEFORE,
        projection={"_id": 0, "next_sequence_number": 1},
    )
    if not row:
        raise ValueError("conversation_not_found")
    return int(row.get("next_sequence_number") or 1)


async def send_message(
    db,
    *,
    user: Dict[str, Any],
    conversation_id: str,
    body: str,
    idempotency_key: str,
    reply_to_message_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Persist a message. Idempotent on (sender_user_id, idempotency_key).

    Business rules applied server-side:
      - Patient send → conversation state becomes 'awaiting_clinic',
        unread_for_clinic += 1.
      - Staff/doctor send → 'awaiting_patient', unread_for_patient += 1.
      - reply_to_message_id must belong to same conversation.
      - Body length capped at 4000 chars.
      - Idempotency-Key namespaced by sender.

    Fanout (enqueued, not sent inline):
      - Recipient(s) get a comm_inbox_items row (item_type=v2_message).
      - Push event 'push.send' enqueued via the durable outbox.
      Message.delivery_state → 'push_queued'. Later the outbox handler
      may bump to 'provider_accepted' when FCM accepts, and
      /messages/{id}/read bumps to 'read' when the recipient reads.
    """
    body = (body or "").strip()
    if not body:
        raise ValueError("empty_body")
    if len(body) > 4000:
        raise ValueError("body_too_long")
    idempotency_key = (idempotency_key or "").strip()
    if len(idempotency_key) < 4 or len(idempotency_key) > 100:
        raise ValueError("bad_idempotency_key")

    conv = await get_conversation(db, conversation_id)
    if not conv:
        raise ValueError("conversation_not_found")
    if not await _can_access_conversation(db, user=user, conv=conv):
        raise PermissionError("forbidden")

    sender_uid = user.get("user_id") or user.get("id")
    sender_role = _sender_role(user)

    # Idempotency check — namespaced by sender to prevent cross-user
    # collisions on collisions on short keys.
    scoped_key = f"{sender_uid}:{idempotency_key}"
    existing = await db.comm_messages.find_one({"idempotency_key": scoped_key},
                                                 {"_id": 0})
    if existing:
        return {"idempotent": True, "message": existing,
                "conversation": conv}

    # Validate reply_to
    if reply_to_message_id:
        parent = await db.comm_messages.find_one(
            {"id": reply_to_message_id, "conversation_id": conversation_id},
            {"_id": 0, "id": 1},
        )
        if not parent:
            raise ValueError("bad_reply_to")

    seq = await _atomic_next_sequence(db, conversation_id)
    now = _now()
    msg_id = str(uuid.uuid4())
    audit = {
        "actor_user_id": sender_uid,
        "actor_role": user.get("role"),
        "actor_display_name": user.get("name") or user.get("email") or user.get("phone") or "",
    }
    msg = {
        "id": msg_id,
        "conversation_id": conversation_id,
        "sequence_number": seq,
        "sender_user_id": sender_uid,
        "sender_role": sender_role,
        # Public-facing brand name on the patient side: always "ConsultUro Clinic"
        # for any staff/doctor sender. Patients see their own name. This is what
        # the UI renders as the "from" line.
        "sender_display": "ConsultUro Clinic" if sender_role != "patient"
                            else (user.get("name") or "You"),
        "sender_audit": audit,
        "body": body,
        "reply_to_message_id": reply_to_message_id,
        "idempotency_key": scoped_key,
        "delivery_state": "saved",
        "created_at": now,
        "edited_at": None,
        "deleted_at": None,
        "schema_version": 1,
    }
    try:
        await db.comm_messages.insert_one(msg)
    except Exception:
        # Race on scoped idempotency_key.
        existing = await db.comm_messages.find_one({"idempotency_key": scoped_key},
                                                     {"_id": 0})
        if existing:
            return {"idempotent": True, "message": existing,
                    "conversation": conv}
        raise

    # ── Business-rule state + counter updates ──
    if sender_role == "patient":
        target_state = "awaiting_clinic" if conv["state"] not in ("archived",) else "awaiting_clinic"
        unread_inc = {"unread_for_clinic": 1}
    else:
        target_state = "awaiting_patient" if conv["state"] not in ("archived",) else "awaiting_patient"
        unread_inc = {"unread_for_patient": 1}

    update: Dict[str, Any] = {
        "$set": {
            "state": target_state,
            "last_activity_at": now,
            "last_message_at": now,
            "last_message_preview": body[:200],
            "last_sender_role": sender_role,
        },
        "$inc": {"message_count": 1, **unread_inc},
    }
    await db.comm_conversations.update_one({"id": conversation_id}, update)

    # ── Fanout: inbox items for the OTHER side + push outbox ──
    from services import comm_inbox, comm_outbox
    if sender_role == "patient":
        # Recipients: all owner-tier staff (kept small; Dr. Sagar / partners).
        # We keep the sender identity in sender_audit — the inbox item
        # says "New message from patient <Name>".
        patient_display = (await db.users.find_one(
            {"user_id": conv["patient_user_id"]},
            {"_id": 0, "name": 1, "email": 1, "phone": 1})) or {}
        patient_name = patient_display.get("name") or patient_display.get("email") or "Patient"
        recipient_uids: List[str] = []
        async for u in db.users.find({"role": {"$in": list(OWNER_TIER)}},
                                       {"_id": 0, "user_id": 1}):
            if u.get("user_id"):
                recipient_uids.append(u["user_id"])
    else:
        # Staff → patient
        recipient_uids = [conv["patient_user_id"]]
        patient_name = ""

    for rid in recipient_uids:
        # Inbox item (item_type=v2_message, source_id=message_id) —
        # unique index prevents duplicate rows on retries.
        title, body_gen = _inbox_title_body(sender_role=sender_role,
                                              patient_name=patient_name,
                                              preview=body)
        await comm_inbox.create_inbox_item(
            db, user_id=rid,
            category="care_updates" if sender_role == "patient" else "care_updates",
            title=title, body=body_gen,
            item_type="v2_message", source_id=msg_id,
            action_type="open_conversation", action_target=conversation_id,
            metadata={"message_id": msg_id, "conversation_id": conversation_id,
                      "sender_role": sender_role},
            priority="normal",
        )

    # Enqueue push for each recipient (generic lock-screen title —
    # spec forbids clinical detail in push body).
    push_title, push_body = _push_title_body(sender_role=sender_role,
                                                patient_name=patient_name)
    for rid in recipient_uids:
        try:
            await comm_outbox.enqueue(
                db, event_type="push.send",
                aggregate_type="v2_message", aggregate_id=msg_id,
                payload={
                    "user_id": rid,
                    "category": "messages",
                    "title": push_title,
                    "body": push_body,
                    "data": {
                        "type": "v2_message",
                        "conversation_id": conversation_id,
                        "message_id": msg_id,
                        "inbox_action": "open_conversation",
                    },
                },
                dedupe_key=f"msgpush:{msg_id}:{rid}",
                correlation_id=f"conv:{conversation_id}",
            )
        except Exception:
            pass

    # Bump delivery_state → recipient_inbox_created → push_queued.
    await db.comm_messages.update_one(
        {"id": msg_id},
        {"$set": {"delivery_state": "push_queued"}},
    )
    msg["delivery_state"] = "push_queued"

    # Refresh the conversation snapshot for the caller.
    new_conv = await get_conversation(db, conversation_id)
    return {"idempotent": False, "message": msg, "conversation": new_conv}


def _inbox_title_body(*, sender_role: str, patient_name: str,
                        preview: str) -> Tuple[str, str]:
    if sender_role == "patient":
        # Staff-facing inbox item — include the patient's identity so
        # the assignee knows who wrote it.
        return (f"New message from {patient_name}",
                (preview or "").strip()[:280])
    return ("New reply from ConsultUro Clinic",
            (preview or "").strip()[:280])


def _push_title_body(*, sender_role: str, patient_name: str) -> Tuple[str, str]:
    """Generic push copy — no clinical detail. Real content only visible
    inside the authenticated app (per Comm V2 privacy spec)."""
    if sender_role == "patient":
        who = patient_name if patient_name else "a patient"
        return ("ConsultUro — new patient message",
                f"You have a new message from {who}. Open the app to view.")
    return ("ConsultUro Clinic",
            "You have a new message. Open the app to view.")


# ── List messages ──────────────────────────────────────────────

async def list_messages(
    db,
    *,
    user: Dict[str, Any],
    conversation_id: str,
    limit: int = 40,
    cursor: Optional[str] = None,
) -> Dict[str, Any]:
    conv = await get_conversation(db, conversation_id)
    if not conv:
        raise ValueError("conversation_not_found")
    if not await _can_access_conversation(db, user=user, conv=conv):
        raise PermissionError("forbidden")

    limit = max(1, min(100, int(limit or 40)))
    q: Dict[str, Any] = {"conversation_id": conversation_id,
                          "deleted_at": None}
    dec = _decode_cursor(cursor)
    if dec:
        _, last_id = dec
        # Sequence-number cursor is more reliable than created_at.
        last_msg = await db.comm_messages.find_one({"id": last_id},
                                                    {"_id": 0, "sequence_number": 1})
        if last_msg and last_msg.get("sequence_number"):
            q["sequence_number"] = {"$lt": int(last_msg["sequence_number"])}

    rows: List[Dict[str, Any]] = []
    async for r in db.comm_messages.find(q, {"_id": 0, "idempotency_key": 0,
                                              "sender_audit": 0}).sort(
        "sequence_number", -1
    ).limit(limit + 1):
        rows.append(r)

    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        rows = rows[:limit]
        next_cursor = _encode_cursor(last.get("created_at") or _now(), last["id"])

    # Mark recipient_app_synced on messages the caller receives (i.e.
    # messages NOT sent by them) — implements the spec's contract
    # "delivered = app has synced the message", never "FCM accepted".
    uid = user.get("user_id") or user.get("id")
    to_bump = [r["id"] for r in rows if r.get("sender_user_id") != uid
               and _STATE_RANK.get(r.get("delivery_state") or "", -1)
                   < _STATE_RANK["recipient_app_synced"]]
    if to_bump:
        await db.comm_messages.update_many(
            {"id": {"$in": to_bump},
             "delivery_state": {"$in": ["saved", "recipient_inbox_created",
                                          "push_queued", "provider_accepted"]}},
            {"$set": {"delivery_state": "recipient_app_synced"}},
        )
        # Reflect the update on the rows we're about to return — the
        # DB read above is a pre-update snapshot.
        bump_set = set(to_bump)
        for r in rows:
            if r["id"] in bump_set:
                r["delivery_state"] = "recipient_app_synced"

    # Also stamp participant delivery in comm_message_receipts.
    receipts_now = _now()
    for r in rows:
        if r.get("sender_user_id") == uid:
            continue
        try:
            await db.comm_message_receipts.update_one(
                {"message_id": r["id"], "participant_user_id": uid},
                {"$set": {"message_id": r["id"],
                          "participant_user_id": uid,
                          "delivered_at": receipts_now},
                 "$setOnInsert": {"read_at": None}},
                upsert=True,
            )
        except Exception:
            pass

    # Reverse to newest-last for natural chat rendering.
    rows.reverse()
    return {"items": rows, "next_cursor": next_cursor, "count": len(rows),
            "conversation": conv}


# ── Read receipts ──────────────────────────────────────────────

async def mark_message_read(
    db,
    *,
    user: Dict[str, Any],
    message_id: str,
) -> Dict[str, Any]:
    """Mark a single message read by the current user AND decrement the
    per-side unread counter on the conversation.

    Never crosses the patient/clinic boundary: patient marking read
    only touches unread_for_patient; staff → unread_for_clinic."""
    msg = await db.comm_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise ValueError("message_not_found")
    conv = await get_conversation(db, msg["conversation_id"])
    if not conv:
        raise ValueError("conversation_not_found")
    if not await _can_access_conversation(db, user=user, conv=conv):
        raise PermissionError("forbidden")
    uid = user.get("user_id") or user.get("id")
    if msg.get("sender_user_id") == uid:
        # Reading own message is a no-op.
        return {"ok": True, "already_own_message": True}

    role = _sender_role(user)
    now = _now()

    # Was this participant already marked as having read this msg?
    rcpt = await db.comm_message_receipts.find_one(
        {"message_id": message_id, "participant_user_id": uid},
        {"_id": 0, "read_at": 1},
    )
    already_read = bool(rcpt and rcpt.get("read_at"))

    await db.comm_message_receipts.update_one(
        {"message_id": message_id, "participant_user_id": uid},
        {"$set": {"message_id": message_id,
                  "participant_user_id": uid,
                  "delivered_at": (rcpt or {}).get("delivered_at") or now,
                  "read_at": now}},
        upsert=True,
    )

    # Bump message delivery_state → read (never regresses because we
    # only bump if current state's rank is lower than 'read').
    await db.comm_messages.update_one(
        {"id": message_id,
         "delivery_state": {"$in": ["saved", "recipient_inbox_created",
                                      "push_queued", "provider_accepted",
                                      "recipient_app_synced"]}},
        {"$set": {"delivery_state": "read"}},
    )

    # Decrement per-side unread ONLY if this was a first-time read
    # AND the reader is on the OPPOSITE side from the sender.
    if not already_read:
        if role == "patient" and msg.get("sender_role") != "patient":
            await db.comm_conversations.update_one(
                {"id": conv["id"], "unread_for_patient": {"$gt": 0}},
                {"$inc": {"unread_for_patient": -1}},
            )
        elif role != "patient" and msg.get("sender_role") == "patient":
            await db.comm_conversations.update_one(
                {"id": conv["id"], "unread_for_clinic": {"$gt": 0}},
                {"$inc": {"unread_for_clinic": -1}},
            )
    return {"ok": True, "first_time_read": not already_read}


# ── State-machine transitions ──────────────────────────────────

async def _transition_state(db, *, conv_id: str, new_state: str,
                              actor: Dict[str, Any],
                              extra_set: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    conv = await get_conversation(db, conv_id)
    if not conv:
        raise ValueError("conversation_not_found")
    from_state = conv.get("state") or "open"
    if new_state not in _ALLOWED_TRANSITIONS.get(from_state, set()):
        raise ValueError(f"illegal_transition:{from_state}->{new_state}")
    now = _now()
    update = {
        "state": new_state,
        "last_activity_at": now,
    }
    if extra_set:
        update.update(extra_set)
    await db.comm_conversations.update_one({"id": conv_id}, {"$set": update})
    # Audit event — best-effort.
    try:
        from services import comm_audit
        await comm_audit.log(
            db, action=f"conversation.{new_state}",
            actor_user_id=actor.get("user_id") or actor.get("id"),
            actor_role=actor.get("role"),
            target_type="conversation", target_id=conv_id,
            metadata={"from_state": from_state, "to_state": new_state,
                      "extra": extra_set or {}},
        )
    except Exception:
        pass
    return await get_conversation(db, conv_id)


async def assign_conversation(db, *, conv_id: str,
                                 assignee_user_id: Optional[str],
                                 actor: Dict[str, Any]) -> Dict[str, Any]:
    # Only staff can assign, and assignee must be staff (or None to unassign).
    if _sender_role(actor) == "patient":
        raise PermissionError("staff_only")
    if assignee_user_id:
        assignee = await db.users.find_one({"user_id": assignee_user_id},
                                             {"_id": 0, "role": 1})
        if not assignee or assignee.get("role") not in STAFF_TIER:
            raise ValueError("assignee_not_staff")
    now = _now()
    await db.comm_conversations.update_one(
        {"id": conv_id},
        {"$set": {"assigned_to_user_id": assignee_user_id,
                  "assigned_at": now, "last_activity_at": now}},
    )
    try:
        from services import comm_audit
        await comm_audit.log(
            db, action="conversation.assign",
            actor_user_id=actor.get("user_id") or actor.get("id"),
            actor_role=actor.get("role"),
            target_type="conversation", target_id=conv_id,
            metadata={"assignee_user_id": assignee_user_id},
        )
    except Exception:
        pass
    return await get_conversation(db, conv_id)


async def escalate_to_doctor(db, *, conv_id: str,
                                actor: Dict[str, Any]) -> Dict[str, Any]:
    if _sender_role(actor) == "patient":
        raise PermissionError("staff_only")
    return await _transition_state(db, conv_id=conv_id,
                                     new_state="escalated_to_doctor",
                                     actor=actor)


async def resolve_conversation(db, *, conv_id: str,
                                 actor: Dict[str, Any]) -> Dict[str, Any]:
    if _sender_role(actor) == "patient":
        raise PermissionError("staff_only")
    return await _transition_state(db, conv_id=conv_id, new_state="resolved",
                                     actor=actor)


async def reopen_conversation(db, *, conv_id: str,
                                actor: Dict[str, Any]) -> Dict[str, Any]:
    if _sender_role(actor) == "patient":
        raise PermissionError("staff_only")
    conv = await get_conversation(db, conv_id)
    if not conv:
        raise ValueError("conversation_not_found")
    # Reopen policy: from resolved → awaiting_clinic; from archived → open.
    if conv["state"] == "archived":
        target = "open"
    else:
        target = "awaiting_clinic"
    return await _transition_state(db, conv_id=conv_id, new_state=target,
                                     actor=actor)
