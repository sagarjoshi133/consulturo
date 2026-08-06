"""ConsultUro — Patient Dietary Guides router (Phase 5.6).

Trilingual (EN/HI/GU) condition-based diet guides. No auth required
for reads — patient-app needs them on the home screen and from
prescription / education deep-links.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query

from data.diets import DIETS, get_diet

router = APIRouter()


def _summary(d: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": d["key"],
        "aliases": d.get("aliases") or [],
        "name": d.get("name", {}),
        "summary": d.get("summary", {}),
    }


@router.get("/api/diets")
async def list_diets(lang: Optional[str] = Query(None)):
    """Return the list of available diet guides (summary only)."""
    return {"items": [_summary(d) for d in DIETS], "count": len(DIETS)}


@router.get("/api/diets/{key}")
async def fetch_diet(key: str):
    """Return the full diet guide for a given condition key (or alias)."""
    d = get_diet(key)
    if not d:
        raise HTTPException(status_code=404, detail=f"Diet guide not found for '{key}'")
    return d
