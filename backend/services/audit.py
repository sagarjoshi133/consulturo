"""ConsultUro — Multi-tenant audit trail helpers.

Phase E polish — adds clinic-scoped audit logging on top of the
existing global `audit_log` collection. Every helper writes
`clinic_id` so reports / per-clinic exports filter correctly.

Usage:
    from services.audit import log_action
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="prescription.create",
        target_id=rx["prescription_id"],
        meta={"patient_name": rx["patient_name"]},
    )

Read API: `GET /api/clinics/{clinic_id}/audit-log` (added below).
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth_deps import is_super_owner, require_user
from db import db
from services.tenancy import (
    MEMBERSHIPS_COLL,
    get_clinic_by_id,
    resolve_clinic_id,
)

AUDIT_COLL = "audit_log"


async def log_action(
    *,
    actor: Optional[Dict[str, Any]],
    clinic_id: Optional[str],
    action: str,
    target_id: Optional[str] = None,
    target_type: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort audit write. Never raises — audit failure must
    never block the user-facing API call.

    `action` is a dotted string like 'prescription.create' or
    'clinic.update' — keep verbs at the end to ease grouping.
    """
    try:
        actor_id = (actor or {}).get("user_id") or (actor or {}).get("id")
        actor_name = (actor or {}).get("name") or (actor or {}).get("email")
        actor_role = (actor or {}).get("role")
        await db[AUDIT_COLL].insert_one({
            "log_id": f"audit_{uuid.uuid4().hex[:12]}",
            "ts": int(time.time() * 1000),
            "clinic_id": clinic_id,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": action,
            "target_id": target_id,
            "target_type": target_type,
            "meta": meta or {},
        })
    except Exception:  # noqa: BLE001
        # Audit must never break the request path.
        pass


# ── Clinic-scoped audit reader ──────────────────────────────────────────
router = APIRouter()


@router.get("/api/clinics/{clinic_id}/audit-log")
async def list_clinic_audit(
    clinic_id: str,
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Per-clinic audit feed. Visible to the clinic's primary_owner /
    super_owner only. Sorted newest-first."""
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if not is_super_owner(user):
        if clinic.get("primary_owner_id") != (user.get("user_id") or user.get("id")):
            # Doctors / staff cannot view the audit log.
            raise HTTPException(status_code=403, detail="Only the clinic's primary owner can view the audit log.")
    cursor = db[AUDIT_COLL].find(
        {"clinic_id": clinic_id}, {"_id": 0}
    ).sort("ts", -1).limit(limit)
    return {"entries": await cursor.to_list(length=limit)}
