"""ConsultUro — team router.

  · /api/team/invites
  · /api/team
  · /api/team/{email}
  · /api/team/roles
  · /api/team/roles/{slug}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict
import re
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import OWNER_TIER_ROLES, PRIMARY_TIER_ROLES, STAFF_ROLES, VALID_ROLES, require_owner, require_user
from models import RoleLabelBody, TeamInviteBody, TeamUpdateBody
from server import OWNER_EMAIL, get_effective_role, notify_role_change

router = APIRouter()


@router.post("/api/team/invites")
async def create_invite(body: TeamInviteBody, user=Depends(require_owner)):
    # Allow core role OR a registered custom role_label slug.
    if body.role not in VALID_ROLES:
        custom = await db.role_labels.find_one({"slug": body.role}, {"_id": 0})
        if not custom:
            raise HTTPException(status_code=400, detail="Invalid role")
    email_l = body.email.lower()
    # Look up the *previous* role (if any) so we only notify on a real change.
    existing_invite = await db.team_invites.find_one({"email": email_l}, {"_id": 0})
    existing_user = await db.users.find_one({"email": email_l}, {"_id": 0})
    prev_role = (existing_user or {}).get("role") or (existing_invite or {}).get("role")
    # Derive permission defaults by effective category.
    eff = await get_effective_role(body.role)
    doctor_like = eff["category"] == "doctor"
    can_approve_book = body.can_approve_bookings or doctor_like
    can_approve_bc = body.can_approve_broadcasts or doctor_like
    invite_doc = {
        "email": email_l,
        "name": body.name,
        "role": body.role,
        "can_approve_bookings": can_approve_book,
        "can_approve_broadcasts": can_approve_bc,
        "invited_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.team_invites.update_one({"email": email_l}, {"$set": invite_doc}, upsert=True)
    await db.users.update_one(
        {"email": email_l},
        {
            "$set": {
                "role": body.role,
                "can_approve_bookings": can_approve_book,
                "can_approve_broadcasts": can_approve_bc,
            }
        },
    )
    # Notify the team member about the new role assignment (first time or change).
    if existing_user and prev_role != body.role:
        await notify_role_change(existing_user.get("user_id"), email_l, prev_role, body.role)
    return {
        "ok": True,
        "email": email_l,
        "role": body.role,
        "can_approve_bookings": can_approve_book,
        "can_approve_broadcasts": can_approve_bc,
    }

@router.patch("/api/team/{email}")
async def update_team_member(email: str, body: TeamUpdateBody, user=Depends(require_owner)):
    email_l = email.lower()
    if email_l == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Owner role cannot be modified")
    updates: Dict[str, Any] = {}
    if body.role is not None:
        if body.role not in VALID_ROLES:
            custom = await db.role_labels.find_one({"slug": body.role}, {"_id": 0})
            if not custom:
                raise HTTPException(status_code=400, detail="Invalid role")
        if body.role == "owner":
            raise HTTPException(status_code=400, detail="Owner cannot be assigned via team panel")
        updates["role"] = body.role
    if body.can_approve_bookings is not None:
        updates["can_approve_bookings"] = bool(body.can_approve_bookings)
    if body.can_approve_broadcasts is not None:
        updates["can_approve_broadcasts"] = bool(body.can_approve_broadcasts)
    if body.can_send_personal_messages is not None:
        updates["can_send_personal_messages"] = bool(body.can_send_personal_messages)
    if body.can_prescribe is not None:
        updates["can_prescribe"] = bool(body.can_prescribe)
    if body.can_manage_surgeries is not None:
        updates["can_manage_surgeries"] = bool(body.can_manage_surgeries)
    if body.can_manage_availability is not None:
        updates["can_manage_availability"] = bool(body.can_manage_availability)
    if body.dashboard_full_access is not None:
        # Only the owner can grant Full Dashboard Access. Cascading is
        # disabled by design (require_owner above already enforces this).
        updates["dashboard_full_access"] = bool(body.dashboard_full_access)
    if body.dashboard_tabs is not None:
        # Whitelist known dashboard tab ids so a malformed PATCH can't
        # accidentally grant access to an unknown future surface.
        ALLOWED_TABS = {
            "bookings", "consultations", "rx", "availability",
            "team", "push", "homepage", "backups",
        }
        clean = [t for t in body.dashboard_tabs if isinstance(t, str) and t in ALLOWED_TABS]
        updates["dashboard_tabs"] = clean
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    existing_invite = await db.team_invites.find_one({"email": email_l}, {"_id": 0})
    existing_user = await db.users.find_one({"email": email_l}, {"_id": 0})
    if not existing_invite and not existing_user:
        raise HTTPException(status_code=404, detail="Team member not found")
    prev_role = (existing_user or {}).get("role") or (existing_invite or {}).get("role")
    await db.team_invites.update_one({"email": email_l}, {"$set": updates}, upsert=False)
    await db.users.update_one({"email": email_l}, {"$set": updates})
    # Notify the team member if their role actually changed.
    if existing_user and "role" in updates and prev_role != updates["role"]:
        await notify_role_change(existing_user.get("user_id"), email_l, prev_role, updates["role"])
    return {"ok": True, "email": email_l, **updates}

@router.get("/api/team")
async def list_team(user=Depends(require_owner)):
    invites = await db.team_invites.find({}, {"_id": 0}).to_list(length=500)
    users = await db.users.find({}, {"_id": 0}).to_list(length=1000)
    role_labels = await db.role_labels.find({}, {"_id": 0}).to_list(length=100)
    by_email = {}
    for iv in invites:
        by_email[iv["email"]] = {
            "email": iv["email"],
            "name": iv.get("name"),
            "role": iv["role"],
            "can_approve_bookings": iv.get("can_approve_bookings", False),
            "can_approve_broadcasts": iv.get("can_approve_broadcasts", False),
            "can_send_personal_messages": iv.get("can_send_personal_messages", False),
            "can_prescribe": iv.get("can_prescribe", False),
            "can_manage_surgeries": iv.get("can_manage_surgeries", False),
            "can_manage_availability": iv.get("can_manage_availability", False),
            "status": "invited",
        }
    # Determine custom role slugs so we include their holders as staff.
    # `category=="doctor"` is retained for backward-compat — those slugs
    # still surface as team members but no longer auto-grant prescriber
    # rights (the per-user `can_prescribe` flag is now the gate).
    custom_slugs = {rl["slug"] for rl in role_labels if rl.get("category") in ("staff", "doctor")}
    for u in users:
        role = u.get("role")
        # Super-owner is platform admin, NOT a clinic team member —
        # never list them on a Primary Owner's Team panel. Personal
        # messaging between primary_owner ↔ super_owner still works
        # via /api/messages/recipients (separate hierarchy rule there).
        if role == "super_owner":
            continue
        if role in STAFF_ROLES or role in custom_slugs:
            by_email[u["email"]] = {
                "email": u["email"],
                "name": u.get("name"),
                "role": role,
                # Default is owner-tier-only; everyone else must opt in.
                "can_approve_bookings": u.get("can_approve_bookings", role in OWNER_TIER_ROLES),
                "can_approve_broadcasts": u.get("can_approve_broadcasts", role in OWNER_TIER_ROLES),
                "can_send_personal_messages": bool(u.get("can_send_personal_messages", role in PRIMARY_TIER_ROLES)),
                "can_prescribe": bool(u.get("can_prescribe", role in OWNER_TIER_ROLES)),
                "can_manage_surgeries": bool(u.get("can_manage_surgeries", role in OWNER_TIER_ROLES)),
                "can_manage_availability": bool(u.get("can_manage_availability", role in OWNER_TIER_ROLES)),
                "dashboard_full_access": bool(u.get("dashboard_full_access", False)),
                "dashboard_tabs": list(u.get("dashboard_tabs") or []),
                "status": "active",
                "picture": u.get("picture"),
                "user_id": u.get("user_id"),
            }
    return sorted(by_email.values(), key=lambda x: (x["role"], x["email"]))

@router.get("/api/team/roles")
async def list_roles(user=Depends(require_user)):
    """Return the union of core roles + owner's custom labels so UI can render pickers."""
    core = [
        # `doctor` is now a regular staff label — its prescriber rights
        # are gated by the per-user `can_prescribe` flag, not the role.
        {"slug": "doctor", "label": "Doctor", "category": "staff", "builtin": True},
        {"slug": "assistant", "label": "Assistant", "category": "staff", "builtin": True},
        {"slug": "reception", "label": "Reception", "category": "staff", "builtin": True},
        {"slug": "nursing", "label": "Nursing Staff", "category": "staff", "builtin": True},
    ]
    custom = await db.role_labels.find({}, {"_id": 0}).to_list(length=100)
    for c in custom:
        c["builtin"] = False
    return {"roles": core + custom}

