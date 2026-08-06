"""ConsultUro — health router.

  · /api/health

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from db import db

router = APIRouter()


@router.get("/api/health")
async def health():
    try:
        await db.command("ping")
        return {"ok": True, "db": "connected"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
