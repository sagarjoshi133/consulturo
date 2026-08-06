# ConsultUro — Web Smoke Tests

Lightweight Playwright smoke suite that hits the production-like Expo
web bundle (http://localhost:3000) and asserts that every critical
flow is mounted and renders without crashing.

## Coverage (52 tests as of Phase 3.9.1)

### UI flows
- Public landing page (`/`)
- Owner dashboard (`/dashboard`)
- Billing & Receipts hub (`/billing`)
- Billing → Record payment (`/billing/new`)
- Billing → Receipt detail (`/billing/<id>`)
- Patient Profile (`/patient-db/<phone>`)
- Prescription detail (`/prescriptions/<id>`)
- Booking detail (`/bookings/<id>`)
- OT Schedule wizard (`/ot-calendar/schedule`)
- All 9 calculators (`/calculators/<slug>`) parametrised
- Calculators with patient_phone/name → banner
- Dup-Merge admin tool (`/admin/dup-merge`)
- Tools hub + More menu
- Dashboard tabs parametrised: today, bookings, consultations,
  prescriptions, surgeries, availability, team
- Main admin/clinical routes parametrised: /permission-manager,
  /admin-crash-log, /ot-calendar, /consents, /reminders, /notes,
  /inbox, /profile

### Backend API surface
- `GET /api/` health
- `POST /api/receipts` requires auth (401)
- `GET /api/receipts/daily-collection` shape
- Authenticated GETs parametrised:
    /api/receipts, /api/receipts/daily-collection,
    /api/prescriptions, /api/bookings/all, /api/surgeries,
    /api/tools/scores/iief5, /api/admin/users/find-duplicates,
    /api/me

## Run locally

```bash
# 1. Make sure frontend + backend are up:
sudo supervisorctl status backend expo

# 2. (one-time) install browser binaries — only Chromium needed:
python -m playwright install chromium

# 3. Run all smoke tests:
cd /app/tests/web_smoke
pytest -v smoke.py
```

Each test takes ~5s. Total suite ~3 minutes.

## Run with the wrapper script (pre-deploy gate)

The wrapper bails out early if services aren't up and installs
Chromium on first run.

```bash
bash /app/tests/run_smoke.sh
```

Exit 0 = green, non-zero = at least one failure.

## CI / pre-deploy gate

A GitHub Actions workflow lives at `/.github/workflows/web-smoke.yml`
that:
- boots a fresh MongoDB
- installs backend + frontend deps
- boots `uvicorn` + `expo start --web`
- seeds a `ci_smoke_session` token tied to a primary_owner user
- runs `tests/run_smoke.sh`

It triggers on every PR and push to `main` / `master`. Add the
workflow file to `.github/workflows/` in your fork — it doesn't run
unless committed.

**EAS pre-build local gate (recommended):**

```bash
# Before kicking off any EAS build, run the smoke suite first.
bash /app/tests/run_smoke.sh && \
  cd /app/frontend && \
  eas build --platform android --profile production
```

## Token

The default token `test_session_1776770314741` is the in-memory dev
session for sagar.joshi133@gmail.com (primary_owner). Override via
the `SMOKE_AUTH_TOKEN` env var.
