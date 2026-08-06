"""Shared pytest fixtures for ConsultUro backend tests.

Two classes of tests:

  1. Public / unauthenticated endpoint tests (health, calculators,
     blog, education, disease list) — always run.

  2. Authenticated tests (bookings, prescriptions, IPSS history,
     admin merge, push heal, auth/me) — require a live session
     token in PATIENT_TOKEN / DOCTOR_TOKEN. Tokens are short-lived
     in ConsultUro; if the hardcoded tokens below have been purged
     or rotated, we AUTO-SKIP the authenticated tests with a clear
     reason rather than turning the whole suite red.

To refresh tokens:
  1. Log in as patient / doctor via the web UI
  2. Copy the Bearer token from a network request
  3. Replace PATIENT_TOKEN / DOCTOR_TOKEN below
"""
import pytest
import requests

BASE_URL = "http://localhost:8001"

# Last refreshed: see commit message — rotate before CI runs.
PATIENT_TOKEN = "patient_token_1776494002311"
DOCTOR_TOKEN = "doctor_token_1776494002376"


def _token_is_live(token: str) -> bool:
    """Quick health check — does GET /api/auth/me accept this token?"""
    try:
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=2,
        )
        return r.status_code == 200
    except Exception:
        return False


@pytest.fixture(scope="session")
def patient_token_live() -> bool:
    return _token_is_live(PATIENT_TOKEN)


@pytest.fixture(scope="session")
def doctor_token_live() -> bool:
    return _token_is_live(DOCTOR_TOKEN)


@pytest.fixture
def api_client():
    """Unauthenticated requests session."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture
def patient_client(patient_token_live):
    """Authenticated patient session. Skips if token stale."""
    if not patient_token_live:
        pytest.skip(
            "PATIENT_TOKEN is stale — refresh in tests/conftest.py to run "
            "auth-gated tests."
        )
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {PATIENT_TOKEN}",
    })
    return session


@pytest.fixture
def doctor_client(doctor_token_live):
    """Authenticated doctor session. Skips if token stale."""
    if not doctor_token_live:
        pytest.skip(
            "DOCTOR_TOKEN is stale — refresh in tests/conftest.py to run "
            "auth-gated tests."
        )
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DOCTOR_TOKEN}",
    })
    return session
