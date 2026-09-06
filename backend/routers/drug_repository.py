"""ConsultUro · Drug Repository — Phase 5.29.

API endpoints for the clinic-scoped drug repository. Used by both
the OPD prescription composer (Rx auto-complete) and the IPD
medications tab.

Endpoints
─────────
GET    /api/drug-repository              — list (with q / category / form filter)
GET    /api/drug-repository/categories   — distinct categories (with counts)
POST   /api/drug-repository              — add / upsert custom drug (owner)
PATCH  /api/drug-repository/{drug_id}    — edit fields (owner)
DELETE /api/drug-repository/{drug_id}    — soft-delete (owner)
POST   /api/drug-repository/seed         — idempotent seed of the 100 Rx
                                             starter library (owner). Skips
                                             entries that already exist by drug_id.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from auth_deps import require_owner, require_staff
from db import db
from services.tenancy import resolve_clinic_id
from services.drug_repository_seed import get_seed_drugs, CATEGORIES

router = APIRouter()


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    if not d:
        return d
    d.pop("_id", None)
    return d


# ─── Pydantic models ─────────────────────────────────────────────
class DrugEntry(BaseModel):
    name: str
    category: str
    form: str = "tablet"
    default_strength: Optional[str] = None
    default_dose: Optional[str] = None
    default_frequency: Optional[str] = None
    default_route: Optional[str] = None
    default_duration: Optional[str] = None
    brands: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    is_injectable: Optional[bool] = None


# ─── Endpoints ───────────────────────────────────────────────────
_global_seed_checked = False


async def _ensure_global_seed() -> None:
    """Lazily seed the global urology drug library the first time the
    repository is read on a fresh deployment. Without this, a clinic
    whose owner never tapped the manual "seed" action saw an empty
    picker ("Pick discharge medication" showed no matches). Runs at most
    once per process and only inserts when the global library is empty.
    """
    global _global_seed_checked
    if _global_seed_checked:
        return
    try:
        cnt = await db.drug_repository.count_documents({"clinic_id": None, "deleted_at": None})
        if cnt == 0:
            seed = get_seed_drugs()
            now = datetime.now(timezone.utc)
            docs = [
                {**d, "clinic_id": None, "custom": False,
                 "created_at": now, "updated_at": now, "deleted_at": None}
                for d in seed
            ]
            if docs:
                await db.drug_repository.insert_many(docs)
        _global_seed_checked = True
    except Exception:
        # Best-effort — never block the list request on a seed failure.
        pass


@router.get("/api/drug-repository")
async def list_drugs(
    request: Request,
    q: Optional[str] = Query(None, description="Free-text — substring on name / brand"),
    category: Optional[str] = Query(None),
    form: Optional[str] = Query(None, description="tablet | capsule | syrup | injection | iv_fluid …"),
    is_injectable: Optional[bool] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user=Depends(require_staff),
):
    """Return drugs available to this clinic.

    Both the seeded global library AND any clinic-custom drugs are
    returned; clinic-custom entries are tagged with `custom: true`.
    Filters compose with AND semantics — `q` matches name OR brands.
    """
    clinic_id = await resolve_clinic_id(request, user) or "default"
    await _ensure_global_seed()
    query: Dict[str, Any] = {
        "$or": [{"clinic_id": clinic_id}, {"clinic_id": None}, {"clinic_id": {"$exists": False}}],
        "deleted_at": None,
    }
    if category:
        query["category"] = category
    if form:
        query["form"] = form
    if is_injectable is not None:
        query["is_injectable"] = is_injectable
    if q:
        rgx = {"$regex": re.escape(q), "$options": "i"}
        # Compose with the existing $or by wrapping in $and.
        query = {
            "$and": [
                query,
                {"$or": [{"name": rgx}, {"brands": rgx}]},
            ]
        }
    cursor = db.drug_repository.find(query).sort([("category", 1), ("name", 1)]).limit(limit)
    items: List[Dict[str, Any]] = []
    async for d in cursor:
        items.append(_clean(d))
    return {"items": items, "count": len(items), "categories": CATEGORIES}


@router.get("/api/drug-repository/categories")
async def list_categories(request: Request, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    pipeline = [
        {
            "$match": {
                "deleted_at": None,
                "$or": [
                    {"clinic_id": clinic_id},
                    {"clinic_id": None},
                    {"clinic_id": {"$exists": False}},
                ],
            }
        },
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    out: List[Dict[str, Any]] = []
    async for r in db.drug_repository.aggregate(pipeline):
        out.append({"category": r["_id"], "count": r["count"]})
    return {"items": out, "all_categories": CATEGORIES}


@router.post("/api/drug-repository")
async def upsert_drug(request: Request, body: DrugEntry, user=Depends(require_owner)):
    """Add a clinic-custom drug. Owner-only."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    now = datetime.now(timezone.utc)
    drug_id = re.sub(r"[^a-z0-9_]+", "_", body.name.lower())[:48] + "_custom_" + clinic_id[:6]
    inj = body.is_injectable
    if inj is None:
        inj = body.form in ("injection", "iv_fluid")
    doc = {
        "drug_id": drug_id,
        "clinic_id": clinic_id,
        "name": body.name.strip(),
        "category": body.category.strip(),
        "form": body.form.strip(),
        "is_injectable": inj,
        "default_strength": (body.default_strength or "").strip() or None,
        "default_dose": (body.default_dose or "").strip() or None,
        "default_frequency": (body.default_frequency or "").strip() or None,
        "default_route": (body.default_route or "").strip() or None,
        "default_duration": (body.default_duration or "").strip() or None,
        "brands": [b.strip() for b in (body.brands or []) if b and b.strip()],
        "notes": (body.notes or "").strip() or None,
        "custom": True,
        "created_by": user.get("user_id"),
        "created_at": now,
        "updated_at": now,
        "deleted_at": None,
    }
    await db.drug_repository.update_one(
        {"drug_id": drug_id, "clinic_id": clinic_id},
        {"$set": doc},
        upsert=True,
    )
    return _clean(doc)


