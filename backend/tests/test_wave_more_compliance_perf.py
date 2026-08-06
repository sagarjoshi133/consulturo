"""Wave 3 (AI Rx suggest, triage), Wave 4 (analytics), Wave 5 (2FA, DPDP, audit), Wave 6 (perf) backend tests.

Hits the deployed preview URL using the pre-seeded OWNER session token.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import struct
import time

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://urology-pro.preview.emergentagent.com"
OWNER_TOKEN = "test_session_1781792149794"  # primary_owner, fresh per /app/memory/test_credentials.md


@pytest.fixture(scope="session")
def owner_headers():
    return {
        "Authorization": f"Bearer {OWNER_TOKEN}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def owner_alive(owner_headers):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=owner_headers, timeout=10)
    if r.status_code != 200:
        pytest.skip(f"OWNER token stale ({r.status_code}); refresh test_credentials.md")
    body = r.json()
    assert body.get("role") in {"primary_owner", "owner", "super_owner", "partner"}, body
    return body


# ──────────────────────────────────────────────────────────────────────
# Wave 3 — AI Rx suggest
# ──────────────────────────────────────────────────────────────────────


class TestAiRxSuggest:
    def test_rx_suggest_uti(self, owner_headers, owner_alive):
        r = requests.post(
            f"{BASE_URL}/api/ai/rx-suggest",
            headers=owner_headers,
            json={"diagnosis": "UTI", "age": 42, "sex": "F", "allergies": ["penicillin"]},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "medicines" in body and isinstance(body["medicines"], list)
        assert "warnings" in body and isinstance(body["warnings"], list)
        assert body.get("model", "").startswith("claude")
        # At least diagnostic echo
        assert body.get("diagnosis"), body

    def test_rx_suggest_missing_diagnosis(self, owner_headers, owner_alive):
        r = requests.post(
            f"{BASE_URL}/api/ai/rx-suggest",
            headers=owner_headers,
            json={"diagnosis": "  "},
            timeout=30,
        )
        assert r.status_code == 400

    def test_rx_suggest_unauth(self):
        r = requests.post(
            f"{BASE_URL}/api/ai/rx-suggest",
            json={"diagnosis": "UTI"},
            timeout=15,
        )
        assert r.status_code in (401, 403)


# ──────────────────────────────────────────────────────────────────────
# Wave 3 — Smart inbox triage
# ──────────────────────────────────────────────────────────────────────


class TestTriage:
    def test_triage_mixed(self, owner_headers, owner_alive):
        items = [
            {"id": "m1", "text": "I have severe flank pain and cannot urinate since morning, please help."},
            {"id": "m2", "text": "Can I take my Tamsulosin in the morning instead of night?"},
            {"id": "m3", "text": "Need to reschedule my OPD appointment from Friday to next Monday."},
        ]
        r = requests.post(
            f"{BASE_URL}/api/ai/messages/triage",
            headers=owner_headers,
            json={"items": items},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        results = body.get("results") or []
        assert isinstance(results, list)
        if results:
            allowed = {"urgent", "routine", "admin", "question"}
            for row in results:
                assert row.get("tag") in allowed, row
            tags = {row.get("tag") for row in results}
            # At least one of urgent/question/admin should show up given the inputs.
            assert tags & {"urgent", "question", "admin"}, tags

    def test_triage_empty(self, owner_headers, owner_alive):
        r = requests.post(
            f"{BASE_URL}/api/ai/messages/triage",
            headers=owner_headers,
            json={"items": []},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("ok") is True
        assert body.get("results") == []


# ──────────────────────────────────────────────────────────────────────
# Wave 4 — Analytics
# ──────────────────────────────────────────────────────────────────────


class TestAnalytics:
    def test_dashboard(self, owner_headers, owner_alive):
        r = requests.get(f"{BASE_URL}/api/analytics/widgets", headers=owner_headers, timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        w = body.get("widgets") or {}
        for key in (
            "opd_count",
            "surgery_count",
            "ipd_count",
            "new_patients",
            "revenue",
            "pending_receivables",
            "top_procedure",
        ):
            assert key in w, f"missing widget key: {key} — body={body}"
        assert isinstance(w["opd_count"], int)
        assert isinstance(w["revenue"], (int, float))
        tp = w["top_procedure"]
        assert isinstance(tp, dict) and "name" in tp and "count" in tp

    def test_referrers(self, owner_headers, owner_alive):
        r = requests.get(
            f"{BASE_URL}/api/analytics/referrers?months=6",
            headers=owner_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "top" in body and isinstance(body["top"], list)
        assert "series" in body and isinstance(body["series"], dict)
        assert body.get("window_months") == 6

    def test_outcomes(self, owner_headers, owner_alive):
        r = requests.get(
            f"{BASE_URL}/api/analytics/outcomes-summary?months=12",
            headers=owner_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "procedures" in body and isinstance(body["procedures"], list)
        assert body.get("window_months") == 12
        if body["procedures"]:
            row = body["procedures"][0]
            for k in ("procedure", "total", "success", "complications", "unknown", "success_rate"):
                assert k in row, row


# ──────────────────────────────────────────────────────────────────────
# Wave 5 — 2FA TOTP
# ──────────────────────────────────────────────────────────────────────


def _totp_now(secret: str) -> str:
    pad = "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(secret + pad, casefold=True)
    t = int(time.time()) // 30
    msg = struct.pack(">Q", t)
    dig = hmac.new(key, msg, hashlib.sha1).digest()
    o = dig[-1] & 0x0F
    code = (struct.unpack(">I", dig[o:o + 4])[0] & 0x7FFFFFFF) % 1000000
    return str(code).zfill(6)


class TestTwoFactor:
    def test_2fa_full_flow(self, owner_headers, owner_alive):
        # 1) setup
        r = requests.post(
            f"{BASE_URL}/api/security/2fa/setup",
            headers=owner_headers,
            json={"label": "ConsultUro Test"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        secret = body.get("secret") or ""
        assert secret, body
        # Base32-ish: A-Z, 2-7
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in secret), secret
        otp_url = body.get("otpauth_url") or ""
        assert otp_url.startswith("otpauth://"), otp_url
        assert "secret=" in otp_url

        # 2) status — pending should be true
        r2 = requests.get(f"{BASE_URL}/api/security/2fa/status", headers=owner_headers, timeout=15)
        assert r2.status_code == 200, r2.text
        s2 = r2.json()
        assert s2.get("pending") is True

        # 3) verify with wrong code → 400
        r_bad = requests.post(
            f"{BASE_URL}/api/security/2fa/verify",
            headers=owner_headers,
            json={"code": "000000"},
            timeout=15,
        )
        assert r_bad.status_code == 400

        # 4) verify with computed code → 200
        code = _totp_now(secret)
        r_ok = requests.post(
            f"{BASE_URL}/api/security/2fa/verify",
            headers=owner_headers,
            json={"code": code},
            timeout=15,
        )
        assert r_ok.status_code == 200, r_ok.text
        v = r_ok.json()
        assert v.get("ok") is True and v.get("enabled") is True

        # 5) status enabled=true
        r3 = requests.get(f"{BASE_URL}/api/security/2fa/status", headers=owner_headers, timeout=15)
        assert r3.status_code == 200
        s3 = r3.json()
        assert s3.get("enabled") is True

        # 6) disable — clean up
        r4 = requests.post(f"{BASE_URL}/api/security/2fa/disable", headers=owner_headers, timeout=15)
        assert r4.status_code == 200
        assert r4.json().get("enabled") is False

        r5 = requests.get(f"{BASE_URL}/api/security/2fa/status", headers=owner_headers, timeout=15)
        assert r5.status_code == 200
        s5 = r5.json()
        assert s5.get("enabled") is False
        assert s5.get("pending") is False

    def test_2fa_verify_without_setup(self, owner_headers, owner_alive):
        # Ensure no pending/active secret first.
        requests.post(f"{BASE_URL}/api/security/2fa/disable", headers=owner_headers, timeout=15)
        r = requests.post(
            f"{BASE_URL}/api/security/2fa/verify",
            headers=owner_headers,
            json={"code": "123456"},
            timeout=15,
        )
        assert r.status_code == 400


# ──────────────────────────────────────────────────────────────────────
# Wave 5 — DPDP export
# ──────────────────────────────────────────────────────────────────────


class TestDpdpExport:
    def test_export_staff_with_phone(self, owner_headers, owner_alive):
        # Use seeded patient phone from credentials.md: +918888888888
        r = requests.get(
            f"{BASE_URL}/api/dpdp/export?phone=%2B918888888888",
            headers={"Authorization": owner_headers["Authorization"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # JSON streaming response
        import json as _json
        body = _json.loads(r.content.decode("utf-8"))
        assert "exported_at" in body
        for key in ("patient", "bookings", "prescriptions", "surgeries",
                    "lab_results", "ipd_admissions", "medical_certificates",
                    "receipts", "ipss_submissions"):
            assert key in body, f"missing {key} in export bundle"

    def test_export_staff_missing_phone(self, owner_headers, owner_alive):
        r = requests.get(f"{BASE_URL}/api/dpdp/export", headers={"Authorization": owner_headers["Authorization"]}, timeout=15)
        assert r.status_code == 400


# ──────────────────────────────────────────────────────────────────────
# Wave 5 — Audit log search
# ──────────────────────────────────────────────────────────────────────


class TestAuditLog:
    def test_audit_search(self, owner_headers, owner_alive):
        r = requests.get(
            f"{BASE_URL}/api/audit-log/search?days=30",
            headers=owner_headers,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "rows" in body and isinstance(body["rows"], list)
        assert "actions" in body and isinstance(body["actions"], list)
        assert body.get("window_days") == 30


# ──────────────────────────────────────────────────────────────────────
# Wave 6 — Perf info
# ──────────────────────────────────────────────────────────────────────


class TestPerfInfo:
    def test_perf_info(self, owner_headers, owner_alive):
        r = requests.get(f"{BASE_URL}/api/perf/info", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("max_upload_bytes", "preferred_max_long_edge_px",
                  "preferred_quality", "preferred_format"):
            assert k in body, body
        assert isinstance(body["max_upload_bytes"], int)
        assert body["max_upload_bytes"] > 0
