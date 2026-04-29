"""ConsultUro — education router.

  · /api/education
  · /api/education/{eid}
  · /api/videos

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
import os
from fastapi import APIRouter, HTTPException
from server import VIDEOS_SEED, _apply_custom_cover, _edu_get_localized, _edu_list_localized, httpx

router = APIRouter()


@router.get("/api/videos")
async def list_videos():
    api_key = os.environ.get("YOUTUBE_API_KEY")
    channel_id = os.environ.get("YOUTUBE_CHANNEL_ID")
    cache = getattr(list_videos, "_cache", None)
    now = datetime.now(timezone.utc)
    if cache and (now - cache["at"]).total_seconds() < 600:
        return cache["data"]
    if api_key and channel_id:
        try:
            async with httpx.AsyncClient(timeout=10.0) as hc:
                ch = await hc.get(
                    "https://www.googleapis.com/youtube/v3/channels",
                    params={"part": "contentDetails", "id": channel_id, "key": api_key},
                )
                ch.raise_for_status()
                uploads = ch.json()["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
                pl = await hc.get(
                    "https://www.googleapis.com/youtube/v3/playlistItems",
                    params={"part": "snippet,contentDetails", "playlistId": uploads, "maxResults": 25, "key": api_key},
                )
                pl.raise_for_status()
                items = []
                for it in pl.json().get("items", []):
                    sn = it["snippet"]
                    vid = it["contentDetails"]["videoId"]
                    thumbs = sn.get("thumbnails", {})
                    thumb = (thumbs.get("maxres") or thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                    items.append({
                        "id": vid, "title": sn["title"], "youtube_id": vid, "thumbnail": thumb,
                        "duration": "", "category": sn.get("channelTitle", "YouTube"),
                        "published_at": sn.get("publishedAt", ""),
                    })
                if items:
                    list_videos._cache = {"at": now, "data": items}
                    return items
        except Exception:
            pass
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