@router.patch("/api/drug-repository/{drug_id}")
async def patch_drug(drug_id: str, request: Request, body: DrugEntry, user=Depends(require_owner)):
    _ = await resolve_clinic_id(request, user) or "default"
    existing = await db.drug_repository.find_one({"drug_id": drug_id})
    if not existing:
        raise HTTPException(404, "Drug not found")
    # Only allow editing clinic-custom drugs or seed drugs (creates an override).
    set_ = {
        "name": body.name.strip(),
        "category": body.category.strip(),
        "form": body.form.strip(),
        "is_injectable": body.is_injectable if body.is_injectable is not None else body.form in ("injection", "iv_fluid"),
        "default_strength": (body.default_strength or "").strip() or None,
        "default_dose": (body.default_dose or "").strip() or None,
        "default_frequency": (body.default_frequency or "").strip() or None,
        "default_route": (body.default_route or "").strip() or None,
        "default_duration": (body.default_duration or "").strip() or None,
        "brands": [b.strip() for b in (body.brands or []) if b and b.strip()],
        "notes": (body.notes or "").strip() or None,
        "updated_at": datetime.now(timezone.utc),
        "updated_by": user.get("user_id"),
    }
    await db.drug_repository.update_one({"drug_id": drug_id}, {"$set": set_})
    return _clean(await db.drug_repository.find_one({"drug_id": drug_id}))


@router.delete("/api/drug-repository/{drug_id}")
async def delete_drug(drug_id: str, request: Request, user=Depends(require_owner)):
    res = await db.drug_repository.update_one(
        {"drug_id": drug_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc), "deleted_by": user.get("user_id")}},
    )
    if not res.modified_count:
        raise HTTPException(404, "Drug not found")
    return {"ok": True}


@router.post("/api/drug-repository/seed")
async def seed_repository(user=Depends(require_owner)):
    """Idempotent seed of the urology starter library (~100 entries).

    Skips entries whose `drug_id` already exists. Seeded entries are
    stored with `clinic_id: None` so they're visible to every clinic
    on the platform — clinics can override individual entries by
    creating clinic-scoped duplicates.
    """
    seed = get_seed_drugs()
    now = datetime.now(timezone.utc)
    inserted = 0
    skipped = 0
    for d in seed:
        existing = await db.drug_repository.find_one({"drug_id": d["drug_id"], "clinic_id": None})
        if existing:
            skipped += 1
            continue
        doc = {
            **d,
            "clinic_id": None,            # global
            "custom": False,
            "created_at": now,
            "updated_at": now,
            "deleted_at": None,
        }
        await db.drug_repository.insert_one(doc)
        inserted += 1
    return {"ok": True, "inserted": inserted, "skipped": skipped, "total": inserted + skipped}



# ─── Discharge-medication templates (clinic-wide) ─────────────────
# Doctors AND staff can save a set of discharge medications as a named
# template and reuse it for similar patient cohorts. Templates are
# clinic-scoped and shared across the whole team.

class DischargeMedTemplate(BaseModel):
    name: str
    meds: str = ""


@router.get("/api/discharge-med-templates")
async def list_discharge_templates(request: Request, user=Depends(require_staff)):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    cursor = (
        db.discharge_med_templates
        .find({"clinic_id": clinic_id, "deleted_at": None})
        .sort("name", 1)
    )
    items: List[Dict[str, Any]] = []
    async for d in cursor:
        items.append(_clean(d))
    return {"items": items, "count": len(items)}


@router.post("/api/discharge-med-templates")
async def create_discharge_template(
    request: Request, body: DischargeMedTemplate, user=Depends(require_staff)
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Template name is required")
    meds = (body.meds or "").strip()
    if not meds:
        raise HTTPException(400, "Add at least one medication before saving a template")
    now = datetime.now(timezone.utc)
    by = user.get("name") or user.get("user_id")
    tid = f"dmt_{uuid.uuid4().hex[:12]}"
    # Upsert on (clinic_id, name) so re-saving a same-named template
    # overwrites rather than duplicating.
    await db.discharge_med_templates.update_one(
        {"clinic_id": clinic_id, "name": name, "deleted_at": None},
        {
            "$set": {"meds": meds, "updated_at": now, "created_by": by},
            "$setOnInsert": {
                "template_id": tid,
                "clinic_id": clinic_id,
                "name": name,
                "created_at": now,
                "deleted_at": None,
            },
        },
        upsert=True,
    )
    saved = await db.discharge_med_templates.find_one(
        {"clinic_id": clinic_id, "name": name, "deleted_at": None}
    )
    return {"ok": True, "template": _clean(saved)}


@router.delete("/api/discharge-med-templates/{template_id}")
async def delete_discharge_template(
    request: Request, template_id: str, user=Depends(require_staff)
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    res = await db.discharge_med_templates.update_one(
        {"template_id": template_id, "clinic_id": clinic_id},
        {"$set": {"deleted_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Template not found")
    return {"ok": True}
