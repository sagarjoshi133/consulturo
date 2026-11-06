"""ConsultUro — Doctor info router.

GET /api/doctor — public, returns Dr. Sagar Joshi's profile, services,
qualifications, etc. trilingually (en/hi/gu).

Extracted from server.py during Phase 2 modularization.
"""
from fastapi import APIRouter

router = APIRouter()

_DAYS = [("mon", "Mon"), ("tue", "Tue"), ("wed", "Wed"), ("thu", "Thu"), ("fri", "Fri"), ("sat", "Sat"), ("sun", "Sun")]


def _fmt12(hhmm: str) -> str:
    try:
        h, m = hhmm.split(":")
        h = int(h); m = int(m)
        ap = "AM" if h < 12 else "PM"
        hh = h % 12 or 12
        return f"{hh}:{m:02d} {ap}"
    except Exception:
        return hhmm


async def _centre_hours_from_availability(db, location_ids):
    """Build a compact weekly-hours string per centre from the
    availability doc whose in-person windows are tagged with these
    centres. e.g. {'loc-x': 'Mon–Sat: 9:00 AM–1:00 PM'}."""
    lid_set = set(location_ids)
    av = None
    try:
        # Find the availability doc that actually carries centre-tagged
        # windows (don't guess the user — pick the doc with the data).
        async for doc in db.availability.find({}, {"_id": 0}):
            for dk, _ in _DAYS:
                if any((w.get("location_id") or "") in lid_set for w in (doc.get(f"{dk}_in") or [])):
                    av = doc
                    break
            if av:
                break
    except Exception:
        return {}
    if not av:
        return {}
    out = {}
    for lid in location_ids:
        day_sigs = []
        for dk, _ in _DAYS:
            wins = [w for w in (av.get(f"{dk}_in") or []) if (w.get("location_id") or "") == lid]
            sig = ", ".join(
                f'{_fmt12(w["start"])}–{_fmt12(w["end"])}'
                for w in wins if w.get("start") and w.get("end")
            )
            day_sigs.append(sig)
        segments = []
        i = 0
        while i < 7:
            if not day_sigs[i]:
                i += 1
                continue
            j = i
            while j + 1 < 7 and day_sigs[j + 1] == day_sigs[i]:
                j += 1
            label = _DAYS[i][1] if i == j else f"{_DAYS[i][1]}–{_DAYS[j][1]}"
            segments.append(f"{label}: {day_sigs[i]}")
            i = j + 1
        if segments:
            out[lid] = "   •   ".join(segments)
    return out


