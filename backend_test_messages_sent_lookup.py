"""
Tests for NEW endpoints:
  - GET /api/messages/sent
  - GET /api/messages/lookup-by-phone

Hits backend at http://localhost:8001 directly (review_request).
"""

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import requests

BASE = "http://localhost:8001"
OWNER_TOKEN = "test_session_1776770314741"
DOCTOR_TOKEN = "test_doc_1776771431524"
DOCTOR_PHONE_E164 = "9408289199"  # last 10 digits of dr.sagar joshi (doctor role)

PASS = "✅"
FAIL = "❌"

results = []  # list of (name, ok, info)


def log(name, ok, info=""):
    sym = PASS if ok else FAIL
    print(f"{sym} {name}: {info}")
    results.append((name, ok, info))


def auth_h(token):
    return {"Authorization": f"Bearer {token}"}


def get(path, token=None, **params):
    return requests.get(
        BASE + path,
        headers=auth_h(token) if token else {},
        params=params or None,
        timeout=15,
    )


def post(path, token=None, json_body=None):
    return requests.post(
        BASE + path,
        headers=auth_h(token) if token else {},
        json=json_body,
        timeout=15,
    )


# ════════ T1 — Auth required for /messages/sent ════════
def t1():
    r = requests.get(BASE + "/api/messages/sent", timeout=10)
    log("T1 GET /api/messages/sent no-auth → 401", r.status_code == 401, f"got {r.status_code}")


# ════════ T2 — Owner sent history shape ════════
OWNER_USER_ID = None
DOCTOR_USER_ID = None


def fetch_user_ids():
    global OWNER_USER_ID, DOCTOR_USER_ID
    r = get("/api/auth/me", OWNER_TOKEN)
    if r.status_code == 200:
        OWNER_USER_ID = r.json().get("user_id")
    r = get("/api/auth/me", DOCTOR_TOKEN)
    if r.status_code == 200:
        DOCTOR_USER_ID = r.json().get("user_id")
    return OWNER_USER_ID, DOCTOR_USER_ID


def t2():
    r = get("/api/messages/sent", OWNER_TOKEN)
    if r.status_code != 200:
        log("T2 GET /api/messages/sent OWNER → 200", False, f"got {r.status_code} body={r.text[:200]}")
        return
    j = r.json()
    items = j.get("items")
    count = j.get("count")
    ok_shape = isinstance(items, list) and isinstance(count, int) and count == len(items)
    log("T2 OWNER 200 with items[]/count", ok_shape, f"count={count}, items_len={len(items) if isinstance(items, list) else 'NA'}")

    # Validate per-item shape
    if not items:
        log("T2 OWNER has at least 1 sent item (informational)", True, "empty - will rely on T5 round-trip")
        return

    bad = []
    prev_ts = None
    sorted_ok = True
    for it in items:
        miss = []
        for k in ("id", "title", "body", "kind", "source_type", "read", "created_at", "data"):
            if k not in it:
                miss.append(k)
        if miss:
            bad.append((it.get("id"), f"missing keys {miss}"))
            continue
        if it["kind"] != "personal":
            bad.append((it.get("id"), f"kind={it['kind']}"))
        if it["source_type"] != "personal":
            bad.append((it.get("id"), f"source_type={it['source_type']}"))
        if it["read"] is not True:
            bad.append((it.get("id"), f"read={it['read']}"))
        d = it.get("data") or {}
        if d.get("sender_user_id") != OWNER_USER_ID:
            bad.append((it.get("id"), f"sender_user_id={d.get('sender_user_id')} expected={OWNER_USER_ID}"))
        # created_at must be ISO parseable
        ca = it.get("created_at")
        if isinstance(ca, str):
            try:
                this_ts = datetime.fromisoformat(ca.replace("Z", "+00:00"))
            except Exception:
                bad.append((it.get("id"), f"created_at not ISO: {ca}"))
                this_ts = None
        else:
            # mongo may return raw datetime in JSON encoder, but FastAPI usually serializes ISO
            try:
                this_ts = datetime.fromisoformat(str(ca))
            except Exception:
                bad.append((it.get("id"), f"created_at not parseable: {ca}"))
                this_ts = None
        if this_ts and prev_ts and this_ts > prev_ts:
            sorted_ok = False
        if this_ts:
            prev_ts = this_ts

    log("T2 every item has expected fields + correct sender_user_id", len(bad) == 0, f"bad={bad[:3]}")
    log("T2 items sorted newest-first", sorted_ok, "")

    # recipient enrichment best-effort
    enriched = sum(1 for it in items if (it.get("data") or {}).get("recipient_name") or (it.get("data") or {}).get("recipient_role"))
    log(
        "T2 best-effort recipient enrichment present on at least one item",
        enriched > 0 or len(items) == 0,
        f"enriched={enriched}/{len(items)}",
    )


