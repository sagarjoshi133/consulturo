"""ConsultUro — surgeries router.

  · /api/surgeries
  · /api/surgeries/{surgery_id}
  · /api/surgeries/export.csv
  · /api/surgeries/import
  · /api/surgeries/presets
  · /api/surgeries/suggestions

Extracted from server.py during Phase 3 modularization.
Behaviour preserved EXACTLY.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import uuid
import re
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from db import db
from auth_deps import require_can_manage_surgeries, require_staff
from models import SurgeryBody
from server import COMMON_PROCEDURES, _SUGGESTABLE_SURGERY_FIELDS, _csv, get_or_set_reg_no
from services.tenancy import resolve_clinic_id, tenant_filter
from data.procedure_durations import PROCEDURE_DURATIONS, get_duration_for
from data.preop_checklist import (
    get_preop_checklist,
    get_op_note_template,
)

# Phase 3.1 — OT Scheduling: import the consent-procedures library so
# we can return a unified "procedures with durations" listing for the
# scheduler picker. Keys correspond 1-to-1.
try:
    from data.consent_procedures import PROCEDURES as CONSENT_PROCEDURES  # type: ignore
except Exception:
    CONSENT_PROCEDURES = []  # type: ignore

router = APIRouter()


@router.post("/api/surgeries")
async def create_surgery(request: Request, body: SurgeryBody, user=Depends(require_can_manage_surgeries)):
    surgery_id = f"sx_{uuid.uuid4().hex[:10]}"
    digits = re.sub(r"\D", "", body.patient_phone)
    patient_user_id = None
    if digits:
        m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
        if m:
            patient_user_id = m["user_id"]
    sx_clinic_id = await resolve_clinic_id(request, user)
    # Phase D — canonical patient registry id.
    from services.patient_registry import resolve_patient_id
    sx_patient_id = await resolve_patient_id(
        body.patient_phone, getattr(body, "patient_email", None), body.patient_name
    )
    # Phase 3.1 — derive sane defaults for the new scheduling fields.
    # Existing op-note flow callers won't pass these; new scheduler will.
    surgery_status = (body.surgery_status or "completed").strip() or "completed"
    estimated_duration = body.estimated_duration_min
    if estimated_duration is None:
        estimated_duration = get_duration_for(body.procedure_key)
    doc = {
        "surgery_id": surgery_id,
        "doctor_user_id": user["user_id"],
        "patient_user_id": patient_user_id,
        "clinic_id": sx_clinic_id,
        "patient_phone": body.patient_phone,
        "patient_name": body.patient_name,
        "patient_age": body.patient_age,
        "patient_sex": body.patient_sex,
        "patient_id_ipno": body.patient_id_ipno,
        "registration_no": await get_or_set_reg_no(
            body.patient_phone,
            getattr(body, "registration_no", None),
            body.patient_name,
            email=getattr(body, "patient_email", None),
        ),
        # Phase D — canonical patient registry id.
        "patient_id": sx_patient_id,
        "address": body.address,
        "patient_category": body.patient_category,
        "consultation_date": body.consultation_date,
        "referred_by": body.referred_by,
        "clinical_examination": body.clinical_examination,
        "diagnosis": body.diagnosis,
        "imaging": body.imaging,
        "department": body.department,
        "date_of_admission": body.date_of_admission,
        "surgery_name": body.surgery_name,
        "date": body.date,
        "hospital": body.hospital,
        "operative_findings": body.operative_findings,
        "post_op_investigations": body.post_op_investigations,
        "date_of_discharge": body.date_of_discharge,
        "follow_up": body.follow_up,
        "notes": body.notes,
        # Phase 3.1 — OT Scheduling
        "surgery_status": surgery_status,
        "procedure_key": body.procedure_key,
        # Phase 6.2 — multi-procedure surgeries. Backward-compat:
        # `procedure_key` always holds the first key; `procedure_keys`
        # holds the full ordered list. Single-procedure flows pass
        # only `procedure_key` and `procedure_keys` defaults to None.
        "procedure_keys": body.procedure_keys or ([body.procedure_key] if body.procedure_key else None),
        "scheduled_date": body.scheduled_date,
        "scheduled_time": body.scheduled_time,
        "ot_room": body.ot_room or "OT-1",
        "estimated_duration_min": estimated_duration,
        "booking_id": body.booking_id,
        "created_at": datetime.now(timezone.utc),
    }
    await db.surgeries.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/api/surgeries")
async def list_surgeries(
    request: Request,
    user=Depends(require_staff),
    limit: int = 5000,
    skip: int = 0,
    q: str = "",
):
    # Phase E — scope by current clinic.
    clinic_id = await resolve_clinic_id(request, user)
    filt: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    # Optional server-side search so paginated clients can search the
    # WHOLE logbook without downloading it.
    if q.strip():
        import re as _re
        rx = {"$regex": _re.escape(q.strip()), "$options": "i"}
        filt["$or"] = [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"surgery_name": rx},
            {"hospital": rx},
            {"diagnosis": rx},
        ]
    limit = max(1, min(int(limit or 5000), 5000))
    skip = max(0, int(skip or 0))
    cursor = db.surgeries.find(filt, {"_id": 0}).sort("date", -1).skip(skip).limit(limit)
    return await cursor.to_list(length=limit)

@router.get("/api/surgeries/export.csv")
async def export_surgeries_csv(user=Depends(require_can_manage_surgeries)):
    """Download the full surgery logbook as a CSV, sorted latest first."""
    import csv as _csv
    from io import StringIO
    from fastapi.responses import StreamingResponse

    cursor = db.surgeries.find({}, {"_id": 0}).sort("date", -1)
    rows = await cursor.to_list(length=10000)

    columns = [
        ("date", "Date of Surgery"),
        ("patient_name", "Name"),
        ("patient_phone", "Mobile"),
        ("patient_age", "Age"),
        ("patient_sex", "Sex"),
        ("patient_id_ipno", "IP No."),
        ("address", "Address"),
        ("patient_category", "Category"),
        ("consultation_date", "Consultation Date"),
        ("referred_by", "Referred By"),
        ("clinical_examination", "Clinical Examination"),
        ("diagnosis", "Diagnosis"),
        ("imaging", "Imaging"),
        ("department", "Department"),
        ("date_of_admission", "Date of Admission"),
        ("surgery_name", "Name of Surgery"),
        ("hospital", "Hospital"),
        ("operative_findings", "Operative Findings"),
        ("post_op_investigations", "Post-op Investigations"),
        ("date_of_discharge", "Date of Discharge"),
        ("follow_up", "Follow up"),
        ("notes", "Notes"),
        ("surgery_id", "Ref ID"),
    ]

    def _fmt(v: Any) -> str:
        if v is None:
            return ""
        if isinstance(v, datetime):
            return v.strftime("%d-%m-%Y")
        # ISO date strings like 2025-03-12 → DD-MM-YYYY
        if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            return f"{v[8:10]}-{v[5:7]}-{v[0:4]}"
        return str(v)

    buf = StringIO()
    writer = _csv.writer(buf, quoting=_csv.QUOTE_MINIMAL)
    writer.writerow([label for _, label in columns])
    for r in rows:
        writer.writerow([_fmt(r.get(k)) for k, _ in columns])
    csv_text = buf.getvalue()
    buf.close()

    # CSV filename uses the clinic's IST date (not UTC) so that a 1 AM
    # IST export still says "today". IST = UTC + 5:30.
    today = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
    filename = f"consulturo-surgeries-{today}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.patch("/api/surgeries/{surgery_id}")
async def update_surgery(surgery_id: str, body: SurgeryBody, user=Depends(require_can_manage_surgeries)):
    digits = re.sub(r"\D", "", body.patient_phone)
    patient_user_id = None
    if digits:
        m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
        if m:
            patient_user_id = m["user_id"]
    updates = body.model_dump()
    updates["patient_user_id"] = patient_user_id
    res = await db.surgeries.update_one({"surgery_id": surgery_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    return await db.surgeries.find_one({"surgery_id": surgery_id}, {"_id": 0})

@router.delete("/api/surgeries/{surgery_id}")
async def delete_surgery(surgery_id: str, user=Depends(require_can_manage_surgeries)):
    res = await db.surgeries.delete_one({"surgery_id": surgery_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    return {"ok": True}

@router.post("/api/surgeries/import")
async def import_surgeries(
    payload: Dict[str, Any] = Body(...),
    user=Depends(require_can_manage_surgeries),
):
    """
    Bulk import historic logbook rows.
    Payload: { "rows": [ { ...surgery fields }, ... ] }
    Accepts free-form keys (case-insensitive mapping) and normalises dates to ISO yyyy-MM-dd.
    """
    rows: List[Dict[str, Any]] = payload.get("rows", []) or []
    if not isinstance(rows, list):
        raise HTTPException(status_code=400, detail="rows must be a list")

    # Column aliases → canonical keys (lowercased, no spaces / underscores)
    alias = {
        # patient
        "name": "patient_name", "patientname": "patient_name", "patient": "patient_name",
        "mobile": "patient_phone", "mobileno": "patient_phone", "phone": "patient_phone", "contact": "patient_phone", "patientphone": "patient_phone",
        "age": "patient_age", "patientage": "patient_age",
        "sex": "patient_sex", "gender": "patient_sex", "patientsex": "patient_sex",
        "ipno": "patient_id_ipno", "ipnumber": "patient_id_ipno", "patientid": "patient_id_ipno", "patientidipno": "patient_id_ipno",
        "address": "address",
        "category": "patient_category", "patientcategory": "patient_category",
        # consultation
        "consultationdate": "consultation_date", "dateofconsultation": "consultation_date", "opddate": "consultation_date",
        "referredby": "referred_by", "referrer": "referred_by",
        "examination": "clinical_examination", "clinicalexamination": "clinical_examination", "oe": "clinical_examination",
        "diagnosis": "diagnosis", "dx": "diagnosis",
        "imaging": "imaging", "usg": "imaging", "ct": "imaging", "mri": "imaging",
        "department": "department", "dept": "department", "departmentopdipd": "department",
        "dateofadmission": "date_of_admission", "admissiondate": "date_of_admission", "doa": "date_of_admission",
        # surgery
        "nameofsurgery": "surgery_name", "surgery": "surgery_name", "procedure": "surgery_name", "operation": "surgery_name", "nameofsurgeryprocedure": "surgery_name", "surgeryname": "surgery_name",
        "dateofsurgery": "date", "dateofsurgeryprocedure": "date", "doc": "date", "surgerydate": "date", "operationdate": "date", "dos": "date", "date": "date",
        "hospital": "hospital", "centre": "hospital", "institution": "hospital",
        "operativefindings": "operative_findings", "opnotes": "operative_findings", "findings": "operative_findings",
        "postopinvestigations": "post_op_investigations", "postop": "post_op_investigations", "postopinvestigation": "post_op_investigations",
        "dateofdischarge": "date_of_discharge", "dischargedate": "date_of_discharge", "dod": "date_of_discharge",
        "followup": "follow_up", "fu": "follow_up",
        "notes": "notes", "remarks": "notes", "additionalnotes": "notes",
    }

    # Canonical keys always map to themselves (normalised form)
    canonical_set = {
        "patient_name", "patient_phone", "patient_age", "patient_sex", "patient_id_ipno",
        "address", "patient_category", "consultation_date", "referred_by",
        "clinical_examination", "diagnosis", "imaging", "department", "date_of_admission",
        "surgery_name", "date", "hospital", "operative_findings", "post_op_investigations",
        "date_of_discharge", "follow_up", "notes",
    }

    def _normkey(k: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (k or "").strip().lower())

    # Add canonical keys to alias (their normalised form maps to themselves)
    for c in canonical_set:
        alias.setdefault(_normkey(c), c)

    def _normdate(v: Any) -> str:
        if not v:
            return ""
        s = str(v).strip()
        # Try DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY/MM/DD, DD.MM.YYYY, "3-Mar-2025"
        cleaned = s.replace("/", "-").replace(".", "-").replace(" ", "-")
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d-%m-%y", "%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
            except Exception:
                pass
        return s

    inserted = 0
    errors: List[Dict[str, Any]] = []
    for idx, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"row": idx, "error": "not an object"})
            continue

        mapped: Dict[str, Any] = {}
        for k, v in raw.items():
            canonical = alias.get(_normkey(k), _normkey(k))
            # Also allow already-canonical keys passed through
            mapped[canonical] = v

        if not mapped.get("patient_name") or not mapped.get("surgery_name") or not mapped.get("date"):
            errors.append({"row": idx, "error": "missing patient_name / surgery_name / date"})
            continue

        digits = re.sub(r"\D", "", str(mapped.get("patient_phone", "")))
        patient_user_id = None
        if digits:
            m = await db.users.find_one({"phone_digits": digits}, {"_id": 0, "user_id": 1})
            if m:
                patient_user_id = m["user_id"]

        try:
            age_val = mapped.get("patient_age")
            if isinstance(age_val, str) and age_val.strip().isdigit():
                age_val = int(age_val.strip())
            elif not isinstance(age_val, int):
                age_val = None
        except Exception:
            age_val = None

        doc = {
            "surgery_id": f"sx_{uuid.uuid4().hex[:10]}",
            "doctor_user_id": user["user_id"],
            "patient_user_id": patient_user_id,
            "patient_phone": str(mapped.get("patient_phone", "") or ""),
            "patient_name": str(mapped.get("patient_name", "") or ""),
            "patient_age": age_val,
            "patient_sex": str(mapped.get("patient_sex", "") or ""),
            "patient_id_ipno": str(mapped.get("patient_id_ipno", "") or ""),
            "address": str(mapped.get("address", "") or ""),
            "patient_category": str(mapped.get("patient_category", "") or ""),
            "consultation_date": _normdate(mapped.get("consultation_date")),
            "referred_by": str(mapped.get("referred_by", "") or ""),
            "clinical_examination": str(mapped.get("clinical_examination", "") or ""),
            "diagnosis": str(mapped.get("diagnosis", "") or ""),
            "imaging": str(mapped.get("imaging", "") or ""),
            "department": str(mapped.get("department", "") or ""),
            "date_of_admission": _normdate(mapped.get("date_of_admission")),
            "surgery_name": str(mapped.get("surgery_name", "") or ""),
            "date": _normdate(mapped.get("date")),
            "hospital": str(mapped.get("hospital", "") or ""),
            "operative_findings": str(mapped.get("operative_findings", "") or ""),
            "post_op_investigations": str(mapped.get("post_op_investigations", "") or ""),
            "date_of_discharge": _normdate(mapped.get("date_of_discharge")),
            "follow_up": str(mapped.get("follow_up", "") or ""),
            "notes": str(mapped.get("notes", "") or ""),
            "imported": True,
            "imported_at": datetime.now(timezone.utc),
            "created_at": datetime.now(timezone.utc),
        }
        try:
            await db.surgeries.insert_one(doc)
            inserted += 1
        except Exception as ex:
            errors.append({"row": idx, "error": str(ex)[:140]})

    return {"inserted": inserted, "errors": errors, "total": len(rows)}

@router.get("/api/surgeries/presets")
async def surgery_presets():
    return {"procedures": COMMON_PROCEDURES}

@router.get("/api/surgeries/suggestions")
async def surgery_suggestions(
    field: str,
    q: Optional[str] = None,
    limit: int = 15,
    user=Depends(require_staff),
):
    """Return distinct past values for `field` across the surgeries
    collection, ranked by frequency descending. If `q` is given, filter
    to values whose lower-cased form contains the lower-cased query
    (substring match — more forgiving than prefix)."""
    if field not in _SUGGESTABLE_SURGERY_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported field. Allowed: {sorted(_SUGGESTABLE_SURGERY_FIELDS)}",
        )
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 15

    # Build pipeline: filter to non-empty values for the field, optionally
    # apply a case-insensitive substring match on the raw value, then
    # group by a lower-cased key so we de-dup "Dr X" / "DR X" together.
    match: Dict[str, Any] = {field: {"$exists": True, "$nin": [None, ""]}}
    if q and q.strip():
        # Escape regex special chars so users can search "Dr. X" literally.
        q_safe = re.escape(q.strip())
        match[field] = {"$regex": q_safe, "$options": "i", "$nin": [None, ""]}

    pipeline = [
        {"$match": match},
        # First surface a canonical form for the lower-cased group key.
        {"$project": {field: 1, "_k": {"$toLower": {"$ifNull": [f"${field}", ""]}}}},
        {"$match": {"_k": {"$ne": ""}}},
        {"$group": {"_id": "$_k", "value": {"$first": f"${field}"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1, "value": 1}},
        {"$limit": limit},
        {"$project": {"_id": 0, "value": 1, "count": 1}},
    ]
    rows = await db.surgeries.aggregate(pipeline).to_list(length=limit)
    # Final safety: strip any None/"" that slipped through.
    return [r for r in rows if r.get("value")]


# ────────────────────────────────────────────────────────────────────
# Phase 3.1 — OT Scheduling endpoints
# ────────────────────────────────────────────────────────────────────

@router.get("/api/surgeries/procedures")
async def list_scheduler_procedures(user=Depends(require_staff)):
    """Return the catalogue of procedures usable by the OT-scheduler
    picker. Each entry carries multilingual name, category, suggested
    anaesthesia and the default OT slot duration in minutes (from
    `procedure_durations.py`).
    """
    out: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()
    for p in CONSENT_PROCEDURES:
        key = p.get("key")
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        name = p.get("name") or {}
        out.append({
            "key": key,
            "category": p.get("category", ""),
            "name": {
                "en": name.get("en", key.replace("_", " ").title()) if isinstance(name, dict) else str(name),
                "hi": name.get("hi", "") if isinstance(name, dict) else "",
                "gu": name.get("gu", "") if isinstance(name, dict) else "",
            },
            "anesthesia": p.get("anesthesia") or p.get("anaesthesia") or "",
            "duration_min": get_duration_for(key),
        })
    # Sort by category then English name for a stable UI order
    out.sort(key=lambda r: (r["category"], r["name"]["en"]))
    return {"procedures": out, "total": len(out), "default_duration_min": 60}


@router.get("/api/surgeries/scheduled")
async def list_scheduled_surgeries(
    request: Request,
    from_date: Optional[str] = None,   # YYYY-MM-DD inclusive
    to_date: Optional[str] = None,     # YYYY-MM-DD inclusive
    status: Optional[str] = None,      # scheduled|in_progress|completed|cancelled
    user=Depends(require_staff),
):
    """Return surgeries with a `scheduled_date` inside the requested
    window. Used by the OT calendar view (Today / This-Week / Custom)."""
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    if from_date or to_date:
        date_q: Dict[str, Any] = {}
        if from_date:
            date_q["$gte"] = from_date
        if to_date:
            date_q["$lte"] = to_date
        q["scheduled_date"] = date_q
    else:
        q["scheduled_date"] = {"$ne": None, "$exists": True}
    if status:
        q["surgery_status"] = status
    cursor = db.surgeries.find(q, {"_id": 0}).sort([("scheduled_date", 1), ("scheduled_time", 1)])
    rows = await cursor.to_list(length=2000)
    return rows


@router.get("/api/surgeries/conflicts")
async def check_ot_conflicts(
    request: Request,
    scheduled_date: str,
    scheduled_time: str,           # HH:MM
    duration_min: int,
    ot_room: str = "OT-1",
    exclude_surgery_id: Optional[str] = None,
    user=Depends(require_staff),
):
    """Return any scheduled surgeries that overlap the proposed slot
    in the same OT room. The frontend uses this to warn the doctor
    before saving a new schedule.
    """
    if duration_min <= 0:
        raise HTTPException(status_code=400, detail="duration_min must be > 0")
    try:
        hh, mm = scheduled_time.split(":")
        start_min = int(hh) * 60 + int(mm)
    except Exception:
        raise HTTPException(status_code=400, detail="scheduled_time must be HH:MM (24h)")
    end_min = start_min + duration_min

    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    q["scheduled_date"] = scheduled_date
    q["ot_room"] = ot_room
    q["surgery_status"] = {"$in": ["scheduled", "in_progress"]}
    if exclude_surgery_id:
        q["surgery_id"] = {"$ne": exclude_surgery_id}

    cursor = db.surgeries.find(q, {"_id": 0})
    candidates = await cursor.to_list(length=200)

    conflicts: List[Dict[str, Any]] = []
    for s in candidates:
        st = (s.get("scheduled_time") or "").split(":")
        if len(st) < 2:
            continue
        try:
            s_start = int(st[0]) * 60 + int(st[1])
            s_end = s_start + int(s.get("estimated_duration_min") or 60)
        except Exception:
            continue
        # Overlap when [start, end) intersects [s_start, s_end)
        if s_start < end_min and start_min < s_end:
            conflicts.append({
                "surgery_id": s.get("surgery_id"),
                "patient_name": s.get("patient_name"),
                "scheduled_time": s.get("scheduled_time"),
                "estimated_duration_min": s.get("estimated_duration_min"),
                "surgery_name": s.get("surgery_name"),
                "status": s.get("surgery_status"),
            })
    return {"conflicts": conflicts, "ot_room": ot_room, "scheduled_date": scheduled_date}


@router.patch("/api/surgeries/{surgery_id}/status")
async def change_surgery_status(
    surgery_id: str,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_can_manage_surgeries),
):
    """Transition a scheduled surgery between `scheduled` →
    `in_progress` → `completed` (or `cancelled`)."""
    new_status = (body.get("status") or "").strip()
    if new_status not in {"scheduled", "in_progress", "completed", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    updates: Dict[str, Any] = {
        "surgery_status": new_status,
        "status_updated_at": datetime.now(timezone.utc).isoformat(),
        "status_updated_by": user["user_id"],
    }
    # When marking completed/in_progress, persist a real `date` so the
    # logbook export sees it. The frontend may also send op-note fields
    # at the same call — accept them through.
    for field in (
        "date", "operative_findings", "notes",
        "post_op_investigations", "date_of_discharge", "follow_up",
    ):
        if field in body and body[field] is not None:
            updates[field] = body[field]
    res = await db.surgeries.update_one({"surgery_id": surgery_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    refreshed = await db.surgeries.find_one({"surgery_id": surgery_id}, {"_id": 0})
    # Google review auto-nudge — fire on discharge (surgery completed +
    # date_of_discharge present). Best-effort, non-blocking.
    if new_status == "completed" and (refreshed or {}).get("date_of_discharge"):
        try:
            from services.review_request import schedule_review_request
            await schedule_review_request(
                trigger="discharge",
                user_id=(refreshed or {}).get("user_id"),
                patient_name=(refreshed or {}).get("patient_name"),
                phone=(refreshed or {}).get("patient_phone"),
                email=(refreshed or {}).get("patient_email"),
                source_id=surgery_id,
                clinic_id=(refreshed or {}).get("clinic_id"),
            )
        except Exception:
            pass
    return refreshed


@router.get("/api/surgeries/ot-rooms")
async def list_ot_rooms(request: Request, user=Depends(require_staff)):
    """Return the OT rooms configured for this clinic. Defaults to a
    single `OT-1` until the clinic adds more (we read from
    `clinic_settings.ot_rooms` if set)."""
    clinic_id = await resolve_clinic_id(request, user)
    rooms: List[str] = ["OT-1"]
    try:
        cs = await db.clinic_settings.find_one({"clinic_id": clinic_id}, {"_id": 0, "ot_rooms": 1})
        if cs and isinstance(cs.get("ot_rooms"), list) and cs["ot_rooms"]:
            rooms = [str(r).strip() for r in cs["ot_rooms"] if str(r).strip()]
    except Exception:
        pass
    # Also surface any room names already used in the surgeries
    # collection so the calendar doesn't drop them silently.
    try:
        distinct = await db.surgeries.distinct(
            "ot_room", {"clinic_id": clinic_id, "ot_room": {"$nin": [None, ""]}}
        )
        for r in distinct:
            if r and r not in rooms:
                rooms.append(r)
    except Exception:
        pass
    return {"rooms": rooms}

# ────────────────────────────────────────────────────────────────────
# Phase 3.2 — Pre-op Checklist endpoints
# ────────────────────────────────────────────────────────────────────

@router.get("/api/surgeries/preop/template")
async def get_preop_template(user=Depends(require_staff)):
    """Return the universal 12-item pre-op checklist (trilingual)
    that the frontend renders on every scheduled surgery."""
    items = get_preop_checklist()
    critical_keys = [i["key"] for i in items if i.get("critical")]
    return {"items": items, "critical_keys": critical_keys, "total": len(items)}


@router.patch("/api/surgeries/{surgery_id}/preop")
async def update_preop_checklist(
    surgery_id: str,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_can_manage_surgeries),
):
    """Persist the pre-op checklist state on a surgery doc. Body shape:
    `{"checklist": {"consent_signed": true, ...}, "notes": "...optional..."}`.
    """
    if not isinstance(body.get("checklist"), dict):
        raise HTTPException(status_code=400, detail="`checklist` must be an object")
    template = get_preop_checklist()
    valid_keys = {i["key"] for i in template}
    state: Dict[str, bool] = {}
    for k, v in body["checklist"].items():
        if k in valid_keys:
            state[k] = bool(v)
    critical_keys = {i["key"] for i in template if i.get("critical")}
    all_critical_done = all(state.get(k) for k in critical_keys)
    updates: Dict[str, Any] = {
        "preop_checklist": state,
        "preop_all_critical_done": all_critical_done,
        "preop_updated_at": datetime.now(timezone.utc).isoformat(),
        "preop_updated_by": user["user_id"],
    }
    if "notes" in body and isinstance(body["notes"], str):
        updates["preop_notes"] = body["notes"]
    res = await db.surgeries.update_one({"surgery_id": surgery_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Surgery not found")
    return await db.surgeries.find_one({"surgery_id": surgery_id}, {"_id": 0})


# ────────────────────────────────────────────────────────────────────
# Phase 3.3 — Op-note template endpoint
# ────────────────────────────────────────────────────────────────────

@router.get("/api/surgeries/op-note-template")
async def fetch_op_note_template(
    procedure_key: Optional[str] = None,
    user=Depends(require_staff),
):
    """Return the editable op-note skeleton for a given procedure_key
    (or a generic one when unknown). Surgeons override every line."""
    return {
        "procedure_key": procedure_key,
        "template": get_op_note_template(procedure_key),
    }


# ────────────────────────────────────────────────────────────────────
# Phase 3.4 — Post-op tracker endpoints
# ────────────────────────────────────────────────────────────────────

@router.post("/api/surgeries/{surgery_id}/postop-notes")
async def add_postop_note(
    surgery_id: str,
    body: Dict[str, Any] = Body(...),
    user=Depends(require_can_manage_surgeries),
):
    """Append a dated post-op progress note to a surgery."""
    sx = await db.surgeries.find_one({"surgery_id": surgery_id}, {"_id": 0, "surgery_id": 1})
    if not sx:
        raise HTTPException(status_code=404, detail="Surgery not found")

    note_date = (body.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")).strip()
    note = {
        "note_id": "pop_" + uuid.uuid4().hex[:10],
        "date": note_date,
        "vitals": (body.get("vitals") or "").strip(),
        "drug_chart": (body.get("drug_chart") or "").strip(),
        "progress": (body.get("progress") or "").strip(),
        "complications": (body.get("complications") or "").strip(),
        "plan": (body.get("plan") or "").strip(),
        "author_id": user["user_id"],
        "author_name": user.get("name") or user.get("email") or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.surgeries.update_one(
        {"surgery_id": surgery_id},
        {"$push": {"postop_notes": note}, "$set": {"postop_updated_at": note["created_at"]}},
    )
    return note


@router.delete("/api/surgeries/{surgery_id}/postop-notes/{note_id}")
async def delete_postop_note(
    surgery_id: str,
    note_id: str,
    user=Depends(require_can_manage_surgeries),
):
    """Remove a post-op note by note_id."""
    res = await db.surgeries.update_one(
        {"surgery_id": surgery_id},
        {"$pull": {"postop_notes": {"note_id": note_id}}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True, "note_id": note_id}


@router.get("/api/surgeries/{surgery_id}/postop-notes")
async def list_postop_notes(
    surgery_id: str,
    user=Depends(require_staff),
):
    """Return all post-op notes for a surgery, newest first."""
    sx = await db.surgeries.find_one(
        {"surgery_id": surgery_id}, {"_id": 0, "postop_notes": 1}
    )
    if not sx:
        raise HTTPException(status_code=404, detail="Surgery not found")
    notes = sx.get("postop_notes") or []
    notes.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    return {"notes": notes, "total": len(notes)}


# ─── Phase 3.5 — Surgery reminder utilities ────────────────────────────

@router.post("/api/surgeries/{surgery_id}/send-reminder")
async def send_surgery_reminder_now(
    surgery_id: str,
    body: Optional[Dict[str, Any]] = Body(default=None),
    user=Depends(require_can_manage_surgeries),
):
    """Manually fire the 5-day reminder for a single surgery NOW.

    Useful when:
      • Staff scheduled a surgery <5 days out and wants to remind the
        patient immediately.
      • The doctor wants to re-send a reminder closer to the date.

    Returns a `wa_link` so the frontend can open WhatsApp directly
    on the same device. We also push to the patient + Telegram-alert
    the owner so it mirrors the automated nightly sweep.

    Accepts an optional `force: true` in the body to bypass the
    `reminder_5d_fired_at` guard and re-send.
    """
    import re as _re
    from urllib.parse import quote as _q

    sx = await db.surgeries.find_one({"surgery_id": surgery_id})
    if not sx:
        raise HTTPException(status_code=404, detail="Surgery not found")
    force = bool((body or {}).get("force"))

    patient_name = (sx.get("patient_name") or "").strip() or "Patient"
    first_name = patient_name.split(" ")[0]
    sched_date = (sx.get("scheduled_date") or "").strip()
    sched_time = (sx.get("scheduled_time") or "").strip()
    ot_room = (sx.get("ot_room") or "").strip()
    surgery_name = (sx.get("surgery_name") or sx.get("procedure_key") or "your surgery").strip()
    patient_user_id = sx.get("patient_user_id")
    patient_phone = (sx.get("patient_phone") or "").strip()

    try:
        yr, mo, dy = [int(x) for x in sched_date.split("-")]
        pretty_date = datetime(yr, mo, dy).strftime("%d %b %Y")
    except Exception:
        pretty_date = sched_date or "the scheduled date"

    body_text = (
        f"Hi {first_name}, this is a reminder — your surgery "
        f"({surgery_name}) is scheduled on {pretty_date}"
        f"{' at ' + sched_time if sched_time else ''}"
        f"{' (' + ot_room + ')' if ot_room else ''}. "
        "Please follow pre-op fasting & medication instructions. "
        "— Dr. Sagar Joshi's clinic"
    )

    # Lazy-import notification helpers to avoid circular import at module load
    try:
        from services.notifications import create_notification as _create_notif
    except Exception:
        _create_notif = None

    pushed = False
    if patient_user_id and _create_notif:
        try:
            await _create_notif(
                user_id=patient_user_id,
                title="🗓️ Surgery reminder",
                body=body_text,
                kind="surgery_reminder",
                data={
                    "type": "surgery_reminder",
                    "surgery_id": surgery_id,
                    "window": "manual",
                },
                push=True,
            )
            pushed = True
        except Exception:
            pushed = False

    # Build wa.me link for the caller (frontend opens it)
    digits = _re.sub(r"\D", "", patient_phone)
    wa_digits = digits if len(digits) > 10 else ("91" + digits if digits else "")
    wa_link = (
        f"https://wa.me/{wa_digits}?text={_q(body_text)}" if wa_digits else None
    )

    # If force=true, also reset the auto-sweep guard so the next
    # natural 5-day window will re-fire if the schedule changes.
    if force:
        try:
            await db.surgeries.update_one(
                {"surgery_id": surgery_id},
                {"$unset": {"reminder_5d_fired_at": "", "reminder_5d_target_date": ""}},
            )
        except Exception:
            pass

    return {
        "ok": True,
        "surgery_id": surgery_id,
        "wa_link": wa_link,
        "push_sent": pushed,
        "message": body_text,
    }