@router.get("/api/doctor")
async def get_doctor_info(lang: str = "en"):
    from doctor_content import get_locale as _doc_locale, localize_stats, localize_past_experience
    if lang not in ("en", "hi", "gu"):
        lang = "en"
    loc = _doc_locale(lang)
    stats = localize_stats([
        {"label": "Years of experience", "value": "11+"},
        {"label": "Surgeries performed", "value": "3000+"},
        {"label": "Kidney transplants", "value": "150+"},
        {"label": "Consultations", "value": "15000+"},
    ], lang)
    past_exp = localize_past_experience([
        {"role": "Resident Doctor — General Surgery", "place": "Sir T Hospital, Bhavnagar"},
        {"role": "Senior Resident — General Surgery", "place": "Sir T Hospital, Bhavnagar"},
        {"role": "Assistant Professor — General Surgery", "place": "Shantabaa Medical College & Civil Hospital"},
        {"role": "Urology Resident (DrNB)", "place": "Gleneagles Super-speciality Hospital & Transplant Centre, Parel, Mumbai"},
    ], lang)
    base = {
        "name": "Dr. Sagar Joshi",
        "title": loc["title"],
        "tagline": loc["tagline"],
        "short_bio": loc["short_bio"],
        "personal_statement": loc["personal_statement"],
        "stats": stats,
        "highlights": loc["highlights"],
        "languages": ["English", "Gujarati", "Hindi"],
        "qualifications": [
            {"degree": "MBBS", "institute": "Government Medical College, Bhavnagar", "year": "2014", "note": "Bachelor of Medicine and Bachelor of Surgery."},
            {"degree": "MS (General Surgery)", "institute": "Government Medical College, Bhavnagar", "year": "2018", "note": "Master of Surgery — comprehensive training in open and laparoscopic general surgery."},
            {
                "degree": "DrNB Urology",
                "institute": "Gleneagles Global Hospital, Parel, Mumbai",
                "year": "2022",
                "note": "Super-specialty board certification in Urology. Trained in endourology, advanced laparoscopy, robotic surgery, laser lithotripsy, prostate laser surgery, kidney transplantation, vascular access for haemodialysis and urologic ultrasonography.",
            },
        ],
        "past_experience": past_exp,
        "memberships": [
            {"name": "Urological Society of India (USI)", "icon": "ribbon"},
            {"name": "Association of Surgeons of India (ASI)", "icon": "ribbon"},
            {"name": "Indian Medical Association (IMA)", "icon": "ribbon"},
        ],
        "clinics": [
            {"name": "Sterling Hospitals, Race Course", "address": "Opp. Inox Cinema, Race Course Road, Vadodara, Gujarat", "hours": "Mon–Sat, 10:00 AM – 1:00 PM"},
            {"name": "Sterling Hospitals, Bhayli", "address": "Behind Waves Club, Bhayli, Vadodara – 391410, Gujarat", "hours": "Mon–Sat, 5:00 PM – 8:00 PM"},
        ],
        "availability": {
            "mon_sat": loc["availability_phrases"]["mon_sat"],
            "sunday": loc["availability_phrases"]["sunday"],
            "whatsapp": "+91 81550 75669",
        },
        "service_categories": [
            {
                "title": "Kidney & Stone",
                "icon": "water",
                "items": [
                    "Laser Stone Surgery (RIRS)",
                    "PCNL (Percutaneous)",
                    "ESWL (Shock-Wave)",
                    "Kidney Cancer Surgery",
                    "Hydronephrosis & PUJ Repair",
                ],
            },
            {
                "title": "Kidney Transplantation",
                "icon": "heart",
                "items": [
                    "Living-donor Kidney Transplant",
                    "Deceased-donor (Cadaveric) Transplant",
                    "ABO-incompatible Transplant",
                    "Pre-transplant Evaluation",
                    "Post-transplant Follow-up & Care",
                    "Vascular Access for Haemodialysis",
                ],
            },
            {
                "title": "Prostate",
                "icon": "medkit",
                "items": [
                    "HoLEP Laser Prostate Surgery",
                    "TURP (Bipolar / Saline)",
                    "MRI-targeted Prostate Biopsy",
                    "Prostate Cancer Surgery",
                    "PSA & IPSS Screening",
                ],
            },
            {
                "title": "Laparoscopy & Robotics",
                "icon": "hardware-chip",
                "items": [
                    "Laparoscopic Nephrectomy",
                    "Laparoscopic Pyeloplasty",
                    "Laparoscopic Adrenalectomy",
                    "Robotic-assisted Urology",
                ],
            },
            {
                "title": "Male Health & Andrology",
                "icon": "male",
                "items": [
                    "Erectile Dysfunction",
                    "Male Infertility",
                    "Peyronie's Disease",
                    "Varicocelectomy",
                    "Vasectomy",
                    "Circumcision",
                ],
            },
            {
                "title": "Bladder, Female & General Urology",
                "icon": "people",
                "items": [
                    "Bladder Cancer (TURBT)",
                    "Urinary Incontinence",
                    "Recurrent UTI",
                    "Urethral Stricture",
                    "Paediatric Urology",
                ],
            },
        ],
        # Flat list retained for legacy clients (chips rendering)
        "services": [
            "Kidney Stone Treatment (Laser / RIRS / PCNL)",
            "Prostate (BPH) Laser Surgery (HoLEP / TURP)",
            "Urologic Cancer Surgery (Kidney, Prostate, Bladder)",
            "Advanced Laparoscopy & Robotic Urology",
            "Kidney Transplantation",
            "Male Infertility & Andrology",
            "Erectile Dysfunction Management",
            "Female Urology & Incontinence",
            "Paediatric Urology",
            "Endourology & URSL",
        ],
        "contact": {
            "whatsapp": "+918155075669",
            "phone": "+918155075669",
            "email": "contact@drsagarjoshi.com",
            "website": "https://www.drsagarjoshi.com",
        },
        "socials": {
            "website": "https://www.drsagarjoshi.com",
            "youtube": "https://www.youtube.com/@dr_sagar_j",
            "facebook": "https://www.facebook.com/drsagarjoshi1",
            "instagram": "https://www.instagram.com/sagar_joshi133",
            "twitter": "http://twitter.com/Sagar_j_joshi",
        },
        "photo_url": "https://customer-assets.emergentagent.com/job_urology-pro/artifacts/6ng2cxnu_IMG_20260421_191126.jpg",
    }

    # ── Owner overrides (editable About + multi-centre) ──────────────
    # Merge the owner-editable content stored in clinic_settings over
    # the defaults so the public About page reflects their edits.
    try:
        from db import db as _db
        # Prefer a real clinic's settings (where the owner's edits land)
        # over the legacy "default" doc. Single-practice deployments keep
        # their About + centres on their own clinic_settings document.
        cs = await _db.clinic_settings.find_one(
            {"_id": {"$ne": "default"},
             "$or": [{"locations": {"$exists": True, "$not": {"$size": 0}}},
                     {"about_overrides": {"$nin": [None, {}]}}]},
            {"_id": 0, "about_overrides": 1, "locations": 1},
        )
        if not cs:
            cs = await _db.clinic_settings.find_one({"_id": "default"}, {"_id": 0, "about_overrides": 1, "locations": 1})
        cs = cs or {}
    except Exception:
        cs = {}

    locations = cs.get("locations") or []
    if locations:
        hours_map = await _centre_hours_from_availability(_db, [l.get("id") for l in locations if l.get("id")])
        base["clinics"] = [
            {
                "id": loc.get("id"),
                "name": loc.get("name", ""),
                "address": loc.get("address", ""),
                "map_url": loc.get("map_url", ""),
                # Prefer hours auto-derived from the weekly availability
                # schedule; fall back to any manually-entered string.
                "hours": hours_map.get(loc.get("id"), "") or loc.get("hours", ""),
                "request_only": bool(loc.get("request_only")),
            }
            for loc in locations
            if loc.get("active", True) and (loc.get("name") or loc.get("address"))
        ]

    ov = cs.get("about_overrides") or {}
    if isinstance(ov, dict):
        for k, v in ov.items():
            # Only override known keys that carry a real value; language
            # specific bio overrides are handled by clinic-settings merge
            # in the client, so we skip empty strings / None.
            if v in (None, "", [], {}):
                continue
            base[k] = v

    return base
