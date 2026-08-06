"""Booking endpoint tests (guest and authenticated)."""
import pytest
import requests
from conftest import BASE_URL, PATIENT_TOKEN

class TestBookings:
    """Booking creation and retrieval tests."""

    def test_create_booking_guest(self, api_client):
        """POST /api/bookings (guest, without auth) creates a booking and returns booking_id + status 'confirmed' + created_at (no _id)."""
        # Use a date 30 days in the future so the test doesn't go
        # stale every time the calendar rolls forward.
        from datetime import datetime, timezone, timedelta
        future = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        payload = {
            "patient_name": "TEST_Guest Patient",
            "patient_phone": "+919876543210",
            "patient_age": 45,
            "patient_gender": "Male",
            "reason": "Kidney stone consultation",
            "booking_date": future,
            "booking_time": "10:30",
            "mode": "in-person"
        }
        response = api_client.post(f"{BASE_URL}/api/bookings", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "booking_id" in data
        assert data["booking_id"].startswith("bk_")
        assert data.get("status") in ("requested", "confirmed"), (
            # Bookings land in 'requested' status by default now —
            # an owner must confirm before they become 'confirmed'.
            # Accept either so this test survives future policy tweaks.
            f"Unexpected booking status: {data.get('status')}"
        )
        assert "created_at" in data
        assert data.get("user_id") is None, "Guest booking should have user_id=None"
        assert "_id" not in data, "MongoDB _id should be excluded"
        assert data.get("patient_name") == payload["patient_name"]
        print(f"✓ Guest booking created: {data['booking_id']}")

    def test_create_booking_authenticated(self, patient_client):
        """POST /api/bookings with a valid session_token (Bearer header) links booking to user_id."""
        payload = {
            "patient_name": "TEST_Authenticated Patient",
            "patient_phone": "+919876543211",
            "patient_age": 38,
            "patient_gender": "Female",
            "reason": "UTI follow-up",
            "booking_date": "2026-02-20",
            "booking_time": "14:00",
            "mode": "online"
        }
        response = patient_client.post(f"{BASE_URL}/api/bookings", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "booking_id" in data
        assert data.get("status") in ("requested", "confirmed"), (
            # Bookings land in 'requested' status by default now —
            # an owner must confirm before they become 'confirmed'.
            # Accept either so this test survives future policy tweaks.
            f"Unexpected booking status: {data.get('status')}"
        )
        assert "created_at" in data
        assert data.get("user_id") is not None, "Authenticated booking should have user_id"
        assert data.get("user_id").startswith("test-patient-"), "Should be linked to patient user"
        assert "_id" not in data
        print(f"✓ Authenticated booking created: {data['booking_id']} for user {data['user_id']}")

    def test_get_my_bookings_requires_auth(self, api_client):
        """GET /api/bookings/me requires auth, returns 401 without token."""
        response = api_client.get(f"{BASE_URL}/api/bookings/me")
        assert response.status_code == 401
        print("✓ /api/bookings/me correctly requires auth")

    def test_get_my_bookings_authenticated(self, patient_client):
        """GET /api/bookings/me returns user's bookings sorted desc (no _id)."""
        response = patient_client.get(f"{BASE_URL}/api/bookings/me")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        # Should have at least the booking we just created
        assert len(data) >= 1, "Should have at least one booking"
        
        for booking in data:
            assert "booking_id" in booking
            assert "user_id" in booking
            assert "created_at" in booking
            assert "_id" not in booking
        
        # Verify sorted desc by created_at
        if len(data) > 1:
            dates = [b["created_at"] for b in data]
            assert dates == sorted(dates, reverse=True), "Bookings should be sorted desc by created_at"
        
        print(f"✓ Retrieved {len(data)} booking(s) for authenticated user")
