"""ConsultUro — consent router.

  · /api/consent

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import require_user
from models import ConsentBody

router = APIRouter()


@router.get("/api/consent")
async def consent_get(user=Depends(require_user)):
    doc = await db.user_consents.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return doc or {
        "user_id": user["user_id"],
        "data_consent": False,
        "policy_consent": False,
        "marketing_consent": False,
        "consented_at": None,
    }

@router.post("/api/consent")
async def consent_set(body: ConsentBody, user=Depends(require_user)):
    # Both mandatory consents must be true for acceptance to be valid
    if not (body.data_consent and body.policy_consent):
        raise HTTPException(400, "You must accept data storage and privacy/terms to continue")
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "data_consent": True,
        "policy_consent": True,
        "marketing_consent": bool(body.marketing_consent),
        "consented_at": now,
        "updated_at": now,
        "version": "1.0",
    }
    await db.user_consents.update_one(
        {"user_id": user["user_id"]}, {"$set": doc}, upsert=True
    )
    return {"ok": True, **doc}
