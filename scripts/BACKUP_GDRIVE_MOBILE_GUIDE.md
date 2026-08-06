# Off-host Backup Mirror — Google Drive (rclone) from your Phone

A laptop-free, fully-mobile setup path. You'll need: your Android
phone (or iPhone + Mac), your Google account credentials, and ~10
minutes.

> **iPhone users:** Apple sandboxing makes the SSH-from-phone path
> awkward. We strongly suggest doing this once from a laptop using
> `BACKUP_GDRIVE_GUIDE.md`. If you really must do it from iOS, jump
> to "Path C — iPhone via web SSH" at the bottom.

The job in plain English:

1. Authorize Google Drive in a phone browser (5 seconds).
2. Copy the resulting token text once.
3. Paste it into a server config form in the ConsultUro app.
4. Tap "Backup now".

The hard part used to be reaching the server shell. The new
**Settings → Backups → Set up Google Drive mirror** flow takes care
of the shell step for you — no SSH client, no Termux required.

---

## Path A — Easiest: in-app setup wizard (Android & iOS)

> Requires the next backend release (≥ 5.13). If your installed APK
> doesn't show the "Set up Google Drive" button on the Backups tab,
> use Path B instead.

### Step 1 — Open the wizard

1. Sign in as the clinic owner.
2. Tap **More → Backups**.
3. In the **Off-host mirror** card, tap **"Set up Google Drive"**.

### Step 2 — Grant access in your phone's browser

The app opens this URL in your default browser:
```
https://rclone.org/authorize/?type=drive&scope=drive
```
(opens automatically — no need to copy anything yet)

1. Sign in to the Google account you want for clinic backups.
   We strongly recommend a clinic-owned account, e.g.
   `admin@drsagarjoshi.com`, **not** a personal Gmail.
2. Tap **Allow** when Google asks rclone to access your Drive.
3. The page shows: "Success! All done. Please go back to rclone."
4. Tap **"Copy authorization code"** at the bottom of the page.

### Step 3 — Paste the code into the app

1. Return to the ConsultUro app — the wizard is still on screen.
2. Long-press the **"Authorization JSON"** field → **Paste**.
3. Tap **"Connect Drive"**.

The app POSTs the token to `/api/admin/backup/mirror/connect`
which:
- Writes `~/.config/rclone/rclone.conf` with the `gdrive:` remote.
- Sets `BACKUP_MIRROR_MODE=rclone` and
  `RCLONE_REMOTE=gdrive:consulturo-backups` in `.env`.
- Restarts the backend.

You'll see the green **Mirror: Active** chip appear within ~5
seconds.

### Step 4 — First backup

Tap **"Backup now"**. The Mirror card flips to:

> Last mirrored 31 May, 22:47 — gdrive:consulturo-backups (4 files)

You're done. Daily cron handles everything from here.

---

## Path B — Android Termux (older builds without the wizard)

Use this if your current APK still says "BACKUP_MIRROR_MODE not
configured" with no "Set up" button.

### Step 1 — Install Termux

* Play Store can be flaky for Termux — install **F-Droid** then
  install Termux from there:
  [f-droid.org → Termux](https://f-droid.org/en/packages/com.termux/).
  Open it once.

### Step 2 — SSH to your backend

Inside Termux:

```bash
pkg install -y openssh
ssh root@<your-backend-host>
```

> If you've never SSH'd into this box from a phone, the simplest
> path is to **add the host to Tailscale**:
> 1. Install Tailscale on your phone (Play Store) and on the
>    backend host.
> 2. Sign in to the same Tailnet on both.
> 3. SSH using the Tailnet name:
>    `ssh root@consulturo-prod.tail-yourcat.ts.net`.

### Step 3 — Run rclone config

```bash
rclone config
```

| Prompt | Answer |
|---|---|
| `n/s/q>` | `n` |
| `name>` | `gdrive` |
| `Storage>` | `drive` |
| `client_id>` | leave blank (Enter) |
| `client_secret>` | leave blank |
| `scope>` | `1` (full Drive) |
| `service_account_file>` | leave blank |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `n` (we have no GUI) |

rclone now prints something like:
```
Execute the following on the machine with the web browser
  (same rclone version recommended):
   rclone authorize "drive" "<some-state>"
```

### Step 4 — Authorize on your phone's browser

* Open Chrome / Safari on the **phone** itself (not Termux).
* Visit:
  ```
  https://rclone.org/authorize/?type=drive&scope=drive
  ```
* Sign in to the clinic Google account → tap **Allow**.
* Copy the JSON token text the page shows.

### Step 5 — Paste back into Termux

Long-press the Termux input area → **Paste**. Hit Enter.

Finish the wizard:

| Prompt | Answer |
|---|---|
| `Configure this as a Shared Drive?` | `n` |
| `Keep this "gdrive" remote?` | `y` |
| `n/s/q>` | `q` |

### Step 6 — Test from your phone

```bash
rclone mkdir gdrive:consulturo-backups
rclone copy /app/backups gdrive:consulturo-backups \
  --include "consulturo-*.tar.gz" -v
```

You should see archives appear in your Drive within a few seconds.

### Step 7 — Wire env vars

```bash
cat >> /app/backend/.env <<'EOF'

# Off-host backup mirror (Google Drive)
BACKUP_MIRROR_MODE=rclone
RCLONE_REMOTE=gdrive:consulturo-backups
RCLONE_FLAGS=--transfers=2 --checkers=4
EOF

sudo supervisorctl restart backend
```

Switch back to the app — Backups tab → "Backup now" → Mirror flips
green.

---

## Path C — iPhone via web SSH

iOS doesn't have a free Termux equivalent. Easiest:

1. Install **Termius** ([App Store](https://termius.com/ios)) —
   free for occasional use.
2. Add a Host entry for your backend (Tailscale name strongly
   recommended).
3. Connect → tap the keyboard → follow **Path B Step 3 onwards**.

Or hop on a Mac/PC for 10 minutes and use the desktop guide; it's
genuinely faster.

---

## What "active" looks like

Once the mirror is on, the Backups tab shows:

```
Mirror   Last 1 Jun, 02:47 IST
─────────  gdrive:consulturo-backups
Status     ✓ Active (rclone)
Recent     4 files mirrored
```

If anything turns red, tap **"Re-test mirror"** — that runs
`mirror_backups.sh` once and surfaces the rclone exit code.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows "OAuth client deleted" | rclone uses a shared OAuth client by default that occasionally rotates. Re-run rclone config and pick a fresh one — or use your own client_id (see `rclone authorize --help`). |
| "Token has been expired or revoked" 30 days later | The Google account hasn't reused rclone. `rclone config reconnect gdrive:` (same auth flow) → done. |
| Backup uploads slow | Add `--bwlimit 5M` to `RCLONE_FLAGS` if you're throttling clinic Wi-Fi. |
| Mirror status stays "none" after restart | `grep BACKUP /app/backend/.env` — the env must contain BOTH lines. Then `sudo supervisorctl restart backend` again. |

---

## Security checklist

- ☐ Used a **clinic-owned Google Workspace** account, not a doctor's personal Gmail.
- ☐ Confirmed `~/.config/rclone/rclone.conf` is `chmod 600`.
- ☐ Daily cron still runs (see `consulturo-backup` supervisor program).
- ☐ Verified at least one fresh archive appears in Drive within 24 h.
- ☐ Recorded the Drive folder name + Google account in your password manager so you can restore if you lose phone access.
