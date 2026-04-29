"""ConsultUro — Clinics router.

Phase A multi-tenant CRUD endpoints:
 • GET  /api/clinics                 — list clinics the caller is a member
                                       of (super_owner sees all)
 • GET  /api/clinics/me              — same as /clinics with role per row
 • POST /api/clinics                 — create a new clinic. Open to
                                       super_owner + any authenticated user
                                       (self-signup → user becomes that
                                        clinic's primary_owner).
 • GET  /api/clinics/{clinic_id}     — fetch one (must be member or super)
 • PATCH /api/clinics/{clinic_id}    — update name / branding / address
                                       (primary_owner of THAT clinic, or
                                        super_owner)
 • GET  /api/clinics/by-slug/{slug}  — PUBLIC fetch by URL slug (anonymous;
                                       used by /c/<slug> landing pages)
 • GET  /api/clinics/{clinic_id}/members
                                     — list memberships
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import (
    require_user,
    is_super_owner,
)
from db import db
from services.audit import log_action
from services.tenancy import (
    CLINICS_COLL,
    MEMBERSHIPS_COLL,
    create_clinic,
    get_clinic_by_id,
    get_clinic_by_slug,
    get_user_clinics,
    slugify,
    upsert_membership,
)

router = APIRouter()


# ── Pydantic bodies ─────────────────────────────────────────────────────
class CreateClinicBody(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    slug: Optional[str] = Field(None, min_length=2, max_length=60)
    tagline: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    branding: Optional[Dict[str, Any]] = None


class UpdateClinicBody(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=120)
    tagline: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    branding: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


# ── Helpers ─────────────────────────────────────────────────────────────
async def _require_clinic_admin(user: Dict[str, Any], clinic_id: str) -> Dict[str, Any]:
    """Caller must be super_owner OR the clinic's primary_owner. Returns
    the clinic doc. 403/404 otherwise."""
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if is_super_owner(user):
        return clinic
    if clinic.get("primary_owner_id") != (user.get("user_id") or user.get("id")):
        raise HTTPException(
            status_code=403,
            detail="Only the clinic's primary owner can perform this action.",
        )
    return clinic


def _public_clinic_view(c: Dict[str, Any]) -> Dict[str, Any]:
    """Strip private fields before returning a clinic over a PUBLIC
    endpoint. Branding / contact info stays — that's what the patient
    needs to see on the landing page."""
    return {
        "clinic_id": c.get("clinic_id"),
        "slug": c.get("slug"),
        "name": c.get("name"),
        "tagline": c.get("tagline", ""),
        "address": c.get("address", ""),
        "phone": c.get("phone", ""),
        "email": c.get("email", ""),
        "branding": c.get("branding") or {},
        "is_active": c.get("is_active", True),
    }


def _uid(user: Dict[str, Any]) -> str:
    return user.get("user_id") or user.get("id") or ""


# ── Endpoints ───────────────────────────────────────────────────────────
@router.get("/api/clinics")
async def list_clinics(user=Depends(require_user)) -> Dict[str, Any]:
    """List clinics. super_owner gets ALL clinics; everyone else gets the
    ones they're a member of."""
    if is_super_owner(user):
        cursor = db[CLINICS_COLL].find({"deleted_at": None}, {"_id": 0})
        all_clinics = await cursor.to_list(length=1000)
        return {
            "clinics": [
                {**c, "role": "super_owner"} for c in all_clinics
            ],
            "default_clinic_id": all_clinics[0]["clinic_id"] if all_clinics else None,
        }
    rows = await get_user_clinics(_uid(user), only_active=True)
    return {
        "clinics": [{**r["clinic"], "role": r["role"]} for r in rows],
        "default_clinic_id": rows[0]["clinic"]["clinic_id"] if rows else None,
    }


