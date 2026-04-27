"""Backend tests for:
  TEST 1 — Messaging permission unlock propagates via /auth/me
  TEST 2 — Personal message push payload has BOTH `type` AND `kind`
  TEST 3 — Smoke

Runs directly against http://localhost:8001.
"""
import json
import os
import time
import uuid
import subprocess
import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"
OWNER_H = {"Authorization": f"Bearer {OWNER_TOKEN}"}
DOCTOR_H = {"Authorization": f"Bearer {DOCTOR_TOKEN}"}

results = []


def rec(tag, ok, detail=""):
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {tag} — {detail}" if detail else f"[{status}] {tag}")
    results.append((tag, ok, detail))
    return ok


def mongosh(script: str) -> str:
    out = subprocess.run(
        ["mongosh", "--quiet", "--eval", script],
        capture_output=True, text=True, timeout=30,
    )
    return (out.stdout or "") + (out.stderr or "")


def fetch_owner_user_id():
    r = requests.get(f"{BASE}/api/auth/me", headers=OWNER_H, timeout=10)
    return r.json().get("user_id")


def fetch_doctor_user_id():
    r = requests.get(f"{BASE}/api/auth/me", headers=DOCTOR_H, timeout=10)
    return r.json().get("user_id")


# =========================================================
# TEST 1 — messaging permission unlock / flip
# =========================================================
def test_1_messaging_permission():
    print("\n======= TEST 1 — Messaging permission unlock =======")
    owner_uid = fetch_owner_user_id()
    doctor_uid = fetch_doctor_user_id()
    rec("T1.setup owner_uid", bool(owner_uid), owner_uid)
    rec("T1.setup doctor_uid", bool(doctor_uid), doctor_uid)

    # 3a) Owner sets doctor allowed=true
    r = requests.post(
        f"{BASE}/api/admin/users/{doctor_uid}/messaging-permission",
        headers=OWNER_H,
        json={"allowed": True},
        timeout=10,
    )
    rec("T1.1 POST messaging-permission allowed=true -> 200",
        r.status_code == 200, f"{r.status_code} {r.text[:120]}")
    body = r.json() if r.status_code == 200 else {}
    rec("T1.2 response ok=True", body.get("ok") is True, str(body))
    rec("T1.3 response allowed=True", body.get("allowed") is True, str(body))

    # 3b) Verify via GET /api/admin/messaging-permissions
    r = requests.get(f"{BASE}/api/admin/messaging-permissions", headers=OWNER_H, timeout=10)
    rec("T1.4 GET messaging-permissions -> 200", r.status_code == 200, str(r.status_code))
    items = (r.json() or {}).get("items", []) if r.status_code == 200 else []
    doc_row = next((it for it in items if it.get("user_id") == doctor_uid), None)
    rec("T1.5 doctor row present", doc_row is not None, str(doc_row)[:120])
    if doc_row:
        rec("T1.6 doctor allowed=True in listing", doc_row.get("allowed") is True, str(doc_row))

    # 3c) Verify via /auth/me of doctor
    r = requests.get(f"{BASE}/api/auth/me", headers=DOCTOR_H, timeout=10)
    csmp = r.json().get("can_send_personal_messages") if r.status_code == 200 else None
    rec("T1.7 /auth/me doctor can_send_personal_messages=True", csmp is True, f"csmp={csmp}")

    # 3d) Verify persisted in db.users
    out = mongosh(
        f"db = db.getSiblingDB('consulturo'); "
        f"var u = db.users.findOne({{user_id:'{doctor_uid}'}}, {{_id:0,can_send_personal_messages:1}}); "
        f"print(JSON.stringify(u));"
    )
    rec("T1.8 db.users.can_send_personal_messages=true",
        '"can_send_personal_messages":true' in out.lower().replace(' ', ''),
        out.strip()[:200])

    # 4) Flip back to false
    r = requests.post(
        f"{BASE}/api/admin/users/{doctor_uid}/messaging-permission",
        headers=OWNER_H,
        json={"allowed": False},
        timeout=10,
    )
    rec("T1.9 POST allowed=false -> 200", r.status_code == 200, str(r.status_code))
    body = r.json() if r.status_code == 200 else {}
    rec("T1.10 response allowed=False", body.get("allowed") is False, str(body))

    # Verify DB again
    out = mongosh(
        f"db = db.getSiblingDB('consulturo'); "
        f"var u = db.users.findOne({{user_id:'{doctor_uid}'}}, {{_id:0,can_send_personal_messages:1}}); "
        f"print(JSON.stringify(u));"
    )
    rec("T1.11 db.users.can_send_personal_messages=false",
        '"can_send_personal_messages":false' in out.lower().replace(' ', ''),
        out.strip()[:200])

    # Verify /auth/me updates back to false
    r = requests.get(f"{BASE}/api/auth/me", headers=DOCTOR_H, timeout=10)
    csmp = r.json().get("can_send_personal_messages") if r.status_code == 200 else None
    # Default for staff is True if explicit != False; here explicit==False should flip auth/me to False
    rec("T1.12 /auth/me doctor flipped back to False", csmp is False, f"csmp={csmp}")


