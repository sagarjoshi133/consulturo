"""Health check endpoint tests."""
import pytest
import requests
from conftest import BASE_URL

class TestHealth:
    """Health check tests - run first to verify backend is up."""

    def test_health_endpoint(self, api_client):
        """GET /api/health should return {ok:true, db:'connected'}."""
        response = api_client.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert data.get("ok") is True, f"Expected ok=True, got {data.get('ok')}"
        assert data.get("db") == "connected", f"Expected db='connected', got {data.get('db')}"
        print("✓ Health check passed")

    def test_root_endpoint(self, api_client):
        """GET /api/ should return service info."""
        response = api_client.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        
        data = response.json()
        assert "service" in data
        assert "status" in data
        print("✓ Root endpoint passed")