# ════════ T3 — Doctor (likely empty) ════════
def t3():
    r = get("/api/messages/sent", DOCTOR_TOKEN)
    if r.status_code != 200:
        log("T3 GET /api/messages/sent DOCTOR → 200", False, f"got {r.status_code}")
        return
    j = r.json()
    log("T3 DOCTOR 200 list returned", isinstance(j.get("items"), list), f"count={j.get('count')}")


# ════════ T4 — limit param ════════
def t4():
    r = get("/api/messages/sent", OWNER_TOKEN, limit=2)
    ok = r.status_code == 200 and isinstance(r.json().get("items"), list) and len(r.json()["items"]) <= 2
    log("T4a limit=2 returns ≤2 items", ok, f"got {len(r.json().get('items', []))}")

    r = get("/api/messages/sent", OWNER_TOKEN, limit=999)
    ok = r.status_code == 200 and len(r.json().get("items", [])) <= 300
    log("T4b limit=999 capped at 300", ok, f"got {len(r.json().get('items', []))}")

    r = get("/api/messages/sent", OWNER_TOKEN, limit=0)
    ok = r.status_code == 200  # server normalizes to min=1
    log("T4c limit=0 handled gracefully", ok, f"status={r.status_code} count={r.json().get('count') if r.status_code==200 else '-'}")


# ════════ T5 — round trip ════════
new_notification_id = None


def t5():
    global new_notification_id
    if not DOCTOR_USER_ID:
        log("T5 prerequisite: DOCTOR user_id known", False, "fetch_user_ids failed")
        return
    title = f"RT-Test-{uuid.uuid4().hex[:8]}"
    body = "Round-trip sent message verification."
    r = post(
        "/api/messages/send",
        OWNER_TOKEN,
        json_body={
            "recipient_user_id": DOCTOR_USER_ID,
            "title": title,
            "body": body,
        },
    )
    if r.status_code != 200:
        log("T5 POST /api/messages/send → 200", False, f"got {r.status_code} body={r.text[:200]}")
        return
    new_notification_id = r.json().get("notification_id")
    log("T5 POST /api/messages/send 200 with notification_id", bool(new_notification_id), f"id={new_notification_id}")

    # Now GET sent → newest at index 0 should be this title.
    r = get("/api/messages/sent", OWNER_TOKEN, limit=10)
    if r.status_code != 200:
        log("T5 GET /api/messages/sent post-send → 200", False, f"got {r.status_code}")
        return
    items = r.json().get("items") or []
    if not items:
        log("T5 sent list non-empty after sending", False, "empty")
        return
    head = items[0]
    ok_title = head.get("title") == title
    ok_body = head.get("body") == body
    ok_id = head.get("id") == new_notification_id
    log("T5 newest item title matches", ok_title, f"got {head.get('title')}")
    log("T5 newest item body matches", ok_body, "")
    log("T5 newest item id matches", ok_id, f"got {head.get('id')}")
    # Also verify recipient enrichment for this specific item
    d = head.get("data") or {}
    log(
        "T5 recipient enrichment present (recipient_name/role)",
        bool(d.get("recipient_name")) and bool(d.get("recipient_role")),
        f"recipient_name={d.get('recipient_name')} role={d.get('recipient_role')}",
    )


