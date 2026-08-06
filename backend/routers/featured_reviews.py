"""ConsultUro — Featured Reviews router (Phase 5.2 — June 2026).

Curated 5★ testimonials surfaced on:
  • Patient home — horizontal swipeable carousel.
  • Dedicated /reviews route — premium grid + "Write your own review" CTA.
  • Prescription PDF footer — small QR code + tagline pointing to the
    clinic's Google review URL.

Backend storage (`featured_reviews` collection):
  {
    id, clinic_id,
    reviewer_name, reviewer_avatar_url (optional, data URI or remote),
    rating (1-5),
    text, source ("google" | "manual" | "facebook" | "other"),
    review_date (ISO date string),
    featured (bool),  // toggled into the carousel
    sort_order (int),  // owner-controlled ordering, lower = first
    created_at, updated_at,
  }

Endpoints
  PUBLIC:
    GET   /api/featured-reviews            — patient-facing carousel feed
    GET   /api/featured-reviews/cta        — review-URL + maps-URL + tagline + QR data
  OWNER:
    GET   /api/featured-reviews/all        — every row incl. unfeatured drafts
    POST  /api/featured-reviews            — create
    PATCH /api/featured-reviews/{id}        — partial update
    DELETE /api/featured-reviews/{id}       — remove
    POST  /api/featured-reviews/reorder    — bulk sort
    POST  /api/featured-reviews/pull-google — pull from Google Places
                                              (NOT implemented yet, returns 501)

The /cta endpoint also returns a base64-encoded SVG QR code for the
review URL so the prescription PDF can embed it without a runtime
dependency on a QR JS library.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth_deps import require_owner
from db import db
from services.tenancy import resolve_clinic_id

log = logging.getLogger(__name__)
router = APIRouter()


def _clinic_settings_doc(clinic_id: Optional[str]) -> Dict[str, Any]:
    return {"_id": clinic_id or "default"}


async def _settings(clinic_id: Optional[str]) -> Dict[str, Any]:
    sid = clinic_id or "default"
    doc = await db.clinic_settings.find_one({"_id": sid})
    if not doc and sid != "default":
        doc = await db.clinic_settings.find_one({"_id": "default"}) or {}
    return doc or {}


def _clean(row: Dict[str, Any]) -> Dict[str, Any]:
    row.pop("_id", None)
    for k in ("created_at", "updated_at"):
        v = row.get(k)
        if isinstance(v, datetime):
            row[k] = v.isoformat()
    return row


class ReviewBody(BaseModel):
    reviewer_name: str
    reviewer_avatar_url: Optional[str] = None
    rating: int = Field(5, ge=1, le=5)
    text: str
    source: Optional[str] = "manual"          # google | manual | facebook | other
    review_date: Optional[str] = None         # YYYY-MM-DD
    featured: Optional[bool] = True
    sort_order: Optional[int] = None
    location: Optional[str] = None            # e.g. "Vadodara, GJ"


class ReviewPatchBody(BaseModel):
    reviewer_name: Optional[str] = None
    reviewer_avatar_url: Optional[str] = None
    rating: Optional[int] = Field(None, ge=1, le=5)
    text: Optional[str] = None
    source: Optional[str] = None
    review_date: Optional[str] = None
    featured: Optional[bool] = None
    sort_order: Optional[int] = None
    location: Optional[str] = None


# ──────────────────────────────────────────────────────────────────
# QR helper — pure-Python tiny QR using `qrcode` if available, else
# falls back to a simple SVG (Google Chart API fallback removed —
# it's unreliable and adds a network dep).
# ──────────────────────────────────────────────────────────────────
def _qr_svg_b64(url: str, size: int = 160) -> str:
    """Returns a base64-encoded SVG QR pointing at `url`. Empty
    string when generation fails."""
    if not url:
        return ""
    try:
        import qrcode
        import qrcode.image.svg
        import base64
        img = qrcode.make(
            url,
            image_factory=qrcode.image.svg.SvgPathImage,
            box_size=10, border=2,
        )
        from io import BytesIO
        buf = BytesIO()
        img.save(buf)
        svg = buf.getvalue()
        return base64.b64encode(svg).decode("ascii")
    except Exception as e:
        log.warning("QR generation failed: %s", e)
        return ""


# ──────────────────────────────────────────────────────────────────
# PUBLIC endpoints
# ──────────────────────────────────────────────────────────────────
# Auto-pull cadence — patient pages silently kick off a Google
# Places refresh when the last successful pull was more than this
# many seconds ago. Keeps reviews fresh without an explicit cron.
_AUTO_PULL_INTERVAL_SEC = 6 * 3600  # 6 hours


async def _maybe_auto_pull(clinic_id: Optional[str]) -> None:
    """Best-effort background refresh from Google Places. Skips
    silently when:
      • no API key configured
      • no Place ID configured (and not resolvable)
      • last pull was within `_AUTO_PULL_INTERVAL_SEC`
      • Google call fails (network / quota)
    Runs synchronously inside the request but is wrapped in a
    blanket try/except so the public reviews list never 500s on
    transient Google errors.
    """
    try:
        s = await _settings(clinic_id)
        api_key = (s.get("google_places_api_key") or "").strip()
        place_id = (s.get("google_places_place_id") or "").strip()
        if not api_key or not place_id:
            return
        last_iso = (s.get("google_reviews_last_pulled_at") or "").strip()
        if last_iso:
            try:
                last_dt = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if age < _AUTO_PULL_INTERVAL_SEC:
                    return
            except Exception:
                pass  # malformed timestamp → just refresh.
        await _do_pull_google(clinic_id, api_key, place_id)
    except Exception as e:
        log.info("auto-pull google reviews failed (non-fatal): %s", e)


@router.get("/api/featured-reviews")
async def list_featured_reviews(request: Request):
    """Patient-facing list of reviews with WRITTEN text.

    Two-step query:
      1. Trigger a best-effort background refresh from Google Places
         when the last pull was > 6h ago (silent on failure).
      2. Return every stored review for this clinic that has a
         non-empty `text` field, sorted by `review_date` DESC so the
         newest review is always first on the carousel. Capped at 50.

    NOTE — `featured: true/false` is no longer a hard filter on the
    public list per the June 2026 product update: patients should see
    EVERY written Google review (excluding pure-rating-no-text ones).
    The `featured_reviews_admin_panel` still respects the flag for
    editorial control of the smaller home-screen carousel slot, but
    THIS endpoint returns everything-with-text by default. Pass
    `?featured_only=1` to opt back into the legacy curated mode.
    """
    clinic_id = request.headers.get("X-Clinic-Id") or request.query_params.get("clinic") or "default"
    featured_only = (request.query_params.get("featured_only") or "").strip() in {"1", "true", "yes"}

    # Fire-and-forget refresh — runs serially but is fast (one Google
    # Places HTTP round-trip when due, no-op otherwise). Wrapped in
    # `_maybe_auto_pull` so failures NEVER bubble up to patients.
    await _maybe_auto_pull(clinic_id)

    def _q(scope_clinic: Optional[str]) -> Dict[str, Any]:
        q: Dict[str, Any] = {
            "text": {"$exists": True, "$nin": ["", None]},
        }
        if scope_clinic:
            q["clinic_id"] = scope_clinic
        if featured_only:
            q["featured"] = True
        return q

    cursor = db.featured_reviews.find(_q(clinic_id)).sort(
        [("review_date", -1), ("created_at", -1)]
    ).limit(50)
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        rows.append(_clean(r))

    # Single-clinic fallback — same logic as before but on the new
    # text-only query.
    if not rows and clinic_id != "default":
        cursor = db.featured_reviews.find(_q("default")).sort(
            [("review_date", -1), ("created_at", -1)]
        ).limit(50)
        async for r in cursor:
            rows.append(_clean(r))
    if not rows:
        cursor = db.featured_reviews.find(_q(None)).sort(
            [("review_date", -1), ("created_at", -1)]
        ).limit(50)
        async for r in cursor:
            rows.append(_clean(r))

    # Safety filter: defend against any legacy rows that slipped
    # through with whitespace-only text.
    rows = [r for r in rows if isinstance(r.get("text"), str) and r["text"].strip()]
    return {"items": rows, "count": len(rows)}


@router.get("/api/featured-reviews/cta")
async def featured_reviews_cta(request: Request):
    """Returns the review-URL / maps-URL / tagline / QR (base64 SVG)
    used by the prescription PDF footer + dedicated /reviews CTA.

    Also surfaces the canonical Google rating + total review count
    (cached from the latest pull-google call) so the patient /reviews
    page shows the authoritative Google numbers instead of a local
    average over only the 5 most recent reviews.
    """
    clinic_id = request.headers.get("X-Clinic-Id") or request.query_params.get("clinic") or "default"
    s = await _settings(clinic_id)
    review_url = (s.get("google_review_url") or "").strip()
    maps_url = (s.get("google_maps_profile_url") or "").strip()
    enabled = bool(s.get("featured_reviews_enabled"))
    google_rating = s.get("google_rating")
    google_total_ratings = s.get("google_total_ratings")
    google_place_name = s.get("google_place_name")
    place_id = (s.get("google_places_place_id") or "").strip()
    # Single-clinic fallback: if the default settings doc is unconfigured,
    # try the first clinic that has a review_url OR a place_id set.
    if not review_url and not place_id and clinic_id == "default":
        candidate = await db.clinic_settings.find_one(
            {"$or": [
                {"google_review_url": {"$exists": True, "$nin": ["", None]}},
                {"google_places_place_id": {"$exists": True, "$nin": ["", None]}},
            ]},
            {"_id": 0},
        )
        if candidate:
            s = candidate
            review_url = (candidate.get("google_review_url") or "").strip()
            maps_url = (candidate.get("google_maps_profile_url") or "").strip()
            enabled = bool(candidate.get("featured_reviews_enabled"))
            google_rating = candidate.get("google_rating", google_rating)
            google_total_ratings = candidate.get("google_total_ratings", google_total_ratings)
            google_place_name = candidate.get("google_place_name", google_place_name)
            place_id = (candidate.get("google_places_place_id") or "").strip()
    # ── Auto-derived "Write a Review" deeplink ───────────────────────
    # If the owner hasn't pasted an explicit `google_review_url` but
    # we DO have a Place ID (from the auto-pull setup), synthesize the
    # canonical Google write-review URL from that. Same URL Google
    # itself uses on the "Write a review" button in the Maps web UI,
    # so it opens the right review composer on Android / iOS / Web.
    if not review_url and place_id:
        review_url = f"https://search.google.com/local/writereview?placeid={place_id}"
    # Same trick for the Maps URL — synthesize one from place_id when
    # no explicit one was saved.
    if not maps_url and place_id:
        maps_url = f"https://www.google.com/maps/place/?q=place_id:{place_id}"
    return {
        "enabled": enabled,
        "review_url": review_url,
        "maps_url": maps_url,
        "tagline": "Loved your visit? Leave a quick Google review 🙏",
        "qr_svg_b64": _qr_svg_b64(review_url) if review_url else "",
        "clinic_name": s.get("clinic_name") or "ConsultUro",
        "google_rating": google_rating,
        "google_total_ratings": google_total_ratings,
        "google_place_name": google_place_name,
    }


# ──────────────────────────────────────────────────────────────────
# OWNER endpoints
# ──────────────────────────────────────────────────────────────────
@router.get("/api/featured-reviews/all")
async def list_all_reviews(
    request: Request,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    cursor = db.featured_reviews.find(
        {"clinic_id": clinic_id}
    ).sort([("sort_order", 1), ("created_at", -1)])
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        rows.append(_clean(r))
    return {"items": rows, "count": len(rows)}


@router.post("/api/featured-reviews")
async def create_review(
    request: Request,
    body: ReviewBody,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    if not body.reviewer_name.strip() or not body.text.strip():
        raise HTTPException(status_code=400, detail="reviewer_name and text are required")
    now = datetime.now(timezone.utc)
    # Default sort_order: append to end.
    if body.sort_order is None:
        last = await db.featured_reviews.find_one(
            {"clinic_id": clinic_id}, sort=[("sort_order", -1)],
        )
        next_order = (last.get("sort_order", 0) + 1) if last else 0
    else:
        next_order = int(body.sort_order)
    doc = {
        "id": str(uuid.uuid4()),
        "clinic_id": clinic_id,
        "reviewer_name": body.reviewer_name.strip()[:120],
        "reviewer_avatar_url": (body.reviewer_avatar_url or "").strip() or None,
        "rating": int(body.rating),
        "text": body.text.strip()[:2000],
        "source": (body.source or "manual").strip().lower(),
        "review_date": (body.review_date or "").strip() or now.date().isoformat(),
        "featured": bool(body.featured) if body.featured is not None else True,
        "sort_order": next_order,
        "location": (body.location or "").strip() or None,
        "created_at": now,
        "updated_at": now,
    }
    await db.featured_reviews.insert_one(doc)
    return _clean(doc)


@router.patch("/api/featured-reviews/{review_id}")
async def patch_review(
    review_id: str,
    request: Request,
    body: ReviewPatchBody,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    update = body.model_dump(exclude_unset=True)
    if not update:
        return {"ok": True, "updated": 0}
    update["updated_at"] = datetime.now(timezone.utc)
    if "text" in update and isinstance(update["text"], str):
        update["text"] = update["text"][:2000]
    res = await db.featured_reviews.update_one(
        {"id": review_id, "clinic_id": clinic_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    doc = await db.featured_reviews.find_one({"id": review_id})
    return _clean(doc or {})


@router.delete("/api/featured-reviews/{review_id}")
async def delete_review(
    review_id: str,
    request: Request,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    # Try the owner's clinic first; if not found, fall back to the
    # `default` bucket (single-clinic deployments store legacy rows
    # there) and finally to "match by id alone" so a legacy review
    # whose clinic_id field drifted can still be removed by its
    # creator. Without this fallback, the trash icon on the
    # Featured Reviews admin panel silently 404s for any row whose
    # clinic_id doesn't EXACTLY match the resolved session clinic
    # — exactly what happened to the user's "Divyanshu Verma" manual
    # review on the Vercel web deployment.
    res = await db.featured_reviews.delete_one(
        {"id": review_id, "clinic_id": clinic_id}
    )
    if res.deleted_count == 0 and clinic_id != "default":
        res = await db.featured_reviews.delete_one(
            {"id": review_id, "clinic_id": "default"}
        )
    if res.deleted_count == 0:
        res = await db.featured_reviews.delete_one({"id": review_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")
    return {"ok": True}


@router.post("/api/featured-reviews/reorder")
async def reorder_reviews(
    request: Request,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_owner),
):
    """Body: { ids: [reviewId, reviewId, ...] } — sort_order assigned
    according to array position (first item → sort_order 0)."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    ids = body.get("ids") or []
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be a list")
    for idx, rid in enumerate(ids):
        await db.featured_reviews.update_one(
            {"id": rid, "clinic_id": clinic_id},
            {"$set": {"sort_order": idx, "updated_at": datetime.now(timezone.utc)}},
        )
    return {"ok": True, "count": len(ids)}


