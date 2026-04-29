"""ConsultUro — Doctor info router.

GET /api/doctor — public, returns Dr. Sagar Joshi's profile, services,
qualifications, etc. trilingually (en/hi/gu).

Extracted from server.py during Phase 2 modularization.
"""
from fastapi import APIRouter

router = APIRouter()


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
    return {
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
