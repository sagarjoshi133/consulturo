"""ConsultUro — web smoke tests (Playwright sync).

Lightweight smoke suite that hits the running Expo web bundle on
localhost:3000 and asserts each critical screen mounts and renders
without crashing. Tokens are injected via localStorage before each
test so the screens render their authenticated state.

Run: pytest -v smoke.py
"""
from __future__ import annotations

import os
import time

import pytest
import requests
from playwright.sync_api import Browser, Page, sync_playwright

BASE = os.environ.get("FRONTEND_URL", "http://localhost:3000")
BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8001")
TOKEN = os.environ.get(
    "SMOKE_AUTH_TOKEN",
    "test_session_1776770314741",  # primary_owner — sagar.joshi133
)


# ─────────────────────────── fixtures ───────────────────────────
@pytest.fixture(scope="session")
def browser() -> Browser:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        yield b
        b.close()


@pytest.fixture
def page(browser: Browser) -> Page:
    ctx = browser.new_context(viewport={"width": 414, "height": 896})
    page = ctx.new_page()
    # Stash the token BEFORE first navigation so the very first
    # render uses an authenticated session.
    page.goto(f"{BASE}/")
    page.wait_for_timeout(800)
    page.evaluate(f"() => localStorage.setItem('session_token', '{TOKEN}')")
    yield page
    ctx.close()


# Pre-fetch fixtures from the backend so the tests use real IDs.
@pytest.fixture(scope="session")
def fixtures() -> dict:
    headers = {"Authorization": f"Bearer {TOKEN}"}
    f: dict = {}
    # An existing prescription
    rxs = requests.get(f"{BACKEND}/api/prescriptions?limit=1", headers=headers, timeout=10).json()
    if isinstance(rxs, list) and rxs:
        f["rx_id"] = rxs[0].get("prescription_id")
        f["patient_phone"] = rxs[0].get("patient_phone")
    # An existing booking
    bks = requests.get(f"{BACKEND}/api/bookings/all?limit=1", headers=headers, timeout=10).json()
    if isinstance(bks, list) and bks:
        f["bk_id"] = bks[0].get("booking_id")
    # An existing receipt
    rcs = requests.get(f"{BACKEND}/api/receipts?limit=1", headers=headers, timeout=10).json()
    if isinstance(rcs, list) and rcs:
        f["rc_id"] = rcs[0].get("receipt_id")
        f["rc_phone"] = rcs[0].get("patient_phone") or f.get("patient_phone")
    return f


# ──────────────────────────── helpers ────────────────────────────
def goto(page: Page, path: str, *, expect_text: str | None = None, timeout: int = 12000):
    """Navigate + wait for body content. Returns the final URL."""
    page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=timeout)
    page.wait_for_timeout(2500)  # let Expo Router finish mounting
    if expect_text:
        # locator-based check — case-insensitive contains, on any text node
        loc = page.get_by_text(expect_text, exact=False).first
        loc.wait_for(timeout=timeout)
    return page.url


# ───────────────────────────── tests ─────────────────────────────
def test_landing_renders(page: Page):
    """Public landing page must mount without an unhandled error."""
    page.goto(BASE, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2000)
    # No JS error banner / no React error boundary fallback
    body_text = page.inner_text("body").lower()
    assert "something went wrong" not in body_text
    assert "error" not in body_text.split("\n")[0]  # rough sanity


def test_dashboard_owner(page: Page):
    goto(page, "/dashboard", expect_text="Today")


def test_billing_hub(page: Page):
    goto(page, "/billing", expect_text="Billing & Receipts")
    # daily-collection card visible
    page.get_by_text("Daily collection", exact=False).first.wait_for(timeout=8000)


def test_billing_new(page: Page):
    goto(page, "/billing/new", expect_text="Record payment")
    # Line items section
    page.get_by_text("Line items", exact=False).first.wait_for(timeout=8000)
    # Save buttons present
    assert page.locator('[data-testid="bill-save"]').count() >= 1


def test_billing_detail(page: Page, fixtures: dict):
    rc_id = fixtures.get("rc_id")
    if not rc_id:
        pytest.skip("No receipt fixture available")
    goto(page, f"/billing/{rc_id}", expect_text="Receipt")
    # Action bar buttons
    assert page.locator('[data-testid="rc-print"]').count() >= 1
    assert page.locator('[data-testid="rc-pdf"]').count() >= 1


def test_patient_profile(page: Page, fixtures: dict):
    phone = fixtures.get("patient_phone") or fixtures.get("rc_phone") or "9099985459"
    goto(page, f"/patient-db/{phone}")
    # The header schedule-OT icon is the most reliable landmark on
    # this screen for an authenticated staff session.
    page.locator('[data-testid="patient-header-schedule-ot"]').first.wait_for(timeout=12000)


