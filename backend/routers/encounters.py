"""ConsultUro — Phase E: Clinical Core.

Patient ENCOUNTERS (clinical notes) + DIAGNOSIS REGISTRY + AI dictation.

  · POST   /api/encounters                     create encounter (staff)
  · GET    /api/encounters                     paginated list (staff)
  · GET    /api/encounters/{encounter_id}      full detail (staff)
  · PATCH  /api/encounters/{encounter_id}      update (staff)
  · DELETE /api/encounters/{encounter_id}      delete (owner-tier or author)
  · POST   /api/encounters/{id}/link-rx        two-way link to a prescription
  · GET    /api/diagnoses                      registry typeahead (staff)
  · POST   /api/ai/encounter-dictation         audio → Whisper → Claude SOAP JSON

Design notes
  • Encounters are clinic-scoped (same tenancy rules as surgeries/Rx).
  • The diagnosis registry is auto-learned: every diagnosis saved on an
    encounter upserts into `diagnosis_registry` with a usage counter, so
    the typeahead ranks the clinic's most-used diagnoses first.
  • List responses are PROJECTED to summary fields only (SOAP bodies can
    be long) and paginated — never ship the full history in one payload.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel

from db import db
from auth_deps import require_staff, is_owner_or_partner
from services.tenancy import resolve_clinic_id, tenant_filter

router = APIRouter()

_LIST_PROJECTION = {
    "_id": 0,
    "encounter_id": 1,
    "patient_name": 1,
    "patient_phone": 1,
    "patient_age": 1,
    "patient_sex": 1,
    "chief_complaint": 1,
    "diagnoses": 1,
    "prescription_id": 1,
    "booking_id": 1,
    "patient_user_id": 1,
    "created_by_name": 1,
    "created_at": 1,
    "follow_up_date": 1,
    "follow_up_done_at": 1,
    "stage": 1,
    "payment_status": 1,
    "fee_amount": 1,
    "booking_date": 1,
    "booking_time": 1,
}


def _parse_follow_up(date_str: Optional[str]) -> tuple[Optional[str], Optional[datetime]]:
    """Normalise a 'YYYY-MM-DD' follow-up date to (clean_str, reminder_dt).
    The reminder fires at 09:00 IST (03:30 UTC) on that day."""
    s = (date_str or "").strip()[:10]
    if not s:
        return None, None
    try:
        y, m, d = (int(x) for x in s.split("-"))
        dt = datetime(y, m, d, 3, 30, 0, tzinfo=timezone.utc)  # 09:00 IST
        return s, dt
    except Exception:
        return None, None


class VitalsBody(BaseModel):
    bp: Optional[str] = None
    pulse: Optional[str] = None
    temp: Optional[str] = None
    spo2: Optional[str] = None
    weight: Optional[str] = None


# Intake sections that MIRROR the prescription (reception fills these; the
# doctor can edit): IPSS summary + per-modality investigation findings.
_INTAKE_STR_FIELDS = (
    "chief_complaint", "subjective", "objective", "assessment", "plan",
    "ipss", "investigation_findings",
    "inv_blood", "inv_psa", "inv_usg", "inv_uroflowmetry", "inv_ct", "inv_mri",
)


class EncounterBody(BaseModel):
    patient_name: str
    patient_phone: Optional[str] = ""
    patient_age: Optional[str] = ""
    patient_sex: Optional[str] = ""
    booking_id: Optional[str] = None
    patient_user_id: Optional[str] = None
    chief_complaint: Optional[str] = ""
    subjective: Optional[str] = ""
    objective: Optional[str] = ""
    assessment: Optional[str] = ""
    plan: Optional[str] = ""
    # IPSS summary (e.g. "12 / 35 (moderate)") — mirrors Rx `ipss_recent`.
    ipss: Optional[str] = ""
    # Investigation findings — split per modality (mirror the Rx fields).
    investigation_findings: Optional[str] = ""
    inv_blood: Optional[str] = ""
    inv_psa: Optional[str] = ""
    inv_usg: Optional[str] = ""
    inv_uroflowmetry: Optional[str] = ""
    inv_ct: Optional[str] = ""
    inv_mri: Optional[str] = ""
    vitals: Optional[VitalsBody] = None
    diagnoses: Optional[List[str]] = None
    follow_up_date: Optional[str] = None


class EncounterPatchBody(BaseModel):
    patient_name: Optional[str] = None
    patient_phone: Optional[str] = None
    patient_age: Optional[str] = None
    patient_sex: Optional[str] = None
    chief_complaint: Optional[str] = None
    subjective: Optional[str] = None
    objective: Optional[str] = None
    assessment: Optional[str] = None
    plan: Optional[str] = None
    ipss: Optional[str] = None
    investigation_findings: Optional[str] = None
    inv_blood: Optional[str] = None
    inv_psa: Optional[str] = None
    inv_usg: Optional[str] = None
    inv_uroflowmetry: Optional[str] = None
    inv_ct: Optional[str] = None
    inv_mri: Optional[str] = None
    vitals: Optional[VitalsBody] = None
    diagnoses: Optional[List[str]] = None
    follow_up_date: Optional[str] = None


class LinkRxBody(BaseModel):
    prescription_id: str


def _clean_diagnoses(raw: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    seen = set()
    for d in raw or []:
        label = " ".join(str(d or "").split()).strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label[:120])
    return out[:15]


async def _register_diagnoses(clinic_id: Optional[str], labels: List[str]) -> None:
    """Upsert each diagnosis into the clinic's registry (usage counter)."""
    now = datetime.now(timezone.utc)
    for label in labels:
        try:
            await db.diagnosis_registry.update_one(
                {"clinic_id": clinic_id, "label_lower": label.lower()},
                {
                    "$set": {"label": label, "updated_at": now},
                    "$inc": {"usage_count": 1},
                    "$setOnInsert": {"clinic_id": clinic_id, "created_at": now},
                },
                upsert=True,
            )
        except Exception:
            pass  # registry is best-effort — never block the encounter save


