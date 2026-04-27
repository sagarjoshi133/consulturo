# ConsultUro — Product Requirements (v1.1)

## Overview
ConsultUro is a professional Expo (React Native) mobile app for **Dr. Sagar Joshi**, Consultant Urologist, Laparoscopic & Transplant Surgeon in Vadodara, Gujarat. Dual-sided: patient-facing (booking, education, calculators) + staff-facing (dashboard, prescriptions, team management).

## Tech Stack
- **Frontend**: Expo SDK 54, Expo Router, RN 0.81, Manrope + DM Sans, @expo/vector-icons, expo-linear-gradient, expo-print + expo-sharing (PDF), expo-web-browser (OAuth), react-native-web (for the preview URL).
- **Backend**: FastAPI + Motor (async MongoDB). Port 8001, all routes under `/api`.
- **DB**: MongoDB (local in-pod).
- **Auth**: Emergent-managed Google Social Login. Owner email = `sagar.joshi133@gmail.com` auto-elevated to `role=owner`.

## Roles
`owner > doctor > assistant > reception > nursing > patient` — configurable invites by owner.

## Screens
- `/login`, `/auth-callback` — Google OAuth.
- `/(tabs)/{index,diseases,book,tools,more}` — bottom-tab nav; "Book" is the elevated central FAB.
- `/disease/[id]` — condition detail (overview, symptoms, causes, treatments, when-to-see).
- `/about` — doctor bio, qualifications, services, clinics, availability, contact.
- `/ipss`, `/calculators/{psa,egfr,bmi}` — calculators; IPSS saved with history per user.
- `/blog` + `/blog/[id]` — **live Blogger feed** from www.drsagarjoshi.com (23 posts, 15-min cache).
- `/videos` — YouTube Data API v3 fetch of Dr. Sagar Joshi's channel uploads.
- `/education` + `/education/[id]` — step-by-step patient guides.
- `/my-bookings` — signed-in user's bookings.
- `/prescriptions` + `/prescriptions/new` — doctor/owner: PDF generator (letterhead) stored per patient.
- `/dashboard` — **Doctor Dashboard** (Bookings, Prescriptions, Team tabs), staff-only.

## Backend endpoints
- Public: `/api/{health,doctor,diseases,diseases/{id},blog,blog/{id},videos,education,education/{id},calculators}`.
- Auth: `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`.
- Bookings: `POST /api/bookings` (guest OK; fires Telegram alert), `GET /api/bookings/me` (auth), `GET /api/bookings/all` (staff), `PATCH /api/bookings/{id}` (staff).
- IPSS: `POST /api/ipss`, `GET /api/ipss/history` (auth).
- Prescriptions: `POST /api/prescriptions`, `GET /api/prescriptions`, `GET /api/prescriptions/{id}` (doctor/owner).
- Team: `POST /api/team/invites`, `GET /api/team`, `DELETE /api/team/{email}` (owner).

## Notifications
- **Telegram bot @consultanturoBot** → instant HTML-formatted booking alerts to owner chat_id `532551507`. One-time setup: owner must tap **Start** on https://t.me/consultanturoBot.

## Smart business enhancement
- **Telegram push** converts every patient booking into a real-time lead notification on the doctor's phone — zero extra cost, zero friction.
- Dashboard **"Mark Done / Cancel"** per booking creates an organic clinical workflow inside the same app.

## Next Action Items
- Dr. Sagar Joshi should tap **Start** on @consultanturoBot to activate Telegram pings.
- Future: admin-side blog composer to publish posts straight to Blogger via API (optional — right now the blog is read-only from your existing website).
