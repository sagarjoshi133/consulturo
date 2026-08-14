"""Phase C — Platform foundation regression tests.

Covers:
  1. GET /api/me/capabilities — full capability map, auth-gated.
  2. GET /api/capabilities/catalog — owner-gated catalog.
  3. Capability delegation regression — primary_owner still passes the
     refactored broadcast/messaging gates.
  4. POST /api/files/upload → Emergent Object Storage; file_objects row.
  5. GET /api/files/{id} — bearer auth, ?sid= query auth, 401 unauth,
     403 for unrelated users, allowed for message recipients.
  6. /api/messages/send accepts object-storage attachment references
     (file_id) and persists url instead of base64.
"""
import base64
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

# 1×1 transparent PNG
_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQ"
    "DwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _mint_session(user_filter: dict):
    user = _db.users.find_one(user_filter, {"_id": 0, "user_id": 1})
    if not user:
        return None, None
    token = f"test_session_phase_c_{uuid.uuid4().hex[:12]}"
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
    assert token, "primary_owner user missing"
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    yield s, uid, token
    _cleanup()


@pytest.fixture(scope="module")
def patient():
    token, uid = _mint_session({"role": "patient"})
    if not token:
        pytest.skip("no patient user in DB")
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s, uid, token


def _cleanup():
    _db.user_sessions.delete_many({"session_token": {"$in": _created_tokens}})
    _db.file_objects.delete_many({"name": {"$regex": "^TEST_phaseC_"}})
    _db.notifications.delete_many({"title": {"$regex": "^TEST_phaseC_"}})
    _db.notification_inbox.delete_many({"title": {"$regex": "^TEST_phaseC_"}})


# ── 1 + 2: capabilities endpoints ────────────────────────────────────

