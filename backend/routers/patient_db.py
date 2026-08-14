"""ConsultUro — Patient Database router.

Per Dr. Joshi spec 2026-05-21:
  · GET  /api/patient-db/list      Paginated, searchable, month-filterable
                                   patient list (visible to anyone with
                                   `can_access_patient_db` permission).
  · GET  /api/patient-db/{phone}   Patient detail with consultation history
                                   (bookings + prescriptions + surgeries).
  · GET  /api/patient-db/export    CSV download — primary_owner / super_owner
                                   only.
  · POST /api/patient-db/snapshot  Manual trigger for the monthly snapshot
                                   job (also runs automatically — see
                                   services/patient_snapshots.py).

Search supports any combo of:
  · q          — free text matching name / phone / reg_no / email
  · month      — YYYY-MM (filters by `first_seen_at` to that month)
  · gender     — Male / Female / Other
  · limit/skip — pagination (default 50, max 200)

All endpoints honour the multi-tenant `X-Clinic-Id` header.
"""
import csv
import io
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db import db
from auth_deps import require_user, require_owner, is_owner_or_partner
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()

# ─── Permission helpers ─────────────────────────────────────────────


def _can_access(user: Dict[str, Any]) -> bool:
    from services.capabilities import has_capability
    return has_capability(user, "access_patient_db")


def _can_export(user: Dict[str, Any]) -> bool:
    return user.get("role") in {"super_owner", "primary_owner", "owner"}


def _require_access(user):
    if not _can_access(user):
        raise HTTPException(
            status_code=403,
            detail="Patient Database access not granted. Ask a primary owner to enable it for your account.",
        )


def _require_export(user):
    if not _can_export(user):
        raise HTTPException(
            status_code=403,
            detail="Only primary owners can export the patient database.",
        )


# ─── Helpers ────────────────────────────────────────────────────────


IST_OFFSET = timedelta(hours=5, minutes=30)


def _normalize_phone(raw: Optional[str]) -> str:
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _month_bounds(month: str):
    """Return (start, end) UTC datetimes covering the given YYYY-MM
    in IST (so the filter aligns with how clinics think about months)."""
    try:
        y, m = month.split("-")
        yi = int(y)
        mi = int(m)
        if not (1 <= mi <= 12):
            raise ValueError
    except Exception:
        return None, None
    # First day of the month in IST midnight.
    start_ist = datetime(yi, mi, 1, 0, 0, 0)
    if mi == 12:
        end_ist = datetime(yi + 1, 1, 1, 0, 0, 0)
    else:
        end_ist = datetime(yi, mi + 1, 1, 0, 0, 0)
    # Convert IST → UTC by subtracting the IST offset.
    return (start_ist - IST_OFFSET, end_ist - IST_OFFSET)


def _build_search_filter(q: str) -> Dict[str, Any]:
    """Build a MongoDB filter from a free-text search query that
    matches name / phone / reg_no / email (case-insensitive)."""
    qs = (q or "").strip()
    if not qs:
        return {}
    safe = re.escape(qs)
    digits = re.sub(r"\D", "", qs)
    or_clauses: List[Dict[str, Any]] = [
        {"name": {"$regex": safe, "$options": "i"}},
        {"reg_no": {"$regex": safe, "$options": "i"}},
        {"email": {"$regex": safe, "$options": "i"}},
    ]
    if digits:
        # Match phone by suffix (handles +91 prefixed numbers stored as
        # last-10-digit normalised values).
        or_clauses.append({"phone": {"$regex": digits + "$"}})
    return {"$or": or_clauses}


# ─── List ────────────────────────────────────────────────────────────


