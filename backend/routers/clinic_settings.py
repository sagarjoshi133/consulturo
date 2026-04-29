"""ConsultUro — Clinic Settings router.

GET   /api/clinic-settings  — public read.
PATCH /api/clinic-settings  — owner-tier write with per-field partner gates.

Extracted from server.py during Phase 2 modularization.
"""
import re
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List
from fastapi import APIRouter, Depends, HTTPException

import httpx

from db import db
from auth_deps import require_owner
from models import ClinicSettingsPatch

log = logging.getLogger(__name__)
router = APIRouter()


async def _resolve_youtube_channel_id(url: str, api_key: str) -> str:
    """Best-effort: convert a YouTube channel URL into a channel_id.

    Returns "" on any failure — never raises. We deliberately don't
    block the settings save if the lookup fails (network glitch,
    quota exhausted, malformed URL): the resolver is retried lazily
    on the first /api/videos hit, so a transient failure doesn't
    leave the Primary Owner stranded.
    """
    if not url:
        return ""
    url = url.strip().rstrip("/")
    # Direct /channel/UC... — no API call needed.
    m = re.search(r"youtube\.com/channel/([A-Za-z0-9_-]{20,})", url)
    if m:
        return m.group(1)
    if not api_key:
        return ""
    # Handle / custom-name / legacy-user — needs the Search API.
    handle_m = re.search(r"youtube\.com/(?:@([^/?]+)|c/([^/?]+)|user/([^/?]+))", url)
    if not handle_m:
        # Last-ditch: maybe user pasted the bare handle ("@drsagar").
        bare = re.match(r"@?([A-Za-z0-9_.-]+)$", url)
        if not bare:
            return ""
        query = bare.group(1)
    else:
        query = next(g for g in handle_m.groups() if g)
    try:
        async with httpx.AsyncClient(timeout=8.0) as hc:
            r = await hc.get(
                "https://www.googleapis.com/youtube/v3/search",
                params={
                    "part": "snippet",
                    "type": "channel",
                    "q": query,
                    "maxResults": 1,
                    "key": api_key,
                },
            )
        if r.status_code != 200:
            log.warning("YouTube search failed: HTTP %s — %s", r.status_code, r.text[:200])
            return ""
        items = (r.json() or {}).get("items") or []
        if not items:
            return ""
        cid = items[0].get("id", {}).get("channelId") or items[0].get("snippet", {}).get("channelId")
        return str(cid or "")
    except Exception as e:
        log.warning("YouTube channel resolve error: %s", e)
        return ""


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

    # External Blog (RSS / Atom) integration — when populated, the
    # /api/blog public list merges native posts with items pulled from
    # this URL. Auto-detects RSS 2.0 / Atom feeds; common platforms
    # (WordPress, Medium, Substack, Blogger, Ghost) all expose one.
    "external_blog_feed_url": "",
    "external_blog_feed_label": "",   # optional friendly source label

    # External YouTube Channel integration — patient-facing /api/videos
    # surfaces the latest 12 uploads from this channel when populated.
    # The Primary Owner provides their own YouTube Data API v3 key so
    # consumption stays within their own quota AND so we never store a
    # platform-wide key. The key is server-side-only — never returned
    # to the patient client (only the channel_id + cached video list).
    "external_youtube_channel_url": "",
    "external_youtube_api_key": "",   # write-only; redacted in GET response
    "external_youtube_channel_id": "", # auto-resolved from URL on save

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
    document exists yet.

    SECURITY: never returns the raw `external_youtube_api_key` to the
    client — only a presence flag (`external_youtube_api_key_set`) so
    the Branding panel can show "Key configured ✓" without ever
    leaking it to the patient bundle."""
    doc = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0}) or {}
    out = {**_DEFAULT_CLINIC_SETTINGS, **doc}
    out.pop("_id", None)
    raw_key = out.pop("external_youtube_api_key", "") or ""
    out["external_youtube_api_key_set"] = bool(raw_key.strip())
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

    # External-YouTube convenience: if the user pasted a channel URL,
    # auto-resolve its channel_id so /api/videos can use the official
    # uploads-playlist endpoint without a per-request lookup. Supports
    # the four canonical YouTube URL shapes:
    #   • youtube.com/channel/UCxxxx          → direct id
    #   • youtube.com/@handle                  → resolve via API
    #   • youtube.com/c/CustomName             → resolve via API
    #   • youtube.com/user/LegacyName          → resolve via API
    if "external_youtube_channel_url" in payload:
        url = (payload.get("external_youtube_channel_url") or "").strip()
        api_key = payload.get("external_youtube_api_key")
        if not api_key:
            cur_full = await db.clinic_settings.find_one(
                {"_id": "default"}, {"external_youtube_api_key": 1}
            ) or {}
            api_key = cur_full.get("external_youtube_api_key", "")
        cid = await _resolve_youtube_channel_id(url, api_key) if url else ""
        payload["external_youtube_channel_id"] = cid

    await db.clinic_settings.update_one(
        {"_id": "default"},
        {"$set": {**payload, "_id": "default", "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "updated": len(payload)}
