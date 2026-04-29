"""ConsultUro — blog router.

  · /api/blog               — public list (in-app + Blogger + external RSS)
  · /api/blog/{post_id}     — public detail
  · /api/admin/blog         — owner-only CRUD
  · /api/admin/blog/{post_id}
  · /api/admin/blog/{post_id}/review

Extracted from server.py during Phase 3 modularization.
"""
import re
import uuid
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from db import db
from auth_deps import is_super_owner, require_blog_writer, require_owner
from models import BlogPostBody, BlogReviewBody
from server import _admin_to_html, _load_blog_from_blogger, _strip_html, _extract_first_img

log = logging.getLogger(__name__)
router = APIRouter()


# 15-minute in-process cache for the per-clinic external RSS/Atom
# feed — avoids hammering external blogs on every public list call.
_EXT_FEED_CACHE: Dict[str, Dict[str, Any]] = {}


async def _load_external_blog_feed(feed_url: str, label: str = "") -> List[Dict[str, Any]]:
    """Fetch an arbitrary RSS 2.0 / Atom feed URL and convert items
    into the same shape the public /api/blog endpoint returns.

    Auto-detects the feed type by looking at the root element.
    Returns an empty list on any failure — never raises (the public
    list endpoint must keep working even if a Primary Owner pasted
    a broken URL).
    """
    if not feed_url:
        return []
    cached = _EXT_FEED_CACHE.get(feed_url)
    now = datetime.now(timezone.utc)
    if cached and (now - cached["at"]).total_seconds() < 900:
        return cached["data"]
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as hc:
            r = await hc.get(feed_url, headers={"User-Agent": "ConsultUro/1.0"})
        if r.status_code != 200:
            return []
        try:
            root = ET.fromstring(r.text)
        except ET.ParseError:
            return []
        items: List[Dict[str, Any]] = []
        # Atom feeds use <feed><entry>; RSS 2.0 uses <rss><channel><item>.
        ATOM_NS = "{http://www.w3.org/2005/Atom}"
        if root.tag.endswith("feed"):
            entries = root.findall(f"{ATOM_NS}entry")
            for e in entries[:25]:
                title = (e.findtext(f"{ATOM_NS}title") or "").strip()
                content = (
                    e.findtext(f"{ATOM_NS}content")
                    or e.findtext(f"{ATOM_NS}summary")
                    or ""
                )
                published = e.findtext(f"{ATOM_NS}published") or e.findtext(f"{ATOM_NS}updated") or ""
                link_el = e.find(f"{ATOM_NS}link")
                link = (link_el.get("href") if link_el is not None else "") or ""
                items.append({"title": title, "content": content, "published": published, "link": link})
        else:
            entries = root.findall(".//item")
            for e in entries[:25]:
                title = (e.findtext("title") or "").strip()
                # WordPress / Medium use content:encoded for full HTML.
                content = (
                    e.findtext("{http://purl.org/rss/1.0/modules/content/}encoded")
                    or e.findtext("description")
                    or ""
                )
                published = e.findtext("pubDate") or ""
                link = e.findtext("link") or ""
                items.append({"title": title, "content": content, "published": published, "link": link})

        # Normalise to the public /api/blog post shape
        out: List[Dict[str, Any]] = []
        for it in items:
            content_html = it["content"]
            cover = _extract_first_img(content_html) or ""
            stripped = _strip_html(content_html)
            excerpt = (stripped[:240] + "…") if len(stripped) > 240 else stripped
            try:
                # RFC 2822 (RSS) or ISO 8601 (Atom) — try both.
                from email.utils import parsedate_to_datetime
                if it["published"]:
                    try:
                        dt = parsedate_to_datetime(it["published"])
                    except Exception:
                        dt = datetime.fromisoformat(it["published"].replace("Z", "+00:00"))
                else:
                    dt = now
                published_str = dt.strftime("%Y-%m-%d")
            except Exception:
                published_str = now.strftime("%Y-%m-%d")
            slug = re.sub(r"[^a-z0-9]+", "-", it["title"].lower())[:60].strip("-")
            out.append({
                "id": f"ext-{slug}-{abs(hash(it['link'] or it['title'])) % 1000000}",
                "title": it["title"],
                "category": label or "Latest",
                "cover": cover,
                "excerpt": excerpt,
                "content_html": content_html,
                "published_at": published_str,
                "link": it["link"],
                "source": "external",
            })
        _EXT_FEED_CACHE[feed_url] = {"at": now, "data": out}
        return out
    except Exception as e:
        log.warning("External blog feed fetch failed for %s — %s", feed_url, e)
        return []



