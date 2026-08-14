"""
Emergent-managed Push Notification relay.

The legacy implementation in `services.notifications` talked directly
to Expo's `/push/send` endpoint, which silently fails on production
APK / IPA builds because FCM credentials aren't in our hands. The
canonical Emergent push integration sits a managed relay (SuprSend) in
front of Expo / FCM / APNs that resolves device tokens internally —
backends only refer to **user IDs**, never tokens.

This module exposes two primitives:

    register_device(user_id, platform, device_token)
        Forward a *native* FCM/APNs token (from
        `getDevicePushTokenAsync` on the device) to the relay.

    send_push(recipients, data, idempotency_key=None)
        Trigger a push by user_id. The relay resolves
        active device tokens and handles credentials, retries,
        and dead-letter logging upstream.

Both calls:
  • Are no-ops when `EMERGENT_PUSH_KEY` is "placeholder" / missing.
    The deployer replaces the value at production build time.
  • Persist a small audit row in `push_log` so the dashboard can
    show the actual outcome.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx

from db import db

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY_ENV = "EMERGENT_PUSH_KEY"


# ── Channel mapping (keep in sync with frontend src/push-channels.ts) ──
# Android requires a channel_id at the FCM `notification` level for the
# OS to honour per-type sound / vibration / lockscreen behaviour. We
# attach the resolved channel id to the `data` payload AND to the
# Emergent-relay-specific keys (`android_channel_id`, `category`) so
# whichever transport the relay uses can pick it up.
_CHANNEL_BY_KIND = {
    "video_room_ready": "video_calls",
    "new_booking": "appointments",
    "booking_confirmed": "appointments",
    "booking_rejected": "appointments",
    "booking_cancelled": "appointments",
    "booking_cancelled_by_patient": "appointments",
    "booking_completed": "appointments",
    "booking_note": "appointments",
    "booking_rescheduled": "appointments",
    "booking_reminder": "appointments",
    "personal": "messages",
    "message": "messages",
    "inbox": "messages",
    "broadcast": "broadcasts",
    "broadcast_review": "broadcasts",
    "broadcast_sent": "broadcasts",
    "broadcast_rejected": "broadcasts",
    "note_reminder": "reminders",
    "review_request": "reminders",
}


def _channel_for_kind(kind: Optional[str]) -> str:
    """Resolve the Android channel id for a given push `kind`/`type`.
    Falls back to `default` for unknown / missing kinds."""
    if not kind:
        return "default"
    k = str(kind).strip().lower()
    if k in _CHANNEL_BY_KIND:
        return _CHANNEL_BY_KIND[k]
    if k.startswith("booking"):
        return "appointments"
    if k.startswith("broadcast"):
        return "broadcasts"
    if "reminder" in k:
        return "reminders"
    return "default"


def _key() -> str:
    return os.environ.get(PUSH_KEY_ENV, "placeholder") or "placeholder"


def is_configured() -> bool:
    """True iff a real EMERGENT_PUSH_KEY has been injected (i.e. the
    backend has been deployed). In dev / on a fresh checkout we return
    False so callers can fall back to the legacy Expo direct path."""
    k = _key()
    return bool(k) and k.lower() != "placeholder"


def _client() -> httpx.AsyncClient:
    """Build a fresh client per call. We don't reuse a module-level
    client because the key can flip between "placeholder" and the real
    value mid-lifetime (deployment pipeline). Reading env on each call
    keeps the relay self-healing without a process restart."""
    return httpx.AsyncClient(
        base_url=PUSH_BASE_URL,
        headers={
            "X-Push-Key": _key(),
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        timeout=12.0,
    )


# ─── Device registration ────────────────────────────────────────────

async def register_device(user_id: str, platform: str, device_token: str) -> Dict[str, Any]:
    """Forward a native FCM/APNs token to the Emergent push relay.

    `user_id`     — our internal user identifier (used by send_push)
    `platform`    — "android" | "ios"
    `device_token`— `getDevicePushTokenAsync().data` from the device

    Returns the relay's JSON body on success, or a `{registered: False}`
    placeholder when no key is configured (dev mode)."""
    if not user_id or not device_token:
        return {"registered": False, "reason": "missing_args"}
    if not is_configured():
        return {"registered": False, "reason": "no_emergent_key"}
    payload = {
        "user_id": user_id,
        "platform": platform or "android",
        "device_token": device_token,
    }
    async with _client() as hc:
        resp = await hc.post("/api/v1/push/users/register", json=payload)
        body: Dict[str, Any]
        try:
            body = resp.json() if resp.content else {}
        except Exception:
            body = {"raw": resp.text[:300]}
        # Always write an audit row — easy to grep later if a device
        # isn't getting pushes ("did its token ever even register?").
        try:
            await db.push_register_log.insert_one({
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "platform": platform,
                "token_preview": (device_token or "")[:40] + "…",
                "status_code": resp.status_code,
                "ok": 200 <= resp.status_code < 300,
                "created_at": datetime.now(timezone.utc),
            })
        except Exception:
            pass
        if resp.status_code == 401:
            return {"registered": False, "reason": "unauthorized", "status": 401}
        if resp.status_code >= 400:
            return {"registered": False, "reason": "relay_error",
                    "status": resp.status_code, "body": body}
        return {"registered": True, "status": resp.status_code, "body": body}


# ─── Relay resync (self-heal after deploy) ─────────────────────────

async def resync_devices_to_relay(limit: int = 500) -> Dict[str, Any]:
    """Re-forward every locally-mirrored native device token to the
    Emergent relay.

    Why: devices that opened the app while EMERGENT_PUSH_KEY was still
    'placeholder' had their tokens mirrored into `db.push_tokens` but
    `register_device` no-op'd — so the relay never learned about them.
    After a deploy injects the real key, this resync closes that gap
    without requiring users to reopen the app.

    Idempotent: the relay upserts by (user_id, token). Safe to run on
    every backend startup."""
    if not is_configured():
        return {"ok": False, "reason": "no_emergent_key", "resynced": 0}
    rows = await db.push_tokens.find(
        {"device_token": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "user_id": 1, "platform": 1, "device_token": 1},
    ).sort("updated_at", -1).to_list(length=limit)
    resynced = 0
    errors: List[Dict[str, Any]] = []
    seen: set = set()
    for r in rows:
        uid = r.get("user_id")
        tok = r.get("device_token")
        if not uid or not tok or (uid, tok) in seen:
            continue
        seen.add((uid, tok))
        try:
            res = await register_device(uid, r.get("platform") or "android", tok)
            if res.get("registered"):
                resynced += 1
            else:
                errors.append({"user_id": uid, "reason": res.get("reason"),
                               "status": res.get("status")})
        except Exception as e:
            errors.append({"user_id": uid, "error": str(e)[:200]})
    summary = {
        "ok": not errors,
        "total_rows": len(rows),
        "resynced": resynced,
        "errors": errors[:10],
        "at": datetime.now(timezone.utc),
    }
    try:
        await db.push_resync_log.insert_one({**summary, "id": str(uuid.uuid4())})
    except Exception:
        pass
    summary.pop("_id", None)
    return summary


# ─── Send ──────────────────────────────────────────────────────────

async def send_push(
    recipients: Iterable[str],
    data: Dict[str, Any],
    *,
    idempotency_key: Optional[str] = None,
    kind: Optional[str] = None,
) -> Dict[str, Any]:
    """Trigger a push to one or many user_ids.

    `data` MUST include at minimum:
        title   — short title
        message — body
    Optional fields supported by the relay: subtext, image_url,
    action_url (deep-link / external URL).

    The relay chunks at 100 recipients per call upstream; we mirror
    that here to keep one request → one log entry. Callers passing
    >100 recipients should chunk themselves; if they don't we'll
    chunk silently and still log per chunk.
    """
    title = (data.get("title") or data.get("Title") or "").strip()
    message = (data.get("message") or data.get("body") or "").strip()
    if not (title and message):
        return {"sent": 0, "ok": False, "reason": "missing_title_or_message"}
    rcpts = [r for r in (list(recipients) or []) if r]
    if not rcpts:
        return {"sent": 0, "ok": False, "reason": "no_recipients"}

    log_id = str(uuid.uuid4())
    base_log: Dict[str, Any] = {
        "id": log_id,
        "transport": "emergent_relay",
        "title": title[:240],
        "body": message[:500],
        "data_type": kind or data.get("type"),
        "total": len(rcpts),
        "sent": 0,
        "errors": [],
        "created_at": datetime.now(timezone.utc),
    }
    if not is_configured():
        base_log["note"] = "no_emergent_key"
        try:
            await db.push_log.insert_one(base_log)
        except Exception:
            pass
        return {"sent": 0, "ok": False, "reason": "no_emergent_key"}

    payload_data: Dict[str, Any] = {"title": title, "message": message}
    for k in ("subtext", "image_url", "action_url"):
        if data.get(k):
            payload_data[k] = data[k]
    # Forward any extra keys the caller wants on `data.*` (kind, type,
    # booking_id, etc.) so the device-side tap handler can deeplink.
    for k, v in (data or {}).items():
        if k not in {"title", "Title", "message", "body", "subtext", "image_url", "action_url"} and v is not None:
            payload_data.setdefault(k, v)
    if kind and "kind" not in payload_data:
        payload_data["kind"] = kind

    # ── Resolve Android channel + iOS category ──────────────────────
    # The device-side foreground handler reads `channel_id`/`category`
    # off `data`, and the relay can also forward `android_channel_id`
    # to FCM's `notification` block (background/killed delivery).
    resolved_kind = (
        kind
        or data.get("type")
        or data.get("kind")
        or payload_data.get("type")
        or payload_data.get("kind")
    )
    channel_id = _channel_for_kind(resolved_kind)
    payload_data.setdefault("channel_id", channel_id)
    payload_data.setdefault("category", channel_id)
    payload_data.setdefault("android_channel_id", channel_id)

    sent_total = 0
    errors: List[Dict[str, Any]] = []
    async with _client() as hc:
        # 100 recipients per call — relay accepts up to 100.
        for i in range(0, len(rcpts), 100):
            chunk = rcpts[i:i + 100]
            body: Dict[str, Any] = {"recipients": chunk, "data": payload_data}
            if idempotency_key:
                # Make per-chunk idempotency keys unique.
                body["$idempotency_key"] = f"{idempotency_key}-{i // 100}"
            try:
                resp = await hc.post("/api/v1/push/trigger", json=body)
                if 200 <= resp.status_code < 300:
                    sent_total += len(chunk)
                else:
                    err_body: Any
                    try:
                        err_body = resp.json()
                    except Exception:
                        err_body = resp.text[:300]
                    errors.append({"status": resp.status_code, "body": err_body, "chunk_size": len(chunk)})
            except Exception as e:
                errors.append({"error": str(e)[:300], "chunk_size": len(chunk)})

    base_log["sent"] = sent_total
    base_log["errors"] = errors[:10]
    try:
        await db.push_log.insert_one(base_log)
    except Exception:
        pass
    return {
        "sent": sent_total,
        "total": len(rcpts),
        "errors": errors,
        "ok": sent_total > 0 and not errors,
    }
