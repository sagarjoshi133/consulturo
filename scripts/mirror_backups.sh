#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# ConsultUro — Off-host backup MIRROR script.
# -----------------------------------------------------------------------------
#
# Pushes the daily mongodumps in /app/backups/ to a remote location so a disk
# failure / container loss doesn't take patient data with it. Driven entirely
# by environment variables — no need to edit this file.
#
# Usage:
#   1. Edit /app/backend/.env (or export in the shell calling this script)
#      and set BACKUP_MIRROR_MODE plus the credentials for that mode.
#   2. Test a manual run:   bash /app/scripts/mirror_backups.sh
#   3. The script is invoked automatically right after backup_mongo.sh by the
#      `consulturo-backup` supervisor program.
#
# Modes (set BACKUP_MIRROR_MODE to one of):
#   none      — default, no-op (logs a reminder).  (default)
#   s3        — AWS S3 sync via aws-cli.
#   rclone    — rclone copy (Google Drive / Dropbox / B2 / etc.).
#   rsync     — rsync over SSH to a remote host.
#
# Required env per mode:
#   s3:
#     S3_BUCKET=s3://my-bucket/consulturo-backups
#     AWS_ACCESS_KEY_ID=...
#     AWS_SECRET_ACCESS_KEY=...
#     AWS_DEFAULT_REGION=ap-south-1   (optional, defaults to ap-south-1)
#     S3_STORAGE_CLASS=STANDARD_IA    (optional)
#
#   rclone:
#     RCLONE_REMOTE=gdrive:consulturo-backups
#     RCLONE_CONFIG=/root/.config/rclone/rclone.conf  (optional)
#
#   rsync:
#     RSYNC_DEST=user@host.example.com:/srv/consulturo-backups
#     RSYNC_SSH_KEY=/root/.ssh/consulturo_mirror     (optional, no key auth if absent)
#
# Status: writes a JSON status file at ${BACKUP_DIR}/.mirror_status.json that
# the backend exposes via GET /api/admin/backup/status (owner-only).
# -----------------------------------------------------------------------------

set -uo pipefail

ROOT_DIR="/app"
SRC="${ROOT_DIR}/backups"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STATUS_FILE="${SRC}/.mirror_status.json"

# Load env from backend/.env if not already set in the shell
if [ -f "${ROOT_DIR}/backend/.env" ]; then
  while IFS='=' read -r k v; do
    [ -z "${k}" ] && continue
    [[ "${k}" =~ ^# ]] && continue
    # Only export keys we care about — keeps the env clean.
    case "${k}" in
      BACKUP_MIRROR_MODE|S3_BUCKET|S3_STORAGE_CLASS|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_DEFAULT_REGION|RCLONE_REMOTE|RCLONE_CONFIG|RSYNC_DEST|RSYNC_SSH_KEY)
        if [ -z "${!k:-}" ]; then
          # Strip surrounding quotes if user wrote KEY="value"
          v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
          export "${k}=${v}"
        fi
        ;;
    esac
  done < "${ROOT_DIR}/backend/.env"
fi

MODE="${BACKUP_MIRROR_MODE:-none}"

write_status() {
  local ok="$1" msg="$2" detail="$3"
  # Compact one-line JSON; cheap, no python/jq dependency
  local count size
  count="$(ls -1 "${SRC}"/consulturo-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
  size="$(du -sh "${SRC}" 2>/dev/null | cut -f1 || echo '0')"
  cat > "${STATUS_FILE}" <<EOF
{
  "ts": "${STAMP}",
  "mode": "${MODE}",
  "ok": ${ok},
  "message": "${msg}",
  "detail": "${detail}",
  "local_archive_count": ${count:-0},
  "local_total_size": "${size}"
}
EOF
}

echo "[mirror ${STAMP}] START — mode=${MODE} src=${SRC}"

if [ ! -d "${SRC}" ] || [ -z "$(ls -A "${SRC}" 2>/dev/null | grep -v '^\.' )" ]; then
  echo "[mirror ${STAMP}] nothing to mirror — ${SRC} has no archives"
  write_status "false" "no archives to mirror" ""
  exit 0
fi

case "${MODE}" in
  none|"")
    cat >&2 <<EOF
[mirror ${STAMP}] BACKUP_MIRROR_MODE not set. Patient-data backups exist
ONLY on local disk at ${SRC}. This is fine for development but is a single
point of failure in production.

