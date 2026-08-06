"""
Phase 5.12 (Phase F) — Backend regression for the new Discharge Summary
`operative_note` field on ConsultUro.

Tests against http://localhost:8001/api with the pre-seeded OWNER token
(primary_owner: sagar.joshi133@gmail.com).
"""
import os
import sys
import json
import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"
HEADERS = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "Content-Type": "application/json",
}

PASS = []
FAIL = []
created_admission_ids: list = []


def _check(cond: bool, label: str, extra: str = ""):
    if cond:
        PASS.append(label)
        print(f"  ✅ {label}")
    else:
        FAIL.append(f"{label} {extra}")
        print(f"  ❌ {label} {extra}")


def step_1_create_admission(suffix: str = "OpNote") -> str:
    print(f"\n=== STEP 1 — Create Admission ({suffix}) ===")
    payload = {
        "patient_name": f"Phase F {suffix} Patient",
        "patient_phone": "9876512999",
        "patient_age": 52,
        "patient_sex": "male",
        "ward": "General",
        "diagnosis": "Right ureteric calculus 8mm",
        "consulting_doctor": "Dr. Sagar Joshi",
        "presenting_complaints": "Right loin pain, mild dysuria",
        "planned_procedure": "Right URSL + DJ stenting",
    }
    r = requests.post(f"{BASE}/ipd/admissions", headers=HEADERS, json=payload, timeout=30)
    print(f"  POST /ipd/admissions → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  Body: {r.text[:500]}")
        FAIL.append(f"step1_create_admission_{suffix}: HTTP {r.status_code}")
        return ""
    body = r.json()
    aid = body.get("id")
    ipd_no = body.get("ipd_no")
    print(f"  admission_id={aid}, ipd_no={ipd_no}")
    _check(bool(aid), f"step1_{suffix}_admission_id_present")
    _check(body.get("status") == "active", f"step1_{suffix}_status_active")
    if aid:
        created_admission_ids.append(aid)
    return aid or ""


def step_2_discharge_with_op_note(aid: str) -> bool:
    print("\n=== STEP 2 — Discharge with operative_note ===")
    op_note = (
        "Indication: 8mm distal right ureteric calculus with mild HDUN.\n"
        "Anaesthesia: Spinal.\nPosition: Lithotomy.\n"
        "Incision/Access: Cystoscopic, semi-rigid 8.5/9.5 Fr URS.\n"
        "Procedure: URS advanced under direct vision to mid-ureter. 8mm stone "
        "visualised at distal ureter, fragmented with holmium laser. All fragments "
        "retrieved with stone-cone basket. Antegrade DJ 6Fr stent placed under "
        "fluoroscopy guidance, coil confirmed in renal pelvis & bladder.\n"
        "Findings: Solitary 8mm distal ureteric stone, mild mucosal oedema, no perforation.\n"
        "Blood loss: <30 ml.\nComplications: Nil.\nClosure: Foley 16Fr left per urethra.\n"
        "Post-op orders: IV Ceftriaxone 1g BD x 24h; PCM-tramadol PRN; remove Foley "
        "POD-1 if voiding adequate; DJ removal at 2 weeks."
    )
    payload = {
        "final_diagnosis": "Right URS calculus — post URSL + DJ stenting",
        "procedures_done": "Right URSL + DJ stenting (06 Fr)",
        "operative_note": op_note,
        "course_in_hospital": (
            "Uneventful. POD-0 ambulated. POD-1 Foley removed, patient voided well. "
            "Pain controlled with PCM-tramadol."
        ),
        "condition_at_discharge": "Stable, voiding well, afebrile",
        "discharge_meds": "Tab Tamsulosin 0.4mg HS x 14 days; Tab PCM 650mg TDS x 5 days",
        "advice": "Maintain hydration ≥2.5 L/day. Avoid heavy lifting for 2 weeks.",
        "follow_up_plan": "DJ stent removal at 2 weeks. Bring discharge summary and old reports.",
        "follow_up_date": "2025-06-13",
    }
    r = requests.post(
        f"{BASE}/ipd/admissions/{aid}/discharge",
        headers=HEADERS,
        json=payload,
        timeout=30,
    )
    print(f"  POST /ipd/admissions/{aid}/discharge → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  Body: {r.text[:600]}")
        FAIL.append(f"step2_discharge: HTTP {r.status_code} body={r.text[:200]}")
        return False
    body = r.json()
    _check(body.get("status") == "discharged", "step2_status_discharged")
    summary = body.get("discharge_summary") or {}
    stored_op = summary.get("operative_note") or ""
    _check(
        stored_op == op_note,
        "step2_operative_note_exact_match",
        extra=f"(len_stored={len(stored_op)} vs len_expected={len(op_note)})",
    )
    _check(
        summary.get("final_diagnosis") == payload["final_diagnosis"],
        "step2_final_diagnosis_persisted",
    )
    _check(
        summary.get("procedures_done") == payload["procedures_done"],
        "step2_procedures_done_persisted",
    )
    _check(
        summary.get("follow_up_date") == payload["follow_up_date"],
        "step2_follow_up_date_persisted",
    )
    return True


def step_3_get_discharge_summary(aid: str) -> bool:
    print("\n=== STEP 3 — GET discharge-summary (verbatim check) ===")
    r = requests.get(
        f"{BASE}/ipd/admissions/{aid}/discharge-summary",
        headers=HEADERS,
        timeout=30,
    )
    print(f"  GET /ipd/admissions/{aid}/discharge-summary → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  Body: {r.text[:600]}")
        FAIL.append(f"step3_get_summary: HTTP {r.status_code}")
        return False
    body = r.json()
    adm = body.get("admission") or {}
    ds = adm.get("discharge_summary") or {}
    op_note = ds.get("operative_note") or ""
    print(f"  operative_note length: {len(op_note)}")
    _check("holmium laser" in op_note.lower(), "step3_contains_holmium_laser_ci")
    _check(
        "8mm distal" in op_note.lower(),
        "step3_contains_indication_substring",
    )
    _check(adm.get("status") == "discharged", "step3_admission_status_discharged")
    # Also confirm the clinic letterhead bundle exists
    _check("clinic" in body, "step3_clinic_block_present")
    return True


