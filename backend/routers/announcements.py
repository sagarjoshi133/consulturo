"""
Owner-curated in-app announcements / banners.

The owner can craft trilingual (en / hi / gu) banners and choose:
  • Audience  — patients, staff, or both
  • Placement — public landing, patient home, booking flow, dashboard
  • Variant   — info / success / warning / festive (controls color)
  • Schedule  — optional start_at / end_at (auto show/hide)
  • CTA       — optional label (trilingual) + URL (web link or in-app route)
  • Pinned    — display as sticky top banner vs subtle inline card
  • Active    — quick on/off toggle without deleting

Endpoints
─────────
Public (anonymous OK):
  GET /api/announcements?audience=patients&placement=public_landing[&clinic_id=…|slug=…]

Owner-only:
  GET    /api/admin/announcements
  POST   /api/admin/announcements
  PATCH  /api/admin/announcements/{id}
  DELETE /api/admin/announcements/{id}
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import require_owner
from server import db, get_current_user
from services.tenancy import resolve_clinic_id, get_clinic_by_slug, get_default_clinic_id

router = APIRouter()

VARIANTS = {"info", "success", "warning", "festive"}
AUDIENCES = {"patients", "staff", "both"}
PLACEMENTS = {"public_landing", "patient_home", "booking_flow", "dashboard"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Strip internal mongo `_id` before returning over the wire."""
    if not doc:
        return doc
    out = dict(doc)
    out.pop("_id", None)
    return out


class AnnouncementBody(BaseModel):
    title_en: str
    title_hi: Optional[str] = ""
    title_gu: Optional[str] = ""
    body_en: str = ""
    body_hi: Optional[str] = ""
    body_gu: Optional[str] = ""
    variant: str = "info"
    icon: Optional[str] = None  # ionicons name override (optional)
    audience: str = "both"      # patients | staff | both
    placements: List[str] = Field(default_factory=lambda: ["patient_home", "dashboard"])
    cta_label_en: Optional[str] = ""
    cta_label_hi: Optional[str] = ""
    cta_label_gu: Optional[str] = ""
    cta_url: Optional[str] = ""
    pinned: bool = False
    active: bool = True
    start_at: Optional[str] = None  # ISO datetime, optional
    end_at: Optional[str] = None    # ISO datetime, optional


def _validate(body: AnnouncementBody) -> None:
    if body.variant not in VARIANTS:
        raise HTTPException(status_code=400, detail=f"variant must be one of {sorted(VARIANTS)}")
    if body.audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail=f"audience must be one of {sorted(AUDIENCES)}")
    if not body.placements:
        raise HTTPException(status_code=400, detail="at least one placement is required")
    for p in body.placements:
        if p not in PLACEMENTS:
            raise HTTPException(status_code=400, detail=f"placement '{p}' is invalid (allowed: {sorted(PLACEMENTS)})")
    if not (body.title_en or "").strip():
        raise HTTPException(status_code=400, detail="title_en is required")


# ─── Owner-only management endpoints ────────────────────────────────

@router.get("/api/admin/announcements")
async def list_admin(request: Request, user=Depends(require_owner)):
    """Owner-facing list — returns ALL announcements for this clinic
    (active + inactive, all schedules) so the owner can manage them.
    """
    clinic_id = await resolve_clinic_id(request, user) or "default"
    cur = db.announcements.find({"clinic_id": clinic_id}).sort("created_at", -1)
    items: List[Dict[str, Any]] = []
    async for d in cur:
        items.append(_clean(d))
    return {"items": items, "count": len(items)}


@router.post("/api/admin/announcements")
async def create(
    request: Request,
    body: AnnouncementBody,
    user=Depends(require_owner),
):
    _validate(body)
    clinic_id = await resolve_clinic_id(request, user) or "default"
    doc = body.dict()
    doc.update({
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "created_by": user.get("name") or user.get("user_id"),
        "created_at": _now(),
        "updated_at": _now(),
    })
    await db.announcements.insert_one(doc)
    return {"ok": True, "announcement": _clean(doc)}


@router.patch("/api/admin/announcements/{ann_id}")
async def update(
    ann_id: str,
    request: Request,
    body: Dict[str, Any],
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    existing = await db.announcements.find_one({"id": ann_id, "clinic_id": clinic_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Announcement not found")
    # Merge old + new, validate, then persist only the allowed fields.
    merged_payload: Dict[str, Any] = {}
    allowed = set(AnnouncementBody.__fields__.keys())
    for k in allowed:
        if body and k in body:
            merged_payload[k] = body[k]
        elif k in existing:
            merged_payload[k] = existing[k]
    try:
        validated = AnnouncementBody(**merged_payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    _validate(validated)
    update_doc: Dict[str, Any] = {k: body[k] for k in (body or {}) if k in allowed}
    update_doc["updated_at"] = _now()
    await db.announcements.update_one(
        {"id": ann_id, "clinic_id": clinic_id}, {"$set": update_doc}
    )
    refreshed = await db.announcements.find_one({"id": ann_id, "clinic_id": clinic_id})
    return {"ok": True, "announcement": _clean(refreshed or {})}


@router.delete("/api/admin/announcements/{ann_id}")
async def delete(
    ann_id: str,
    request: Request,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    r = await db.announcements.delete_one({"id": ann_id, "clinic_id": clinic_id})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"ok": True}


# ─── Public read endpoint ───────────────────────────────────────────

@router.get("/api/announcements")
async def list_public(
    request: Request,
    audience: Optional[str] = None,
    placement: Optional[str] = None,
    clinic_id: Optional[str] = None,
    slug: Optional[str] = None,
    user: Optional[Dict[str, Any]] = Depends(get_current_user),
):
    """Public banner feed. NO hard auth — anonymous clinic-landing
    visitors can also see banners. Clinic resolution falls back across
    several sources so the call works from every placement:

      1. Explicit `clinic_id` query parameter
      2. `slug` lookup (for the public `/c/<slug>` page)
      3. `X-Clinic-Id` request header (set by the API axios client
         once an active tenant is selected post-login)
      4. The authenticated user's default clinic membership
      5. "default" fallback (single-clinic deployments)
    """
    cid: Optional[str] = (clinic_id or "").strip() or None
    if not cid and slug:
        clinic = await get_clinic_by_slug(slug)
        if clinic:
            cid = clinic.get("clinic_id") or clinic.get("id")
    if not cid:
        cid = request.headers.get("X-Clinic-Id") or None
    if not cid and user:
        # Fall back to the user's default clinic if they're signed in
        # — this fixes the race where the frontend hasn't injected the
        # X-Clinic-Id header yet on the first request.
        try:
            cid = await get_default_clinic_id(user)
        except Exception:
            cid = None
    cid = cid or "default"

    q: Dict[str, Any] = {"clinic_id": cid, "active": True}
    if placement:
        if placement not in PLACEMENTS:
            raise HTTPException(status_code=400, detail=f"placement must be one of {sorted(PLACEMENTS)}")
        q["placements"] = placement
    if audience and audience in ("patients", "staff"):
        # Audience can be the exact audience OR "both".
        q["audience"] = {"$in": [audience, "both"]}

    now = _now()
    items: List[Dict[str, Any]] = []
    async for d in db.announcements.find(q):
        s = (d.get("start_at") or "").strip()
        e = (d.get("end_at") or "").strip()
        if s and s > now:
            continue  # not started yet
        if e and e < now:
            continue  # already expired
        items.append(_clean(d))
    # Sort: pinned banners first, then newest first.
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    items.sort(key=lambda x: not bool(x.get("pinned")))
    return {"items": items, "count": len(items)}
