#!/usr/bin/env bash
# ConsultUro — Supervisor pre-start hook for the FastAPI backend.
#
# WHY THIS EXISTS:
#   The Emergent Kubernetes container periodically resets its Python
#   site-packages, wiping `pymongo`, `motor`, `sentry-sdk` and friends.
#   When that happens, `python -m uvicorn server:app` crashes with
#   ModuleNotFoundError before the backend can serve a single request,
#   leaving every `/api/*` call 502-ing.
#
#   This wrapper is invoked by `supervisord` (program:backend) instead
#   of `python -m uvicorn ...` directly. It:
#     1. Ensures every required dep listed in requirements.txt is
#        present (idempotent — `pip install -r` is a no-op when nothing
#        is missing, ~1 sec on a warm cache).
#     2. Hands off to uvicorn via `exec` so the process tree stays
#        clean and supervisor's signal handling still works.
#
#   Add new packages by editing /app/backend/requirements.txt — they
#   will be picked up automatically on the next supervisor restart.
#
# COST: ~1-2 sec on warm cache, ~30-60 sec on a cold cache (first boot
# after a full container reset). Acceptable trade-off for guaranteed
# auth/login availability.
set -euo pipefail

REQ_FILE="/app/backend/requirements.txt"
PY="/opt/plugins-venv/bin/python3"
if [ ! -x "$PY" ]; then
    # Deployment image doesn't ship the plugins-venv; fall back to the
    # system python that customer-apps-backend-base provides.
    PY="$(command -v python3)"
fi

cd /app/backend

# Probe the most-frequently-missing module first; only run the full
# requirements install when something is actually broken — this keeps
# warm-cache restarts nearly free.
if ! "$PY" -c "import pymongo, motor, sentry_sdk" 2>/dev/null; then
  echo "[backend-bootstrap] One or more required modules missing — running pip install"
  # Use `python -m pip` so we don't depend on a `pip` binary being on
  # PATH inside the venv (the Emergent plugins-venv only has Python).
  # FALLBACK CASCADE: if the strict resolver chokes on transitive
  # conflicts (e.g. mcp / sse-starlette / browser-use pulling in
  # pydantic constraints incompatible with the rest of the file), we
  # retry with `--no-deps` so at least our own pinned packages get
  # installed. Without this the backend would loop-crash any time
  # somebody auto-injected an unrelated ML package into the file.
  if ! "$PY" -m pip install --quiet --no-input -r "$REQ_FILE" 2>/dev/null; then
    echo "[backend-bootstrap] Strict install failed — retrying with --no-deps"
    "$PY" -m pip install --quiet --no-input --no-deps -r "$REQ_FILE" || {
      echo "[backend-bootstrap] --no-deps install also failed — backend will not start" >&2
      exit 1
    }
  fi
  echo "[backend-bootstrap] Dependencies restored — re-probing"
  # SECOND PROBE: handles the "phantom install" case where
  # site-packages contains stale `.dist-info` directories (so pip
  # reports the package as "already satisfied") but the actual module
  # files were wiped by the container reset. In that case the first
  # `pip install` is a no-op and the import still fails. We then run
  # a force-reinstall to repair the corrupted install.
  if ! "$PY" -c "import pymongo, motor, sentry_sdk" 2>/dev/null; then
    echo "[backend-bootstrap] Phantom install detected — purging stale dist-info dirs"
    # Remove any orphan *.dist-info directories whose matching package
    # folder is missing. These confuse pip into reporting "already
    # satisfied" while imports still fail. We scan both site-packages
    # locations the venv resolves against.
    "$PY" - <<'PYEOF'
import os, shutil, sys
SITE_DIRS = [
    "/opt/plugins-venv/lib/python3.11/site-packages",
    "/usr/local/lib/python3.11/site-packages",
]
TARGETS = {"pymongo", "motor", "sentry_sdk", "sentry-sdk"}
for site in SITE_DIRS:
    if not os.path.isdir(site):
        continue
    for entry in os.listdir(site):
        if not entry.endswith(".dist-info"):
            continue
        # dist-info name pattern: <pkg>-<ver>.dist-info — strip the
        # suffix first, then rsplit on '-' to peel off the version.
        stem = entry[: -len(".dist-info")]
        pkg = stem.rsplit("-", 1)[0].lower()
        canonical = pkg.replace("-", "_")
        if pkg not in TARGETS and canonical not in TARGETS:
            continue
        # If the matching package folder is absent OR the dist-info
        # has no RECORD file, treat as phantom and nuke it.
        full = os.path.join(site, entry)
        record = os.path.join(full, "RECORD")
        pkg_dir = os.path.join(site, canonical)
        if not os.path.isfile(record) or not os.path.isdir(pkg_dir):
            print(f"[backend-bootstrap] purging phantom {full}", file=sys.stderr)
            shutil.rmtree(full, ignore_errors=True)
PYEOF
    echo "[backend-bootstrap] Re-running pip install (force-reinstall)"
    "$PY" -m pip install --quiet --no-input --force-reinstall --no-deps --no-cache-dir \
      -r "$REQ_FILE" || {
      echo "[backend-bootstrap] force-reinstall failed — backend will not start" >&2
      exit 1
    }
    # One more probe to confirm health before handing off to uvicorn.
    "$PY" -c "import pymongo, motor, sentry_sdk" || {
      echo "[backend-bootstrap] modules still missing after force-reinstall — aborting" >&2
      exit 1
    }
    echo "[backend-bootstrap] Force-reinstall succeeded — dependencies healthy"
  fi
else
  echo "[backend-bootstrap] Dependencies already present — skipping pip"
fi

# Hand off to uvicorn (exec replaces this shell so supervisor sees a
# single process tree and signal-forwarding works correctly).
exec "$PY" -m uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1
