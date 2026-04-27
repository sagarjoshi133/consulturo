#!/usr/bin/env bash
# ConsultUro — daily MongoDB backup script.
#
# Runs a mongodump against the configured MONGO_URL and archives the
# resulting dump folder as /app/backups/consulturo-YYYY-MM-DD-HHMMSS.tar.gz
# Retains the most recent 14 backups and deletes older ones.
#
# Usage:
#   bash /app/scripts/backup_mongo.sh
#
# Cron (daily at 03:15 local, as root):
#   15 3 * * * /app/scripts/backup_mongo.sh >> /var/log/consulturo-backup.log 2>&1

set -euo pipefail

ROOT_DIR="/app"
BACKUP_DIR="${ROOT_DIR}/backups"
RETENTION=14

# Load env from backend/.env if present (safe key=value parser, no shell-eval)
if [ -f "${ROOT_DIR}/backend/.env" ]; then
  MONGO_URL_ENV="$(grep -E '^MONGO_URL=' "${ROOT_DIR}/backend/.env" | head -1 | cut -d'=' -f2-)"
  DB_NAME_ENV="$(grep -E '^DB_NAME=' "${ROOT_DIR}/backend/.env" | head -1 | cut -d'=' -f2-)"
  [ -n "${MONGO_URL_ENV:-}" ] && MONGO_URL="${MONGO_URL_ENV}"
  [ -n "${DB_NAME_ENV:-}" ] && DB_NAME="${DB_NAME_ENV}"
fi

MONGO_URL="${MONGO_URL:-mongodb://localhost:27017}"
DB_NAME="${DB_NAME:-consulturo}"

mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y-%m-%d-%H%M%S)"
TMP_DIR="$(mktemp -d)"
OUT_ARCHIVE="${BACKUP_DIR}/consulturo-${STAMP}.tar.gz"

echo "[backup] ${STAMP} — starting mongodump (db=${DB_NAME})"
mongodump --uri="${MONGO_URL}" --db="${DB_NAME}" --out="${TMP_DIR}" --quiet

echo "[backup] archiving → ${OUT_ARCHIVE}"
tar -czf "${OUT_ARCHIVE}" -C "${TMP_DIR}" "."
rm -rf "${TMP_DIR}"

# Retention — keep only latest RETENTION files
cd "${BACKUP_DIR}"
ls -1t consulturo-*.tar.gz 2>/dev/null | awk -v n="${RETENTION}" 'NR>n' | xargs -r rm -f --

SIZE="$(du -h "${OUT_ARCHIVE}" | cut -f1)"
echo "[backup] done — ${OUT_ARCHIVE} (${SIZE})"

# Off-host mirror — pushes the new archive to S3 / rclone / rsync if
# BACKUP_MIRROR_MODE is configured. No-op (and exits 0) otherwise so this
# script never breaks the daily backup pipeline.
MIRROR_SCRIPT="${ROOT_DIR}/scripts/mirror_backups.sh"
if [ -x "${MIRROR_SCRIPT}" ]; then
  echo "[backup] running mirror → ${MIRROR_SCRIPT}"
  bash "${MIRROR_SCRIPT}" || echo "[backup] mirror exited non-zero (continuing)" >&2
fi
