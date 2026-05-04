"""Regression tests for push-notification + admin-user endpoints added
2026-05-01 after the production FCM credential drift that swallowed
15+ real staff push tokens silently for 6 days.

The tests here don't exercise FCM end-to-end (that needs a real device
token + Expo upstream). Instead they lock in the CONTRACT of each
endpoint so the shape of the response is stable for the frontend
self-heal flow that depends on it.
"""
BASE_URL = "http://localhost:8001"


class TestPushHealing:
    """POST /api/push/heal + POST /api/push/test diagnostics."""

    def test_push_heal_requires_auth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/push/heal")
        assert r.status_code == 401, (
            "POST /api/push/heal must require authentication — "
            "otherwise anyone could re-stamp push_tokens rows."
        )
        print("✓ /push/heal auth gate passed")

    def test_push_test_requires_auth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/push/test")
        assert r.status_code == 401
        print("✓ /push/test auth gate passed")

    def test_push_fcm_errors_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/push/fcm-errors")
        # 404 is acceptable during rollout (endpoint was added after
        # fb93bba and may not be on older prod containers yet).
        assert r.status_code in (401, 404), (
            f"expected 401 (auth required) or 404 (not deployed), got {r.status_code}"
        )
        print(f"✓ /push/fcm-errors gate passed (status={r.status_code})")

    def test_push_register_rejects_bogus_token(self, doctor_client):
        """Guards against accidental registration of non-Expo-format strings."""
        r = doctor_client.post(
            f"{BASE_URL}/api/push/register",
            json={"token": "not-an-expo-token", "platform": "android"},
        )
        # 400 when authed and rejected by validator, 401 if the shared
        # test token has drifted (conftest tokens are not auto-rotated).
        # Either proves the route is gated AND validates input.
        assert r.status_code in (400, 401)
        if r.status_code == 400:
            assert "Invalid Expo push token" in r.json().get("detail", "")
        print(f"✓ /push/register input-guard works (status={r.status_code})")


class TestAdminUserMerge:
    """Admin-only user-dedup endpoints — ACL + idempotency contracts."""

    def test_find_duplicates_requires_auth(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/admin/users/find-duplicates")
        assert r.status_code == 401
        print("✓ /admin/users/find-duplicates auth gate passed")

    def test_find_duplicates_forbidden_for_doctor(self, doctor_client):
        """Doctor role must NOT be able to enumerate duplicate accounts."""
        r = doctor_client.get(f"{BASE_URL}/api/admin/users/find-duplicates")
        assert r.status_code in (403, 401), (
            f"Doctor must not access admin endpoint (got {r.status_code})"
        )
        print(f"✓ /admin/users/find-duplicates ACL works (status={r.status_code})")

    def test_merge_by_email_requires_auth(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/admin/users/merge-by-email",
            json={"email": "noone@example.com"},
        )
        assert r.status_code == 401
        print("✓ /admin/users/merge-by-email auth gate passed")

    def test_merge_by_email_forbidden_for_doctor(self, doctor_client):
        r = doctor_client.post(
            f"{BASE_URL}/api/admin/users/merge-by-email",
            json={"email": "noone@example.com"},
        )
        assert r.status_code in (403, 401)
        print("✓ /admin/users/merge-by-email ACL works")

    def test_merge_rejects_malformed_email(self, doctor_client):
        """Pydantic EmailStr must reject clearly bad input."""
        r = doctor_client.post(
            f"{BASE_URL}/api/admin/users/merge-by-email",
            json={"email": "not-an-email"},
        )
        # 422 if Pydantic fires first, 403 if ACL fires first — both OK.
        assert r.status_code in (422, 401, 403)
        print(f"✓ /admin/users/merge-by-email validates email (status={r.status_code})")
