"""ConsultUro — Blog content helpers.

  • _extract_first_img / _strip_html — quick HTML utilities.
  • _load_blog_from_blogger          — fetches the legacy Blogger
                                       feed (when the user-managed
                                       blog has no native posts).
  • _admin_to_html                   — converts the admin Markdown
                                       editor's payload to safe
                                       HTML for public rendering.
  • _apply_custom_cover              — overlays a user-set cover
                                       URL onto blog post objects.
"""
import os
import re
import json
import uuid
import logging
import html as htmllib
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx

from db import db

log = logging.getLogger(__name__)

# Blogger feed URL (legacy ConsultUro blog before native posts)
BLOGGER_FEED_URL = os.environ.get(
    "BLOGGER_FEED_URL",
    "https://consulturo.blogspot.com/feeds/posts/default?alt=json",
)

# 15-minute in-process cache for the Blogger feed — avoids hammering
# the public feed on every /api/blog list call.
_BLOG_CACHE: Dict[str, Any] = {"at": None, "data": []}


def _extract_first_img(html: str) -> Optional[str]:
    m = _IMG_RE.search(html or "")
    if not m:
        return None
    url = m.group(1).replace(r"\/", "/")
    url = re.sub(r"/s\d+(-[wh]\d+(-[ch])?)?/", "/s800/", url)
    url = re.sub(r"/w\d+-h\d+(-c)?/", "/s800/", url)
    return url

def _strip_html(html: str) -> str:
    # Remove script/style blocks first (their content is junk for excerpts)
    cleaned = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html or "", flags=re.IGNORECASE)
    # Remove HTML comments
    cleaned = re.sub(r"<!--([\s\S]*?)-->", " ", cleaned)
    txt = _TAG_RE.sub(" ", cleaned)
    txt = htmllib.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt

async def _load_blog_from_blogger() -> List[Dict[str, Any]]:
    now = datetime.now(timezone.utc)
    if _BLOG_CACHE["at"] and (now - _BLOG_CACHE["at"]).total_seconds() < 900:
        return _BLOG_CACHE["data"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            r = await hc.get(BLOGGER_FEED_URL)
            r.raise_for_status()
            feed = r.json().get("feed", {})
            posts = []
            for e in feed.get("entry", []):
                raw = e.get("content", {}).get("$t", "") or ""
                cats = [c.get("term") for c in e.get("category", []) if c.get("term")]
                alt_link = next(
                    (lk.get("href") for lk in e.get("link", []) if lk.get("rel") == "alternate"),
                    None,
                )
                post_id = (e.get("id", {}).get("$t") or "").split(".post-")[-1] or uuid.uuid4().hex
                cover = _extract_first_img(raw) or (e.get("media$thumbnail", {}) or {}).get("url") or ""
                posts.append(
                    {
                        "id": post_id,
                        "title": e.get("title", {}).get("$t", "Untitled"),
                        "category": cats[0] if cats else "Urology",
                        "categories": cats,
                        "cover": cover,
                        "excerpt": _strip_html(raw)[:240] + ("…" if len(raw) > 240 else ""),
                        "content_html": raw,
                        "published_at": (e.get("published", {}).get("$t") or "")[:10],
                        "link": alt_link,
                    }
                )
            _BLOG_CACHE["at"] = now
            _BLOG_CACHE["data"] = posts
            return posts
    except Exception:
        return _BLOG_CACHE["data"] or []

def _admin_to_html(text: str) -> str:
    """Convert the composer's plain-text body into light HTML
    (paragraphs + preserve existing tags the user may have typed)."""
    if not text:
        return ""
    if "<p>" in text or "<img" in text or "<h" in text:
        return text
    paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    return "".join(f"<p>{htmllib.escape(p).replace(chr(10), '<br/>')}</p>" for p in paras)

def _apply_custom_cover(item: Dict[str, Any]) -> Dict[str, Any]:
    if not item:
        return item
    override = _EDU_CUSTOM_COVERS.get(item.get("id", ""))
    if override:
        item = {**item, "cover": override}
    return item