Set BACKUP_MIRROR_MODE=s3 (or rclone / rsync) in /app/backend/.env plus the
corresponding credentials. See the comment header of this script for the
exact variable names.
EOF
    write_status "false" "BACKUP_MIRROR_MODE not configured" "Set the env var to s3, rclone or rsync to enable off-host mirroring."
    exit 0
    ;;

  s3)
    if [ -z "${S3_BUCKET:-}" ]; then
      echo "[mirror ${STAMP}] s3 mode: S3_BUCKET is required" >&2
      write_status "false" "missing S3_BUCKET env" ""
      exit 1
    fi
    if ! command -v aws >/dev/null 2>&1; then
      echo "[mirror ${STAMP}] aws CLI not installed. Run: apt-get install -y awscli (or pip install awscli)" >&2
      write_status "false" "aws CLI not installed" "Install with: pip install awscli"
      exit 1
    fi
    : "${AWS_DEFAULT_REGION:=ap-south-1}"
    : "${S3_STORAGE_CLASS:=STANDARD_IA}"
    export AWS_DEFAULT_REGION
    echo "[mirror ${STAMP}] aws s3 sync ${SRC}/ → ${S3_BUCKET}"
    if aws s3 sync "${SRC}/" "${S3_BUCKET%/}/" \
         --storage-class "${S3_STORAGE_CLASS}" \
         --exclude ".*" \
         --only-show-errors 2>&1; then
      echo "[mirror ${STAMP}] OK"
      write_status "true" "s3 sync ok" "${S3_BUCKET}"
      exit 0
    else
      rc=$?
      echo "[mirror ${STAMP}] s3 sync FAILED (exit ${rc})" >&2
      write_status "false" "s3 sync failed (exit ${rc})" "${S3_BUCKET}"
      exit ${rc}
    fi
    ;;

  rclone)
    if [ -z "${RCLONE_REMOTE:-}" ]; then
      echo "[mirror ${STAMP}] rclone mode: RCLONE_REMOTE is required" >&2
      write_status "false" "missing RCLONE_REMOTE env" ""
      exit 1
    fi
    if ! command -v rclone >/dev/null 2>&1; then
      echo "[mirror ${STAMP}] rclone not installed. Run: curl https://rclone.org/install.sh | sudo bash" >&2
      write_status "false" "rclone not installed" "curl https://rclone.org/install.sh | sudo bash"
      exit 1
    fi
    extra=()
    [ -n "${RCLONE_CONFIG:-}" ] && extra+=("--config" "${RCLONE_CONFIG}")
    echo "[mirror ${STAMP}] rclone copy ${SRC}/ → ${RCLONE_REMOTE}"
    if rclone copy "${SRC}/" "${RCLONE_REMOTE}" \
         "${extra[@]}" \
         --include "consulturo-*.tar.gz" \
         --min-age 1m \
         --stats=0 \
         --no-traverse 2>&1; then
      echo "[mirror ${STAMP}] OK"
      write_status "true" "rclone copy ok" "${RCLONE_REMOTE}"
      exit 0
    else
      rc=$?
      echo "[mirror ${STAMP}] rclone copy FAILED (exit ${rc})" >&2
      write_status "false" "rclone copy failed (exit ${rc})" "${RCLONE_REMOTE}"
      exit ${rc}
    fi
    ;;

  rsync)
    if [ -z "${RSYNC_DEST:-}" ]; then
      echo "[mirror ${STAMP}] rsync mode: RSYNC_DEST is required" >&2
      write_status "false" "missing RSYNC_DEST env" ""
      exit 1
    fi
    if ! command -v rsync >/dev/null 2>&1; then
      echo "[mirror ${STAMP}] rsync not installed. Run: apt-get install -y rsync openssh-client" >&2
      write_status "false" "rsync not installed" ""
      exit 1
    fi
    ssh_cmd="ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
    [ -n "${RSYNC_SSH_KEY:-}" ] && ssh_cmd="${ssh_cmd} -i ${RSYNC_SSH_KEY}"
    echo "[mirror ${STAMP}] rsync ${SRC}/ → ${RSYNC_DEST}"
    if rsync -avz --delete-after \
         --include "consulturo-*.tar.gz" \
         --exclude ".*" \
         -e "${ssh_cmd}" \
         "${SRC}/" "${RSYNC_DEST%/}/" 2>&1; then
      echo "[mirror ${STAMP}] OK"
      write_status "true" "rsync ok" "${RSYNC_DEST}"
      exit 0
    else
      rc=$?
      echo "[mirror ${STAMP}] rsync FAILED (exit ${rc})" >&2
      write_status "false" "rsync failed (exit ${rc})" "${RSYNC_DEST}"
      exit ${rc}
    fi
    ;;

  *)
    echo "[mirror ${STAMP}] Unknown BACKUP_MIRROR_MODE=${MODE} (expected: none|s3|rclone|rsync)" >&2
    write_status "false" "unknown mode '${MODE}'" "expected: none|s3|rclone|rsync"
    exit 2
    ;;
esac
