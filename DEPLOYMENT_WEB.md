# ConsultUro Web App — Deployment Guide

Same React Native/Expo codebase deploys as:
- 📱 **Android APK** via EAS (`eas build`)
- 🌐 **Web app** via Vercel (this guide)

Both call the same backend at `https://urology-pro.emergent.host/api/*`.

---

## Step 1 — Push code to GitHub (one-time)

If you haven't already linked the project to GitHub:

```bash
cd /path/to/consulturo
git init  # if not already a repo
git add .
git commit -m "Add web export config"
gh repo create consulturo --private --source=. --push
# OR push to existing repo
git remote add origin https://github.com/YOUR-USER/consulturo.git
git push -u origin main
```

---

## Step 2 — Connect Vercel to GitHub

1. Go to **https://vercel.com/new**
2. Click **"Import Git Repository"** → select `consulturo`
3. **Framework Preset:** Other (or leave as detected)
4. **Root Directory:** `frontend`  ⚠️ IMPORTANT (the Expo project root)
5. **Build Command:** *(auto-filled from vercel.json)* — `yarn install --frozen-lockfile && npx expo export -p web --output-dir dist`
6. **Output Directory:** `dist`
7. **Environment Variables:** click "Add"
   - Name: `EXPO_PUBLIC_BACKEND_URL`
   - Value: `https://urology-pro.emergent.host`
   - Apply to: Production + Preview + Development
8. Click **Deploy**

First build takes ~3 min. You'll get a URL like `consulturo-xyz.vercel.app`.

---

## Step 3 — Test on the Vercel preview URL

Open `https://consulturo-xyz.vercel.app` → app should load → sign in works → API calls succeed.

If anything fails, check browser DevTools console for errors.

---

## Step 4 — Connect custom domain `consulturo.com`

### 4.1 In Vercel
1. Go to **Project Settings → Domains**
2. Add domain: `consulturo.com` and `www.consulturo.com`
3. Vercel will show DNS records to configure (A record + CNAME)

### 4.2 In Squarespace DNS
1. Sign in to Squarespace → Settings → Domains → `consulturo.com` → DNS Settings
2. Add records as shown by Vercel:
   - **A record:** `@` → `76.76.21.21`
   - **CNAME:** `www` → `cname.vercel-dns.com`
3. Save. DNS propagation: ~5–60 min.
4. Vercel will auto-issue SSL certificate within minutes.

### 4.3 Verify
- Visit `https://consulturo.com` → web app loads with HTTPS lock icon.

---

## Step 5 — Add `consulturo.com` to Firebase Authorized Domains

1. Go to **Firebase Console → Authentication → Settings → Authorized domains**
2. Click **Add domain** → enter `consulturo.com`
3. Repeat for `www.consulturo.com` (optional)
4. Save

This enables Google Sign-In on the web app.

---

## Step 6 — Test the full stack

| Test | Expected |
|---|---|
| Open `https://consulturo.com` | Loads app |
| Tap "Continue with Google" | Opens Google OAuth → returns to app signed in |
| Open Dashboard (as staff) | Loads bookings, prescriptions, etc. |
| Generate a Rx PDF | PDF downloads successfully |
| Open as patient | Patient screens only (role-based) |

---

## Notes

- **Same backend, same data**: any change a doctor makes on web instantly visible on patient's mobile app and vice-versa.
- **Auto-deploy**: each push to `main` branch redeploys both web (Vercel) and triggers no APK rebuild (mobile uses EAS separately).
- **Web-only differences**: native camera → falls back to `<input type=file>`; no native push (use email/in-app); rest works.

