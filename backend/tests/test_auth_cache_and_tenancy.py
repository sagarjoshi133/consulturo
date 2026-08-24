"""Iteration 26 — Backend tests for the auth cache + tenancy cache session.

Focus areas (matches review_request):
  1. GET /api/auth/me works and repeats cheaply (cache hit).
  2. Logout invalidates immediately (no 30s stale window).
  3. Expired session → 401.
  4. Role gates (patient 403 vs owner 200 on admin endpoint).
  5. Tenant-scoped endpoints work + wrong X-Clinic-Id → 403.
  6. PATCH /auth/me → immediate reflection (cache invalidated).
  7. DELETE /auth/me: patient throwaway works; owner blocked; token dies.
  8. Frontend smoke: web preview loads (frontend test file covers this).

All tests use `EXPO_PUBLIC_BACKEND_URL` (preview URL) and the pre-seeded
long-lived tokens documented in /app/memory/test_credentials.md.

We MINT throwaway sessions directly in Mongo where needed
(logout / expired / delete_me) and clean them up afterwards so the
long-lived seeded tokens are never touched.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

# ── Env / config ────────────────────────────────────────────────────────
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "consulturo")

OWNER_TOKEN = "test_session_1781009714553"    # user_4775ed40276e (primary_owner)
OWNER_USER_ID = "user_4775ed40276e"
PATIENT_TOKEN = "patient_token_1776494002311"  # test-patient-1776494002311

# Do NOT delete these long-lived tokens. All tests that mutate insert
# throwaway (user, session, booking) rows and clean them up in teardown.


@pytest.fixture(scope="module")
def mongo():
    """Direct Mongo client for seeding throwaway sessions/users."""
    client = MongoClient(MONGO_URL)
    try:
        yield client[DB_NAME]
    finally:
        client.close()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ═══════════════ 1. Auth core + cache repeat ═════════════════════════════
class TestAuthCore:
    def test_auth_me_owner_200(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(OWNER_TOKEN))
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["user_id"] == OWNER_USER_ID
        assert u["email"] == "sagar.joshi133@gmail.com"
        assert u["role"] == "primary_owner"

    def test_auth_me_cached_repeat_identical(self, api):
        r1 = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(OWNER_TOKEN))
        r2 = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(OWNER_TOKEN))
        assert r1.status_code == r2.status_code == 200
        # user_id/email/role stable across repeated calls (served from cache
        # after the first).
        for key in ("user_id", "email", "role"):
            assert r1.json().get(key) == r2.json().get(key)

    def test_auth_me_no_token_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_auth_me_invalid_token_401(self, api):
        r = api.get(f"{BASE_URL}/api/auth/me", headers=_auth("obviously_not_a_real_token_zzz"))
        assert r.status_code == 401


# ═══════════════ 2. Logout invalidates immediately ═══════════════════════
class TestLogoutInvalidation:
    def test_logout_kills_token_immediately(self, api, mongo):
        # Mint a throwaway session for the owner user (so we don't kill
        # the long-lived one).
        token = f"TEST_logout_{uuid.uuid4().hex}"
        mongo.user_sessions.insert_one({
            "user_id": OWNER_USER_ID,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        try:
            # 1) prime the cache
            r_pre = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r_pre.status_code == 200

            # 2) logout
            r_out = api.post(f"{BASE_URL}/api/auth/logout", headers=_auth(token))
            assert r_out.status_code in (200, 204), r_out.text

            # 3) immediate follow-up MUST be 401 — no 30s stale window
            r_post = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r_post.status_code == 401, (
                f"Expected 401 after logout, got {r_post.status_code}. "
                "Auth cache invalidation on logout is broken."
            )
        finally:
            mongo.user_sessions.delete_many({"session_token": token})


# ═══════════════ 3. Expired session ══════════════════════════════════════
class TestExpiredSession:
    def test_expired_session_returns_401(self, api, mongo):
        token = f"TEST_expired_{uuid.uuid4().hex}"
        mongo.user_sessions.insert_one({
            "user_id": OWNER_USER_ID,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) - timedelta(hours=1),
            "created_at": datetime.now(timezone.utc) - timedelta(days=2),
        })
        try:
            r = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r.status_code == 401, (
                f"Expired session must return 401, got {r.status_code}."
            )
        finally:
            mongo.user_sessions.delete_many({"session_token": token})


# ═══════════════ 4. Role gates ═══════════════════════════════════════════
class TestRoleGates:
    OWNER_ONLY_URL = "/api/admin/users/quarantined-duplicates"

    def test_owner_gets_200(self, api):
        r = api.get(f"{BASE_URL}{self.OWNER_ONLY_URL}", headers=_auth(OWNER_TOKEN))
        assert r.status_code == 200, r.text

    def test_patient_gets_403(self, api):
        r = api.get(f"{BASE_URL}{self.OWNER_ONLY_URL}", headers=_auth(PATIENT_TOKEN))
        assert r.status_code == 403, (
            f"Patient must be 403 on owner-only endpoint, got {r.status_code}."
        )


# ═══════════════ 5. Tenancy ══════════════════════════════════════════════
class TestTenancy:
    @pytest.mark.parametrize("path", [
        "/api/bookings/all",
        "/api/surgeries",
        "/api/prescriptions",
        "/api/analytics/dashboard",
    ])
    def test_clinic_scoped_endpoints_return_200_for_owner(self, api, path):
        r = api.get(f"{BASE_URL}{path}", headers=_auth(OWNER_TOKEN))
        assert r.status_code == 200, f"{path} → {r.status_code}: {r.text[:200]}"

    def test_wrong_clinic_header_returns_403(self, api):
        r = api.get(
            f"{BASE_URL}/api/bookings/all",
            headers={**_auth(OWNER_TOKEN), "X-Clinic-Id": "clinic_notamember_zzz"},
        )
        assert r.status_code == 403, (
            f"Non-member clinic access should 403, got {r.status_code}."
        )

    def test_correct_clinic_header_returns_200(self, api):
        # dr-joshi-uro clinic — the primary_owner IS a member.
        r = api.get(
            f"{BASE_URL}/api/bookings/all",
            headers={**_auth(OWNER_TOKEN), "X-Clinic-Id": "clinic_a97b903f2fb2"},
        )
        assert r.status_code == 200, r.text


# ═══════════════ 6. PATCH freshness ══════════════════════════════════════
class TestProfilePatchFreshness:
    def test_patch_me_reflects_immediately(self, api):
        # get current phone
        r0 = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(OWNER_TOKEN))
        assert r0.status_code == 200
        original_phone = r0.json().get("phone", "")

        new_phone = f"+91555000{int(time.time()) % 10000:04d}"
        try:
            r_patch = api.patch(
                f"{BASE_URL}/api/auth/me",
                headers=_auth(OWNER_TOKEN),
                json={"phone": new_phone},
            )
            assert r_patch.status_code == 200, r_patch.text

            # Immediate follow-up — cache MUST have been invalidated.
            r1 = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(OWNER_TOKEN))
            assert r1.status_code == 200
            assert r1.json().get("phone") == new_phone, (
                f"Cache stale — expected {new_phone!r}, got {r1.json().get('phone')!r}"
            )
        finally:
            # Restore original phone.
            api.patch(
                f"{BASE_URL}/api/auth/me",
                headers=_auth(OWNER_TOKEN),
                json={"phone": original_phone},
            )


# ═══════════════ 7. Account deletion ═════════════════════════════════════
class TestAccountDeletion:
    def test_patient_self_delete_invalidates_token(self, api, mongo):
        # Create a throwaway patient user + session.
        uid = f"test_del_pt_{uuid.uuid4().hex[:8]}"
        token = f"TEST_del_{uuid.uuid4().hex}"
        mongo.users.insert_one({
            "user_id": uid,
            "email": f"{uid}@testthrow.local",
            "name": "TEST Delete Patient",
            "role": "patient",
            "created_at": datetime.now(timezone.utc),
        })
        mongo.user_sessions.insert_one({
            "user_id": uid,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        booking_id = f"bk_test_del_{uuid.uuid4().hex[:8]}"
        mongo.bookings.insert_one({
            "booking_id": booking_id,
            "user_id": uid,
            "patient_name": "TEST Delete Patient",
            "phone": "+915555550000",
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
            "clinic_id": "clinic_a97b903f2fb2",
        })
        try:
            # prime the cache
            r_pre = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r_pre.status_code == 200

            r_del = api.delete(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r_del.status_code == 200, r_del.text
            body = r_del.json()
            # accept either {ok: true} or similar affirmative payload
            assert body.get("ok") is True or body.get("success") is True or body.get("deleted") is True, body

            # Same token → must be 401 immediately (no 30s stale window)
            r_post = api.get(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r_post.status_code == 401, (
                f"Deleted-account token must 401 immediately, got {r_post.status_code}."
            )
        finally:
            # Belt-and-suspenders cleanup
            mongo.users.delete_many({"user_id": uid})
            mongo.user_sessions.delete_many({"user_id": uid})
            mongo.bookings.delete_many({"booking_id": booking_id})

    def test_owner_self_delete_is_blocked_403(self, api, mongo):
        # Mint a throwaway session for the owner and try to delete —
        # owner/staff must NOT be allowed to self-delete.
        token = f"TEST_owner_del_{uuid.uuid4().hex}"
        mongo.user_sessions.insert_one({
            "user_id": OWNER_USER_ID,
            "session_token": token,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        try:
            r = api.delete(f"{BASE_URL}/api/auth/me", headers=_auth(token))
            assert r.status_code == 403, (
                f"Staff/owner self-delete must be 403, got {r.status_code}: {r.text[:200]}"
            )
        finally:
            mongo.user_sessions.delete_many({"session_token": token})
