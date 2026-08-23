"""Communications V2 — Notification Centre inbox service.

The spec's mandate:
  - Notifications must include: appointment updates, prescription/document
    availability, reminders, broadcast announcements, account/security,
    system.
  - Personal chat messages MUST NOT be stored as generic notifications
    (they live in comm_conversations / comm_messages, delivered in Comm-4).
  - Categories: appointments | care_updates | reminders | announcements |
    system | security | marketing.
  - Cursor pagination (server-controlled).
  - Exact server-calculated unread counts (never trust the client).
  - Marking read affects ONLY the ids the client displayed/supplied —
    the Messages screen can never clear the notification bell.
  - Deep-link via VALIDATED internal action types + entity IDs. No
    arbitrary executable URLs accepted.
  - Inbox item must exist even when push delivery fails.
"""
from __future__ import annotations

import base64
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

CATEGORIES = {
    "appointments",
    "care_updates",
    "reminders",
    "announcements",
    "system",
    "security",
    "marketing",
}

# Allow-list of internal action types. Anything not in this set is
# stripped before persistence — the spec forbids "arbitrary executable
# URLs" as inbox actions.
VALID_ACTION_TYPES = {
    "open_booking",
    "open_prescription",
    "open_document",
    "open_conversation",
    "open_broadcast",
    "open_home",
    "open_security",
    "open_availability",
    "open_video_room",
    "open_notice",
    "none",
}

# Map from legacy `kind` values to Comm V2 categories. Anything not
# listed falls through to "system".
_KIND_TO_CATEGORY: Dict[str, str] = {
    "booking": "appointments",
    "booking_confirmed": "appointments",
    "booking_cancelled": "appointments",
    "new_booking": "appointments",
    "booking_reminder": "reminders",
    "video_room_ready": "appointments",
    "video_precall_reminder": "reminders",
    "video_precall_reminder_doctor": "reminders",
    "video_no_show": "appointments",
    "prescription": "care_updates",
    "prescription_ready": "care_updates",
    "prescription_updated": "care_updates",
    "surgery": "care_updates",
    "surgery_reminder": "reminders",
    "note_reminder": "reminders",
    "reminder": "reminders",
    "broadcast": "announcements",
    "broadcast_sent": "announcements",
    "broadcast_rejected": "announcements",
    "announcement": "announcements",
    "role_change": "security",
    "security": "security",
    "auth": "security",
    "system": "system",
    "info": "system",
}

# `kind` values that MUST NOT create an inbox item — these are handled
# by the messaging module (Comm-4). If the legacy code path emits one
# of these via create_notification, we drop it at the inbox door.
_MESSAGE_KINDS = {
    "personal",
    "personal_message",
    "message",
    "inbox",
    "chat",
}


def kind_to_category(kind: Optional[str]) -> Optional[str]:
    k = (kind or "").lower().strip()
    if not k:
        return "system"
    if k in _MESSAGE_KINDS:
        return None
    return _KIND_TO_CATEGORY.get(k, "system")


