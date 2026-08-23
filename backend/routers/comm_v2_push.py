"""Comm V2 push endpoints — installations, diagnostics, test-send.

Public/authenticated endpoints:
    POST /api/v2/communications/installations/register
    POST /api/v2/communications/installations/revoke

Owner-only diagnostics:
    GET  /api/v2/communications/admin/push/diagnostics
    POST /api/v2/communications/admin/push/test-self
    POST /api/v2/communications/admin/push/enqueue-test   (owner canary)
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from server import db, get_current_user, require_owner, require_user
from services import comm_fcm, comm_installations, comm_outbox, comm_audit
from services import comm_flags

router = APIRouter(prefix="/api/v2/communications", tags=["communications-v2-push"])


# ── Register / revoke ──────────────────────────────────────────

class InstallationRegisterBody(BaseModel):
    installation_id: str = Field(..., min_length=8, max_length=128)
    provider: str = Field(..., pattern="^(fcm|apns)$")
    platform: str = Field(..., pattern="^(android|ios|web)$")
    device_token: str = Field(..., min_length=1)
    permission_status: Optional[str] = None
    app_version: Optional[str] = None
    build_number: Optional[str] = None
    runtime_version: Optional[str] = None
    device_model: Optional[str] = None
    locale: Optional[str] = None
    timezone: Optional[str] = None


@router.post("/installations/register")
async def register_installation(
    body: InstallationRegisterBody,
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Register (or refresh) a device installation.

    Honest return contract — matches the spec's "never return
    registered:true when provider config or registration failed":

        {
          "installation_id": "...",
          "token_hash": "sha256:...",
          "stored": true,
          "provider_configured": bool,      # firebase_admin loaded?
          "provider_verified": bool,        # dry_run send succeeded?
          "provider_error_code": str|null,
          "v2_push_enabled_for_user": bool  # feature-flag view for this user
        }
    """
    uid = user.get("user_id") or user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")

    row = await comm_installations.register(
        db,
        user_id=uid,
        installation_id=body.installation_id,
        provider=body.provider,
        platform=body.platform,
        device_token=body.device_token,
        permission_status=body.permission_status,
        app_version=body.app_version,
        build_number=body.build_number,
        runtime_version=body.runtime_version,
        device_model=body.device_model,
        locale=body.locale,
        timezone_name=body.timezone,
    )

    # Provider verification — dry_run send to prove the token is
    # actually deliverable end-to-end. Only for FCM (APNs dry-run
    # via firebase-admin routes through the same call).
    provider_configured = comm_fcm.is_configured()
    provider_verified = False
    provider_error_code: Optional[str] = None
    if provider_configured:
        dry = await comm_fcm.send_dry_run(token=body.device_token,
                                           category="system")
        provider_verified = bool(dry.get("ok"))
        if not provider_verified:
            provider_error_code = str(dry.get("code") or "unknown")
            if dry.get("category") == "invalidate":
                # Token really is bad — invalidate immediately.
                await comm_installations.invalidate_token_hash(
                    db, provider=body.provider,
                    token_hash_hex=comm_installations.token_hash(body.device_token),
                    reason=provider_error_code or "invalidate",
                )

    v2_on = await comm_flags.is_enabled_for_user(
        db, "COMMUNICATIONS_V2_PUSH_ENABLED", uid)

    return {
        "installation_id": body.installation_id,
        "token_hash": row.get("token_hash"),
        "token_preview": row.get("token_preview"),
        "stored": True,
        "provider_configured": provider_configured,
        "provider_verified": provider_verified,
        "provider_error_code": provider_error_code,
        "provider_init_error": None if provider_configured else comm_fcm.last_init_error(),
        "v2_push_enabled_for_user": v2_on,
    }


class InstallationRevokeBody(BaseModel):
    installation_id: str


@router.post("/installations/revoke")
async def revoke_installation(
    body: InstallationRevokeBody,
    user=Depends(require_user),
) -> Dict[str, Any]:
    uid = user.get("user_id") or user.get("id")
    changed = await comm_installations.revoke(db, installation_id=body.installation_id,
                                               user_id=uid)
    return {"ok": True, "changed": changed}


# ── Diagnostics (owner) ────────────────────────────────────────

@router.get("/admin/push/diagnostics")
async def push_diagnostics(user=Depends(require_owner)) -> Dict[str, Any]:
    """Independent status of every stage — never conflates them.

    Reports each stage honestly:
      1. provider_configured — firebase_admin has valid credentials
      2. provider_project_id — the project_id from the service account
      3. active_installations_total — active rows in comm_installations
      4. invalidated_installations_total — rows we've disabled due to
         FCM UNREGISTERED / INVALID_ARGUMENT
      5. legacy_installations_total — rows migrated from push_tokens without
         a stable installation_id (require_reregistration)
      6. last_send_summary — last N send events from comm_delivery_attempts
    """
    provider_configured = comm_fcm.is_configured()
    proj_id = comm_fcm.project_id()

    active = await db.comm_installations.count_documents({"status": "active"})
    inval = await db.comm_installations.count_documents({"status": "invalidated"})
    legacy = await db.comm_installations.count_documents(
        {"status": "legacy_requires_reregistration"})
    revoked = await db.comm_installations.count_documents({"status": "revoked"})

    last_sends: List[Dict[str, Any]] = []
    async for r in db.comm_delivery_attempts.find({},
        {"_id": 0}).sort("attempted_at", -1).limit(20):
        last_sends.append(r)

    return {
        "provider_configured": provider_configured,
        "provider_init_error": None if provider_configured else comm_fcm.last_init_error(),
        "provider_project_id": proj_id,
        "installations": {
            "active": active, "invalidated": inval,
            "legacy": legacy, "revoked": revoked,
        },
        "recent_attempts": last_sends,
    }


class TestPushBody(BaseModel):
    installation_id: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None


@router.post("/admin/push/test-self")
async def push_test_self(
    body: TestPushBody = Body(default_factory=TestPushBody),
    user=Depends(require_owner),
) -> Dict[str, Any]:
    """Enqueue a real push to the caller — routed through the outbox so
    we exercise the same code path production traffic uses.
    """
    uid = user.get("user_id") or user.get("id")
    payload: Dict[str, Any] = {
        "user_id": uid,
        "category": "system",
        "title": (body.title or "ConsultUro test push"),
        "body": (body.body or "If this arrived, direct FCM v1 is working ✅"),
        "data": {"type": "test_push", "sent_by": uid},
    }
    if body.installation_id:
        payload.pop("user_id", None)
        payload["installation_ids"] = [body.installation_id]

    ev = await comm_outbox.enqueue(
        db, event_type="push.send",
        aggregate_type="test_push", aggregate_id=uid,
        payload=payload,
        dedupe_key=f"test:{uid}:{uuid.uuid4().hex[:8]}",
        correlation_id=f"admin_test:{uid}",
    )
    # Drain synchronously so the API call returns the actual result.
    summary = await comm_outbox.drain_once(db)
    attempt = await db.comm_delivery_attempts.find_one(
        {"event_id": ev["event_id"]},
        {"_id": 0}, sort=[("attempted_at", -1)],
    )
    await comm_audit.log(
        db, action="push.test_self",
        actor_user_id=uid, actor_role=user.get("role"),
        target_type="outbox_event", target_id=ev["event_id"],
        metadata={"drain_summary": summary, "last_attempt": attempt},
    )
    return {"ok": True, "event_id": ev["event_id"],
            "drain": summary, "last_attempt": attempt}