@router.get("/api/patient-db/list")
async def list_patients(
    request: Request,
    q: str = "",
    month: str = "",
    gender: str = "",
    limit: int = 50,
    skip: int = 0,
    user=Depends(require_user),
):
    """Paginated patient list with multi-field search + month filter."""
    _require_access(user)
    limit = max(1, min(int(limit or 50), 200))
    skip = max(0, int(skip or 0))

    base: Dict[str, Any] = {"merged_into": {"$exists": False}}
    base.update(_build_search_filter(q))
    if month:
        start, end = _month_bounds(month)
        if start and end:
            base["first_seen_at"] = {"$gte": start, "$lt": end}
    if gender:
        base["gender"] = gender

    # Tenant scoping — primary_owner sees own clinic, super_owner sees
    # all if no header. patients collection is global at the moment but
    # the booking history is clinic-scoped so the count we surface for
    # each row uses tenant-filtered queries below.
    clinic_id = await resolve_clinic_id(request, user)

    total = await db.patients.count_documents(base)
    cursor = (
        db.patients.find(base, {"_id": 0})
        .sort("first_seen_at", -1)
        .skip(skip)
        .limit(limit)
    )
    rows: List[Dict[str, Any]] = []
    async for r in cursor:
        # Optional enrichment — last visit date + total visits in
        # this clinic. Cheap because we already filter by phone.
        phone = (r.get("phone") or "").strip()
        last_visit = None
        visit_count = 0
        if phone:
            tenant = tenant_filter(user, clinic_id, allow_global=True)
            # 2026-06-18 fix — `phone` can contain "+" (e.g. "+91…"),
            # which is an unanchored regex metacharacter. Always escape
            # the raw string AND prefer the canonical last-10-digit
            # suffix so we match every stored phone format uniformly.
            last10 = re.sub(r"\D", "", phone)[-10:]
            phone_pattern = re.escape(last10) + r"$" if len(last10) == 10 else re.escape(phone) + r"$"
            booking_q = {"patient_phone": {"$regex": phone_pattern}, **tenant}
            visit_count = await db.bookings.count_documents(booking_q)
            last = await db.bookings.find_one(
                booking_q, {"_id": 0, "booking_date": 1}, sort=[("booking_date", -1)]
            )
            if last:
                last_visit = last.get("booking_date")
        for k in ("first_seen_at", "updated_at", "email_attached_at"):
            if isinstance(r.get(k), datetime):
                r[k] = r[k].isoformat()
        rows.append(
            {
                **r,
                "last_visit": last_visit,
                "visit_count": visit_count,
            }
        )
    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "skip": skip,
        "can_export": _can_export(user),
    }


# ─── Detail ──────────────────────────────────────────────────────────
# NOTE: Defined AFTER /list, /export and /snapshot so the dynamic
# {phone} segment doesn't shadow those literal sub-paths. FastAPI
# matches routes in registration order, first-match-wins.


