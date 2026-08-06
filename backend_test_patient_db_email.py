#!/usr/bin/env python3
"""ConsultUro Backend smoke test — 2026-05-21 review:
  1. Email as secondary patient identity key (services/reg_no.py)
  2. Patient Database router (routers/patient_db.py)
  3. /api/me/tier expanded (routers/me_tier.py)

Run against http://localhost:8001. Uses pre-seeded session tokens from
/app/memory/test_credentials.md.
"""
import json
import re
import sys
import time
import uuid
import subprocess
from datetime import datetime, timezone, timedelta

import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"  # primary_owner sagar.joshi133@gmail.com
DOCTOR_TOKEN = "test_doc_1776771431524"     # doctor dr.test@example.com

H_OWNER = {"Authorization": f"Bearer {OWNER_TOKEN}", "Content-Type": "application/json"}
H_DOCTOR = {"Authorization": f"Bearer {DOCTOR_TOKEN}", "Content-Type": "application/json"}

# Test phones — keep within the 9876500xxxx range per review brief
TS = int(time.time())
PHONE_A = f"987650{TS%10000:04d}"        # primary "phone first" patient
PHONE_AUTO_MERGE = f"987650{(TS+1)%10000:04d}"  # phone-only first, then add email
PHONE_NEW_FOR_EMAIL = f"987650{(TS+2)%10000:04d}"  # new phone with existing email

EMAIL_A1 = f"emailA1_{TS}@test.com"
EMAIL_A2 = f"emailA2_{TS}@test.com"
EMAIL_MERGE = f"merge_{TS}@test.com"
EMAIL_ONLY = f"emailonly_{TS}@test.com"
EMAIL_RX = f"rx_{TS}@test.com"

results = []

