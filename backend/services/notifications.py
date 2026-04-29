"""ConsultUro — Push + in-app notification dispatch.

Sends Expo push messages, persists in-app notification rows, and
provides helpers for resolving user/role → push tokens.

Heavy callers: bookings, prescriptions, surgeries, broadcasts,
team management. By centralising this logic here every router
gets the same observability (push_log writes) and token cleanup
(invalid token purge) for free.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from db import db


async def send_expo_push_batch(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Fan-out push via Expo's public Push API. No FCM keys needed.
    Tokens that come back as invalid (DeviceNotRegistered / InvalidCredentials) are purged.
    Every batch is also recorded in `push_log` for observability.
    """
    log_entry: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "title": (title or "")[:240],
        "body": (body or "")[:500],
        "data_type": (data or {}).get("type") if isinstance(data, dict) else None,
        "total": 0,
        "sent": 0,
        "purged": 0,
        "errors": [],
        "created_at": datetime.now(timezone.utc),
    }
    if not tokens:
        log_entry["note"] = "no_tokens_supplied"
        try:
            await db.push_log.insert_one(log_entry)
        except Exception:
            pass
        return {"sent": 0, "errors": [], "total": 0, "purged": 0, "note": "no_tokens_supplied"}
    # Filter to valid Expo tokens (ExponentPushToken[...] or ExpoPushToken[...])
    clean = [
        t for t in {t for t in tokens if t}
        if isinstance(t, str) and (t.startswith("ExponentPushToken[") or t.startswith("ExpoPushToken["))
    ]
    log_entry["total"] = len(clean)
    if not clean:
        log_entry["errors"] = [{"error": "no valid tokens"}]
        try:
            await db.push_log.insert_one(log_entry)
        except Exception:
            pass
        return {"sent": 0, "errors": [{"error": "no valid tokens"}], "total": 0, "purged": 0}
    messages = []
    for t in clean:
        msg: Dict[str, Any] = {
            "to": t,
            "sound": "default",
            "title": title[:240],
            "body": body[:1000],
            "priority": "high",
            "channelId": "default",
        }
        if data:
            msg["data"] = data
        if image_url:
            # iOS rich & Android bigPicture
            msg["richContent"] = {"image": image_url}
            msg["_displayInForeground"] = True
        messages.append(msg)
    sent = 0
    errors: List[Dict[str, Any]] = []
    invalid: List[str] = []
    try:
        # Expo recommends chunks of 100
        async with httpx.AsyncClient(timeout=15.0) as hc:
            for i in range(0, len(messages), 100):
                chunk = messages[i:i + 100]
                resp = await hc.post(
                    "https://exp.host/--/api/v2/push/send",
                    json=chunk,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                )
                try:
                    data_resp = resp.json()
                except Exception:
                    errors.append({"error": f"non-json response {resp.status_code}"})
                    continue
                receipts = data_resp.get("data", [])
                for j, r in enumerate(receipts):
                    if isinstance(r, dict) and r.get("status") == "ok":
                        sent += 1
                    else:
                        err_msg = r.get("message") if isinstance(r, dict) else str(r)
                        err_detail = r.get("details", {}) if isinstance(r, dict) else {}
                        errors.append({"error": err_msg, "details": err_detail})
                        if err_detail.get("error") in ("DeviceNotRegistered", "InvalidCredentials"):
                            invalid.append(chunk[j]["to"])
    except Exception as e:
        errors.append({"error": str(e)})
    if invalid:
        await db.push_tokens.delete_many({"token": {"$in": invalid}})
    log_entry["sent"] = sent
    log_entry["errors"] = errors[:10]  # keep log rows bounded
    log_entry["purged"] = len(invalid)
    try:
        await db.push_log.insert_one(log_entry)
        # Keep only last 2000 log rows for space
        total = await db.push_log.count_documents({})
        if total > 2200:
            # Drop the oldest 200
            cutoff_doc = await db.push_log.find({}, {"created_at": 1}).sort("created_at", 1).skip(200).limit(1).to_list(1)
            if cutoff_doc:
                await db.push_log.delete_many({"created_at": {"$lt": cutoff_doc[0]["created_at"]}})
    except Exception:
        pass
    return {"sent": sent, "errors": errors, "total": len(clean), "purged": len(invalid)}

