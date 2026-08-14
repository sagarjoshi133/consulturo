"""ConsultUro 2.0 — Phase C: capabilities router.

  · GET /api/me/capabilities      — caller's full capability map (UI gating)
  · GET /api/capabilities/catalog — owner: catalog of all capabilities
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from auth_deps import require_owner, require_user
from services.capabilities import CAPABILITIES, resolve_capabilities

router = APIRouter()


@router.get("/api/me/capabilities")
async def my_capabilities(user=Depends(require_user)):
    return {
        "role": user.get("role"),
        "capabilities": resolve_capabilities(user),
    }


@router.get("/api/capabilities/catalog")
async def capabilities_catalog(user=Depends(require_owner)):
    return {
        "items": [
            {
                "key": key,
                "label": spec.get("label"),
                "flag": spec.get("flag"),
                "policy": spec.get("policy") or "owner_implicit",
            }
            for key, spec in CAPABILITIES.items()
        ]
    }
