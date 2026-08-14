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

## Major modules added since v1.1 (high level)
- 4-tier roles (`super_owner > primary_owner > partner > staff > patient`), multi-tenant clinics (`/c/[slug]`, X-Clinic-Id scoping), demo/read-only mode.
- IPD module (`/ipd`, beds, admissions, rounds, vitals, meds, consents, bed transfers, discharge summaries with AI field generation via Emergent LLM claude-sonnet-4-5).
- Surgical consents (`/consents/*`) + OT calendar (`/ot-calendar/*`) with multi-procedure `procedure_keys` arrays.
- Medical certificates, billing, discharge summaries, drug repository, notes/reminders, broadcasts with approval flow, personal messaging/inbox.
- Push notifications via **Emergent Push Relay** (`/api/register-push` native FCM tokens → relay; `EMERGENT_PUSH_KEY` auto-injected at deployment; placeholder in preview).
- Video consultations (100ms), Razorpay (test mode), OTA updates (expo-updates), Sentry, dark mode, EN/HI/GU i18n.

## Changelog — 2026-06-11 (bug-fix session)
1. **"App crashes" from Patients / My Records / Dashboard — FIXED.** Root cause: `src/ota-updates.ts` called `Updates.reloadAsync()` ~1.5s after cold start whenever an EAS update was advertised → silent mid-session restart back to "/" (perceived as crash). Now updates download silently and apply on the NEXT cold launch.
2. **Diseases tab + Home "See all" — FIXED.** `PatientDiseases` referenced `__darkBg` without defining it → ReferenceError crash for patient role. Hook added. Verified on web.
3. **"Send test push" — FIXED.** `/api/push/test` now routes through the Emergent relay (send by user_id) when `EMERGENT_PUSH_KEY` is configured (production); falls back to legacy Expo-direct in preview with an explanatory message. `/api/push/diagnostics` now surfaces native `device_token` rows (`transport` + `token_preview`). Broadcast "awaiting approval" approver push also routed via relay.
4. **Safe Area — FIXED.** Full-screen modals now respect notch + Android nav buttons: IPD admit modal, beds editor, AdmissionDetail (hero paddingTop + content paddingBottom + floating actions offset), discharge drug picker, bed-transfer sheet, broadcast compose. Tab bar conditional-hooks violation fixed in `(tabs)/_layout.tsx`.
5. **Splash flicker — FIXED.** Installed `expo-splash-screen@31.0.13` + plugin config (imageWidth 200, teal bg) in app.json; `preventAutoHideAsync` + fade hide once fonts load in `_layout.tsx`. Combined with fix #1, no more post-login splash flash. (Needs a new APK build to take effect natively.)
6. Misc: `my-records.tsx` unsafe `format(new Date(...))` (Hermes crash vector) → safe `displayDate()`; removed duplicate style keys.
- Testing: backend pytest 8/8 (`/app/backend/tests/test_session_6_push_broadcasts.py`), frontend flows verified by testing agent (`/app/test_reports/iteration_4.json`).

## Changelog — 2026-06-11 (app icon & splash assets)
- Rebuilt all icon assets via `/app/frontend/scripts/rebuild_icons.py` (originals in `/app/frontend/assets-backup/`):
  - `icon.png`: removed baked-in white margin/rounded corners → full-bleed tile (iOS/launchers apply their own mask; no more white border).
  - `adaptive-icon.png`: now artwork-only (kidneys/cross) on transparency, scaled to fit fully inside the 66dp adaptive safe zone (0 px outside — verified programmatically; no corner/side cutting on any mask shape).
  - `adaptive-bg.png` (NEW): full-bleed gradient matching the tile background; wired as `android.adaptiveIcon.backgroundImage` (+ fallback `backgroundColor #44849F`) → icon looks completely filled, no border ring.
  - `splash-icon.png`: now the actual app icon with iOS-style rounded corners on transparency → splash literally shows the app icon (user request).
- Visual verification via mask-simulation montage + analyzer: no artwork cut, no rings/seams. Requires a NEW APK build to appear on devices.

