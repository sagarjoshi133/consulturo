"""Backend tests for June 2025 patch:
1. Demo Accounts list — pending invites visibility & delete by pending:<email>
2. Personal messaging owner-tier implicit permission
3. Regression smoke: /api/health, /api/me/tier, /api/admin/platform-stats
"""
import json
import os
import sys
import urllib.parse
import requests

BASE = "http://localhost:8001"

OWNER_TOKEN = "test_session_1776770314741"          # primary_owner sagar.joshi133@gmail.com
SO_TOKEN = "test_so_session_1777384407439"           # super_owner app.consulturo@gmail.com (created via mongosh)
DOC_TOKEN = "test_doc_1776771431524"                 # doctor dr.test@example.com

PASS = []
FAIL = []


def expect(cond, label, detail=""):
    if cond:
        PASS.append(label)
        print(f"  PASS  {label}")
    else:
        FAIL.append((label, detail))
        print(f"  FAIL  {label}  {detail}")


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def main():
    # ── Sanity: tokens valid? ──
    print("\n=== SANITY ===")
    for label, tok in [("OWNER", OWNER_TOKEN), ("SO", SO_TOKEN), ("DOC", DOC_TOKEN)]:
        r = requests.get(f"{BASE}/api/auth/me", headers=H(tok), timeout=10)
        print(f"  {label} /auth/me -> {r.status_code} role={r.json().get('role') if r.status_code==200 else '?'}")

    # ── TEST 1: Demo accounts list with pending invites & signed_in flag ──
    print("\n=== TEST 1 — Demo Accounts (pending visibility) ===")
    EMAIL_PEND = "demo-test-pending-001@example.com"
    EMAIL_PAT  = "demo-test-patient-002@example.com"

    # Pre-cleanup any leftover
    for e in (EMAIL_PEND, EMAIL_PAT):
        requests.delete(f"{BASE}/api/admin/demo/{urllib.parse.quote('pending:'+e, safe='')}", headers=H(SO_TOKEN), timeout=10)
    # Also try cleanup by user_id of EMAIL_PAT if exists
    r = requests.get(f"{BASE}/api/admin/demo", headers=H(SO_TOKEN), timeout=10)
    if r.status_code == 200:
        for it in r.json().get("items", []):
            if it.get("email") in (EMAIL_PEND, EMAIL_PAT):
                uid = it.get("user_id") or f"pending:{it['email']}"
                requests.delete(f"{BASE}/api/admin/demo/{urllib.parse.quote(uid, safe='')}", headers=H(SO_TOKEN), timeout=10)

    # 1a. Create primary_owner demo (no users row yet; pending invite)
    body = {"email": EMAIL_PEND, "name": "Pending Demo", "role": "primary_owner"}
    r = requests.post(f"{BASE}/api/admin/demo/create", headers=H(SO_TOKEN), data=json.dumps(body), timeout=10)
    expect(r.status_code in (200, 201) and r.json().get("ok") is True,
           "POST /admin/demo/create primary_owner returns ok:true",
           f"status={r.status_code} body={r.text[:200]}")

    # 1b. GET /admin/demo — pending email must appear with signed_in:false
    r = requests.get(f"{BASE}/api/admin/demo", headers=H(SO_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /admin/demo 200", f"status={r.status_code}")
    items = r.json().get("items", []) if r.status_code == 200 else []
    pending = next((x for x in items if x.get("email") == EMAIL_PEND), None)
    expect(pending is not None, "Pending demo appears in items[]", f"items emails={[i.get('email') for i in items]}")
    if pending is not None:
        expect("signed_in" in pending, "Pending item has 'signed_in' key", f"pending={pending}")
        expect(pending.get("signed_in") is False, "Pending item signed_in == false",
               f"signed_in={pending.get('signed_in')}")
        expect(pending.get("user_id") in (None, ""), "Pending item user_id is None (no live row)",
               f"user_id={pending.get('user_id')}")

    # 1c. Create patient demo with sample data
    body = {"email": EMAIL_PAT, "name": "Patient Demo", "role": "patient", "seed_sample_data": True}
    r = requests.post(f"{BASE}/api/admin/demo/create", headers=H(SO_TOKEN), data=json.dumps(body), timeout=20)
    expect(r.status_code in (200, 201) and r.json().get("ok") is True,
           "POST /admin/demo/create patient returns ok:true",
           f"status={r.status_code} body={r.text[:200]}")
    patient_user_id = r.json().get("user_id") if r.status_code in (200, 201) else None

    # 1d. GET /admin/demo — patient demo with signed_in:true
    r = requests.get(f"{BASE}/api/admin/demo", headers=H(SO_TOKEN), timeout=10)
    items = r.json().get("items", []) if r.status_code == 200 else []
    patient_item = next((x for x in items if x.get("email") == EMAIL_PAT), None)
    expect(patient_item is not None, "Patient demo appears in items[]",
           f"emails={[i.get('email') for i in items]}")
    if patient_item:
        expect(patient_item.get("signed_in") is True, "Patient demo signed_in == true",
               f"signed_in={patient_item.get('signed_in')}")
        expect(patient_item.get("user_id") == patient_user_id,
               "Patient demo user_id matches creation response",
               f"item={patient_item.get('user_id')} created={patient_user_id}")

    # 1e. DELETE pending demo via pending:<email>
    pending_path = "pending:" + EMAIL_PEND
    r = requests.delete(f"{BASE}/api/admin/demo/{urllib.parse.quote(pending_path, safe='')}",
                        headers=H(SO_TOKEN), timeout=10)
    expect(r.status_code == 200, "DELETE /admin/demo/pending:<email> 200",
           f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        expect(d.get("ok") is True, "Delete pending: ok=true", f"body={d}")
        expect(d.get("revoked_invites", 0) >= 1, "Delete pending: revoked_invites >= 1",
               f"revoked_invites={d.get('revoked_invites')}")

    # 1f. After delete, pending email gone from list
    r = requests.get(f"{BASE}/api/admin/demo", headers=H(SO_TOKEN), timeout=10)
    items = r.json().get("items", []) if r.status_code == 200 else []
    expect(not any(x.get("email") == EMAIL_PEND for x in items),
           "Pending email gone from /admin/demo after delete",
           f"emails={[i.get('email') for i in items]}")

    # 1g. DELETE patient demo by real user_id
    if patient_user_id:
        r = requests.delete(f"{BASE}/api/admin/demo/{patient_user_id}", headers=H(SO_TOKEN), timeout=10)
        expect(r.status_code == 200, "DELETE /admin/demo/{user_id} (patient) 200",
               f"status={r.status_code} body={r.text[:200]}")
        if r.status_code == 200:
            d = r.json()
            expect("cleanup" in d and isinstance(d["cleanup"], dict),
                   "Patient demo delete returns cleanup counts", f"body={d}")

        # 1h. Patient gone from list
        r = requests.get(f"{BASE}/api/admin/demo", headers=H(SO_TOKEN), timeout=10)
        items = r.json().get("items", []) if r.status_code == 200 else []
        expect(not any(x.get("email") == EMAIL_PAT for x in items),
               "Patient demo gone from /admin/demo after delete",
               f"emails={[i.get('email') for i in items]}")

    # ── TEST 2: Personal messaging — owner-tier implicit permission ──
    print("\n=== TEST 2 — Personal messaging owner-tier implicit ===")

    # 2a. GET /auth/me as primary_owner -> can_send_personal_messages: true
    r = requests.get(f"{BASE}/api/auth/me", headers=H(OWNER_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /auth/me primary_owner 200")
    if r.status_code == 200:
        b = r.json()
        expect(b.get("role") == "primary_owner", "primary_owner role echoed", f"role={b.get('role')}")
        expect(b.get("can_send_personal_messages") is True,
               "primary_owner /auth/me can_send_personal_messages: true",
               f"value={b.get('can_send_personal_messages')}")

    # 2b. /api/me/tier as primary_owner
    r = requests.get(f"{BASE}/api/me/tier", headers=H(OWNER_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /me/tier primary_owner 200")
    if r.status_code == 200:
        b = r.json()
        expect(b.get("is_owner_tier") is True, "primary_owner is_owner_tier=true")
        # can_send_personal_messages is NOT in /api/me/tier per code review;
        # informational only — this is fine, the auth/me check above is authoritative.
        if "can_send_personal_messages" in b:
            expect(b.get("can_send_personal_messages") is True,
                   "/me/tier primary_owner can_send_personal_messages: true (if exposed)")

    # 2c. POST /api/messages/send as primary_owner -> patient
    # Find a patient recipient
    r = requests.get(f"{BASE}/api/messages/recipients?scope=patients", headers=H(OWNER_TOKEN), timeout=10)
    pat_uid = None
    if r.status_code == 200:
        items = r.json().get("items", [])
        if items:
            pat_uid = items[0].get("user_id")
    expect(pat_uid is not None, "Found at least one patient for messaging test",
           f"items_count={len(r.json().get('items', [])) if r.status_code==200 else 'err'}")
    sent_message_ids = []
    if pat_uid:
        body = {
            "recipient_user_id": pat_uid,
            "title": "Owner-tier implicit permission test",
            "body": "Hello from primary_owner — this is a test message.",
        }
        r = requests.post(f"{BASE}/api/messages/send", headers=H(OWNER_TOKEN),
                          data=json.dumps(body), timeout=15)
        expect(r.status_code in (200, 201),
               "POST /messages/send primary_owner -> patient 200/201",
               f"status={r.status_code} body={r.text[:200]}")
        if r.status_code in (200, 201):
            mid = r.json().get("notification_id")
            if mid:
                sent_message_ids.append(mid)

    # 2d. As doctor: /auth/me + send to patient
    r = requests.get(f"{BASE}/api/auth/me", headers=H(DOC_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /auth/me doctor 200")
    doc_can_send = r.json().get("can_send_personal_messages") if r.status_code == 200 else None
    # NOTE: doctor's stored flag may have been flipped by previous tests; just verify
    # endpoint responds and the key is present. The actual rule: if doctor's stored
    # flag is None or True, can_send is True. If explicitly False, it's False.
    expect("can_send_personal_messages" in (r.json() if r.status_code == 200 else {}),
           "doctor /auth/me has can_send_personal_messages key")

    if pat_uid and doc_can_send is not False:
        body = {
            "recipient_user_id": pat_uid,
            "title": "Doctor staff-default test",
            "body": "Hello from doctor.",
        }
        r = requests.post(f"{BASE}/api/messages/send", headers=H(DOC_TOKEN),
                          data=json.dumps(body), timeout=15)
        expect(r.status_code in (200, 201),
               "POST /messages/send doctor -> patient 200/201 (staff-default-true)",
               f"status={r.status_code} body={r.text[:200]} doc_can_send={doc_can_send}")
        if r.status_code in (200, 201):
            mid = r.json().get("notification_id")
            if mid:
                sent_message_ids.append(mid)
    elif doc_can_send is False:
        print(f"  SKIP doctor send: stored can_send_personal_messages explicitly False (overridden by previous test).")

    # ── TEST 3: Regression smoke ──
    print("\n=== TEST 3 — Regression smoke ===")

    r = requests.get(f"{BASE}/api/health", timeout=10)
    expect(r.status_code == 200 and r.json().get("ok") is True,
           "GET /api/health -> 200 ok:true",
           f"status={r.status_code} body={r.text[:200]}")

    r = requests.get(f"{BASE}/api/me/tier", headers=H(OWNER_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /me/tier primary_owner 200")
    if r.status_code == 200:
        b = r.json()
        for k in ("role", "is_super_owner", "is_primary_owner", "is_partner",
                  "is_owner_tier", "can_manage_partners", "can_manage_primary_owners",
                  "can_create_blog", "dashboard_full_access", "is_demo"):
            expect(k in b, f"/me/tier has key '{k}'", f"keys={list(b.keys())}")

    r = requests.get(f"{BASE}/api/admin/platform-stats", headers=H(SO_TOKEN), timeout=10)
    expect(r.status_code == 200, "GET /admin/platform-stats super_owner 200",
           f"status={r.status_code} body={r.text[:200]}")
    if r.status_code == 200:
        b = r.json()
        for k in ("primary_owners", "partners", "staff", "patients",
                  "bookings_last_30d", "prescriptions_last_30d", "demo_accounts"):
            expect(k in b and isinstance(b[k], int), f"platform-stats has int key '{k}'",
                   f"keys={list(b.keys())}")

    # ── Cleanup any leftover test message notifications (best effort) ──
    print("\n=== CLEANUP ===")
    print(f"  test message ids created: {sent_message_ids}")

    # Final report
    print("\n========================================")
    print(f"PASS: {len(PASS)}  FAIL: {len(FAIL)}")
    if FAIL:
        print("\nFAILURES:")
        for label, detail in FAIL:
            print(f"  - {label}\n      {detail}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
