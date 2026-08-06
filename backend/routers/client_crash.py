"""
Client crash report sink.

The Expo / React Native app posts here from its global ErrorBoundary
when a JS error bubbles past a screen-level boundary. We store the
reports in `client_crash_log` for the owner to review via
`GET /api/admin/client-crashes` (capped at 200, newest first).

The endpoint accepts unauthenticated POSTs intentionally — a crash
typically happens before auth is ready / when AsyncStorage has been
cleared / when network has flapped, and we'd rather log a context-
poor crash than swallow it because the user wasn't logged in.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from auth_deps import require_owner
from server import db, get_current_user

router = APIRouter()


class CrashBody(BaseModel):
    message: str
    stack: Optional[str] = None
    component_stack: Optional[str] = None
    platform: Optional[str] = None
    app_version: Optional[str] = None
    build_number: Optional[str] = None
    route: Optional[str] = None
    fatal: Optional[bool] = True
    extra: Optional[Dict[str, Any]] = None


@router.post("/api/client-crash", status_code=200)
async def client_crash(
    body: CrashBody,
    request: Request,
    user=Depends(get_current_user),
):
    doc = {
        "id": str(uuid.uuid4()),
        "message": (body.message or "")[:2000],
        "stack": (body.stack or "")[:8000],
        "component_stack": (body.component_stack or "")[:6000],
        "platform": (body.platform or "").lower() or None,
        "app_version": body.app_version,
        "build_number": body.build_number,
        "route": (body.route or "")[:200],
        "fatal": bool(body.fatal if body.fatal is not None else True),
        "user_id": (user or {}).get("user_id") if user else None,
        "user_role": (user or {}).get("role") if user else None,
        "user_agent": request.headers.get("User-Agent", "")[:240],
        "ip": (request.client.host if request.client else None),
        "extra": body.extra or {},
        "created_at": datetime.now(timezone.utc),
    }
    try:
        await db.client_crash_log.insert_one(doc)
    except Exception:
        # Logging must NEVER raise — we'd rather lose the report than
        # have the client crash twice.
        pass
    return {"ok": True}


@router.get("/api/admin/client-crashes")
async def list_admin(user=Depends(require_owner), limit: int = 100):
    cur = db.client_crash_log.find({}).sort("created_at", -1).limit(max(1, min(limit, 500)))
    items = []
    async for d in cur:
        d.pop("_id", None)
        items.append(d)
    return {"items": items}
