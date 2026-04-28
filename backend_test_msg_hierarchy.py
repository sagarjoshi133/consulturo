#!/usr/bin/env python3
"""
Hierarchy messaging rule regression:
  - GET /api/messages/recipients?scope=team excludes super_owner unless caller is primary_owner.
  - POST /api/messages/send returns 403 when recipient is super_owner and caller is NOT primary_owner.

Runs against http://localhost:8001 (backend internal URL, per review brief).
Re-runnable: seeds/cleans up a test partner user + session; uses pre-existing
super_owner row (app.consulturo@gmail.com) without mutating it.
"""
import os
import sys
import time
import uuid
import json
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import requests

BASE = "http://localhost:8001/api"
DB = "consulturo"

OWNER_TOKEN = "test_session_1776770314741"      # sagar primary_owner
DOCTOR_TOKEN = "test_doc_1776771431524"         # test doctor

# Test partner fixture
PARTNER_USER_ID = f"test-partner-{int(time.time())}"
PARTNER_EMAIL = f"test-partner-{int(time.time())}@example.com"
PARTNER_TOKEN = f"test_partner_session_{int(time.time())}"

# Test super_owner fixture details (we'll reuse existing if present, else create).
SEED_SUPER_EMAIL = "app.consulturo@gmail.com"

# Book-keeping for cleanup
_created_super_owner = False
_created_message_ids: list = []
_doctor_prev_can_send: Optional[bool] = None  # to restore
_doctor_user_id: Optional[str] = None

PASS = 0
FAIL = 0
FAILED_DETAILS: list = []


