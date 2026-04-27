"""Prescription endpoint tests (doctor role required)."""
import pytest
import requests
from conftest import BASE_URL

class TestPrescriptions:
    """Prescription creation and retrieval tests (doctor-only)."""

    def test_create_prescription_requires_auth(self, api_client):
        """POST /api/prescriptions requires auth."""
        payload = {
            "patient_name": "Test Patient",
            "visit_date": "2026-01-15",
            "chief_complaints": "Lower back pain",
            "medicines": []
        }
        response = api_client.post(f"{BASE_URL}/api/prescriptions", json=payload)
        assert response.status_code == 401
        print("✓ Prescription creation correctly requires auth")

    def test_create_prescription_patient_role_forbidden(self, patient_client):
        """POST /api/prescriptions requires doctor role; returns 403 for patient role."""
        payload = {
            "patient_name": "Test Patient",
            "visit_date": "2026-01-15",
            "chief_complaints": "Lower back pain",
            "medicines": []
        }
        response = patient_client.post(f"{BASE_URL}/api/prescriptions", json=payload)
        assert response.status_code == 403, f"Expected 403 for patient role, got {response.status_code}"
        print("✓ Patient role correctly forbidden from creating prescriptions")

    def test_create_prescription_doctor_role(self, doctor_client):
        """POST /api/prescriptions with doctor role creates prescription."""
        payload = {
            "patient_name": "TEST_John Doe",
            "patient_age": 55,
            "patient_gender": "Male",
            "patient_phone": "+919876543210",
            "registration_no": "REG12345",
            "ref_doctor": "Dr. Referrer",
            "visit_date": "2026-01-15",
            "chief_complaints": "Frequent urination, weak stream",
            "investigation_findings": "PSA 4.2, DRE normal",
            "diagnosis": "BPH",
            "medicines": [
                {
                    "name": "Tamsulosin",
                    "dosage": "0.4mg",
                    "frequency": "Once daily",
                    "duration": "30 days",
                    "instructions": "Take after dinner"
                },
                {
                    "name": "Finasteride",
                    "dosage": "5mg",
                    "frequency": "Once daily",
                    "duration": "90 days",
                    "instructions": "Take with food"
                }
            ],
            "advice": "Reduce caffeine intake, maintain hydration",
            "follow_up": "4 weeks"
        }
        response = doctor_client.post(f"{BASE_URL}/api/prescriptions", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "prescription_id" in data
        assert data["prescription_id"].startswith("rx_")
        assert "doctor_user_id" in data
        assert data.get("patient_name") == payload["patient_name"]
        assert data.get("diagnosis") == payload["diagnosis"]
        assert len(data.get("medicines", [])) == 2
        assert "created_at" in data
        assert "_id" not in data
        print(f"✓ Prescription created: {data['prescription_id']}")
        
        # Store prescription_id for next test
        return data["prescription_id"]

    def test_list_prescriptions_doctor_role(self, doctor_client):
        """GET /api/prescriptions returns doctor's prescriptions."""
        response = doctor_client.get(f"{BASE_URL}/api/prescriptions")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1, "Should have at least one prescription"
        
        for rx in data:
            assert "prescription_id" in rx
            assert "doctor_user_id" in rx
            assert "patient_name" in rx
            assert "created_at" in rx
            assert "_id" not in rx
        
        print(f"✓ Retrieved {len(data)} prescription(s) for doctor")

    def test_get_prescription_detail_doctor_role(self, doctor_client):
        """GET /api/prescriptions/{id} returns prescription detail."""
        # First create a prescription
        payload = {
            "patient_name": "TEST_Jane Smith",
            "visit_date": "2026-01-16",
            "chief_complaints": "Blood in urine",
            "medicines": []
        }
        create_response = doctor_client.post(f"{BASE_URL}/api/prescriptions", json=payload)
        assert create_response.status_code == 200
        prescription_id = create_response.json()["prescription_id"]
        
        # Now retrieve it
        response = doctor_client.get(f"{BASE_URL}/api/prescriptions/{prescription_id}")
        assert response.status_code == 200
        
        data = response.json()
        assert data.get("prescription_id") == prescription_id
        assert data.get("patient_name") == payload["patient_name"]
        assert "_id" not in data
        print(f"✓ Retrieved prescription detail: {prescription_id}")

    def test_list_prescriptions_patient_role_forbidden(self, patient_client):
        """GET /api/prescriptions requires doctor role."""
        response = patient_client.get(f"{BASE_URL}/api/prescriptions")
        assert response.status_code == 403
        print("✓ Patient role correctly forbidden from listing prescriptions")