## Changelog — 2026-06 (ConsultUro 2.0 — Phase A: Notification Incident Recovery) ✅
Per the ConsultUro 2.0 Blueprint (Phases A–H), Phase A completed:
1. **Typed non-2xx push registration errors** — `/api/register-push` now returns 503 `{error_code:'relay_not_configured', mirrored:true}` when EMERGENT_PUSH_KEY is placeholder, 502 `relay_unauthorized`/`relay_upstream_error` on relay failures, 400 `invalid_token`. Token is ALWAYS mirrored locally for post-deploy resync.
2. **Client error surfacing** — `src/push.ts` parses typed error codes (new reasons `relay_not_configured`, `relay_upstream_error`); Notifications Health panel shows honest "Deploy required" chip instead of false "Registered ✓". relay_not_configured is not retried and not sent to Sentry.
3. **`installation_id`** — stable per-install UUID (AsyncStorage) sent with registration; backend upserts by (user_id, installation_id) → FCM token rotation no longer duplicates push_tokens rows.
4. **Capability-based broadcast authorization** — legacy `role=="owner"` string checks replaced with `_is_broadcast_approver` (OWNER_TIER_ROLES ∪ can_approve_broadcasts). Fixes primary_owner being locked out of broadcast create-approve/review/delete after the 4-tier role migration.
5. **Unified inbox** — bell feed (NotificationProvider) now reads `GET /api/inbox/all` (notifications + broadcast_inbox + push log merged, super_owner kind-filter mirrored); mark-all uses `/api/inbox/all/read`; `/api/notifications/{id}/read` falls back to broadcast_inbox rows.
6. **DB cleanup** — purged 2 demo `@example.com` doctor accounts (doc-test-…, TEST_doc_…); only the real Dr. Joshi doctor account remains in the practitioner directory.
- Testing: pytest 9/9 `tests/test_phase_a_notifications.py` + 6/6 `tests/test_phase_a_extended.py` (testing agent) + 38-pass legacy push suite updated; frontend /notifications verified (report `/app/test_reports/iteration_20.json`).

## Changelog — 2026-06 (ConsultUro 2.0 — Phase B: Notification V2 foundations) ✅
Mongo-first, non-breaking (dual-write; reads stay on legacy until Phase C):
1. **`device_installations` registry** — canonical device rows keyed by unique (user_id, installation_id); dual-written on `/api/register-push` (legacy clients get synthetic `legacy:<token-prefix>` key). Startup backfill from push_tokens (5 rows migrated).
2. **`notification_inbox`** — canonical inbox collection dual-written by `create_notification` (same `id` as legacy row, `source_type:"notification"`). Backfilled last-60-days notifications (101 rows).
3. **Notification outbox + worker** — `services/notification_outbox.py`: `send_push_reliable()` queues failed relay sends into `notification_outbox`; background worker drains every 60 s (wake-on-enqueue), backoff 30s→2m→10m→30m→60m, max 5 attempts → dead-letter, 6 h TTL → expired. No-op claiming while EMERGENT_PUSH_KEY is placeholder (expiry sweep still runs). `push_to_user`/`push_to_owner` now route through it.
4. **`GET /api/push/health-panel`** — single-call pipeline snapshot (relay state, caller installations, outbox stats, inbox v2 counts, 24 h send aggregates, last resync, dead-letters for owner-tier, next_step guidance). Plus owner-gated `POST /api/push/outbox/flush` + `GET /api/push/outbox`.
5. **Migration shim** — `migrations/notification_v2.py` runs at boot: idempotent indexes + one-time backfill recorded in `schema_migrations` (`002_notification_v2_backfill`).
6. **Frontend** — Notifications Health panel gained a "Delivery pipeline" card (testID `push-v2-pipeline`): Relay LIVE / Deploy-required chip, Devices/Queued/Sent-24h/Dead-24h stats, next_step hint. Legacy sections unchanged.
- Testing: pytest 11/11 `tests/test_phase_b_notification_v2.py`; frontend + regression verified by testing agent (`/app/test_reports/iteration_21.json`).

## ConsultUro 2.0 roadmap status
- Phase A (notification recovery): ✅ DONE
- Phase B (Notification V2: device_installations, notification_inbox, outbox worker w/ retry, /api/push/health-panel — Mongo-first): ✅ DONE
- Phase C (PostgreSQL platform foundation, object storage, capability auth): NEXT — defer until A+B ratified on-device post-deploy.
- Phase D–H (patient registry, clinical core, surgery/IPD/finance, AI+n8n, legacy archive): pending, strict order.

## Next Action Items
- **User: Publish + rebuild APK** so OTA/splash/safe-area/push fixes reach devices (splash & safe-area are native-level).
- Verify push end-to-end on a real device after deployment (relay key auto-injected at deploy).
- P2 backlog: Google Drive backup OAuth (blocked on user credentials — see `/app/scripts/GDRIVE_OAUTH_GUIDE.md`); surgery scheduler bulk CSV import rewrite (better error UI).
- Dr. Sagar Joshi should tap **Start** on @consultanturoBot to activate Telegram pings (if not done).
