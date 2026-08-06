"""
Refer-a-Patient (patient/staff/doctor word-of-mouth growth).

Concept
───────
Every signed-in user (patient OR staff OR doctor) gets a personal
8-character referral code on demand. They can share that code as a
deep link / QR / WhatsApp message. When a new patient lands on the
booking page with `?ref=<CODE>` and makes a booking, an attribution
is created. When that booking is marked "completed", the attribution
auto-flips to status="visited" — closing the loop without manual
intervention.

Data model
──────────
referral_codes:
    { code, user_id, clinic_id, referrer_type, referrer_name,
      created_at, active }

referral_attributions:
    { id, code, referrer_user_id, referrer_type, clinic_id,
      referee_phone, referee_name, referee_user_id?, booking_id?,
      source (whatsapp|qr|copy|native_share|link),
      status (pending|booked|visited),
      created_at, booked_at?, visited_at? }

Endpoints
─────────
GET  /api/me/referral-code            — get-or-create my code (auth)
GET  /api/referrals/lookup/{code}     — public: name & clinic for banner
POST /api/referrals/attribute         — public: create attribution
POST /api/referrals/{id}/mark-visited — owner-only: manual flip
GET  /api/admin/referrals             — owner list + filters
GET  /api/admin/referrals/leaderboard — owner top referrers
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth_deps import require_owner
from server import db, get_current_user, require_user
from services.tenancy import resolve_clinic_id, get_default_clinic_id

router = APIRouter()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(doc: Dict[str, Any]) -> Dict[str, Any]:
    if not doc:
        return doc
    out = dict(doc)
    out.pop("_id", None)
    return out


# ── Helpers ─────────────────────────────────────────────────────────

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # avoid I/O/0/1 ambiguity


async def _generate_code() -> str:
    """Generate a unique 8-char referral code.  Tries up to 10 times
    in case of collision — the address space is 32**8 ≈ 1.1 trillion so
    a clash is astronomically unlikely, but we still check."""
    for _ in range(10):
        code = "".join(secrets.choice(ALPHABET) for _ in range(8))
        existing = await db.referral_codes.find_one({"code": code}, {"_id": 1})
        if not existing:
            return code
    raise HTTPException(status_code=500, detail="Could not generate a unique code")


def _referrer_type_for(user: Dict[str, Any]) -> str:
    """Classify the user for analytics / display."""
    role = (user or {}).get("role") or ""
    if role in ("primary_owner", "owner", "partner", "doctor"):
        return "doctor"
    if role in ("assistant", "reception", "nursing"):
        return "staff"
    return "patient"


async def _ensure_code_for(user: Dict[str, Any]) -> Dict[str, Any]:
    """Return the user's existing active code, or mint a fresh one."""
    uid = user.get("user_id") or user.get("id")
    if not uid:
        raise HTTPException(status_code=400, detail="User has no user_id")
    existing = await db.referral_codes.find_one(
        {"user_id": uid, "active": True}, {"_id": 0}
    )
    if existing:
        return _clean(existing)
    clinic_id = await get_default_clinic_id(user) or "default"
    code = await _generate_code()
    doc = {
        "code": code,
        "user_id": uid,
        "clinic_id": clinic_id,
        "referrer_type": _referrer_type_for(user),
        "referrer_name": user.get("name") or user.get("email") or "Friend",
        "active": True,
        "created_at": _now(),
    }
    await db.referral_codes.insert_one(doc)
    return _clean(doc)


# ── /api/me/referral-code ───────────────────────────────────────────

@router.get("/api/me/referral-code")
async def my_code(user=Depends(require_user)):
    """Get or lazily create my referral code, plus aggregate counters
    so the share screen can show *"X invited · Y booked · Z visited"*."""
    code_doc = await _ensure_code_for(user)
    code = code_doc["code"]
    invited = await db.referral_attributions.count_documents({"code": code})
    booked = await db.referral_attributions.count_documents({
        "code": code, "status": {"$in": ["booked", "visited"]},
    })
    visited = await db.referral_attributions.count_documents({
        "code": code, "status": "visited",
    })
    return {
        "code": code,
        "referrer_name": code_doc.get("referrer_name"),
        "referrer_type": code_doc.get("referrer_type"),
        "clinic_id": code_doc.get("clinic_id"),
        "invited": invited,
        "booked": booked,
        "visited": visited,
    }


