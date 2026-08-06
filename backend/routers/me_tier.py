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
    # Blog editorial access policy:
    #   • super_owner      → always (immutable)
    #   • primary_owner    → ENABLED BY DEFAULT. Super-owner can revoke
    #     by explicitly setting `can_create_blog: false` on the user
    #     record (PATCH /api/admin/primary-owners/{id}/blog-perm).
    #     A missing flag = enabled.
    #   • partner          → inherits from the clinic's primary_owner
    #     defaults — for now, partners can also blog (owner-tier
    #     clinical co-equal) unless explicitly revoked.
    #   • staff / patient  → only via explicit `can_manage_blog: true`
    #     toggle (set by a primary_owner who themselves has blog
    #     access; gated in /api/team).
    role_str = user.get("role")
    blog_flag_raw = user.get("can_create_blog")
    if is_super_owner(user):
        can_blog = True
    elif role_str in ("primary_owner", "owner", "partner"):
        can_blog = (blog_flag_raw is not False)  # default True unless explicitly revoked
    else:
        # Staff / other roles — explicit grant only.
        can_blog = bool(user.get("can_manage_blog"))
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
    # Patient Database access — primary_owner / super_owner / partner
    # always see it; team members (doctor, assistant, reception,
    # nursing) need an explicit `can_access_patient_db` toggle that
    # primary_owner can flip from the Permission Manager.
    if role in {"super_owner", "primary_owner", "owner", "partner"}:
        can_access_patient_db = True
    else:
        can_access_patient_db = bool(user.get("can_access_patient_db"))
    # Export rights are stricter — only owner-tier (super_owner +
    # primary_owner) can dump the patient list to CSV / Excel.
    can_export_patient_db = role in {"super_owner", "primary_owner", "owner"}
    return {
        "role": role,
        "is_super_owner": is_super_owner(user),
        "is_primary_owner": (role in {"primary_owner", "owner"}),
        "is_partner": role == "partner",
        "is_owner_tier": is_owner_or_partner(user),
        "can_manage_partners": is_primary_or_super(user),
        "can_manage_primary_owners": is_super_owner(user),
        "can_create_blog": can_blog,
        "can_access_patient_db": can_access_patient_db,
        "can_export_patient_db": can_export_patient_db,
        "dashboard_full_access": dashboard_full_access,
        "is_demo": bool(user.get("is_demo")),
    }