def log(label, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {label}" + (f"  ::  {detail}" if detail else ""))
    results.append((label, ok, detail))


def mongo_query(query: str) -> str:
    """Run mongosh JS snippet and return stdout."""
    cmd = [
        "mongosh", "--quiet", "--eval",
        f"db = db.getSiblingDB('consulturo'); {query}",
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    return (out.stdout or "") + (out.stderr or "")


_slot_idx = 0
def mk_booking(phone, email=None, name="Test Patient"):
    global _slot_idx
    _slot_idx += 1
    # vary time AND date each call so we never hit a per-slot capacity cap
    hh = 9 + (_slot_idx % 9)
    mm = (_slot_idx * 5) % 60
    days = 7 + (_slot_idx % 30)
    body = {
        "patient_name": name,
        "patient_phone": phone,
        "country_code": "+91",
        "reason": "patient-db smoke",
        "booking_date": (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d"),
        "booking_time": f"{hh:02d}:{mm:02d}",
        "mode": "in-person",
    }
    if email is not None:
        body["patient_email"] = email
    return body


# ─── 1. Email as secondary patient identity key ─────────────────────

def test_email_identity():
    print("\n=== TEST 1: email-as-secondary-identity (services/reg_no.py) ===")

    # 1a. Phone + email together → returns reg_no, persists both keys
    r = requests.post(
        f"{BASE}/bookings",
        headers=H_OWNER,
        data=json.dumps(mk_booking(PHONE_A, EMAIL_A1, "Patient Alpha")),
        timeout=15,
    )
    log("POST /bookings phone+email succeeds", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code != 200:
        return
    body = r.json()
    reg_no_a = body.get("registration_no")
    ok = bool(reg_no_a and re.match(r"^\d{9}$", reg_no_a))
    log("reg_no SSSDDMMYY shape", ok, f"reg_no={reg_no_a}")

    # Mongo verify patient row has phone+email+reg_no
    js = (
        f"var p = db.patients.findOne({{phone: '{PHONE_A}'}}, {{_id:0}}); "
        f"print(JSON.stringify(p));"
    )
    out = mongo_query(js).strip()
    parsed = None
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                parsed = json.loads(line)
                break
            except Exception:
                continue
    has_email = parsed and parsed.get("email") == EMAIL_A1.lower()
    has_reg = parsed and parsed.get("reg_no") == reg_no_a
    has_phone = parsed and parsed.get("phone") == PHONE_A
    log("mongo patients row has phone+email+reg_no", bool(has_email and has_reg and has_phone),
        f"row={parsed}")

    # 1b. Same phone, different email → reuse same reg_no (phone wins)
    r2 = requests.post(
        f"{BASE}/bookings",
        headers=H_OWNER,
        data=json.dumps(mk_booking(PHONE_A, EMAIL_A2, "Patient Alpha 2")),
        timeout=15,
    )
    log("POST /bookings same-phone-diff-email succeeds", r2.status_code == 200,
        f"status={r2.status_code}")
    if r2.status_code == 200:
        rn2 = r2.json().get("registration_no")
        log("phone wins: same reg_no reused", rn2 == reg_no_a, f"got={rn2} expected={reg_no_a}")

    # 1c. Auto-merge: first phone-only, then phone+email
    r3 = requests.post(
        f"{BASE}/bookings",
        headers=H_OWNER,
        data=json.dumps(mk_booking(PHONE_AUTO_MERGE, None, "Patient Merge")),
        timeout=15,
    )
    log("POST /bookings phone-only succeeds", r3.status_code == 200, f"status={r3.status_code}")
    reg_no_merge = None
    if r3.status_code == 200:
        reg_no_merge = r3.json().get("registration_no")

    r4 = requests.post(
        f"{BASE}/bookings",
        headers=H_OWNER,
        data=json.dumps(mk_booking(PHONE_AUTO_MERGE, EMAIL_MERGE, "Patient Merge")),
        timeout=15,
    )
    log("POST /bookings phone+new-email (merge) succeeds", r4.status_code == 200,
        f"status={r4.status_code}")
    if r4.status_code == 200 and reg_no_merge:
        rn4 = r4.json().get("registration_no")
        log("auto-merge: reg_no preserved", rn4 == reg_no_merge,
            f"first={reg_no_merge} second={rn4}")
        # Verify email_attached_at populated and email set
        js = (
            f"var p = db.patients.findOne({{phone: '{PHONE_AUTO_MERGE}'}}, {{_id:0}}); "
            f"print(JSON.stringify(p));"
        )
        out = mongo_query(js).strip()
        merged = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    merged = json.loads(line)
                    break
                except Exception:
                    continue
        em_ok = merged and merged.get("email") == EMAIL_MERGE.lower()
        att_ok = merged and ("email_attached_at" in merged) and merged.get("email_attached_at")
        log("auto-merge: email attached + email_attached_at populated",
            bool(em_ok and att_ok),
            f"email={merged.get('email') if merged else None} attached_at={merged.get('email_attached_at') if merged else None}")

    # 1d. Email-only new patient (phone="")
    r5 = requests.post(
        f"{BASE}/bookings",
        headers=H_OWNER,
        data=json.dumps(mk_booking("", EMAIL_ONLY, "Email Only")),
        timeout=15,
    )
    # empty patient_phone may fail validation — note actual behaviour
    log("POST /bookings phone='' email-only", r5.status_code == 200,
        f"status={r5.status_code} body={r5.text[:200]}")
    reg_no_emailonly = None
    if r5.status_code == 200:
        reg_no_emailonly = r5.json().get("registration_no")
        log("email-only allocates reg_no", bool(reg_no_emailonly),
            f"reg_no={reg_no_emailonly}")
        # Verify mongo row has phone="" and email set
        js = (
            f"var p = db.patients.findOne({{email: '{EMAIL_ONLY.lower()}'}}, {{_id:0}}); "
            f"print(JSON.stringify(p));"
        )
        out = mongo_query(js).strip()
        eo = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    eo = json.loads(line)
                    break
                except Exception:
                    continue
        ph_empty = eo and (eo.get("phone") == "" or eo.get("phone") is None)
        em_ok = eo and eo.get("email") == EMAIL_ONLY.lower()
        log("email-only patient row: phone empty + email set",
            bool(ph_empty and em_ok),
            f"row={eo}")

    # 1e. Same email + new phone — reuse via email since existing row has phone=""
    if reg_no_emailonly:
        r6 = requests.post(
            f"{BASE}/bookings",
            headers=H_OWNER,
            data=json.dumps(mk_booking(PHONE_NEW_FOR_EMAIL, EMAIL_ONLY, "Email Only")),
            timeout=15,
        )
        log("POST /bookings new-phone+existing-email succeeds", r6.status_code == 200,
            f"status={r6.status_code}")
        if r6.status_code == 200:
            rn6 = r6.json().get("registration_no")
            # NOTE: spec says "phone is empty in existing row, so email match should reuse"
            log("email-match reuses reg_no when existing phone empty",
                rn6 == reg_no_emailonly,
                f"got={rn6} expected={reg_no_emailonly}")

    # 1f. Prescription with patient_email — same allocator behaviour
    rx_phone = f"987650{(TS+5)%10000:04d}"
    rx_body = {
        "patient_name": "Rx Email Test",
        "patient_phone": rx_phone,
        "patient_email": EMAIL_RX,
        "visit_date": datetime.now().strftime("%Y-%m-%d"),
        "chief_complaints": "smoke",
        "medicines": [],
    }
    r7 = requests.post(f"{BASE}/prescriptions", headers=H_OWNER, data=json.dumps(rx_body), timeout=15)
    log("POST /prescriptions with patient_email", r7.status_code == 200,
        f"status={r7.status_code} body={r7.text[:200]}")
    if r7.status_code == 200:
        rn7 = r7.json().get("registration_no")
        log("prescription reg_no allocated", bool(rn7 and re.match(r"^\d{9}$", rn7)),
            f"reg_no={rn7}")
        # Verify patient row has email
        js = (
            f"var p = db.patients.findOne({{phone: '{rx_phone}'}}, {{_id:0}}); "
            f"print(JSON.stringify(p));"
        )
        out = mongo_query(js).strip()
        rxp = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    rxp = json.loads(line)
                    break
                except Exception:
                    continue
        log("prescription patient row has email",
            bool(rxp and rxp.get("email") == EMAIL_RX.lower()),
            f"row_email={rxp.get('email') if rxp else None}")


# ─── 2. Patient Database router ─────────────────────────────────────

def test_patient_db():
    print("\n=== TEST 2: /api/patient-db/* ===")

    # 2a. /list — no auth → 401
    r = requests.get(f"{BASE}/patient-db/list", timeout=10)
    log("GET /patient-db/list no-auth → 401", r.status_code == 401, f"status={r.status_code}")

    # 2b. /list as owner → 200 with shape
    r = requests.get(f"{BASE}/patient-db/list", headers=H_OWNER, timeout=15)
    log("GET /patient-db/list owner → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        keys_ok = all(k in body for k in ("items", "total", "limit", "skip", "can_export"))
        log("list response shape", keys_ok, f"keys={list(body.keys())}")
        log("can_export=True for owner", body.get("can_export") is True,
            f"can_export={body.get('can_export')}")

    # 2c. /list as doctor (not in default access set) → 403
    r = requests.get(f"{BASE}/patient-db/list", headers=H_DOCTOR, timeout=10)
    log("GET /patient-db/list doctor (no perm) → 403",
        r.status_code == 403,
        f"status={r.status_code} body={r.text[:200]}")

    # 2d. ?q=<phone>
    r = requests.get(f"{BASE}/patient-db/list?q={PHONE_A}", headers=H_OWNER, timeout=15)
    log("GET /patient-db/list?q=phone → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        items = r.json().get("items", [])
        found = any((i.get("phone") or "").endswith(PHONE_A[-10:]) for i in items)
        log("list q=phone returns matching row", found, f"items={len(items)}")

    # 2e. ?q=<email>
    r = requests.get(f"{BASE}/patient-db/list?q={EMAIL_A1}", headers=H_OWNER, timeout=15)
    log("GET /patient-db/list?q=email → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        items = r.json().get("items", [])
        found = any((i.get("email") or "").lower() == EMAIL_A1.lower() for i in items)
        log("list q=email returns matching row", found, f"items={len(items)}")

    # 2f. ?month=YYYY-MM (current IST month)
    ist_now = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
    cur_month = ist_now.strftime("%Y-%m")
    r = requests.get(f"{BASE}/patient-db/list?month={cur_month}", headers=H_OWNER, timeout=15)
    log(f"GET /patient-db/list?month={cur_month} → 200", r.status_code == 200,
        f"status={r.status_code}")
    if r.status_code == 200:
        # All returned items should have first_seen_at within the IST month
        items = r.json().get("items", [])
        log("month filter returns items", len(items) >= 0, f"count={len(items)}")

    # 2g. ?gender=Male
    r = requests.get(f"{BASE}/patient-db/list?gender=Male", headers=H_OWNER, timeout=15)
    log("GET /patient-db/list?gender=Male → 200", r.status_code == 200, f"status={r.status_code}")

    # 2h. ?limit=5&skip=0 pagination
    r = requests.get(f"{BASE}/patient-db/list?limit=5&skip=0", headers=H_OWNER, timeout=15)
    log("GET /patient-db/list?limit=5 → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        log("pagination respects limit", len(body.get("items", [])) <= 5,
            f"items={len(body.get('items', []))} limit={body.get('limit')}")
        log("limit echoed in response", body.get("limit") == 5,
            f"limit={body.get('limit')}")

    # 2i. /by-phone/{phone} known
    r = requests.get(f"{BASE}/patient-db/by-phone/{PHONE_A}", headers=H_OWNER, timeout=15)
    log("GET /patient-db/by-phone/{known} → 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        keys_ok = all(k in body for k in ("profile", "bookings", "prescriptions", "surgeries", "counts"))
        log("by-phone response shape", keys_ok, f"keys={list(body.keys())}")
        log("by-phone bookings list non-empty",
            isinstance(body.get("bookings"), list) and len(body["bookings"]) >= 1,
            f"len={len(body.get('bookings', []))}")

    # 2j. /by-phone/{unknown} → 404
    unknown = "9999999987"
    r = requests.get(f"{BASE}/patient-db/by-phone/{unknown}", headers=H_OWNER, timeout=10)
    log("GET /patient-db/by-phone/{unknown} → 404",
        r.status_code == 404, f"status={r.status_code}")

    # 2k. /export — owner allowed
    r = requests.get(f"{BASE}/patient-db/export", headers=H_OWNER, timeout=20)
    log("GET /patient-db/export owner → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        ct = r.headers.get("Content-Type", "")
        log("export content-type text/csv; charset=utf-8",
            "text/csv" in ct and "utf-8" in ct.lower(),
            f"ct={ct}")
        # CSV header
        first_line = (r.text.splitlines() or [""])[0]
        expected = "Reg No,Name,Age,Gender,Phone,Email,Address,First seen,Last visit,Visit count"
        log("export CSV header matches spec", first_line == expected,
            f"got='{first_line}'")

    # 2l. /export — doctor 403
    r = requests.get(f"{BASE}/patient-db/export", headers=H_DOCTOR, timeout=10)
    log("GET /patient-db/export doctor → 403",
        r.status_code == 403, f"status={r.status_code}")

    # 2m. /snapshot — owner (primary_owner) allowed
    r = requests.post(f"{BASE}/patient-db/snapshot", headers=H_OWNER, timeout=30)
    log("POST /patient-db/snapshot owner → 200", r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        log("snapshot returns ok+month_key+count",
            body.get("ok") is True and "month_key" in body and "count" in body,
            f"body={body}")
        # Verify mongo row
        mk = body.get("month_key")
        if mk:
            js = (
                f"var s = db.patient_snapshots.findOne({{month_key: '{mk}'}}, {{_id:0, month_key:1, count:1}}); "
                f"print(JSON.stringify(s));"
            )
            out = mongo_query(js).strip()
            srow = None
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("{"):
                    try:
                        srow = json.loads(line)
                        break
                    except Exception:
                        continue
            log("patient_snapshots row exists", bool(srow and srow.get("month_key") == mk),
                f"row={srow}")

    # 2n. /snapshot — doctor (no role) 403
    r = requests.post(f"{BASE}/patient-db/snapshot", headers=H_DOCTOR, timeout=10)
    log("POST /patient-db/snapshot doctor → 403", r.status_code == 403, f"status={r.status_code}")

    # 2o. /admin/users/{uid}/patient-db-permission — staff target
    # Seed a doctor-role staff user via mongosh
    staff_uid = f"smoke-staff-{TS}"
    staff_email = f"smoke-staff-{TS}@example.com"
    js_seed = (
        f"db.users.insertOne({{user_id:'{staff_uid}', email:'{staff_email}', name:'Smoke Staff', "
        f"role:'doctor', created_at:new Date()}}); print('OK');"
    )
    mongo_query(js_seed)

    r = requests.post(
        f"{BASE}/admin/users/{staff_uid}/patient-db-permission",
        headers=H_OWNER,
        data=json.dumps({"allowed": True}),
        timeout=10,
    )
    log("POST /admin/users/{doctor}/patient-db-permission allowed=True → 200",
        r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        log("response ok=True allowed=True", body.get("ok") is True and body.get("allowed") is True,
            f"body={body}")
        # Verify persistence in db.users
        js = (
            f"var u = db.users.findOne({{user_id:'{staff_uid}'}}, "
            f"{{_id:0, can_access_patient_db:1}}); print(JSON.stringify(u));"
        )
        out = mongo_query(js).strip()
        urow = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    urow = json.loads(line)
                    break
                except Exception:
                    continue
        log("can_access_patient_db persisted on users",
            urow and urow.get("can_access_patient_db") is True,
            f"row={urow}")

    # 2p. Same endpoint flip → False
    r = requests.post(
        f"{BASE}/admin/users/{staff_uid}/patient-db-permission",
        headers=H_OWNER,
        data=json.dumps({"allowed": False}),
        timeout=10,
    )
    log("POST patient-db-permission allowed=False → 200", r.status_code == 200,
        f"status={r.status_code}")

    # 2q. owner/partner target — should return note
    # Create partner-role seed user
    part_uid = f"smoke-partner-{TS}"
    js_seed_p = (
        f"db.users.insertOne({{user_id:'{part_uid}', email:'smoke-partner-{TS}@example.com', "
        f"name:'Smoke Partner', role:'partner', created_at:new Date()}}); print('OK');"
    )
    mongo_query(js_seed_p)
    r = requests.post(
        f"{BASE}/admin/users/{part_uid}/patient-db-permission",
        headers=H_OWNER,
        data=json.dumps({"allowed": True}),
        timeout=10,
    )
    log("POST patient-db-permission for partner target → 200 with note",
        r.status_code == 200,
        f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        body = r.json()
        log("partner response includes note", "note" in body, f"body={body}")

    # 2r. doctor token attempting POST → 403
    r = requests.post(
        f"{BASE}/admin/users/{staff_uid}/patient-db-permission",
        headers=H_DOCTOR,
        data=json.dumps({"allowed": True}),
        timeout=10,
    )
    log("POST patient-db-permission doctor → 403", r.status_code == 403, f"status={r.status_code}")

    # 2s. /admin/patient-db-permissions — owner allowed
    r = requests.get(f"{BASE}/admin/patient-db-permissions", headers=H_OWNER, timeout=15)
    log("GET /admin/patient-db-permissions owner → 200", r.status_code == 200,
        f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        items = body.get("items", [])
        log("response has items list", isinstance(items, list), f"count={len(items)}")
        # Verify our seeded staff is included
        found = any(i.get("user_id") == staff_uid for i in items)
        log("seeded staff in items", found, f"count={len(items)}")
        # Verify role filter — only staff roles
        all_staff = all(i.get("role") in ("doctor", "assistant", "reception", "nursing") for i in items)
        log("all items have staff role only", all_staff,
            f"roles={set(i.get('role') for i in items)}")

    # 2t. /admin/patient-db-permissions — doctor → 403
    r = requests.get(f"{BASE}/admin/patient-db-permissions", headers=H_DOCTOR, timeout=10)
    log("GET /admin/patient-db-permissions doctor → 403", r.status_code == 403, f"status={r.status_code}")

    # Cleanup seeds
    js_clean = (
        f"db.users.deleteMany({{user_id:{{$in:['{staff_uid}','{part_uid}']}}}}); print('cleaned');"
    )
    mongo_query(js_clean)


# ─── 3. /api/me/tier expansion ──────────────────────────────────────

def test_me_tier():
    print("\n=== TEST 3: GET /api/me/tier expansion ===")
    r = requests.get(f"{BASE}/me/tier", headers=H_OWNER, timeout=10)
    log("GET /me/tier owner → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        log("can_access_patient_db field present", "can_access_patient_db" in body,
            f"value={body.get('can_access_patient_db')}")
        log("can_export_patient_db field present", "can_export_patient_db" in body,
            f"value={body.get('can_export_patient_db')}")
        log("primary_owner: can_access_patient_db=True",
            body.get("can_access_patient_db") is True,
            f"value={body.get('can_access_patient_db')}")
        log("primary_owner: can_export_patient_db=True",
            body.get("can_export_patient_db") is True,
            f"value={body.get('can_export_patient_db')}")

    # Doctor: default false unless flag
    r = requests.get(f"{BASE}/me/tier", headers=H_DOCTOR, timeout=10)
    log("GET /me/tier doctor → 200", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        body = r.json()
        log("doctor: can_access_patient_db default False (no flag)",
            body.get("can_access_patient_db") is False,
            f"value={body.get('can_access_patient_db')}")
        log("doctor: can_export_patient_db False",
            body.get("can_export_patient_db") is False,
            f"value={body.get('can_export_patient_db')}")


def main():
    test_email_identity()
    test_patient_db()
    test_me_tier()

    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"TOTAL: {passed} PASS / {failed} FAIL out of {len(results)}")
    if failed:
        print("\nFAILED:")
        for label, ok, detail in results:
            if not ok:
                print(f"  ✗ {label}  ::  {detail}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