@router.get("/api/patient-db/by-phone/{phone}")
async def patient_detail(request: Request, phone: str, user=Depends(require_user)):
    """Full patient detail page payload — profile + consultation history
    (bookings, prescriptions, surgeries)."""
    _require_access(user)
    p = _normalize_phone(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    profile = await db.patients.find_one({"phone": p}, {"_id": 0})
    if not profile:
        # Auto-stub: derive a profile from the most recent booking with
        # this phone so the detail screen can still open even if the
        # `patients` row was never written (legacy data).
        any_b = await db.bookings.find_one(
            {"patient_phone": {"$regex": p + "$"}, **tenant},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        if not any_b:
            raise HTTPException(status_code=404, detail="Patient not found")
        profile = {
            "phone": p,
            "name": any_b.get("patient_name"),
            "reg_no": any_b.get("registration_no"),
            "age": any_b.get("patient_age"),
            "gender": any_b.get("patient_gender"),
            "first_seen_at": any_b.get("created_at"),
        }

    for k in ("first_seen_at", "updated_at", "email_attached_at"):
        if isinstance(profile.get(k), datetime):
            profile[k] = profile[k].isoformat()

    suffix = p
    # Phase D — prefer the canonical patient_id join (indexed) with a
    # phone-suffix fallback so legacy unstamped rows still appear.
    def _hist_q() -> Dict[str, Any]:
        ors: List[Dict[str, Any]] = [{"patient_phone": {"$regex": suffix + "$"}}]
        if profile.get("patient_id"):
            ors.append({"patient_id": profile["patient_id"]})
        return {"$or": ors, **tenant}

    bookings_q = _hist_q()
    rx_q = _hist_q()
    sx_q = _hist_q()

    bookings = []
    async for b in db.bookings.find(bookings_q, {"_id": 0}).sort("booking_date", -1).limit(50):
        for k in ("created_at", "updated_at"):
            if isinstance(b.get(k), datetime):
                b[k] = b[k].isoformat()
        bookings.append(b)

    rx = []
    async for r in db.prescriptions.find(rx_q, {"_id": 0}).sort("created_at", -1).limit(50):
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
        if isinstance(r.get("finalised_at"), datetime):
            r["finalised_at"] = r["finalised_at"].isoformat()
        rx.append(r)

    surgeries = []
    async for s in db.surgeries.find(sx_q, {"_id": 0}).sort("date", -1).limit(50):
        if isinstance(s.get("created_at"), datetime):
            s["created_at"] = s["created_at"].isoformat()
        surgeries.append(s)

    return {
        "profile": profile,
        "bookings": bookings,
        "prescriptions": rx,
        "surgeries": surgeries,
        "counts": {
            "bookings": len(bookings),
            "prescriptions": len(rx),
            "surgeries": len(surgeries),
        },
    }


# ─── Patient lookup moved to /app/backend/routers/patients.py ───
# (see lookup_patient there — supports phone OR registration_no and
# falls back to bookings / prescriptions / surgeries / receipts).



# ─── Export (CSV) ────────────────────────────────────────────────────


@router.get("/api/patient-db/export")
async def export_patients(
    request: Request,
    q: str = "",
    month: str = "",
    gender: str = "",
    user=Depends(require_user),
):
    """Stream a CSV containing the patient database (filtered by the
    same q / month / gender filters as the list endpoint).
    Restricted to primary_owner / super_owner. Excel happily opens
    UTF-8 CSV — for true XLSX we can layer openpyxl later."""
    _require_access(user)
    _require_export(user)

    base: Dict[str, Any] = {}
    base.update(_build_search_filter(q))
    if month:
        start, end = _month_bounds(month)
        if start and end:
            base["first_seen_at"] = {"$gte": start, "$lt": end}
    if gender:
        base["gender"] = gender

    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "Reg No",
            "Name",
            "Age",
            "Gender",
            "Phone",
            "Email",
            "Address",
            "First seen",
            "Last visit",
            "Visit count",
        ]
    )
    cursor = db.patients.find(base, {"_id": 0}).sort("first_seen_at", -1)
    async for r in cursor:
        phone = (r.get("phone") or "").strip()
        visit_count = 0
        last_visit = ""
        if phone:
            # Same regex-safety fix as in /list above — escape and
            # prefer the canonical last-10-digit suffix so we match
            # every stored phone format uniformly.
            last10 = re.sub(r"\D", "", phone)[-10:]
            phone_pattern = re.escape(last10) + r"$" if len(last10) == 10 else re.escape(phone) + r"$"
            booking_q = {"patient_phone": {"$regex": phone_pattern}, **tenant}
            visit_count = await db.bookings.count_documents(booking_q)
            last = await db.bookings.find_one(
                booking_q, {"_id": 0, "booking_date": 1}, sort=[("booking_date", -1)]
            )
            if last:
                last_visit = last.get("booking_date") or ""
        first_seen = r.get("first_seen_at")
        if isinstance(first_seen, datetime):
            first_seen = first_seen.strftime("%Y-%m-%d")
        elif isinstance(first_seen, str):
            first_seen = first_seen[:10]
        w.writerow(
            [
                r.get("reg_no") or "",
                r.get("name") or "",
                r.get("age") or "",
                r.get("gender") or "",
                phone,
                r.get("email") or "",
                r.get("address") or "",
                first_seen or "",
                last_visit,
                visit_count,
            ]
        )
    buf.seek(0)
    fname = f"consulturo-patients-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}.csv"

    def _iter():
        yield buf.getvalue()

    return StreamingResponse(
        _iter(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─── Monthly snapshot ────────────────────────────────────────────────


@router.post("/api/patient-db/snapshot")
async def trigger_snapshot(user=Depends(require_user)):
    """Run the monthly patient-DB snapshot job on demand. Restricted
    to primary_owner / super_owner. The snapshot freezes a copy of
    the current patient list into `patient_snapshots` keyed by
    YYYY-MM so historical month-end states can be audited later."""
    _require_export(user)
    today_ist = (datetime.now(timezone.utc) + IST_OFFSET).date()
    month_key = today_ist.strftime("%Y-%m")
    cursor = db.patients.find({}, {"_id": 0})
    items: List[Dict[str, Any]] = []
    async for r in cursor:
        for k in ("first_seen_at", "updated_at", "email_attached_at"):
            if isinstance(r.get(k), datetime):
                r[k] = r[k].isoformat()
        items.append(r)
    await db.patient_snapshots.update_one(
        {"month_key": month_key},
        {
            "$set": {
                "month_key": month_key,
                "snapshot_at": datetime.now(timezone.utc),
                "count": len(items),
                "items": items,
            }
        },
        upsert=True,
    )
    return {"ok": True, "month_key": month_key, "count": len(items)}


# ─── Permission toggle (primary_owner / super_owner only) ──────────


class PatientDbPermBody(BaseModel):
    allowed: bool


@router.post("/api/admin/users/{user_id}/patient-db-permission")
async def set_patient_db_permission(
    user_id: str,
    body: PatientDbPermBody,
    user=Depends(require_owner),
):
    """Owner-tier endpoint — primary_owner / super_owner can flip the
    `can_access_patient_db` flag on any team member (doctor, assistant,
    reception, nursing). Owners + partners are always permitted (the
    flag is a no-op for them)."""
    target = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_owner_or_partner(target):
        return {
            "ok": True,
            "user_id": user_id,
            "allowed": True,
            "note": "Owner / Partner is always permitted",
        }
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"can_access_patient_db": bool(body.allowed)}},
    )
    if target.get("email"):
        # Mirror to team_invites so the bit survives role changes via
        # the invite flow (same pattern as messaging-permission).
        await db.team_invites.update_one(
            {"email": target["email"].lower()},
            {"$set": {"can_access_patient_db": bool(body.allowed)}},
            upsert=False,
        )
    return {"ok": True, "user_id": user_id, "allowed": bool(body.allowed)}


