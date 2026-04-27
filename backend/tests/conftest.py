"""Shared pytest fixtures for ConsultUro backend tests."""
import pytest
import requests
import os

BASE_URL = "http://localhost:8001"

PATIENT_TOKEN = "patient_token_1776494002311"
DOCTOR_TOKEN = "doctor_token_1776494002376"

@pytest.fixture
def api_client():
    """Shared requests session."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture
def patient_client():
    """Authenticated patient session."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PATIENT_TOKEN}"
    })
    return session

@pytest.fixture
def doctor_client():
    """Authenticated doctor session."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DOCTOR_TOKEN}"
    })
    return session
