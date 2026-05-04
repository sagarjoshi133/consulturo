"""Auth flow endpoint tests."""
import pytest
import requests
from conftest import BASE_URL, PATIENT_TOKEN, DOCTOR_TOKEN

class TestAuth:
    """Authentication flow tests."""

    def test_auth_me_with_valid_token(self, patient_client):
        """GET /api/auth/me with Bearer returns the user."""
        response = patient_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        
        data = response.json()
        assert "user_id" in data
        assert data.get("email") == "patient.test@consulturo.app"
        assert data.get("role") == "patient"
        assert "name" in data
        assert "_id" not in data
        print(f"✓ Auth /me returned user: {data['user_id']}")

    def test_auth_me_without_token(self, api_client):
        """GET /api/auth/me without token returns 401."""
        response = api_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("✓ Auth /me correctly requires authentication")

    def test_auth_logout(self, api_client):
        """POST /api/auth/logout deletes the session.

        Creates an ad-hoc session row directly via motor/asyncio. If
        the MongoDB connection is unreachable (offline dev), skips
        with a clear message rather than flaking."""
        import asyncio
        import os
        import time
        try:
            from motor.motor_asyncio import AsyncIOMotorClient
        except Exception:
            pytest.skip("motor not installed in this env")

        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "consulturo")

        async def _seed():
            client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
            try:
                await client.admin.command("ping")
            except Exception as e:
                return None, str(e)
            db = client[db_name]
            uid = f"test-logout-{int(time.time()*1000)}"
            token = f"logout_token_{int(time.time()*1000)}"
            email = f"logout-{uid}@test.app"
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            await db.users.insert_one({
                "user_id": uid, "email": email,
                "name": "Logout Test", "role": "patient", "created_at": now,
            })
            await db.user_sessions.insert_one({
                "user_id": uid, "session_token": token,
                "expires_at": now + timedelta(days=7), "created_at": now,
            })
            client.close()
            return token, None

        logout_token, err = asyncio.get_event_loop().run_until_complete(_seed())
        if not logout_token:
            pytest.skip(f"MongoDB unreachable ({err})")
        
        # Verify token works
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {logout_token}"}
        )
        assert response.status_code == 200, "Token should work before logout"
        
        # Logout
        response = api_client.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {logout_token}"}
        )
        assert response.status_code == 200
        assert response.json().get("ok") is True
        
        # Verify token no longer works
        response = api_client.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {logout_token}"}
        )
        assert response.status_code == 401, "Token should not work after logout"
        print("✓ Logout successfully invalidated session")

    def test_doctor_role_elevation(self, doctor_client):
        """User with email in DOCTOR_EMAILS has role='doctor'."""
        response = doctor_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("role") == "doctor", f"Expected role='doctor', got {data.get('role')}"
        assert data.get("email") == "doctor.test@consulturo.app"
        print(f"✓ Doctor role verified for {data['email']}")
