"""Comm V2 installation registry service.

An "installation" is a per-device UUID that persists across FCM token
rotations. Stored in `comm_installations` keyed by (provider, token_hash)
unique AND by installation_id unique.

Statuses:
    active               → valid token, receiving pushes
    revoked              → user signed out on this device
    invalidated          → FCM returned UNREGISTERED / INVALID_ARGUMENT
    legacy_requires_reregistration → migrated from old push_tokens
                            without a stable installation_id
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def token_hash(token: str) -> str:
    """SHA-256 hex — safe to log and index. Never store raw tokens
    in log rows; the actual token stays on the `comm_installations`
    row and is *never* emitted in a response body."""
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def token_preview(token: str) -> str:
    """First 24 characters + ellipsis — for admin diagnostics only."""
    if not token:
        return ""
    return (token[:24] + "…") if len(token) > 24 else token


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def register(
    db,
    *,
    user_id: str,
    installation_id: str,
    provider: str,          # "fcm" | "apns"
    platform: str,          # "android" | "ios" | "web"
    device_token: str,
    permission_status: Optional[str] = None,
    app_version: Optional[str] = None,
    build_number: Optional[str] = None,
    runtime_version: Optional[str] = None,
    device_model: Optional[str] = None,
    locale: Optional[str] = None,
    timezone_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Upsert a device installation. Same installation_id + same token → no-op.
    Same installation_id + rotated token → token replaced (dedupes by hash).

    Returns the persisted row (with `id`, `token_hash`, no raw token).
    """
    now = _now()
    th = token_hash(device_token)

    # Look up user for cross-linking (email/role snapshot for diagnostics).
    user_doc = await db.users.find_one({"user_id": user_id},
                                        {"_id": 0, "email": 1, "role": 1}) or {}

    # If another installation already holds this exact token (same device
    # reinstalled without preserving installation_id) — invalidate the old
    # installation so we never double-send.
    dupes = db.comm_installations.find(
        {"provider": provider, "token_hash": th,
         "installation_id": {"$ne": installation_id}},
        {"_id": 0, "installation_id": 1},
    )
    async for d in dupes:
        await db.comm_installations.update_one(
            {"installation_id": d["installation_id"]},
            {"$set": {"status": "invalidated", "invalidated_at": now,
                      "invalidated_reason": "token_reassigned"}},
        )

    payload = {
        "user_id": user_id,
        "installation_id": installation_id,
        "provider": provider,
        "platform": platform,
        "device_token": device_token,
        "token_hash": th,
        "token_preview": token_preview(device_token),
        "permission_status": permission_status,
        "app_version": app_version,
        "build_number": build_number,
        "runtime_version": runtime_version,
        "device_model": device_model,
        "locale": locale,
        "timezone": timezone_name,
        "email": user_doc.get("email"),
        "role": user_doc.get("role"),
        "status": "active",
        "last_seen_at": now,
        "invalidated_at": None,
        "invalidated_reason": None,
        "schema_version": 1,
    }
    await db.comm_installations.update_one(
        {"installation_id": installation_id},
        {"$set": payload,
         "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now}},
        upsert=True,
    )
    row = await db.comm_installations.find_one({"installation_id": installation_id},
                                                {"_id": 0, "device_token": 0})
    return row or {}


async def revoke(db, *, installation_id: str, user_id: Optional[str] = None) -> bool:
    """Called on logout. Sets status=revoked and clears user_id binding
    so future sends never reach a signed-out account."""
    q: Dict[str, Any] = {"installation_id": installation_id}
    if user_id:
        q["user_id"] = user_id
    res = await db.comm_installations.update_one(
        q,
        {"$set": {"status": "revoked", "revoked_at": _now(), "user_id": None}},
    )
    return bool(res.modified_count)


async def invalidate_token_hash(db, *, provider: str, token_hash_hex: str,
                                 reason: str) -> int:
    """Mark all installations with this token_hash invalidated. Used by
    the outbox push.send handler when FCM returns UNREGISTERED."""
    res = await db.comm_installations.update_many(
        {"provider": provider, "token_hash": token_hash_hex, "status": "active"},
        {"$set": {"status": "invalidated", "invalidated_at": _now(),
                  "invalidated_reason": reason}},
    )
    return int(res.modified_count)


async def list_active_for_user(db, user_id: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    async for r in db.comm_installations.find(
        {"user_id": user_id, "status": "active"},
        {"_id": 0, "device_token": 0},
    ).sort("last_seen_at", -1):
        rows.append(r)
    return rows


async def get_token_for_send(db, installation_id: str) -> Optional[Dict[str, str]]:
    """Return {provider, token, token_hash} for an active installation,
    or None. Handler-only call — the raw token never leaves the backend."""
    row = await db.comm_installations.find_one(
        {"installation_id": installation_id, "status": "active"},
        {"_id": 0, "provider": 1, "device_token": 1, "token_hash": 1,
         "platform": 1, "user_id": 1},
    )
    if not row:
        return None
    return {
        "provider": row.get("provider"),
        "token": row.get("device_token"),
        "token_hash": row.get("token_hash"),
        "platform": row.get("platform"),
        "user_id": row.get("user_id"),
    }