def step_4_put_edit(aid: str) -> bool:
    print("\n=== STEP 4 — PUT edit discharge-summary (operative_note) ===")
    new_note = "Updated operative note text — sole-test marker XYZ-OP-EDIT."
    r = requests.put(
        f"{BASE}/ipd/admissions/{aid}/discharge-summary",
        headers=HEADERS,
        json={"operative_note": new_note},
        timeout=30,
    )
    print(f"  PUT /ipd/admissions/{aid}/discharge-summary → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  Body: {r.text[:600]}")
        FAIL.append(f"step4_put: HTTP {r.status_code} body={r.text[:200]}")
        return False
    body = r.json()
    ds = body.get("discharge_summary") or {}
    _check(
        ds.get("operative_note") == new_note,
        "step4_put_response_operative_note_updated",
    )
    # Subsequent GET must reflect
    r2 = requests.get(
        f"{BASE}/ipd/admissions/{aid}/discharge-summary",
        headers=HEADERS,
        timeout=30,
    )
    if r2.status_code != 200:
        FAIL.append(f"step4_followup_get HTTP {r2.status_code}")
        return False
    adm = (r2.json().get("admission") or {})
    ds2 = adm.get("discharge_summary") or {}
    op2 = ds2.get("operative_note") or ""
    _check("XYZ-OP-EDIT" in op2, "step4_get_after_put_contains_XYZ-OP-EDIT")
    # Audit fields
    _check("edited_at" in ds2, "step4_edited_at_stamped")
    _check("edited_by_id" in ds2, "step4_edited_by_id_stamped")
    return True


def step_5_legacy_back_compat() -> bool:
    print("\n=== STEP 5 — Legacy back-compat (no operative_note in payload) ===")
    aid = step_1_create_admission(suffix="LegacyOpNote")
    if not aid:
        return False
    legacy_payload = {
        "final_diagnosis": "Right ureteric calculus — post URSL",
        "procedures_done": "Right URSL + DJ stenting",
        "course_in_hospital": "Uneventful.",
        "condition_at_discharge": "Stable",
        "discharge_meds": "Tab Tamsulosin 0.4 HS x 14d",
        "advice": "Hydration",
        "follow_up_plan": "DJ removal 2 weeks",
        "follow_up_date": "2025-06-20",
        # NOTE: operative_note INTENTIONALLY omitted
    }
    r = requests.post(
        f"{BASE}/ipd/admissions/{aid}/discharge",
        headers=HEADERS,
        json=legacy_payload,
        timeout=30,
    )
    print(f"  POST legacy /discharge → HTTP {r.status_code}")
    if r.status_code != 200:
        print(f"  Body: {r.text[:600]}")
        FAIL.append(f"step5_legacy_discharge: HTTP {r.status_code}")
        return False
    body = r.json()
    summary = body.get("discharge_summary") or {}
    op = summary.get("operative_note")
    print(f"  operative_note in stored summary: {op!r}")
    _check(
        op == "" or op is None,
        "step5_operative_note_is_empty_or_absent",
        extra=f"(actual={op!r})",
    )
    _check(body.get("status") == "discharged", "step5_status_discharged")
    # GET endpoint
    r2 = requests.get(
        f"{BASE}/ipd/admissions/{aid}/discharge-summary",
        headers=HEADERS,
        timeout=30,
    )
    if r2.status_code != 200:
        FAIL.append(f"step5_get HTTP {r2.status_code}")
        return False
    ds = (r2.json().get("admission") or {}).get("discharge_summary") or {}
    op2 = ds.get("operative_note", "<<ABSENT>>")
    print(f"  GET → operative_note: {op2!r}")
    _check(
        op2 == "" or op2 is None or op2 == "<<ABSENT>>",
        "step5_get_operative_note_empty_or_absent",
        extra=f"(actual={op2!r})",
    )
    return True


def cleanup():
    print("\n=== CLEANUP — delete created test admissions ===")
    for aid in created_admission_ids:
        try:
            r = requests.delete(f"{BASE}/ipd/admissions/{aid}", headers=HEADERS, timeout=15)
            print(f"  DELETE /ipd/admissions/{aid} → HTTP {r.status_code}")
        except Exception as e:
            print(f"  DELETE failed for {aid}: {e}")


def main():
    print(f"Base URL: {BASE}")
    print(f"Owner token: {OWNER_TOKEN[:24]}…")

    # Sanity
    h = requests.get(f"{BASE}/health", timeout=10).json()
    print(f"Health: {h}")

    aid = step_1_create_admission()
    if not aid:
        print("\n💥 Aborting — admission creation failed.")
        return _final()

    if not step_2_discharge_with_op_note(aid):
        print("\n💥 Aborting after step 2 failure.")
        cleanup()
        return _final()

    step_3_get_discharge_summary(aid)
    step_4_put_edit(aid)
    step_5_legacy_back_compat()
    cleanup()
    _final()


def _final():
    print("\n" + "=" * 60)
    print(f"PASS={len(PASS)}  FAIL={len(FAIL)}")
    if FAIL:
        print("\nFAILED:")
        for f in FAIL:
            print(f"  ❌ {f}")
        sys.exit(1)
    else:
        print("✅ ALL CHECKS PASS")
        sys.exit(0)


if __name__ == "__main__":
    main()
