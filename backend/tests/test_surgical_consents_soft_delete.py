"""Backend tests for soft-delete on surgical consents (IPD wiring).

Covers Phase 5.27+ DELETE /api/surgical-consents/{cid} flow:
  1. POST creates a consent tied to an admission_id and returns consent_id
  2. GET ?admission_id=... includes the freshly-created consent
  3. DELETE returns 200 and the consent disappears from the list
     (deleted_at is set under the hood)
  4. DELETE a second time returns 404 (already soft-deleted)
  5. DELETE without auth returns 401
"""
import os
import uuid
import pytest
import requests

# Use the public preview URL exactly as the frontend would.
BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://urology-pro.preview.emergentagent.com",
).rstrip("/")

OWNER_TOKEN = "test_session_1781009714553"


@pytest.fixture(scope="module")
def owner_session():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OWNER_TOKEN}",
    })
    # Sanity check — bail early if the seeded token has been purged.
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
    if r.status_code != 200:
        pytest.skip(
            f"Owner token stale ({r.status_code}). Reseed via "
            "/app/memory/test_credentials.md."
        )
    return s


@pytest.fixture(scope="module")
def admission_id():
    # We don't actually need a real admission row to exist — the
    # consents endpoint only stores admission_id as a foreign string.
    # Use a unique value per test run so the GET filter only returns
    # rows from THIS run.
    return f"adm_test_{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="module")
def created_consent(owner_session, admission_id):
    body = {
        "procedure_key": "turp",  # any valid catalogue key
        "language": "en",
        "patient_name": "TEST_Soft Delete Patient",
        "patient_phone": "+919999900001",
        "admission_id": admission_id,
    }
    r = owner_session.post(
        f"{BASE_URL}/api/surgical-consents", json=body, timeout=15
    )
    assert r.status_code == 200, (
        f"POST create failed {r.status_code}: {r.text}"
    )
    data = r.json()
    assert "consent_id" in data and data["consent_id"].startswith("cs_"), (
        f"Missing/invalid consent_id in {data}"
    )
    assert data.get("admission_id") == admission_id
    assert data.get("deleted_at") is None
    return data


# ─── 1. POST creates + returns consent_id ─────────────────────────
def test_post_creates_consent_with_admission_id(created_consent, admission_id):
    assert created_consent["admission_id"] == admission_id
    assert created_consent["consent_id"].startswith("cs_")
    assert created_consent["procedure_key"] == "turp"


# ─── 2. GET ?admission_id=... lists the new consent ───────────────
def test_get_list_filters_by_admission_id(owner_session, created_consent, admission_id):
    r = owner_session.get(
        f"{BASE_URL}/api/surgical-consents",
        params={"admission_id": admission_id},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [c["consent_id"] for c in body.get("items", [])]
    assert created_consent["consent_id"] in ids, (
        f"New consent {created_consent['consent_id']} missing from list {ids}"
    )
    # Every returned row must belong to this admission and not be deleted.
    for c in body["items"]:
        assert c["admission_id"] == admission_id
        assert c.get("deleted_at") in (None,)


# ─── 5. DELETE without auth → 401 (run BEFORE we soft-delete) ─────
def test_delete_requires_auth(created_consent):
    cid = created_consent["consent_id"]
    r = requests.delete(
        f"{BASE_URL}/api/surgical-consents/{cid}", timeout=10
    )
    # require_user typically returns 401 (missing/invalid token).
    # Some auth deps return 403 — accept either as "auth-gated".
    assert r.status_code in (401, 403), (
        f"Expected 401/403 without token, got {r.status_code}: {r.text}"
    )


# ─── 3. DELETE soft-deletes (200, vanishes from list) ─────────────
def test_delete_soft_deletes_consent(owner_session, created_consent, admission_id):
    cid = created_consent["consent_id"]
    r = owner_session.delete(
        f"{BASE_URL}/api/surgical-consents/{cid}", timeout=10
    )
    assert r.status_code == 200, f"DELETE failed {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("ok") is True

    # GET list must no longer include this consent_id.
    r2 = owner_session.get(
        f"{BASE_URL}/api/surgical-consents",
        params={"admission_id": admission_id},
        timeout=10,
    )
    assert r2.status_code == 200
    ids_after = [c["consent_id"] for c in r2.json().get("items", [])]
    assert cid not in ids_after, (
        f"Consent {cid} still present in list after delete: {ids_after}"
    )

    # GET by id must also be 404 (since handler filters deleted_at: None).
    r3 = owner_session.get(
        f"{BASE_URL}/api/surgical-consents/{cid}", timeout=10
    )
    assert r3.status_code == 404, (
        f"Expected 404 for GET deleted consent, got {r3.status_code}"
    )


# ─── 4. Second DELETE → 404 (already deleted) ─────────────────────
def test_delete_twice_returns_404(owner_session, created_consent):
    cid = created_consent["consent_id"]
    r = owner_session.delete(
        f"{BASE_URL}/api/surgical-consents/{cid}", timeout=10
    )
    assert r.status_code == 404, (
        f"Expected 404 on second delete, got {r.status_code}: {r.text}"
    )
