"""ConsultUro — Wave 1 router.

Bundles five high-impact features in a single module:

  · A — Global Search           GET  /api/search?q=...
  · B — Patient Timeline        GET  /api/patients/{phone}/timeline
  · C — Rx Templates (CRUD)     GET/POST/PATCH/DELETE /api/rx-templates
  · D — Patient Allergies       GET  /api/patients/allergies?phone=
                                PATCH /api/patients/allergies
  · E — Lab Results             GET/POST/DELETE /api/lab-results

Tenant-scoped via X-Clinic-Id where appropriate. Demo accounts are
blocked from writes through the existing `block_if_demo` helper.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import re
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from db import db
from auth_deps import require_prescriber, require_staff, require_user, STAFF_ROLES
from server import _normalize_phone, block_if_demo
from services.tenancy import resolve_clinic_id, tenant_filter

# Patient-side content sources (lazy-imported to avoid hard coupling).
try:
    from disease_content import list_localized as _dis_list
except Exception:  # pragma: no cover
    _dis_list = None  # type: ignore[assignment]
try:
    from server import _edu_list_localized as _edu_list
except Exception:  # pragma: no cover
    _edu_list = None  # type: ignore[assignment]
try:
    from data.guides import GUIDES as _GUIDES_CORE
    from data.guides_extended import GUIDES_EXTENDED as _GUIDES_EXT
    from data.guides_extended_p2 import GUIDES_EXTENDED_P2 as _GUIDES_EXT2
    _GUIDES_ALL = _GUIDES_CORE + _GUIDES_EXT + _GUIDES_EXT2
except Exception:  # pragma: no cover
    _GUIDES_ALL = []  # type: ignore[assignment]

# Patient-facing app routes that act as "calculator tools".
# Hand-curated so search can suggest them. Paths MUST match real
# Expo Router files under app/.
_CALC_ROUTES = [
    {"key": "ipss",            "title": "IPSS questionnaire",          "subtitle": "International Prostate Symptom Score",                     "link": "/ipss"},
    {"key": "prostate_volume", "title": "Prostate volume calculator",  "subtitle": "Ellipsoid formula from USG dimensions",                  "link": "/prostate-volume"},
    {"key": "egfr",            "title": "eGFR calculator",             "subtitle": "Kidney function from creatinine, age, sex (CKD-EPI)",      "link": "/calculators/egfr"},
    {"key": "creatinine",      "title": "Creatinine clearance",        "subtitle": "Cockcroft-Gault calculator",                              "link": "/calculators/creatinine"},
    {"key": "crcl",            "title": "CrCl (Cockcroft-Gault)",      "subtitle": "Creatinine clearance estimator",                          "link": "/calculators/crcl"},
    {"key": "bmi",             "title": "BMI calculator",              "subtitle": "Body mass index from height & weight",                   "link": "/calculators/bmi"},
    {"key": "psa",             "title": "PSA density calculator",      "subtitle": "PSA ÷ prostate volume",                                  "link": "/calculators/psa"},
    {"key": "iief5",           "title": "IIEF-5 / SHIM score",         "subtitle": "Erectile dysfunction severity score",                    "link": "/calculators/iief5"},
    {"key": "bladder_diary",   "title": "Bladder diary",               "subtitle": "Track voided volumes & frequency",                       "link": "/calculators/bladder-diary"},
    {"key": "stone_risk",      "title": "Stone risk profile",          "subtitle": "Urolithiasis recurrence risk",                           "link": "/calculators/stone-risk"},
]

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────


def _ph(p: str) -> str:
    return _normalize_phone(p or "")


def _ts(v: Any) -> Optional[str]:
    """Best-effort ISO timestamp for mixed datetime/string fields."""
    if not v:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


# ── D · Patient Allergies ────────────────────────────────────────────


class AllergiesBody(BaseModel):
    phone: str
    allergies: List[str] = Field(default_factory=list)
    notes: Optional[str] = ""


@router.get("/api/patients/allergies")
async def get_allergies(phone: str = "", user=Depends(require_staff)):
    p = _ph(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    doc = await db.patients.find_one({"phone": p}, {"_id": 0}) or {}
    return {
        "phone": p,
        "allergies": doc.get("allergies") or [],
        "notes": doc.get("allergy_notes") or "",
        "updated_at": _ts(doc.get("allergies_updated_at")),
    }


@router.patch("/api/patients/allergies")
async def set_allergies(body: AllergiesBody, user=Depends(require_prescriber)):
    block_if_demo(user)
    p = _ph(body.phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    cleaned = [str(a).strip() for a in (body.allergies or []) if str(a).strip()]
    seen, dedup = set(), []
    for a in cleaned:
        key = a.lower()
        if key in seen:
            continue
        seen.add(key)
        dedup.append(a)
    await db.patients.update_one(
        {"phone": p},
        {
            "$set": {
                "phone": p,
                "allergies": dedup,
                "allergy_notes": (body.notes or "").strip(),
                "allergies_updated_at": datetime.now(timezone.utc),
                "allergies_updated_by": user.get("user_id"),
            },
            "$setOnInsert": {"first_seen_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return {"ok": True, "phone": p, "allergies": dedup}


# ── C · Rx Templates ─────────────────────────────────────────────────


class RxTemplateMed(BaseModel):
    name: str
    dose: Optional[str] = ""
    frequency: Optional[str] = ""
    duration: Optional[str] = ""
    instructions: Optional[str] = ""


class RxTemplateBody(BaseModel):
    name: str
    diagnosis: Optional[str] = ""
    medicines: List[RxTemplateMed] = Field(default_factory=list)
    investigations: Optional[str] = ""
    advice: Optional[str] = ""
    follow_up: Optional[str] = ""


@router.get("/api/rx-templates")
async def list_rx_templates(request: Request, user=Depends(require_prescriber)):
    clinic_id = await resolve_clinic_id(request, user)
    q = tenant_filter(user, clinic_id, allow_global=True)
    cursor = db.rx_templates.find(q, {"_id": 0}).sort("name", 1)
    items = await cursor.to_list(length=500)
    return {"templates": items}


@router.post("/api/rx-templates")
async def create_rx_template(
    request: Request, body: RxTemplateBody, user=Depends(require_prescriber)
):
    block_if_demo(user)
    if not (body.name or "").strip():
        raise HTTPException(status_code=400, detail="Template name required")
    clinic_id = await resolve_clinic_id(request, user)
    tid = f"rxt_{uuid.uuid4().hex[:10]}"
    doc = {
        "template_id": tid,
        "clinic_id": clinic_id,
        "doctor_user_id": user.get("user_id"),
        "name": body.name.strip(),
        "diagnosis": (body.diagnosis or "").strip(),
        "medicines": [m.model_dump() for m in body.medicines],
        "investigations": (body.investigations or "").strip(),
        "advice": (body.advice or "").strip(),
        "follow_up": (body.follow_up or "").strip(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.rx_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/api/rx-templates/{template_id}")
async def update_rx_template(
    template_id: str,
    body: RxTemplateBody,
    user=Depends(require_prescriber),
):
    block_if_demo(user)
    updates = {
        "name": (body.name or "").strip(),
        "diagnosis": (body.diagnosis or "").strip(),
        "medicines": [m.model_dump() for m in body.medicines],
        "investigations": (body.investigations or "").strip(),
        "advice": (body.advice or "").strip(),
        "follow_up": (body.follow_up or "").strip(),
        "updated_at": datetime.now(timezone.utc),
    }
    res = await db.rx_templates.update_one({"template_id": template_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return await db.rx_templates.find_one({"template_id": template_id}, {"_id": 0})


@router.delete("/api/rx-templates/{template_id}")
async def delete_rx_template(template_id: str, user=Depends(require_prescriber)):
    block_if_demo(user)
    res = await db.rx_templates.delete_one({"template_id": template_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


# ── E · Lab Results ──────────────────────────────────────────────────

# Curated short-list of common urology labs. Free-form `test_name`
# also supported — these are just suggestions/groupings for the UI.
LAB_PRESETS = [
    {"key": "psa",       "label": "PSA",        "unit": "ng/mL",   "group": "Tumor markers"},
    {"key": "creat",     "label": "Creatinine", "unit": "mg/dL",   "group": "Renal"},
    {"key": "egfr",      "label": "eGFR",       "unit": "mL/min",  "group": "Renal"},
    {"key": "urea",      "label": "Urea",       "unit": "mg/dL",   "group": "Renal"},
    {"key": "uric",      "label": "Uric Acid",  "unit": "mg/dL",   "group": "Renal"},
    {"key": "na",        "label": "Sodium",     "unit": "mEq/L",   "group": "Electrolytes"},
    {"key": "k",         "label": "Potassium",  "unit": "mEq/L",   "group": "Electrolytes"},
    {"key": "hb",        "label": "Hemoglobin", "unit": "g/dL",    "group": "CBC"},
    {"key": "wbc",       "label": "WBC",        "unit": "/µL",     "group": "CBC"},
    {"key": "plt",       "label": "Platelets",  "unit": "/µL",     "group": "CBC"},
    {"key": "alb",       "label": "Albumin",    "unit": "g/dL",    "group": "Liver"},
    {"key": "alt",       "label": "ALT",        "unit": "U/L",     "group": "Liver"},
    {"key": "ast",       "label": "AST",        "unit": "U/L",     "group": "Liver"},
    {"key": "ca",        "label": "Calcium",    "unit": "mg/dL",   "group": "Bone"},
]


class LabResultBody(BaseModel):
    phone: str
    test_name: str
    value: float
    unit: Optional[str] = ""
    date: Optional[str] = ""  # YYYY-MM-DD; defaults to today
    notes: Optional[str] = ""


@router.get("/api/lab-results/presets")
async def lab_presets():
    return {"presets": LAB_PRESETS}


@router.get("/api/lab-results")
async def list_lab_results(
    request: Request,
    phone: str = "",
    test_name: Optional[str] = "",
    user=Depends(require_staff),
):
    p = _ph(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    clinic_id = await resolve_clinic_id(request, user)
    q: Dict[str, Any] = {
        "phone": p,
        **tenant_filter(user, clinic_id, allow_global=True),
    }
    if test_name:
        q["test_key"] = test_name.strip().lower()
    cursor = db.lab_results.find(q, {"_id": 0}).sort("date", 1)
    rows = await cursor.to_list(length=2000)
    return {"phone": p, "results": rows}


@router.post("/api/lab-results")
async def add_lab_result(
    request: Request, body: LabResultBody, user=Depends(require_staff)
):
    block_if_demo(user)
    p = _ph(body.phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")
    if not (body.test_name or "").strip():
        raise HTTPException(status_code=400, detail="Test name required")
    clinic_id = await resolve_clinic_id(request, user)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rid = f"lab_{uuid.uuid4().hex[:10]}"
    doc = {
        "result_id": rid,
        "clinic_id": clinic_id,
        "phone": p,
        "test_name": body.test_name.strip(),
        "test_key": body.test_name.strip().lower(),
        "value": float(body.value),
        "unit": (body.unit or "").strip(),
        "date": (body.date or today),
        "notes": (body.notes or "").strip(),
        "added_by": user.get("user_id"),
        "created_at": datetime.now(timezone.utc),
    }
    await db.lab_results.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/api/lab-results/{result_id}")
async def delete_lab_result(result_id: str, user=Depends(require_staff)):
    block_if_demo(user)
    res = await db.lab_results.delete_one({"result_id": result_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Lab result not found")
    return {"ok": True}


# ── B · Patient Timeline ─────────────────────────────────────────────


@router.get("/api/patients/timeline")
async def patient_timeline(
    request: Request, phone: str = "", user=Depends(require_staff)
):
    """Chronological cross-collection feed for a patient phone number.

    Returns a flat array of events with normalised fields:
        { type, ts, title, subtitle, meta, ref_id, link }
    """
    p = _ph(phone)
    if not p:
        raise HTTPException(status_code=400, detail="Phone required")

    suffix = p[-10:] if len(p) >= 10 else p
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)
    phone_q = {"patient_phone": {"$regex": suffix + "$"}, **tenant}

    events: List[Dict[str, Any]] = []

    # Bookings
    async for r in db.bookings.find(phone_q, {"_id": 0}).sort("created_at", -1):
        events.append({
            "type": "booking",
            "ts": _ts(r.get("created_at")) or r.get("date"),
            "title": f"Booking — {r.get('reason') or r.get('purpose') or 'Consultation'}",
            "subtitle": f"{r.get('date') or ''} {r.get('time_slot') or ''}".strip(),
            "meta": {"status": r.get("status"), "department": r.get("department")},
            "ref_id": r.get("booking_id"),
            "link": f"/bookings/{r.get('booking_id')}" if r.get("booking_id") else None,
        })

    # Prescriptions
    async for r in db.prescriptions.find(phone_q, {"_id": 0}).sort("created_at", -1):
        meds = r.get("medicines") or []
        med_summary = ", ".join((m.get("name") or "") for m in meds[:3])
        if len(meds) > 3:
            med_summary += f" +{len(meds) - 3}"
        events.append({
            "type": "prescription",
            "ts": _ts(r.get("created_at")),
            "title": f"Rx — {r.get('diagnosis') or 'Prescription'}",
            "subtitle": med_summary or "No medicines",
            "meta": {"med_count": len(meds), "doctor": r.get("doctor_name")},
            "ref_id": r.get("prescription_id") or r.get("rx_id"),
            "link": (
                f"/prescriptions/{r.get('prescription_id') or r.get('rx_id')}"
                if (r.get("prescription_id") or r.get("rx_id")) else None
            ),
        })

    # Surgeries
    async for r in db.surgeries.find(phone_q, {"_id": 0}).sort("created_at", -1):
        events.append({
            "type": "surgery",
            "ts": _ts(r.get("created_at")) or r.get("date"),
            "title": f"Surgery — {r.get('surgery_name') or 'Procedure'}",
            "subtitle": f"{r.get('hospital') or ''} · {r.get('date') or ''}".strip(' ·'),
            "meta": {"diagnosis": r.get("diagnosis"), "status": r.get("surgery_status")},
            "ref_id": r.get("surgery_id"),
            "link": f"/surgeries/{r.get('surgery_id')}" if r.get("surgery_id") else None,
        })

    # Receipts
    async for r in db.receipts.find(phone_q, {"_id": 0}).sort("created_at", -1):
        events.append({
            "type": "receipt",
            "ts": _ts(r.get("created_at")) or r.get("date"),
            "title": f"Receipt — ₹{r.get('total') or r.get('amount') or 0}",
            "subtitle": r.get("description") or r.get("notes") or "",
            "meta": {"payment_method": r.get("payment_method")},
            "ref_id": r.get("receipt_id"),
            "link": f"/billing/{r.get('receipt_id')}" if r.get("receipt_id") else None,
        })

    # IPD admissions
    async for r in db.ipd_admissions.find(phone_q, {"_id": 0}).sort("admission_date", -1):
        events.append({
            "type": "ipd",
            "ts": _ts(r.get("created_at")) or r.get("admission_date"),
            "title": f"IPD admission — {r.get('chief_complaint') or 'Admission'}",
            "subtitle": (
                f"Bed {r.get('bed_no') or '—'} · "
                f"{r.get('admission_date') or ''} → {r.get('discharge_date') or 'inpatient'}"
            ),
            "meta": {"status": r.get("status"), "bed_no": r.get("bed_no")},
            "ref_id": r.get("admission_id"),
            "link": f"/ipd/{r.get('admission_id')}" if r.get("admission_id") else None,
        })

    # Medical certificates
    async for r in db.medical_certificates.find(phone_q, {"_id": 0}).sort("created_at", -1):
        events.append({
            "type": "medcert",
            "ts": _ts(r.get("created_at")) or r.get("issue_date"),
            "title": f"Medical certificate — {r.get('purpose') or 'Certificate'}",
            "subtitle": r.get("findings") or "",
            "meta": {},
            "ref_id": r.get("certificate_id"),
            "link": None,
        })

    # Lab results (Wave 1 — new)
    async for r in db.lab_results.find({"phone": p, **tenant}, {"_id": 0}).sort("date", -1):
        events.append({
            "type": "lab",
            "ts": r.get("date"),
            "title": f"Lab — {r.get('test_name')}",
            "subtitle": f"{r.get('value')} {r.get('unit') or ''}",
            "meta": {"test_key": r.get("test_key")},
            "ref_id": r.get("result_id"),
            "link": None,
        })

    # IPSS submissions — patient self-reported severity score
    async for r in db.ipss_submissions.find({"phone_digits": p, **tenant}, {"_id": 0}).sort("created_at", -1):
        events.append({
            "type": "ipss",
            "ts": _ts(r.get("created_at")),
            "title": f"IPSS score — {r.get('total_score')}/35",
            "subtitle": f"QoL: {r.get('qol_score') or '—'} · {r.get('severity') or ''}",
            "meta": {"severity": r.get("severity")},
            "ref_id": r.get("submission_id"),
            "link": None,
        })

    # Newest first; defensive sort because each collection contributed
    # in its own order and some have ts as YYYY-MM-DD strings.
    def _key(ev: Dict[str, Any]):
        t = ev.get("ts") or ""
        return str(t)

    events.sort(key=_key, reverse=True)

    return {
        "phone": p,
        "count": len(events),
        "events": events,
    }


# ── A · Global Search ────────────────────────────────────────────────


@router.get("/api/search")
async def global_search(
    request: Request,
    q: str = Query(""),
    limit: int = 8,
    user=Depends(require_user),
):
    """Role-aware cross-collection search.

    * **Patients** see: their own bookings/Rx/certificates · diseases ·
      patient education · surgery guides · blog posts · calculators.
    * **Staff (owner/doctor/reception/etc.)** see: patients · bookings ·
      Rx · surgeries · IPD admissions (full clinical search).
    """
    qs = (q or "").strip()
    if len(qs) < 2:
        return {"q": qs, "results": []}

    role = (user or {}).get("role") or ""
    if role == "patient":
        return await _patient_search(qs, user, limit)
    if role in STAFF_ROLES:
        return await _staff_search(qs, request, user, limit)
    # Unknown role → safe minimal patient search.
    return await _patient_search(qs, user, limit)


# ── Patient-side search ──────────────────────────────────────────────


def _localised_text(field: Any, lang: str = "en") -> str:
    """Pull `field['en']` (or any chosen language) safely from a
    bilingual dict, or return the value as-is if already a string."""
    if isinstance(field, dict):
        return str(field.get(lang) or field.get("en") or next(iter(field.values()), ""))
    return str(field or "")


def _content_match(haystack: str, rx: re.Pattern) -> bool:
    return bool(haystack) and bool(rx.search(haystack))


async def _patient_search(qs: str, user: Dict[str, Any], limit: int) -> Dict[str, Any]:
    rx = re.compile(re.escape(qs), re.IGNORECASE)
    lang = "en"
    results: List[Dict[str, Any]] = []

    # 1) DISEASES — title/tagline/overview/symptoms
    if _dis_list:
        try:
            for d in _dis_list(lang):
                hay = " ".join([
                    d.get("name") or "",
                    d.get("tagline") or "",
                    d.get("overview") or "",
                    " ".join(d.get("symptoms") or []) if isinstance(d.get("symptoms"), list) else str(d.get("symptoms") or ""),
                ])
                if _content_match(hay, rx):
                    results.append({
                        "type": "disease",
                        "title": d.get("name") or "Disease",
                        "subtitle": d.get("tagline") or "",
                        "link": f"/disease/{d.get('id')}" if d.get("id") else None,
                    })
                    if len([r for r in results if r["type"] == "disease"]) >= limit:
                        break
        except Exception:
            pass

    # 2) EDUCATION articles
    if _edu_list:
        try:
            for a in _edu_list(lang):
                hay = " ".join([
                    a.get("title") or "",
                    a.get("summary") or "",
                    a.get("details") or "",
                ])
                if _content_match(hay, rx):
                    results.append({
                        "type": "education",
                        "title": a.get("title") or "Article",
                        "subtitle": a.get("summary") or "",
                        "link": f"/education/{a.get('id')}" if a.get("id") else "/education",
                    })
                    if len([r for r in results if r["type"] == "education"]) >= limit:
                        break
        except Exception:
            pass

    # 3) SURGERY GUIDES
    try:
        for g in _GUIDES_ALL:
            name = _localised_text(g.get("name"), lang)
            aliases = " ".join(g.get("aliases") or [])
            if _content_match(name + " " + aliases + " " + (g.get("key") or ""), rx):
                results.append({
                    "type": "guide",
                    "title": name or g.get("key") or "Guide",
                    "subtitle": f"Recovery, dos & don'ts · {g.get('hospital_stay_days') or '?'} day stay",
                    "link": f"/guides/{g.get('key')}",
                })
    except Exception:
        pass

    # 4) BLOG POSTS — only published ones.
    try:
        blog_q: Dict[str, Any] = {
            "published": True,
            "$or": [
                {"title": rx},
                {"summary": rx},
                {"slug": rx},
                {"tags": rx},
            ],
        }
        async for r in db.blog_posts.find(blog_q, {"_id": 0}).sort("created_at", -1).limit(limit):
            results.append({
                "type": "blog",
                "title": r.get("title") or "Article",
                "subtitle": r.get("summary") or "",
                "link": f"/blog/{r.get('post_id')}" if r.get("post_id") else "/blog",
            })
    except Exception:
        pass

    # 5) CALCULATORS — local hard-coded list (cheap).
    for c in _CALC_ROUTES:
        if _content_match(c["title"] + " " + c["subtitle"] + " " + c["key"], rx):
            results.append({
                "type": "calculator",
                "title": c["title"],
                "subtitle": c["subtitle"],
                "link": c["link"],
            })

    # 6) PATIENT'S OWN RECORDS — bookings, Rx, certificates that match
    # the logged-in patient. We accept matches on either phone OR email,
    # because Google-OAuth patients may not have a phone on file at first
    # login. We also look up the canonical patient record so the user can
    # see their own profile from search results too.
    own_phone = _ph(user.get("phone") or "")
    own_email = (user.get("email") or "").strip().lower()

    # Try to enrich own_phone from the patients collection by email if
    # the session itself didn't carry a phone.
    if not own_phone and own_email:
        try:
            me = await db.patients.find_one({"email": own_email}, {"_id": 0, "phone": 1})
            if me and me.get("phone"):
                own_phone = _ph(me.get("phone"))
        except Exception:
            pass

    own_or: List[Dict[str, Any]] = []
    if own_phone:
        suffix = own_phone[-10:]
        own_or.append({"patient_phone": {"$regex": suffix + "$"}})
    if own_email:
        own_or.append({"patient_email": own_email})

    if own_or:
        identity_q: Dict[str, Any] = {"$or": own_or} if len(own_or) > 1 else own_or[0]
        try:
            async for r in db.bookings.find({**identity_q, "$or": [
                {"reason": rx}, {"purpose": rx}, {"booking_id": rx}, {"department": rx},
            ]}, {"_id": 0}).sort("created_at", -1).limit(5):
                results.append({
                    "type": "my_booking",
                    "title": f"My booking — {r.get('date') or ''}",
                    "subtitle": f"{r.get('time_slot') or ''} · {r.get('reason') or r.get('purpose') or 'Consult'}",
                    "link": f"/bookings/{r.get('booking_id')}" if r.get("booking_id") else None,
                })
        except Exception:
            pass
        try:
            async for r in db.prescriptions.find({**identity_q, "$or": [
                {"diagnosis": rx}, {"prescription_id": rx}, {"rx_id": rx},
            ]}, {"_id": 0}).sort("created_at", -1).limit(5):
                rid = r.get("prescription_id") or r.get("rx_id")
                results.append({
                    "type": "my_prescription",
                    "title": f"My Rx — {r.get('diagnosis') or 'Prescription'}",
                    "subtitle": (r.get("doctor_name") or ""),
                    "link": f"/prescriptions/{rid}" if rid else None,
                })
        except Exception:
            pass

    # Dedupe by (type, link or title).
    seen, deduped = set(), []
    for item in results:
        key = (item.get("type"), item.get("link") or item.get("title"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return {"q": qs, "count": len(deduped), "results": deduped[: max(20, limit * 5)], "scope": "patient"}


# ── Staff-side search ────────────────────────────────────────────────


async def _staff_search(qs: str, request: Request, user: Dict[str, Any], limit: int) -> Dict[str, Any]:
    clinic_id = await resolve_clinic_id(request, user)
    tenant = tenant_filter(user, clinic_id, allow_global=True)

    # Build a safe regex (escape user input, case-insensitive).
    rx = re.compile(re.escape(qs), re.IGNORECASE)
    suffix = re.sub(r"\D", "", qs)[-10:] if re.search(r"\d", qs) else ""

    results: List[Dict[str, Any]] = []

    # 1) Patients (by name / phone / reg-no)
    patient_q: Dict[str, Any] = {
        "$or": [
            {"name": rx},
            {"phone": rx},
            {"reg_no": rx},
            {"registration_no": rx},
        ]
    }
    async for r in db.patients.find(patient_q, {"_id": 0}).limit(limit):
        results.append({
            "type": "patient",
            "title": r.get("name") or "(no name)",
            "subtitle": " · ".join(
                v for v in [r.get("phone"), r.get("reg_no") or r.get("registration_no")] if v
            ),
            "phone": r.get("phone"),
            "link": (
                f"/patient-db/{r.get('phone')}" if r.get("phone") else None
            ),
        })

    # 2) Bookings (by patient name / phone / booking_id)
    booking_q: Dict[str, Any] = {
        **tenant,
        "$or": [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"booking_id": rx},
        ],
    }
    async for r in db.bookings.find(booking_q, {"_id": 0}).sort("created_at", -1).limit(limit):
        results.append({
            "type": "booking",
            "title": f"{r.get('patient_name') or '?'} — {r.get('date') or ''}",
            "subtitle": (
                f"{r.get('time_slot') or ''} · "
                f"{r.get('reason') or r.get('purpose') or 'Consult'}"
            ),
            "phone": r.get("patient_phone"),
            "link": f"/bookings/{r.get('booking_id')}" if r.get("booking_id") else None,
        })

    # 3) Prescriptions
    rx_q: Dict[str, Any] = {
        **tenant,
        "$or": [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"diagnosis": rx},
            {"prescription_id": rx},
            {"rx_id": rx},
        ],
    }
    async for r in db.prescriptions.find(rx_q, {"_id": 0}).sort("created_at", -1).limit(limit):
        results.append({
            "type": "prescription",
            "title": f"Rx — {r.get('patient_name') or '?'}",
            "subtitle": f"{r.get('diagnosis') or '—'}",
            "phone": r.get("patient_phone"),
            "link": (
                f"/prescriptions/{r.get('prescription_id') or r.get('rx_id')}"
                if (r.get("prescription_id") or r.get("rx_id")) else None
            ),
        })

    # 4) Surgeries
    sx_q: Dict[str, Any] = {
        **tenant,
        "$or": [
            {"patient_name": rx},
            {"patient_phone": rx},
            {"surgery_name": rx},
            {"diagnosis": rx},
            {"surgery_id": rx},
        ],
    }
    async for r in db.surgeries.find(sx_q, {"_id": 0}).sort("created_at", -1).limit(limit):
        results.append({
            "type": "surgery",
            "title": f"{r.get('surgery_name') or 'Surgery'} — {r.get('patient_name') or '?'}",
            "subtitle": f"{r.get('date') or ''} · {r.get('hospital') or ''}".strip(' ·'),
            "phone": r.get("patient_phone"),
            "link": f"/surgeries/{r.get('surgery_id')}" if r.get("surgery_id") else None,
        })

    # 5) IPD admissions
    try:
        ipd_q: Dict[str, Any] = {
            **tenant,
            "$or": [
                {"patient_name": rx},
                {"patient_phone": rx},
                {"chief_complaint": rx},
                {"diagnosis": rx},
                {"admission_id": rx},
            ],
        }
        async for r in db.ipd_admissions.find(ipd_q, {"_id": 0}).sort("admission_date", -1).limit(limit):
            results.append({
                "type": "ipd",
                "title": f"IPD — {r.get('patient_name') or '?'}",
                "subtitle": (
                    f"Bed {r.get('bed_no') or '—'} · "
                    f"{r.get('admission_date') or ''}"
                ),
                "phone": r.get("patient_phone"),
                "link": f"/ipd/{r.get('admission_id')}" if r.get("admission_id") else None,
            })
    except Exception:
        # ipd_admissions collection might not exist in fresh deployments.
        pass

    # If user typed pure digits, also try suffix-match against phone.
    if suffix and len(suffix) >= 4:
        try:
            phone_suffix = {"patient_phone": {"$regex": suffix + "$"}, **tenant}
            async for r in db.bookings.find(phone_suffix, {"_id": 0}).sort("created_at", -1).limit(4):
                results.append({
                    "type": "booking",
                    "title": f"{r.get('patient_name') or '?'} — {r.get('date') or ''}",
                    "subtitle": f"📞 …{suffix}",
                    "phone": r.get("patient_phone"),
                    "link": f"/bookings/{r.get('booking_id')}" if r.get("booking_id") else None,
                })
        except Exception:
            pass

    # De-duplicate by (type, link or title)
    seen, deduped = set(), []
    for item in results:
        key = (item.get("type"), item.get("link") or item.get("title"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return {"q": qs, "count": len(deduped), "results": deduped[: max(20, limit * 5)], "scope": "staff"}
