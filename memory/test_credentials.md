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

## Dashboard access policy
- All owner-tier roles (`super_owner`, `primary_owner`, `partner`, legacy `owner`) get **FULL dashboard access by default**.
- `super_owner` can LIMIT a specific `primary_owner` via `PATCH /api/admin/primary-owners/{user_id}/dashboard-perm` body `{dashboard_full_access: bool}`.
  - When set to `false`, the primary_owner loses administrative tabs (Analytics, Team, Backups, Broadcasts) but retains core clinical tabs (Today, Bookings, Consults, Rx, Surgeries, Availability).
  - Super_owner cannot be limited — flag is forced true.
- The OwnersPanel UI exposes per-row toggles for both **Dashboard** and **Blog** (super_owner only).
- `/api/me/tier` returns `dashboard_full_access` reflecting the effective value (default-true unless explicitly revoked).

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

## Multi-tenant (Phase A-E, 2026-06-15)
- Default clinic: `clinic_a97b903f2fb2` (slug=`dr-joshi-uro`, "Dr Joshi's Uro Clinic")
- Public landing URL: `/c/dr-joshi-uro` (anonymous access)
- All 17 prescriptions / 78 bookings / 401 surgeries / 62 patients backfilled with this clinic_id
- 4 active memberships (primary_owner sagar.joshi133 + 3 doctors/staff)
- To test tenant scoping: pass `X-Clinic-Id: clinic_a97b903f2fb2` header alongside `Authorization: Bearer <TOKEN>`
- Endpoints scoped (Phase E): `/api/bookings/all`, `/api/prescriptions`, `/api/surgeries`. Wrong clinic_id → 403.
- Invitation flow: `POST /api/clinics/<clinic_id>/invitations` body `{email,role,note?}` → returns `{token, accept_url}`. Public preview: `GET /api/invitations/<token>`. Accept (auth): `POST /api/invitations/<token>/accept`.
- Frontend: TenantSwitcher pill in dashboard hero. /c/<slug> public landing. /invite/<token> accept page.

## Migration
- Run idempotent migration: `cd /app/backend && python -m migrations.001_multi_tenant`
- Container resets occasionally lose pymongo from venv — fix: `pip install -r /app/backend/requirements.txt` then restart backend.
