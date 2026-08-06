"""Phase D + Phase E multi-tenant backend test.

Auth token: test_session_1776770314741 (sagar.joshi133@gmail.com, primary_owner)
Default clinic: clinic_a97b903f2fb2
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, Optional

import requests

BASE_URL = os.environ.get("BACKEND_BASE_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/") + "/api"
OWNER_TOKEN = "test_session_1776770314741"
CLINIC_ID = "clinic_a97b903f2fb2"
WRONG_CLINIC = "clinic_no_such"

PASS = 0
FAIL = 0
FAILS = []


def _hdrs(token: Optional[str] = OWNER_TOKEN, clinic: Optional[str] = None) -> Dict[str, str]:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if clinic:
        h["X-Clinic-Id"] = clinic
    return h


def expect(cond: bool, label: str, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"✅ {label}")
    else:
        FAIL += 1
        FAILS.append(f"{label}  {detail}")
        print(f"❌ {label} — {detail}")


def req(method: str, path: str, **kwargs) -> requests.Response:
    url = BASE_URL + path
    return requests.request(method, url, timeout=30, **kwargs)


def main() -> int:
    print(f"== BASE_URL = {BASE_URL} ==\n")
    print("--- Phase D: Invitations ---")

    # 1. Create invitation
    body = {"email": "newdoc@example.com", "role": "doctor", "note": "Hi!"}
    r = req("POST", f"/clinics/{CLINIC_ID}/invitations", headers=_hdrs(), data=json.dumps(body))
    expect(r.status_code == 201, "1. POST create invitation → 201", f"got {r.status_code} body={r.text[:200]}")
    if r.status_code != 201:
        return _summary()
    j = r.json()
    expect(j.get("ok") is True, "1a. ok=True", str(j))
    token1 = j.get("token")
    accept_url = j.get("accept_url")
    expect(bool(token1) and len(token1) > 8, "1b. token returned", str(j))
    expect(bool(accept_url) and "/invite/" in accept_url, "1c. accept_url returned", str(j))

    # 2. Re-create same email -> reuse token
    r = req("POST", f"/clinics/{CLINIC_ID}/invitations", headers=_hdrs(), data=json.dumps(body))
    expect(r.status_code == 201, "2. POST same email re-create → 201", f"got {r.status_code}")
    token2 = r.json().get("token") if r.status_code == 201 else None
    expect(token1 == token2, "2a. SAME token returned (de-dup)", f"t1={token1} t2={token2}")

    # 3. Public preview (no auth)
    r = req("GET", f"/invitations/{token1}", headers={})
    expect(r.status_code == 200, "3. GET public preview (no auth) → 200", f"got {r.status_code} body={r.text[:300]}")
    if r.status_code == 200:
        j = r.json()
        expect(j.get("clinic", {}).get("name"), "3a. clinic.name present", str(j))
        expect(j.get("email") == "newdoc@example.com", "3b. email matches", str(j))
        expect(j.get("role") == "doctor", "3c. role matches", str(j))
        expect(j.get("note") == "Hi!", "3d. note matches", str(j))
        expect(isinstance(j.get("expires_at"), int) and j["expires_at"] > int(time.time() * 1000),
               "3e. expires_at in future", str(j.get("expires_at")))

    # 4. List invitations
    r = req("GET", f"/clinics/{CLINIC_ID}/invitations", headers=_hdrs())
    expect(r.status_code == 200, "4. GET list invitations → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json().get("invitations", [])
        found = [i for i in items if i.get("token") == token1]
        expect(len(found) == 1, "4a. created invite present in list", f"items={len(items)} found={len(found)}")
        if found:
            expect(found[0].get("status") == "pending", "4b. status=pending", str(found[0].get("status")))
            expect(found[0].get("email") == "newdoc@example.com", "4c. email matches in list", "")

    # 5. Invalid role
    bad = {"email": "x@y.com", "role": "super_owner"}
    r = req("POST", f"/clinics/{CLINIC_ID}/invitations", headers=_hdrs(), data=json.dumps(bad))
    expect(r.status_code == 400, "5. POST invalid role → 400", f"got {r.status_code} body={r.text[:200]}")

    # 6. Revoke invitation
    r = req("DELETE", f"/invitations/{token1}", headers=_hdrs())
    expect(r.status_code == 200, "6. DELETE revoke → 200", f"got {r.status_code}")
    expect(r.json().get("ok") is True if r.status_code == 200 else False, "6a. ok=true on revoke", "")

    # 6b. After revoke, public preview should be 410
    r = req("GET", f"/invitations/{token1}", headers={})
    expect(r.status_code == 410, "6b. GET preview after revoke → 410", f"got {r.status_code} body={r.text[:200]}")

    print("\n--- Phase E: Tenant Scoping ---")

    # 7. Bookings with valid header
    r = req("GET", "/bookings/all", headers=_hdrs(clinic=CLINIC_ID))
    expect(r.status_code == 200, "7. GET /bookings/all with header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        expect(isinstance(items, list), "7a. list response", str(type(items)))
        expect(len(items) == 78, "7b. 78 bookings returned", f"got {len(items)}")
        all_match = all(b.get("clinic_id") == CLINIC_ID for b in items)
        expect(all_match, "7c. all rows have clinic_id == clinic_a97b903f2fb2",
               f"mismatched={[b.get('clinic_id') for b in items if b.get('clinic_id') != CLINIC_ID][:3]}")

    # 8. Bookings without header
    r = req("GET", "/bookings/all", headers=_hdrs())
    expect(r.status_code == 200, "8. GET /bookings/all no header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        expect(len(items) == 78, "8a. 78 bookings (default-clinic fallback)", f"got {len(items)}")

    # 9. Bookings wrong clinic id
    r = req("GET", "/bookings/all", headers=_hdrs(clinic=WRONG_CLINIC))
    expect(r.status_code == 403, "9. GET /bookings/all wrong clinic → 403", f"got {r.status_code} body={r.text[:200]}")
    if r.status_code == 403:
        detail = r.json().get("detail", "")
        expect("not a member" in detail.lower(), "9a. detail mentions 'not a member'", f"detail={detail}")

    # 10. Prescriptions scope
    r = req("GET", "/prescriptions", headers=_hdrs(clinic=CLINIC_ID))
    expect(r.status_code == 200, "10. GET /prescriptions with header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        # /prescriptions might return a dict or list. Check.
        if isinstance(items, dict):
            items = items.get("prescriptions") or items.get("items") or []
        expect(len(items) == 17, "10a. 17 rows", f"got {len(items)}")
        if items:
            all_ok = all(p.get("clinic_id") == CLINIC_ID for p in items)
            expect(all_ok, "10b. all have clinic_id == clinic_a97b903f2fb2",
                   f"mismatch sample={[p.get('clinic_id') for p in items if p.get('clinic_id') != CLINIC_ID][:3]}")

    r = req("GET", "/prescriptions", headers=_hdrs())
    expect(r.status_code == 200, "10c. GET /prescriptions no header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        if isinstance(items, dict):
            items = items.get("prescriptions") or items.get("items") or []
        expect(len(items) == 17, "10d. 17 rows (fallback)", f"got {len(items)}")

    r = req("GET", "/prescriptions", headers=_hdrs(clinic=WRONG_CLINIC))
    expect(r.status_code == 403, "10e. GET /prescriptions wrong clinic → 403", f"got {r.status_code}")

    # 11. Surgeries scope
    r = req("GET", "/surgeries", headers=_hdrs(clinic=CLINIC_ID))
    expect(r.status_code == 200, "11. GET /surgeries with header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        if isinstance(items, dict):
            items = items.get("surgeries") or items.get("items") or []
        expect(len(items) == 401, "11a. 401 rows", f"got {len(items)}")

    r = req("GET", "/surgeries", headers=_hdrs())
    expect(r.status_code == 200, "11b. GET /surgeries no header → 200", f"got {r.status_code}")
    if r.status_code == 200:
        items = r.json()
        if isinstance(items, dict):
            items = items.get("surgeries") or items.get("items") or []
        expect(len(items) == 401, "11c. 401 rows (fallback)", f"got {len(items)}")

    r = req("GET", "/surgeries", headers=_hdrs(clinic=WRONG_CLINIC))
    expect(r.status_code == 403, "11d. GET /surgeries wrong clinic → 403", f"got {r.status_code}")

    # 12. Create scoped booking
    booking_payload = {
        "patient_name": "TestPhaseE Patient",
        "patient_phone": "9000000099",
        "country_code": "+91",
        "patient_age": 45,
        "patient_gender": "Male",
        "reason": "phase E scope test",
        "booking_date": "2099-01-15",
        "booking_time": "10:00",
        "mode": "in-person",
    }
    r = req("POST", "/bookings", headers=_hdrs(clinic=CLINIC_ID), data=json.dumps(booking_payload))
    expect(r.status_code in (200, 201), "12. POST /bookings with header → 200", f"got {r.status_code} body={r.text[:300]}")
    new_booking_id = None
    if r.status_code in (200, 201):
        bj = r.json()
        # response could be {ok, booking:{...}} or the booking doc itself
        b = bj.get("booking") if isinstance(bj, dict) and "booking" in bj else bj
        expect(b.get("clinic_id") == CLINIC_ID, "12a. resulting clinic_id == clinic_a97b903f2fb2",
               f"got clinic_id={b.get('clinic_id')} body={bj}")
        new_booking_id = b.get("booking_id") or b.get("id")

    print("\n--- Regression: Phase A sanity ---")

    # 13a. GET /api/clinics
    r = req("GET", "/clinics", headers=_hdrs())
    expect(r.status_code == 200, "13a. GET /clinics → 200", f"got {r.status_code}")
    if r.status_code == 200:
        clinics = r.json()
        if isinstance(clinics, dict):
            clinics = clinics.get("clinics") or clinics.get("items") or []
        expect(len(clinics) >= 1, "13a.i still ≥1 clinic", f"got {len(clinics)}")

    # 13b. by-slug public
    r = req("GET", "/clinics/by-slug/dr-joshi-uro", headers={})
    expect(r.status_code == 200, "13b. GET /clinics/by-slug (no auth) → 200", f"got {r.status_code}")

    # 13c. migration idempotency
    print("(running migration...)")
    import subprocess
    proc = subprocess.run(
        ["python", "-m", "migrations.001_multi_tenant"],
        capture_output=True, text=True, cwd="/app/backend",
    )
    expect(proc.returncode == 0, "13c. migration re-run exits 0",
           f"rc={proc.returncode} stderr={proc.stderr[:300]}")
    print("MIG STDOUT:\n" + proc.stdout[-600:])

    print("\n--- Cleanup ---")
    # Delete invitations
    import pymongo
    from pymongo import MongoClient
    mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    mdb = mc["consulturo"]
    inv_del = mdb["clinic_invitations"].delete_many(
        {"email": {"$in": ["newdoc@example.com", "x@y.com"]}}
    )
    print(f"clinic_invitations deleted: {inv_del.deleted_count}")
    if new_booking_id:
        bdel = mdb["bookings"].delete_one({"booking_id": new_booking_id})
        print(f"booking deleted: {bdel.deleted_count}  id={new_booking_id}")
    else:
        bdel = mdb["bookings"].delete_many({"booking_date": "2099-01-15"})
        print(f"booking fallback deleted: {bdel.deleted_count}")
    # Also clean any patient row created
    pdel = mdb["patients"].delete_many({"phone": {"$regex": "9000000099$"}})
    print(f"patients deleted: {pdel.deleted_count}")

    # Final state check
    print("\n--- Final state ---")
    print(f"clinics={mdb.clinics.count_documents({'deleted_at': None})}")
    print(f"memberships(active)={mdb.clinic_memberships.count_documents({'is_active': True})}")
    print(f"bookings={mdb.bookings.count_documents({})}")
    print(f"rx={mdb.prescriptions.count_documents({})}")
    print(f"sx={mdb.surgeries.count_documents({})}")
    print(f"invites={mdb.clinic_invitations.count_documents({})}")
    return _summary()


def _summary() -> int:
    print(f"\n=== {PASS} PASS, {FAIL} FAIL ===")
    if FAILS:
        print("FAILED:")
        for f in FAILS:
            print(" -", f)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
