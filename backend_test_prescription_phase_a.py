"""Phase A regression test for ConsultUro.

Verifies the prescription "Not found" fix:
- GET /api/prescriptions/{id} now matches patient via last-10 phone digits.
- GET /api/prescriptions/me includes Rx matched by phone & registration_no.
- Existing happy paths (patient_user_id match, owner access) unaffected.
- Authentication required on both endpoints.

Read-only against backend code. Cleans up its own DB fixtures.
"""
import json
import subprocess
import time
import uuid
import requests

BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"

results = []  # (label, ok, detail)


def record(label, ok, detail=""):
    results.append((label, ok, detail))
    icon = "PASS" if ok else "FAIL"
    print(f"[{icon}] {label}  {detail}")


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def mongo_eval(js):
    """Run a mongosh --quiet --eval command and return stdout (string)."""
    r = subprocess.run(
        ["mongosh", "--quiet", "--eval", js],
        capture_output=True, text=True, timeout=30,
    )
    if r.returncode != 0:
        raise RuntimeError(f"mongosh failed: {r.stderr}")
    return r.stdout.strip()


def seed_patient(phone_digits, email=None, registration_no=None):
    """Insert a patient + session via mongosh. Returns (user_id, token)."""
    uid = f"test-patient-{phone_digits}-{int(time.time() * 1000)}"
    token = f"test_pat_session_{uid}"
    if email is None:
        email = f"{uid}@example.com"
    fields = {
        "user_id": uid,
        "email": email,
        "name": f"Patient {phone_digits[-4:]}",
        "role": "patient",
        "phone": "+91" + phone_digits,
        "phone_digits": phone_digits,
    }
    if registration_no:
        fields["registration_no"] = registration_no
    js = (
        "db=db.getSiblingDB('consulturo');"
        f"db.users.insertOne({json.dumps(fields)});"
        "db.user_sessions.insertOne({"
        f"user_id:'{uid}',session_token:'{token}',"
        "expires_at:new Date(Date.now()+7*24*60*60*1000),"
        "created_at:new Date()"
        "});"
        f"print('OK {uid}');"
    )
    out = mongo_eval(js)
    if "OK" not in out:
        raise RuntimeError(f"seed failed: {out}")
    return uid, token


def cleanup_patient(user_id):
    js = (
        "db=db.getSiblingDB('consulturo');"
        f"var u=db.users.deleteMany({{user_id:'{user_id}'}});"
        f"var s=db.user_sessions.deleteMany({{user_id:'{user_id}'}});"
        "print('U='+u.deletedCount+' S='+s.deletedCount);"
    )
    return mongo_eval(js)


def cleanup_rx(rx_id):
    js = (
        "db=db.getSiblingDB('consulturo');"
        f"var r=db.prescriptions.deleteMany({{prescription_id:'{rx_id}'}});"
        "print('RX='+r.deletedCount);"
    )
    return mongo_eval(js)