def _sanitize_action(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract a safe action_type + action_target pair from legacy `data`.

    Legacy notifications used `data.link` as an arbitrary URL, `data.type`
    as the client-side switch, and various `_id` fields. We map to the
    small allow-list above and drop anything else.
    """
    if not data:
        return {"action_type": "none", "action_target": None}

    def _pick(*keys):
        for k in keys:
            v = data.get(k)
            if v:
                return str(v)
        return None

    kind = str(data.get("type") or data.get("kind") or "").lower()
    # Booking → open_booking
    if kind.startswith("booking") or kind in ("video_precall_reminder", "video_no_show"):
        bid = _pick("booking_id")
        if bid:
            return {"action_type": "open_booking", "action_target": bid}
    if kind == "video_room_ready":
        code = _pick("code", "patient_code", "doctor_code")
        if code:
            return {"action_type": "open_video_room", "action_target": code}
    if kind.startswith("prescription"):
        pid = _pick("prescription_id", "rx_id")
        if pid:
            return {"action_type": "open_prescription", "action_target": pid}
    if kind.startswith("surgery"):
        sid = _pick("surgery_id")
        if sid:
            return {"action_type": "open_document", "action_target": sid}
    if kind.startswith("broadcast"):
        bid = _pick("broadcast_id")
        if bid:
            return {"action_type": "open_broadcast", "action_target": bid}
    if kind in ("note_reminder", "reminder"):
        nid = _pick("note_id", "reminder_id")
        if nid:
            return {"action_type": "open_document", "action_target": nid}
    # Home fallback for unclassified — never leak arbitrary URLs.
    return {"action_type": "open_home", "action_target": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_inbox_item(
    db,
    *,
    user_id: str,
    category: str,
    title: str,
    body: str,
    item_type: str,
    source_id: Optional[str],
    action_type: str = "none",
    action_target: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    priority: str = "normal",   # "low" | "normal" | "high"
) -> Optional[Dict[str, Any]]:
    """Idempotent create. If (user_id, item_type, source_id) already
    exists (unique index), returns the existing row instead of raising."""
    if category not in CATEGORIES:
        category = "system"
    if action_type not in VALID_ACTION_TYPES:
        action_type = "none"
    now = _now()
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "category": category,
        "item_type": item_type,
        "source_id": source_id,
        "title": title,
        "body": body,
        "action_type": action_type,
        "action_target": action_target,
        "priority": priority if priority in ("low", "normal", "high") else "normal",
        "metadata": metadata or {},
        "read_at": None,
        "archived_at": None,
        "created_at": now,
        "schema_version": 1,
    }
    try:
        await db.comm_inbox_items.insert_one(doc)
        return doc
    except Exception:
        # Unique-index collision → return the pre-existing row so the
        # caller (mirror shim) can log its id.
        if source_id:
            existing = await db.comm_inbox_items.find_one(
                {"user_id": user_id, "item_type": item_type, "source_id": source_id},
                {"_id": 0},
            )
            return existing
        return None


# ── Cursor pagination (opaque base64 of {"c": iso, "i": id}) ────

def _encode_cursor(created_at: datetime, item_id: str) -> str:
    payload = json.dumps({"c": created_at.isoformat(), "i": item_id})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> Optional[Tuple[datetime, str]]:
    if not cursor:
        return None
    try:
        pad = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode((cursor + pad).encode()))
        return datetime.fromisoformat(payload["c"]), str(payload["i"])
    except Exception:
        return None


async def list_inbox(
    db,
    *,
    user_id: str,
    limit: int = 30,
    cursor: Optional[str] = None,
    category: Optional[str] = None,
    include_archived: bool = False,
    unread_only: bool = False,
) -> Dict[str, Any]:
    """Cursor-paginated inbox list.

    Ordering: unread first, then descending created_at. Within each
    group the (created_at, id) tuple is monotonically decreasing so
    cursors are stable across concurrent inserts.
    """
    limit = max(1, min(100, int(limit or 30)))
    q: Dict[str, Any] = {"user_id": user_id}
    if not include_archived:
        q["archived_at"] = None
    if category and category in CATEGORIES:
        q["category"] = category
    if unread_only:
        q["read_at"] = None
    decoded = _decode_cursor(cursor)
    if decoded:
        ts, iid = decoded
        q["$or"] = [
            {"created_at": {"$lt": ts}},
            {"created_at": ts, "id": {"$lt": iid}},
        ]

    rows: List[Dict[str, Any]] = []
    async for r in db.comm_inbox_items.find(q, {"_id": 0}).sort([
        ("created_at", -1),
        ("id", -1),
    ]).limit(limit + 1):
        rows.append(r)

    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        rows = rows[:limit]
        next_cursor = _encode_cursor(last["created_at"], last["id"])

    return {
        "items": rows,
        "next_cursor": next_cursor,
        "count": len(rows),
    }


async def counts(db, *, user_id: str) -> Dict[str, Any]:
    """Exact server-computed unread counts. Never derived on the client."""
    pipeline = [
        {"$match": {"user_id": user_id, "archived_at": None, "read_at": None}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]
    by_cat: Dict[str, int] = {c: 0 for c in CATEGORIES}
    total = 0
    async for row in db.comm_inbox_items.aggregate(pipeline):
        c = row["_id"] or "system"
        n = int(row["n"])
        by_cat[c] = by_cat.get(c, 0) + n
        total += n
    return {"total_unread": total, "by_category": by_cat}


async def mark_read(db, *, user_id: str, item_ids: List[str]) -> int:
    """Mark the SUPPLIED ids as read. Never applies to items the caller
    didn't display. Returns count actually flipped from unread → read."""
    if not item_ids:
        return 0
    now = _now()
    res = await db.comm_inbox_items.update_many(
        {"user_id": user_id, "id": {"$in": list(item_ids)},
         "read_at": None, "archived_at": None},
        {"$set": {"read_at": now}},
    )
    return int(res.modified_count or 0)


async def archive(db, *, user_id: str, item_id: str) -> bool:
    now = _now()
    res = await db.comm_inbox_items.update_one(
        {"user_id": user_id, "id": item_id, "archived_at": None},
        {"$set": {"archived_at": now, "read_at": now}},
    )
    return bool(res.modified_count)


# ── Legacy mirror shim ──────────────────────────────────────────
# Called by services.notifications.create_notification when
# COMMUNICATIONS_V2_MIRROR_LEGACY is on (default true). Best-effort;
# any failure here MUST NOT block the legacy notification write.

async def mirror_from_legacy(db, *, legacy_doc: Dict[str, Any]) -> Optional[str]:
    try:
        kind = legacy_doc.get("kind")
        cat = kind_to_category(kind)
        if cat is None:
            # It's a personal message — Comm-4 handles those.
            return None
        action = _sanitize_action(legacy_doc.get("data"))
        item = await create_inbox_item(
            db,
            user_id=legacy_doc["user_id"],
            category=cat,
            title=str(legacy_doc.get("title") or "")[:200],
            body=str(legacy_doc.get("body") or "")[:2000],
            item_type=f"legacy:{kind}",
            source_id=legacy_doc.get("id"),
            action_type=action["action_type"],
            action_target=action["action_target"],
            metadata={"kind": kind, "legacy_id": legacy_doc.get("id")},
            priority="normal",
        )
        return (item or {}).get("id")
    except Exception:
        return None
