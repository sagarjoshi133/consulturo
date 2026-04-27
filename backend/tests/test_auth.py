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
        """POST /api/auth/logout deletes session."""
        # Create a temporary session for logout test
        import subprocess
        result = subprocess.run([
            "mongosh", "--quiet", "--eval",
            """
            db = db.getSiblingDB('consulturo');
            var uid = 'test-logout-' + Date.now();
            var token = 'logout_token_' + Date.now();
            db.users.insertOne({user_id: uid, email:'logout@test.app', name:'Logout Test', role:'patient', created_at:new Date()});
            db.user_sessions.insertOne({user_id: uid, session_token: token, expires_at: new Date(Date.now()+7*24*60*60*1000), created_at: new Date()});
            print(token);
            """
        ], capture_output=True, text=True)
        
        logout_token = result.stdout.strip()
        assert logout_token, "Failed to create logout test token"
        
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
