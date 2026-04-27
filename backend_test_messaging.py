"""Backend tests for Personal Messaging feature.

Endpoints under test:
  - GET  /api/messages/recipients?q=&scope=team|patients
  - POST /api/messages/send
  - PATCH /api/team/{email}    (can_send_personal_messages flag)
  - GET  /api/auth/me          (can_send_personal_messages exposed)
  - GET  /api/inbox/all        (personal message visible to recipient)
"""
import os
import sys
import json
import time
import uuid
import requests

BASE_URL = "http://localhost:8001"

# Pre-seeded tokens from /app/memory/test_credentials.md
OWNER_TOKEN = "test_session_1776770314741"
OWNER_EMAIL = "sagar.joshi133@gmail.com"
OWNER_USER_ID = "user_4775ed40276e"

DOCTOR_TOKEN = "test_doc_1776771431524"
DOCTOR_EMAIL = "dr.test@example.com"
DOCTOR_USER_ID = "doc-test-1776771431502"

PATIENT_TOKEN = "test_pat_1776799626850"
PATIENT_USER_ID = "test-pat-1776799626850"

PASS = []
FAIL = []


def H(token=None):
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def expect(label, cond, detail=""):
    if cond:
        PASS.append(label)
        print(f"  PASS  {label}")
    else:
        FAIL.append(f"{label} :: {detail}")
        print(f"  FAIL  {label} :: {detail}")


def section(name):
    print(f"\n=== {name} ===")


# ---------------------------------------------------------------
section("0. Sanity")
r = requests.get(f"{BASE_URL}/api/health", timeout=10)
expect("GET /api/health 200", r.status_code == 200, f"got {r.status_code}")

# ---------------------------------------------------------------
section("1. Auth gating - /api/messages/recipients")
r = requests.get(f"{BASE_URL}/api/messages/recipients", timeout=10)
expect("GET recipients no-auth -> 401", r.status_code == 401, f"got {r.status_code}: {r.text[:120]}")

r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=team",
                 headers=H(PATIENT_TOKEN), timeout=10)
expect("GET recipients patient -> 403", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=team",
                 headers=H(DOCTOR_TOKEN), timeout=10)
expect("GET recipients doctor (no perm) -> 403", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

# ---------------------------------------------------------------
section("2. Auth gating - /api/messages/send")
r = requests.post(f"{BASE_URL}/api/messages/send",
                  json={"recipient_user_id": "x", "title": "t", "body": "b"}, timeout=10)
expect("POST send no-auth -> 401", r.status_code == 401, f"got {r.status_code}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(PATIENT_TOKEN),
                  json={"recipient_user_id": OWNER_USER_ID, "title": "Hi", "body": "Hello"}, timeout=10)
expect("POST send patient -> 403", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(DOCTOR_TOKEN),
                  json={"recipient_user_id": OWNER_USER_ID, "title": "Hi", "body": "Hello"}, timeout=10)
expect("POST send doctor (no perm) -> 403", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

# ---------------------------------------------------------------
section("3. /api/auth/me - can_send_personal_messages flag (before PATCH)")
r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(OWNER_TOKEN), timeout=10)
expect("auth/me OWNER 200", r.status_code == 200, f"got {r.status_code}")
me_owner = r.json() if r.status_code == 200 else {}
expect("auth/me OWNER role=owner", me_owner.get("role") == "owner", f"role={me_owner.get('role')}")
expect("auth/me OWNER can_send_personal_messages=True (implicit)",
       me_owner.get("can_send_personal_messages") is True,
       f"got {me_owner.get('can_send_personal_messages')}")

r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(DOCTOR_TOKEN), timeout=10)
expect("auth/me DOCTOR 200", r.status_code == 200, f"got {r.status_code}")
me_doctor = r.json() if r.status_code == 200 else {}
expect("auth/me DOCTOR before PATCH can_send_personal_messages=False",
       me_doctor.get("can_send_personal_messages") is False,
       f"got {me_doctor.get('can_send_personal_messages')}")

r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(PATIENT_TOKEN), timeout=10)
me_patient = r.json() if r.status_code == 200 else {}
expect("auth/me PATIENT can_send_personal_messages=False",
       me_patient.get("can_send_personal_messages") is False,
       f"got {me_patient.get('can_send_personal_messages')}")

# ---------------------------------------------------------------
section("4. PATCH /api/team/{email} - can_send_personal_messages")
r = requests.patch(f"{BASE_URL}/api/team/{DOCTOR_EMAIL}",
                   headers=H(OWNER_TOKEN),
                   json={"can_send_personal_messages": True}, timeout=10)
expect("PATCH team can_send_personal_messages=True 200",
       r.status_code == 200,
       f"got {r.status_code}: {r.text[:200]}")
patch_resp = r.json() if r.status_code == 200 else {}
expect("PATCH echoes can_send_personal_messages=True",
       patch_resp.get("can_send_personal_messages") is True,
       f"got {patch_resp.get('can_send_personal_messages')}")

