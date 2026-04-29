"""ConsultUro — me_tier router.

  · /api/me/tier

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from fastapi import APIRouter, Depends
from auth_deps import is_owner_or_partner, is_primary_or_super, is_super_owner, require_user

router = APIRouter()


@router.get("/api/me/tier")
async def get_my_tier(user=Depends(require_user)):
    """Flat boolean flags describing the current user's tier so the
    frontend can render role-gated UI without re-implementing the
    hierarchy logic. Always safe to call."""
    can_blog = is_super_owner(user) or (
        user.get("role") == "primary_owner" and bool(user.get("can_create_blog"))
    )
    # Dashboard access — all owner-tier roles (super_owner, primary_owner,
    # partner, legacy owner) get FULL dashboard access BY DEFAULT. The
    # super_owner can demote a specific primary_owner to LIMITED by
    # flipping `dashboard_full_access: false` on their user record.
    # Non-owner roles (doctor/assistant/etc) keep the legacy per-user
    # opt-in semantic.
    role = user.get("role")
    dfa_raw = user.get("dashboard_full_access")
    if role in {"super_owner", "primary_owner", "owner", "partner"}:
        dashboard_full_access = (dfa_raw is not False)  # default True unless explicitly revoked
    else:
        dashboard_full_access = bool(dfa_raw)
    return {
        "role": role,
        "is_super_owner": is_super_owner(user),
        "is_primary_owner": (role in {"primary_owner", "owner"}),
        "is_partner": role == "partner",
        "is_owner_tier": is_owner_or_partner(user),
        "can_manage_partners": is_primary_or_super(user),
        "can_manage_primary_owners": is_super_owner(user),
        "can_create_blog": can_blog,
        "dashboard_full_access": dashboard_full_access,
        "is_demo": bool(user.get("is_demo")),
    }
