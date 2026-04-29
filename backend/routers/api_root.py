"""ConsultUro — api_root router.

  · /api/

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/api/")
async def root():
    return {"service": "ConsultUro API", "status": "ok"}