# =========================================================
# TEST 2 — personal message push payload has BOTH type + kind
# =========================================================
def test_2_push_payload():
    print("\n======= TEST 2 — Push payload type+kind =======")
    doctor_uid = fetch_doctor_user_id()

    # Register a fake Expo push token for the doctor so push_to_user will
    # attempt to send (and log the push attempt in db.push_log) — the
    # actual Expo call will fail (invalid token) but push_log row is
    # written with `data_type` populated, which tells us `type` was set.
    fake_token = f"ExponentPushToken[TEST-{uuid.uuid4().hex[:16]}]"
    r = requests.post(
        f"{BASE}/api/push/register",
        headers=DOCTOR_H,
        json={"token": fake_token, "platform": "android", "device_name": "test-harness"},
        timeout=10,
    )
    rec("T2.setup register fake push token for doctor",
        r.status_code == 200, f"{r.status_code} token={fake_token}")

    # Note the current push_log count BEFORE sending
    out = mongosh(
        "db = db.getSiblingDB('consulturo'); print(db.push_log.countDocuments({}));"
    )
    try:
        push_log_before = int(out.strip().splitlines()[-1])
    except Exception:
        push_log_before = 0

    # Send personal message Owner -> Doctor
    payload = {
        "title": "Test from agent",
        "body": "Permission/push test",
        "recipient_user_id": doctor_uid,
    }
    r = requests.post(f"{BASE}/api/messages/send", headers=OWNER_H, json=payload, timeout=15)
    rec("T2.1 POST /api/messages/send -> 200",
        r.status_code == 200, f"{r.status_code} {r.text[:160]}")
    body = r.json() if r.status_code == 200 else {}
    notification_id = body.get("notification_id")
    rec("T2.2 response ok=True", body.get("ok") is True, str(body))
    rec("T2.3 response has notification_id", bool(notification_id), str(body))
    rec("T2.4 response recipient_user_id==doctor",
        body.get("recipient_user_id") == doctor_uid, str(body))

    # Verify notifications row created with kind=personal
    if notification_id:
        out = mongosh(
            "db = db.getSiblingDB('consulturo'); "
            f"var n = db.notifications.findOne({{id:'{notification_id}'}}, {{_id:0}}); "
            "print(JSON.stringify(n));"
        )
        try:
            n_str = out.strip().splitlines()[-1]
            n = json.loads(n_str) if n_str and n_str != "null" else {}
        except Exception:
            n = {}
        rec("T2.5 db.notifications row exists", bool(n), n_str[:200] if 'n_str' in dir() else "")
        rec("T2.6 notification.kind == 'personal'", n.get("kind") == "personal", str(n.get("kind")))
        rec("T2.7 notification.user_id == doctor_uid",
            n.get("user_id") == doctor_uid, str(n.get("user_id")))

    # Wait a moment for the async push call to hit push_log
    time.sleep(2.5)

    # Inspect push_log — look for most recent row with data_type=personal
    out = mongosh(
        "db = db.getSiblingDB('consulturo'); "
        "var r = db.push_log.find({data_type:'personal'}, {_id:0}).sort({created_at:-1}).limit(3).toArray(); "
        "print(JSON.stringify(r));"
    )
    try:
        logs_str = out.strip().splitlines()[-1]
        logs = json.loads(logs_str) if logs_str else []
    except Exception:
        logs = []
    rec("T2.8 push_log row with data_type='personal' exists (confirms type='personal' in push payload)",
        len(logs) > 0, f"len={len(logs)} sample={(logs[0] if logs else {})!r}"[:240])

    # KIND is not stored in push_log. Verify via code review:
    # server.py:6209 sends data={"type":"personal","kind":"personal"} to push_to_user;
    # push_to_user -> send_expo_push_batch passes `data` through to Expo msg["data"] verbatim
    # (server.py:5121-5122). So BOTH fields are guaranteed present in the push payload.
    # We additionally verify by reading the file:
    with open("/app/backend/server.py", "r") as f:
        src = f.read()
    type_kind_line = 'data={"type": "personal", "kind": "personal"}'
    rec("T2.9 server.py contains push data with BOTH type AND kind (code verification)",
        type_kind_line in src, "checked literal presence of data={type,kind} in server.py")

    # Verify GET /api/inbox/all as DOCTOR returns the message
    r = requests.get(f"{BASE}/api/inbox/all", headers=DOCTOR_H, timeout=10)
    rec("T2.10 GET /api/inbox/all as doctor -> 200", r.status_code == 200, str(r.status_code))
    inbox = r.json() if r.status_code == 200 else {}
    items = inbox.get("items") or []
    match = next((it for it in items if it.get("id") == notification_id), None)
    rec("T2.11 new message visible in doctor inbox",
        match is not None, f"len(inbox)={len(items)} match_found={match is not None}")
    if match:
        rec("T2.12 inbox item kind='personal'", match.get("kind") == "personal", str(match.get("kind")))

    # Cleanup: delete the notification + fake push token
    if notification_id:
        mongosh(
            "db = db.getSiblingDB('consulturo'); "
            f"print('deleted notif:', db.notifications.deleteOne({{id:'{notification_id}'}}).deletedCount);"
        )
    mongosh(
        "db = db.getSiblingDB('consulturo'); "
        f"print('deleted token:', db.push_tokens.deleteOne({{token:'{fake_token}'}}).deletedCount);"
    )