# ════════════════════════════════════════════
# T6 — Auth required for lookup-by-phone
# ════════════════════════════════════════════
def t6():
    r = requests.get(BASE + "/api/messages/lookup-by-phone", params={"phone": "9408289199"}, timeout=10)
    log("T6 lookup no-auth → 401", r.status_code == 401, f"got {r.status_code}")


# ════════════════════════════════════════════
# T7 — empty / missing phone → 400
# ════════════════════════════════════════════
def t7():
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN)
    log("T7a lookup no-phone → 400", r.status_code == 400, f"got {r.status_code} body={r.text[:120]}")
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN, phone="")
    log("T7b lookup phone='' → 400", r.status_code == 400, f"got {r.status_code} body={r.text[:120]}")


# ════════════════════════════════════════════
# T8 — Owner resolves doctor by phone
# ════════════════════════════════════════════
def t8():
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN, phone="9408289199")
    if r.status_code != 200:
        log("T8 lookup phone=9408289199 OWNER → 200", False, f"got {r.status_code} body={r.text[:200]}")
        return
    j = r.json()
    log("T8 found=true", j.get("found") is True, f"resp={j}")
    user = j.get("user") or {}
    for k in ("user_id", "name", "email", "phone", "role"):
        log(f"T8 user.{k} present", k in user, f"value={user.get(k)}")
    log("T8 user.role == 'doctor'", user.get("role") == "doctor", f"got {user.get('role')}")


# ════════════════════════════════════════════
# T9 — Owner unknown phone → found=false
# ════════════════════════════════════════════
def t9():
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN, phone="9999999999")
    ok = r.status_code == 200
    log("T9 unknown phone → 200", ok, f"got {r.status_code}")
    if ok:
        j = r.json()
        log("T9 found=false", j.get("found") is False, f"resp={j}")
        log("T9 phone normalized echoed", j.get("phone") == "9999999999", f"phone={j.get('phone')}")


# ════════════════════════════════════════════
# T10 — Country code stripped via suffix match
# ════════════════════════════════════════════
def t10():
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN, phone="+919408289199")
    if r.status_code != 200:
        log("T10 lookup phone=+919408289199 → 200", False, f"got {r.status_code}")
        return
    j = r.json()
    log("T10 found=true with country code prefix", j.get("found") is True, f"resp keys={list(j.keys())}")


# ════════════════════════════════════════════
# T11 — Patient permission boundary
# ════════════════════════════════════════════
PATIENT_TOKEN = None
PATIENT_USER_ID = None
TARGET_PATIENT_USER_ID = None
TARGET_PATIENT_PHONE = "+918888888888"


def seed_patients():
    global PATIENT_TOKEN, PATIENT_USER_ID, TARGET_PATIENT_USER_ID
    PATIENT_USER_ID = f"test-pat-lookup-{int(time.time()*1000)}"
    PATIENT_TOKEN = f"test_pat_lookup_{int(time.time()*1000)}"
    TARGET_PATIENT_USER_ID = f"tmp-pat-target-{int(time.time()*1000)}"
    js = f"""
    db = db.getSiblingDB('consulturo');
    db.users.insertOne({{user_id: '{PATIENT_USER_ID}', email:'pat.lookup@example.com', name:'Patient Lookup', role:'patient', created_at: new Date()}});
    db.user_sessions.insertOne({{user_id: '{PATIENT_USER_ID}', session_token: '{PATIENT_TOKEN}', expires_at: new Date(Date.now()+7*24*60*60*1000), created_at: new Date()}});
    db.users.insertOne({{user_id:'{TARGET_PATIENT_USER_ID}', email:'pat.target@example.com', phone:'{TARGET_PATIENT_PHONE}', name:'Patient Target', role:'patient', created_at: new Date()}});
    print('SEED_OK');
    """
    import subprocess
    p = subprocess.run(["mongosh", "--quiet", "--eval", js], capture_output=True, text=True, timeout=20)
    return "SEED_OK" in (p.stdout or "")


