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
    # Resolve Android channel id from the push `type` so legacy Expo
    # transport also routes to the correct channel.
    _kind_hint = (data or {}).get("type") or (data or {}).get("kind") if isinstance(data, dict) else None
    try:
        from services.push_relay import _channel_for_kind as _channel_resolver
        _channel = _channel_resolver(_kind_hint)
    except Exception:
        _channel = "default"
    for t in clean:
        msg: Dict[str, Any] = {
            "to": t,
            "sound": "default",
            "title": title[:240],
            "body": body[:1000],
            "priority": "high",
            "channelId": _channel,
        }
        if data:
            # Ensure the payload also exposes the channel for in-app
            # foreground re-presentation (handleNotification reads it).
            d = dict(data)
            d.setdefault("channel_id", _channel)
            d.setdefault("category", _channel)
            msg["data"] = d
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
    """Resolve push tokens for the given user_ids, healing orphaned rows.

    Robust to THREE classes of data drift commonly seen in production:
      1. user_id drift after DB migration / re-seed / clinic-switch —
         tokens stamped with a stale user_id (email field is present).
      2. duplicate user records sharing the same email (OAuth re-link,
         case-sensitive vs normalised emails). Tokens may be stamped to
         EITHER user_id, and the email field may point to either copy.
      3. legacy tokens registered BEFORE the email field was introduced
         on push_tokens — they have no email, only a stale user_id.

    Strategy:
      • Start with the requested user_ids.
      • Expand to include ALL sibling user_ids that share any email
        address of the requested users (catches dup-user case).
      • Query tokens by (user_id IN expanded_ids) OR (email IN emails).
      • Opportunistically re-stamp all found rows under the canonical
        requested user_id + email so future calls hit the fast path.
    """
    if user_ids is None:
        rows = await db.push_tokens.find({}, {"_id": 0, "token": 1}).to_list(length=5000)
        return [r["token"] for r in rows if r.get("token")]

    # ── Expand requested user_ids by email-sibling relationship ─────
    expanded_ids: set[str] = set(user_ids)
    emails: set[str] = set()
    try:
        async for u in db.users.find(
            {"user_id": {"$in": list(user_ids)}},
            {"_id": 0, "user_id": 1, "email": 1},
        ):
            e = (u.get("email") or "").strip().lower()
            if e:
                emails.add(e)
        if emails:
            async for u in db.users.find(
                # Case-insensitive match so "User@X" and "user@x" unify.
                {"email": {"$regex": "^(" + "|".join(
                    [re.escape(e) for e in emails]
                ) + ")$", "$options": "i"}},
                {"_id": 0, "user_id": 1},
            ):
                expanded_ids.add(u["user_id"])
    except Exception:
        # Bail silently — worst case we fall back to the original
        # user_ids without the sibling expansion.
        pass

    # ── Build a union query: user_id IN expanded OR email IN emails ──
    or_clauses: List[Dict[str, Any]] = [{"user_id": {"$in": list(expanded_ids)}}]
    if emails:
        or_clauses.append({
            "email": {"$regex": "^(" + "|".join(
                [re.escape(e) for e in emails]
            ) + ")$", "$options": "i"}
        })

    rows = await db.push_tokens.find(
        {"$or": or_clauses}, {"_id": 0, "token": 1}
    ).to_list(length=5000)
    tokens = list({r["token"] for r in rows if r.get("token")})

    # ── Opportunistic heal: re-stamp found rows under the canonical
    #    requested user_id + email so subsequent calls use the fast
    #    single-key index path. Only runs when a single user_id was
    #    requested (i.e. /push/test, push_to_user) — for bulk role
    #    pushes we skip the re-stamp to avoid pointing everyone's
    #    tokens at whichever user_id happened to come first.
    if tokens and len(user_ids) == 1:
        canonical_uid = user_ids[0]
        canonical_email: Optional[str] = None
        try:
            u = await db.users.find_one(
                {"user_id": canonical_uid}, {"_id": 0, "email": 1}
            )
            canonical_email = (u or {}).get("email")
        except Exception:
            canonical_email = None
        try:
            set_patch: Dict[str, Any] = {"user_id": canonical_uid}
            if canonical_email:
                set_patch["email"] = canonical_email
            await db.push_tokens.update_many(
                {"$and": [
                    {"$or": or_clauses},
                    {"user_id": {"$ne": canonical_uid}},
                ]},
                {"$set": set_patch},
            )
        except Exception:
            pass

    return tokens

async def collect_role_tokens(roles: List[str]) -> List[str]:
    uids = [u["user_id"] async for u in db.users.find({"role": {"$in": roles}}, {"user_id": 1})]
    return await collect_user_tokens(uids)

