"""Phase A — Extended coverage for review items not fully covered in
the main pytest file (test_phase_a_notifications.py).

Adds:
  · unauthenticated /api/register-push must be 401/403
  · POST /api/inbox/all/read marks both notifications + broadcast_inbox
  · DELETE /api/broadcasts/{bid} works for owner-tier on unsent broadcast
  · GET /api/push/status returns relay_configured:false + next_step
  · DB hygiene: db.users has no role=doctor @example.com accounts
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")

_client = MongoClient(os.environ["MONGO_URL"])
_db = _client[os.environ.get("DB_NAME", "consulturo")]

_created_tokens = []
_created_broadcasts = []
_created_inbox = []
_created_notifs = []


def _mint_session(user_filter: dict):
    user = _db.users.find_one(user_filter, {"_id": 0, "user_id": 1})
    assert user, f"no user matching {user_filter}"
    token = f"test_session_phase_a_ext_{uuid.uuid4().hex[:10]}"
    _db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=2),
    })
    _created_tokens.append(token)
    return token, user["user_id"]


@pytest.fixture(scope="module")
def owner():
    token, uid = _mint_session({"role": "primary_owner", "email": "sagar.joshi133@gmail.com"})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    yield s, uid
    # Cleanup after all tests in the module
    _db.user_sessions.delete_many({"session_token": {"$in": _created_tokens}})
    _db.broadcasts.delete_many({"broadcast_id": {"$in": _created_broadcasts}})
    _db.broadcast_inbox.delete_many({"inbox_id": {"$in": _created_inbox}})
    _db.notifications.delete_many({"id": {"$in": _created_notifs}})


# ── Unauthenticated /api/register-push must fail ─────────────────────
class TestUnauthRegisterPush:
    def test_no_token_returns_401_or_403(self):
        r = requests.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": "TEST_phaseA_ext_" + uuid.uuid4().hex[:8],
        }, timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403 for unauth, got {r.status_code}: {r.text[:200]}"


# ── POST /api/inbox/all/read marks BOTH sources read ─────────────────
class TestInboxAllRead:
    def test_marks_both_notifications_and_broadcast_inbox(self, owner):
        s, uid = owner
        # Seed one unread notification + one unread broadcast_inbox row
        nid = f"TEST_phaseA_ext_n_{uuid.uuid4().hex[:8]}"
        _db.notifications.insert_one({
            "id": nid,
            "user_id": uid,
            "title": "TEST_phaseA_ notif",
            "body": "unread notification",
            "kind": "system",
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })
        _created_notifs.append(nid)

        ibid = f"TEST_phaseA_ext_b_{uuid.uuid4().hex[:8]}"
        _db.broadcast_inbox.insert_one({
            "inbox_id": ibid,
            "broadcast_id": f"bc_{uuid.uuid4().hex[:10]}",
            "user_id": uid,
            "title": "TEST_phaseA_ inbox",
            "body": "unread broadcast",
            "created_at": datetime.now(timezone.utc),
            "read_at": None,
        })
        _created_inbox.append(ibid)

        r = s.post(f"{BASE_URL}/api/inbox/all/read", timeout=10)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"

        # Verify both marked read
        n = _db.notifications.find_one({"id": nid})
        assert n and n.get("read") is True, "notification not marked read"

        b = _db.broadcast_inbox.find_one({"inbox_id": ibid})
        assert b and b.get("read_at") is not None, "broadcast_inbox not marked read"


# ── DELETE /api/broadcasts/{bid} — owner-tier on unsent ──────────────
class TestBroadcastDelete:
    def test_delete_unsent_broadcast(self, owner):
        s, _ = owner
        # Create a broadcast targeted staff (NOT 'all' — avoids inbox fan-out)
        r = s.post(f"{BASE_URL}/api/broadcasts", json={
            "title": "TEST_phaseA_ delete me",
            "body": "will be deleted",
            "target": "staff",
        }, timeout=15)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:200]}"
        doc = r.json()
        bid = doc["broadcast_id"]
        _created_broadcasts.append(bid)
        assert doc.get("status") == "approved"  # primary_owner auto-approves

        # DELETE should succeed since it hasn't been sent yet
        rd = s.delete(f"{BASE_URL}/api/broadcasts/{bid}", timeout=10)
        assert rd.status_code == 200, f"{rd.status_code}: {rd.text[:200]}"
        gone = _db.broadcasts.find_one({"broadcast_id": bid})
        assert gone is None, "broadcast row still present after delete"


# ── GET /api/push/status regression ──────────────────────────────────
class TestPushStatus:
    def test_relay_not_configured_returns_guidance(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/push/status", timeout=10)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        data = r.json()
        assert data.get("relay_configured") is False
        assert isinstance(data.get("next_step"), str) and len(data["next_step"]) > 20
        # placeholder key → next_step should mention EMERGENT_PUSH_KEY / Publish → Deploy
        assert "EMERGENT_PUSH_KEY" in data["next_step"] or "placeholder" in data["next_step"].lower()


# ── Broadcast pending_count for primary_owner ────────────────────────
class TestPendingCount:
    def test_pending_count_int_for_primary_owner(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/broadcasts/pending_count", timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("count"), int)


# ── DB hygiene ───────────────────────────────────────────────────────
class TestDoctorDirectoryHygiene:
    def test_no_demo_doctor_accounts(self):
        n = _db.users.count_documents({
            "role": "doctor",
            "email": {"$regex": "@example\\.com$", "$options": "i"},
        })
        assert n == 0, f"{n} demo doctor account(s) still in users collection"
