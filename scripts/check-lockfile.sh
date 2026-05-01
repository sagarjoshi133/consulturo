#!/usr/bin/env bash
# ------------------------------------------------------------------
# check-lockfile.sh
# ------------------------------------------------------------------
# Ensures that frontend/yarn.lock is in sync with frontend/package.json
# whenever package.json is being committed.
#
# WHY?
# Vercel runs `yarn install --frozen-lockfile`. If yarn.lock drifts even
# slightly, the deploy fails with:
#     "Your lockfile needs to be updated, but yarn was run with
#      --frozen-lockfile."
#
# This script detects that situation and either:
#   • auto-fixes it by running `yarn install` and staging the updated
#     lockfile (when run as a git pre-commit hook), or
#   • exits non-zero so CI fails fast (when run with --check).
#
# USAGE
#   scripts/check-lockfile.sh           # Auto-fix mode (default)
#   scripts/check-lockfile.sh --check   # Validation only, no mutation
# ------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
MODE="${1:-fix}"

cd "$FRONTEND_DIR"

# Quick sanity: are we in a yarn project?
if [ ! -f "package.json" ] || [ ! -f "yarn.lock" ]; then
  echo "[check-lockfile] No yarn project at $FRONTEND_DIR — skipping."
  exit 0
fi

# Run yarn in frozen mode to detect drift WITHOUT touching files.
if yarn install --frozen-lockfile --ignore-scripts --silent >/dev/null 2>&1; then
  echo "[check-lockfile] yarn.lock is in sync with package.json. ✅"
  exit 0
fi

echo "[check-lockfile] ⚠  yarn.lock is OUT OF SYNC with package.json."

if [ "$MODE" = "--check" ]; then
  echo "[check-lockfile] Run \`yarn install\` in frontend/ and commit yarn.lock."
  exit 1
fi

echo "[check-lockfile] Auto-fixing: running \`yarn install\`..."
yarn install --network-timeout 600000 --ignore-scripts >/dev/null 2>&1
echo "[check-lockfile] Staging updated frontend/yarn.lock"
git -C "$REPO_ROOT" add frontend/yarn.lock
echo "[check-lockfile] Done. ✅  yarn.lock is now in sync and staged."
exit 0
