# Google Drive Backup — OAuth Client Setup (5-min guide)

This guide creates the Google Cloud OAuth credential the ConsultUro
in-app wizard needs. You only do this once per clinic. After that,
authorising Google Drive is a one-tap flow.

> **Why this is needed:** Google retired the old "paste-token"
> pattern. Every app that touches Drive must use its own OAuth client.
> The free tier is unlimited for our use-case (a few archive uploads
> per day).

---

## Step 1 — Create / pick a Google Cloud project

1. Open <https://console.cloud.google.com/>.
2. Sign in with the **clinic-owned Google account** (not a personal
   one — easier to hand over later).
3. Top-bar dropdown → **New Project**.
   - **Project name:** `ConsultUro Backups`
   - **Location:** No organization (or your Workspace org if any).
4. Tap **Create**, wait ~10 seconds, then make sure the new project
   is selected in the top bar.

---

## Step 2 — Enable the Drive API

1. Side-nav → **APIs & Services → Library**.
2. Search box: type `Google Drive API`.
3. Tap the result → **Enable**. Wait until the green "API Enabled"
   chip appears (~5 seconds).

---

## Step 3 — Configure the OAuth consent screen

1. Side-nav → **APIs & Services → OAuth consent screen**.
2. Choose **External** (works for any Gmail account) → **Create**.
3. App information:
   - **App name:** `ConsultUro`
   - **User support email:** the clinic Gmail
   - **App logo:** optional (square, ≥ 120×120 px)
4. Developer contact: clinic Gmail.
5. **Save and continue**.
6. **Scopes** screen → tap **Add or remove scopes** →
   - Filter for `drive` → tick `.../auth/drive`
   - **Update** → **Save and continue**.
7. **Test users** screen → **Add users** → enter the email of every
   person who'll authorise the backup (usually just the clinic owner)
   → **Save and continue**.
8. **Summary** → **Back to Dashboard**.

> The app stays in **Testing** mode — that's fine. Test users (you)
> can authorise without going through Google's verification. Verified
> status is only needed if you publish the app to the world, which
> we don't.

---

## Step 4 — Create the OAuth Client

1. Side-nav → **APIs & Services → Credentials**.
2. Top bar → **+ Create Credentials → OAuth client ID**.
3. **Application type:** `Web application`.
4. **Name:** `ConsultUro Backup Wizard`.
5. **Authorized redirect URIs:** tap **Add URI** and paste the URL
   the wizard shows you. Today it looks like:

   ```
   https://urology-pro.preview.emergentagent.com/api/admin/backup/mirror/oauth/callback
   ```

   > ⚠️ It must match **byte-for-byte** — including `https://` and the
   > full path. Open the wizard, tap the copy icon next to the
   > redirect URI box, and paste straight in.

6. Tap **Create**.

---

## Step 5 — Copy Client ID + Secret into the wizard

Google now shows a popup with two long strings:

```
Your Client ID:     12345-abcdef.apps.googleusercontent.com
Your Client secret: GOCSPX-...
```

1. Tap **Download JSON** for safekeeping (store in your password
   manager).
2. Open ConsultUro → Dashboard → Backups → **Set up Google Drive**.
3. Paste the **Client ID** and **Client Secret** into the wizard
   fields. Tap **Save & continue**.
4. Tap **Authorize Google Drive**. Your browser opens Google's
   consent screen — sign in with the same clinic account, tap **Allow**.
5. Google redirects to a "✓ Google Drive connected" page in your
   browser. Tap **Return to ConsultUro** (or just switch back to the
   app) — the Backups card now says **Mirror: Active**.

You're done. The daily backup will push to `consulturo-backups/` in
the clinic's Drive starting with the very next run.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Google: "redirect_uri_mismatch" | The URI in step 4.5 doesn't match what the wizard shows. Re-copy from the wizard and paste exactly. Order matters — `http` ≠ `https`. |
| "This app is blocked" | You haven't added yourself as a test user (Step 3.7). |
| "invalid_client" in browser | You typed the secret wrong, or it's reversed. Re-do Step 5.3. |
| Token expires after 7 days | Normal for apps in **Testing** mode. To extend, either keep the project in Testing and re-authorise weekly, or publish the app (no verification needed if you only use it yourself — Google waives it). |
| Wizard says "client_id doesn't look like..." | Your client ID must end with `.apps.googleusercontent.com`. If it doesn't, you created a credential of the wrong type — go back and pick **Web application**. |
| Backup screen still red after Authorize | Check `/api/admin/backup/mirror/info` — `configured` should be true. If not, share the response with support; the rclone.conf write might have failed. |

---

## Security checklist

- ☐ Used the clinic-owned Google account, not a personal Gmail.
- ☐ Client Secret saved in the clinic password manager.
- ☐ Test users list includes only people authorised to manage
   backups (default: the owner).
- ☐ Quarterly: review the **OAuth Consent Screen → Permissions** page
   to revoke ex-staff.
- ☐ Annually: rotate the client secret by tapping **Reset Secret** on
   the Credentials page, then re-run the wizard.
