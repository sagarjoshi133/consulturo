"""ConsultUro — medicines router.

  · /api/medicines/catalog
  · /api/medicines/categories
  · /api/medicines/custom
  · /api/medicines/custom/{medicine_id}

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_owner, require_prescriber
from models import MedicineCustomBody
from server import _MEDICINE_SEED, _normalize_q

router = APIRouter()


@router.get("/api/medicines/catalog")
async def medicines_catalog(
    q: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 40,
    user=Depends(require_prescriber),
):
    """Search the combined (seed + clinic custom) medicine catalogue.

    Query:
      - q: substring match against name / generic / category (case-insensitive)
      - category: exact-match category filter (optional)
      - limit: 1..50 (default 40)

    Response: list[{name, generic, category, dosage, frequency, duration,
    timing, instructions, source("seed"|"custom")}]. Every key is always
    present (empty string when unspecified) so the client can rely on
    the shape.
    """
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 40
    qn = _normalize_q(q)

    # Pull clinic-custom medicines from Mongo so staff-added drugs show up too.
    custom_cursor = db.medicines_custom.find({}, {"_id": 0})
    custom_rows = await custom_cursor.to_list(length=500)

    DEFAULTS = {
        "name": "",
        "generic": "",
        "category": "",
        "dosage": "",
        "frequency": "",
        "duration": "",
        "timing": "",
        "instructions": "",
        "brands": [],
    }

    combined: List[Dict[str, Any]] = []
    for row in _MEDICINE_SEED:
        combined.append({**DEFAULTS, **row, "source": "seed"})
    for row in custom_rows:
        combined.append({**DEFAULTS, **row, "source": "custom"})

    def matches(m: Dict[str, Any]) -> bool:
        if category and (m.get("category") or "").lower() != category.lower():
            return False
        if not qn:
            return True
        # Search across name, generic, category AND brand names (Indian
        # practices often type the brand they remember rather than the INN).
        hay_parts = [
            str(m.get(k) or "") for k in ("name", "generic", "category")
        ]
        brands = m.get("brands") or []
        if isinstance(brands, list):
            hay_parts.extend(str(b) for b in brands)
        hay = " ".join(hay_parts).lower()
        return qn in hay

    # Rank: exact name prefix > name contains > generic contains > brand match > other.
    def rank_key(m: Dict[str, Any]) -> tuple:
        name = (m.get("name") or "").lower()
        generic = (m.get("generic") or "").lower()
        brands = [str(b).lower() for b in (m.get("brands") or []) if isinstance(b, (str,))]
        if qn and name.startswith(qn):
            return (0, name)
        if qn and qn in name:
            return (1, name)
        if qn and qn in generic:
            return (2, name)
        if qn and any(qn in b for b in brands):
            return (3, name)
        return (4, name)

    filtered = [m for m in combined if matches(m)]
    filtered.sort(key=rank_key)

    # Compute display_name = "Brandname (Generic name)" so the UI &
    # printed Rx use the user-facing format consistently. When a user
    # searches by a specific brand we surface THAT brand first; for
    # generic searches we use brands[0] as the canonical brand. Rows
    # without any brands keep the bare generic+strength name.
    out: List[Dict[str, Any]] = []
    for m in filtered[:limit]:
        brands = m.get("brands") or []
        chosen_brand = ""
        if isinstance(brands, list) and brands:
            if qn:
                # Prefer the first brand that contains the query so a
                # user typing "Urimax" sees "Urimax (Tamsulosin 0.4 mg)"
                # rather than getting "Veltam (..)" first.
                for b in brands:
                    if qn in str(b).lower():
                        chosen_brand = str(b)
                        break
            if not chosen_brand:
                chosen_brand = str(brands[0])
        display_name = (
            f"{chosen_brand} ({m.get('name') or ''})"
            if chosen_brand and m.get("name")
            else (m.get("name") or "")
        )
        out.append({**m, "display_name": display_name, "brand": chosen_brand})
    return out

@router.get("/api/medicines/categories")
async def medicines_categories(user=Depends(require_prescriber)):
    """Return distinct medicine categories across seed + custom, with counts."""
    counts: Dict[str, int] = {}
    for row in _MEDICINE_SEED:
        c = row.get("category") or "Other"
        counts[c] = counts.get(c, 0) + 1
    custom_rows = await db.medicines_custom.find({}, {"_id": 0}).to_list(length=500)
    for row in custom_rows:
        c = row.get("category") or "Other"
        counts[c] = counts.get(c, 0) + 1
    return sorted(
        [{"category": k, "count": v} for k, v in counts.items()],
        key=lambda x: (-x["count"], x["category"]),
    )

@router.post("/api/medicines/custom")
async def medicines_custom_create(
    body: MedicineCustomBody, user=Depends(require_prescriber)
):
    """Owner/doctor can add a clinic-specific medicine that isn't in the seed
    (e.g. local brand, a new trial drug). Returns the stored doc."""
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Medicine name is required")
    doc = {
        "medicine_id": f"med_{uuid.uuid4().hex[:10]}",
        "name": name[:120],
        "generic": (body.generic or "").strip()[:120],
        "category": (body.category or "Other").strip()[:60] or "Other",
        "dosage": (body.dosage or "").strip()[:60],
        "frequency": (body.frequency or "").strip()[:40],
        "duration": (body.duration or "").strip()[:40],
        "timing": (body.timing or "").strip()[:60],
        "instructions": (body.instructions or "").strip()[:300],
        "created_by": user["user_id"],
        "created_at": datetime.now(timezone.utc),
    }
    await db.medicines_custom.insert_one(dict(doc))
    doc.pop("_id", None)
    return doc

@router.delete("/api/medicines/custom/{medicine_id}")
async def medicines_custom_delete(
    medicine_id: str, user=Depends(require_owner)
):
    """Owner can remove a clinic-specific medicine. Seed items cannot be removed."""
    res = await db.medicines_custom.delete_one({"medicine_id": medicine_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Custom medicine not found")
    return {"ok": True, "deleted": medicine_id}
