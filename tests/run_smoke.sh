#!/usr/bin/env bash
# ConsultUro — pre-deploy smoke test runner.
#
# Run BEFORE every EAS / native deploy. Bails fast if any smoke test
# fails. Designed to be called from CI (GitHub Actions / Cloudflare
# pages / EAS hook) OR locally:
#
#   bash /app/tests/run_smoke.sh
#
# Exits 0 on full green, non-zero on any failure.

set -euo pipefail

SMOKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web_smoke"
cd "$SMOKE_DIR"

echo "── ConsultUro smoke ────────────────────────────────────────"
echo "Dir   : $SMOKE_DIR"
echo "Front : ${FRONTEND_URL:-http://localhost:3000}"
echo "Back  : ${BACKEND_URL:-http://localhost:8001}"
echo "Token : ${SMOKE_AUTH_TOKEN:-test_session_1776770314741}"
echo "────────────────────────────────────────────────────────────"

# 1) Ensure services are running. We try a 30s wait window before
#    aborting — Metro warm-up can take ~10s on cold caches.
echo "→ Waiting for frontend ${FRONTEND_URL:-http://localhost:3000} …"
for i in {1..30}; do
  if curl -sf -m 2 "${FRONTEND_URL:-http://localhost:3000}" >/dev/null 2>&1; then
    echo "  frontend ready"
    break
  fi
  sleep 1
done

echo "→ Waiting for backend ${BACKEND_URL:-http://localhost:8001} …"
for i in {1..30}; do
  if curl -sf -m 2 "${BACKEND_URL:-http://localhost:8001}/api/" >/dev/null 2>&1; then
    echo "  backend ready"
    break
  fi
  sleep 1
done

# 2) Install Chromium if missing (no-op when already present).
if [ ! -d /pw-browsers/chromium-* ] && [ ! -d "$HOME/.cache/ms-playwright/chromium-"* ]; then
  echo "→ Installing Playwright Chromium …"
  python -m playwright install chromium >/dev/null
fi

# 3) Run the suite.
echo "→ Running smoke.py …"
pytest -v --tb=short smoke.py

echo ""
echo "✔ All smoke tests passed."
