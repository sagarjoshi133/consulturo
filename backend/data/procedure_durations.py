"""
ConsultUro — Per-procedure estimated OT duration map.

Used by Phase 3 OT Scheduling to pre-fill the "Estimated duration"
field when the doctor picks a procedure. Values are clinical
ball-parks for an experienced urologist — the doctor can override
on every individual surgery if needed.

Keys correspond 1-to-1 with the `key` field in
`backend/data/consent_procedures.py` (50 procedures). Anything
missing here falls back to `DEFAULT_DURATION_MIN`.

Source: Standard endourology / open surgery slot allotments used
by typical Indian tertiary urology setups. Tunable per clinic
later if needed.
"""

DEFAULT_DURATION_MIN: int = 60

# Map: procedure_key -> estimated_duration_min (skin-to-skin, no
# turnover). Anaesthesia setup + recovery NOT included.
PROCEDURE_DURATIONS: dict[str, int] = {
    # ── Endourology ───────────────────────────────────────────────
    "turp":               60,   # Transurethral Resection of Prostate
    "turbt":              45,   # Transurethral Resection of Bladder Tumour
    "urs_dj":             45,   # URS + DJ stenting
    "rirs":               90,   # Retrograde Intra-Renal Surgery
    "pcnl":              120,   # Percutaneous Nephrolithotomy
    "mini_pcnl":         100,
    "eswl":               45,   # Extracorporeal Shock Wave Lithotripsy
    "cystoscopy_biopsy":  30,
    "dviu":               30,   # Direct Vision Internal Urethrotomy
    "bladder_neck_incision": 30,
    "laser_prostate":     75,   # HoLEP / ThuLEP / GreenLight
    # ── Open Surgery ──────────────────────────────────────────────
    "open_nephrectomy":  180,
    "radical_nephrectomy": 180,
    "open_pyelolithotomy": 120,
    "open_ureterolithotomy": 90,
    # ── Reconstruction ────────────────────────────────────────────
    "pyeloplasty":       150,   # Lap / Open
    "ureteric_reimplant": 150,
    "urethroplasty":     180,
    "buccal_urethroplasty": 240,
    "vesicovaginal_fistula_repair": 180,
    # ── Andrology ─────────────────────────────────────────────────
    "circumcision":       30,
    "varicocelectomy":    60,
    "hydrocele_repair":   45,
    "vasectomy":          30,
    "vasovasostomy":     120,
    "penile_prosthesis": 150,
    "testicular_biopsy":  30,
    "orchidopexy":        60,
    "frenuloplasty":      20,
    "meatoplasty":        30,
    # ── Oncology ──────────────────────────────────────────────────
    "radical_prostatectomy": 240,   # RARP / Open
    "radical_cystectomy":    300,
    "partial_nephrectomy":   180,
    "rplnd":                 240,
    "radical_orchidectomy":   60,
    "penectomy":             120,
    # ── Functional ────────────────────────────────────────────────
    "sling_male":          90,
    "midurethral_sling":   45,
    "sacral_neuromodulation": 90,
    "augmentation_cystoplasty": 240,
    "artificial_sphincter": 120,
    # ── Transplant ────────────────────────────────────────────────
    "kidney_transplant":  240,
    "donor_nephrectomy":  180,
    "transplant_biopsy":   30,
    # ── Minor Procedures ──────────────────────────────────────────
    "spc_insertion":      20,
    "catheter_change":    10,
    "ureteric_stent_removal": 15,
    "dj_removal":         15,
    "cystoscopy":         20,
    "rgu_mcu":            30,
    "prostate_biopsy":    30,
    "lithoclast":         60,
}


def get_duration_for(key: str | None) -> int:
    """Return the estimated duration (minutes) for a procedure key,
    or DEFAULT_DURATION_MIN if the key is unknown / missing."""
    if not key:
        return DEFAULT_DURATION_MIN
    return PROCEDURE_DURATIONS.get(key, DEFAULT_DURATION_MIN)
