"""Quick verification:
  1. GET /api/discharge-summaries?patient_phone=...
  2. Create admission → discharge → confirm filter returns only that row.
  3. GET /api/medical-certificates?patient_phone=...
  4. POST /api/medical-certificates then re-list → confirm 1 result.
  5. Cleanup test admission + cert.
"""
import os
import sys
import requests

BASE = "https://urology-pro.preview.emergentagent.com/api"
OWNER_TOKEN = "test_session_1776770314741"
HEADERS = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}

passes = 0
fails = []


def check(cond, label):
    global passes
    if cond:
        passes += 1
        print(f"  ✅ {label}")
    else:
        fails.append(label)
        print(f"  ❌ {label}")


print("\n=== TEST 1 — empty/no-matching phone (sanity, no 500) ===")
r = requests.get(f"{BASE}/discharge-summaries", headers=HEADERS, params={"patient_phone": "+919999111122"})
print(f"  status={r.status_code}")
check(r.status_code == 200, "GET /discharge-summaries?patient_phone=+919999111122 → 200")
body = r.json() if r.status_code == 200 else {}
check(isinstance(body.get("items"), list), "  response has items: list")
print(f"  items count = {len(body.get('items') or [])}")

print("\n=== TEST 2 — Setup admission + discharge + filter ===")
admit_payload = {
    "patient_name": "Filter Test",
    "patient_phone": "+919999111144",
    "patient_age": 50,
    "patient_gender": "M",
    "diagnosis": "Test",
    "ward": "GW-A",
    "bed_label": "A-1",
}
r = requests.post(f"{BASE}/ipd/admissions", headers=HEADERS, json=admit_payload)
print(f"  POST /ipd/admissions → {r.status_code}")
if r.status_code != 200:
    print(f"  RESP: {r.text[:600]}")
check(r.status_code == 200, "POST /ipd/admissions → 200")
admission = r.json() if r.status_code == 200 else {}
admission_id = admission.get("id")
print(f"  admission_id={admission_id} ipd_no={admission.get('ipd_no')}")
print(f"  stored patient_phone={admission.get('patient_phone')!r}")

assert admission_id, "Need admission_id to continue"

discharge_payload = {
    "final_diagnosis": "Resolved",
    "condition_at_discharge": "Stable",
    "follow_up_plan": "OPD review",
    "follow_up_date": "2026-07-01",
    "advice": "Rest",
}
r = requests.post(f"{BASE}/ipd/admissions/{admission_id}/discharge", headers=HEADERS, json=discharge_payload)
print(f"  POST /ipd/admissions/{{id}}/discharge → {r.status_code}")
if r.status_code != 200:
    print(f"  RESP: {r.text[:600]}")
check(r.status_code == 200, "POST discharge → 200")

# Filter — expect exactly 1 matching row
r = requests.get(f"{BASE}/discharge-summaries", headers=HEADERS, params={"patient_phone": "+919999111144"})
print(f"  GET /discharge-summaries?patient_phone=+919999111144 → {r.status_code}")
check(r.status_code == 200, "GET filter (matching phone) → 200")
items = (r.json() or {}).get("items") or []
print(f"  items returned = {len(items)}")
for it in items:
    print(f"    - id={it.get('id')} name={it.get('patient_name')} phone={it.get('patient_phone')}")
# Expect exactly 1 row for THIS admission_id
matching = [it for it in items if it.get("id") == admission_id]
check(len(matching) == 1, "exactly 1 row with the new admission_id")
check(len(matching) == 1 and matching[0].get("patient_name") == "Filter Test", "row.patient_name == 'Filter Test'")

# Negative filter — different phone (no admissions for it)
r = requests.get(f"{BASE}/discharge-summaries", headers=HEADERS, params={"patient_phone": "+919999009999"})
print(f"  GET /discharge-summaries?patient_phone=+919999009999 → {r.status_code}")
check(r.status_code == 200, "GET filter (different phone) → 200")
neg_items = (r.json() or {}).get("items") or []
print(f"  items returned = {len(neg_items)}")
# Ensure none of them is our admission_id
neg_match = [it for it in neg_items if it.get("id") == admission_id]
check(len(neg_match) == 0, "0 matching rows for unrelated phone")

print("\n=== TEST 3 — medical-certificates filter (no certs yet) ===")
r = requests.get(f"{BASE}/medical-certificates", headers=HEADERS, params={"patient_phone": "+919999111144"})
print(f"  GET /medical-certificates → {r.status_code}")
check(r.status_code == 200, "GET /medical-certificates → 200")
mc_body = r.json() if r.status_code == 200 else {}
check(isinstance(mc_body.get("items"), list), "response has items: list")
print(f"  items count = {len(mc_body.get('items') or [])}")

print("\n=== TEST 4 — Create cert + re-list ===")
cert_payload = {
    "kind": "sick_leave",
    "patient_name": "Filter Test",
    "patient_phone": "+919999111144",
    "diagnosis": "Test",
    "start_date": "2026-06-21",
    "days": 2,
}
r = requests.post(f"{BASE}/medical-certificates", headers=HEADERS, json=cert_payload)
print(f"  POST /medical-certificates → {r.status_code}")
if r.status_code != 200:
    print(f"  RESP: {r.text[:600]}")
check(r.status_code == 200, "POST /medical-certificates → 200")
cert = r.json() if r.status_code == 200 else {}
cert_id = cert.get("cert_id")
print(f"  cert_id={cert_id}")

r = requests.get(f"{BASE}/medical-certificates", headers=HEADERS, params={"patient_phone": "+919999111144"})
print(f"  GET /medical-certificates?patient_phone=+919999111144 → {r.status_code}")
check(r.status_code == 200, "GET filter → 200")
items = (r.json() or {}).get("items") or []
print(f"  items returned = {len(items)}")
mine = [c for c in items if c.get("cert_id") == cert_id]
check(len(mine) == 1, "exactly 1 cert for the new cert_id")

print("\n=== TEST 5 — Cleanup ===")
# Delete the admission (owner-only) — this hard-deletes it
r = requests.delete(f"{BASE}/ipd/admissions/{admission_id}", headers=HEADERS)
print(f"  DELETE /ipd/admissions/{{id}} → {r.status_code}")
check(r.status_code == 200, "DELETE admission → 200")

# Soft-delete the cert
if cert_id:
    r = requests.delete(f"{BASE}/medical-certificates/{cert_id}", headers=HEADERS)
    print(f"  DELETE /medical-certificates/{{id}} → {r.status_code}")
    check(r.status_code == 200, "DELETE cert → 200")

print("\n" + "=" * 60)
print(f"PASS: {passes} | FAIL: {len(fails)}")
for f in fails:
    print(f"  - {f}")
sys.exit(0 if not fails else 1)
