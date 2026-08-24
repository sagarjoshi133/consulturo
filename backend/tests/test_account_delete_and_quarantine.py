"""Tests for:
- DELETE /api/auth/me (patient self-delete + role guards)
- GET  /api/admin/users/quarantined-duplicates (owner-only)
- POST /api/admin/users/resolve-quarantine (merge & restore)

Assumes seed rows created by the invoking testing agent:
  users:  t_pat (patient), user_4775ed40276e (owner), q_can, q_quar, q_orph
  sessions: tpat_tok -> t_pat, owner_tok -> user_4775ed40276e
  bookings: one row user_id=t_pat, one row user_id=q_quar
"""
import os
import requests
import pytest

BASE = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"

PATIENT_TOK = "tpat_tok"
OWNER_TOK = "owner_tok"


def h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ─── DELETE /api/auth/me ────────────────────────────────────────────────

class TestAccountDeletion:
    def test_delete_no_auth_returns_401(self):
        r = requests.delete(f"{API}/auth/me")
        assert r.status_code == 401, r.text

    def test_delete_staff_returns_403(self):
        r = requests.delete(f"{API}/auth/me", headers=h(OWNER_TOK))
        assert r.status_code == 403, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "team" in detail or "admin" in detail

    def test_delete_patient_success_and_anonymises_booking(self):
        # Verify /me first for sanity
        me = requests.get(f"{API}/auth/me", headers=h(PATIENT_TOK))
        assert me.status_code == 200
        assert me.json().get("user_id") == "t_pat"

        r = requests.delete(f"{API}/auth/me", headers=h(PATIENT_TOK))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("user_deleted") is True
        assert isinstance(body.get("anonymised", {}).get("bookings"), int)
        assert body["anonymised"]["bookings"] >= 1
        # sessions purged
        assert body["purged"].get("user_sessions", 0) >= 1

    def test_delete_second_call_returns_401(self):
        # Token should no longer exist (session deleted).
        r = requests.delete(f"{API}/auth/me", headers=h(PATIENT_TOK))
        assert r.status_code == 401, r.text


# ─── Quarantined-duplicates admin endpoints ─────────────────────────────

class TestQuarantinedDuplicates:
    def test_list_requires_auth(self):
        r = requests.get(f"{API}/admin/users/quarantined-duplicates")
        assert r.status_code == 401

    def test_list_owner_ok(self):
        r = requests.get(
            f"{API}/admin/users/quarantined-duplicates", headers=h(OWNER_TOK)
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "quarantined" in data
        rows = data["quarantined"]
        # Should include both our seeds
        ids = {row["quarantined_user_id"] for row in rows}
        assert "q_quar" in ids
        assert "q_orph" in ids
        q_quar_row = next(x for x in rows if x["quarantined_user_id"] == "q_quar")
        assert q_quar_row["field"] == "email"
        assert q_quar_row["value"] == "dq@test.com"
        assert q_quar_row["canonical_exists"] is True
        assert q_quar_row["canonical"]["user_id"] == "q_can"
        q_orph_row = next(x for x in rows if x["quarantined_user_id"] == "q_orph")
        assert q_orph_row["field"] == "phone"
        assert q_orph_row["canonical_exists"] is False

    def test_restore_conflict_when_canonical_exists(self):
        r = requests.post(
            f"{API}/admin/users/resolve-quarantine",
            headers=h(OWNER_TOK),
            json={"quarantined_user_id": "q_quar", "action": "restore"},
        )
        assert r.status_code == 409, r.text

    def test_restore_orphan_ok(self):
        r = requests.post(
            f"{API}/admin/users/resolve-quarantine",
            headers=h(OWNER_TOK),
            json={"quarantined_user_id": "q_orph", "action": "restore"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("restored") is True
        # Follow-up: list should no longer include q_orph
        rows = requests.get(
            f"{API}/admin/users/quarantined-duplicates", headers=h(OWNER_TOK)
        ).json()["quarantined"]
        assert "q_orph" not in {r_["quarantined_user_id"] for r_ in rows}

    def test_merge_success_restamps_and_deletes_stub(self):
        r = requests.post(
            f"{API}/admin/users/resolve-quarantine",
            headers=h(OWNER_TOK),
            json={"quarantined_user_id": "q_quar", "action": "merge"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("canonical_user_id") == "q_can"
        cu = body.get("collections_updated") or {}
        # 1 booking should have been re-stamped
        assert isinstance(cu.get("bookings"), int)
        assert cu["bookings"] >= 1
        assert body.get("user_deleted") is True

    def test_merge_conflict_when_no_canonical(self):
        # After merge, q_quar is gone. Re-listing should be empty for q_quar.
        rows = requests.get(
            f"{API}/admin/users/quarantined-duplicates", headers=h(OWNER_TOK)
        ).json()["quarantined"]
        assert "q_quar" not in {r_["quarantined_user_id"] for r_ in rows}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
