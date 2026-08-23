"""Communications V2 admin router.

Comm-1 (foundation) surface only. Later phases add:
  - /installations/*           (Comm-2 — Push V2)
  - /inbox/*                   (Comm-3 — Notification Centre V2)
  - /conversations/* etc.      (Comm-4 — Messaging V2)
  - /broadcasts/* etc.         (Comm-5 — Broadcast Studio V2)
  - /home-notices/*            (Comm-6 — Home Notice Banner)

Owner-tier only: all writes require primary_owner / super_owner. Reads
(flags list, outbox stats) also require owner-tier for safety — we
never expose delivery diagnostics to patients or general staff.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from server import db, require_owner
from services import comm_flags
from services import comm_outbox
from services import comm_audit
from services import comm_reconciliation

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2"])


# ── Feature flags ───────────────────────────────────────────────

@router.get("/admin/flags")
async def get_flags(user=Depends(require_owner)) -> Dict[str, Any]:
    flags = await comm_flags.get_all_flags(db)
    return {"flags": flags, "valid_keys": sorted(comm_flags.VALID_KEYS)}


class FlagBody(BaseModel):
    key: str
    value: Any


@router.post("/admin/flags")
async def set_flag(body: FlagBody, user=Depends(require_owner)) -> Dict[str, Any]:
    if body.key not in comm_flags.VALID_KEYS:
        raise HTTPException(status_code=400, detail={
            "error_code": "unknown_flag",
            "valid_keys": sorted(comm_flags.VALID_KEYS),
        })
    await comm_flags.set_flag(db, body.key, body.value, actor_user_id=user.get("user_id"))
    await comm_audit.log(
        db,
        action="flag.set",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="flag",
        target_id=body.key,
        metadata={"value": body.value},
    )
    return {"ok": True, "flags": await comm_flags.get_all_flags(db)}


# ── Durable outbox ──────────────────────────────────────────────

@router.get("/admin/outbox/stats")
async def outbox_stats(user=Depends(require_owner)) -> Dict[str, Any]:
    return await comm_outbox.outbox_stats(db)


@router.post("/admin/outbox/drain")
async def outbox_drain(user=Depends(require_owner)) -> Dict[str, Any]:
    """Manual drain — process one batch of pending rows synchronously.

    Owner-only (never n8n-integrated at this stage per the spec).
    Handy in preview where the background worker may be idle-sleeping.
    """
    res = await comm_outbox.drain_once(db)
    await comm_audit.log(
        db,
        action="outbox.drain",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="outbox",
        metadata=res,
    )
    return res


class DeadLetterRetryBody(BaseModel):
    event_id: str


@router.post("/admin/outbox/dead-letters/retry")
async def retry_dead_letter(body: DeadLetterRetryBody, user=Depends(require_owner)) -> Dict[str, Any]:
    ok = await comm_outbox.retry_dead_letter(db, body.event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Dead-letter row not found")
    await comm_audit.log(
        db,
        action="outbox.retry_dead_letter",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="outbox_event",
        target_id=body.event_id,
    )
    return {"ok": True}


@router.get("/admin/outbox/dead-letters")
async def list_dead_letters(
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_owner),
) -> Dict[str, Any]:
    rows = []
    async for r in db.comm_dead_letters.find({}, {"_id": 0}).sort("created_at", -1).limit(limit):
        rows.append(r)
    return {"items": rows, "count": len(rows)}


@router.get("/admin/outbox/events")
async def list_events(
    status: Optional[str] = Query(None,
        pattern="^(pending|processing|retry_wait|completed|dead_letter)$"),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(require_owner),
) -> Dict[str, Any]:
    q = {}
    if status:
        q["status"] = status
    rows = []
    async for r in db.comm_outbox.find(q, {"_id": 0}).sort("created_at", -1).limit(limit):
        rows.append(r)
    return {"items": rows, "count": len(rows)}


# ── Diagnostics ─────────────────────────────────────────────────

@router.get("/admin/health")
async def health(user=Depends(require_owner)) -> Dict[str, Any]:
    """One-glance health snapshot for Comm V2. Non-invasive; safe to poll."""
    outbox = await comm_outbox.outbox_stats(db)
    flags = await comm_flags.get_all_flags(db)
    collections = {}
    for name in [
        "comm_installations", "comm_inbox_items", "comm_conversations",
        "comm_messages", "comm_broadcasts", "comm_broadcast_recipients",
        "comm_home_notices", "comm_outbox", "comm_dead_letters", "comm_audit_log",
    ]:
        try:
            collections[name] = await db[name].estimated_document_count()
        except Exception:
            collections[name] = None
    return {
        "outbox": outbox,
        "collections": collections,
        "flags": flags,
    }



# ── Comm-8: migrations & reconciliation ─────────────────────────


class MigrationRunBody(BaseModel):
    scope: str = "all"        # "notifications" | "messages" | "broadcasts" | "all"
    force: bool = False       # re-run even if the _status marker is set


@router.post("/admin/migrations/run")
async def run_migration(body: MigrationRunBody,
                          user=Depends(require_owner)) -> Dict[str, Any]:
    """Trigger one or more V2 backfills on demand.

    Idempotent — each backfill's `_status:*_backfilled` marker in
    `comm_migration_map` guards against duplicate work unless `force=true`
    is passed. Owner-tier only.
    """
    scope = (body.scope or "all").lower().strip()
    if scope not in ("all", "notifications", "messages", "broadcasts"):
        raise HTTPException(status_code=400, detail={
            "error_code": "bad_scope",
            "valid": ["all", "notifications", "messages", "broadcasts"],
        })
    out: Dict[str, Any] = {}

    if scope in ("all", "notifications"):
        try:
            from migrations.comm_v2_inbox_backfill import run_notifications_backfill
            out["notifications"] = await run_notifications_backfill(db, force=body.force)
        except Exception as e:
            out["notifications"] = {"error": str(e)}

    if scope in ("all", "messages"):
        try:
            from migrations.comm_v2_messaging_backfill import run_messaging_backfill
            out["messages"] = await run_messaging_backfill(db, force=body.force)
        except Exception as e:
            out["messages"] = {"error": str(e)}

    if scope in ("all", "broadcasts"):
        try:
            from migrations.comm_v2_broadcasts_backfill import run_broadcasts_backfill
            out["broadcasts"] = await run_broadcasts_backfill(db, force=body.force)
        except Exception as e:
            out["broadcasts"] = {"error": str(e)}

    await comm_audit.log(
        db, action="migration.run",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="migration", target_id=scope,
        metadata={"force": body.force, "result": out},
    )
    return {"scope": scope, "force": body.force, "result": out}


@router.get("/admin/migrations/status")
async def migration_status(user=Depends(require_owner)) -> Dict[str, Any]:
    """Return current backfill markers + last-run timestamps."""
    markers: Dict[str, Any] = {}
    async for row in db.comm_migration_map.find(
        {"source_collection": "_status"},
        {"_id": 0, "source_id": 1, "count": 1, "created_at": 1},
    ):
        markers[row.get("source_id")] = {
            "count": int(row.get("count") or 0),
            "completed_at": row.get("created_at"),
        }
    return {"markers": markers}


@router.get("/admin/reconciliation/report")
async def reconciliation_report(user=Depends(require_owner)) -> Dict[str, Any]:
    """Non-invasive legacy-vs-V2 reconciliation report.

    Compares:
      * notifications  → comm_inbox_items (migratable subset only)
      * messages       → comm_messages (patient↔staff only)
      * broadcasts     → comm_broadcasts
      * broadcast_inbox→ comm_broadcast_recipients
    """
    return await comm_reconciliation.build_report(db)


# ── Comm-9: cutover / rollback controls ─────────────────────────

_CUTOVER_ON = {
    "COMMUNICATIONS_V2_ENABLED": True,
    "COMMUNICATIONS_V2_PUSH_ENABLED": True,
    "COMMUNICATIONS_V2_MESSAGES_ENABLED": True,
    "COMMUNICATIONS_V2_BROADCASTS_ENABLED": True,
    "COMMUNICATIONS_V2_HOME_NOTICES_ENABLED": True,
    "COMMUNICATIONS_V2_MIRROR_LEGACY": True,
    "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": True,
}

_CUTOVER_OFF = {
    # rollback = all V2 off + mirror preserved (safe read state)
    "COMMUNICATIONS_V2_ENABLED": False,
    "COMMUNICATIONS_V2_PUSH_ENABLED": False,
    "COMMUNICATIONS_V2_MESSAGES_ENABLED": False,
    "COMMUNICATIONS_V2_BROADCASTS_ENABLED": False,
    "COMMUNICATIONS_V2_HOME_NOTICES_ENABLED": False,
    "COMMUNICATIONS_V2_MIRROR_LEGACY": True,
    "COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED": False,
}


@router.post("/admin/cutover/apply")
async def cutover_apply(user=Depends(require_owner)) -> Dict[str, Any]:
    """Apply the Comm-9 cutover: flip all V2 flags ON + set the
    legacy-runtime-disabled sentinel. Writes go to db.comm_flags so
    they survive a process restart WITHOUT touching .env.

    Idempotent — re-running is a no-op.
    """
    for k, v in _CUTOVER_ON.items():
        await comm_flags.set_flag(db, k, v, actor_user_id=user.get("user_id"))
    await comm_audit.log(
        db, action="cutover.apply",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="comm_v2", target_id="cutover",
        metadata=_CUTOVER_ON,
    )
    return {"ok": True, "applied": _CUTOVER_ON,
            "flags": await comm_flags.get_all_flags(db)}


@router.post("/admin/cutover/rollback")
async def cutover_rollback(user=Depends(require_owner)) -> Dict[str, Any]:
    """Emergency rollback — flip V2 subsystems OFF and re-enable
    legacy write routes. Historical V2 data is preserved (never
    deleted); this only changes runtime gating."""
    for k, v in _CUTOVER_OFF.items():
        await comm_flags.set_flag(db, k, v, actor_user_id=user.get("user_id"))
    await comm_audit.log(
        db, action="cutover.rollback",
        actor_user_id=user.get("user_id"),
        actor_role=user.get("role"),
        target_type="comm_v2", target_id="cutover",
        metadata=_CUTOVER_OFF,
    )
    return {"ok": True, "applied": _CUTOVER_OFF,
            "flags": await comm_flags.get_all_flags(db)}


@router.get("/admin/cutover/status")
async def cutover_status(user=Depends(require_owner)) -> Dict[str, Any]:
    """Human-readable summary of the cutover state.

    Returns:
      state: "cutover_active" | "canary_only" | "legacy_only" | "mixed"
      flags: current effective flag map.
      recent_actions: last 10 comm audit rows tagged cutover.*.
    """
    flags = await comm_flags.get_all_flags(db)
    v2_on = bool(flags.get("COMMUNICATIONS_V2_ENABLED"))
    canary = flags.get("COMMUNICATIONS_V2_CANARY_USER_IDS") or []
    legacy_off = bool(flags.get("COMMUNICATIONS_V2_LEGACY_RUNTIME_DISABLED"))
    if v2_on and legacy_off:
        state = "cutover_active"
    elif v2_on and not legacy_off:
        state = "mixed"
    elif not v2_on and canary:
        state = "canary_only"
    else:
        state = "legacy_only"
    recent = []
    async for row in db.comm_audit_log.find(
        {"action": {"$regex": "^cutover\\."}}, {"_id": 0},
    ).sort("created_at", -1).limit(10):
        recent.append(row)
    return {"state": state, "flags": flags, "recent_actions": recent}
