"""
ConsultUro — Pre-operative checklist library + Op-note templates.

Phase 3.2 — defines the 12-item universal pre-op checklist (trilingual)
that every surgery must complete before transitioning from
"scheduled" → "in_progress".

Phase 3.3 — defines per-procedure operative-note skeletons that
auto-fill the surgeon's `operative_findings` field. We keep these
short, neutral and editable — the surgeon ALWAYS reviews and
overrides on completion.
"""

from typing import Dict, List, Any


# ────────────────────────────────────────────────────────────────────
# Pre-op checklist — 12 universal items
# ────────────────────────────────────────────────────────────────────

# `critical=True` items must be ✓ before the surgery can be marked
# in_progress. `critical=False` items are recommended but not blocking.

PREOP_CHECKLIST: List[Dict[str, Any]] = [
    {
        "key": "consent_signed",
        "critical": True,
        "label": {
            "en": "Surgical consent signed (patient + witness)",
            "hi": "सर्जिकल सहमति पत्र पर हस्ताक्षर (रोगी + गवाह)",
            "gu": "સર્જિકલ સંમતિ પત્ર પર સહી (દર્દી + સાક્ષી)",
        },
        "hint": {
            "en": "Use the Surgical Consents module to capture both signatures.",
            "hi": "दोनों हस्ताक्षर लेने के लिए सर्जिकल कंसेंट मॉड्यूल का उपयोग करें।",
            "gu": "બંને સહીઓ માટે સર્જિકલ સંમતિ મોડ્યુલનો ઉપયોગ કરો.",
        },
    },
    {
        "key": "npo_confirmed",
        "critical": True,
        "label": {
            "en": "Nil-by-mouth (NPO) confirmed (≥6 h)",
            "hi": "उपवास (NPO) पुष्टि (≥6 घंटे)",
            "gu": "ઉપવાસ (NPO) ખાતરી (≥6 કલાક)",
        },
        "hint": {"en": "Solids 6 h, clear fluids 2 h before induction.", "hi": "", "gu": ""},
    },
    {
        "key": "id_band_verified",
        "critical": True,
        "label": {
            "en": "ID band + side marking verified",
            "hi": "ID बैंड + पक्ष चिह्न सत्यापित",
            "gu": "ID બેન્ડ + બાજુ ચિહ્ન ચકાસેલ",
        },
        "hint": {"en": "Cross-check with the patient before transfer to OT.", "hi": "", "gu": ""},
    },
    {
        "key": "anesthesia_clearance",
        "critical": True,
        "label": {
            "en": "Anaesthesia fitness clearance",
            "hi": "एनेस्थीसिया फिटनेस मंजूरी",
            "gu": "એનેસ્થેસિયા ફિટનેસ મંજૂરી",
        },
        "hint": {"en": "PAC done; ASA grade noted.", "hi": "", "gu": ""},
    },
    {
        "key": "fitness_clearance",
        "critical": True,
        "label": {
            "en": "Medical / cardiac fitness clearance",
            "hi": "मेडिकल / कार्डियक फिटनेस मंजूरी",
            "gu": "મેડિકલ / હૃદય ફિટનેસ મંજૂરી",
        },
        "hint": {"en": "ECG + Echo + physician note where indicated.", "hi": "", "gu": ""},
    },
    {
        "key": "blood_work",
        "critical": True,
        "label": {
            "en": "Pre-op blood work reviewed (CBC, coag, KFT, LFT)",
            "hi": "प्री-ऑप रक्त जांच की समीक्षा (CBC, coag, KFT, LFT)",
            "gu": "પ્રી-ઓપ બ્લડ ટેસ્ટ સમીક્ષા (CBC, coag, KFT, LFT)",
        },
        "hint": {"en": "INR within range; flag if anticoagulated.", "hi": "", "gu": ""},
    },
    {
        "key": "imaging_reviewed",
        "critical": False,
        "label": {
            "en": "Imaging available & reviewed",
            "hi": "इमेजिंग उपलब्ध और समीक्षित",
            "gu": "ઇમેજિંગ ઉપલબ્ધ અને સમીક્ષિત",
        },
        "hint": {"en": "USG / CT KUB / MRI as relevant.", "hi": "", "gu": ""},
    },
    {
        "key": "allergies_marked",
        "critical": True,
        "label": {
            "en": "Allergies / drug reactions documented",
            "hi": "एलर्जी / दवा प्रतिक्रिया दर्ज",
            "gu": "એલર્જી / દવા પ્રતિક્રિયા દસ્તાવેજિત",
        },
        "hint": {"en": "Antibiotic, latex, contrast — write 'NIL' if none.", "hi": "", "gu": ""},
    },
    {
        "key": "antibiotic_dose",
        "critical": False,
        "label": {
            "en": "Pre-op antibiotic dose given on time",
            "hi": "प्री-ऑप एंटीबायोटिक खुराक समय पर दी गई",
            "gu": "પ્રી-ઓપ એન્ટિબાયોટિક ડોઝ સમયસર આપેલ",
        },
        "hint": {"en": "Within 60 min of incision (AASUS guideline).", "hi": "", "gu": ""},
    },
    {
        "key": "blood_reserved",
        "critical": False,
        "label": {
            "en": "Blood/components reserved (if needed)",
            "hi": "रक्त/घटक आरक्षित (यदि आवश्यक)",
            "gu": "બ્લડ/કમ્પોનન્ટ આરક્ષિત (જો જરૂરી)",
        },
        "hint": {"en": "Cross-match for PCNL, open neph, RP.", "hi": "", "gu": ""},
    },
    {
        "key": "equipment_ready",
        "critical": True,
        "label": {
            "en": "Required equipment & implants ready",
            "hi": "आवश्यक उपकरण और प्रत्यारोपण तैयार",
            "gu": "જરૂરી સાધનો અને ઇમ્પ્લાન્ટ તૈયાર",
        },
        "hint": {"en": "Scopes, laser, stents, mesh — confirmed with OT staff.", "hi": "", "gu": ""},
    },
    {
        "key": "consent_to_proceed",
        "critical": True,
        "label": {
            "en": "Final time-out / WHO surgical safety checklist done",
            "hi": "अंतिम टाइम-आउट / WHO सर्जिकल सुरक्षा चेकलिस्ट",
            "gu": "અંતિમ ટાઇમ-આઉટ / WHO સર્જિકલ સુરક્ષા ચેકલિસ્ટ",
        },
        "hint": {"en": "Team huddle just before incision.", "hi": "", "gu": ""},
    },
]


