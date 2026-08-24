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
- OWNER (sagar.joshi133@gmail.com) — role=`primary_owner` — `test_session_1781800271528`
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

## Session 5.7 test seeds
- PATIENT (patient.test@example.com / phone +919999999999): `test_patient_1780260633308` (STALE — expired)
- PATIENT (pytest.patient@example.com): `test_patient_session_1781495818622` (fresh, 7-day expiry)
- OWNER  (sagar.joshi133@gmail.com):                        `test_owner_1780260851153`
- Sample booking: `bk_test_1780261991155` (confirmed, in-person 2026-06-15 11:30)

## Wave 1 (Search/Timeline/Rx Templates/Allergies/Labs) test seed
- OWNER (sagar.joshi133@gmail.com, role=primary_owner): `test_session_1781792149794` (fresh, 7-day TTL — 2026-06-25)

## Wave 1 patch (role-aware search) — patient seed
- PATIENT (wave2.patient@example.com, role=patient, phone=+918888888888): `test_pat_w2_1781793521021` (fresh, 7-day TTL)
- Own seeded booking (reason="BPH followup") and Rx (diagnosis="BPH") tied to +918888888888.
- Honeypot patient `OtherSecret PatientZZZ` (+917777777777) inserted to verify patient search does NOT leak across patients.

## Refreshed test sessions (2026-06 Phase A)
- OWNER (primary_owner, sagar.joshi133@gmail.com): Bearer `test_session_1781800271528` (also `test_session_1781009714553`), refreshed +2 days on Phase A session. Mint new via db.user_sessions insert if expired.

## Long-lived seeded test sessions (Jun 2026 — re-seeded after sessions TTL purge)
Insert-pattern if purged again: upsert into `user_sessions` {session_token, user_id, expires_at: +365d}.
- `test_session_1781009714553` → user_4775ed40276e (primary_owner, sagar.joshi133@gmail.com)
- `test_session_1781792149794` → user_4775ed40276e (primary_owner)
- `test_session_1781800271528` → user_4775ed40276e (primary_owner)
- `_FUheqDsTzh8q1HO0t7vfrmYaUcBiM1hxK0VffuyZXM` → user_4775ed40276e (primary_owner)
- `patient_token_1776494002311` / `pat_session_1781803137372` / `test_patient_session_1781495818622` → test-patient-1776494002311 (patient)
- `sagar_p_session_1781806225518` → user_9a7a0666e873 (patient Sagar P)
- `doctor_token_1776494002376` → user_5712cb329052 (doctor)
- `test_demo_session_1781794755284` → demo-prim-1781794755284 (is_demo primary_owner)
NOTE: backend now has a 30s in-process auth cache (services/auth_cache.py) — after direct DB
session inserts the token works immediately (cache is lookup-through), but after direct DB
session DELETES allow ≤30s or restart backend.
