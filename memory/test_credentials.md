# ConsultUro — Test Credentials & Roles (v1.1)

## Authentication
- **Google Social Login only** (Emergent-managed OAuth). No app-passwords.
- Guest mode still allowed for browsing / booking (without history saving).

## Roles hierarchy (v2 — 4-tier)
`super_owner > primary_owner > partner > {doctor, assistant, reception, nursing} > patient`

| Role | Can do |
|------|--------|
| **super_owner** | Platform admin (`app.consulturo@gmail.com`). Manages primary_owners, audits, demos. SEES PLATFORM DASHBOARD ONLY (no clinical workflows). |
| **primary_owner** | Senior clinic owner. Everything inside the clinic + manage partners. |
| **partner** | Equal admin/clinical powers EXCEPT partner mgmt. |
| **doctor / assistant / reception / nursing** | Dashboard, bookings, role-scoped tools |
| **patient** | Book, IPSS, view blog/videos/education |

## Demo / Read-Only mode
- Any user with `is_demo: true` is hard-blocked from POST/PUT/PATCH/DELETE by a middleware in `server.py` (whitelist: `/api/auth/*`, mark-as-read endpoints, push register).
- Created via `POST /api/admin/demo/create` (super_owner only). Body:
  `{ email, name?, role: "primary_owner"|"patient" (default primary_owner), seed_sample_data: bool (default true) }`.
- For `role: "patient"` with seed=true, a placeholder users row is created plus 1 sample booking + 1 sample prescription + 1 IPSS row tagged `is_demo_seed:true`. Revoke (`DELETE /api/admin/demo/{user_id}`) sweeps those seeded rows.
- 403 response: `{"detail": "Demo mode — actions are disabled in this preview account.", "demo": true}`.

## Blog editorial gate
- `/api/admin/blog` (POST/PUT/DELETE/GET) gated by `require_blog_writer`.
- ONLY `super_owner` is allowed by default.
- Super-owner can grant per primary_owner via `PATCH /api/admin/primary-owners/{user_id}/blog-perm` body `{can_create_blog: bool}`.
- `GET /api/me/tier` exposes `can_create_blog` + `is_demo` so the frontend can hide the Blog tab when not allowed.

## Granular partner-branding toggles
- `PATCH /api/clinic-settings` partner-write gate uses individual flags:
  `partner_can_edit_main_photo`, `partner_can_edit_cover_photo`,
  `partner_can_edit_clinic_info`, `partner_can_edit_socials`,
  `partner_can_edit_about_doctor`, `partner_can_edit_blog`.
- All default true. Legacy `partner_can_edit_branding` is honoured as a fallback when a granular flag is unset.
- Owners always pass through; partners get 403 with detail mentioning the specific granular gate.

## Owner accounts
- **Super Owner:** `app.consulturo@gmail.com` (hardcoded — DO NOT change)
- **Primary Owner (Dr. Sagar Joshi):** `sagar.joshi133@gmail.com`
- Legacy `role: "owner"` was migrated to `primary_owner` on backend startup.

## Inviting team members
Owner goes to **Dashboard → Team → Invite**, enters email + picks a role. When that person signs in with that Google email, they automatically get the assigned role.

## Manual test seed (for testing agent)
```bash
mongosh --eval "
db = db.getSiblingDB('consulturo');
var uid = 'test-own-' + Date.now();
var token = 'test_session_' + Date.now();
db.users.insertOne({user_id: uid, email:'sagar.joshi133@gmail.com', name:'Dr Sagar Joshi', role:'owner', created_at:new Date()});
db.user_sessions.insertOne({user_id: uid, session_token: token, expires_at: new Date(Date.now()+7*24*60*60*1000), created_at: new Date()});
print('TOKEN=' + token);
"
```

## Pre-seeded session tokens (valid 7 days)
- OWNER (sagar.joshi133@gmail.com): `test_session_1776770314741`
- DOCTOR (dr.test@example.com): `test_doc_1776771431524`
Use as `Authorization: Bearer <TOKEN>` header.
Create new tokens by running the seed snippet above if needed.
Then:
```
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8001/api/auth/me
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8001/api/bookings/all
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8001/api/team
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8001/api/records/me
```

## Web testing: inject session into localStorage (for Expo web)
```js
localStorage.setItem('session_token', '<TOKEN>');
```
After setting the token, reload. Works for `/my-records`, `/my-bookings`, `/dashboard`, etc.

## Telegram alerts
- Bot: **@consultanturoBot** (token in `.env`).
- Owner chat_id: `532551507`.
- On new booking the backend posts an HTML-formatted alert to the owner.
- **Setup step for Dr. Sagar Joshi (one-time):** open https://t.me/consultanturoBot on your phone and tap **Start** — until you do, Telegram responds `chat not found` because bots can't DM a user who hasn't initiated contact.