# Non-owner PATCH -> 403
r = requests.patch(f"{BASE_URL}/api/team/{DOCTOR_EMAIL}",
                   headers=H(DOCTOR_TOKEN),
                   json={"can_send_personal_messages": False}, timeout=10)
expect("PATCH team as non-owner -> 403", r.status_code == 403, f"got {r.status_code}")

# ---------------------------------------------------------------
section("5. GET /api/team reflects can_send_personal_messages")
r = requests.get(f"{BASE_URL}/api/team", headers=H(OWNER_TOKEN), timeout=10)
expect("GET team 200", r.status_code == 200, f"got {r.status_code}")
team_list = r.json() if r.status_code == 200 else []
target = next((t for t in team_list if t.get("email") == DOCTOR_EMAIL), None)
expect(f"GET team contains {DOCTOR_EMAIL}", target is not None,
       f"emails: {[t.get('email') for t in team_list]}")
if target:
    expect("GET team member has can_send_personal_messages=True",
           target.get("can_send_personal_messages") is True,
           f"got {target.get('can_send_personal_messages')} on row: {json.dumps(target)[:300]}")

# ---------------------------------------------------------------
section("6. /api/auth/me - can_send_personal_messages flag (after PATCH)")
r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(DOCTOR_TOKEN), timeout=10)
me_doctor2 = r.json() if r.status_code == 200 else {}
expect("auth/me DOCTOR after PATCH can_send_personal_messages=True",
       me_doctor2.get("can_send_personal_messages") is True,
       f"got {me_doctor2.get('can_send_personal_messages')}")

# ---------------------------------------------------------------
section("7. GET /api/messages/recipients (owner)")
r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=team",
                 headers=H(OWNER_TOKEN), timeout=10)
expect("GET recipients owner scope=team 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
team_items = r.json().get("items", []) if r.status_code == 200 else []
expect("recipients scope=team returns list",
       isinstance(team_items, list) and len(team_items) > 0,
       f"len={len(team_items)}")
expect("recipients scope=team excludes caller",
       all(it.get("user_id") != OWNER_USER_ID for it in team_items),
       f"caller present: {[it.get('user_id') for it in team_items if it.get('user_id') == OWNER_USER_ID]}")
expect("recipients scope=team has no role=patient",
       all(it.get("role") != "patient" for it in team_items),
       f"violators: {[it.get('role') for it in team_items if it.get('role') == 'patient']}")

r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=patients",
                 headers=H(OWNER_TOKEN), timeout=10)
expect("GET recipients owner scope=patients 200", r.status_code == 200, f"got {r.status_code}")
pat_items = r.json().get("items", []) if r.status_code == 200 else []
expect("recipients scope=patients returns list",
       isinstance(pat_items, list) and len(pat_items) > 0,
       f"len={len(pat_items)}")
expect("recipients scope=patients all role=patient",
       all(it.get("role") == "patient" for it in pat_items),
       f"violators: {[it.get('role') for it in pat_items if it.get('role') != 'patient']}")
expect("recipients scope=patients excludes caller",
       all(it.get("user_id") != OWNER_USER_ID for it in pat_items),
       "caller present")

# Substring search via q=
r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=team&q=test",
                 headers=H(OWNER_TOKEN), timeout=10)
expect("GET recipients q=test 200", r.status_code == 200, f"got {r.status_code}")
q_items = r.json().get("items", []) if r.status_code == 200 else []


def _matches_q(it, q):
    q = q.lower()
    return (q in (it.get("name") or "").lower()
            or q in (it.get("email") or "").lower()
            or q in (it.get("phone") or "").lower())


expect("recipients q=test all match substring",
       all(_matches_q(it, "test") for it in q_items),
       f"violators: {[it for it in q_items if not _matches_q(it, 'test')]}")

# Doctor (now with permission) can also list
r = requests.get(f"{BASE_URL}/api/messages/recipients?scope=team",
                 headers=H(DOCTOR_TOKEN), timeout=10)
expect("GET recipients DOCTOR (with perm) 200", r.status_code == 200,
       f"got {r.status_code}: {r.text[:200]}")

# ---------------------------------------------------------------
section("8. POST /api/messages/send - validation")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": DOCTOR_USER_ID, "title": "", "body": "Hi"}, timeout=10)
expect("send empty title -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": DOCTOR_USER_ID, "title": "Hi", "body": ""}, timeout=10)
expect("send empty body -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": DOCTOR_USER_ID, "title": "T" * 141,
                        "body": "valid body"}, timeout=10)
expect("send title>140 -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": DOCTOR_USER_ID, "title": "valid",
                        "body": "B" * 2001}, timeout=10)
expect("send body>2000 -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": "user_does_not_exist_xyz",
                        "title": "valid", "body": "valid body"}, timeout=10)
expect("send unknown recipient -> 404", r.status_code == 404, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": OWNER_USER_ID,
                        "title": "valid", "body": "valid body"}, timeout=10)
