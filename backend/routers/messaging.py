"""ConsultUro — messaging router.

  · /api/messages/recipients
  · /api/messages/send
  · /api/messages/sent
  · /api/messages/lookup-by-phone
  · /api/inbox/all
  · /api/inbox/all/read
  · /api/admin/users/{user_id}/messaging-permission
  · /api/admin/messaging-permissions

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import is_owner_or_partner, require_owner, require_user
from models import MessagingPermissionBody, PersonalMessageBody
from server import _can_send_personal_messages, _normalize_phone, _secrets, create_notification, push_to_user

router = APIRouter()


@router.get("/api/inbox/all")
async def inbox_all(user=Depends(require_user), limit: int = 100):
    limit = max(1, min(limit, 300))
    user_id = user["user_id"]

    # 1) User-specific notifications.
    notif_cursor = db.notifications.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    notifs = await notif_cursor.to_list(length=limit)

    # Stamp `delivered_at` on any personal message that doesn't have it
    # yet. From the recipient's perspective, fetching the inbox means
    # the device has the message — that's our in-app "delivered" signal
    # (sender's WhatsApp-style ✓✓). Best-effort and idempotent.
    pending_delivered = [
        n.get("id") for n in notifs
        if n.get("kind") == "personal"
        and not n.get("delivered_at")
        and n.get("id")
    ]
    if pending_delivered:
        try:
            now = datetime.now(timezone.utc)
            await db.notifications.update_many(
                {"id": {"$in": pending_delivered}, "delivered_at": {"$in": [None, False]}},
                {"$set": {"delivered_at": now}},
            )
            for n in notifs:
                if n.get("id") in pending_delivered:
                    n["delivered_at"] = now
        except Exception:
            pass

    # 2) Broadcast inbox deliveries.
    bx_cursor = db.broadcast_inbox.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    broadcasts = await bx_cursor.to_list(length=limit)
    # 3) Push log entries that don't have an in-app row (rare).
    push_cursor = db.push_log.find({"user_ids": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    pushes = await push_cursor.to_list(length=limit)

    feed: List[Dict[str, Any]] = []

    for n in notifs:
        kind = (n.get("kind") or "info").lower()
        # Broadcasts that flowed through `create_notification` are tagged
        # with kind="broadcast" already — preserve that so the frontend
        # icon picker stays consistent.
        if kind == "broadcast":
            stype = "broadcast"
        elif kind == "personal":
            stype = "personal"
        elif kind in ("push", "system"):
            stype = "push"
        else:
            stype = "user"
        feed.append({
            "id": n.get("id"),
            "title": n.get("title") or "",
            "body": n.get("body") or "",
            "kind": kind,
            "source_type": stype,
            "read": bool(n.get("read")),
            "created_at": n.get("created_at"),
            "data": n.get("data") or {},
            "image_url": (n.get("data") or {}).get("image_url"),
            "link": (n.get("data") or {}).get("link"),
        })

    # Track ids already in feed (broadcasts that also have a notification
    # row will be deduped via broadcast_id key).
    notif_ids = {f["id"] for f in feed if f.get("id")}

    for b in broadcasts:
        bid = b.get("broadcast_id") or b.get("inbox_id")
        if bid and bid in notif_ids:
            continue
        feed.append({
            "id": b.get("inbox_id") or bid,
            "broadcast_id": b.get("broadcast_id"),
            "title": b.get("title") or "",
            "body": b.get("body") or "",
            "kind": "broadcast",
            "source_type": "broadcast",
            "read": bool(b.get("read_at")),
            "created_at": b.get("created_at"),
            "image_url": b.get("image_url"),
            "link": b.get("link"),
            "data": {},
        })

    # Push log entries — only include if not already represented by a
    # notification or broadcast (most pushes have one). We match by title
    # within a 24h window, conservatively. Coerce datetimes to ISO str
    # before slicing — Mongo returns datetime objects which can't be
    # subscripted with [:13].
    def _ck(v):
        if isinstance(v, datetime):
            return v.isoformat()[:13]
        return (str(v) if v else '')[:13]
    seen_titles = {f"{(f.get('title') or '').strip()}::{_ck(f.get('created_at'))}" for f in feed}
    for p in pushes:
        key = f"{(p.get('title') or '').strip()}::{_ck(p.get('created_at'))}"
        if key in seen_titles:
            continue
        feed.append({
            "id": f"push_{p.get('_id') or _secrets.token_hex(4)}",
            "title": p.get("title") or "Notification",
            "body": p.get("body") or "",
            "kind": "push",
            "source_type": "push",
            "read": True,  # push log has no read state per-user
            "created_at": p.get("created_at"),
            "data": p.get("data") or {},
            "image_url": None,
            "link": None,
        })

    # Sort newest-first by `created_at`.
    def _ts(x):
        v = x.get("created_at")
        if isinstance(v, datetime):
            return v.timestamp()
        if isinstance(v, str):
            try: return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
            except Exception: return 0
        return 0
    feed.sort(key=_ts, reverse=True)
    feed = feed[:limit]

    unread_total = sum(1 for f in feed if not f.get("read"))
    return {"items": feed, "unread": unread_total}

@router.post("/api/inbox/all/read")
async def inbox_all_mark_read(user=Depends(require_user)):
    """Mark every item in the unified inbox as read for this user
    (covers both notifications and broadcast_inbox)."""
    now = datetime.now(timezone.utc)
    a = await db.notifications.update_many(
        {"user_id": user["user_id"], "read": False},
        {"$set": {"read": True, "read_at": now}},
    )
    b = await db.broadcast_inbox.update_many(
        {"user_id": user["user_id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    return {"ok": True, "marked": a.modified_count + b.modified_count}

@router.post("/api/admin/users/{user_id}/messaging-permission")
async def set_messaging_permission(
    user_id: str,
    body: MessagingPermissionBody,
    user=Depends(require_owner),
):
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_owner_or_partner(target):
        return {"ok": True, "user_id": user_id, "allowed": True, "note": "Owner / Partner is always permitted"}
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"can_send_personal_messages": bool(body.allowed)}},
    )
    # Mirror onto team_invites if a row exists (so role assignment via
    # invite flow doesn't reset the bit later).
    if target.get("email"):
        await db.team_invites.update_one(
            {"email": target["email"].lower()},
            {"$set": {"can_send_personal_messages": bool(body.allowed)}},
            upsert=False,
        )
    return {"ok": True, "user_id": user_id, "allowed": bool(body.allowed)}

@router.get("/api/admin/messaging-permissions")
async def list_messaging_permissions(
    role: Optional[str] = None,
    q: str = "",
    user=Depends(require_owner),
):
    """List users alongside their messaging-permission status. Used by
    the new Owner UI panel for managing patient/user authorisations.
    Filterable by role and a free-text query.
    """
    base: Dict[str, Any] = {}
    if role:
        base["role"] = role
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        base["$or"] = [{"name": rx}, {"email": rx}, {"phone": rx}]
    rows = await db.users.find(
        base,
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1, "can_send_personal_messages": 1},
    ).limit(500).to_list(length=500)
    out = []
    for u in rows:
        role_ = u.get("role", "")
        explicit = u.get("can_send_personal_messages")
        if role_ == "owner":
            allowed = True; default_allowed = True
        elif role_ and role_ != "patient":
            allowed = (explicit is not False); default_allowed = True
        else:
            allowed = bool(explicit); default_allowed = False
        out.append({
            "user_id": u.get("user_id"),
            "name": u.get("name"),
            "email": u.get("email"),
            "phone": u.get("phone"),
            "role": role_,
            "picture": u.get("picture"),
            "allowed": allowed,
            "default_allowed": default_allowed,
            "explicit": explicit,
        })
    return {"items": out}

@router.get("/api/messages/recipients")
async def messages_recipients(
    q: str = "",
    scope: str = "team",
    user=Depends(require_user),
):
    """Search-as-you-type recipient picker for the personal-message
    composer. `scope` ∈ {team, patients}.
      • team     — staff members (owner + non-patient roles).
      • patients — users with role="patient".
    Returns at most 20 lightweight rows: user_id, name, email, phone,
    role, picture.
    """
    if not _can_send_personal_messages(user):
        raise HTTPException(status_code=403, detail="Not permitted to send personal messages")
    qs = (q or "").strip().lower()
    base: Dict[str, Any]
    # Patients can only message the clinic team, never other patients.
    requester_role = (user or {}).get("role", "")
    is_patient = requester_role in ("", "patient")
    effective_scope = "team" if is_patient else scope
    if effective_scope == "patients":
        base = {"role": "patient"}
    else:
        # Team recipients:
        #   • never patients (use scope="patients" for that)
        #   • never super_owner — EXCEPT when the caller is a
        #     primary_owner. Per the hierarchy rule only Primary
        #     Owners can personally message the Super Owner; partners,
        #     doctors and other staff cannot see the super_owner in
        #     their recipient search.
        exclude_roles: List[str] = ["patient"]
        if requester_role != "primary_owner":
            exclude_roles.append("super_owner")
        base = {"role": {"$nin": exclude_roles}}
    base["user_id"] = {"$ne": user["user_id"]}
    if qs:
        regex = {"$regex": re.escape(qs), "$options": "i"}
        base["$or"] = [
            {"name": regex},
            {"email": regex},
            {"phone": regex},
        ]
    cur = db.users.find(
        base,
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
    ).limit(25)
    rows = await cur.to_list(length=25)
    return {"items": rows}

@router.post("/api/messages/send")
async def messages_send(body: PersonalMessageBody, user=Depends(require_user)):
    if not _can_send_personal_messages(user):
        raise HTTPException(status_code=403, detail="Not permitted to send personal messages")
    title = (body.title or "").strip()
    msg_body = (body.body or "").strip()
    if not title or not msg_body:
        raise HTTPException(status_code=400, detail="Title and body are required")
    if len(title) > 140 or len(msg_body) > 2000:
        raise HTTPException(status_code=400, detail="Message too long")

    recipient = None
    if body.recipient_user_id:
        recipient = await db.users.find_one({"user_id": body.recipient_user_id}, {"_id": 0})
    elif body.recipient_email:
        recipient = await db.users.find_one(
            {"email": body.recipient_email.lower()}, {"_id": 0}
        )
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")
    if recipient["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    # Hierarchy rule: only Primary Owners can message the Super Owner.
    if recipient.get("role") == "super_owner" and user.get("role") != "primary_owner":
        raise HTTPException(
            status_code=403,
            detail="Only Primary Owners can send personal messages to the Super Owner.",
        )

    sender_name = user.get("name") or user.get("email") or "Team"
    sender_role = user.get("role") or "staff"
    # Sanitize attachments — cap count and per-file size to keep
    # MongoDB documents reasonable. Larger files should later move to
    # an object-store; for now we store the data URI inline so the
    # detail screen renders without an extra fetch.
    MAX_ATTACHMENTS = 6
    MAX_BYTES = 8 * 1024 * 1024  # 8 MB per attachment
    attachments_clean: List[Dict[str, Any]] = []
    for a in (body.attachments or [])[:MAX_ATTACHMENTS]:
        d = a.model_dump() if hasattr(a, "model_dump") else (a.dict() if hasattr(a, "dict") else dict(a))
        url = (d.get("data_url") or "").strip()
        if not url.startswith("data:"):
            continue
        # Estimate size from base64 length when not provided.
        if not d.get("size_bytes"):
            try:
                b64 = url.split(",", 1)[1] if "," in url else ""
                d["size_bytes"] = int(len(b64) * 3 / 4)
            except Exception:
                d["size_bytes"] = 0
        if int(d.get("size_bytes") or 0) > MAX_BYTES:
            raise HTTPException(status_code=400, detail=f"Attachment '{d.get('name')}' exceeds 8 MB limit")
        # Infer kind from mime if missing.
        if not d.get("kind"):
            mime = (d.get("mime") or "").lower()
            d["kind"] = "image" if mime.startswith("image/") else "video" if mime.startswith("video/") else "file"
        attachments_clean.append(d)

    note_data: Dict[str, Any] = {
        "sender_user_id": user["user_id"],
        "sender_name": sender_name,
        "sender_role": sender_role,
    }
    if attachments_clean:
        note_data["attachments"] = attachments_clean
    note = await create_notification(
        recipient["user_id"],
        title=title,
        body=msg_body,
        kind="personal",
        data=note_data,
        # Suppress the implicit push fired by create_notification — we
        # send our own one below with the correct payload (`type` +
        # `kind` + optional attachment label). This avoids a double-push
        # that earlier delivered ONLY `kind` (no `type`), which the
        # frontend tap handler couldn't route into /inbox.
        push=False,
    )

    try:
        push_body = msg_body[:160]
        if attachments_clean:
            kinds = {a.get("kind") for a in attachments_clean}
            label = "📷 photo" if kinds == {"image"} else ("🎥 video" if kinds == {"video"} else "📎 attachment")
            push_body = f"{label} · {push_body}" if push_body else label
        push_ok = await push_to_user(
            recipient["user_id"],
            None,
            title=f"{sender_name}: {title}",
            body=push_body,
            # `type` is the convention used by every other push payload
            # (booking_*, broadcast, note_reminder…) — the frontend
            # `_layout.tsx` tap handler routes on `data.type`. We keep
            # `kind` for backward compatibility with older clients.
            data={"type": "personal", "kind": "personal"},
        )
        # If a push was actually fanned out to at least one device, the
        # message is considered "delivered" right now (WhatsApp ✓✓).
        if push_ok and isinstance(note, dict) and note.get("id"):
            await db.notifications.update_one(
                {"id": note["id"]},
                {"$set": {"delivered_at": datetime.now(timezone.utc)}},
            )
    except Exception:
        pass

    return {
        "ok": True,
        "notification_id": note.get("id") if isinstance(note, dict) else None,
        "recipient_user_id": recipient["user_id"],
    }

@router.get("/api/messages/sent")
async def messages_sent(user=Depends(require_user), limit: int = 100):
    """List personal messages SENT by the current user, newest first.

    Returns rows shaped like inbox items (so the frontend can re-use the
    InboxItem renderer): each row contains the title/body/created_at +
    `data.recipient_*` (recipient name/role/email when available).
    """
    limit = max(1, min(limit, 300))
    cursor = (
        db.notifications.find(
            {"kind": "personal", "data.sender_user_id": user["user_id"]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    # Resolve recipient details once per request to enrich the response.
    recipient_ids = list({d.get("user_id") for d in docs if d.get("user_id")})
    recipients_by_id: Dict[str, Dict[str, Any]] = {}
    if recipient_ids:
        rcursor = db.users.find(
            {"user_id": {"$in": recipient_ids}},
            {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
        )
        async for r in rcursor:
            recipients_by_id[r["user_id"]] = r

    items: List[Dict[str, Any]] = []
    for n in docs:
        data = dict(n.get("data") or {})
        rid = n.get("user_id")
        rec = recipients_by_id.get(rid) if rid else None
        if rec:
            data.setdefault("recipient_name", rec.get("name"))
            data.setdefault("recipient_email", rec.get("email"))
            data.setdefault("recipient_phone", rec.get("phone"))
            data.setdefault("recipient_role", rec.get("role"))
            data.setdefault("recipient_picture", rec.get("picture"))
        items.append({
            "id": n.get("id"),
            "title": n.get("title") or "",
            "body": n.get("body") or "",
            "kind": "personal",
            "source_type": "personal",
            # Sender's perspective: this is read=True (sender authored
            # it). The recipient's read state is exposed separately so
            # the UI can render WhatsApp-style ticks (✓ sent · ✓✓
            # delivered · ✓✓ blue read).
            "read": True,
            "recipient_read": bool(n.get("read")),
            "recipient_read_at": n.get("read_at"),
            "delivered": bool(n.get("delivered_at")),
            "delivered_at": n.get("delivered_at"),
            "created_at": n.get("created_at"),
            "data": data,
            "image_url": data.get("image_url"),
            "link": data.get("link"),
            "recipient_user_id": rid,
        })
    return {"items": items, "count": len(items)}

@router.get("/api/messages/lookup-by-phone")
async def messages_lookup_by_phone(phone: str = "", user=Depends(require_user)):
    """Resolve a phone number to a registered user so the staff can open
    the personal-message composer pre-filled. Returns 200 with
    {"found": false} when no user is registered under that phone — the
    frontend can then suggest WhatsApp instead.
    """
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    suffix = p[-10:] if len(p) >= 10 else p
    # Phones in `users` are stored with country code; match by suffix so
    # legacy records still resolve.
    doc = await db.users.find_one(
        {"phone": {"$regex": f"{suffix}$"}},
        {"_id": 0, "user_id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "picture": 1},
    )
    if not doc:
        return {"found": False, "phone": p}
    role = (user.get("role") or "").lower()
    if role not in ("owner", "partner", "doctor", "assistant", "reception", "nursing"):
        # Patients can only resolve clinic team accounts.
        target_role = (doc.get("role") or "").lower()
        if target_role not in ("owner", "partner", "doctor", "assistant", "reception", "nursing"):
            return {"found": False, "phone": p}
    return {"found": True, "user": doc}