@router.post("/api/encounters")
async def create_encounter(request: Request, body: EncounterBody, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    if not (body.patient_name or "").strip():
        raise HTTPException(400, detail="Patient name is required")
    clinic_id = await resolve_clinic_id(request, user)
    diagnoses = _clean_diagnoses(body.diagnoses)
    now = datetime.now(timezone.utc)
    fu_str, fu_at = _parse_follow_up(body.follow_up_date)
    # If created from a confirmed booking, capture its slot for the worklist.
    booking_date = None
    booking_time = None
    if body.booking_id:
        bk = await db.bookings.find_one(
            {"booking_id": body.booking_id},
            {"_id": 0, "booking_date": 1, "booking_time": 1},
        )
        if bk:
            booking_date = bk.get("booking_date")
            booking_time = bk.get("booking_time")
    doc: Dict[str, Any] = {
        "encounter_id": f"enc_{uuid.uuid4().hex[:12]}",
        "clinic_id": clinic_id,
        "patient_name": body.patient_name.strip(),
        "patient_phone": (body.patient_phone or "").strip(),
        "patient_age": (body.patient_age or "").strip(),
        "patient_sex": (body.patient_sex or "").strip(),
        "booking_id": body.booking_id or None,
        "booking_date": booking_date,
        "booking_time": booking_time,
        "patient_user_id": body.patient_user_id or None,
        "chief_complaint": (body.chief_complaint or "").strip(),
        "subjective": (body.subjective or "").strip(),
        "objective": (body.objective or "").strip(),
        "assessment": (body.assessment or "").strip(),
        "plan": (body.plan or "").strip(),
        "ipss": (body.ipss or "").strip(),
        "investigation_findings": (body.investigation_findings or "").strip(),
        "inv_blood": (body.inv_blood or "").strip(),
        "inv_psa": (body.inv_psa or "").strip(),
        "inv_usg": (body.inv_usg or "").strip(),
        "inv_uroflowmetry": (body.inv_uroflowmetry or "").strip(),
        "inv_ct": (body.inv_ct or "").strip(),
        "inv_mri": (body.inv_mri or "").strip(),
        "vitals": body.vitals.dict() if body.vitals else {},
        "diagnoses": diagnoses,
        "follow_up_date": fu_str,
        "follow_up_at": fu_at,
        "follow_up_notified": False,
        "prescription_id": None,
        # Lifecycle: open (intake) → in_consultation → completed.
        "stage": "open",
        # Billing: pending → paid (receipt covers fee) | waived (doctor).
        "payment_status": "pending",
        "fee_amount": None,
        "created_by": user.get("user_id"),
        "created_by_name": user.get("name") or user.get("email") or "",
        "created_at": now,
        "updated_at": now,
    }
    await db.encounters.insert_one(doc)
    await _register_diagnoses(clinic_id, diagnoses)
    doc.pop("_id", None)
    return doc


@router.get("/api/encounters")
async def list_encounters(
    request: Request,
    user=Depends(require_staff),
    limit: int = 50,
    skip: int = 0,
    q: str = "",
    patient_phone: str = "",
    booking_id: str = "",
    patient_user_id: str = "",
):
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if booking_id.strip():
        filt["booking_id"] = booking_id.strip()
    if patient_user_id.strip():
        filt["patient_user_id"] = patient_user_id.strip()
    if patient_phone.strip():
        digits = "".join(ch for ch in patient_phone if ch.isdigit())[-10:]
        if digits:
            filt["patient_phone"] = {"$regex": f"{digits}$"}
    if q.strip():
        import re as _re
        rx = {"$regex": _re.escape(q.strip()), "$options": "i"}
        filt["$or"] = [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"chief_complaint": rx},
            {"diagnoses": rx},
        ]
    limit = max(1, min(int(limit or 50), 200))
    skip = max(0, int(skip or 0))
    total = await db.encounters.count_documents(filt)
    items = await (
        db.encounters.find(filt, _LIST_PROJECTION)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": items, "total": total, "has_more": skip + len(items) < total}


async def _clinic_consultation_fee(clinic_id: Optional[str]) -> float:
    """Default consultation fee for the clinic (falls back to platform default)."""
    settings_id = clinic_id or "default"
    doc = await db.clinic_settings.find_one({"_id": settings_id}, {"_id": 0, "consultation_fee_inr": 1})
    if not doc and settings_id != "default":
        doc = await db.clinic_settings.find_one({"_id": "default"}, {"_id": 0, "consultation_fee_inr": 1})
    try:
        return float((doc or {}).get("consultation_fee_inr") or 500)
    except Exception:
        return 500.0


@router.get("/api/encounters/worklist")
async def encounter_worklist(
    request: Request,
    user=Depends(require_staff),
    date: str = "",
    scope: str = "all",
):
    """Unified reception worklist: confirmed bookings that have NOT started
    an encounter yet (stage='to_start') MERGED with real encounters
    (open / in_consultation / completed). Clinic-scoped, newest slot first.

    scope: all | to_start | open | in_consultation | completed
    date : optional YYYY-MM-DD — restrict bookings to that slot day and
           encounters created that IST day. Empty = today onwards / recent.
    """
    from datetime import timedelta as _td
    clinic_id = await resolve_clinic_id(request, user)
    ist_now = datetime.now(timezone.utc) + _td(hours=5, minutes=30)
    today = ist_now.strftime("%Y-%m-%d")
    day = (date or "").strip()[:10]

    rows: List[Dict[str, Any]] = []

    # ── Real encounters (open / in_consultation / completed) ──────────
    enc_filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if day:
        # Encounters whose booking slot is that day OR created that day.
        enc_filt["$or"] = [
            {"booking_date": day},
            {"created_at": {"$gte": datetime(*(int(x) for x in day.split("-")), tzinfo=timezone.utc)}},
        ]
    enc_items = await (
        db.encounters.find(enc_filt, _LIST_PROJECTION)
        .sort("created_at", -1)
        .limit(300)
        .to_list(length=300)
    )
    started_booking_ids = set()
    for e in enc_items:
        if e.get("booking_id"):
            started_booking_ids.add(e["booking_id"])
        rows.append({
            "kind": "encounter",
            "stage": e.get("stage") or "open",
            "encounter_id": e.get("encounter_id"),
            "booking_id": e.get("booking_id"),
            "patient_name": e.get("patient_name"),
            "patient_phone": e.get("patient_phone"),
            "patient_age": e.get("patient_age"),
            "patient_sex": e.get("patient_sex"),
            "chief_complaint": e.get("chief_complaint"),
            "payment_status": e.get("payment_status") or "pending",
            "fee_amount": e.get("fee_amount"),
            "prescription_id": e.get("prescription_id"),
            "booking_date": e.get("booking_date"),
            "booking_time": e.get("booking_time"),
            "created_at": e.get("created_at"),
        })

    # ── Confirmed bookings without an encounter yet → 'to_start' ──────
    bk_filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    bk_filt["status"] = "confirmed"
    if day:
        bk_filt["booking_date"] = day
    else:
        bk_filt["booking_date"] = {"$gte": today}
    bookings = await (
        db.bookings.find(
            bk_filt,
            {"_id": 0, "booking_id": 1, "patient_name": 1, "patient_phone": 1,
             "patient_age": 1, "patient_gender": 1, "reason": 1,
             "booking_date": 1, "booking_time": 1, "patient_user_id": 1,
             "draft_rx_id": 1},
        )
        .sort("booking_date", 1)
        .limit(300)
        .to_list(length=300)
    )
    for b in bookings:
        if b.get("booking_id") in started_booking_ids:
            continue  # already has an encounter — shown above
        rows.append({
            "kind": "booking",
            "stage": "to_start",
            "encounter_id": None,
            "booking_id": b.get("booking_id"),
            "patient_name": b.get("patient_name"),
            "patient_phone": b.get("patient_phone"),
            "patient_age": str(b.get("patient_age") or ""),
            "patient_sex": b.get("patient_gender") or "",
            "chief_complaint": b.get("reason") or "",
            "payment_status": None,
            "fee_amount": None,
            "prescription_id": None,
            "booking_date": b.get("booking_date"),
            "booking_time": b.get("booking_time"),
            "patient_user_id": b.get("patient_user_id"),
        })

    counts: Dict[str, int] = {"to_start": 0, "open": 0, "in_consultation": 0, "completed": 0}
    for r in rows:
        st = r.get("stage")
        if st in counts:
            counts[st] += 1

    if scope and scope != "all":
        rows = [r for r in rows if r.get("stage") == scope]

    return {
        "items": rows,
        "today": today,
        "date": day or today,
        "count": len(rows),
        "counts": counts,
    }


def _ist_day_bounds_utc(day: str):
    """UTC [start, end) for an IST calendar day 'YYYY-MM-DD'."""
    from datetime import timedelta as _td
    y, m, d = (int(x) for x in day.split("-"))
    ist_midnight = datetime(y, m, d, tzinfo=timezone.utc)
    start = ist_midnight - _td(hours=5, minutes=30)
    return start, start + _td(days=1)


@router.get("/api/encounters/collection-summary")
async def collection_summary(request: Request, user=Depends(require_staff), date: str = ""):
    """Day-end billing summary across the day's encounters:
    collected (₹ received) vs pending dues vs waived, with a list of the
    unpaid encounters so reception can follow up before closing the day."""
    from datetime import timedelta as _td
    clinic_id = await resolve_clinic_id(request, user)
    ist_now = datetime.now(timezone.utc) + _td(hours=5, minutes=30)
    day = (date or "").strip()[:10] or ist_now.strftime("%Y-%m-%d")
    start_utc, end_utc = _ist_day_bounds_utc(day)

    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["$or"] = [
        {"booking_date": day},
        {"created_at": {"$gte": start_utc, "$lt": end_utc}},
    ]
    encs = await db.encounters.find(
        filt,
        {"_id": 0, "encounter_id": 1, "patient_name": 1, "patient_phone": 1,
         "payment_status": 1, "fee_amount": 1, "stage": 1, "booking_time": 1},
    ).sort("booking_time", 1).limit(500).to_list(length=500)

    enc_ids = [e["encounter_id"] for e in encs]
    receipts = []
    if enc_ids:
        receipts = await db.receipts.find(
            {"encounter_id": {"$in": enc_ids}}, {"_id": 0, "encounter_id": 1, "paid": 1}
        ).to_list(length=1000)
    paid_by_enc: Dict[str, float] = {}
    for r in receipts:
        paid_by_enc[r["encounter_id"]] = paid_by_enc.get(r["encounter_id"], 0.0) + float(r.get("paid") or 0)

    collected = 0.0
    pending_due = 0.0
    waived_total = 0.0
    counts = {"paid": 0, "pending": 0, "waived": 0, "total": len(encs)}
    pending_list: List[Dict[str, Any]] = []
    for e in encs:
        st = e.get("payment_status") or "pending"
        fee = float(e.get("fee_amount") or 0)
        collected += paid_by_enc.get(e["encounter_id"], 0.0)
        if st == "waived":
            waived_total += fee
            counts["waived"] += 1
        elif st == "paid":
            counts["paid"] += 1
        else:
            # Only count as a "due" once a consultation fee has been stamped.
            if fee > 0:
                pending_due += fee
                pending_list.append({
                    "encounter_id": e["encounter_id"],
                    "patient_name": e.get("patient_name"),
                    "patient_phone": e.get("patient_phone"),
                    "fee_amount": fee,
                    "booking_time": e.get("booking_time"),
                    "stage": e.get("stage"),
                })
            counts["pending"] += 1

    return {
        "date": day,
        "collected": round(collected, 2),
        "pending_due": round(pending_due, 2),
        "waived_total": round(waived_total, 2),
        "counts": counts,
        "pending_list": pending_list,
        "drawer": await _drawer_by_mode(user, clinic_id, day),
    }


def _norm_mode(mode: str) -> str:
    """Collapse the many stored receipt modes into drawer buckets."""
    m = (mode or "").lower()
    if "cash" in m: return "Cash"
    if "upi" in m: return "UPI"
    if "card" in m: return "Card"
    if "wallet" in m: return "Wallet"
    if "cheque" in m or "check" in m: return "Cheque"
    return "Other"


async def _drawer_by_mode(user: Dict[str, Any], clinic_id: Optional[str], day: str) -> Dict[str, Any]:
    """True daily drawer = ALL receipts dated `day` (clinic-scoped) split by
    payment mode, so reception can reconcile Cash / UPI / Card etc."""
    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["receipt_date"] = day
    receipts = await db.receipts.find(
        filt, {"_id": 0, "paid": 1, "mode": 1}
    ).to_list(length=2000)
    buckets: Dict[str, Dict[str, float]] = {}
    total = 0.0
    for r in receipts:
        b = _norm_mode(r.get("mode"))
        paid = float(r.get("paid") or 0)
        buckets.setdefault(b, {"amount": 0.0, "count": 0})
        buckets[b]["amount"] += paid
        buckets[b]["count"] += 1
        total += paid
    order = ["Cash", "UPI", "Card", "Wallet", "Cheque", "Other"]
    modes = [
        {"mode": k, "amount": round(buckets[k]["amount"], 2), "count": int(buckets[k]["count"])}
        for k in order if k in buckets and buckets[k]["amount"] > 0
    ]
    return {"total": round(total, 2), "modes": modes}


@router.get("/api/encounters/pending-dues")
async def pending_dues(request: Request, user=Depends(require_staff), days: int = 7):
    """Encounters with a stamped fee still unpaid (payment_status='pending')
    over the last `days` days — the day-end follow-up list for reception."""
    from datetime import timedelta as _td
    clinic_id = await resolve_clinic_id(request, user)
    since = datetime.now(timezone.utc) - _td(days=max(1, min(days, 90)))
    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["payment_status"] = "pending"
    filt["fee_amount"] = {"$gt": 0}
    filt["created_at"] = {"$gte": since}
    rows = await db.encounters.find(
        filt,
        {"_id": 0, "encounter_id": 1, "patient_name": 1, "patient_phone": 1,
         "fee_amount": 1, "stage": 1, "booking_date": 1, "booking_time": 1, "created_at": 1},
    ).sort("created_at", -1).limit(200).to_list(length=200)
    total_due = sum(float(r.get("fee_amount") or 0) for r in rows)
    return {"items": rows, "count": len(rows), "total_due": round(total_due, 2)}


@router.get("/api/encounters/revenue-report")
async def revenue_report(request: Request, user=Depends(require_staff), month: str = ""):
    """Owner month view: collected vs waived vs outstanding across the
    month's encounters, with a per-day series. Owner-tier only."""
    from datetime import timedelta as _td
    OWNER_ROLES = {"super_owner", "primary_owner", "owner", "partner"}
    if str(user.get("role") or "") not in OWNER_ROLES:
        raise HTTPException(403, detail="Owner access required.")
    clinic_id = await resolve_clinic_id(request, user)
    ist_now = datetime.now(timezone.utc) + _td(hours=5, minutes=30)
    mon = (month or "").strip()[:7] or ist_now.strftime("%Y-%m")
    y, m = (int(x) for x in mon.split("-"))
    first = f"{mon}-01"
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    nxt = f"{ny:04d}-{nm:02d}-01"
    start_utc, _ = _ist_day_bounds_utc(first)
    end_utc, _ = _ist_day_bounds_utc(nxt)

    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["$or"] = [
        {"booking_date": {"$gte": first, "$lt": nxt}},
        {"created_at": {"$gte": start_utc, "$lt": end_utc}},
    ]
    encs = await db.encounters.find(
        filt,
        {"_id": 0, "encounter_id": 1, "payment_status": 1, "fee_amount": 1,
         "booking_date": 1, "created_at": 1},
    ).limit(5000).to_list(length=5000)

    enc_ids = [e["encounter_id"] for e in encs]
    paid_by_enc: Dict[str, float] = {}
    if enc_ids:
        rs = await db.receipts.find(
            {"encounter_id": {"$in": enc_ids}}, {"_id": 0, "encounter_id": 1, "paid": 1}
        ).to_list(length=10000)
        for r in rs:
            paid_by_enc[r["encounter_id"]] = paid_by_enc.get(r["encounter_id"], 0.0) + float(r.get("paid") or 0)

    collected = waived = outstanding = 0.0
    counts = {"total": len(encs), "paid": 0, "pending": 0, "waived": 0}
    series: Dict[str, Dict[str, float]] = {}

    def day_of(e):
        if e.get("booking_date"):
            return e["booking_date"][:10]
        ca = e.get("created_at")
        if isinstance(ca, datetime):
            return (ca + _td(hours=5, minutes=30)).strftime("%Y-%m-%d")
        return mon + "-01"

    for e in encs:
        st = e.get("payment_status") or "pending"
        fee = float(e.get("fee_amount") or 0)
        d = day_of(e)
        s = series.setdefault(d, {"collected": 0.0, "waived": 0.0, "outstanding": 0.0})
        c = paid_by_enc.get(e["encounter_id"], 0.0)
        collected += c
        s["collected"] += c
        if st == "waived":
            waived += fee; s["waived"] += fee; counts["waived"] += 1
        elif st == "paid":
            counts["paid"] += 1
        else:
            if fee > 0:
                outstanding += fee; s["outstanding"] += fee
            counts["pending"] += 1

    day_series = [
        {"day": k, "collected": round(v["collected"], 2), "waived": round(v["waived"], 2), "outstanding": round(v["outstanding"], 2)}
        for k, v in sorted(series.items())
    ]
    return {
        "month": mon,
        "collected": round(collected, 2),
        "waived_total": round(waived, 2),
        "outstanding": round(outstanding, 2),
        "counts": counts,
        "series": day_series,
    }


@router.get("/api/encounters/patient-timeline")
async def patient_timeline(request: Request, user=Depends(require_staff), phone: str = "", encounter_id: str = ""):
    """A patient's full history on one screen — every encounter (visit) and
    every receipt, newest first — for reception traceability."""
    clinic_id = await resolve_clinic_id(request, user)
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())[-10:]
    if not digits and encounter_id:
        enc = await _scoped_find(request, user, encounter_id, {"_id": 0, "patient_phone": 1})
        digits = "".join(ch for ch in ((enc or {}).get("patient_phone") or "") if ch.isdigit())[-10:]
    if not digits:
        return {"phone": "", "visits": [], "receipts": []}
    efilt = tenant_filter(user, clinic_id, allow_global=True)
    efilt["patient_phone"] = {"$regex": digits + "$"}
    visits = await db.encounters.find(
        efilt,
        {"_id": 0, "encounter_id": 1, "patient_name": 1, "chief_complaint": 1,
         "stage": 1, "payment_status": 1, "fee_amount": 1, "prescription_id": 1,
         "booking_date": 1, "booking_time": 1, "created_at": 1},
    ).sort("created_at", -1).limit(100).to_list(length=100)
    rfilt = tenant_filter(user, clinic_id, allow_global=True)
    rfilt["patient_phone"] = digits
    receipts = await db.receipts.find(
        rfilt,
        {"_id": 0, "receipt_id": 1, "receipt_no": 1, "total": 1, "paid": 1,
         "balance": 1, "mode": 1, "receipt_date": 1, "encounter_id": 1, "created_at": 1},
    ).sort("created_at", -1).limit(100).to_list(length=100)
    return {"phone": digits, "visits": visits, "receipts": receipts}