def test_prescription_detail(page: Page, fixtures: dict):
    rx = fixtures.get("rx_id")
    if not rx:
        pytest.skip("No prescription fixture available")
    goto(page, f"/prescriptions/{rx}", expect_text="Prescription")
    page.locator('[data-testid="rx-detail-back"]').first.wait_for(timeout=8000)


def test_booking_detail(page: Page, fixtures: dict):
    bk = fixtures.get("bk_id")
    if not bk:
        pytest.skip("No booking fixture available")
    goto(page, f"/bookings/{bk}", expect_text="Appointment")


def test_ot_schedule_wizard(page: Page):
    goto(page, "/ot-calendar/schedule", expect_text="Schedule")


@pytest.mark.parametrize(
    "slug",
    ["iief5", "egfr", "crcl", "stone-risk", "bmi", "psa", "creatinine", "prostate-volume", "bladder-diary"],
)
def test_calculators_mount(page: Page, slug: str):
    """Every calculator route must mount without crashing."""
    goto(page, f"/calculators/{slug}")
    body = page.inner_text("body")
    assert len(body) > 50, f"calculator {slug} rendered empty"
    # No global error boundary triggered
    assert "Something went wrong" not in body


@pytest.mark.parametrize(
    "route",
    [
        "/dashboard?tab=today",
        "/dashboard?tab=bookings",
        "/dashboard?tab=consultations",
        "/dashboard?tab=prescriptions",
        "/dashboard?tab=surgeries",
        "/dashboard?tab=availability",
        "/dashboard?tab=team",
    ],
)
def test_dashboard_tabs_mount(page: Page, route: str):
    """Every dashboard tab must mount without a top-level crash."""
    goto(page, route)
    body = page.inner_text("body")
    assert "Something went wrong" not in body, f"{route} crashed"


@pytest.mark.parametrize(
    "route",
    [
        "/billing",
        "/billing/new",
        "/permission-manager",
        "/admin/dup-merge",
        "/admin-crash-log",
        "/ot-calendar",
        "/ot-calendar/schedule",
        "/consents",
        "/reminders",
        "/notes",
        "/inbox",
        "/profile",
    ],
)
def test_main_routes_mount(page: Page, route: str):
    """All primary owner / staff routes mount without a crash."""
    goto(page, route)
    body = page.inner_text("body")
    assert "Something went wrong" not in body, f"{route} crashed"


@pytest.mark.parametrize(
    "endpoint",
    [
        "/api/receipts",
        "/api/receipts/daily-collection",
        "/api/prescriptions",
        "/api/bookings/all",
        "/api/surgeries",
        "/api/tools/scores/iief5",
        "/api/admin/users/find-duplicates",
        "/api/auth/me",
    ],
)
def test_backend_endpoints_authenticated(endpoint: str):
    """Authenticated GETs must all return 200 with proper JSON."""
    r = requests.get(
        f"{BACKEND}{endpoint}",
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=10,
    )
    assert r.status_code == 200, f"{endpoint} returned {r.status_code}: {r.text[:200]}"
    # Must be JSON-parseable
    r.json()


def test_calculators_with_patient_context(page: Page):
    """Calculator opened with patient_phone/name shows the banner."""
    goto(
        page,
        "/calculators/egfr?patient_phone=9099985459&patient_name=Sagar%20Joshi",
        expect_text="Running calculator for",
    )


def test_dup_merge_super_owner(page: Page):
    goto(page, "/admin/dup-merge", expect_text="Duplicate Account Merge")
    # Either rows or the empty state must render — both contain the
    # "Re-scan" button text.
    page.get_by_text("Re-scan duplicates", exact=False).first.wait_for(timeout=8000)


def test_tools_hub(page: Page):
    goto(page, "/(tabs)/tools", expect_text="")
    # For staff, this redirects to StaffPatientDb. The page itself
    # must mount without a global error.
    body = page.inner_text("body")
    assert "Something went wrong" not in body


def test_more_menu(page: Page):
    goto(page, "/(tabs)/more")
    body = page.inner_text("body")
    # Either patient or staff view of More must contain at least one
    # of these landmarks.
    assert any(s in body for s in ("Billing", "Dashboard", "Sign in", "About", "Settings"))


# ───────────────── backend API surface smoke ─────────────────
def test_backend_health():
    r = requests.get(f"{BACKEND}/api/", timeout=10)
    assert r.status_code == 200


def test_backend_receipts_auth():
    # Unauthenticated → 401
    r = requests.post(f"{BACKEND}/api/receipts", json={}, timeout=10)
    assert r.status_code in (401, 403)


def test_backend_daily_collection():
    r = requests.get(
        f"{BACKEND}/api/receipts/daily-collection",
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert "total" in data and "count" in data and "by_mode" in data