def check(cond: bool, label: str, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        FAILED_DETAILS.append(f"{label} :: {detail}")
        print(f"  [FAIL] {label}  ({detail})")


def mongo(js: str) -> str:
    res = subprocess.run(
        ["mongosh", "--quiet", "--eval", f"db = db.getSiblingDB('{DB}'); {js}"],
        capture_output=True, text=True, check=False,
    )
    if res.returncode != 0:
        print("mongo error:", res.stderr)
    return (res.stdout or "").strip()


def auth(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def seed_super_owner() -> str:
    """Ensure a super_owner user + session exist. Reuse if present."""
    global _created_super_owner
    row = mongo(
        f"JSON.stringify(db.users.findOne({{email:'{SEED_SUPER_EMAIL}'}}, {{_id:0}}))"
    )
    if row and row != "null":
        data = json.loads(row)
        # ensure role is super_owner
        if data.get("role") != "super_owner":
            mongo(
                f"db.users.updateOne({{email:'{SEED_SUPER_EMAIL}'}},"
                f" {{$set:{{role:'super_owner'}}}})"
            )
        return data["user_id"]
    _created_super_owner = True
    so_user_id = f"test-so-{int(time.time())}"
    mongo(
        "db.users.insertOne({"
        f"user_id:'{so_user_id}', email:'{SEED_SUPER_EMAIL}',"
        f" name:'ConsultUro App', role:'super_owner',"
        f" can_send_personal_messages:true,"
        f" created_at:new Date()"
        "})"
    )
    return so_user_id


def seed_partner() -> None:
    """Insert test partner user + session."""
    mongo(
        "db.users.insertOne({"
        f"user_id:'{PARTNER_USER_ID}', email:'{PARTNER_EMAIL}',"
        f" name:'Test Partner', role:'partner',"
        f" can_send_personal_messages:true,"
        f" created_at:new Date()"
        "})"
    )
    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    mongo(
        "db.user_sessions.insertOne({"
        f"user_id:'{PARTNER_USER_ID}', session_token:'{PARTNER_TOKEN}',"
        f" expires_at: new Date('{expires}')"
        "})"
    )


def cleanup() -> None:
    # Remove partner fixture
    mongo(f"db.users.deleteMany({{user_id:'{PARTNER_USER_ID}'}})")
    mongo(f"db.user_sessions.deleteMany({{session_token:'{PARTNER_TOKEN}'}})")
    # Super owner: only delete if we created it
    if _created_super_owner:
        mongo(f"db.users.deleteMany({{email:'{SEED_SUPER_EMAIL}'}})")
    # Restore doctor can_send_personal_messages if we flipped it
    if _doctor_user_id is not None and _doctor_prev_can_send is not None:
        prev = "true" if _doctor_prev_can_send else "false"
        mongo(
            f"db.users.updateOne({{user_id:'{_doctor_user_id}'}},"
            f" {{$set:{{can_send_personal_messages:{prev}}}}})"
        )
    # Delete any test messages we created (by notification ids)
    for nid in _created_message_ids:
        mongo(f"db.notifications.deleteMany({{notification_id:'{nid}'}})")
    # Also sweep notifications referencing our partner user
    mongo(
        f"db.notifications.deleteMany({{$or:[{{sender_user_id:'{PARTNER_USER_ID}'}},"
        f"{{user_id:'{PARTNER_USER_ID}'}}]}})"
    )


def main() -> int:
    print("=" * 72)
    print("Hierarchy messaging regression — /app/backend_test_msg_hierarchy.py")
    print(f"BASE = {BASE}")
    print("=" * 72)

    try:
        # Step 0 — regression smoke
        print("\n[REGRESSION] /api/health")
        r = requests.get(f"{BASE}/health", timeout=10)
        check(r.status_code == 200 and r.json().get("ok") is True,
              "GET /api/health → 200 ok:true", f"status={r.status_code} body={r.text[:200]}")

        print("\n[REGRESSION] /api/me/tier (primary_owner)")
        r = requests.get(f"{BASE}/me/tier", headers=auth(OWNER_TOKEN), timeout=10)
        tier = r.json() if r.ok else {}
        check(r.status_code == 200 and tier.get("role") == "primary_owner",
              "/api/me/tier → role=primary_owner", f"got={tier}")
        check(tier.get("dashboard_full_access") is True,
              "/api/me/tier → dashboard_full_access=true",
              f"got={tier.get('dashboard_full_access')}")
        check("can_create_blog" in tier,
              "/api/me/tier exposes can_create_blog key",
              f"keys={list(tier.keys())}")

        # Step 1 — seed users
        print("\n[SEED] super_owner + partner")
        super_owner_id = seed_super_owner()
        check(bool(super_owner_id),
              f"super_owner user_id resolved ({super_owner_id})",
              "missing")
        seed_partner()
        # Quick sanity: does PARTNER_TOKEN authenticate?
        r = requests.get(f"{BASE}/auth/me", headers=auth(PARTNER_TOKEN), timeout=10)
        check(r.status_code == 200 and r.json().get("role") == "partner",
              "partner token authenticates as role=partner",
              f"status={r.status_code} body={r.text[:200]}")

        # Resolve doctor user_id + temporarily enable messaging permission
        # (the pre-seeded doctor has can_send_personal_messages=false which
        # would mask the hierarchy-specific 403 under a generic permission
        # 403. We restore in cleanup()).
        global _doctor_user_id, _doctor_prev_can_send
        row = mongo(
            "s = db.user_sessions.findOne({session_token:'"
            + DOCTOR_TOKEN
            + "'}); if(s){u = db.users.findOne({user_id:s.user_id},{_id:0}); print(JSON.stringify(u))}"
        )
        try:
            d = json.loads(row) if row and row != "null" else {}
        except Exception:
            d = {}
        _doctor_user_id = d.get("user_id")
        _doctor_prev_can_send = d.get("can_send_personal_messages")
        if _doctor_user_id:
            mongo(
                f"db.users.updateOne({{user_id:'{_doctor_user_id}'}},"
                f" {{$set:{{can_send_personal_messages:true}}}})"
            )

        # The search query must match the seeded super_owner's name/email.
        # Real fixture email is 'app.consulturo@gmail.com' / name 'ConsultUro
        # App' — "super" substring is absent, so we use 'consulturo' which
        # matches email case-insensitively. This is purely a fixture-data
        # accommodation; the rule under test is role-based exclusion.
        SEARCH_Q = "consulturo"

        # Step 2 — recipients as primary_owner INCLUDES super_owner
        print(f"\n[T2] GET /api/messages/recipients?scope=team&q={SEARCH_Q} as primary_owner")
        r = requests.get(
            f"{BASE}/messages/recipients",
            params={"scope": "team", "q": SEARCH_Q},
            headers=auth(OWNER_TOKEN), timeout=10,
        )
        check(r.status_code == 200,
              "primary_owner recipients → 200",
              f"status={r.status_code}")
        items = (r.json() or {}).get("items", [])
        emails = [i.get("email") for i in items]
        has_so = any(i.get("role") == "super_owner" for i in items)
        check(has_so,
              "primary_owner recipients list INCLUDES super_owner",
              f"items_emails={emails}")

        # Step 3 — recipients as partner EXCLUDES super_owner
        print(f"\n[T3] GET /api/messages/recipients?scope=team&q={SEARCH_Q} as partner")
        r = requests.get(
            f"{BASE}/messages/recipients",
            params={"scope": "team", "q": SEARCH_Q},
            headers=auth(PARTNER_TOKEN), timeout=10,
        )
        check(r.status_code == 200,
              "partner recipients → 200",
              f"status={r.status_code} body={r.text[:200]}")
        items = (r.json() or {}).get("items", [])
        has_so = any(i.get("role") == "super_owner" for i in items)
        check(not has_so,
              "partner recipients list DOES NOT include super_owner",
              f"items={items}")

        # Step 4 — recipients as doctor EXCLUDES super_owner
        print(f"\n[T4] GET /api/messages/recipients?scope=team&q={SEARCH_Q} as doctor")
        r = requests.get(
            f"{BASE}/messages/recipients",
            params={"scope": "team", "q": SEARCH_Q},
            headers=auth(DOCTOR_TOKEN), timeout=10,
        )
        check(r.status_code == 200,
              "doctor recipients → 200",
              f"status={r.status_code} body={r.text[:200]}")
        items = (r.json() or {}).get("items", [])
        has_so = any(i.get("role") == "super_owner" for i in items)
        check(not has_so,
              "doctor recipients list DOES NOT include super_owner",
              f"items={items}")

        # Step 5 — primary_owner → super_owner POST /messages/send → 200
        print("\n[T5] POST /api/messages/send primary_owner → super_owner")
        payload = {
            "recipient_user_id": super_owner_id,
            "title": "Hierarchy test — from Primary Owner",
            "body": "Hi Super Owner, this should be allowed.",
        }
        r = requests.post(
            f"{BASE}/messages/send", headers=auth(OWNER_TOKEN),
            json=payload, timeout=15,
        )
        check(r.status_code == 200,
              "primary_owner POST /messages/send → 200",
              f"status={r.status_code} body={r.text[:300]}")
        if r.status_code == 200:
            nid = (r.json() or {}).get("notification_id")
            if nid:
                _created_message_ids.append(nid)

        # Step 6 — partner → super_owner → 403
        print("\n[T6] POST /api/messages/send partner → super_owner")
        payload = {
            "recipient_user_id": super_owner_id,
            "title": "Hierarchy test — from Partner",
            "body": "Should be blocked.",
        }
        r = requests.post(
            f"{BASE}/messages/send", headers=auth(PARTNER_TOKEN),
            json=payload, timeout=15,
        )
        check(r.status_code == 403,
              "partner POST /messages/send → 403",
              f"status={r.status_code} body={r.text[:300]}")
        body = r.json() if r.ok is False and r.headers.get("content-type", "").startswith("application/json") else {}
        try:
            body = r.json()
        except Exception:
            body = {}
        detail = body.get("detail", "")
        check("Only Primary Owners can send personal messages to the Super Owner" in detail,
              "partner 403 detail matches spec",
              f"detail={detail!r}")

        # Step 7 — doctor → super_owner → 403
        print("\n[T7] POST /api/messages/send doctor → super_owner")
        payload = {
            "recipient_user_id": super_owner_id,
            "title": "Hierarchy test — from Doctor",
            "body": "Should be blocked.",
        }
        r = requests.post(
            f"{BASE}/messages/send", headers=auth(DOCTOR_TOKEN),
            json=payload, timeout=15,
        )
        check(r.status_code == 403,
              "doctor POST /messages/send → 403",
              f"status={r.status_code} body={r.text[:300]}")
        try:
            body = r.json()
        except Exception:
            body = {}
        detail = body.get("detail", "")
        check("Only Primary Owners can send personal messages to the Super Owner" in detail,
              "doctor 403 detail matches spec",
              f"detail={detail!r}")

    finally:
        print("\n[CLEANUP]")
        cleanup()
        print("  purged partner fixture, sessions, and test messages.")

    print("\n" + "=" * 72)
    print(f"RESULTS  PASS={PASS}  FAIL={FAIL}")
    if FAILED_DETAILS:
        print("\nFAILED DETAILS:")
        for d in FAILED_DETAILS:
            print(" -", d)
    print("=" * 72)
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