def get_preop_checklist() -> List[Dict[str, Any]]:
    """Return a copy of the checklist (defensive — callers may mutate)."""
    return [dict(item) for item in PREOP_CHECKLIST]


# ────────────────────────────────────────────────────────────────────
# Op-note templates — Phase 3.3
# ────────────────────────────────────────────────────────────────────
# Keyed by procedure_key (matching consent_procedures.py). Each
# template is a multi-line skeleton; placeholders use {{TOKEN}} so the
# surgeon's UI can highlight & jump to each placeholder.
# Surgeons are EXPECTED to override every line — this is just to
# avoid blank-page syndrome.

OP_NOTE_TEMPLATES: Dict[str, str] = {
    "turp": (
        "Pre-operative diagnosis: Benign Prostatic Hyperplasia.\n"
        "Procedure: Transurethral Resection of Prostate.\n"
        "Anaesthesia: {{SAB / GA / Epidural}}.\n"
        "Position: Lithotomy.\n"
        "Findings: Enlarged prostate, approx {{X g}} on cystoscopy. "
        "Bladder mucosa healthy; ureteric orifices visualised normally.\n"
        "Procedure performed: Resection done using {{mono / bipolar}} loop. "
        "Chips evacuated. Haemostasis achieved with cautery to bleeders. "
        "3-way 22Fr Foley catheter placed; bladder irrigation started.\n"
        "Estimated blood loss: {{ml}}.\n"
        "Complications: None.\n"
        "Specimen sent for histopathology."
    ),
    "turbt": (
        "Pre-operative diagnosis: Bladder tumour ({{location, size}}).\n"
        "Procedure: TURBT (Transurethral Resection of Bladder Tumour).\n"
        "Anaesthesia: {{SAB / GA}}.\n"
        "Findings: {{Number / location / size / morphology}} bladder mass(es).\n"
        "Procedure: Resection in segments to muscularis propria. "
        "Cold-cup biopsies of base. Random bladder biopsies as indicated. "
        "Haemostasis achieved. 3-way Foley placed with continuous irrigation.\n"
        "Complications: None.\n"
        "Specimen labeled and sent for HPE."
    ),
    "urs_dj": (
        "Pre-operative diagnosis: Ureteric calculus, {{side}}.\n"
        "Procedure: Ureteroscopy + Pneumatic/Holmium lithotripsy + DJ stenting.\n"
        "Anaesthesia: {{SAB / GA}}.\n"
        "Findings: Stone of {{size}} mm at {{level}} of the ureter.\n"
        "Procedure: Cystoscopy + retrograde access. Semi-rigid URS. "
        "Stone fragmented and cleared. DJ stent {{6Fr × 26 cm}} positioned. "
        "Position confirmed on fluoroscopy.\n"
        "Complications: None.\n"
        "Stent removal advised after {{X weeks}}."
    ),
    "rirs": (
        "Pre-operative diagnosis: Renal calculus ({{side, size}}).\n"
        "Procedure: Retrograde Intra-Renal Surgery (RIRS) + holmium laser "
        "lithotripsy + DJ stent.\n"
        "Anaesthesia: GA.\n"
        "Findings: Stone(s) of {{total size}} mm in {{calyx}}.\n"
        "Procedure: Access sheath placed. Flexible URS used. "
        "Stones fragmented with holmium laser (settings: {{Hz × J}}). "
        "Fragments dusted; visualised clearance. DJ stent placed.\n"
        "Complications: None.\n"
        "Plan: Stent removal after 2 weeks; KUB review at 4 weeks."
    ),
    "pcnl": (
        "Pre-operative diagnosis: Renal/staghorn calculus ({{side}}).\n"
        "Procedure: Percutaneous Nephrolithotomy.\n"
        "Anaesthesia: GA.\n"
        "Position: Prone / supine.\n"
        "Findings: {{Size / location}} renal calculus.\n"
        "Procedure: Cystoscopy + retrograde ureteric catheterisation. "
        "Puncture of {{calyx}} under USG/fluoro guidance. Tract dilated to "
        "{{24/30 Fr}}. Nephroscope passed; stones fragmented with "
        "{{pneumatic / laser}} lithotripter and cleared. Check nephroscopy: "
        "stone-free / residual fragment of {{size}}. Nephrostomy tube placed.\n"
        "Estimated blood loss: {{ml}}.\n"
        "Complications: None."
    ),
    "circumcision": (
        "Procedure: Circumcision.\n"
        "Anaesthesia: {{LA / GA}}.\n"
        "Findings: Phimotic / non-retractable foreskin.\n"
        "Procedure: Dorsal slit + circumferential excision of foreskin. "
        "Haemostasis achieved with bipolar diathermy. "
        "Closure with {{4-0 Vicryl rapide}}.\n"
        "Complications: None."
    ),
    "varicocelectomy": (
        "Pre-operative diagnosis: Left/right grade {{II/III}} varicocele.\n"
        "Procedure: Sub-inguinal microscopic varicocelectomy.\n"
        "Anaesthesia: {{LA + sedation / GA}}.\n"
        "Findings: Dilated pampiniform plexus.\n"
        "Procedure: Sub-inguinal incision. Spermatic cord delivered. "
        "Under microscope, internal spermatic veins ligated; artery and "
        "lymphatics preserved. Vas + lymphatics identified and protected.\n"
        "Complications: None."
    ),
    "hydrocele_repair": (
        "Procedure: Hydrocele repair ({{Lord's / Jaboulay}}).\n"
        "Anaesthesia: {{SAB / LA}}.\n"
        "Findings: Tense fluid-filled tunica vaginalis, approx {{ml}}.\n"
        "Procedure: Scrotal incision. Hydrocele sac delivered, "
        "fluid drained, sac plicated/everted. Haemostasis achieved. "
        "Closure in layers.\n"
        "Complications: None."
    ),
    "vasectomy": (
        "Procedure: Bilateral no-scalpel vasectomy.\n"
        "Anaesthesia: LA.\n"
        "Procedure: Vas identified and delivered through small midline "
        "scrotal puncture. 1 cm segment excised, ends clipped and "
        "fulgurated, fascia interposed. Same on the other side.\n"
        "Counselling: Use contraception until azoospermia confirmed at "
        "12 weeks.\n"
        "Complications: None."
    ),
    "cystoscopy": (
        "Procedure: Diagnostic cystoscopy.\n"
        "Anaesthesia: {{LA gel / SAB}}.\n"
        "Findings: Urethra normal / {{stricture}}. Prostate "
        "{{trilobar / asymmetric}}. Bladder mucosa healthy. "
        "Ureteric orifices normal bilaterally.\n"
        "Procedure: Scope withdrawn after thorough inspection.\n"
        "Complications: None."
    ),
    "dj_removal": (
        "Procedure: DJ stent removal under cystoscopic guidance.\n"
        "Anaesthesia: LA gel.\n"
        "Findings: Stent in situ. No encrustation.\n"
        "Procedure: Stent grasped and removed in toto. "
        "Bladder inspected — normal.\n"
        "Complications: None."
    ),
    "prostate_biopsy": (
        "Procedure: TRUS-guided prostate biopsy (12 cores).\n"
        "Anaesthesia: LA (peri-prostatic block).\n"
        "Findings: Prostate {{volume}} cc; PSA {{X}}.\n"
        "Procedure: Pre-procedure antibiotic given. Twelve systematic "
        "cores obtained from the apex, mid-zone, base bilaterally with "
        "additional targeted cores if suspicious lesion.\n"
        "Complications: None.\n"
        "Specimen labelled and sent for HPE."
    ),
}


def get_op_note_template(procedure_key: str | None) -> str:
    """Return the procedure-specific op-note skeleton, or a generic
    one when we don't have a curated template yet."""
    if procedure_key and procedure_key in OP_NOTE_TEMPLATES:
        return OP_NOTE_TEMPLATES[procedure_key]
    return (
        "Pre-operative diagnosis: {{...}}.\n"
        "Procedure: {{...}}.\n"
        "Anaesthesia: {{...}}.\n"
        "Findings: {{...}}.\n"
        "Procedure performed: {{...}}.\n"
        "Estimated blood loss: {{...}} ml.\n"
        "Complications: None.\n"
        "Plan: {{...}}."
    )
