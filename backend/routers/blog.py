"""ConsultUro — blog router.

  · /api/blog
  · /api/blog/{post_id}
  · /api/admin/blog
  · /api/admin/blog/{post_id}
  · /api/admin/blog/{post_id}/review

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from db import db
from auth_deps import is_super_owner, require_blog_writer, require_owner
from models import BlogPostBody, BlogReviewBody
from server import _admin_to_html, _load_blog_from_blogger

router = APIRouter()


@router.get("/api/blog")
async def list_blog():
    # Merge owner-composed posts (first) with live Blogger posts.
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
    blogger_posts = await _load_blog_from_blogger()
    for bp in blogger_posts:
        bp["source"] = "website"
    return admin_posts + blogger_posts

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