# =========================================================
# TEST 3 — smoke regression
# =========================================================
def test_3_smoke():
    print("\n======= TEST 3 — Smoke =======")
    r = requests.get(f"{BASE}/api/health", timeout=10)
    rec("T3.1 GET /api/health -> 200", r.status_code == 200, str(r.status_code))
    j = r.json() if r.status_code == 200 else {}
    rec("T3.2 health db==connected", j.get("db") == "connected", str(j))

    r = requests.get(f"{BASE}/api/notifications", headers=OWNER_H, timeout=10)
    rec("T3.3 GET /api/notifications as owner -> 200", r.status_code == 200,
        f"{r.status_code} item_count={len((r.json() or {}).get('items', [])) if r.status_code==200 else '-'}")

    r = requests.get(f"{BASE}/api/inbox/all", headers=OWNER_H, timeout=10)
    rec("T3.4 GET /api/inbox/all as owner -> 200", r.status_code == 200,
        f"{r.status_code} item_count={len((r.json() or {}).get('items', [])) if r.status_code==200 else '-'}")


if __name__ == "__main__":
    test_1_messaging_permission()
    test_2_push_payload()
    test_3_smoke()

    total = len(results)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n============= SUMMARY =============")
    print(f"{passed}/{total} PASS")
    fails = [(t, d) for t, ok, d in results if not ok]
    if fails:
        print("\nFAILURES:")
        for t, d in fails:
            print(f"  - {t}: {d}")
    exit(0 if passed == total else 1)
