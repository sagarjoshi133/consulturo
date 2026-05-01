#!/usr/bin/env bash
# ------------------------------------------------------------------
# install-git-hooks.sh
# ------------------------------------------------------------------
# Installs the project's git hooks under .git/hooks/.
# Idempotent — safe to run repeatedly.
#
# USAGE
#   scripts/install-git-hooks.sh
# ------------------------------------------------------------------
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_DIR="$REPO_ROOT/.git/hooks"

if [ ! -d "$HOOK_DIR" ]; then
  echo "[install-git-hooks] Not a git repo (no $HOOK_DIR) — skipping."
  exit 0
fi

cat > "$HOOK_DIR/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Auto-sync yarn.lock if frontend/package.json is staged.
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Only run when frontend/package.json is part of this commit.
if git diff --cached --name-only | grep -qE '^frontend/package\.json$'; then
  echo "[pre-commit] frontend/package.json staged — verifying yarn.lock sync..."
  bash "$REPO_ROOT/scripts/check-lockfile.sh" || exit 1
fi
exit 0
HOOK

chmod +x "$HOOK_DIR/pre-commit"
echo "[install-git-hooks] Installed pre-commit hook at $HOOK_DIR/pre-commit ✅"
