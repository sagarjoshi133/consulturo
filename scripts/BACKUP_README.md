# ConsultUro — Backup Operations Runbook

## What gets backed up
The daily script `scripts/backup_mongo.sh` runs `mongodump` against the
`consulturo` database and stores a gzip tarball under `/app/backups/`.

File naming: `consulturo-YYYY-MM-DD-HHMMSS.tar.gz`

Retention: most recent **14** backups are kept; older ones are auto-deleted
every run.

## Manual run (immediate backup)
```bash
bash /app/scripts/backup_mongo.sh
```
An example run logs:
```
[backup] 2026-04-22-031500 — starting mongodump (db=consulturo)
[backup] archiving → /app/backups/consulturo-2026-04-22-031500.tar.gz
[backup] done — /app/backups/consulturo-2026-04-22-031500.tar.gz (12M)
```

## Scheduling — daily 03:15 via cron
On the host running MongoDB (same container as backend), add this cron line
(as root):
```cron
15 3 * * * /app/scripts/backup_mongo.sh >> /var/log/consulturo-backup.log 2>&1
```
If cron is not available (Kubernetes/supervisor environment without
crond), use supervisor instead — sample stanza `/etc/supervisor/conf.d/
consulturo-backup.conf`:
```ini
[program:consulturo-backup]
command=/bin/bash -c 'while true; do sleep $((3600*24)); /app/scripts/backup_mongo.sh; done'
autostart=true
autorestart=true
stdout_logfile=/var/log/consulturo-backup.out
stderr_logfile=/var/log/consulturo-backup.err
```
(A minimal “sleep 24h then run” loop. Not a real scheduler but works fine
where cron isn’t installed.)

## Restore
```bash
cd /tmp && mkdir restore && tar -xzf /app/backups/consulturo-<STAMP>.tar.gz -C restore
mongorestore --drop --uri="mongodb://localhost:27017" restore/
```
> ⚠️ `--drop` wipes the current database. Be sure before you run it.

## Off-host copy (recommended before launch)
Local disk alone is a SPOF. Use `/app/scripts/mirror_backups.sh` — fully
**env-driven**, no script editing required. Set `BACKUP_MIRROR_MODE` in
`/app/backend/.env` to one of:

### Option A — AWS S3 (cheap, durable)
```bash
# In /app/backend/.env
BACKUP_MIRROR_MODE=s3
S3_BUCKET=s3://my-bucket/consulturo-backups
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=ap-south-1
S3_STORAGE_CLASS=STANDARD_IA   # optional; STANDARD_IA = ~half cost
```
Install once: `pip install awscli` (or `apt-get install -y awscli`).

### Option B — Google Drive / Dropbox / B2 via rclone
```bash
# Install
curl https://rclone.org/install.sh | sudo bash
rclone config        # configure a remote called e.g. "gdrive"

# In /app/backend/.env
BACKUP_MIRROR_MODE=rclone
RCLONE_REMOTE=gdrive:consulturo-backups
RCLONE_CONFIG=/root/.config/rclone/rclone.conf   # optional
```

### Option C — rsync over SSH to a remote Linux host
```bash
apt-get install -y rsync openssh-client
ssh-keygen -t ed25519 -f /root/.ssh/consulturo_mirror
# add the .pub to remote-host's authorized_keys

# In /app/backend/.env
BACKUP_MIRROR_MODE=rsync
RSYNC_DEST=user@host.example.com:/srv/consulturo-backups
RSYNC_SSH_KEY=/root/.ssh/consulturo_mirror
```

The mirror runs **automatically right after every nightly mongodump** (chained
inside `backup_mongo.sh`) — no separate cron / supervisor entry needed.

### Verify
```bash
bash /app/scripts/mirror_backups.sh             # run on demand
cat /app/backups/.mirror_status.json            # last-run status JSON
curl -H "Authorization: Bearer <OWNER_TOKEN>" \
     http://localhost:8001/api/admin/backup/status   # owner-only HTTP view
```

If `BACKUP_MIRROR_MODE` is unset, the script logs a reminder and exits 0 — safe no-op.

## Quick health-check
```bash
ls -lh /app/backups/ | tail -5
```
If no file within the last 48 hours → investigate `/var/log/consulturo-
backup.log`.