def t11():
    if not seed_patients():
        log("T11 seed patients", False, "mongosh seeding failed")
        return
    log("T11 seed patient + target patient", True, f"patient_token={PATIENT_TOKEN}")

    # 11a: patient resolving a doctor → allowed
    r = get("/api/messages/lookup-by-phone", PATIENT_TOKEN, phone="9408289199")
    ok = r.status_code == 200 and r.json().get("found") is True and (r.json().get("user", {}).get("role") == "doctor")
    log("T11a patient → doctor lookup found=true", ok, f"got {r.status_code} body={r.text[:200]}")

    # 11b: patient resolving another patient → found=false (privacy)
    r = get("/api/messages/lookup-by-phone", PATIENT_TOKEN, phone="8888888888")
    ok = r.status_code == 200 and r.json().get("found") is False
    log("T11b patient → patient lookup found=false (privacy)", ok, f"got {r.status_code} body={r.text[:200]}")

    # 11c: as OWNER, the same lookup of another patient resolves (sanity)
    r = get("/api/messages/lookup-by-phone", OWNER_TOKEN, phone="8888888888")
    ok = r.status_code == 200 and r.json().get("found") is True and r.json().get("user", {}).get("role") == "patient"
    log("T11c owner → patient lookup found=true (sanity)", ok, f"got {r.status_code} body={r.text[:200]}")


# ════════ Cleanup ════════
def cleanup():
    import subprocess
    js_parts = []
    if new_notification_id:
        js_parts.append(
            f"var d1 = db.notifications.deleteMany({{id: '{new_notification_id}'}}); print('del_notif='+d1.deletedCount);"
        )
    # also clean any test notifications by title prefix RT-Test-
    js_parts.append(
        "var d2 = db.notifications.deleteMany({title: /^RT-Test-/, kind: 'personal'}); print('del_RT_notif='+d2.deletedCount);"
    )
    if PATIENT_USER_ID:
        js_parts.append(f"var d3 = db.users.deleteOne({{user_id: '{PATIENT_USER_ID}'}}); print('del_pat_user='+d3.deletedCount);")
        js_parts.append(f"var d4 = db.user_sessions.deleteOne({{session_token: '{PATIENT_TOKEN}'}}); print('del_pat_session='+d4.deletedCount);")
    if TARGET_PATIENT_USER_ID:
        js_parts.append(f"var d5 = db.users.deleteOne({{user_id: '{TARGET_PATIENT_USER_ID}'}}); print('del_target_pat='+d5.deletedCount);")
    js = "db = db.getSiblingDB('consulturo');\n" + "\n".join(js_parts)
    p = subprocess.run(["mongosh", "--quiet", "--eval", js], capture_output=True, text=True, timeout=20)
    print("CLEANUP:", (p.stdout or "").strip())


def main():
    print("=" * 60)
    print(f"BASE={BASE}")
    fetch_user_ids()
    print(f"OWNER_USER_ID={OWNER_USER_ID}")
    print(f"DOCTOR_USER_ID={DOCTOR_USER_ID}")
    print("=" * 60)
    t1()
    t2()
    t3()
    t4()
    t5()
    print()
    t6()
    t7()
    t8()
    t9()
    t10()
    t11()
    print()
    cleanup()

    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    failed = sum(1 for _, ok, _ in results if not ok)
    print(f"TOTAL: {passed} pass / {failed} fail / {len(results)} checks")
    if failed:
        print("\nFAILURES:")
        for n, ok, info in results:
            if not ok:
                print(f"  {FAIL} {n} :: {info}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
