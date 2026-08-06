# Off-host Backup Mirror — Google Drive (rclone) Setup Guide

ConsultUro's daily mongodump archives live in `/app/backups/` inside the backend
container. If the container is ever recycled or the host disk fails, those
archives go with it. This guide pushes a copy to a Google Drive folder you
own so a clinic-side restore is always possible.

Total setup time: ~5 minutes.

---

## Step 1 — rclone is already installed

The backend container ships with `rclone v1.74.2` pre-installed:

```bash
$ rclone version
rclone v1.74.2
```

If you ever see "command not found", run:

```bash
curl -sL https://rclone.org/install.sh | bash
```

---

## Step 2 — Create a Google Drive remote

SSH into the backend host (the same machine `/app/backend/` runs on) and
launch the interactive config wizard:

```bash
rclone config
```

Answer the prompts as follows:

| Prompt                         | Answer                          |
| ------------------------------ | ------------------------------- |
| `n/s/q>`                       | `n` (new remote)                |
| `name>`                        | `gdrive`                        |
| `Storage>`                     | type `drive` and press Enter    |
| `client_id>`                   | leave blank (press Enter)       |
| `client_secret>`               | leave blank (press Enter)       |
| `scope>`                       | `1` (full Drive access)         |
| `service_account_file>`        | leave blank (press Enter)       |
| `Edit advanced config>`        | `n`                             |
| `Use web browser to automatically authenticate?` | `y` if the host has a browser, otherwise `n` |

### If the host has NO browser (the usual case for a server)

Pick `n` at the last prompt and rclone prints a long URL like:

```
rclone authorize "drive" "<token>"
```

* Copy that command, run it on your **laptop** (any computer with a browser
  and a fresh `brew install rclone` / `winget install rclone`).
* Sign in with the **Google account** you want the clinic backups on
  (we recommend a clinic-owned Workspace mailbox, not a personal Gmail).
* The browser shows "Success! All done. Please go back to rclone." and your
  laptop's terminal prints a JSON access token.
* Paste that JSON back into the server's `rclone config` prompt.

Finish the wizard:

| Prompt                       | Answer |
| ---------------------------- | ------ |
| `Configure this as a Shared Drive (Team Drive)?` | `n` unless you actually have one |
| `Keep this "gdrive" remote?` | `y`   |
| `n/s/q>`                     | `q`   |

---

## Step 3 — Test the remote

```bash
rclone lsd gdrive:
rclone mkdir gdrive:consulturo-backups
rclone copy /app/backups gdrive:consulturo-backups --include "consulturo-*.tar.gz" -v
```

You should see the existing `consulturo-YYYY-MM-DD-HHMMSS.tar.gz` files
appear in your Drive under the `consulturo-backups` folder.

---

## Step 4 — Wire it into ConsultUro

Edit `/app/backend/.env` and add these three lines (anywhere):

```ini
BACKUP_MIRROR_MODE=rclone
RCLONE_REMOTE=gdrive:consulturo-backups
RCLONE_FLAGS=--transfers=2 --checkers=4
```

Restart the backend so the new env is picked up:

```bash
sudo supervisorctl restart backend
```

---

## Step 5 — Verify

From the dashboard's **Backups** tab, tap **"Backup now"**. After ~10s
you should see:

* A new local archive in the "Recent local archives" list.
* The **Mirror** card flips green: *Last mirrored at HH:MM:SS, target
  gdrive:consulturo-backups*.

You can also verify from the shell:

```bash
bash /app/scripts/mirror_backups.sh
cat /app/backups/.mirror_status.json
rclone ls gdrive:consulturo-backups | tail
```

---

## How retention works

`mirror_backups.sh` keeps the last **14** archives on Google Drive (a
fortnight at one dump/day). Older archives are deleted from Drive once
they're rotated out locally too, so the Drive folder never grows
unboundedly. Local retention stays at 7 days.

To change retention edit `MIRROR_KEEP_LAST` in `mirror_backups.sh`.

---

## Restoring from a Google Drive backup

(For now this is an SSH-only procedure — UI restore is intentionally
not exposed. Reach out before doing this on a live clinic DB.)

```bash
# 1. Download an archive from Drive
rclone copy gdrive:consulturo-backups/consulturo-2026-06-01-024737.tar.gz /tmp/

# 2. Extract
mkdir -p /tmp/restore && tar -xzf /tmp/consulturo-2026-06-01-024737.tar.gz -C /tmp/restore

# 3. Restore to a SCRATCH database first to sanity-check
mongorestore --uri="mongodb://localhost:27017" \
  --nsFrom='consulturo.*' --nsTo='consulturo_restore_check.*' /tmp/restore

# 4. Once verified, restore to the live DB (THIS IS DESTRUCTIVE)
mongorestore --uri="mongodb://localhost:27017" \
  --drop --nsFrom='consulturo.*' --nsTo='consulturo.*' /tmp/restore
```

---

## Troubleshooting

| Symptom                                            | Fix                                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `mirror_backups.sh` says `RCLONE_REMOTE missing`   | Make sure `BACKUP_MIRROR_MODE=rclone` AND `RCLONE_REMOTE=...` are both set.  |
| `rclone: command not found`                        | Re-run the install script in Step 1.                                         |
| `failed to load token`                             | The token expired or was revoked — re-run `rclone config reconnect gdrive:`. |
| Upload hangs                                       | Add `RCLONE_FLAGS=--bwlimit 5M` to throttle on slow links.                   |
| Mirror status still says `none` after restart      | Confirm the env line by `grep BACKUP /app/backend/.env`, then restart again. |

---

## Security notes

* The OAuth token in `~/.config/rclone/rclone.conf` grants Drive access — keep that file root-readable only (`chmod 600`).
* Use a clinic-owned Google Workspace account, not a doctor's personal Gmail. Patient data ⇒ keep ownership institutional.
* Drive backups are AES-256 encrypted at rest by Google. For an extra layer add `--crypt` to rclone (see `rclone crypt`).
