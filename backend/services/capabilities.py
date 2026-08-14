"""ConsultUro 2.0 — Phase C: capability catalog + resolver.

Single source of truth for "who can do what". Roles grant defaults;
per-user boolean flags (already stored on user docs and managed from
the Team panel) grant or revoke individual capabilities.

Policies:
  owner_implicit     — owner tier always; others need the flag True.
  staff_default_true — owner tier always; non-patient staff allowed
                       unless flag explicitly False; patients need
                       flag explicitly True.
  owner_revocable    — super_owner always; owner tier allowed unless
                       `can_create_blog` explicitly False; others need
                       the flag True. (Blog editorial policy.)
  owner_only / primary_only / super_only — pure role gates.

The legacy `require_*` FastAPI deps in server.py now delegate here, so
route signatures (and therefore behaviour) are unchanged.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException

from auth_deps import OWNER_TIER_ROLES, PRIMARY_TIER_ROLES

CAPABILITIES: Dict[str, Dict[str, Any]] = {
    "prescribe": {
        "label": "Prescribe medicines",
        "flag": "can_prescribe",
        "policy": "owner_implicit",
    },
    "manage_surgeries": {
        "label": "Manage surgery scheduler",
        "flag": "can_manage_surgeries",
        "policy": "owner_implicit",
    },
    "manage_availability": {
        "label": "Manage availability & time off",
        "flag": "can_manage_availability",
        "policy": "owner_implicit",
    },
    "approve_broadcasts": {
        "label": "Approve & send broadcasts",
        "flag": "can_approve_broadcasts",
        "policy": "owner_implicit",
    },
    "approve_bookings": {
        "label": "Approve / manage bookings",
        "flag": "can_approve_bookings",
        "policy": "owner_implicit",
    },
    "full_dashboard": {
        "label": "Full dashboard access",
        "flag": "dashboard_full_access",
        "policy": "owner_implicit",
    },
    "send_personal_messages": {
        "label": "Send personal messages",
        "flag": "can_send_personal_messages",
        "policy": "staff_default_true",
    },
    "manage_blog": {
        "label": "Write & edit blog posts",
        "flag": "can_manage_blog",
        "policy": "owner_revocable",
    },
    "manage_team": {
        "label": "Manage team members",
        "policy": "owner_only",
    },
    "manage_partners": {
        "label": "Manage partners",
        "policy": "primary_only",
    },
    "platform_admin": {
        "label": "Platform administration",
        "policy": "super_only",
    },
}


def has_capability(user: Optional[Dict[str, Any]], cap: str) -> bool:
    if not user:
        return False
    spec = CAPABILITIES.get(cap)
    if not spec:
        return False
    role = user.get("role") or ""
    policy = spec.get("policy") or "owner_implicit"
    flag = spec.get("flag") or ""

    if policy == "super_only":
        return role == "super_owner"
    if policy == "primary_only":
        return role in PRIMARY_TIER_ROLES
    if policy == "owner_only":
        return role in OWNER_TIER_ROLES
    if policy == "owner_revocable":
        if role == "super_owner":
            return True
        if role in ("primary_owner", "owner", "partner"):
            return user.get("can_create_blog") is not False
        return bool(user.get(flag))
    if policy == "staff_default_true":
        if role in OWNER_TIER_ROLES:
            return True
        explicit = user.get(flag)
        if role and role != "patient":
            return explicit is not False
        return bool(explicit)
    # owner_implicit (default)
    if role in OWNER_TIER_ROLES:
        return True
    return bool(user.get(flag))


def resolve_capabilities(user: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """Full capability map for a user — powers UI gating via
    GET /api/me/capabilities."""
    return {cap: has_capability(user, cap) for cap in CAPABILITIES}


def require_capability(cap: str, detail: Optional[str] = None):
    """FastAPI dependency factory: 403 unless the user holds `cap`."""
    from auth_deps import require_user  # late import — avoids cycles

    async def _dep(user=Depends(require_user)) -> Dict[str, Any]:
        if not has_capability(user, cap):
            label = CAPABILITIES.get(cap, {}).get("label", cap)
            raise HTTPException(status_code=403, detail=detail or f"{label} permission required")
        return user

    return _dep
