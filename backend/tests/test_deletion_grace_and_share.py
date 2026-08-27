"""Backend tests for:
  - 30-day soft-delete + restore (patient) grace window
  - Staff/owner deletion blocked with 403
  - Share/OG endpoints (rich link unfurling)
"""
import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) or "https://urology-pro.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")

PATIENT_TOKEN = "test_pat_del_1787811814560"
OWNER_TOKEN = "test_session_1781800271528"


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- helpers ----------
@pytest.fixture(scope="module", autouse=True)
def restore_state_after_tests():
    # ensure not pending before running tests
    requests.post(f"{BASE_URL}/api/auth/me/restore", headers=_h(PATIENT_TOKEN), timeout=10)
    yield
    # cleanup — always leave patient non-pending
    requests.post(f"{BASE_URL}/api/auth/me/restore", headers=_h(PATIENT_TOKEN), timeout=10)


# ==================== Deletion grace-window ====================
class TestDeletionGraceWindow:
    def test_get_me_has_new_fields(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=10)
        assert r.status_code == 200
        body = r.json()
        assert "pending_deletion" in body
        # deletion_purge_at may not be present when not pending — that's fine.

    def test_owner_delete_forbidden(self):
        r = requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(OWNER_TOKEN), timeout=10)
        assert r.status_code == 403, r.text

    def test_patient_soft_delete_returns_grace(self):
        r = requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        assert j.get("pending_deletion") is True
        assert j.get("grace_days") == 30
        assert j.get("deletion_purge_at")

    def test_account_usable_after_soft_delete(self):
        # session must still work
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("pending_deletion") is True
        assert j.get("deletion_purge_at")

    def test_restore_clears_pending(self):
        r = requests.post(f"{BASE_URL}/api/auth/me/restore", headers=_h(PATIENT_TOKEN), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        # verify via GET
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=10)
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2.get("pending_deletion") is False
        # purge_at should not be present after restore
        assert not j2.get("deletion_purge_at")

    def test_restore_via_email_link(self):
        # trigger soft-delete → restore via redirect URL using token from Mongo
        r = requests.delete(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=15)
        assert r.status_code == 200
        # Fetch token from mongo directly via mongosh (backend has DB access)
        import subprocess
        out = subprocess.run(
            ["mongosh", "--quiet", "--eval",
             "db=db.getSiblingDB('consulturo');"
             "var d=db.account_restore_tokens.findOne({user_id:'test-patient-1776494002311'},{token:1,_id:0});"
             "print(d && d.token || '');"],
            capture_output=True, text=True, timeout=15,
        )
        token = (out.stdout or "").strip().splitlines()[-1].strip()
        assert token, f"no restore token found. stderr={out.stderr}"
        rr = requests.get(f"{BASE_URL}/api/auth/restore/redirect", params={"token": token}, timeout=10)
        assert rr.status_code == 200
        assert "Account restored" in rr.text or "restored" in rr.text.lower()
        # Confirm cleared
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(PATIENT_TOKEN), timeout=10).json()
        assert me.get("pending_deletion") is False


# ==================== Share OG endpoints ====================
def _has_meta(html: str, prop: str, name: bool = False) -> bool:
    attr = "name" if name else "property"
    return re.search(rf'<meta\s+{attr}="{re.escape(prop)}"', html) is not None


class TestShareOG:
    def _assert_common_og(self, html: str):
        assert _has_meta(html, "og:title")
        assert _has_meta(html, "og:description")
        assert _has_meta(html, "og:url")
        assert _has_meta(html, "og:image")
        assert _has_meta(html, "twitter:card", name=True)
        # redirect (either meta http-equiv or JS)
        assert 'http-equiv="refresh"' in html or "window.location" in html

    def test_share_home(self):
        r = requests.get(f"{BASE_URL}/api/share/home", timeout=10)
        assert r.status_code == 200
        self._assert_common_og(r.text)

    def test_share_clinic_has_clinic_name(self):
        r = requests.get(f"{BASE_URL}/api/share/clinic/dr-joshi-uro", timeout=10)
        assert r.status_code == 200
        self._assert_common_og(r.text)
        # og:title should NOT be the default ConsultUro — clinic name is resolved server-side
        m = re.search(r'<meta property="og:title" content="([^"]+)"', r.text)
        assert m, "og:title missing"
        title = m.group(1)
        # should reflect the clinic (any clinic-name string, not fall back to default)
        assert "clinic" in title.lower() or "joshi" in title.lower() or title != "ConsultUro", \
            f"Expected clinic name in og:title, got {title!r}"

    def test_share_blog_with_query_overrides(self):
        r = requests.get(
            f"{BASE_URL}/api/share/blog/anyid",
            params={"t": "Custom Blog Title", "d": "Custom Desc"}, timeout=10,
        )
        assert r.status_code == 200
        assert "Custom Blog Title" in r.text
        assert "Custom Desc" in r.text
        self._assert_common_og(r.text)

    def test_share_guide_turp(self):
        r = requests.get(f"{BASE_URL}/api/share/guide/turp", timeout=10)
        assert r.status_code == 200
        self._assert_common_og(r.text)
        # guide should resolve title from server-side data
        assert "guide" in r.text.lower() or "turp" in r.text.lower()

    def test_share_refer_preserves_ref(self):
        r = requests.get(
            f"{BASE_URL}/api/share/refer/ABCD123",
            params={"ref": "ABCD123"}, timeout=10,
        )
        assert r.status_code == 200
        self._assert_common_og(r.text)
        # canonical og:url must carry ref=ABCD123
        m = re.search(r'<meta property="og:url" content="([^"]+)"', r.text)
        assert m
        url = m.group(1)
        assert "ref=ABCD123" in url, f"ref not preserved on canonical url: {url}"

    def test_share_clinic_preserves_ref(self):
        r = requests.get(
            f"{BASE_URL}/api/share/clinic/dr-joshi-uro",
            params={"ref": "XYZ"}, timeout=10,
        )
        assert r.status_code == 200
        m = re.search(r'<meta property="og:url" content="([^"]+)"', r.text)
        assert m
        assert "ref=XYZ" in m.group(1), f"ref not preserved: {m.group(1)}"