def main():
    created_rx_ids = []
    seeded_users = []
    try:
        # ────────────────────────────────────────────────────────────
        # 0. Sanity — owner token works
        r = requests.get(f"{BASE}/auth/me", headers=auth(OWNER_TOKEN), timeout=10)
        record("Owner token resolves /auth/me", r.status_code == 200,
               f"status={r.status_code}")

        # ────────────────────────────────────────────────────────────
        # 1a. Owner creates an Rx with patient_phone=+919876512345 and NO patient_user_id.
        # We pick a phone with NO existing user so create_prescription's auto-link
        # leaves patient_user_id=None (the exact scenario the bug fix targets).
        TEST_PHONE = "9876512345"      # last-10 digits
        TEST_PHONE_FULL = "+91" + TEST_PHONE
        OTHER_PHONE = "9999912345"
        OTHER_PHONE_FULL = "+91" + OTHER_PHONE
        digit_variants = [TEST_PHONE, OTHER_PHONE, "91" + TEST_PHONE, "91" + OTHER_PHONE]
        clean_js = (
            "db=db.getSiblingDB('consulturo');"
            "db.users.deleteMany({$or:["
            "{phone:'" + TEST_PHONE_FULL + "'},"
            "{phone:'" + OTHER_PHONE_FULL + "'},"
            "{phone_digits:{$in:" + json.dumps(digit_variants) + "}}"
            "]});"
            "print('CLEAN');"
        )
        mongo_eval(clean_js)

        rx_payload = {
            "patient_name": "Phase A Test Patient",
            "patient_phone": TEST_PHONE_FULL,
            "patient_age": 42,
            "patient_gender": "Male",
            "visit_date": "2026-05-01",
            "chief_complaints": "Phase A baseline complaint",
            "diagnosis": "BPH",
            "investigations_advised": "PSA, USG KUB",
            "medicines": [{
                "name": "Tamsulosin",
                "dosage": "0.4mg",
                "frequency": "HS",
                "duration": "30 days",
            }],
            "follow_up": "2 weeks",
        }
        r = requests.post(f"{BASE}/prescriptions", headers=auth(OWNER_TOKEN),
                          json=rx_payload, timeout=15)
        ok = r.status_code == 200
        record("1a. Owner POST /prescriptions (phone-only, no patient_user_id)",
               ok, f"status={r.status_code}")
        if not ok:
            print(r.text)
            return
        rx_doc = r.json()
        rx_id = rx_doc["prescription_id"]
        created_rx_ids.append(rx_id)
        # Confirm patient_user_id is None (since we cleaned the user row)
        record("1a. Rx has patient_user_id=None (created before patient signed up)",
               rx_doc.get("patient_user_id") in (None, ""),
               f"patient_user_id={rx_doc.get('patient_user_id')!r}")
        record("1a. Rx patient_phone persisted",
               rx_doc.get("patient_phone") == TEST_PHONE_FULL,
               f"patient_phone={rx_doc.get('patient_phone')!r}")

        # ────────────────────────────────────────────────────────────
        # 1b. Seed a patient user whose phone_digits==TEST_PHONE.
        p1_uid, p1_token = seed_patient(TEST_PHONE)
        seeded_users.append(p1_uid)
        # Sanity: /auth/me as patient
        r = requests.get(f"{BASE}/auth/me", headers=auth(p1_token), timeout=10)
        record("1b. Patient1 /auth/me 200",
               r.status_code == 200 and r.json().get("role") == "patient",
               f"status={r.status_code} role={r.json().get('role') if r.ok else 'n/a'}")

        # ────────────────────────────────────────────────────────────
        # 1c. Patient1 GETs the Rx — MUST return 200 via phone-digit match.
        r = requests.get(f"{BASE}/prescriptions/{rx_id}", headers=auth(p1_token), timeout=10)
        ok = r.status_code == 200
        record("1c. Patient1 GET /prescriptions/{id} (phone-digit match) → 200",
               ok, f"status={r.status_code} body={r.text[:200]}")
        if ok:
            body = r.json()
            record("1c. Body has correct prescription_id",
                   body.get("prescription_id") == rx_id,
                   f"prescription_id={body.get('prescription_id')}")
            record("1c. Body has correct patient_phone",
                   body.get("patient_phone") == TEST_PHONE_FULL, "")

        # ────────────────────────────────────────────────────────────
        # 1d. Different patient (other phone) — MUST get 404.
        p2_uid, p2_token = seed_patient(OTHER_PHONE)
        seeded_users.append(p2_uid)
        r = requests.get(f"{BASE}/prescriptions/{rx_id}", headers=auth(p2_token), timeout=10)
        ok = r.status_code == 404
        record("1d. Patient2 (different phone) GET /prescriptions/{id} → 404 (no auth bypass)",
               ok, f"status={r.status_code} body={r.text[:200]}")

        # ────────────────────────────────────────────────────────────
        # 1e. Owner GET — MUST return 200.
        r = requests.get(f"{BASE}/prescriptions/{rx_id}", headers=auth(OWNER_TOKEN), timeout=10)
        record("1e. Owner GET /prescriptions/{id} → 200",
               r.status_code == 200, f"status={r.status_code}")

        # ────────────────────────────────────────────────────────────
        # 2. GET /api/prescriptions/me — patient1 should list the Rx.
        r = requests.get(f"{BASE}/prescriptions/me", headers=auth(p1_token), timeout=10)
        ok = r.status_code == 200
        record("2. Patient1 GET /prescriptions/me → 200", ok,
               f"status={r.status_code}")
        if ok:
            lst = r.json()
            ids = [x.get("prescription_id") for x in lst]
            record("2. /me list includes the phone-matched Rx",
                   rx_id in ids, f"ids={ids}")

        # ────────────────────────────────────────────────────────────
        # 2b. Registration-no $or path.
        # Create an Rx with a unique registration_no and a phone unlikely to
        # collide with patient1's phone.
        reg_no_unique = f"REG-TEST-{uuid.uuid4().hex[:6].upper()}"
        rx2_payload = {
            "patient_name": "Reg-No Test Patient",
            "patient_phone": "+918111122223",   # not patient1's phone (fresh)
            "registration_no": reg_no_unique,
            "visit_date": "2026-05-01",
            "chief_complaints": "regno match path",
            "diagnosis": "Test",
            "medicines": [{
                "name": "Vitamin D",
                "dosage": "60K IU",
                "frequency": "OD",
                "duration": "10 days",
            }],
        }
        r = requests.post(f"{BASE}/prescriptions", headers=auth(OWNER_TOKEN),
                          json=rx2_payload, timeout=15)
        ok = r.status_code == 200
        record("2b. Owner POST Rx with explicit registration_no",
               ok, f"status={r.status_code}")
        if ok:
            rx2_doc = r.json()
            rx2_id = rx2_doc["prescription_id"]
            created_rx_ids.append(rx2_id)
            record("2b. Rx2 registration_no persisted as provided",
                   rx2_doc.get("registration_no") == reg_no_unique,
                   f"got={rx2_doc.get('registration_no')!r} want={reg_no_unique!r}")

            # Update patient1's user profile so its registration_no matches reg_no_unique.
            mongo_eval(
                "db=db.getSiblingDB('consulturo');"
                f"db.users.updateOne({{user_id:'{p1_uid}'}},"
                f"{{$set:{{registration_no:'{reg_no_unique}'}}}});"
                "print('UPDATED');"
            )

            # Patient1 /me should now include rx2 via the registration_no $or clause.
            r = requests.get(f"{BASE}/prescriptions/me", headers=auth(p1_token), timeout=10)
            ok2 = r.status_code == 200
            record("2b. Patient1 GET /prescriptions/me after reg_no update → 200",
                   ok2, f"status={r.status_code}")
            if ok2:
                ids = [x.get("prescription_id") for x in r.json()]
                record("2b. /me list now includes Rx matched by registration_no",
                       rx2_id in ids, f"ids={ids}")

        # ────────────────────────────────────────────────────────────
        # 3. Existing happy path — Rx with patient_user_id set still resolves.
        # Create Rx for patient1, this time patient1 user_id auto-links since
        # phone_digits=TEST_PHONE now exists in db.users.
        rx3_payload = {
            "patient_name": "Uid-Match Patient",
            "patient_phone": TEST_PHONE_FULL,   # patient1's phone
            "visit_date": "2026-05-01",
            "chief_complaints": "uid-match path",
            "diagnosis": "Test",
            "medicines": [{
                "name": "Cefixime",
                "dosage": "200mg",
                "frequency": "BD",
                "duration": "5 days",
            }],
        }
        r = requests.post(f"{BASE}/prescriptions", headers=auth(OWNER_TOKEN),
                          json=rx3_payload, timeout=15)
        ok = r.status_code == 200
        record("3. Owner POST Rx3",
               ok, f"status={r.status_code}")
        if ok:
            rx3 = r.json()
            rx3_id = rx3["prescription_id"]
            created_rx_ids.append(rx3_id)
            # Explicitly stamp patient_user_id=p1_uid to deterministically
            # exercise the uid-match code path in get_prescription (auto-link
            # by phone_digits uses the FULL prefixed digit string and won't
            # match a 10-digit seeded patient — that's a separate concern,
            # not the one this regression test is about).
            mongo_eval(
                "db=db.getSiblingDB('consulturo');"
                f"db.prescriptions.updateOne({{prescription_id:'{rx3_id}'}},"
                f"{{$set:{{patient_user_id:'{p1_uid}'}}}});"
                "print('STAMPED');"
            )
            # Patient1 GET — 200 (uid-match path)
            r = requests.get(f"{BASE}/prescriptions/{rx3_id}",
                             headers=auth(p1_token), timeout=10)
            record("3. Patient1 GET Rx3 (uid-match path) → 200",
                   r.status_code == 200, f"status={r.status_code}")
            # Owner GET — 200
            r = requests.get(f"{BASE}/prescriptions/{rx3_id}",
                             headers=auth(OWNER_TOKEN), timeout=10)
            record("3. Owner GET Rx3 → 200",
                   r.status_code == 200, f"status={r.status_code}")
            # Patient2 GET — 404 (different uid, different phone)
            r = requests.get(f"{BASE}/prescriptions/{rx3_id}",
                             headers=auth(p2_token), timeout=10)
            record("3. Patient2 GET Rx3 → 404",
                   r.status_code == 404, f"status={r.status_code}")

        # ────────────────────────────────────────────────────────────
        # 4. Authentication required.
        r = requests.get(f"{BASE}/prescriptions/{rx_id}", timeout=10)
        record("4. GET /prescriptions/{id} without auth → 401",
               r.status_code == 401, f"status={r.status_code}")
        r = requests.get(f"{BASE}/prescriptions/me", timeout=10)
        record("4. GET /prescriptions/me without auth → 401",
               r.status_code == 401, f"status={r.status_code}")

    finally:
        # ────────────────────────────────────────────────────────────
        # Cleanup
        print("\n--- CLEANUP ---")
        for rxid in created_rx_ids:
            try:
                print(cleanup_rx(rxid))
            except Exception as e:
                print(f"cleanup_rx({rxid}) failed: {e}")
        for uid in seeded_users:
            try:
                print(cleanup_patient(uid))
            except Exception as e:
                print(f"cleanup_patient({uid}) failed: {e}")

    # ────────────────────────────────────────────────────────────
    # Summary
    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{'='*70}")
    print(f"TOTAL: {passed}/{total} PASSED")
    print(f"{'='*70}")
    if passed != total:
        print("\nFAILURES:")
        for label, ok, detail in results:
            if not ok:
                print(f"  - {label}: {detail}")
    return passed == total


if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)
