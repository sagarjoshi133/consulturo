"""ConsultUro — Share / link-unfurl router.

Produces crawler-friendly HTML with Open Graph + Twitter Card meta tags
so that when a ConsultUro link is pasted into WhatsApp / Facebook /
Twitter / iMessage etc. the recipient sees a rich preview card (title +
description + image) instead of a bare URL.

Flow:
  • A social-media crawler fetches `/api/share/<kind>[/<ident>]`, reads
    the <meta> tags, and renders the preview card.
  • A real human browser runs the tiny JS redirect and lands on the
    actual in-app page (same host, `/<app path>`).

Metadata is resolved server-side for clinics / blog posts / surgery
guides. For everything else the frontend passes `t` (title), `d`
(description) and optional `img` query params (the screen already has
this data), with sensible app-wide defaults as a fallback.
"""
from __future__ import annotations

from html import escape
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from db import db
from routers.guides import get_guide

router = APIRouter()

DEFAULT_TITLE = "ConsultUro"
DEFAULT_DESC = "Dr. Sagar Joshi — Urology care, appointments, patient guides & more, all in one app."
# A safe default OG image (the public clinic site banner). Absolute https.
DEFAULT_IMAGE = "https://www.drsagarjoshi.com/favicon.ico"


def _base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}".rstrip("/")


def _clip(text: str, n: int = 200) -> str:
    text = (text or "").strip().replace("\n", " ")
    return (text[: n - 1] + "…") if len(text) > n else text


def _render(*, title: str, desc: str, image: str, canonical: str) -> HTMLResponse:
    t = escape(title or DEFAULT_TITLE)
    d = escape(_clip(desc or DEFAULT_DESC))
    img = escape(image or DEFAULT_IMAGE)
    url = escape(canonical)
    # og:url + JS redirect point at the real in-app page. Crawlers don't
    # run JS so they only read the meta tags; humans get redirected.
    html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ConsultUro">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:image" content="{img}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{img}">
<link rel="canonical" href="{url}">
<meta http-equiv="refresh" content="0; url={url}">
<script>try{{window.location.replace({url!r});}}catch(e){{window.location.href="{url}";}}</script>
</head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6f8;margin:0">
<div style="max-width:480px;margin:64px auto;text-align:center;color:#111">
  <h1 style="color:#0E7C8B;font-size:22px;margin:0 0 8px">{t}</h1>
  <p style="color:#555;font-size:15px;margin:0 0 20px">{d}</p>
  <a href="{url}" style="background:#0E7C8B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open in ConsultUro</a>
</div></body></html>"""
    return HTMLResponse(content=html, status_code=200)


# App-path map: kind -> canonical in-app page.
_APP_PATH = {
    "home": "/",
    "book": "/book",
    "booking": "/book",
    "videos": "/videos",
    "education": "/education",
    "blog_list": "/blog",
    "refer": "/refer",
}


@router.get("/api/share/{kind}")
async def share_kind(kind: str, request: Request,
                     t: Optional[str] = None, d: Optional[str] = None,
                     img: Optional[str] = None, ref: Optional[str] = None):
    return await _share(kind, None, request, t, d, img, ref)


@router.get("/api/share/{kind}/{ident}")
async def share_kind_ident(kind: str, ident: str, request: Request,
                           t: Optional[str] = None, d: Optional[str] = None,
                           img: Optional[str] = None, ref: Optional[str] = None):
    return await _share(kind, ident, request, t, d, img, ref)


async def _share(kind: str, ident: Optional[str], request: Request,
                 t: Optional[str], d: Optional[str], img: Optional[str],
                 ref: Optional[str] = None) -> HTMLResponse:
    base = _base_url(request)
    title, desc, image = None, None, None
    app_path = _APP_PATH.get(kind, "/")

    if kind == "clinic" and ident:
        c = await db.clinics.find_one({"slug": ident}, {"_id": 0})
        if c:
            title = c.get("name") or DEFAULT_TITLE
            desc = c.get("tagline") or c.get("address") or DEFAULT_DESC
            settings = await db.clinic_settings.find_one(
                {"_id": c.get("clinic_id")}, {"main_photo_url": 1, "cover_photo_url": 1}
            ) or {}
            image = settings.get("cover_photo_url") or settings.get("main_photo_url") or None
        app_path = f"/c/{quote(ident)}"

    elif kind == "blog" and ident:
        p = await db.blog_posts.find_one({"post_id": ident}, {"_id": 0})
        if p:
            title = p.get("title") or "ConsultUro Blog"
            desc = p.get("excerpt") or _clip(p.get("content", ""))
            image = p.get("cover") or None
        app_path = f"/blog/{quote(ident)}"

    elif kind == "guide" and ident:
        g = get_guide(ident)
        if g:
            nm = g.get("name") or {}
            title = (nm.get("en") if isinstance(nm, dict) else nm) or "Surgery Guide"
            title = f"{title} — Patient Guide"
            ov = g.get("overview") or {}
            desc = (ov.get("en") if isinstance(ov, dict) else ov) or \
                "What to expect before, during and after your procedure."
        app_path = f"/guides/{quote(ident)}"

    elif kind == "video" and ident:
        app_path = f"/videos"
        title = t or "ConsultUro Videos"
        desc = d or "Watch trusted urology explainers from Dr. Sagar Joshi."

    elif kind == "refer" and ident:
        app_path = f"/refer?ref={quote(ident)}"
        title = t or "Join me on ConsultUro"
        desc = d or "I use ConsultUro for my urology care — bookings, records & guides in one app."

    # Query-param overrides always win (screen already knows its content).
    title = t or title or DEFAULT_TITLE
    desc = d or desc or DEFAULT_DESC
    image = img or image or DEFAULT_IMAGE

    canonical = f"{base}{app_path}"
    # Preserve a referral code on the canonical redirect so attribution
    # survives the unfurl hop (only meaningful for clinic landing pages).
    if ref:
        sep = "&" if "?" in canonical else "?"
        canonical = f"{canonical}{sep}ref={quote(ref)}"
    return _render(title=title, desc=desc, image=image, canonical=canonical)