expect("send to self -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_email": OWNER_EMAIL,
                        "title": "valid", "body": "valid body"}, timeout=10)
expect("send to self by email -> 400", r.status_code == 400, f"got {r.status_code}: {r.text[:120]}")

# ---------------------------------------------------------------
section("9. POST /api/messages/send - happy path")

unique_marker = uuid.uuid4().hex[:8]
title_text = f"Quick consult update {unique_marker}"
body_text = (f"Dr Sagar, please review patient #{unique_marker} latest USG report. "
             "BPH features noted; consider Dutasteride. - Reception")

r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_user_id": DOCTOR_USER_ID,
                        "title": title_text, "body": body_text}, timeout=10)
expect("send happy (recipient_user_id) 200", r.status_code == 200,
       f"got {r.status_code}: {r.text[:200]}")
resp = r.json() if r.status_code == 200 else {}
expect("send response ok=True", resp.get("ok") is True, f"got {resp.get('ok')}")
notif_id_1 = resp.get("notification_id")
expect("send response notification_id present (str)",
       isinstance(notif_id_1, str) and len(notif_id_1) > 0,
       f"got {notif_id_1!r}")
expect("send response recipient_user_id matches",
       resp.get("recipient_user_id") == DOCTOR_USER_ID,
       f"got {resp.get('recipient_user_id')}")

title2 = f"Inbox test by email {unique_marker}"
body2 = "Sending you a follow-up via your registered email - please ack."
r = requests.post(f"{BASE_URL}/api/messages/send",
                  headers=H(OWNER_TOKEN),
                  json={"recipient_email": DOCTOR_EMAIL,
                        "title": title2, "body": body2}, timeout=10)
expect("send happy (recipient_email) 200", r.status_code == 200,
       f"got {r.status_code}: {r.text[:200]}")
resp2 = r.json() if r.status_code == 200 else {}
expect("send by email resolves to same user_id",
       resp2.get("recipient_user_id") == DOCTOR_USER_ID,
       f"got {resp2.get('recipient_user_id')}")
notif_id_2 = resp2.get("notification_id")

# ---------------------------------------------------------------
section("10. GET /api/inbox/all (recipient) shows personal message")

r = requests.get(f"{BASE_URL}/api/inbox/all?limit=200",
                 headers=H(DOCTOR_TOKEN), timeout=10)
expect("inbox/all DOCTOR 200", r.status_code == 200, f"got {r.status_code}")
inbox = r.json() if r.status_code == 200 else {}
items = inbox.get("items", [])

found_1 = next((it for it in items if it.get("id") == notif_id_1), None)
expect("inbox contains first personal message", found_1 is not None,
       f"notif_id={notif_id_1} not found among {len(items)} items")
if found_1:
    expect("personal message source_type='personal'",
           found_1.get("source_type") == "personal",
           f"got {found_1.get('source_type')}")
    expect("personal message kind='personal'",
           found_1.get("kind") == "personal",
           f"got {found_1.get('kind')}")
    expect("personal message title matches",
           found_1.get("title") == title_text,
           f"got {found_1.get('title')!r}")
    data = found_1.get("data") or {}
    expect("personal message data.sender_name present",
           bool(data.get("sender_name")),
           f"data={data}")
    expect("personal message data.sender_role present",
           bool(data.get("sender_role")),
           f"data={data}")
    expect("personal message data.sender_role=='owner'",
           data.get("sender_role") == "owner",
           f"got {data.get('sender_role')}")

found_2 = next((it for it in items if it.get("id") == notif_id_2), None)
expect("inbox contains second personal message", found_2 is not None,
       f"notif_id={notif_id_2} not found")
if found_2:
    expect("2nd personal message source_type=personal",
           found_2.get("source_type") == "personal",
           f"got {found_2.get('source_type')}")

# ---------------------------------------------------------------
section("11. Cleanup")
r = requests.patch(f"{BASE_URL}/api/team/{DOCTOR_EMAIL}",
                   headers=H(OWNER_TOKEN),
                   json={"can_send_personal_messages": False}, timeout=10)
expect("Cleanup: revert flag 200", r.status_code == 200, f"got {r.status_code}")

import subprocess
ids_to_kill = [x for x in [notif_id_1, notif_id_2] if x]
if ids_to_kill:
    js = "db.notifications.deleteMany({{id: {{$in: {ids}}}}})".format(
        ids=json.dumps(ids_to_kill)
    )
    out = subprocess.run(
        ["mongosh", "consulturo", "--quiet", "--eval", js],
        capture_output=True, text=True, timeout=15,
    )
    print(f"  mongosh cleanup: {out.stdout.strip()}{out.stderr.strip()}")

# ---------------------------------------------------------------
print("\n" + "=" * 60)
print(f"PASS: {len(PASS)}  ·  FAIL: {len(FAIL)}")
if FAIL:
    print("\nFAILURES:")
    for f in FAIL:
        print(f"  FAIL  {f}")
    sys.exit(1)
sys.exit(0)