@router.get("/api/admin/patient-db-permissions")
async def list_patient_db_permissions(user=Depends(require_owner)):
    """Return every staff member with their current
    `can_access_patient_db` status — used by the Permission Manager UI
    to render the toggle list.

    Source: union of db.users (registered) and db.team_invites
    (pending). Owners + Partners are surfaced too, but the UI keeps
    their toggle disabled (they're always permitted).
    """
    # 1. All non-patient registered users.
    user_rows = await db.users.find(
        {"role": {"$in": ["doctor", "assistant", "reception", "nursing", "partner", "owner"]}},
        {
            "_id": 0,
            "user_id": 1,
            "name": 1,
            "email": 1,
            "role": 1,
            "picture": 1,
            "can_access_patient_db": 1,
        },
    ).limit(500).to_list(length=500)

    # 2. Pending team invites (no user_id yet — surface email/role only).
    invite_rows = await db.team_invites.find(
        {"role": {"$in": ["doctor", "assistant", "reception", "nursing", "partner"]}},
        {
            "_id": 0,
            "email": 1,
            "name": 1,
            "role": 1,
            "can_access_patient_db": 1,
        },
    ).limit(500).to_list(length=500)

    # 3. Merge by lower-cased email — users[] wins if both sources
    # have the same email (registered > invited).
    by_email: Dict[str, Dict[str, Any]] = {}
    for u in user_rows:
        e = (u.get("email") or "").strip().lower()
        if not e:
            # Phone-only or anonymous — index by user_id.
            by_email[u.get("user_id") or f"_anon_{len(by_email)}"] = {
                **u,
                "registered": True,
            }
        else:
            by_email[e] = {**u, "registered": True}
    for inv in invite_rows:
        e = (inv.get("email") or "").strip().lower()
        if not e or e in by_email:
            continue
        by_email[e] = {
            "user_id": f"invite:{e}",
            "name": inv.get("name"),
            "email": inv.get("email"),
            "role": inv.get("role"),
            "picture": None,
            "can_access_patient_db": inv.get("can_access_patient_db"),
            "registered": False,
        }

    return {"items": list(by_email.values())}
