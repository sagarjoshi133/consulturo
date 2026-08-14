"""ConsultUro 2.0 — Phase B: Notification V2 router.

  · GET  /api/push/health-panel   — single-call push pipeline health
  · POST /api/push/outbox/flush   — owner: force an outbox drain pass
  · GET  /api/push/outbox         — owner: inspect recent outbox rows
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from auth_deps import OWNER_TIER_ROLES, require_owner, require_user
from db import db

router = APIRouter()


@router.get("/api/push/health-panel")
async def push_health_panel(user=Depends(require_user)):
    """One-stop Phase B health snapshot for the Notifications Health
    panel: relay state, caller device installations, outbox queue
    stats, inbox v2 counts, 24 h send aggregates and a plain-English
    next step."""
    from services.notification_outbox import outbox_stats
    from services.push_relay import is_configured

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    uid = user["user_id"]
    relay_on = bool(is_configured())

    # ── Caller's device installations ────────────────────────────────
    devices: List[Dict[str, Any]] = []
    try:
        async for d in db.device_installations.find(
            {"user_id": uid}, {"_id": 0}
        ).sort("last_seen_at", -1).limit(10):
            devices.append({
                "installation_id": d.get("installation_id"),
                "platform": d.get("platform"),
                "transport": d.get("transport"),
                "token_preview": (d.get("device_token") or "")[:24] + "…",
                "last_seen_at": d.get("last_seen_at"),
                "backfilled": bool(d.get("backfilled")),
            })
    except Exception:
        pass
    total_installs = await db.device_installations.count_documents({})

    # ── Outbox stats ─────────────────────────────────────────────────
    outbox = await outbox_stats()

    # ── Inbox v2 counts (caller) ─────────────────────────────────────
    inbox_unread = await db.notification_inbox.count_documents(
        {"user_id": uid, "read": False}
    )
    inbox_total = await db.notification_inbox.count_documents({"user_id": uid})

    # ── 24 h send aggregates (push_log) ──────────────────────────────
    attempts = successes = failures = 0
    async for row in db.push_log.find(
        {"created_at": {"$gte": day_ago}},
        {"_id": 0, "sent": 1, "total": 1},
    ):
        attempts += 1
        sent = row.get("sent") or 0
        total = row.get("total") or 0
        successes += sent
        failures += max(0, total - sent)

    # ── Last relay resync outcome ────────────────────────────────────
    last_resync = await db.push_resync_log.find_one(
        {}, {"_id": 0, "total_rows": 1, "resynced": 1, "errors": 1, "at": 1},
        sort=[("at", -1)],
    )

    out: Dict[str, Any] = {
        "relay_configured": relay_on,
        "devices": {
            "total_installations": total_installs,
            "yours": len(devices),
            "your_devices": devices,
        },
        "outbox": outbox,
        "inbox": {"unread": inbox_unread, "total": inbox_total},
        "sends_24h": {
            "attempts": attempts,
            "sent": successes,
            "failed": failures,
        },
        "last_resync": last_resync,
    }

    # ── Owner extras: recent dead-letter rows ────────────────────────
    if user.get("role") in OWNER_TIER_ROLES:
        dead: List[Dict[str, Any]] = []
        async for r in db.notification_outbox.find(
            {"status": "dead"},
            {"_id": 0, "id": 1, "kind": 1, "attempts": 1,
             "last_error": 1, "updated_at": 1, "recipients": 1},
        ).sort("updated_at", -1).limit(5):
            r["recipient_count"] = len(r.pop("recipients", []) or [])
            dead.append(r)
        out["recent_dead_letters"] = dead

    # ── Guidance ─────────────────────────────────────────────────────
    if not relay_on:
        next_step = (
            "EMERGENT_PUSH_KEY is still 'placeholder' — device pushes are "
            "disabled in this environment. Click Publish → Deploy to "
            "activate the relay; mirrored tokens auto-resync on boot."
        )
    elif not devices:
        next_step = (
            "Relay is LIVE but no device installation is registered for "
            "your account. Open the installed app, sign in and grant "
            "notification permission."
        )
    elif (outbox.get("dead_24h") or 0) > 0:
        next_step = (
            f"{outbox['dead_24h']} push payload(s) dead-lettered in the "
            "last 24 h after 5 retries — check recent_dead_letters for the "
            "upstream error."
        )
    elif (outbox.get("pending") or 0) > 0:
        next_step = (
            f"{outbox['pending']} push payload(s) queued for retry — the "
            "worker drains every 60 s with backoff."
        )
    else:
        next_step = "Delivery pipeline healthy. Use 'Send test push' to verify end-to-end."
    out["next_step"] = next_step
    return out


@router.post("/api/push/outbox/flush")
async def push_outbox_flush(user=Depends(require_owner)):
    """Force one outbox drain pass (expiry sweep + delivery attempts).
    The background worker does this automatically every 60 s — this
    endpoint exists so an owner can force it right after a deploy."""
    from services.notification_outbox import outbox_worker_pass
    res = await outbox_worker_pass()
    res.pop("_id", None)
    return res


@router.get("/api/push/outbox")
async def push_outbox_list(status: str = "", limit: int = 50, user=Depends(require_owner)):
    """Inspect recent outbox rows (optionally filtered by status)."""
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    rows = await db.notification_outbox.find(
        q, {"_id": 0, "data": 0}
    ).sort("created_at", -1).to_list(length=max(1, min(limit, 200)))
    return {"items": rows, "count": len(rows)}