@router.post("/api/clinics", status_code=201)
async def create_clinic_endpoint(
    body: CreateClinicBody,
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Create a new clinic. The caller becomes that clinic's
    primary_owner. super_owner can create on behalf of others later via
    a separate admin endpoint; for Phase A the creator IS the owner."""
    final_slug = await slugify(body.name, prefer=body.slug)
    clinic = await create_clinic(
        name=body.name,
        primary_owner_id=_uid(user),
        slug=final_slug,
        tagline=body.tagline,
        address=body.address,
        phone=body.phone,
        email=body.email,
        branding=body.branding,
    )
    await log_action(
        actor=user,
        clinic_id=clinic["clinic_id"],
        action="clinic.create",
        target_id=clinic["clinic_id"],
        target_type="clinic",
        meta={"slug": clinic["slug"], "name": clinic["name"]},
    )
    return clinic


@router.get("/api/clinics/by-slug/{slug}")
async def get_by_slug(slug: str) -> Dict[str, Any]:
    """PUBLIC endpoint for /c/<slug> landing pages. Anonymous access."""
    clinic = await get_clinic_by_slug(slug)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    return _public_clinic_view(clinic)


@router.get("/api/clinics/{clinic_id}")
async def get_clinic(
    clinic_id: str, user=Depends(require_user)
) -> Dict[str, Any]:
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if is_super_owner(user):
        return clinic
    # Must be a member.
    m = await db[MEMBERSHIPS_COLL].find_one(
        {"user_id": _uid(user), "clinic_id": clinic_id, "is_active": True}, {"_id": 1}
    )
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this clinic")
    return clinic


@router.patch("/api/clinics/{clinic_id}")
async def update_clinic(
    clinic_id: str,
    body: UpdateClinicBody,
    user=Depends(require_user),
) -> Dict[str, Any]:
    await _require_clinic_admin(user, clinic_id)
    update: Dict[str, Any] = {}
    for field in ("name", "tagline", "address", "phone", "email", "branding", "is_active"):
        val = getattr(body, field, None)
        if val is not None:
            update[field] = val
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = __import__("time").time().__int__() * 1000
    await db[CLINICS_COLL].update_one({"clinic_id": clinic_id}, {"$set": update})
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.update",
        target_id=clinic_id,
        target_type="clinic",
        meta={"fields": list(update.keys())},
    )
    return await get_clinic_by_id(clinic_id) or {}


@router.get("/api/clinics/{clinic_id}/members")
async def list_members(
    clinic_id: str, user=Depends(require_user)
) -> Dict[str, Any]:
    """List all (active) memberships for a clinic. Member-only."""
    clinic = await get_clinic_by_id(clinic_id)
    if not clinic:
        raise HTTPException(status_code=404, detail="Clinic not found")
    if not is_super_owner(user):
        m = await db[MEMBERSHIPS_COLL].find_one(
            {"user_id": _uid(user), "clinic_id": clinic_id, "is_active": True}, {"_id": 1}
        )
        if not m:
            raise HTTPException(status_code=403, detail="Not a member")

    cursor = db[MEMBERSHIPS_COLL].find(
        {"clinic_id": clinic_id, "is_active": True}, {"_id": 0}
    )
    memberships = await cursor.to_list(length=200)
    if not memberships:
        return {"members": []}

    # Hydrate user details.
    user_ids = [m["user_id"] for m in memberships]
    users_cursor = db["users"].find(
        {"user_id": {"$in": user_ids}},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1, "role": 1},
    )
    users_by_id = {u["user_id"]: u async for u in users_cursor}
    out: List[Dict[str, Any]] = []
    for m in memberships:
        u = users_by_id.get(m["user_id"])
        if not u:
            continue
        out.append({
            "membership_id": m.get("membership_id"),
            "user_id": m["user_id"],
            "email": u.get("email"),
            "name": u.get("name"),
            "picture": u.get("picture"),
            "global_role": u.get("role"),
            "clinic_role": m["role"],
            "joined_at": m.get("joined_at"),
        })
    return {"members": out}


@router.delete("/api/clinics/{clinic_id}/members/{user_id}")
async def remove_member(
    clinic_id: str,
    user_id: str,
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Remove a member from the clinic (soft-deactivate)."""
    clinic = await _require_clinic_admin(user, clinic_id)
    if user_id == clinic.get("primary_owner_id"):
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the clinic's primary owner.",
        )
    await db[MEMBERSHIPS_COLL].update_one(
        {"user_id": user_id, "clinic_id": clinic_id},
        {"$set": {"is_active": False, "removed_by": _uid(user)}},
    )
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.member.remove",
        target_id=user_id,
        target_type="user",
    )
    return {"ok": True}


@router.post("/api/clinics/{clinic_id}/members")
async def add_member(
    clinic_id: str,
    body: Dict[str, Any],
    user=Depends(require_user),
) -> Dict[str, Any]:
    """Direct add (super_owner OR primary_owner only). For Phase A —
    Phase D will add proper invite-token flow on top."""
    await _require_clinic_admin(user, clinic_id)
    target_user_id = (body.get("user_id") or "").strip()
    target_email = (body.get("email") or "").strip().lower()
    role = (body.get("role") or "doctor").strip()

    if not target_user_id and not target_email:
        raise HTTPException(status_code=400, detail="Pass user_id OR email")

    if not target_user_id:
        # Look up by email; if not found, we cannot create a stub user
        # in Phase A — return 404 so the caller can use the invite flow
        # in Phase D.
        target = await db["users"].find_one(
            {"email": target_email}, {"_id": 0, "user_id": 1, "id": 1}
        )
        if not target:
            raise HTTPException(
                status_code=404,
                detail=(
                    "User not found. Use the invite endpoint in Phase D to "
                    "send a sign-up link."
                ),
            )
        target_user_id = target.get("user_id") or target.get("id")

    membership = await upsert_membership(
        user_id=target_user_id,
        clinic_id=clinic_id,
        role=role,
        invited_by=_uid(user),
        is_active=True,
    )
    await log_action(
        actor=user,
        clinic_id=clinic_id,
        action="clinic.member.add",
        target_id=target_user_id,
        target_type="user",
        meta={"role": role},
    )
    return {"ok": True, "membership": membership}