# ── /api/referrals/lookup/{code}  (public) ──────────────────────────

@router.get("/api/referrals/lookup/{code}")
async def lookup(code: str):
    """Public lookup — used by the booking flow to show
    *"You were invited by Asha — welcome!"* before submit."""
    doc = await db.referral_codes.find_one(
        {"code": code.upper(), "active": True}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    first_name = ((doc.get("referrer_name") or "").split() or [""])[0]
    return {
        "valid": True,
        "code": code.upper(),
        "referrer_first_name": first_name,
        "referrer_type": doc.get("referrer_type"),
        "clinic_id": doc.get("clinic_id"),
    }


# ── /api/referrals/attribute  (public) ──────────────────────────────

class AttributeBody(BaseModel):
    code: str
    phone: Optional[str] = None
    name: Optional[str] = None
    source: Optional[str] = "link"
    booking_id: Optional[str] = None


@router.post("/api/referrals/attribute")
async def attribute(body: AttributeBody):
    """Create or update a referral attribution. Designed to be called
    twice during a referee's journey:
      1. On `/c/<slug>?ref=<CODE>` landing — creates a *pending* entry
         with `source` set (whatsapp / qr / copy / native_share / link)
      2. On booking submit — adds `booking_id` and bumps status to
         `booked`. We dedup by `(code, phone)` so multiple landings
         don't inflate the counters.
    """
    code = (body.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    code_doc = await db.referral_codes.find_one(
        {"code": code, "active": True}, {"_id": 0}
    )
    if not code_doc:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    phone = (body.phone or "").strip() or None
    existing: Optional[Dict[str, Any]] = None
    if phone:
        existing = await db.referral_attributions.find_one({
            "code": code, "referee_phone": phone,
        }, {"_id": 0})
    if existing:
        update_doc: Dict[str, Any] = {}
        if body.booking_id and not existing.get("booking_id"):
            update_doc["booking_id"] = body.booking_id
            update_doc["status"] = "booked"
            update_doc["booked_at"] = _now()
        if body.name and not existing.get("referee_name"):
            update_doc["referee_name"] = body.name
        if body.source:
            update_doc.setdefault("source", body.source)
        if update_doc:
            await db.referral_attributions.update_one(
                {"id": existing["id"]}, {"$set": update_doc}
            )
        return {"ok": True, "id": existing["id"], "deduped": True}
    rid = str(uuid.uuid4())
    doc = {
        "id": rid,
        "code": code,
        "referrer_user_id": code_doc.get("user_id"),
        "referrer_type": code_doc.get("referrer_type"),
        "clinic_id": code_doc.get("clinic_id"),
        "referee_phone": phone,
        "referee_name": (body.name or "").strip() or None,
        "booking_id": body.booking_id,
        "source": body.source or "link",
        "status": "booked" if body.booking_id else "pending",
        "created_at": _now(),
        "booked_at": _now() if body.booking_id else None,
        "visited_at": None,
    }
    await db.referral_attributions.insert_one(doc)
    return {"ok": True, "id": rid, "deduped": False}


# ── /api/referrals/{id}/mark-visited  (owner) ───────────────────────

@router.post("/api/referrals/{rid}/mark-visited")
async def mark_visited(rid: str, request: Request, user=Depends(require_owner)):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    existing = await db.referral_attributions.find_one(
        {"id": rid, "clinic_id": clinic_id}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Attribution not found")
    await db.referral_attributions.update_one(
        {"id": rid},
        {"$set": {"status": "visited", "visited_at": _now()}},
    )
    return {"ok": True}


# ── Auto-flip on booking completion ─────────────────────────────────

async def auto_mark_visited_on_booking_complete(booking_id: str) -> None:
    """Hook called from the booking completion flow. Best-effort —
    never raises so a missing attribution can't break the main flow.

    Side-effect: when an attribution flips to "visited", the referrer
    gets a celebratory push so they feel rewarded for sharing.
    """
    try:
        if not booking_id:
            return
        rec = await db.referral_attributions.find_one(
            {"booking_id": booking_id, "status": {"$ne": "visited"}}, {"_id": 0},
        )
        if not rec:
            return
        await db.referral_attributions.update_one(
            {"id": rec["id"]},
            {"$set": {"status": "visited", "visited_at": _now()}},
        )
        # Thank-you push to the referrer.
        try:
            from services.notifications import create_notification
            referee = (rec.get("referee_name") or "").strip() or "Your friend"
            await create_notification(
                user_id=rec.get("referrer_user_id"),
                phone=None,
                title="🎉 Thank you for referring!",
                body=f"{referee} just visited Dr. Joshi. Your invite worked!",
                kind="referral_visited",
                data={
                    "type": "referral_visited",
                    "attribution_id": rec.get("id"),
                    "deep_link": "/refer",
                },
                push=True,
            )
        except Exception:
            pass
    except Exception:
        pass


# ── /api/admin/referrals ────────────────────────────────────────────

@router.get("/api/admin/referrals")
async def admin_list(
    request: Request,
    status: Optional[str] = None,
    limit: int = 200,
    user=Depends(require_owner),
):
    clinic_id = await resolve_clinic_id(request, user) or "default"
    q: Dict[str, Any] = {"clinic_id": clinic_id}
    if status in ("pending", "booked", "visited"):
        q["status"] = status
    cur = db.referral_attributions.find(q).sort("created_at", -1).limit(max(1, min(limit, 500)))
    items: List[Dict[str, Any]] = []
    referrer_cache: Dict[str, Dict[str, Any]] = {}
    async for d in cur:
        # Enrich with referrer display name.
        rid = d.get("referrer_user_id")
        if rid and rid not in referrer_cache:
            code_doc = await db.referral_codes.find_one(
                {"user_id": rid, "active": True},
                {"_id": 0, "referrer_name": 1, "referrer_type": 1},
            )
            referrer_cache[rid] = code_doc or {}
        d["referrer_name"] = referrer_cache.get(rid, {}).get("referrer_name") or "—"
        items.append(_clean(d))
    counts = {
        "total": await db.referral_attributions.count_documents({"clinic_id": clinic_id}),
        "pending": await db.referral_attributions.count_documents({"clinic_id": clinic_id, "status": "pending"}),
        "booked": await db.referral_attributions.count_documents({"clinic_id": clinic_id, "status": "booked"}),
        "visited": await db.referral_attributions.count_documents({"clinic_id": clinic_id, "status": "visited"}),
    }
    return {"items": items, "counts": counts}


@router.get("/api/admin/referrals/leaderboard")
async def leaderboard(request: Request, user=Depends(require_owner)):
    """Top 10 referrers by visited > booked > total invited."""
    clinic_id = await resolve_clinic_id(request, user) or "default"
    pipeline = [
        {"$match": {"clinic_id": clinic_id}},
        {"$group": {
            "_id": "$referrer_user_id",
            "referrer_type": {"$first": "$referrer_type"},
            "total": {"$sum": 1},
            "booked": {"$sum": {"$cond": [{"$in": ["$status", ["booked", "visited"]]}, 1, 0]}},
            "visited": {"$sum": {"$cond": [{"$eq": ["$status", "visited"]}, 1, 0]}},
        }},
        {"$sort": {"visited": -1, "booked": -1, "total": -1}},
        {"$limit": 10},
    ]
    rows: List[Dict[str, Any]] = []
    async for r in db.referral_attributions.aggregate(pipeline):
        uid = r.get("_id")
        code_doc = None
        if uid:
            code_doc = await db.referral_codes.find_one(
                {"user_id": uid, "active": True},
                {"_id": 0, "referrer_name": 1},
            )
        rows.append({
            "user_id": uid,
            "name": (code_doc or {}).get("referrer_name") or "—",
            "referrer_type": r.get("referrer_type"),
            "total": r.get("total", 0),
            "booked": r.get("booked", 0),
            "visited": r.get("visited", 0),
        })
    return {"items": rows}
