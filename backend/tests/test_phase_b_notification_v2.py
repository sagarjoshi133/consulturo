"""Phase B — Notification V2 foundations regression tests.

Covers:
  1. POST /api/register-push dual-writes device_installations
     (keyed by user_id + installation_id; rotation keeps one row).
  2. GET  /api/push/health-panel — shape + auth gate.
  3. Outbox: expiry sweep marks stale pending rows "expired";
     with relay OFF (preview) the flush pass skips claiming.
  4. GET/POST /api/push/outbox* are owner-gated.
  5. create_notification dual-writes notification_inbox
     (exercised via POST /api/messages/send).
  6. Startup migration recorded in schema_migrations + backfill counts.
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
    token = f"test_session_phase_b_{uuid.uuid4().hex[:12]}"
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
    _cleanup()


def _cleanup():
    _db.user_sessions.delete_many({"session_token": {"$in": _created_tokens}})
    _db.push_tokens.delete_many({"device_token": {"$regex": "^TEST_phaseB_"}})
    _db.device_installations.delete_many({"installation_id": {"$regex": "^TEST_phaseB_"}})
    _db.notification_outbox.delete_many({"kind": {"$regex": "^TEST_phaseB_"}})
    _db.notifications.delete_many({"title": {"$regex": "^TEST_phaseB_"}})
    _db.notification_inbox.delete_many({"title": {"$regex": "^TEST_phaseB_"}})


# ── 1: device_installations dual-write ──────────────────────────────

class TestDeviceInstallations:
    INSTALL_ID = f"TEST_phaseB_inst_{uuid.uuid4().hex[:10]}"

    def test_register_push_writes_installation_row(self, owner):
        s, uid = owner
        tok = "TEST_phaseB_" + uuid.uuid4().hex[:10]
        r = s.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": tok,
            "installation_id": self.INSTALL_ID,
        }, timeout=15)
        # Preview env: relay off → typed 503, but mirrors must exist.
        assert r.status_code == 503, f"{r.status_code}: {r.text[:300]}"
        row = _db.device_installations.find_one(
            {"user_id": uid, "installation_id": self.INSTALL_ID})
        assert row, "device_installations row not written"
        assert row.get("device_token") == tok
        assert row.get("transport") == "emergent_native"
        assert row.get("last_seen_at") is not None

    def test_rotation_keeps_single_installation_row(self, owner):
        s, uid = owner
        new_tok = "TEST_phaseB_" + uuid.uuid4().hex[:10]
        r = s.post(f"{BASE_URL}/api/register-push", json={
            "platform": "android", "device_token": new_tok,
            "installation_id": self.INSTALL_ID,
        }, timeout=15)
        assert r.status_code == 503
        rows = list(_db.device_installations.find(
            {"user_id": uid, "installation_id": self.INSTALL_ID}))
        assert len(rows) == 1, f"expected 1 row, got {len(rows)}"
        assert rows[0]["device_token"] == new_tok


# ── 2: health panel ──────────────────────────────────────────────────

class TestHealthPanel:
    def test_health_panel_shape(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/push/health-panel", timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        assert "relay_configured" in d
        assert isinstance(d.get("devices"), dict)
        assert "total_installations" in d["devices"]
        ob = d.get("outbox") or {}
        for k in ("pending", "processing", "sent_24h", "dead_24h", "expired_24h"):
            assert k in ob, f"outbox missing {k}: {ob}"
        assert isinstance(d.get("inbox"), dict)
        assert isinstance(d.get("sends_24h"), dict)
        assert d.get("next_step"), "next_step guidance missing"
        # primary_owner gets dead-letter visibility
        assert "recent_dead_letters" in d

    def test_health_panel_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/push/health-panel", timeout=10)
        assert r.status_code in (401, 403), r.status_code


# ── 3 + 4: outbox worker + owner gating ─────────────────────────────

class TestOutbox:
    def _insert_row(self, status="pending", expired=False, kind=None):
        now = datetime.now(timezone.utc)
        row = {
            "id": str(uuid.uuid4()),
            "recipients": ["nonexistent-user"],
            "data": {"title": "t", "message": "m"},
            "kind": kind or f"TEST_phaseB_{uuid.uuid4().hex[:6]}",
            "status": status,
            "attempts": 0,
            "max_attempts": 5,
            "last_error": None,
            "next_attempt_at": now - timedelta(minutes=1),
            "expires_at": (now - timedelta(minutes=1)) if expired else (now + timedelta(hours=5)),
            "created_at": now,
            "updated_at": now,
            "sent_at": None,
        }
        _db.notification_outbox.insert_one(dict(row))
        return row["id"]

    def test_flush_expires_stale_rows(self, owner):
        s, _ = owner
        rid = self._insert_row(expired=True)
        r = s.post(f"{BASE_URL}/api/push/outbox/flush", timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert (r.json().get("expired") or 0) >= 1
        row = _db.notification_outbox.find_one({"id": rid})
        assert row and row["status"] == "expired"

    def test_flush_skips_claiming_when_relay_off(self, owner):
        s, _ = owner
        rid = self._insert_row(expired=False)
        r = s.post(f"{BASE_URL}/api/push/outbox/flush", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # Preview: relay off → nothing claimed, row stays pending for
        # the post-deploy worker.
        assert d.get("relay_configured") is False
        assert d.get("skipped") == "relay_not_configured"
        row = _db.notification_outbox.find_one({"id": rid})
        assert row and row["status"] == "pending"

    def test_outbox_endpoints_owner_gated(self):
        # Unauthenticated
        r1 = requests.post(f"{BASE_URL}/api/push/outbox/flush", timeout=10)
        assert r1.status_code in (401, 403)
        r2 = requests.get(f"{BASE_URL}/api/push/outbox", timeout=10)
        assert r2.status_code in (401, 403)

    def test_outbox_list_shape(self, owner):
        s, _ = owner
        r = s.get(f"{BASE_URL}/api/push/outbox", params={"limit": 5}, timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d.get("items"), list)
        for it in d["items"]:
            assert "data" not in it, "payload data must be excluded from list view"


# ── 5: notification_inbox dual-write ────────────────────────────────

class TestInboxDualWrite:
    def test_message_send_writes_notification_inbox(self, owner):
        s, uid = owner
        recipient = _db.users.find_one(
            {"user_id": {"$ne": uid}, "role": {"$in": ["patient", "staff", "doctor", "assistant"]}},
            {"_id": 0, "user_id": 1},
        )
        if not recipient:
            pytest.skip("no recipient user available")
        title = f"TEST_phaseB_msg_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{BASE_URL}/api/messages/send", json={
            "recipient_user_id": recipient["user_id"],
            "title": title,
            "body": "phase B inbox dual-write check",
        }, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        legacy = _db.notifications.find_one({"title": title})
        assert legacy, "legacy notifications row missing"
        v2 = _db.notification_inbox.find_one({"title": title})
        assert v2, "notification_inbox dual-write row missing"
        assert v2.get("id") == legacy.get("id"), "v2 row must share the legacy id"
        assert v2.get("source_type") == "notification"


# ── 6: migration bookkeeping ────────────────────────────────────────

class TestMigrationShim:
    def test_backfill_recorded_once(self):
        rows = list(_db.schema_migrations.find({"name": "002_notification_v2_backfill"}))
        assert len(rows) == 1, f"expected exactly 1 migration row, got {len(rows)}"

    def test_installations_index_unique(self):
        info = _db.device_installations.index_information()
        uniq = [k for k, v in info.items() if v.get("unique")]
        assert any("user_id" in str(info[k]["key"]) and "installation_id" in str(info[k]["key"]) for k in uniq), info