@router.get("/api/blog")
async def list_blog():
    """Merges 3 sources, in priority order:
      1. Owner-composed posts (db.blog_posts)
      2. The clinic's configured external RSS/Atom feed (any platform)
      3. The legacy /consulturo Blogger feed (kept for backwards compat)
    """
    admin_cursor = db.blog_posts.find({"published": True}, {"_id": 0}).sort("created_at", -1)
    admin_posts_raw = await admin_cursor.to_list(length=100)
    admin_posts = [
        {
            "id": p["post_id"],
            "title": p["title"],
            "category": p.get("category") or "Urology",
            "cover": p.get("cover") or "",
            "excerpt": p.get("excerpt") or (p.get("content", "")[:240] + ("…" if len(p.get("content", "")) > 240 else "")),
            "content_html": _admin_to_html(p.get("content", "")),
            "published_at": (p.get("created_at") or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
            "link": None,
            "source": "in-app",
        }
        for p in admin_posts_raw
    ]
    # External RSS / Atom — pulled from clinic_settings.external_blog_feed_url.
    cs = await db.clinic_settings.find_one(
        {"_id": "default"},
        {"external_blog_feed_url": 1, "external_blog_feed_label": 1},
    ) or {}
    external_posts = await _load_external_blog_feed(
        cs.get("external_blog_feed_url") or "",
        cs.get("external_blog_feed_label") or "",
    )
    # Legacy Blogger feed (kept on as a default if no external_blog_feed_url is set).
    blogger_posts: List[Dict[str, Any]] = []
    if not cs.get("external_blog_feed_url"):
        blogger_posts = await _load_blog_from_blogger()
        for bp in blogger_posts:
            bp["source"] = "website"
    return admin_posts + external_posts + blogger_posts

@router.get("/api/blog/{post_id}")
async def get_blog(post_id: str):
    admin = await db.blog_posts.find_one({"post_id": post_id}, {"_id": 0})
    if admin:
        return {
            "id": admin["post_id"],
            "title": admin["title"],
            "category": admin.get("category") or "Urology",
            "cover": admin.get("cover") or "",
            "excerpt": admin.get("excerpt") or "",
            "content_html": _admin_to_html(admin.get("content", "")),
            "published_at": (admin.get("created_at") or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
            "link": None,
            "source": "in-app",
        }
    posts = await _load_blog_from_blogger()
    for p in posts:
        if p["id"] == post_id:
            return p
    raise HTTPException(status_code=404, detail="Post not found")

@router.post("/api/admin/blog")
async def admin_create_post(body: BlogPostBody, user=Depends(require_blog_writer)):
    """Super-owner (and any primary_owner explicitly granted
    `can_create_blog`) can create blog posts. Posts auto-publish
    immediately — review workflow no longer required since only
    editors can author. Other roles get a 403 from the gate."""
    post_id = f"ap_{uuid.uuid4().hex[:10]}"
    status = body.status or "published"
    doc = {
        "post_id": post_id,
        "title": body.title,
        "category": body.category or "Urology",
        "excerpt": body.excerpt or (body.content[:240] + ("…" if len(body.content) > 240 else "")),
        "content": body.content,
        "cover": body.cover or "",
        "status": status,
        "published": status == "published",
        "author_user_id": user["user_id"],
        "author_email": user.get("email"),
        "author_name": user.get("name"),
        "author_role": user.get("role"),
        "review_note": "",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.blog_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.put("/api/admin/blog/{post_id}")
async def admin_update_post(post_id: str, body: BlogPostBody, user=Depends(require_blog_writer)):
    existing = await db.blog_posts.find_one({"post_id": post_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    # Super-owner can edit any post; primary_owner editors can edit
    # their own. Stays simple now that authoring is editor-only.
    is_super = is_super_owner(user)
    if not is_super and existing.get("author_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only edit your own posts")
    new_status = body.status or existing.get("status") or "published"
    updates = {
        "title": body.title,
        "category": body.category or "Urology",
        "excerpt": body.excerpt or (body.content[:240] + ("…" if len(body.content) > 240 else "")),
        "content": body.content,
        "cover": body.cover or "",
        "status": new_status,
        "published": new_status == "published",
        "updated_at": datetime.now(timezone.utc),
    }
    await db.blog_posts.update_one({"post_id": post_id}, {"$set": updates})
    return {"ok": True}

@router.post("/api/admin/blog/{post_id}/review")
async def admin_review_post(post_id: str, body: BlogReviewBody, user=Depends(require_owner)):
    """Owner-only: change a post's review status (publish/reject/send back to draft)."""
    new_status = body.status
    if new_status not in {"draft", "pending_review", "published", "rejected"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.blog_posts.update_one(
        {"post_id": post_id},
        {
            "$set": {
                "status": new_status,
                "published": new_status == "published",
                "review_note": body.review_note or "",
                "reviewed_by": user["user_id"],
                "reviewed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "status": new_status}

@router.delete("/api/admin/blog/{post_id}")
async def admin_delete_post(post_id: str, user=Depends(require_blog_writer)):
    existing = await db.blog_posts.find_one({"post_id": post_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    is_super = is_super_owner(user)
    if not is_super and existing.get("author_user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    await db.blog_posts.delete_one({"post_id": post_id})
    return {"ok": True}

@router.get("/api/admin/blog")
async def admin_list_posts(
    status: Optional[str] = None,
    user=Depends(require_blog_writer),
):
    q: Dict[str, Any] = {}
    is_super = is_super_owner(user)
    if not is_super:
        q["author_user_id"] = user["user_id"]
    if status:
        q["status"] = status
    cursor = db.blog_posts.find(q, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)
