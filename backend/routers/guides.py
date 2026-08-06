"""ConsultUro — Patient Surgery Guides router (Phase 5.3).

Public-facing patient education for the 10 most common urology
procedures. Trilingual (EN/HI/GU). No auth required for reads —
patient-app needs them on the home screen and from booking
confirmation deep-links.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from data.guides import GUIDES as _CORE_GUIDES, get_guide as _core_get
from data.guides_extended import GUIDES_EXTENDED as _EXT_GUIDES
from data.guides_extended_p2 import GUIDES_EXTENDED_P2 as _EXT_GUIDES_P2

GUIDES = _CORE_GUIDES + _EXT_GUIDES + _EXT_GUIDES_P2


def get_guide(key: str):
    """Return the guide for `key` or any of its aliases. None if not found."""
    g = _core_get(key)
    if g:
        return g
    k = (key or "").strip().lower()
    for guide in (_EXT_GUIDES + _EXT_GUIDES_P2):
        if guide["key"] == k or k in (guide.get("aliases") or []):
            return guide
    return None

router = APIRouter()


def _summary(g: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "key": g["key"],
        "aliases": g.get("aliases") or [],
        "name": g.get("name", {}),
        "duration_minutes": g.get("duration_minutes"),
        "hospital_stay_days": g.get("hospital_stay_days"),
    }


@router.get("/api/guides")
async def list_guides(lang: Optional[str] = Query(None)):
    """Return the list of available surgery guides (summary only)."""
    return {"items": [_summary(g) for g in GUIDES], "count": len(GUIDES)}


@router.get("/api/guides/{key}")
async def fetch_guide(key: str):
    """Return the full guide for a given surgery key (or alias)."""
    g = get_guide(key)
    if not g:
        raise HTTPException(status_code=404, detail=f"Guide not found for '{key}'")
    return g
