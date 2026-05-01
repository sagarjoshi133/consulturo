"""ConsultUro — Push + in-app notification dispatch.

Sends Expo push messages, persists in-app notification rows, and
provides helpers for resolving user/role → push tokens.

Heavy callers: bookings, prescriptions, surgeries, broadcasts,
team management. By centralising this logic here every router
gets the same observability (push_log writes) and token cleanup
(invalid token purge) for free.

2026-04-30 — Added a receipt-polling follow-up so that push_log
captures the ACTUAL FCM / APNs delivery outcome (not just Expo
ticket acceptance). Without this a push can look "sent: 1" even
when FCM silently drops it (misconfigured credentials, invalid
token, app uninstalled, etc.).
"""
import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from db import db


# Number of seconds to wait before polling Expo for delivery receipts.
# Expo's docs recommend ≥15 min in prod, but for diagnostics we want
# faster feedback — 20 s is enough for Expo→FCM round-trip 95% of the
# time. Receipts older than 24 h are discarded by Expo, so there's no
# harm in polling early; we just miss a few slow ones.
_RECEIPT_POLL_DELAY_SEC = 20
_EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send"
_EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"


async def _poll_receipts_and_update(log_id: str, ticket_id_to_token: Dict[str, str]) -> None:
    """Background task — polls Expo for push delivery receipts after a
    short delay, then writes the per-ticket outcome back onto the
    matching push_log row. Also purges tokens reported as
    DeviceNotRegistered at the FCM/APNs layer.

    This is the only reliable way to know whether the user's device
    actually received the push. `sent: N` in the initial log entry
    only means Expo accepted the ticket, not that FCM delivered.
    """
    if not ticket_id_to_token:
        return
    await asyncio.sleep(_RECEIPT_POLL_DELAY_SEC)
    try:
        async with httpx.AsyncClient(timeout=15.0) as hc:
            ids = list(ticket_id_to_token.keys())
            # Expo recommends ≤1000 ids per call; we batch at 300 for safety.
            receipts: Dict[str, Any] = {}
            for i in range(0, len(ids), 300):
                chunk = ids[i:i + 300]
                resp = await hc.post(
                    _EXPO_RECEIPTS_URL,
                    json={"ids": chunk},
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                )
                try:
                    rdata = resp.json() or {}
                except Exception:
                    continue
                r_block = rdata.get("data") or {}
                if isinstance(r_block, dict):
                    receipts.update(r_block)
    except Exception as e:
        try:
            await db.push_log.update_one(
                {"id": log_id},
                {"$set": {"receipt_poll_error": str(e)[:400]}},
            )
        except Exception:
            pass
        return

    # Tabulate receipt outcomes.
    delivered = 0
    receipt_errors: List[Dict[str, Any]] = []
    purge_tokens: List[str] = []
    for tid, token in ticket_id_to_token.items():
        r = receipts.get(tid)
        if r is None:
            # Receipt not ready yet — Expo hasn't heard back from FCM.
            continue
        if isinstance(r, dict) and r.get("status") == "ok":
            delivered += 1
        elif isinstance(r, dict):
            detail = r.get("details") or {}
            err_code = detail.get("error") if isinstance(detail, dict) else None
            receipt_errors.append({
                "ticket_id": tid,
                "token_preview": (token or "")[:30] + "…",
                "error": err_code or r.get("message"),
                "message": r.get("message"),
                "details": detail,
            })
            # Tokens that FCM / APNs reports as gone → purge.
            if err_code in ("DeviceNotRegistered", "InvalidCredentials"):
                purge_tokens.append(token)

    if purge_tokens:
        try:
            await db.push_tokens.delete_many({"token": {"$in": purge_tokens}})
        except Exception:
            pass

    try:
        await db.push_log.update_one(
            {"id": log_id},
            {"$set": {
                "delivered": delivered,
                "receipt_errors": receipt_errors[:20],
                "receipts_polled_at": datetime.now(timezone.utc),
                "purged_on_receipt": len(purge_tokens),
            }},
        )
    except Exception:
        pass


async def send_expo_push_batch(
    tokens: List[str],
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    image_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Fan-out push via Expo's public Push API. No FCM keys needed.
    Tokens that come back as invalid (DeviceNotRegistered / InvalidCredentials) are purged.
    Every batch is also recorded in `push_log` for observability, and a
    background task polls Expo's receipts API to surface FCM/APNs
    delivery errors (MismatchSenderId, credential issues, etc.).
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
    # ticket_id -> token, so we can attribute receipt-level failures to
    # a specific device when we poll /getReceipts later.
    ticket_id_to_token: Dict[str, str] = {}
    try:
        # Expo recommends chunks of 100
        async with httpx.AsyncClient(timeout=15.0) as hc:
            for i in range(0, len(messages), 100):
                chunk = messages[i:i + 100]
                resp = await hc.post(
                    _EXPO_SEND_URL,
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
                        tid = r.get("id")
                        if tid:
                            ticket_id_to_token[tid] = chunk[j]["to"]
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
    log_entry["ticket_count"] = len(ticket_id_to_token)
    # `sent` = accepted by Expo's API. `delivered` (set by receipt
    # poller) = actually delivered via FCM/APNs. Keep them separate.
    log_entry["delivered"] = None  # filled in by _poll_receipts_and_update
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
    # Schedule the receipt-polling follow-up in the background so the
    # caller (booking route, etc.) returns promptly.
    if ticket_id_to_token:
        try:
            asyncio.create_task(
                _poll_receipts_and_update(log_entry["id"], ticket_id_to_token)
            )
        except Exception:
            pass
    return {
        "sent": sent,
        "errors": errors,
        "total": len(clean),
        "purged": len(invalid),
        "ticket_ids": list(ticket_id_to_token.keys()),
    }

async def collect_user_tokens(user_ids: Optional[List[str]] = None) -> List[str]:
    q: Dict[str, Any] = {}
    if user_ids is not None:
        q["user_id"] = {"$in": user_ids}
    rows = await db.push_tokens.find(q, {"_id": 0, "token": 1}).to_list(length=5000)
    tokens = [r["token"] for r in rows if r.get("token")]

    # ── Email fallback for orphaned tokens (2026-05-01) ────────────────
    # Some accounts have tokens stamped with a stale user_id (DB
    # migration / re-seed / clinic-switch leftovers). If the user_id
    # query came up empty for a single user, try the canonical email
    # and self-heal the rows by re-stamping the current user_id.
    if not tokens and user_ids and len(user_ids) == 1:
        try:
            user_doc = await db.users.find_one(
                {"user_id": user_ids[0]}, {"_id": 0, "email": 1}
            )
            email = (user_doc or {}).get("email")
            if email:
                rows2 = await db.push_tokens.find(
                    {"email": email}, {"_id": 0, "token": 1}
                ).to_list(length=200)
                tokens = [r["token"] for r in rows2 if r.get("token")]
                if tokens:
                    # Self-heal so future calls hit the fast user_id path
                    await db.push_tokens.update_many(
                        {"email": email, "user_id": {"$ne": user_ids[0]}},
                        {"$set": {"user_id": user_ids[0]}},
                    )
        except Exception:
            pass  # never fail a push because of self-heal

    return tokens

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
