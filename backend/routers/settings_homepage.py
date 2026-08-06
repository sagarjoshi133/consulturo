"""ConsultUro — settings_homepage router.

  · /api/settings/homepage

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict
from fastapi import APIRouter, Depends
from db import db
from auth_deps import require_owner
from models import HomepageSettingsBody
from server import DEFAULT_CLINIC_ADDRESS, DEFAULT_CLINIC_EMAIL, DEFAULT_CLINIC_HOURS, DEFAULT_CLINIC_MAP_URL, DEFAULT_CLINIC_NAME, DEFAULT_CLINIC_PHONE, DEFAULT_CLINIC_WHATSAPP, DEFAULT_COVER_PHOTO, DEFAULT_DEGREES, DEFAULT_DOCTOR_NAME, DEFAULT_DOCTOR_PHOTO, DEFAULT_EMERGENCY_NOTE, DEFAULT_REG_NO, DEFAULT_TAGLINE, get_homepage_settings

router = APIRouter()


@router.get("/api/settings/homepage")
async def settings_homepage_public():
    """Public — patients & guests see this to render the home hero."""
    return await get_homepage_settings()

@router.patch("/api/settings/homepage")
async def settings_homepage_update(body: HomepageSettingsBody, user=Depends(require_owner)):
    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc), "updated_by": user["user_id"]}
    defaults_map = {
        "doctor_photo_url": DEFAULT_DOCTOR_PHOTO,
        "cover_photo_url": DEFAULT_COVER_PHOTO,
        "doctor_name": DEFAULT_DOCTOR_NAME,
        "tagline": DEFAULT_TAGLINE,
        "clinic_name": DEFAULT_CLINIC_NAME,
        "clinic_address": DEFAULT_CLINIC_ADDRESS,
        "clinic_phone": DEFAULT_CLINIC_PHONE,
        "doctor_degrees": DEFAULT_DEGREES,
        "doctor_reg_no": DEFAULT_REG_NO,
        "signature_url": "",
        "clinic_whatsapp": DEFAULT_CLINIC_WHATSAPP,
        "clinic_email": DEFAULT_CLINIC_EMAIL,
        "clinic_map_url": DEFAULT_CLINIC_MAP_URL,
        "clinic_hours": DEFAULT_CLINIC_HOURS,
        "emergency_note": DEFAULT_EMERGENCY_NOTE,
    }
    for key, default_val in defaults_map.items():
        val = getattr(body, key, None)
        if val is not None:
            if key == "signature_url":
                # signature can be explicitly cleared with empty string
                updates[key] = val.strip()
            else:
                updates[key] = val.strip() or default_val
    await db.app_settings.update_one({"key": "homepage"}, {"$set": updates}, upsert=True)
    return await get_homepage_settings()
