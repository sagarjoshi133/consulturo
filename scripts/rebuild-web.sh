#!/usr/bin/env bash
# rebuild-web.sh — Rebuild the production web bundle and reload the
# Emergent preview at http://localhost:3000/
#
# WHY:
#   The Emergent container's `inotify` watch limit (12288) is too low
#   for Metro's dev-mode file watcher — it crashes with ENOSPC. As a
#   workaround the supervisor `expo` program serves a STATIC build
#   (`expo export` → `serve dist`). Whenever you edit source, you must
#   rerun this script to refresh the preview.
#
# USAGE:
#   bash /app/scripts/rebuild-web.sh
#
# Optional flags:
#   --no-clean     Skip removing the old dist/ before rebuilding
#                  (faster but may leave stale chunks).

set -euo pipefail

cd /app/frontend

CLEAN=1
for arg in "$@"; do
  case "$arg" in
    --no-clean) CLEAN=0 ;;
  esac
done

if [ "$CLEAN" = "1" ]; then
  rm -rf dist
fi

echo "[rebuild-web] Bundling web…"
yarn -s expo export -p web --output-dir dist

echo "[rebuild-web] Reloading preview server…"
sudo supervisorctl restart expo >/dev/null 2>&1 || true

# Wait a beat for serve to bind, then probe.
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ --max-time 5 || echo "000")
echo "[rebuild-web] Preview HTTP $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "[rebuild-web] ⚠️  Preview not responding 200 — check 'sudo supervisorctl status expo' and tail /var/log/supervisor/expo.err.log"
  exit 1
fi

echo "[rebuild-web] ✅ Preview ready at http://localhost:3000/"