@router.post("/api/featured-reviews/resolve-place")
async def resolve_place(
    request: Request,
    body: Dict[str, Any] = Body(default={}),
    user=Depends(require_owner),
):
    """Resolve a Google Maps URL (or free-text query like the clinic
    name + city) into a canonical Place ID + place name + rating, using
    the API key stored in clinic_settings. Used by the Branding ->
    Google Reviews admin UI to preview-and-confirm BEFORE persisting
    the place id.
    """
    import httpx

    clinic_id = await resolve_clinic_id(request, user)
    s = await _settings(clinic_id)
    api_key = (s.get("google_places_api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Google Places API key is not set.")

    maps_url = (body.get("maps_url") or "").strip()
    query = (body.get("query") or "").strip()
    explicit_pid = (body.get("place_id") or "").strip()
    if not maps_url and not query and not explicit_pid:
        raise HTTPException(status_code=400, detail="Provide a maps_url, place_id, or query.")

    # If the caller already knows the canonical Place ID (e.g. they
    # copied it from https://developers.google.com/maps/documentation/places/web-service/place-id),
    # honour that directly — skips URL guessing entirely. This is the
    # escape hatch when share-link resolution picks the wrong listing
    # (common for clinics with duplicate Google Business profiles).
    if explicit_pid and explicit_pid.startswith("ChIJ"):
        pid = explicit_pid
    else:
        pid = await _resolve_place_id(api_key, maps_url, query)
    if not pid:
        raise HTTPException(status_code=404, detail="Could not resolve a Place ID from that URL / query.")

    # Verify by fetching basic details so the UI can confirm with the user.
    async def _details(p_id: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=12) as hc:
                r = await hc.get(
                    "https://maps.googleapis.com/maps/api/place/details/json",
                    params={
                        "place_id": p_id,
                        "fields": "name,rating,user_ratings_total,url,formatted_address",
                        "key": api_key,
                    },
                )
            return r.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Place details fetch failed: {e}")

    j = await _details(pid)
    if (j.get("status") or "").upper() != "OK":
        raise HTTPException(status_code=502, detail=j.get("error_message") or "Place details failed")
    res = j.get("result") or {}

    # ── Same-clinic-multiple-listings safety net ────────────────────
    # Many clinics have duplicate Google Business profiles — one new/
    # unverified listing with 0 reviews and one canonical listing with
    # all the historical reviews. If the URL resolved to the 0-review
    # listing, we transparently search for a sibling listing with the
    # same name (or the user-supplied `query`) AND more reviews, and
    # offer that as an `alternative` in the response so the admin UI
    # can show "you might have meant THIS listing instead".
    total_here = int(res.get("user_ratings_total") or 0)
    alternatives: List[Dict[str, Any]] = []
    if total_here == 0 and not explicit_pid:
        search_text = (query or res.get("name") or "").strip()
        if search_text:
            try:
                async with httpx.AsyncClient(timeout=12) as hc:
                    rr = await hc.get(
                        "https://maps.googleapis.com/maps/api/place/textsearch/json",
                        params={
                            "query": search_text,
                            "key": api_key,
                        },
                    )
                tj = rr.json()
            except Exception:
                tj = {}
            for cand in (tj.get("results") or [])[:5]:
                cpid = cand.get("place_id")
                if not cpid or cpid == pid:
                    continue
                ctot = int(cand.get("user_ratings_total") or 0)
                if ctot <= total_here:
                    continue
                alternatives.append({
                    "place_id": cpid,
                    "place_name": cand.get("name"),
                    "rating": cand.get("rating"),
                    "total_ratings": ctot,
                    "formatted_address": cand.get("formatted_address"),
                })
            # Sort alternatives by total_ratings DESC.
            alternatives.sort(key=lambda x: x.get("total_ratings") or 0, reverse=True)

    return {
        "place_id": pid,
        "place_name": res.get("name"),
        "rating": res.get("rating"),
        "total_ratings": res.get("user_ratings_total"),
        "place_url": res.get("url"),
        "formatted_address": res.get("formatted_address"),
        # When the URL-resolved listing has 0 reviews, `alternatives`
        # lists better candidates the admin UI can offer with a
        # one-tap "Use this one instead" button.
        "alternatives": alternatives,
    }


@router.post("/api/featured-reviews/pull-google")
async def pull_google_reviews(
    request: Request,
    user=Depends(require_owner),
):
    """Pull live Google Places reviews into the featured-reviews
    feed. Each review with WRITTEN TEXT is auto-featured so it appears
    on the patient carousel + reviews page; pure-rating-no-text ones
    are skipped.

    Idempotent: re-running upserts existing rows by
    `(clinic_id, source='google', google_review_id)`.

    Returns: { fetched, inserted, updated, skipped, place_name, rating,
              total_ratings, place_url }.
    """
    clinic_id = await resolve_clinic_id(request, user)
    s = await _settings(clinic_id)
    api_key = (s.get("google_places_api_key") or "").strip()
    place_id = (s.get("google_places_place_id") or "").strip()

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Google Places API key is not set. Add it in Dashboard → Branding → Google Reviews.",
        )
    if not place_id:
        # Try to resolve place_id from the saved Google Maps URL or
        # the clinic name + city as a last-ditch search.
        maps_url = (s.get("google_maps_profile_url") or "").strip()
        query = (s.get("clinic_name") or "").strip()
        place_id = await _resolve_place_id(api_key, maps_url, query)
        if place_id:
            await db.clinic_settings.update_one(
                {"_id": clinic_id or "default"},
                {"$set": {"google_places_place_id": place_id}},
                upsert=True,
            )
        else:
            raise HTTPException(
                status_code=400,
                detail="Google Place ID is not set and could not be auto-resolved. Paste your Google Maps clinic URL in Branding → Google Reviews first.",
            )

    return await _do_pull_google(clinic_id, api_key, place_id)