@router.post("/api/team/roles")
async def create_role(body: RoleLabelBody, user=Depends(require_owner)):
    label = (body.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Label required")
    slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40]
    if not slug or slug in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid or reserved role label")
    category = body.category if body.category in ("staff", "doctor", "patient") else "staff"
    existing = await db.role_labels.find_one({"slug": slug}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Role label already exists")
    doc = {
        "slug": slug,
        "label": label,
        "category": category,
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.role_labels.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.delete("/api/team/roles/{slug}")
async def delete_role(slug: str, user=Depends(require_owner)):
    if slug in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Core roles cannot be removed")
    in_use = await db.users.count_documents({"role": slug}) + await db.team_invites.count_documents({"role": slug})
    if in_use:
        raise HTTPException(status_code=400, detail=f"Cannot remove role: {in_use} member(s) still assigned")
    await db.role_labels.delete_one({"slug": slug})
    return {"ok": True}

@router.delete("/api/team/{email}")
async def remove_team_member(email: str, user=Depends(require_owner)):
    email_l = email.lower()
    if email_l == OWNER_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    await db.team_invites.delete_one({"email": email_l})
    await db.users.update_one(
        {"email": email_l},
        {"$set": {"role": "patient", "can_approve_bookings": False, "can_approve_broadcasts": False}},
    )
    return {"ok": True}
