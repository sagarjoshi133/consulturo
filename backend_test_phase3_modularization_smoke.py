"""Phase 3 modularization smoke test for ConsultUro backend.

Validates that the 38 endpoints extracted into 11 new router modules
(/app/backend/routers/{health,calculators,education,consent,medicines,
notes,availability,ipss,referrers,patients,tools}.py) preserve
behaviour exactly (no regressions vs. pre-Phase-3 server.py).
"""
import os
import sys
import json
import urllib.parse
import requests

BASE = os.environ.get("BACKEND_URL", "http://localhost:8001")
OWNER_TOKEN = "test_session_1776770314741"   # primary_owner (sagar.joshi133@gmail.com)
H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}"}

results = []

def check(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    results.append((status, label, detail))
    print(f"[{status}] {label}" + (f" — {detail}" if detail else ""))

def get(path, headers=None, **kwargs):
    return requests.get(BASE + path, headers=headers or {}, timeout=15, **kwargs)

def post(path, headers=None, json_body=None):
    return requests.post(BASE + path, headers=headers or {}, json=json_body or {}, timeout=15)

def patch(path, headers=None, json_body=None):
    return requests.patch(BASE + path, headers=headers or {}, json=json_body or {}, timeout=15)

def delete(path, headers=None):
    return requests.delete(BASE + path, headers=headers or {}, timeout=15)


# ─────────────────────────────────────────────────────────────────────
# 1. PUBLIC reads
# ─────────────────────────────────────────────────────────────────────
print("\n=== 1. PUBLIC reads (no auth) ===")

r = get("/api/health")
check("GET /api/health → 200", r.status_code == 200, f"code={r.status_code}")
try:
    j = r.json()
    check("GET /api/health body has ok:true", j.get("ok") is True, str(j))
except Exception as e:
    check("GET /api/health JSON parse", False, str(e))

r = get("/api/clinic-settings")
check("GET /api/clinic-settings → 200 (public)", r.status_code == 200, f"code={r.status_code}")

r = get("/api/diseases")
check("GET /api/diseases → 200 (public)", r.status_code == 200, f"code={r.status_code}")
if r.status_code == 200:
    j = r.json()
    check("GET /api/diseases is non-empty list", isinstance(j, list) and len(j) > 0, f"len={len(j) if isinstance(j, list) else 'N/A'}")

r = get("/api/doctor")
check("GET /api/doctor → 200 (public)", r.status_code == 200, f"code={r.status_code}")

r = get("/api/calculators")
check("GET /api/calculators → 200 (public)", r.status_code == 200, f"code={r.status_code}")
if r.status_code == 200:
    j = r.json()
    check("GET /api/calculators is non-empty list", isinstance(j, list) and len(j) >= 8, f"len={len(j) if isinstance(j, list) else 'N/A'}")
    if isinstance(j, list) and j:
        check("calculators item has id+name", "id" in j[0] and "name" in j[0], str(j[0]))

# /api/education — list
for lang in ("en", "hi", "gu"):
    r = get(f"/api/education?lang={lang}")
    check(f"GET /api/education?lang={lang} → 200", r.status_code == 200, f"code={r.status_code}")
    if r.status_code == 200:
        j = r.json()
        check(f"  list has 37 items (lang={lang})", isinstance(j, list) and len(j) == 37, f"len={len(j) if isinstance(j, list) else 'N/A'}")

# /api/education/{eid}
r = get("/api/education/kegel-exercises?lang=en")
check("GET /api/education/kegel-exercises?lang=en → 200", r.status_code == 200, f"code={r.status_code}")
if r.status_code == 200:
    j = r.json()
    check("  has id/title/summary/details/cover/steps",
          all(k in j for k in ("id","title","summary","details","cover","steps")),
          f"keys={list(j.keys())}")

r = get("/api/education/does-not-exist")
check("GET /api/education/does-not-exist → 404", r.status_code == 404, f"code={r.status_code}")

# /api/videos
r = get("/api/videos")
check("GET /api/videos → 200 (public)", r.status_code == 200, f"code={r.status_code}")
if r.status_code == 200:
    j = r.json()
    check("  /api/videos returns a list", isinstance(j, list), f"type={type(j).__name__}")

# /api/availability/doctors
r = get("/api/availability/doctors")
check("GET /api/availability/doctors → 200 (public)", r.status_code == 200, f"code={r.status_code}")
if r.status_code == 200:
    j = r.json()
    check("  /api/availability/doctors returns list with availability",
          isinstance(j, list) and (len(j) == 0 or "availability" in j[0]),
          f"len={len(j) if isinstance(j, list) else 'N/A'}")


# ─────────────────────────────────────────────────────────────────────
# 2. AUTH-protected endpoints (no token → 401; primary_owner → 200)
# ─────────────────────────────────────────────────────────────────────
print("\n=== 2. AUTH-protected endpoints ===")

protected_paths = [
    "/api/medicines/catalog",
    "/api/medicines/categories",
    "/api/notes",
    "/api/notes/labels",
    "/api/referrers",
    "/api/patients/lookup?phone=9000000000",
    "/api/patients/history?phone=9000000000",
    "/api/consent",
    "/api/availability/me",
    "/api/availability/slots?date=2026-05-01",
    "/api/unavailabilities",
    "/api/ipss/history",
    "/api/tools/scores/ipss",
    "/api/tools/bladder-diary",
]

for p in protected_paths:
    r = get(p)  # no token
    check(f"GET {p} (no token) → 401", r.status_code == 401, f"code={r.status_code}")

for p in protected_paths:
    r = get(p, headers=H_OWNER)
    # availability/slots is public by design (no auth dep) but should still 200
    expect_ok = r.status_code == 200
    check(f"GET {p} (owner) → 200", expect_ok, f"code={r.status_code} body={r.text[:120]}")


# ─────────────────────────────────────────────────────────────────────
# 3. CRUD smoke (create + list + delete) — primary_owner token
# ─────────────────────────────────────────────────────────────────────
print("\n=== 3. CRUD smoke ===")

# 3a. NOTES
r = post("/api/notes", H_OWNER, {"title": "Phase3 Smoke", "body": "Test note for phase3 modularization smoke."})
check("POST /api/notes (owner) → 200", r.status_code == 200, f"code={r.status_code} body={r.text[:200]}")
note_id = None
if r.status_code == 200:
    j = r.json()
    note_id = j.get("note_id")
    check("  note_id starts with 'note_'", isinstance(note_id, str) and note_id.startswith("note_"), f"note_id={note_id}")

if note_id:
    r = get("/api/notes", headers=H_OWNER)
    check("GET /api/notes after create → 200", r.status_code == 200, f"code={r.status_code}")
    if r.status_code == 200:
        ids = [n.get("note_id") for n in r.json()]
        check(f"  list contains created {note_id}", note_id in ids, f"count={len(ids)}")

    r = delete(f"/api/notes/{note_id}", H_OWNER)
    check(f"DELETE /api/notes/{note_id} (owner) → 200", r.status_code == 200, f"code={r.status_code}")

    r = get("/api/notes", headers=H_OWNER)
    if r.status_code == 200:
        ids = [n.get("note_id") for n in r.json()]
        check(f"  list excludes deleted {note_id}", note_id not in ids, f"present={note_id in ids}")

# 3b. REFERRERS
r = post("/api/referrers", H_OWNER, {
    "name": "Dr Phase3 Smoke",
    "phone": "+919900000000",
    "email": "phase3@example.com",
    "speciality": "Family Physician",
    "city": "Vadodara",
})
check("POST /api/referrers (owner) → 200", r.status_code == 200, f"code={r.status_code} body={r.text[:200]}")
ref_id = None
if r.status_code == 200:
    j = r.json()
    ref_id = j.get("referrer_id")
    check("  referrer_id starts with 'ref_'", isinstance(ref_id, str) and ref_id.startswith("ref_"), f"id={ref_id}")

if ref_id:
    r = get("/api/referrers", headers=H_OWNER)
    if r.status_code == 200:
        ids = [x.get("referrer_id") for x in r.json()]
        check(f"  list contains {ref_id}", ref_id in ids, f"count={len(ids)}")

    r = delete(f"/api/referrers/{ref_id}", H_OWNER)
    check(f"DELETE /api/referrers/{ref_id} → 200", r.status_code == 200, f"code={r.status_code}")

    r = delete(f"/api/referrers/{ref_id}", H_OWNER)
    check("  repeat DELETE → 404", r.status_code == 404, f"code={r.status_code}")

# 3c. MEDICINES CUSTOM
r = post("/api/medicines/custom", H_OWNER, {
    "name": "Phase3SmokeDrug",
    "generic": "smokoxin",
    "category": "Other",
    "dosage": "10mg",
    "frequency": "OD",
    "duration": "5d",
})
check("POST /api/medicines/custom (owner) → 200", r.status_code == 200, f"code={r.status_code} body={r.text[:200]}")
med_id = None
if r.status_code == 200:
    j = r.json()
    med_id = j.get("medicine_id")
    check("  medicine_id starts with 'med_'", isinstance(med_id, str) and med_id.startswith("med_"), f"id={med_id}")

if med_id:
    r = get("/api/medicines/catalog?q=phase3smoke", headers=H_OWNER)
    if r.status_code == 200:
        names = [m.get("name") for m in r.json()]
        check(f"  catalog search finds custom drug", "Phase3SmokeDrug" in names, f"len={len(names)}")

    r = delete(f"/api/medicines/custom/{med_id}", H_OWNER)
    check(f"DELETE /api/medicines/custom/{med_id} → 200", r.status_code == 200, f"code={r.status_code}")

# 3d. BLADDER DIARY
r = post("/api/tools/bladder-diary", H_OWNER, {
    "date": "2026-05-01",
    "time": "08:30",
    "volume_ml": 250,
    "fluid_intake_ml": 200,
    "urgency": 2,
    "leak": False,
    "note": "phase3 smoke",
})
check("POST /api/tools/bladder-diary (owner) → 200", r.status_code == 200, f"code={r.status_code} body={r.text[:200]}")
entry_id = None
if r.status_code == 200:
    j = r.json()
    entry_id = j.get("entry_id")
    check("  entry_id starts with 'bd_'", isinstance(entry_id, str) and entry_id.startswith("bd_"), f"id={entry_id}")

if entry_id:
    r = get("/api/tools/bladder-diary", headers=H_OWNER)
    if r.status_code == 200:
        j = r.json()
        ids = [e.get("entry_id") for e in (j.get("entries") or [])]
        check(f"  list contains {entry_id}", entry_id in ids, f"count={len(ids)}")

    r = delete(f"/api/tools/bladder-diary/{entry_id}", H_OWNER)
    check(f"DELETE /api/tools/bladder-diary/{entry_id} → 200", r.status_code == 200, f"code={r.status_code}")


# ─────────────────────────────────────────────────────────────────────
# 4. Auth gate intactness on DELETE / PATCH
# ─────────────────────────────────────────────────────────────────────
print("\n=== 4. Auth-gate intactness ===")

r = delete("/api/notes/some-bogus-id")
check("DELETE /api/notes/{id} (no token) → 401", r.status_code == 401, f"code={r.status_code}")

r = patch("/api/referrers/some-bogus-id", json_body={"name": "x"})
check("PATCH /api/referrers/{id} (no token) → 401", r.status_code == 401, f"code={r.status_code}")


# ─────────────────────────────────────────────────────────────────────
# 5. Untouched-domain regressions (sanity)
# ─────────────────────────────────────────────────────────────────────
print("\n=== 5. Untouched-domain regressions ===")

for p in ("/api/auth/me", "/api/admin/partners", "/api/team", "/api/bookings/all"):
    r = get(p, headers=H_OWNER)
    check(f"GET {p} (owner) → 200", r.status_code == 200, f"code={r.status_code} body={r.text[:120]}")


# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────
total = len(results)
fails = [r for r in results if r[0] == "FAIL"]
print("\n" + "=" * 60)
print(f"TOTAL: {total} | PASS: {total - len(fails)} | FAIL: {len(fails)}")
if fails:
    print("\nFAILURES:")
    for s, label, detail in fails:
        print(f"  - {label}: {detail}")
sys.exit(0 if not fails else 1)
