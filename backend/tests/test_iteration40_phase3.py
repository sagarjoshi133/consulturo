"""ConsultUro — Iteration 40 Phase-3 backend verification.

Covers review_request items:
  · item 12 — GET /api/drug-repository (lazy global seed + q filter)
  · item 13 — POST/GET/DELETE /api/discharge-med-templates (clinic-scoped upsert)
  · item  8 — PATCH /api/bookings/{id} status='completed' mirrors an encounter
             into /api/encounters/worklist?scope=completed
  · item  9 — POST /api/surgeries with scheduling payload +
             GET /api/surgeries/conflicts + /procedures + /ot-rooms

All test-created rows are cleaned up in fixtures / teardown.
"""

import os
import uuid
import pytest
import requests

BASE_URL = "https://urology-pro.preview.emergentagent.com"
OWNER_TOKEN = "test_session_1781800271528"
HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {OWNER_TOKEN}",
}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update(HEADERS)
    return sess


# ─── item 12 · drug repository ───────────────────────────────────
class TestDrugRepository:
    def test_list_returns_nonempty(self, s):
        r = s.get(f"{BASE_URL}/api/drug-repository", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("items"), list)
        assert len(data["items"]) > 0, "drug-repository items[] must not be empty after lazy seed"
        # Field sanity
        it = data["items"][0]
        for k in ("name", "category", "form"):
            assert k in it, f"missing key {k} in drug entry"

    def test_search_q_para(self, s):
        r = s.get(f"{BASE_URL}/api/drug-repository", params={"q": "para"}, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        assert len(items) > 0, "expected at least one match for q=para"
        # every hit must contain 'para' in name or brands (case-insensitive)
        for it in items:
            haystack = (it.get("name", "") + " " + " ".join(it.get("brands") or [])).lower()
            assert "para" in haystack, f"unexpected match without 'para': {it.get('name')}"


# ─── item 13 · discharge-med templates ───────────────────────────
class TestDischargeMedTemplates:
    TEST_NAME = f"TEST_dmt_{uuid.uuid4().hex[:6]}"
    _template_id = None

    def test_01_create(self, s):
        body = {"name": self.__class__.TEST_NAME, "meds": "Tab Paracetamol 500mg BD x 3 days"}
        r = s.post(f"{BASE_URL}/api/discharge-med-templates", json=body, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        tpl = data.get("template") or {}
        assert tpl.get("name") == self.__class__.TEST_NAME
        assert tpl.get("meds", "").startswith("Tab Paracetamol")
        assert tpl.get("template_id"), "template_id missing on create"
        self.__class__._template_id = tpl["template_id"]

    def test_02_list_contains(self, s):
        r = s.get(f"{BASE_URL}/api/discharge-med-templates", timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items", [])
        names = [t.get("name") for t in items]
        assert self.__class__.TEST_NAME in names, f"created template not listed: names={names[:10]}"

    def test_03_re_post_upserts_no_duplicate(self, s):
        body = {"name": self.__class__.TEST_NAME, "meds": "Tab Paracetamol 650mg TDS x 5 days"}
        r = s.post(f"{BASE_URL}/api/discharge-med-templates", json=body, timeout=30)
        assert r.status_code == 200, r.text
        tpl = r.json().get("template") or {}
        # Same template_id preserved by upsert
        assert tpl.get("template_id") == self.__class__._template_id
        assert "650mg" in tpl.get("meds", "")
        # Confirm no duplicate rows
        r2 = s.get(f"{BASE_URL}/api/discharge-med-templates", timeout=30)
        matches = [t for t in r2.json().get("items", []) if t.get("name") == self.__class__.TEST_NAME]
        assert len(matches) == 1, f"expected 1 row after upsert, got {len(matches)}"

    def test_04_delete(self, s):
        assert self.__class__._template_id, "prior test must have set _template_id"
        r = s.delete(
            f"{BASE_URL}/api/discharge-med-templates/{self.__class__._template_id}",
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # GET verify absent
        r2 = s.get(f"{BASE_URL}/api/discharge-med-templates", timeout=30)
        names = [t.get("name") for t in r2.json().get("items", [])]
        assert self.__class__.TEST_NAME not in names

    def test_05_delete_missing_returns_404(self, s):
        r = s.delete(
            f"{BASE_URL}/api/discharge-med-templates/dmt_does_not_exist_xyz",
            timeout=30,
        )
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ─── item 8 · booking → completed → encounter mirror ─────────────
class TestBookingCompletedEncounter:
    _booking_id = None
    _original_status = None
    _created_encounter_id = None
    _booking_date = None

    def test_01_pick_confirmed_booking(self, s):
        r = s.get(f"{BASE_URL}/api/bookings/all", params={"status": "confirmed", "limit": 50}, timeout=30)
        assert r.status_code == 200, r.text
        raw = r.json()
        rows = raw if isinstance(raw, list) else raw.get("bookings") or raw.get("items") or []
        confirmed = [b for b in rows if (b.get("status") or "").lower() == "confirmed"]
        if not confirmed:
            pytest.skip("No confirmed bookings available in this environment")
        b = confirmed[0]
        self.__class__._booking_id = b.get("booking_id") or b.get("id")
        self.__class__._original_status = "confirmed"
        self.__class__._booking_date = (
            b.get("final_date") or b.get("scheduled_date") or b.get("date") or b.get("appointment_date")
        )
        assert self.__class__._booking_id, "booking_id/id missing on the confirmed booking"

    def test_02_patch_completed_creates_encounter(self, s):
        bid = self.__class__._booking_id
        # Track pre-existing encounter (if any) for this booking so we can
        # tell whether we created a new one.
        pre = s.get(f"{BASE_URL}/api/encounters", params={"booking_id": bid, "limit": 5}, timeout=30)
        pre_ids = set()
        if pre.status_code == 200:
            for e in pre.json().get("items", []) or []:
                pre_ids.add(e.get("encounter_id"))

        r = s.patch(f"{BASE_URL}/api/bookings/{bid}", json={"status": "completed"}, timeout=30)
        assert r.status_code == 200, r.text

        # Look up encounter tied to this booking, stage=completed
        rs = s.get(f"{BASE_URL}/api/encounters", params={"booking_id": bid, "limit": 5}, timeout=30)
        assert rs.status_code == 200, rs.text
        matches = [e for e in rs.json().get("items", []) if e.get("booking_id") == bid]
        assert matches, "no encounter mirrored for the completed booking"
        enc = matches[0]
        assert enc.get("stage") == "completed", f"expected stage=completed, got {enc.get('stage')}"
        if enc.get("encounter_id") not in pre_ids:
            self.__class__._created_encounter_id = enc.get("encounter_id")

    def test_03_worklist_completed_shows_it(self, s):
        bid = self.__class__._booking_id
        date = self.__class__._booking_date
        params = {"scope": "completed"}
        if date:
            params["date"] = date
        r = s.get(f"{BASE_URL}/api/encounters/worklist", params=params, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json().get("items", []) or []
        booking_ids = [i.get("booking_id") for i in items]
        assert bid in booking_ids, (
            f"booking {bid} not surfaced in worklist scope=completed date={date}. "
            f"Saw {len(items)} items."
        )

    def test_99_cleanup_revert_and_delete(self, s):
        # Revert booking back to confirmed
        bid = self.__class__._booking_id
        if bid:
            s.patch(f"{BASE_URL}/api/bookings/{bid}", json={"status": "confirmed"}, timeout=30)
        # Delete the encounter we created (only if it did not pre-exist)
        eid = self.__class__._created_encounter_id
        if eid:
            resp = s.delete(f"{BASE_URL}/api/encounters/{eid}", timeout=30)
            # 200 or 204 are both fine
            assert resp.status_code in (200, 204, 404), resp.text


# ─── item 9 · surgeries scheduling ───────────────────────────────
class TestSurgeryScheduling:
    _surgery_id = None

    def test_01_procedures(self, s):
        r = s.get(f"{BASE_URL}/api/surgeries/procedures", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        procs = data.get("procedures") or []
        assert len(procs) > 0, "procedures list empty"
        # Every entry should carry the fields the OT scheduler needs
        for p in procs[:5]:
            assert p.get("key")
            assert isinstance(p.get("name"), dict)
            assert "duration_min" in p

    def test_02_ot_rooms(self, s):
        r = s.get(f"{BASE_URL}/api/surgeries/ot-rooms", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Response shape: list under 'rooms' or 'ot_rooms' or 'items'
        rooms = data.get("rooms") or data.get("ot_rooms") or data.get("items") or []
        if isinstance(data, list):
            rooms = data
        assert len(rooms) > 0, f"ot-rooms empty: {data}"

    def test_03_create_scheduled_surgery(self, s):
        payload = {
            "patient_phone": "9998887777",
            "patient_name": "TEST_OTPatient",
            "surgery_name": "TEST_TURP_SCHED",
            "date": "2026-02-15",
            "surgery_status": "scheduled",
            "procedure_key": "turp",
            "scheduled_date": "2026-02-15",
            "scheduled_time": "10:00",
            "ot_room": "OT-1",
            "estimated_duration_min": 60,
        }
        r = s.post(f"{BASE_URL}/api/surgeries", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        row = r.json()
        sid = row.get("surgery_id") or row.get("id")
        assert sid, f"no surgery_id in response: {row}"
        self.__class__._surgery_id = sid

    def test_04_conflicts_returns_overlap(self, s):
        params = {
            "scheduled_date": "2026-02-15",
            "scheduled_time": "10:30",  # overlaps 10:00-11:00
            "duration_min": 60,
            "ot_room": "OT-1",
        }
        r = s.get(f"{BASE_URL}/api/surgeries/conflicts", params=params, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "conflicts" in data, f"missing conflicts field: {data}"
        assert isinstance(data["conflicts"], list)
        # Our test surgery must show up as a conflict
        ids = [c.get("surgery_id") for c in data["conflicts"]]
        assert self.__class__._surgery_id in ids, (
            f"expected our surgery {self.__class__._surgery_id} to conflict, got {ids}"
        )

    def test_05_conflicts_no_overlap(self, s):
        params = {
            "scheduled_date": "2026-02-15",
            "scheduled_time": "14:00",
            "duration_min": 30,
            "ot_room": "OT-1",
        }
        r = s.get(f"{BASE_URL}/api/surgeries/conflicts", params=params, timeout=30)
        assert r.status_code == 200, r.text
        ids = [c.get("surgery_id") for c in r.json().get("conflicts", [])]
        assert self.__class__._surgery_id not in ids

    def test_99_cleanup(self, s):
        sid = self.__class__._surgery_id
        if sid:
            r = s.delete(f"{BASE_URL}/api/surgeries/{sid}", timeout=30)
            assert r.status_code in (200, 204, 404), r.text
