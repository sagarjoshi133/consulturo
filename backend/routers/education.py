"""ConsultUro — education router.

  · /api/education            — trilingual urology education library
  · /api/education/{eid}      — one article
  · /api/videos               — clinic-configured YouTube channel videos

Extracted from server.py during Phase 3 modularization.
"""
from datetime import datetime, timezone
import os
from fastapi import APIRouter, HTTPException

from db import db
from server import VIDEOS_SEED, _apply_custom_cover, _edu_get_localized, _edu_list_localized, httpx

router = APIRouter()


async def _fetch_youtube_channel_videos(api_key: str, channel_id: str) -> list:
    """Fetch the latest 25 uploads from a YouTube channel. Returns
    [] on any failure — caller falls back to VIDEOS_SEED."""
    if not api_key or not channel_id:
        return []
    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            ch = await hc.get(
                "https://www.googleapis.com/youtube/v3/channels",
                params={"part": "contentDetails", "id": channel_id, "key": api_key},
            )
            ch.raise_for_status()
            ch_items = ch.json().get("items") or []
            if not ch_items:
                return []
            uploads = ch_items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
            pl = await hc.get(
                "https://www.googleapis.com/youtube/v3/playlistItems",
                params={"part": "snippet,contentDetails", "playlistId": uploads,
                        "maxResults": 12, "key": api_key},
            )
            pl.raise_for_status()
            items = []
            for it in pl.json().get("items", []):
                sn = it["snippet"]
                vid = it["contentDetails"]["videoId"]
                thumbs = sn.get("thumbnails", {})
                thumb = (
                    thumbs.get("maxres") or thumbs.get("high")
                    or thumbs.get("medium") or thumbs.get("default") or {}
                ).get("url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                items.append({
                    "id": vid, "title": sn["title"], "youtube_id": vid,
                    "thumbnail": thumb, "duration": "",
                    "category": sn.get("channelTitle", "YouTube"),
                    "published_at": sn.get("publishedAt", ""),
                })
            return items
    except Exception:
        return []


@router.get("/api/videos")
async def list_videos():
    """Sourcing priority:
       1. clinic_settings.external_youtube_* (Primary-Owner-configured)
       2. server-level YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID env vars
          (legacy fallback for the platform's default channel)
       3. VIDEOS_SEED hard-coded list
    Cached for 10 minutes to stay well under the YouTube quota.
    """
    cache = getattr(list_videos, "_cache", None)
    now = datetime.now(timezone.utc)
    if cache and (now - cache["at"]).total_seconds() < 600:
        return cache["data"]

    # Source 1: clinic_settings — Primary-Owner-configured per clinic.
    cs = await db.clinic_settings.find_one(
        {"_id": "default"},
        {
            "external_youtube_api_key": 1,
            "external_youtube_channel_id": 1,
            "external_youtube_channel_url": 1,
        },
    ) or {}
    cs_key = cs.get("external_youtube_api_key") or ""
    cs_cid = cs.get("external_youtube_channel_id") or ""
    if cs_key and cs_cid:
        items = await _fetch_youtube_channel_videos(cs_key, cs_cid)
        if items:
            list_videos._cache = {"at": now, "data": items}
            return items
        # If the configured channel returns nothing (quota / wrong key),
        # quietly fall through to the env-level default rather than
        # showing the patient a blank Videos screen.

    # Source 2: env-level fallback (legacy ConsultUro default).
    api_key = os.environ.get("YOUTUBE_API_KEY")
    channel_id = os.environ.get("YOUTUBE_CHANNEL_ID")
    if api_key and channel_id:
        items = await _fetch_youtube_channel_videos(api_key, channel_id)
        if items:
            list_videos._cache = {"at": now, "data": items}
            return items

    # Source 3: hard-coded fallback.
    return VIDEOS_SEED

@router.get("/api/education")
async def list_education(lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    return [_apply_custom_cover(i) for i in _edu_list_localized(lang)]

@router.get("/api/education/{eid}")
async def get_education(eid: str, lang: str = "en"):
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    item = _edu_get_localized(eid, lang)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return _apply_custom_cover(item)