class TestCapabilities:
    def test_me_capabilities_owner(self, owner):
        s, _, _ = owner
        r = s.get(f"{BASE_URL}/api/me/capabilities", timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        caps = d.get("capabilities") or {}
        assert d.get("role") == "primary_owner"
        for cap in ("prescribe", "manage_surgeries", "manage_availability",
                    "approve_broadcasts", "approve_bookings", "full_dashboard",
                    "send_personal_messages", "manage_blog", "manage_team",
                    "manage_partners"):
            assert caps.get(cap) is True, f"{cap} should be True for primary_owner: {caps}"
        assert caps.get("platform_admin") is False, "primary_owner is not a platform admin"

    def test_me_capabilities_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/me/capabilities", timeout=10)
        assert r.status_code in (401, 403)

    def test_catalog_owner_gated(self, owner):
        s, _, _ = owner
        r = s.get(f"{BASE_URL}/api/capabilities/catalog", timeout=10)
        assert r.status_code == 200
        items = r.json().get("items") or []
        assert len(items) >= 10
        keys = {i["key"] for i in items}
        assert "prescribe" in keys and "platform_admin" in keys
        r2 = requests.get(f"{BASE_URL}/api/capabilities/catalog", timeout=10)
        assert r2.status_code in (401, 403)

    def test_patient_capabilities(self, patient):
        s, _, _ = patient
        r = s.get(f"{BASE_URL}/api/me/capabilities", timeout=10)
        assert r.status_code == 200
        caps = r.json().get("capabilities") or {}
        assert caps.get("prescribe") is False
        assert caps.get("manage_team") is False


# ── 3: capability delegation regression ─────────────────────────────

class TestCapabilityRegression:
    def test_primary_owner_broadcast_still_auto_approved(self, owner):
        s, uid, _ = owner
        r = s.post(f"{BASE_URL}/api/broadcasts", json={
            "title": "TEST_phaseC_ capability regression",
            "body": "refactored _is_broadcast_approver must still pass",
            "target": "staff",
        }, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        doc = r.json()
        assert doc.get("status") == "approved", doc
        s.delete(f"{BASE_URL}/api/broadcasts/{doc['broadcast_id']}", timeout=10)

    def test_patient_cannot_send_personal_messages(self, patient, owner):
        s, _, _ = patient
        _, owner_uid, _ = owner
        r = s.post(f"{BASE_URL}/api/messages/send", json={
            "recipient_user_id": owner_uid,
            "title": "TEST_phaseC_ should be blocked",
            "body": "patients need explicit permission",
        }, timeout=15)
        assert r.status_code == 403, f"{r.status_code}: {r.text[:200]}"


# ── 4 + 5: object storage files ──────────────────────────────────────

class TestFiles:
    file_id = None

    def test_upload_png(self, owner):
        s, uid, _ = owner
        r = s.post(f"{BASE_URL}/api/files/upload", json={
            "name": "TEST_phaseC_pixel.png",
            "mime": "image/png",
            "data_url": f"data:image/png;base64,{_PNG_B64}",
            "kind": "image",
            "scope": "message",
        }, timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        d = r.json()
        assert d.get("file_id") and d.get("url") == f"/api/files/{d['file_id']}"
        assert d.get("size_bytes") == len(base64.b64decode(_PNG_B64))
        TestFiles.file_id = d["file_id"]
        row = _db.file_objects.find_one({"id": d["file_id"]})
        assert row and row["owner_id"] == uid and row["storage_path"].startswith("consulturo/uploads/")

    def test_download_with_bearer(self, owner):
        s, _, _ = owner
        assert TestFiles.file_id
        r = s.get(f"{BASE_URL}/api/files/{TestFiles.file_id}", timeout=30)
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert r.content == base64.b64decode(_PNG_B64), "byte mismatch"
        assert "image/png" in (r.headers.get("Content-Type") or "")

    def test_download_with_sid_query(self, owner):
        _, _, token = owner
        r = requests.get(f"{BASE_URL}/api/files/{TestFiles.file_id}", params={"sid": token}, timeout=30)
        assert r.status_code == 200
        assert r.content == base64.b64decode(_PNG_B64)

    def test_download_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/files/{TestFiles.file_id}", timeout=10)
        assert r.status_code == 401

    def test_download_unrelated_user_403(self, patient):
        s, _, _ = patient
        r = s.get(f"{BASE_URL}/api/files/{TestFiles.file_id}", timeout=15)
        assert r.status_code == 403, f"{r.status_code}: {r.text[:200]}"

    def test_upload_malformed_400(self, owner):
        s, _, _ = owner
        r = s.post(f"{BASE_URL}/api/files/upload", json={
            "name": "TEST_phaseC_bad", "data_url": "not-a-data-url",
        }, timeout=15)
        assert r.status_code == 400

    def test_upload_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/files/upload", json={
            "name": "x.png", "data_url": f"data:image/png;base64,{_PNG_B64}",
        }, timeout=10)
        assert r.status_code in (401, 403)


# ── 6: message with storage attachment ───────────────────────────────

class TestMessageWithStorageAttachment:
    def test_send_message_with_file_ref(self, owner, patient):
        s, _, _ = owner
        _, patient_uid, _ = patient
        assert TestFiles.file_id, "upload test must run first"
        title = f"TEST_phaseC_msg_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{BASE_URL}/api/messages/send", json={
            "recipient_user_id": patient_uid,
            "title": title,
            "body": "storage attachment reference",
            "attachments": [{
                "name": "TEST_phaseC_pixel.png", "mime": "image/png",
                "kind": "image", "file_id": TestFiles.file_id,
            }],
        }, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        note = _db.notifications.find_one({"title": title})
        assert note, "notification row missing"
        atts = (note.get("data") or {}).get("attachments") or []
        assert len(atts) == 1
        assert atts[0].get("file_id") == TestFiles.file_id
        assert atts[0].get("url") == f"/api/files/{TestFiles.file_id}"
        assert not atts[0].get("data_url"), "base64 must NOT be stored for storage refs"

    def test_recipient_can_now_download(self, patient):
        s, _, _ = patient
        r = s.get(f"{BASE_URL}/api/files/{TestFiles.file_id}", timeout=30)
        assert r.status_code == 200, f"recipient should have access: {r.status_code}"

    def test_attaching_foreign_file_403(self, patient, owner):
        # patient (if ever permitted) can't attach the owner's file —
        # exercised via owner attaching a file they don't own.
        s, _, _ = owner
        foreign_id = str(uuid.uuid4())
        _db.file_objects.insert_one({
            "id": foreign_id, "owner_id": "someone-else",
            "storage_path": "consulturo/uploads/x/none.bin",
            "name": "TEST_phaseC_foreign", "mime": "application/octet-stream",
            "size_bytes": 1, "scope": "message", "deleted": False,
            "created_at": datetime.now(timezone.utc),
        })
        r = s.post(f"{BASE_URL}/api/messages/send", json={
            "recipient_user_id": patient[1],
            "title": "TEST_phaseC_foreign attach",
            "body": "x",
            "attachments": [{"name": "f", "mime": "application/octet-stream", "file_id": foreign_id}],
        }, timeout=15)
        assert r.status_code == 403, f"{r.status_code}: {r.text[:200]}"
        _db.file_objects.delete_one({"id": foreign_id})