async def push_to_owner(title: str, body: str, data: Optional[Dict[str, Any]] = None):
    """Send a push to every user with the "owner" role.

    Routes through the Emergent push relay (by user_id) when configured;
    falls back to the legacy direct-Expo path otherwise so dev keeps
    working without an EMERGENT_PUSH_KEY."""
    owner_ids = [u["user_id"] async for u in db.users.find(
        {"role": {"$in": ["owner", "primary_owner", "partner"]}}, {"user_id": 1},
    )]
    if not owner_ids:
        return
    try:
        from services.push_relay import is_configured
        from services.notification_outbox import send_push_reliable
        if is_configured():
            await send_push_reliable(
                recipients=owner_ids,
                data={"title": title, "message": body, **(data or {})},
                kind=(data or {}).get("kind") or (data or {}).get("type"),
            )
            return
    except Exception:
        pass
    # Fallback: Expo direct path (works only in dev / Expo Go).
    tokens = await collect_role_tokens(["owner", "primary_owner", "partner"])
    if tokens:
        await send_expo_push_batch(tokens, title, body, data)

async def push_to_user(user_id: Optional[str], phone: Optional[str], title: str, body: str, data: Optional[Dict[str, Any]] = None):
    """Send a push to ONE user (resolved by user_id and/or phone).

    PRIMARY transport — Emergent push relay. The relay holds device
    tokens server-side and resolves user_id → tokens internally,
    which means the SAME user_id keeps working across app
    reinstalls, OS upgrades, multi-device, etc. without any token
    bookkeeping on our side.

    FALLBACK transport — legacy direct-to-Expo path (collect tokens
    from local DB, fire to https://exp.host). Only used when the
    `EMERGENT_PUSH_KEY` env var hasn't been injected yet (dev / pre-
    publish).
    """
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

    # 1) Try the Emergent relay first (with outbox retry on failure).
    try:
        from services.push_relay import is_configured
        from services.notification_outbox import send_push_reliable
        if is_configured():
            res = await send_push_reliable(
                recipients=user_ids,
                data={"title": title, "message": body, **(data or {})},
                kind=(data or {}).get("kind") or (data or {}).get("type"),
            )
            if (res or {}).get("sent", 0) > 0 or (res or {}).get("queued_for_retry"):
                return True
            # Fall through to legacy path so a transient relay outage
            # doesn't silently drop the push.
    except Exception:
        pass

    # 2) Fallback: legacy direct-Expo (dev-only path).
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
    *,
    phone: Optional[str] = None,
    email: Optional[str] = None,
):
    """Persist an in-app notification and (optionally) also fire a push.
    Set `push=False` when the caller already handles the push via
    `push_to_user` or another channel (e.g. phone-based broadcast).

    Phone/email fallback (Item 6 fix, 2026-05-29): when `user_id` is
    None — typical for staff-booked appointments where the patient
    isn't yet a registered ConsultUro user — try to resolve by
    `phone` or `email` first. This lets the patient see the
    notification under their bell as soon as they sign up (the
    auth/me hook backfills bookings by phone match).
    """
    if not user_id and (phone or email):
        lookup_or = []
        if phone:
            # Match the registered phone in three forms because staff
            # often book patients by 10-digit numbers ("9876543210")
            # while users sign up with the country code
            # ("+919876543210"). Without this normalisation, in-app
            # bell notifications were silently skipped for phone-only
            # booked patients (Phase 5.13 RCA, 2026-06-01).
            raw = str(phone).strip()
            digits = "".join(ch for ch in raw if ch.isdigit())
            lookup_or.append({"phone": raw})
            if digits:
                lookup_or.append({"phone_digits": digits[-10:]})
                # Final fallback: regex match on the trailing 10
                # digits (covers users whose phone field stored a
                # different prefix format).
                lookup_or.append({"phone": {"$regex": digits[-10:] + "$"}})
        if email:
            lookup_or.append({"email": email})
        # Patients only — NEVER deliver a "your booking is confirmed"
        # notification to a staff member who happens to share the
        # phone/email with the patient (rare but possible).
        existing = await db.users.find_one(
            {
                "$or": lookup_or,
                "role": {"$nin": ["super_owner", "primary_owner", "owner",
                                  "partner", "doctor", "assistant",
                                  "reception", "nursing"]},
            },
            {"user_id": 1, "_id": 0},
        )
        if existing:
            user_id = existing.get("user_id")
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
    # Phase B: dual-write into the canonical notification_inbox
    # collection (reads stay on the legacy path until Phase C flips).
    inbox_doc = {**doc, "source_type": "notification"}
    await db.notifications.insert_one(doc)
    try:
        await db.notification_inbox.insert_one(inbox_doc)
    except Exception:
        pass
    # Comm V2 Comm-3: mirror into comm_inbox_items when the flag is on
    # (default true during migration). Never block on failure.
    try:
        from services.comm_flags import get_flag as _get_flag
        from services.comm_inbox import mirror_from_legacy as _mirror
        if await _get_flag(db, "COMMUNICATIONS_V2_MIRROR_LEGACY", True):
            await _mirror(db, legacy_doc=doc)
    except Exception:
        pass
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
