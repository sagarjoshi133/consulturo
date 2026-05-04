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
from datetime import datetime, timezone
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
        "registration_no": await get_or_set_reg_no(body.patient_phone, getattr(body, "registration_no", None), body.patient_name),
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
        "created_at": datetime.now(timezone.utc),
    }
    await db.surgeries.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/api/surgeries")
async def list_surgeries(request: Request, user=Depends(require_staff)):
    # Phase E — scope by current clinic.
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = tenant_filter(user, clinic_id, allow_global=True)
    cursor = db.surgeries.find(q, {"_id": 0}).sort("date", -1)
    return await cursor.to_list(length=5000)

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