async def _do_pull_google(
    clinic_id: Optional[str],
    api_key: str,
    place_id: str,
) -> Dict[str, Any]:
    """Shared implementation used by both the owner-triggered
    `/api/featured-reviews/pull-google` and the public auto-pull
    hook in `_maybe_auto_pull`.

    Behaviour:
      • Calls Google Places "Place Details" TWICE to widen the
        review-window — once with `reviews_sort=newest` (most
        recent 5) and once with `reviews_sort=most_relevant`
        (top-rated 5). Reviews are de-duplicated by
        `author_url|time`. This typically surfaces 7–10 distinct
        reviews per pull instead of the 5-review cap that a single
        Places-Details call enforces.
      • Google Places API hard-limits reviews to 5 per call and a
        cumulative of ~10 distinct reviews even across sort modes —
        getting ALL reviews (e.g. all 36) requires either Google's
        paid Business Profile API (clinic must own the listing) or
        accumulating snapshots over time. Both are documented in
        the admin UI helper text.
      • Skips reviews without written text (per product spec).
      • Upserts each text review with `featured=true` so it appears
        on the carousel/reviews page automatically; the newest is
        first because we sort by review_date DESC on the public list.
      • Caches the canonical place rating + total ratings on
        clinic_settings.
      • Stamps `google_reviews_last_pulled_at` for cooldown.
    """
    import httpx

    details_url = "https://maps.googleapis.com/maps/api/place/details/json"

    # ── Twin-fetch strategy ──────────────────────────────────────
    # `reviews_sort=newest` and `reviews_sort=most_relevant` return
    # overlapping but rarely identical sets. Merging both unlocks
    # up to ~10 distinct reviews per pull.
    seen_gids: set = set()
    merged_reviews: List[Dict[str, Any]] = []
    place_name = ""
    place_rating: Any = None
    total_ratings: Any = None
    place_url = ""
    last_status: str = "OK"
    last_error: str = ""
    for sort_mode in ("newest", "most_relevant"):
        params = {
            "place_id": place_id,
            "fields": "reviews,name,rating,user_ratings_total,url,formatted_address",
            "reviews_sort": sort_mode,
            "reviews_no_translations": "true",
            "key": api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                r = await hc.get(details_url, params=params)
            data = r.json()
        except Exception as e:
            log.warning("Google Places details fetch failed (sort=%s): %s", sort_mode, e)
            last_error = str(e)
            continue
        status_str = (data.get("status") or "").upper()
        last_status = status_str
        if status_str != "OK":
            last_error = data.get("error_message") or status_str
            continue
        result = data.get("result") or {}
        # Place-level metadata is the same across sort modes; capture once.
        if not place_name:
            place_name = result.get("name") or ""
            place_rating = result.get("rating")
            total_ratings = result.get("user_ratings_total")
            place_url = result.get("url") or ""
        for rev in result.get("reviews") or []:
            gid = f"{rev.get('author_url','')}|{rev.get('time','')}"
            if not gid or gid == "|" or gid in seen_gids:
                continue
            seen_gids.add(gid)
            merged_reviews.append(rev)

    # If BOTH calls failed, surface a clean 502 to the caller.
    if not place_name and last_status != "OK":
        raise HTTPException(
            status_code=502,
            detail=f"Google Places: {last_error or last_status}",
        )

    inserted = 0
    updated = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    scoped_clinic = clinic_id or "default"
    for rev in merged_reviews:
        gid = f"{rev.get('author_url','')}|{rev.get('time','')}"
        if not gid or gid == "|":
            skipped += 1
            continue
        rating = int(rev.get("rating") or 0)
        if rating < 1 or rating > 5:
            skipped += 1
            continue
        text = (rev.get("text") or "").strip()
        if not text:
            # Per product spec — exclude pure-rating-no-text reviews
            # from the patient feed entirely.
            skipped += 1
            continue
        # Convert epoch seconds → ISO date for storage.
        review_iso = ""
        try:
            ts = int(rev.get("time") or 0)
            if ts > 0:
                review_iso = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
        except Exception:
            pass
        doc = {
            "id": f"gr-{abs(hash(gid)) & 0xFFFFFFFFFFFF:012x}",
            "clinic_id": scoped_clinic,
            "reviewer_name": (rev.get("author_name") or "Google user").strip(),
            "reviewer_avatar_url": rev.get("profile_photo_url") or None,
            "rating": rating,
            "text": text,
            "source": "google",
            "review_date": review_iso or now.date().isoformat(),
            "featured": True,
            "sort_order": 100,
            "location": rev.get("relative_time_description") or None,
            "google_review_id": gid,
            "google_author_url": rev.get("author_url") or None,
            "updated_at": now,
        }
        existing = await db.featured_reviews.find_one({
            "clinic_id": doc["clinic_id"],
            "source": "google",
            "google_review_id": gid,
        }, {"id": 1, "featured": 1, "sort_order": 1})
        if existing:
            patch_doc = {k: v for k, v in doc.items() if k not in ("id",)}
            if existing.get("featured") is False:
                patch_doc.pop("featured", None)
            cur_sort = existing.get("sort_order")
            if isinstance(cur_sort, int) and cur_sort not in (100, 1000):
                patch_doc.pop("sort_order", None)
            await db.featured_reviews.update_one(
                {"_id": existing["_id"]},
                {"$set": patch_doc},
            )
            updated += 1
        else:
            doc["created_at"] = now
            await db.featured_reviews.insert_one(doc)
            inserted += 1

    # Cache the canonical Google rating + total + last-pulled stamp.
    try:
        await db.clinic_settings.update_one(
            {"_id": scoped_clinic},
            {"$set": {
                "google_rating": place_rating,
                "google_total_ratings": total_ratings,
                "google_place_name": place_name,
                "google_place_url": place_url,
                "google_reviews_last_pulled_at": now.isoformat(),
            }},
            upsert=True,
        )
    except Exception as e:
        log.warning("Could not persist google rating cache: %s", e)

    return {
        "fetched": len(merged_reviews),
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "place_id": place_id,
        "place_name": place_name,
        "rating": place_rating,
        "total_ratings": total_ratings,
        "place_url": place_url,
        # Surface the documented Google API limit so the UI can
        # explain why "Pull now" returned only ~10 reviews when
        # Google itself reports 36 — this is by design from Google's
        # side, not a bug in our backend.
        "google_api_cap_note": (
            "Google Places API exposes at most ~10 distinct reviews per "
            "pull (5 newest + 5 most-relevant). Re-running over time "
            "captures additional ones as they rotate. Total of "
            f"{total_ratings or 0} reviews exist on your Google listing."
        ),
    }


async def _resolve_place_id(api_key: str, maps_url: str, query: str) -> str:
    """Best-effort Place-ID resolution from a Google Maps URL or a
    text query. Returns '' if nothing resolves.

    Supports:
      • cid=NNN     in long /maps?cid= URLs (the canonical clinic URL).
      • short links (https://share.google/..., maps.app.goo.gl/...)
        which we expand once and re-scan.
      • plain text — falls through to Find-Place-from-Text.
    """
    import httpx
    import re as _re

    if not api_key:
        return ""

    async def _findplace(text: str) -> str:
        if not text:
            return ""
        try:
            async with httpx.AsyncClient(timeout=12) as hc:
                resp = await hc.get(
                    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                    params={
                        "input": text,
                        "inputtype": "textquery",
                        "fields": "place_id",
                        "key": api_key,
                    },
                )
            j = resp.json()
            cands = j.get("candidates") or []
            return (cands[0].get("place_id") if cands else "") or ""
        except Exception:
            return ""

    url = (maps_url or "").strip()
    if url:
        # 1) Expand share-shortener URLs.
        if "share.google" in url or "maps.app.goo.gl" in url or "goo.gl" in url:
            try:
                async with httpx.AsyncClient(timeout=12, follow_redirects=True) as hc:
                    resp = await hc.get(url, headers={
                        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15"
                    })
                page = resp.text
            except Exception:
                page = ""
            # Try to pull a text query (q=…) or a Place ID from the body.
            m = _re.search(r"ChIJ[A-Za-z0-9_-]{15,}", page or "")
            if m:
                return m.group(0)
            m = _re.search(r"[?&]q=([^\"&]+)", page or "")
            if m:
                from urllib.parse import unquote_plus
                pid = await _findplace(unquote_plus(m.group(1)))
                if pid:
                    return pid

        # 2) cid= URLs (e.g. https://maps.google.com/?cid=2674912838492754509).
        m = _re.search(r"[?&]cid=(\d+)", url)
        if m:
            pid = await _findplace(f"cid:{m.group(1)}")
            if pid:
                return pid

        # 3) /maps/place/<Name>/data=...!1s<placeid>
        m = _re.search(r"ChIJ[A-Za-z0-9_-]{15,}", url)
        if m:
            return m.group(0)

    # 4) Last resort — text query (clinic name).
    return await _findplace(query)

