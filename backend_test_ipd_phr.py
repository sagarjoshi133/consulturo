"""Backend tests — IPD module + PHR consolidator.

Run: python3 /app/backend_test_ipd_phr.py
"""
import json
import os
import sys
import time
import requests
from datetime import datetime, timezone

BASE = os.environ.get("BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
CLINIC_ID = "clinic_a97b903f2fb2"

H_OWNER = {
    "Authorization": f"Bearer {OWNER_TOKEN}",
    "X-Clinic-Id": CLINIC_ID,
    "Content-Type": "application/json",
}
H_NOAUTH = {"X-Clinic-Id": CLINIC_ID, "Content-Type": "application/json"}

PASS = 0
FAIL = 0
FAILURES = []


def check(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {msg}")
    else:
        FAIL += 1
        FAILURES.append(msg)
        print(f"  ❌ {msg}")


def section(title):
    print(f"\n=== {title} ===")


# ──────────────────────────────────────────────────────────────────
# A. IPD MODULE
# ──────────────────────────────────────────────────────────────────
section("A1. POST /api/ipd/beds — configure 3 beds (owner)")
beds_payload = {
    "beds": [
        {"ward": "General", "bed_no": "G-1"},
        {"ward": "General", "bed_no": "G-2"},
        {"ward": "Deluxe", "bed_no": "D-1"},
    ]
}
r = requests.post(f"{BASE}/ipd/beds", headers=H_OWNER, json=beds_payload)
check(r.status_code == 200, f"POST /beds → 200 (got {r.status_code})")
data = r.json() if r.ok else {}
check(data.get("count") == 3, f"3 beds configured (got {data.get('count')})")
bed_ids = [b["id"] for b in data.get("items", [])]
print(f"  bed_ids: {bed_ids}")

section("A1b. GET /api/ipd/beds reflects 3 beds")
r = requests.get(f"{BASE}/ipd/beds", headers=H_OWNER)
check(r.status_code == 200, f"GET /beds → 200 (got {r.status_code})")
beds_data = r.json() if r.ok else {}
check(beds_data.get("count") == 3, f"GET shows 3 beds (got {beds_data.get('count')})")
# spec says bed_id "general-g-1"
target_g1 = "general-g-1"
target_g2 = "general-g-2"
ids_set = {b["id"] for b in beds_data.get("items", [])}
check(target_g1 in ids_set, f"bed_id '{target_g1}' present in {ids_set}")
check(target_g2 in ids_set, f"bed_id '{target_g2}' present in {ids_set}")

section("A2. POST /api/ipd/admissions — admit Test IPD into G-1")
admit_body = {
    "patient_name": "Test IPD",
    "patient_phone": "9000099999",
    "bed_id": target_g1,
    "diagnosis": "L renal stone",
    "planned_procedure": "PCNL",
}
r = requests.post(f"{BASE}/ipd/admissions", headers=H_OWNER, json=admit_body)
check(r.status_code == 200, f"POST /admissions → 200 (got {r.status_code}); body={r.text[:200]}")
adm = r.json() if r.ok else {}
adm_id = adm.get("id")
ipd_no = adm.get("ipd_no")
print(f"  admission_id: {adm_id}  ipd_no: {ipd_no}")
import re
check(bool(re.match(r"^IPD\d{6}\d{3}$", ipd_no or "")), f"ipd_no matches IPDYYMMDDNNN (got {ipd_no})")
check(adm.get("status") == "active", f"status=active (got {adm.get('status')})")
check(adm.get("bed_id") == target_g1, f"bed_id == {target_g1} (got {adm.get('bed_id')})")

section("A3. POST same bed → 409")
r = requests.post(f"{BASE}/ipd/admissions", headers=H_OWNER, json={
    "patient_name": "Duplicate Bed Try",
    "patient_phone": "9000088888",
    "bed_id": target_g1,
    "diagnosis": "Conflict test",
})
check(r.status_code == 409, f"duplicate bed admit → 409 (got {r.status_code}: {r.text[:120]})")

section("A4. GET /beds shows G-1 occupied with current_admission")
r = requests.get(f"{BASE}/ipd/beds", headers=H_OWNER)
beds_d = r.json() if r.ok else {}
g1 = next((b for b in beds_d.get("items", []) if b["id"] == target_g1), None)
check(g1 is not None and g1.get("status") == "occupied", f"G-1 status=occupied (got {g1 and g1.get('status')})")
check(bool(g1 and g1.get("current_admission")), f"G-1 has current_admission populated")
ca = (g1 or {}).get("current_admission") or {}
check(ca.get("ipd_no") == ipd_no, f"current_admission.ipd_no matches (got {ca.get('ipd_no')})")

section("A5. GET /admissions?status=active")
r = requests.get(f"{BASE}/ipd/admissions?status=active", headers=H_OWNER)
check(r.status_code == 200, f"GET /admissions?status=active → 200 (got {r.status_code})")
lst = r.json() if r.ok else {}
ids_in_list = {a.get("id") for a in lst.get("items", [])}
check(adm_id in ids_in_list, f"new admission appears in active list (count={lst.get('count')})")
check((lst.get("count") or 0) >= 1, f"count >= 1 (got {lst.get('count')})")

section("A6. GET /admissions/{id} — detail with empty arrays")
r = requests.get(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER)
check(r.status_code == 200, f"GET detail → 200 (got {r.status_code})")
det = r.json() if r.ok else {}
check("admission" in det and "rounds" in det and "vitals" in det and "drug_chart" in det,
      "detail has admission + rounds + vitals + drug_chart keys")
check(det.get("rounds") == [] and det.get("vitals") == [] and det.get("drug_chart") == [],
      "rounds/vitals/drug_chart are empty arrays initially")

section("A7. POST /vitals 3 times")
for i, vp in enumerate([
    {"bp_sys": 130, "bp_dia": 85, "pulse": 78, "spo2": 98},
    {"bp_sys": 128, "bp_dia": 82, "pulse": 80, "spo2": 97, "temp_c": 37.0},
    {"bp_sys": 124, "bp_dia": 80, "pulse": 76, "spo2": 99, "pain_score": 3},
]):
    r = requests.post(f"{BASE}/ipd/admissions/{adm_id}/vitals", headers=H_OWNER, json=vp)
    check(r.status_code == 200, f"POST /vitals #{i+1} → 200 (got {r.status_code}: {r.text[:120]})")
    time.sleep(0.05)

r = requests.get(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER)
det = r.json() if r.ok else {}
vts = det.get("vitals", [])
check(len(vts) == 3, f"3 vitals returned (got {len(vts)})")
# desc sorted by recorded_at
ts_list = [v.get("recorded_at") for v in vts]
check(ts_list == sorted(ts_list, reverse=True), f"vitals sorted desc by recorded_at: {ts_list}")

section("A8. POST /rounds 2 different notes")
for note in ["Day 1 — stable, planned for PCNL.", "Day 2 — PCNL done, drain in situ."]:
    r = requests.post(f"{BASE}/ipd/admissions/{adm_id}/rounds", headers=H_OWNER, json={"note_text": note})
    check(r.status_code == 200, f"POST /rounds '{note[:25]}...' → 200 (got {r.status_code})")
r = requests.get(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER)
det = r.json() if r.ok else {}
check(len(det.get("rounds", [])) == 2, f"2 rounds returned (got {len(det.get('rounds', []))})")

section("A9. POST /drugs 2 entries")
for drug in [
    {"drug": "Inj Piperacillin-Tazobactam", "dose": "4.5g", "route": "IV", "frequency": "Q8H"},
    {"drug": "Tab Pan-40", "dose": "40mg", "route": "PO", "frequency": "OD"},
]:
    r = requests.post(f"{BASE}/ipd/admissions/{adm_id}/drugs", headers=H_OWNER, json=drug)
    check(r.status_code == 200, f"POST /drugs {drug['drug']} → 200 (got {r.status_code})")
r = requests.get(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER)
det = r.json() if r.ok else {}
check(len(det.get("drug_chart", [])) == 2, f"2 drugs returned (got {len(det.get('drug_chart', []))})")

section("A10. PATCH diagnosis")
r = requests.patch(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER, json={"diagnosis": "updated diagnosis"})
check(r.status_code == 200, f"PATCH diagnosis → 200 (got {r.status_code})")
check((r.json() if r.ok else {}).get("diagnosis") == "updated diagnosis", "diagnosis persisted")

section("A11. PATCH bed_id to G-2 (succ); then trying back to an occupied bed → 409")
r = requests.patch(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER, json={"bed_id": target_g2})
check(r.status_code == 200, f"PATCH bed_id→G-2 → 200 (got {r.status_code})")
check((r.json() if r.ok else {}).get("bed_id") == target_g2, "bed_id updated to G-2")

# Create a second admission on G-1 (now free), then try moving first back to G-1 → 409
r2 = requests.post(f"{BASE}/ipd/admissions", headers=H_OWNER, json={
    "patient_name": "Second IPD",
    "patient_phone": "9000077777",
    "bed_id": target_g1,
    "diagnosis": "BPH",
})
check(r2.status_code == 200, f"Seed 2nd admission on G-1 → 200 (got {r2.status_code})")
second_id = r2.json().get("id") if r2.ok else None

if second_id:
    r3 = requests.patch(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER, json={"bed_id": target_g1})
    check(r3.status_code == 409, f"PATCH first adm to occupied G-1 → 409 (got {r3.status_code}: {r3.text[:120]})")
else:
    print("  (skipped 409 PATCH bed clash — no second admission)")

section("A12. POST /discharge (final_diagnosis required)")
r = requests.post(f"{BASE}/ipd/admissions/{adm_id}/discharge", headers=H_OWNER, json={
    "final_diagnosis": "L renal stone — post-PCNL",
    "procedures_done": "PCNL (left)",
    "course_in_hospital": "Uneventful, drain removed POD-2.",
    "condition_at_discharge": "Stable, afebrile",
    "discharge_meds": "Tab Pan-40 OD x 5d; Tab Paracetamol 650mg SOS",
    "follow_up_plan": "OPD review with USG KUB in 2 weeks",
})
check(r.status_code == 200, f"POST /discharge → 200 (got {r.status_code}: {r.text[:200]})")
d = r.json() if r.ok else {}
check(d.get("status") == "discharged", f"status=discharged (got {d.get('status')})")
check(d.get("bed_id") is None, f"bed_id is null after discharge (got {d.get('bed_id')})")
check(isinstance(d.get("discharge_summary"), dict), "discharge_summary embedded as dict")
ds = d.get("discharge_summary") or {}
check(ds.get("final_diagnosis") == "L renal stone — post-PCNL", "final_diagnosis preserved in summary")

section("A13. Second discharge attempt → 409")
r = requests.post(f"{BASE}/ipd/admissions/{adm_id}/discharge", headers=H_OWNER, json={"final_diagnosis": "again"})
check(r.status_code == 409, f"2nd discharge → 409 (got {r.status_code}: {r.text[:120]})")

section("A14. GET /discharge-summary")
r = requests.get(f"{BASE}/ipd/admissions/{adm_id}/discharge-summary", headers=H_OWNER)
check(r.status_code == 200, f"GET /discharge-summary → 200 (got {r.status_code})")
sb = r.json() if r.ok else {}
for k in ("admission", "vitals_recent", "drug_chart", "rounds", "clinic"):
    check(k in sb, f"discharge-summary has '{k}'")
check(len(sb.get("vitals_recent", [])) == 3, f"vitals_recent has 3 (got {len(sb.get('vitals_recent', []))})")
check(len(sb.get("drug_chart", [])) == 2, f"drug_chart has 2 (got {len(sb.get('drug_chart', []))})")
check(len(sb.get("rounds", [])) == 2, f"rounds has 2 (got {len(sb.get('rounds', []))})")
clinic_bundle = sb.get("clinic") or {}
check(any(k in clinic_bundle for k in ("name", "address", "phone", "doctor_degrees", "letterhead_image_b64")),
      f"clinic letterhead bundle has expected keys (got {list(clinic_bundle.keys())})")

section("A15. GET /api/ipd/stats")
r = requests.get(f"{BASE}/ipd/stats", headers=H_OWNER)
check(r.status_code == 200, f"GET /stats → 200 (got {r.status_code})")
st = r.json() if r.ok else {}
for k in ("active_admissions", "today_admitted", "today_discharged", "free_beds", "total_beds"):
    check(k in st, f"stats has '{k}' (val={st.get(k)})")
# After discharging first, second is still active (if seeded). total_beds=3. Free = 3 - active.
check(st.get("total_beds") == 3, f"total_beds=3 (got {st.get('total_beds')})")
check(st.get("today_discharged") >= 1, f"today_discharged >= 1 (got {st.get('today_discharged')})")

section("A16. Auth gating")
r = requests.get(f"{BASE}/ipd/beds", headers={"X-Clinic-Id": CLINIC_ID})
check(r.status_code == 401, f"GET /beds without bearer → 401 (got {r.status_code})")
# Patient-role bearer for POST /beds (owner-only)
# We need a patient token. Let's try with a generic patient session if available.
# From test_credentials.md we have DOCTOR token; doctor is not primary_owner — should be rejected for owner-only.
H_DOCTOR = {"Authorization": "Bearer test_doc_1776771431524", "X-Clinic-Id": CLINIC_ID, "Content-Type": "application/json"}
r = requests.post(f"{BASE}/ipd/beds", headers=H_DOCTOR, json=beds_payload)
check(r.status_code in (401, 403), f"POST /beds with non-owner (doctor) → 401/403 (got {r.status_code}: {r.text[:120]})")

section("A17. CLEANUP — DELETE admissions")
# Delete the 2nd seeded admission first (if exists), then the first
for d_id in [x for x in [second_id, adm_id] if x]:
    r = requests.delete(f"{BASE}/ipd/admissions/{d_id}", headers=H_OWNER)
    check(r.status_code == 200, f"DELETE /admissions/{d_id[:10]}... → 200 (got {r.status_code})")
# Confirm cascade — GET detail of deleted → 404
r = requests.get(f"{BASE}/ipd/admissions/{adm_id}", headers=H_OWNER)
check(r.status_code == 404, f"GET deleted admission → 404 (got {r.status_code})")

# ──────────────────────────────────────────────────────────────────
# B. PHR CONSOLIDATOR
# ──────────────────────────────────────────────────────────────────
section("B1. GET /api/patients/me/phr (owner bearer)")
r = requests.get(f"{BASE}/patients/me/phr", headers=H_OWNER)
check(r.status_code == 200, f"GET /phr → 200 (got {r.status_code})")
phr = r.json() if r.ok else {}
expected_keys = {"profile", "bookings", "prescriptions", "receipts", "surgeries",
                 "admissions", "ipss_scores", "notifications", "timeline", "generated_at"}
missing = expected_keys - set(phr.keys())
check(not missing, f"all expected keys present (missing: {missing})")

section("B2. Timeline sorted desc by ts; event_types valid")
tl = phr.get("timeline", [])
print(f"  timeline length: {len(tl)}")
ts_seq = [t.get("ts") or "" for t in tl]
check(ts_seq == sorted(ts_seq, reverse=True), "timeline sorted desc by ts")
valid_types = {"booking", "prescription", "receipt", "surgery", "admission", "discharge", "ipss"}
bad_types = {t.get("event_type") for t in tl} - valid_types
check(not bad_types, f"all event_types valid (unexpected: {bad_types})")

section("B3. Timeline count approximately matches sum of items")
sum_items = sum(len(phr.get(k, [])) for k in
                ("bookings", "prescriptions", "receipts", "surgeries", "admissions", "ipss_scores"))
diff = abs(len(tl) - sum_items)
check(diff <= 5, f"|timeline({len(tl)}) - sum({sum_items})| = {diff} (tolerance ±5)")

section("B4. GET /api/patients/me/phr/export.html")
r = requests.get(f"{BASE}/patients/me/phr/export.html", headers=H_OWNER)
check(r.status_code == 200, f"GET /phr/export.html → 200 (got {r.status_code})")
exp = r.json() if r.ok else {}
check("html" in exp and "filename" in exp, "response has html + filename")
html = exp.get("html", "")
check(html.lstrip().lower().startswith("<!doctype html>"), f"html starts with <!doctype html> (first 40: {html[:40]!r})")
check("<h1>Personal Health Record</h1>" in html, "html contains <h1>Personal Health Record</h1>")
fn = exp.get("filename", "")
check(fn.startswith("PHR-") and fn.endswith(".pdf"), f"filename pattern PHR-...pdf (got {fn})")

section("B5. Auth: both endpoints → 401 without bearer")
r = requests.get(f"{BASE}/patients/me/phr", headers={"X-Clinic-Id": CLINIC_ID})
check(r.status_code == 401, f"GET /phr no-auth → 401 (got {r.status_code})")
r = requests.get(f"{BASE}/patients/me/phr/export.html", headers={"X-Clinic-Id": CLINIC_ID})
check(r.status_code == 401, f"GET /phr/export.html no-auth → 401 (got {r.status_code})")

# ──────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────
print(f"\n\n{'=' * 60}")
print(f"TOTAL: {PASS} PASS / {FAIL} FAIL")
if FAILURES:
    print("\nFailures:")
    for f in FAILURES:
        print(f"  - {f}")
print(f"{'=' * 60}")
sys.exit(0 if FAIL == 0 else 1)
