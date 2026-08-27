"""
Iteration 29 — Encounter Follow-ups + Share Poster.

Covers:
  • POST /api/encounters with follow_up_date persists.
  • GET  /api/encounters/{id} returns follow_up_date.
  • PATCH /api/encounters/{id} updates follow_up_date; clearing removes it.
  • GET  /api/encounters/followups?scope=today / upcoming (route ordering vs {id}).
  • GET  /api/share/poster.png returns image/png 1200x630.
  • GET  /api/share/guide/turp (no own image) -> og:image points to /api/share/poster.png
  • GET  /api/share/blog/<id>?img=... -> og:image is provided image (poster NOT used).
"""
import os
import io
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://urology-pro.preview.emergentagent.com").rstrip("/")
STAFF_TOKEN = "test_session_1781800271528"
AUTH = {"Authorization": f"Bearer {STAFF_TOKEN}"}


def _ist_today():
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")


def _ist_plus(days: int):
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30) + timedelta(days=days)).strftime("%Y-%m-%d")


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", **AUTH})
    yield s


# ─── Encounter follow-ups ───────────────────────────────────────────

class TestEncounterFollowUps:
    """Create/read/update/clear follow_up_date on encounters."""

    created_ids = []

    def test_health(self, api_client):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=AUTH, timeout=15)
        assert r.status_code == 200, f"auth failed: {r.status_code} {r.text[:200]}"

    def test_create_encounter_with_followup_persists(self, api_client):
        payload = {
            "patient_name": "TEST_FollowUp Alpha",
            "patient_phone": "9990000001",
            "chief_complaint": "Follow-up test create",
            "follow_up_date": _ist_plus(7),
        }
        r = api_client.post(f"{BASE_URL}/api/encounters", json=payload, timeout=20)
        assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:200]}"
        d = r.json()
        assert d.get("encounter_id"), "encounter_id missing"
        assert d.get("follow_up_date") == _ist_plus(7), f"follow_up_date mismatch: {d.get('follow_up_date')}"
        TestEncounterFollowUps.created_ids.append(d["encounter_id"])

        # GET to verify persistence
        g = api_client.get(f"{BASE_URL}/api/encounters/{d['encounter_id']}", timeout=15)
        assert g.status_code == 200
        assert g.json().get("follow_up_date") == _ist_plus(7)

    def test_patch_updates_followup_and_clear_removes_it(self, api_client):
        # Reuse the encounter created above
        eid = TestEncounterFollowUps.created_ids[0]
        new_date = _ist_plus(14)
        r = api_client.patch(f"{BASE_URL}/api/encounters/{eid}", json={"follow_up_date": new_date}, timeout=15)
        assert r.status_code == 200, f"patch update failed: {r.text[:200]}"
        assert r.json().get("follow_up_date") == new_date

        # Clearing via empty string
        r = api_client.patch(f"{BASE_URL}/api/encounters/{eid}", json={"follow_up_date": ""}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("follow_up_date") in (None, ""), f"expected cleared, got {r.json().get('follow_up_date')}"

        # Clearing via null - re-set then null
        api_client.patch(f"{BASE_URL}/api/encounters/{eid}", json={"follow_up_date": new_date}, timeout=15)
        r = api_client.patch(f"{BASE_URL}/api/encounters/{eid}", json={"follow_up_date": None}, timeout=15)
        # None sent from Python -> JSON null; router treats None as 'no change' unless field explicitly present.
        # We just require the endpoint doesn't crash and returns 200 or 400.
        assert r.status_code in (200, 400)

    def test_followups_endpoint_today_and_upcoming(self, api_client):
        # Create an encounter with today's date
        today = _ist_today()
        r = api_client.post(f"{BASE_URL}/api/encounters", json={
            "patient_name": "TEST_FollowUp TodayPatient",
            "chief_complaint": "Due today",
            "follow_up_date": today,
        }, timeout=20)
        assert r.status_code == 200
        eid_today = r.json()["encounter_id"]
        TestEncounterFollowUps.created_ids.append(eid_today)

        # Create an encounter with a future date
        future = _ist_plus(10)
        r = api_client.post(f"{BASE_URL}/api/encounters", json={
            "patient_name": "TEST_FollowUp FuturePatient",
            "chief_complaint": "Due later",
            "follow_up_date": future,
        }, timeout=20)
        assert r.status_code == 200
        eid_future = r.json()["encounter_id"]
        TestEncounterFollowUps.created_ids.append(eid_future)

        # scope=today
        r = api_client.get(f"{BASE_URL}/api/encounters/followups", params={"scope": "today"}, timeout=15)
        assert r.status_code == 200, f"followups today failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "items" in body and "today" in body and "count" in body
        assert body["today"] == today
        ids = [it["encounter_id"] for it in body["items"]]
        assert eid_today in ids, "today's encounter missing from scope=today"
        assert eid_future not in ids, "future encounter should not appear in scope=today"

        # scope=upcoming (default): should include both today and future, sorted asc
        r = api_client.get(f"{BASE_URL}/api/encounters/followups", params={"scope": "upcoming"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        dates = [it.get("follow_up_date") for it in body["items"]]
        # ensure ascending
        assert dates == sorted(dates), f"dates not sorted asc: {dates[:5]}"
        ids = [it["encounter_id"] for it in body["items"]]
        assert eid_today in ids and eid_future in ids

    def test_route_ordering_followups_not_captured_as_id(self, api_client):
        """GET /api/encounters/followups should hit the followups handler,
        NOT the /{encounter_id} handler which would 404."""
        r = api_client.get(f"{BASE_URL}/api/encounters/followups", timeout=15)
        assert r.status_code == 200, f"route ordering broken: {r.status_code} {r.text[:200]}"
        body = r.json()
        # Followups response has 'items','today','count'; a single-encounter response would have 'encounter_id'
        assert "today" in body and "count" in body
        assert "encounter_id" not in body

    @classmethod
    def teardown_class(cls):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", **AUTH})
        for eid in cls.created_ids:
            try:
                s.delete(f"{BASE_URL}/api/encounters/{eid}", timeout=10)
            except Exception:
                pass


# ─── Share poster + og:image ────────────────────────────────────────

class TestSharePoster:
    """Auto-generated OG poster + fallback wiring."""

    def test_poster_png_returns_image(self):
        r = requests.get(f"{BASE_URL}/api/share/poster.png", params={"t": "Test Title", "s": "Sub"}, timeout=20)
        assert r.status_code == 200, f"poster status {r.status_code}: {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("image/png")
        assert len(r.content) > 1000

        # Verify dimensions via PIL
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(r.content))
            assert img.size == (1200, 630), f"unexpected size: {img.size}"
        except ImportError:
            pytest.skip("PIL not available for dimension check")

    def test_guide_no_image_uses_poster_fallback(self):
        r = requests.get(f"{BASE_URL}/api/share/guide/turp", timeout=15)
        assert r.status_code == 200, f"guide share status {r.status_code}"
        html = r.text
        assert 'property="og:image"' in html
        # Extract og:image content
        import re
        m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
        assert m, "og:image meta not found"
        og_image = m.group(1)
        assert "/api/share/poster.png" in og_image, f"expected poster fallback, got: {og_image}"

    def test_blog_with_custom_image_uses_provided_image(self):
        # Fetch a blog post id
        r = requests.get(f"{BASE_URL}/api/blog", timeout=15)
        assert r.status_code == 200
        posts = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not posts:
            pytest.skip("no blog posts available")
        post_id = posts[0].get("post_id") or posts[0].get("id")
        assert post_id
        custom_img = "https://example.com/custom.jpg"
        r = requests.get(f"{BASE_URL}/api/share/blog/{post_id}", params={"img": custom_img}, timeout=15)
        assert r.status_code == 200
        html = r.text
        import re
        m = re.search(r'property="og:image"\s+content="([^"]+)"', html)
        assert m, "og:image not found"
        og_image = m.group(1)
        assert og_image == custom_img, f"expected provided image, got: {og_image}"
        assert "/api/share/poster.png" not in og_image, "poster should NOT be used when img provided"
