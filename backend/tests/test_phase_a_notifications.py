"""Phase A — Notification Incident Recovery regression tests.

Covers:
  1. POST /api/register-push → typed 503 relay_not_configured (preview),
     token mirrored locally with installation_id.
  2. installation_id dedupe — token rotation for the same install keeps
     exactly ONE push_tokens row.
  3. POST /api/register-push empty token → typed 400 invalid_token.
  4. GET  /api/inbox/all → unified feed shape {items, unread}.
  5. POST /api/notifications/{id}/read → works for broadcast_inbox rows.
  6. Broadcast capability auth — primary_owner is auto-approver
     (legacy role=="owner" string check removed).
  7. DB hygiene — no @example.com demo doctor accounts remain.
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


def _mint_session(user_filter: dict) -> tuple[str, str]:
    user = _db.users.find_one(user_filter, {"_id": 0, "user_id": 1})
    assert user, f"no user matching {user_filter}"
    token = f"test_session_phase_a_{uuid.uuid4().hex[:12]}"
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
    """primary_owner session (Dr. Joshi's clinic owner)."""
    token, uid = _mint_session({"role": "primary_owner", "email": "sagar.joshi133@gmail.com"})
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    yield s, uid
    _cleanup()


def _cleanup():
    _db.user_sessions.delete_many({"session_token": {"$in": _created_tokens}})
    _db.push_tokens.delete_many({"device_token": {"$regex": "^TEST_phaseA_"}})
    _db.broadcast_inbox.delete_many({"inbox_id": {"$regex": "^TEST_phaseA_"}})
    _db.broadcasts.delete_many({"title": {"$regex": "^TEST_phaseA_"}})


# ── 1 + 2: typed register errors + installation_id dedupe ──────────

class TestRegisterPushTyped:
    INSTALL_ID = f"TEST_inst_{uuid.uuid4().hex[:10]}"

    def test_typed_503_and_mirror(self, owner):
        s, uid = owner
        tok = "TEST_phaseA_" + uuid.uuid4().hex[:10]
        r = s.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": tok,
            "installation_id": self.INSTALL_ID,
        }, timeout=15)
        assert r.status_code == 503, f"{r.status_code}: {r.text[:300]}"
        detail = (r.json() or {}).get("detail") or {}
        assert detail.get("error_code") == "relay_not_configured", detail
        assert detail.get("mirrored") is True, detail
        row = _db.push_tokens.find_one({"user_id": uid, "installation_id": self.INSTALL_ID})
        assert row and row.get("device_token") == tok, "token not mirrored locally"

    def test_installation_id_dedupe_on_rotation(self, owner):
        s, uid = owner
        new_tok = "TEST_phaseA_" + uuid.uuid4().hex[:10]
        r = s.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": new_tok,
            "installation_id": self.INSTALL_ID,
        }, timeout=15)
        assert r.status_code == 503  # relay still off — mirror path only
        rows = list(_db.push_tokens.find({"user_id": uid, "installation_id": self.INSTALL_ID}))
        assert len(rows) == 1, f"expected 1 deduped row, got {len(rows)}"
        assert rows[0]["device_token"] == new_tok, "rotated token not replaced"

    def test_empty_token_typed_400(self, owner):
        s, _ = owner
        r = s.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": "",
        }, timeout=10)
        assert r.status_code == 400, r.status_code
        detail = (r.json() or {}).get("detail") or {}
        assert detail.get("error_code") == "invalid_token", detail


# ── 4 + 5: unified inbox ────────────────────────────────────────────

class TestUnifiedInbox:
    def test_inbox_all_shape(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/inbox/all", params={"limit": 20}, timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        data = r.json()
        assert isinstance(data.get("items"), list)
        assert isinstance(data.get("unread"), int)
        for it in data["items"][:5]:
            assert "source_type" in it and "read" in it and "kind" in it, it

    def test_read_endpoint_handles_broadcast_inbox_rows(self, owner):
        s, uid = owner
        inbox_id = f"TEST_phaseA_{uuid.uuid4().hex[:8]}"
        _db.broadcast_inbox.insert_one({
            "inbox_id": inbox_id,
            "broadcast_id": f"bc_{uuid.uuid4().hex[:10]}",
            "user_id": uid,
            "title": "TEST_phaseA_ broadcast row",
            "body": "unified read test",
            "created_at": datetime.now(timezone.utc),
            "read_at": None,
        })
        r = s.post(f"{BASE_URL}/api/notifications/{inbox_id}/read", timeout=10)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        row = _db.broadcast_inbox.find_one({"inbox_id": inbox_id})
        assert row and row.get("read_at"), "read_at not stamped on broadcast row"

    def test_read_endpoint_404_for_unknown_id(self, owner):
        s, _ = owner
        r = s.post(f"{BASE_URL}/api/notifications/nope_{uuid.uuid4().hex[:6]}/read", timeout=10)
        assert r.status_code == 404, r.status_code


# ── 6: capability-based broadcast authorization ─────────────────────

class TestBroadcastCapability:
    def test_primary_owner_auto_approver(self, owner):
        s, uid = owner
        r = s.post(f"{BASE_URL}/api/broadcasts", json={
            "title": "TEST_phaseA_ capability check",
            "body": "primary_owner must be auto-approved",
            "target": "staff",
        }, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        doc = r.json()
        assert doc.get("status") == "approved", (
            f"primary_owner should be auto-approver, got status={doc.get('status')}"
        )
        assert doc.get("approved_by") == uid, doc
        # Owner-tier delete of unsent broadcast must work too.
        bid = doc["broadcast_id"]
        rd = s.delete(f"{BASE_URL}/api/broadcasts/{bid}", timeout=10)
        assert rd.status_code == 200, f"{rd.status_code}: {rd.text[:200]}"

    def test_pending_count_visible_to_primary_owner(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/broadcasts/pending_count", timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json().get("count"), int)


# ── 7: DB hygiene ───────────────────────────────────────────────────

class TestDoctorDirectoryHygiene:
    def test_no_demo_doctor_accounts(self):
        n = _db.users.count_documents({
            "role": "doctor",
            "email": {"$regex": "@example\\.com$", "$options": "i"},
        })
        assert n == 0, f"{n} demo doctor account(s) still in users collection"