async def collect_user_tokens(user_ids: Optional[List[str]] = None) -> List[str]:
    q: Dict[str, Any] = {}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    rows = await db.push_tokens.find(q, {"_id": 0, "token": 1}).to_list(length=5000)
    return [r["token"] for r in rows if r.get("token")]

async def collect_role_tokens(roles: List[str]) -> List[str]:
    uids = [u["user_id"] async for u in db.users.find({"role": {"$in": roles}}, {"user_id": 1})]
    return await collect_user_tokens(uids)

async def push_to_owner(title: str, body: str, data: Optional[Dict[str, Any]] = None):
    tokens = await collect_role_tokens(["owner"])
    if tokens:
        await send_expo_push_batch(tokens, title, body, data)

async def push_to_user(user_id: Optional[str], phone: Optional[str], title: str, body: str, data: Optional[Dict[str, Any]] = None):
    user_ids: List[str] = []
    if user_id:
        user_ids.append(user_id)
    if phone:
        digits = re.sub(r"\D", "", phone or "")
        if digits:
            rows = await db.users.find({"phone": {"$regex": digits + "$"}}, {"user_id": 1}).to_list(length=5)
            for r in rows:
                if r["user_id"] not in user_ids:
                    user_ids.append(r["user_id"])
    if not user_ids:
        return False
    tokens = await collect_user_tokens(user_ids)
    if tokens:
        await send_expo_push_batch(tokens, title, body, data)
        return True
    return False

ROLE_LABELS_BASIC: Dict[str, str] = {
    "owner": "Owner",
    "doctor": "Doctor",
    "assistant": "Assistant",
    "staff": "Staff",
    "patient": "Patient",
}

async def pretty_role(role_slug: Optional[str]) -> str:
    if not role_slug:
        return "—"
    if role_slug in ROLE_LABELS_BASIC:
        return ROLE_LABELS_BASIC[role_slug]
    custom = await db.role_labels.find_one({"slug": role_slug}, {"_id": 0, "label": 1})
    if custom and custom.get("label"):
        return custom["label"]
    return role_slug.replace("_", " ").title()

async def create_notification(
    user_id: Optional[str],
    title: str,
    body: str,
    kind: str = "info",
    data: Optional[Dict[str, Any]] = None,
    push: bool = True,
):
    """Persist an in-app notification and (optionally) also fire a push.
    Set `push=False` when the caller already handles the push via
    `push_to_user` or another channel (e.g. phone-based broadcast)."""
    if not user_id:
        return None
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "title": title,
        "body": body,
        "kind": kind,
        "data": data or {},
        "read": False,
        "created_at": datetime.now(timezone.utc),
    }
    await db.notifications.insert_one(doc)
    if push:
        try:
            await push_to_user(user_id, None, title, body, {**(data or {}), "kind": kind})
        except Exception:
            pass
    return doc

async def notify_role_change(
    user_id: Optional[str],
    email: str,
    prev_role: Optional[str],
    new_role: str,
):
    """Send the 'your role changed' notification to the team member."""
    new_label = await pretty_role(new_role)
    if prev_role:
        prev_label = await pretty_role(prev_role)
        title = "Your role has been updated"
        body = f"You are now a {new_label} (was {prev_label})."
    else:
        title = "You've been added to the team"
        body = f"You've been assigned the {new_label} role."
    await create_notification(
        user_id=user_id,
        title=title,
        body=body,
        kind="role_change",
        data={"email": email, "prev_role": prev_role, "new_role": new_role},
    )
