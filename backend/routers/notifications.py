"""ConsultUro — notifications router.

  · /api/notifications
  · /api/notifications/{notification_id}
  · /api/notifications/{notification_id}/read
  · /api/notifications/read-all

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_user

router = APIRouter()


@router.get("/api/notifications")
async def list_notifications(user=Depends(require_user), unread_only: bool = False, limit: int = 50):
    q: Dict[str, Any] = {"user_id": user["user_id"]}
    if unread_only:
        q["read"] = False
    # Super-owner is a platform admin — they should NOT see clinical /
    # operational pings (booking requests, Rx status changes, surgery
    # logbook updates, broadcast deliveries, etc.) which are only
    # meaningful inside a Primary Owner's clinic. Restrict their feed
    # to admin-relevant kinds (personal messages, system / admin
    # notices, suspension confirmations, billing — anything explicitly
    # routed to a super_owner).
    if user.get("role") == "super_owner":
        q["kind"] = {"$in": [
            "personal_message",   # 1:1 chat with primary owners
            "broadcast_request",  # owner asking super-owner approval
            "system",             # platform-level system notices
            "admin",              # super-owner admin pings
            "billing",            # future billing alerts
            "suspension",         # account suspension confirmations
        ]}
    limit = max(1, min(limit, 200))
    cursor = db.notifications.find(q, {"_id": 0}).sort("created_at", -1)
    rows = await cursor.to_list(length=limit)
    unread_q: Dict[str, Any] = {"user_id": user["user_id"], "read": False}
    if user.get("role") == "super_owner":
        unread_q["kind"] = q["kind"]
    unread = await db.notifications.count_documents(unread_q)
    return {"items": rows, "unread_count": unread}

@router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user=Depends(require_user)):
    result = await db.notifications.update_one(
        {"id": notification_id, "user_id": user["user_id"]},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}

@router.get("/api/notifications/{notification_id}")
async def get_notification(notification_id: str, user=Depends(require_user)):
    """Fetch a single notification (or broadcast inbox row) by id for the
    current user. Used by the personal-message / notification detail
    screen at /messages/[id]. Marks the row as read on access (when the
    current user is the recipient).

    Senders can also view their own sent personal messages — useful for
    surfacing WhatsApp-style receipts (✓ sent · ✓✓ delivered · ✓✓ read).
    """
    n = await db.notifications.find_one(
        {"id": notification_id, "user_id": user["user_id"]},
        {"_id": 0},
    )
    src = "notification"
    is_sender = False
    if not n:
        # Sender accessing their own sent message?
        sent = await db.notifications.find_one(
            {
                "id": notification_id,
                "kind": "personal",
                "data.sender_user_id": user["user_id"],
            },
            {"_id": 0},
        )
        if sent:
            n = sent
            is_sender = True
            src = "sent"
    if not n:
        # Try broadcast inbox (broadcasts have inbox_id)
        b = await db.broadcast_inbox.find_one(
            {"$or": [{"inbox_id": notification_id}, {"broadcast_id": notification_id}], "user_id": user["user_id"]},
            {"_id": 0},
        )
        if not b:
            raise HTTPException(status_code=404, detail="Not found")
        # Normalise broadcast row -> common shape
        n = {
            "id": b.get("inbox_id") or b.get("broadcast_id"),
            "title": b.get("title") or "",
            "body": b.get("body") or "",
            "kind": "broadcast",
            "read": bool(b.get("read_at")),
            "created_at": b.get("created_at"),
            "data": {
                "image_url": b.get("image_url"),
                "link": b.get("link"),
            },
        }
        src = "broadcast"
        # Mark broadcast as read
        if not b.get("read_at"):
            await db.broadcast_inbox.update_one(
                {"inbox_id": b.get("inbox_id"), "user_id": user["user_id"]},
                {"$set": {"read_at": datetime.now(timezone.utc)}},
            )
    elif not is_sender:
        # Mark notification as read on access (only when the viewer is
        # the recipient — senders viewing their own sent messages must
        # not toggle the read state).
        if not n.get("read"):
            await db.notifications.update_one(
                {"id": notification_id, "user_id": user["user_id"]},
                {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
            )
            n["read"] = True
            n["read_at"] = datetime.now(timezone.utc)

    # Surface receipt fields explicitly so the frontend doesn't have
    # to dig into `data` for ticks rendering.
    n["delivered"] = bool(n.get("delivered_at"))
    n["recipient_read"] = bool(n.get("read"))
    n["recipient_read_at"] = n.get("read_at")
    n["is_sender_view"] = is_sender

    # Augment with sender info (for personal messages)
    data = n.get("data") or {}
    if (n.get("kind") == "personal") and data.get("sender_user_id"):
        sender = await db.users.find_one(
            {"user_id": data["sender_user_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1},
        )
        if sender:
            data["sender"] = sender
    # When the viewer is the SENDER, also resolve recipient details so
    # the detail screen can show "TO" attribution.
    if is_sender and n.get("user_id"):
        recipient = await db.users.find_one(
            {"user_id": n["user_id"]},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "role": 1, "picture": 1, "phone": 1},
        )
        if recipient:
            data["recipient"] = recipient
    n["data"] = data
    n["source"] = src
    return n

@router.post("/api/notifications/read-all")
async def mark_all_notifications_read(user=Depends(require_user)):
    result = await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "marked": result.modified_count}
