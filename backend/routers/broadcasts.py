"""ConsultUro — broadcasts router.

  · /api/broadcasts
  · /api/broadcasts/{bid}
  · /api/broadcasts/pending_count
  · /api/broadcasts/inbox
  · /api/broadcasts/inbox/read

Phase E (multi-tenant): broadcasts are clinic-scoped — staff only see
the broadcasts created by their clinic; recipients only get
notifications targeted by their clinic membership.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from db import db
from auth_deps import STAFF_ROLES, VALID_ROLES, require_staff, require_user
from models import BroadcastCreate, BroadcastReview
from server import collect_role_tokens, collect_user_tokens, create_notification, htmllib, notify_telegram, push_to_user, send_expo_push_batch
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()


@router.post("/api/broadcasts")
async def create_broadcast(request: Request, payload: BroadcastCreate, user=Depends(require_staff)):
    title = (payload.title or "").strip()
    body = (payload.body or "").strip()
    if not title or not body:
        raise HTTPException(status_code=400, detail="Title and body are required")
    if len(title) > 240 or len(body) > 2000:
        raise HTTPException(status_code=400, detail="Title max 240 chars, body max 2000 chars")
    target = payload.target if payload.target in ("all", "patients", "staff") else "all"
    bid = f"bc_{uuid.uuid4().hex[:10]}"
    is_owner = user.get("role") == "owner"
    is_approver = is_owner or bool(user.get("can_approve_broadcasts"))
    bc_clinic_id = await resolve_clinic_id(request, user)
    doc = {
        "broadcast_id": bid,
        "clinic_id": bc_clinic_id,
        "title": title,
        "body": body,
        "image_url": (payload.image_url or "").strip() or None,
        "link": (payload.link or "").strip() or None,
        "target": target,
        "author_id": user["user_id"],
        "author_name": user.get("name") or user.get("email"),
        # Owner / approvers: auto-approved (but still need explicit approve to send).
        "status": "approved" if is_approver else "pending_approval",
        "created_at": datetime.now(timezone.utc),
        "approved_by": user["user_id"] if is_approver else None,
        "approved_at": datetime.now(timezone.utc) if is_approver else None,
        "rejected_by": None,
        "rejected_at": None,
        "reject_reason": None,
        "sent_at": None,
        "sent_count": 0,
    }
    await db.broadcasts.insert_one(doc)
    doc.pop("_id", None)
    # Ping owner on Telegram for new pending broadcast
    if doc["status"] == "pending_approval":
        await notify_telegram(
            f"📝 <b>Broadcast awaiting approval</b>\n"
            f"By: {htmllib.escape(doc['author_name'] or '')}\n"
            f"<b>{htmllib.escape(title)}</b>\n{htmllib.escape(body)[:300]}"
        )
        # Push to owner + all users with broadcast approver permission
        approver_uids_cursor = db.users.find(
            {"$or": [{"role": "owner"}, {"can_approve_broadcasts": True}]},
            {"user_id": 1},
        )
        approver_uids = [u["user_id"] async for u in approver_uids_cursor]
        if approver_uids:
            tokens = await collect_user_tokens(approver_uids)
            if tokens:
                await send_expo_push_batch(
                    tokens,
                    "Broadcast awaiting approval",
                    f"{doc['author_name']}: {title}",
                    {"type": "broadcast_review", "broadcast_id": bid},
                )
            # Persist an in-app notification for each approver so they see
            # it in their bell even if the push arrived while offline.
            for uid in approver_uids:
                await create_notification(
                    user_id=uid,
                    title="Broadcast awaiting approval",
                    body=f"{doc['author_name']}: {title}",
                    kind="broadcast",
                    data={"broadcast_id": bid, "status": "pending_approval"},
                    push=False,
                )
    return doc

@router.get("/api/broadcasts")
async def list_broadcasts(request: Request, status: Optional[str] = None, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if status:
        q["status"] = status
    cursor = db.broadcasts.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=300)

@router.get("/api/broadcasts/pending_count")
async def broadcasts_pending_count(request: Request, user=Depends(require_staff)):
    is_approver = user.get("role") == "owner" or bool(user.get("can_approve_broadcasts"))
    if not is_approver:
        return {"count": 0}
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {"status": "pending_approval", **tenant_filter(user, clinic_id, allow_global=True)}
    n = await db.broadcasts.count_documents(q)
    return {"count": n}

@router.patch("/api/broadcasts/{bid}")
async def review_broadcast(bid: str, body: BroadcastReview, user=Depends(require_user)):
    role = user.get("role")
    is_owner = role == "owner"
    is_approver = bool(user.get("can_approve_broadcasts"))
    if not (is_owner or is_approver):
        raise HTTPException(status_code=403, detail="Only owner or designated approvers can review broadcasts")
    existing = await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc)
    action = (body.action or "").lower()
    updates: Dict[str, Any] = {}
    send_now = False
    if action == "approve":
        if existing["status"] in ("sent",):
            raise HTTPException(status_code=400, detail="Already sent")
        updates["status"] = "approved"
        updates["approved_by"] = user["user_id"]
        updates["approved_at"] = now
        updates["reject_reason"] = None
        send_now = True
    elif action == "reject":
        updates["status"] = "rejected"
        updates["rejected_by"] = user["user_id"]
        updates["rejected_at"] = now
        updates["reject_reason"] = (body.reject_reason or "").strip() or None
    else:
        raise HTTPException(status_code=400, detail="action must be approve or reject")

    await db.broadcasts.update_one({"broadcast_id": bid}, {"$set": updates})

    if send_now:
        # Gather target tokens
        target = existing.get("target") or "all"
        if target == "staff":
            target_roles = STAFF_ROLES
        elif target == "patients":
            target_roles = ["patient"]
        else:
            target_roles = VALID_ROLES
        tokens = await collect_role_tokens(target_roles)
        res = await send_expo_push_batch(
            tokens,
            existing["title"],
            existing["body"],
            {"type": "broadcast", "broadcast_id": bid, "link": existing.get("link") or ""},
            image_url=existing.get("image_url"),
        )
        # Build inbox records for every user in the target audience — not just those
        # with push tokens — so the in-app inbox is always reliable.
        target_users = await db.users.find(
            {"role": {"$in": target_roles}},
            {"user_id": 1},
        ).to_list(length=10000)
        uids = [u["user_id"] for u in target_users if u.get("user_id")]
        if uids:
            inbox_docs = [
                {
                    "inbox_id": f"ib_{uuid.uuid4().hex[:10]}",
                    "broadcast_id": bid,
                    "user_id": uid,
                    "title": existing["title"],
                    "body": existing["body"],
                    "image_url": existing.get("image_url"),
                    "link": existing.get("link"),
                    "created_at": now,
                    "read_at": None,
                }
                for uid in uids
            ]
            await db.broadcast_inbox.insert_many(inbox_docs)
        await db.broadcasts.update_one(
            {"broadcast_id": bid},
            {"$set": {"status": "sent", "sent_at": now, "sent_count": res.get("sent", 0)}},
        )
        # Notify the original author
        await push_to_user(
            existing["author_id"],
            None,
            "Broadcast approved & sent ✅",
            f"{existing['title']} — reached {res.get('sent', 0)} devices",
            {"type": "broadcast_sent", "broadcast_id": bid},
        )
        await create_notification(
            user_id=existing.get("author_id"),
            title="Broadcast approved & sent ✅",
            body=f"{existing['title']} — reached {res.get('sent', 0)} devices",
            kind="broadcast",
            data={"broadcast_id": bid, "status": "sent"},
            push=False,
        )
    else:
        # Reject path — notify author
        reason = (body.reject_reason or "").strip()
        await push_to_user(
            existing["author_id"],
            None,
            "Broadcast not approved",
            existing["title"] + (f" — {reason}" if reason else ""),
            {"type": "broadcast_rejected", "broadcast_id": bid},
        )
        await create_notification(
            user_id=existing.get("author_id"),
            title="Broadcast not approved",
            body=existing["title"] + (f" — Reason: {reason}" if reason else ""),
            kind="broadcast",
            data={"broadcast_id": bid, "status": "rejected"},
            push=False,
        )

    return await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})

@router.delete("/api/broadcasts/{bid}")
async def delete_broadcast(bid: str, user=Depends(require_user)):
    existing = await db.broadcasts.find_one({"broadcast_id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if user.get("role") != "owner" and existing.get("author_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not allowed")
    if existing.get("status") == "sent":
        raise HTTPException(status_code=400, detail="Cannot delete a broadcast already sent")
    await db.broadcasts.delete_one({"broadcast_id": bid})
    return {"ok": True}

@router.get("/api/broadcasts/inbox")
async def broadcasts_inbox(user=Depends(require_user)):
    cursor = db.broadcast_inbox.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    rows = await cursor.to_list(length=200)
    unread = sum(1 for r in rows if not r.get("read_at"))
    return {"items": rows, "unread": unread}

@router.post("/api/broadcasts/inbox/read")
async def mark_inbox_read(user=Depends(require_user)):
    now = datetime.now(timezone.utc)
    await db.broadcast_inbox.update_many(
        {"user_id": user["user_id"], "read_at": None},
        {"$set": {"read_at": now}},
    )
    return {"ok": True}
