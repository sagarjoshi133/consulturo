"""IPSS calculator endpoint tests."""
import pytest
import requests
from conftest import BASE_URL

class TestIpss:
    """IPSS calculator tests (auth required)."""

    def test_save_ipss_requires_auth(self, api_client):
        """POST /api/ipss requires auth."""
        payload = {
            "entries": [
                {"question": "Incomplete emptying", "score": 3},
                {"question": "Frequency", "score": 2}
            ],
            "total_score": 5,
            "severity": "mild",
            "qol_score": 2
        }
        response = api_client.post(f"{BASE_URL}/api/ipss", json=payload)
        assert response.status_code == 401
        print("✓ IPSS save correctly requires auth")

    def test_save_ipss_authenticated(self, patient_client):
        """POST /api/ipss saves entries/total/severity/qol."""
        payload = {
            "entries": [
                {"question": "Incomplete emptying", "score": 3},
                {"question": "Frequency", "score": 4},
                {"question": "Intermittency", "score": 2},
                {"question": "Urgency", "score": 3},
                {"question": "Weak stream", "score": 2},
                {"question": "Straining", "score": 1},
                {"question": "Nocturia", "score": 3}
            ],
            "total_score": 18,
            "severity": "moderate",
            "qol_score": 4
        }
        response = patient_client.post(f"{BASE_URL}/api/ipss", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "record_id" in data
        assert data["record_id"].startswith("ipss_")
        assert "user_id" in data
        assert data.get("total_score") == 18
        assert data.get("severity") == "moderate"
        assert data.get("qol_score") == 4
        assert len(data.get("entries", [])) == 7
        assert "created_at" in data
        assert "_id" not in data
        print(f"✓ IPSS record saved: {data['record_id']}")

    def test_get_ipss_history_requires_auth(self, api_client):
        """GET /api/ipss/history requires auth."""
        response = api_client.get(f"{BASE_URL}/api/ipss/history")
        assert response.status_code == 401
        print("✓ IPSS history correctly requires auth")

    def test_get_ipss_history_authenticated(self, patient_client):
        """GET /api/ipss/history returns history for that user."""
        response = patient_client.get(f"{BASE_URL}/api/ipss/history")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        # Should have at least the record we just created
        assert len(data) >= 1, "Should have at least one IPSS record"
        
        for record in data:
            assert "record_id" in record
            assert "user_id" in record
            assert "total_score" in record
            assert "severity" in record
            assert "entries" in record
            assert "created_at" in record
            assert "_id" not in record
        
        print(f"✓ Retrieved {len(data)} IPSS record(s) for user")