async def _scoped_find(request: Request, user: Dict[str, Any], encounter_id: str,
                       projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Fetch an encounter WITH the same tenant scoping as the list
    endpoint — staff can only touch encounters of their own clinic."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    filt["encounter_id"] = encounter_id
    return await db.encounters.find_one(filt, projection or {"_id": 0})


@router.get("/api/encounters/followups")
async def list_followups(
    request: Request,
    user=Depends(require_staff),
    scope: str = "upcoming",
    limit: int = 100,
):
    """Follow-ups. scope='today' → only today's (IST); 'upcoming' →
    today onward (default); 'done' → completed follow-ups (newest first).
    Clinic-scoped."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    # Today's date in IST.
    from datetime import timedelta as _td
    ist_now = datetime.now(timezone.utc) + _td(hours=5, minutes=30)
    today = ist_now.strftime("%Y-%m-%d")
    limit = max(1, min(int(limit or 100), 300))
    proj = dict(_LIST_PROJECTION)
    if scope == "done":
        filt["follow_up_done"] = True
        items = await (
            db.encounters.find(filt, proj)
            .sort("follow_up_done_at", -1)
            .limit(limit)
            .to_list(length=limit)
        )
        return {"items": items, "today": today, "count": len(items)}

    filt["follow_up_done"] = {"$ne": True}
    if scope == "today":
        filt["follow_up_date"] = today
    elif scope == "overdue":
        # Past-due follow-ups that were never completed. Oldest first so
        # the most-overdue patients surface at the top.
        filt["follow_up_date"] = {"$lt": today, "$ne": None}
        items = await (
            db.encounters.find(filt, proj)
            .sort("follow_up_date", 1)
            .limit(limit)
            .to_list(length=limit)
        )
        return {"items": items, "today": today, "count": len(items)}
    else:
        filt["follow_up_date"] = {"$gte": today}
    items = await (
        db.encounters.find(filt, proj)
        .sort("follow_up_date", 1)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": items, "today": today, "count": len(items)}


@router.post("/api/encounters/{encounter_id}/followup/done")
async def complete_followup(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Mark a follow-up complete — it drops off the Follow-ups list but
    the encounter itself is retained (nothing is deleted)."""
    clinic_id = await resolve_clinic_id(request, user)
    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["encounter_id"] = encounter_id
    existing = await db.encounters.find_one(filt, {"_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Encounter not found")
    await db.encounters.update_one(
        {"_id": existing["_id"]},
        {"$set": {
            "follow_up_done": True,
            "follow_up_done_at": datetime.now(timezone.utc),
            "follow_up_notified": True,  # suppress any pending reminder
        }},
    )
    return {"ok": True, "encounter_id": encounter_id, "follow_up_done": True}


@router.post("/api/encounters/{encounter_id}/followup/reopen")
async def reopen_followup(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Re-open a completed follow-up so it returns to the active list."""
    clinic_id = await resolve_clinic_id(request, user)
    filt = tenant_filter(user, clinic_id, allow_global=True)
    filt["encounter_id"] = encounter_id
    existing = await db.encounters.find_one(filt, {"_id": 1, "follow_up_at": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Encounter not found")
    # Re-arm the reminder only if the follow-up date is still in the future.
    fu_at = existing.get("follow_up_at")
    if getattr(fu_at, "tzinfo", None) is None and fu_at is not None:
        fu_at = fu_at.replace(tzinfo=timezone.utc)
    still_pending = bool(fu_at and fu_at > datetime.now(timezone.utc))
    await db.encounters.update_one(
        {"_id": existing["_id"]},
        {"$set": {"follow_up_done": False, "follow_up_notified": not still_pending},
         "$unset": {"follow_up_done_at": ""}},
    )
    return {"ok": True, "encounter_id": encounter_id, "follow_up_done": False}


async def scan_and_fire_encounter_followups(now: datetime) -> None:
    """Notify the encounter's provider on the morning of the follow-up
    day. Fired from the server 60s reminder loop."""
    cursor = db.encounters.find({
        "follow_up_at": {"$lte": now},
        "follow_up_notified": {"$ne": True},
    }).limit(100)
    async for enc in cursor:
        try:
            from server import create_notification
            name = (enc.get("patient_name") or "Patient").strip()
            provider = enc.get("created_by")
            if provider:
                await create_notification(
                    user_id=provider,
                    title=f"📅 Follow-up today: {name}",
                    body=(enc.get("chief_complaint") or "Scheduled follow-up visit.")[:140],
                    kind="encounter_followup",
                    data={"type": "encounter_followup", "encounter_id": enc.get("encounter_id")},
                    push=True,
                )
            await db.encounters.update_one(
                {"_id": enc["_id"]},
                {"$set": {"follow_up_notified": True, "follow_up_notified_at": now}},
            )
        except Exception:
            pass


@router.get("/api/encounters/{encounter_id}")
async def get_encounter(request: Request, encounter_id: str, user=Depends(require_staff)):
    doc = await _scoped_find(request, user, encounter_id)
    if not doc:
        raise HTTPException(404, detail="Encounter not found")
    return doc


@router.patch("/api/encounters/{encounter_id}")
async def update_encounter(
    request: Request, encounter_id: str, body: EncounterPatchBody, user=Depends(require_staff),
):
    from server import block_if_demo
    block_if_demo(user)
    existing = await _scoped_find(request, user, encounter_id, {"_id": 0, "clinic_id": 1})
    if not existing:
        raise HTTPException(404, detail="Encounter not found")
    updates: Dict[str, Any] = {}
    for field in (
        "patient_name", "patient_phone", "patient_age", "patient_sex",
        "chief_complaint", "subjective", "objective", "assessment", "plan",
        "ipss", "investigation_findings",
        "inv_blood", "inv_psa", "inv_usg", "inv_uroflowmetry", "inv_ct", "inv_mri",
    ):
        val = getattr(body, field)
        if val is not None:
            updates[field] = str(val).strip()
    if body.vitals is not None:
        updates["vitals"] = body.vitals.dict()
    if body.diagnoses is not None:
        diagnoses = _clean_diagnoses(body.diagnoses)
        updates["diagnoses"] = diagnoses
        await _register_diagnoses(existing.get("clinic_id"), diagnoses)
    if body.follow_up_date is not None:
        fu_str, fu_at = _parse_follow_up(body.follow_up_date)
        updates["follow_up_date"] = fu_str
        updates["follow_up_at"] = fu_at
        # Changing/clearing the date re-arms the reminder and re-opens a
        # previously-completed follow-up.
        updates["follow_up_notified"] = False
        updates["follow_up_done"] = False
    if not updates:
        raise HTTPException(400, detail="Nothing to update")
    updates["updated_at"] = datetime.now(timezone.utc)
    await db.encounters.update_one({"encounter_id": encounter_id}, {"$set": updates})
    return await db.encounters.find_one({"encounter_id": encounter_id}, {"_id": 0})


@router.delete("/api/encounters/{encounter_id}")
async def delete_encounter(request: Request, encounter_id: str, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    doc = await _scoped_find(request, user, encounter_id, {"_id": 0, "created_by": 1})
    if not doc:
        raise HTTPException(404, detail="Encounter not found")
    if not is_owner_or_partner(user) and doc.get("created_by") != user.get("user_id"):
        raise HTTPException(403, detail="Only the author or an owner can delete this encounter.")
    await db.encounters.delete_one({"encounter_id": encounter_id})
    return {"ok": True}


@router.post("/api/encounters/{encounter_id}/link-rx")
async def link_encounter_rx(request: Request, encounter_id: str, body: LinkRxBody, user=Depends(require_staff)):
    from server import block_if_demo
    block_if_demo(user)
    enc = await _scoped_find(request, user, encounter_id, {"_id": 0, "encounter_id": 1})
    if not enc:
        raise HTTPException(404, detail="Encounter not found")
    rx = await db.prescriptions.find_one({"prescription_id": body.prescription_id}, {"_id": 0, "prescription_id": 1})
    if not rx:
        raise HTTPException(404, detail="Prescription not found")
    now = datetime.now(timezone.utc)
    await db.encounters.update_one(
        {"encounter_id": encounter_id},
        {"$set": {"prescription_id": body.prescription_id, "updated_at": now}},
    )
    await db.prescriptions.update_one(
        {"prescription_id": body.prescription_id},
        {"$set": {"encounter_id": encounter_id}},
    )
    return {"ok": True, "encounter_id": encounter_id, "prescription_id": body.prescription_id}


# ── Encounter lifecycle: start consultation / complete / payment ──────

async def recompute_encounter_payment(encounter_id: str) -> str:
    """Derive an encounter's payment_status from its linked receipts.
    'waived' is a doctor override and is never auto-cleared here."""
    enc = await db.encounters.find_one(
        {"encounter_id": encounter_id},
        {"_id": 0, "payment_status": 1, "fee_amount": 1},
    )
    if not enc:
        return "pending"
    if (enc.get("payment_status") or "") == "waived":
        return "waived"
    receipts = await db.receipts.find(
        {"encounter_id": encounter_id}, {"_id": 0, "paid": 1, "total": 1}
    ).to_list(length=100)
    paid_sum = sum(float(r.get("paid") or 0) for r in receipts)
    fee = float(enc.get("fee_amount") or 0)
    status = "pending"
    if receipts and paid_sum >= (fee if fee > 0 else 0.01) and paid_sum > 0:
        status = "paid"
    await db.encounters.update_one(
        {"encounter_id": encounter_id},
        {"$set": {"payment_status": status, "updated_at": datetime.now(timezone.utc)}},
    )
    return status


async def mark_encounter_completed(prescription_id: str, encounter_id: Optional[str]) -> None:
    """Called from the prescriptions router when an Rx is FINALISED.
    Links the Rx and moves the encounter to `completed`. Best-effort."""
    if not encounter_id:
        return
    try:
        await db.encounters.update_one(
            {"encounter_id": encounter_id},
            {"$set": {
                "stage": "completed",
                "prescription_id": prescription_id,
                "completed_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }},
        )
    except Exception:
        pass


@router.post("/api/encounters/{encounter_id}/start-consultation")
async def start_consultation(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Move an encounter into `in_consultation` and stamp the default
    consultation fee (so reception can collect it). Idempotent."""
    from server import block_if_demo
    block_if_demo(user)
    enc = await _scoped_find(request, user, encounter_id,
                             {"_id": 0, "clinic_id": 1, "stage": 1, "fee_amount": 1})
    if not enc:
        raise HTTPException(404, detail="Encounter not found")
    updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc)}
    if (enc.get("stage") or "open") == "open":
        updates["stage"] = "in_consultation"
        updates["consultation_started_at"] = datetime.now(timezone.utc)
    if enc.get("fee_amount") in (None, "", 0):
        updates["fee_amount"] = await _clinic_consultation_fee(enc.get("clinic_id"))
    await db.encounters.update_one({"encounter_id": encounter_id}, {"$set": updates})
    return await db.encounters.find_one({"encounter_id": encounter_id}, {"_id": 0})


@router.post("/api/encounters/{encounter_id}/waive")
async def waive_encounter_fee(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Waive the consultation charge — PRESCRIBER (doctor/owner) only.
    Reception can see the resulting badge but cannot change it."""
    from server import block_if_demo
    from auth_deps import is_prescriber
    block_if_demo(user)
    if not await is_prescriber(user):
        raise HTTPException(403, detail="Only a doctor can waive charges.")
    enc = await _scoped_find(request, user, encounter_id, {"_id": 0, "encounter_id": 1})
    if not enc:
        raise HTTPException(404, detail="Encounter not found")
    now = datetime.now(timezone.utc)
    await db.encounters.update_one(
        {"encounter_id": encounter_id},
        {"$set": {
            "payment_status": "waived",
            "waived_by": user.get("user_id"),
            "waived_by_name": user.get("name") or user.get("email") or "Doctor",
            "waived_at": now,
            "updated_at": now,
        }},
    )
    return {"ok": True, "encounter_id": encounter_id, "payment_status": "waived"}


@router.get("/api/encounters/{encounter_id}/billing")
async def encounter_billing(encounter_id: str, request: Request, user=Depends(require_staff)):
    """Billing summary for one encounter: fee, receipts linked to it, and
    the patient's full receipt history (for reception traceability)."""
    enc = await _scoped_find(
        request, user, encounter_id,
        {"_id": 0, "encounter_id": 1, "patient_phone": 1, "patient_name": 1,
         "fee_amount": 1, "payment_status": 1},
    )
    if not enc:
        raise HTTPException(404, detail="Encounter not found")
    linked = await db.receipts.find(
        {"encounter_id": encounter_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(length=100)
    history: List[Dict[str, Any]] = []
    phone = (enc.get("patient_phone") or "")
    digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
    if digits:
        clinic_id = await resolve_clinic_id(request, user)
        hfilt = tenant_filter(user, clinic_id, allow_global=True)
        hfilt["patient_phone"] = digits
        history = await db.receipts.find(hfilt, {"_id": 0}).sort("created_at", -1).limit(50).to_list(length=50)
    return {
        "encounter_id": encounter_id,
        "fee_amount": enc.get("fee_amount"),
        "payment_status": enc.get("payment_status") or "pending",
        "linked_receipts": linked,
        "patient_history": history,
    }


@router.get("/api/diagnoses")
async def list_diagnoses(request: Request, user=Depends(require_staff), q: str = "", limit: int = 20):
    """Typeahead over the clinic's learned diagnosis registry — most
    used first."""
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if q.strip():
        import re as _re
        filt["label_lower"] = {"$regex": _re.escape(q.strip().lower())}
    limit = max(1, min(int(limit or 20), 50))
    rows = await (
        db.diagnosis_registry.find(filt, {"_id": 0, "label": 1, "usage_count": 1})
        .sort("usage_count", -1)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"items": rows}


# ── AI dictation → structured SOAP note ──────────────────────────────

_ENCOUNTER_SYSTEM = """You are an expert medical scribe for an Indian urology clinic.
The doctor dictates a clinical encounter note out loud. Convert the spoken
transcript into structured JSON the EMR can apply directly.

Output a SINGLE JSON object — NO prose, NO markdown — with this exact shape:

{
  "chief_complaint": "one line — why the patient came",
  "subjective": "history / symptoms in the patient's words",
  "objective": "examination findings, vitals mentioned",
  "assessment": "clinical impression / differential",
  "plan": "management plan, investigations, medications, follow-up",
  "diagnoses": ["Diagnosis 1", "Diagnosis 2"]
}

Rules:
• If a section isn't mentioned, return an empty string (empty array for diagnoses).
• diagnoses: short standard labels (e.g. "BPH", "Renal calculus left", "UTI").
• Preserve clinical terms exactly as dictated. NEVER invent findings.
• Output JSON only — no preamble, no explanation.
"""


@router.post("/api/ai/encounter-dictation")
async def encounter_dictation(
    audio: UploadFile = File(...),
    language: str = Form("en"),
    user=Depends(require_staff),
):
    """Transcribe dictated audio and structure it into SOAP-note JSON.
    Same two-stage pipeline as /api/ai/voice-to-rx (Whisper → Claude)."""
    from server import block_if_demo
    block_if_demo(user)
    from routers.wave3 import _claude_one_shot, _extract_json, _llm_key

    raw = await audio.read()
    if not raw:
        raise HTTPException(400, detail="Empty audio file")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, detail="Audio exceeds 25 MB limit (Whisper cap)")

    suffix = (audio.filename or "audio.m4a").rsplit(".", 1)[-1].lower() or "m4a"
    if suffix not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
        suffix = "m4a"
    tmp_path = f"/tmp/encdict_{uuid.uuid4().hex}.{suffix}"
    with open(tmp_path, "wb") as fh:
        fh.write(raw)

    try:
        try:
            from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
        except Exception as e:
            raise HTTPException(503, detail=f"STT library missing: {e}")

        stt = OpenAISpeechToText(api_key=_llm_key())
        with open(tmp_path, "rb") as fh:
            result = await stt.transcribe(
                file=fh,
                model="whisper-1",
                response_format="json",
                language=language[:2] if language else None,
                prompt="Indian urology clinic encounter note. Terms: BPH, IPSS, PSA, "
                       "hydronephrosis, ureteric calculus, DJ stent, TURP, PCNL, URS, "
                       "uroflowmetry, haematuria, LUTS.",
            )
        transcript = ""
        if isinstance(result, dict):
            transcript = (result.get("text") or "").strip()
        elif hasattr(result, "text"):
            transcript = (result.text or "").strip()
        else:
            transcript = str(result).strip()
        if not transcript:
            raise HTTPException(422, detail="Empty transcript from Whisper")

        sid = f"encd_{uuid.uuid4().hex[:10]}"
        claude_resp = await _claude_one_shot(
            system=_ENCOUNTER_SYSTEM,
            user_text=f"Transcript:\n\"\"\"\n{transcript}\n\"\"\"",
            session_id=sid,
        )
        parsed = _extract_json(claude_resp) or {}
        return {
            "ok": True,
            "transcript": transcript,
            "parsed": {
                "chief_complaint": (parsed.get("chief_complaint") or "").strip(),
                "subjective": (parsed.get("subjective") or "").strip(),
                "objective": (parsed.get("objective") or "").strip(),
                "assessment": (parsed.get("assessment") or "").strip(),
                "plan": (parsed.get("plan") or "").strip(),
                "diagnoses": [str(d).strip() for d in (parsed.get("diagnoses") or []) if str(d).strip()],
            },
            "model": "claude-sonnet-4-5",
            "stt_model": "whisper-1",
        }
    finally:
        try:
            import os as _os
            _os.unlink(tmp_path)
        except Exception:
            pass
