"""ConsultUro — Clinic Settings router.

GET   /api/clinic-settings  — public read.
PATCH /api/clinic-settings  — owner-tier write with per-field partner gates.

Extracted from server.py during Phase 2 modularization.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_deps import require_owner
from models import ClinicSettingsPatch

router = APIRouter()


_DEFAULT_CLINIC_SETTINGS: Dict[str, Any] = {
    "_id": "default",
    "doctor_name": "Dr. Sagar Joshi",
    "doctor_title": "Consultant Urologist & Laparoscopic Surgeon",
    "doctor_tagline": "Restoring health, dignity, and confidence — one patient at a time.",
    "doctor_short_bio": "DrNB Urology · MS General Surgery · MBBS · 10+ years of clinical practice.",
    "clinic_name": "ConsultUro · Dr. Sagar Joshi's Urology Practice",
    "clinic_website": "https://www.drsagarjoshi.com",
    "main_photo_url": "",
    "cover_photo_url": "",
    "letterhead_image_b64": "",
    "use_letterhead": False,
    "patient_education_html": "",
    "need_help_html": "",
    "social_facebook": "",
    "social_instagram": "",
    "social_twitter": "",
    "social_linkedin": "",
    "social_youtube": "",
    "social_whatsapp": "",
    "external_blog_links": [],
    "partner_can_edit_branding": True,
    "partner_can_edit_about_doctor": True,
    "partner_can_edit_blog": True,
    "partner_can_edit_videos": True,
    "partner_can_edit_education": True,
    "partner_can_manage_broadcasts": True,
    # Granular sub-toggles default to True (matches legacy "branding"
    # umbrella) — primary_owner switches them off on a per-section basis.
    "partner_can_edit_main_photo": True,
    "partner_can_edit_cover_photo": True,
    "partner_can_edit_clinic_info": True,
    "partner_can_edit_socials": True,
}


@router.get("/api/clinic-settings")
async def get_clinic_settings():
    """Public read — patients also use this to render About Doctor and
    branding without auth. Falls back to hard-coded defaults if no
    document exists yet."""
    doc = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
    out = {**_DEFAULT_CLINIC_SETTINGS, **doc}
    out.pop("_id", None)
    return out


@router.patch("/api/clinic-settings")
async def patch_clinic_settings(
    body: ClinicSettingsPatch,
    user=Depends(require_owner),
):
    """Owner-tier write. Partners are gated per-field via the
    partner_can_edit_* toggles below — partners receive 403 if they
    try to modify a field whose toggle is off."""
    # Cap free-text payloads to ~2 MB each (data: URIs of photos
    # included). Anything bigger is almost certainly a UI bug.
    payload = body.model_dump(exclude_unset=True)
    for k in ("main_photo_url", "cover_photo_url", "letterhead_image_b64"):
        v = payload.get(k)
        if isinstance(v, str) and len(v) > 6_000_000:  # ~6 MB safety cap
            raise HTTPException(status_code=413, detail=f"{k} too large")
    # Soft cap on the editable Rx text blocks — keeps the PDF clean and
    # prevents abuse via runaway HTML payloads.
    for k in ("patient_education_html", "need_help_html"):
        v = payload.get(k)
        if isinstance(v, str) and len(v) > 8000:
            raise HTTPException(status_code=413, detail=f"{k} too long (max 8000 chars)")
    # Partner-permission gating: a partner can only modify fields the
    # primary_owner has unlocked for them. Primary/super always pass.
    if user.get("role") == "partner":
        cur = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
        merged = {**_DEFAULT_CLINIC_SETTINGS, **cur}
        # Helper: granular flag if explicitly set, else fall back to the
        # legacy umbrella `partner_can_edit_branding` so existing data
        # behaves identically until a primary_owner saves new toggles.
        def gate(fine_key: str) -> bool:
            v = merged.get(fine_key)
            if v is None:
                return bool(merged.get("partner_can_edit_branding"))
            return bool(v)
        gates: Dict[str, List[str]] = {
            "partner_can_edit_main_photo":   ["main_photo_url"],
            "partner_can_edit_cover_photo":  ["cover_photo_url"],
            "partner_can_edit_clinic_info":  ["clinic_name", "clinic_website"],
            "partner_can_edit_socials":      ["social_facebook", "social_instagram",
                                               "social_twitter", "social_linkedin",
                                               "social_youtube", "social_whatsapp"],
            "partner_can_edit_about_doctor": ["doctor_name", "doctor_title",
                                               "doctor_tagline", "doctor_short_bio"],
            "partner_can_edit_blog":         ["external_blog_links"],
        }
        for gate_key, fields in gates.items():
            if any(k in payload for k in fields):
                if not gate(gate_key):
                    raise HTTPException(
                        status_code=403,
                        detail=f"Partners are not permitted to edit this section ({gate_key}). Ask the Primary Owner to enable it.",
                    )
        # Partners can NEVER toggle their own permissions.
        for k in list(payload.keys()):
            if k.startswith("partner_can_"):
                payload.pop(k, None)
    if not payload:
        return {"ok": True, "updated": 0}
    await db.clinic_settings.update_one(
        {"_id": "default"},
        {"$set": {**payload, "_id": "default", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "updated": len(payload)}
