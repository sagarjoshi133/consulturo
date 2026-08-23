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

## Changelog — 2026-06 (ConsultUro 2.0 — Phase C: Platform foundation) ✅
User-approved scope: NO PostgreSQL swap (managed environment is Mongo-only); repository layer + object storage + capability auth instead:
1. **Repository layer** — `/app/backend/repositories/` (`MongoRepository` base + `files`, `users` repos). All Phase C+ code accesses collections through repositories → future DB engine swap only re-implements this package.
2. **Emergent Object Storage for attachments** — `services/object_storage.py` (init→storage_key handshake, threadpool-wrapped, stale-key 503 retry, 402 quota typed error). New `POST /api/files/upload` (JSON base64, 8 MB cap, path `consulturo/uploads/{uid}/{uuid}.{ext}`, metadata in `file_objects` via repo) + `GET /api/files/{id}` (Bearer OR `?sid=` query auth for web `<img>`; access = uploader ∪ message sender/recipient ∪ broadcast scope). Storage key warmed at startup.
3. **Message attachments migrated** — composer uploads first, sends `{file_id, url}` refs (per-attachment fallback to legacy inline base64 if upload fails); `/api/messages/send` validates refs (must exist + be uploaded by sender) and stores refs instead of base64. Renderers (`attachments.ts`, `/messages/[id]`) support BOTH shapes — old base64 messages still work everywhere, incl. the currently installed APK.
4. **Capability resolver** — `services/capabilities.py`: 11-capability catalog (prescribe, manage_surgeries, manage_availability, approve_broadcasts, approve_bookings, full_dashboard, send_personal_messages, manage_blog, manage_team, manage_partners, platform_admin) with 6 policies. All legacy `require_*` deps in server.py + `_is_broadcast_approver` + `_can_send_personal_messages` now delegate to it (semantics preserved exactly). New `GET /api/me/capabilities` (UI gating) + `GET /api/capabilities/catalog` (owner).
- Testing: pytest 16/16 `tests/test_phase_c_platform.py` (36/36 across A+B+C); frontend E2E + regression by testing agent (`/app/test_reports/iteration_22.json`).

## Changelog — 2026-06 (ConsultUro 2.0 — Phase D: Canonical patient registry) ✅
1. **`patient_id` (UUID) on every patients row** + `phone_digits` index. Startup migration `003_patient_registry`: backfilled all patients, auto-created registry rows for orphan activity phones, stamped `patient_id` onto ALL bookings/prescriptions/surgeries/receipts (indexed).
2. **Registry service** — `services/patient_registry.py` (`resolve_patient` get-or-create, phone-wins identity per Dr. Joshi 2026-05-21 spec; `resolve_patient_id` convenience). Booking / Rx / surgery / receipt CREATE routes now stamp `patient_id` on new docs.
3. **Registry API** — `GET /api/registry/patients` (search, capability `access_patient_db` — added to the Phase C catalog), `GET /api/registry/patients/{id}` (unified profile + cross-module history via indexed patient_id join with phone fallback), `POST /api/registry/patients` (get-or-create + reg_no allocation), `POST /api/registry/patients/{id}/merge` (owner: repoints activity rows, flags dup `merged_into`, hidden from search; merged rows kept for audit).
4. **patient_db refactor** — `_can_access` → capability resolver; list/export exclude merged rows; by-phone detail history joins by patient_id ∪ phone regex, profile exposes patient_id. `PATCH /api/patients/reg_no` also ensures canonical fields.
5. **Bug fix (found by testing agent, pre-existing)** — `app/prescriptions/index.tsx` gated on stale `role==='owner'||'doctor'`, locking primary_owner out of the Rx list ("Prescriber Access Only"). Now mirrors backend require_prescriber (owner tier ∪ can_prescribe). Verified via browser as Dr. Joshi.
- Testing: pytest 14/14 `tests/test_phase_d_registry.py` (50/50 across A–D); frontend regression by testing agent (`/app/test_reports/iteration_23.json`).

## ConsultUro 2.0 roadmap status
- Phase A (notification recovery): ✅ DONE
- Phase B (Notification V2: device_installations, notification_inbox, outbox worker w/ retry, /api/push/health-panel — Mongo-first): ✅ DONE
- Phase C (platform foundation — repository layer over Mongo [PostgreSQL swap intentionally skipped: managed env is Mongo-only], object storage for attachments, capability-based auth): ✅ DONE
- Phase D (patient registry + scheduling, canonical patient_id): ✅ DONE
- Phase E (clinical core — encounters, notes, diagnosis, Rx): NEXT
- Phase F–H (surgery/IPD/finance, AI+n8n, legacy archive): pending, strict order.

## Next Action Items
- **User: Publish + rebuild APK** so OTA/splash/safe-area/push fixes reach devices (splash & safe-area are native-level).
- Verify push end-to-end on a real device after deployment (relay key auto-injected at deploy).
- P2 backlog: Google Drive backup OAuth (blocked on user credentials — see `/app/scripts/GDRIVE_OAUTH_GUIDE.md`); surgery scheduler bulk CSV import rewrite (better error UI).
- Dr. Sagar Joshi should tap **Start** on @consultanturoBot to activate Telegram pings (if not done).

## Communications V2 (Comm-0 & Comm-1 shipped — Jun 2026)
- **Comm-0 (backup-server flap fix)**: Root cause was `/api/register-push` returning **503** when Emergent push relay was unconfigured; the frontend's DR-failover interceptor (`src/api.ts` + `backend-health.ts`) treated any 5xx as "primary origin down" and stuck the whole session onto the preview backup. Fixed on both sides — backend now returns 200 with `{registered:false, error_code, mirrored:true, degraded:true}`, and the DR interceptor only fires on an allowlist of true-infra paths (`/health`, `/me`, `/auth/session|refresh|logout`, `/version`).
- **Comm-1 (foundation)**: 18 new `comm_*` collections (indexes only, no data touched on legacy); durable Mongo outbox (`services/comm_outbox.py`) with atomic `find_one_and_update` leasing, exp-backoff+jitter, MAX_ATTEMPTS=8, dead-letter mirror, per-attempt trace, restart-safe (expired leases automatically requeue-able); feature-flag service (env defaults + DB overrides); audit log (`services/comm_audit.py`); 8 owner-only admin endpoints under `/api/v2/communications/admin/*` (flags, outbox stats/drain/events/dead-letters/retry, health). Smoke test pass (`tests/smoke_comm_outbox.py`): dedupe, success, retry-then-succeed, dead-letter, dead-letter retry, restart lease behavior.
- **Comm-2 (pending user input)**: Direct FCM HTTP v1 replacement. Blocked on user delivering `FIREBASE_SERVICE_ACCOUNT_JSON` (step-by-step guide in latest agent reply).

## Comm-2 (Direct FCM v1) — SHIPPED & VERIFIED (Jun 2026)
- **Backend**: `firebase_admin==7.4.0` installed. `services/comm_fcm.py` lazy-inits from `FIREBASE_SERVICE_ACCOUNT_JSON_B64` env; `services/comm_installations.py` handles register/revoke/invalidate with unique (provider, token_hash) + (installation_id) indexes; `services/comm_push_handler.py` registered on the durable outbox for `event_type=push.send`. Per-attempt trace in `comm_delivery_attempts`; permanent errors (UNREGISTERED / INVALID_ARGUMENT) auto-invalidate installations; transient errors backoff via outbox.
- **Endpoints (Comm-2)**:
  - `POST /api/v2/communications/installations/register` — user-authenticated, honest return (`stored / provider_configured / provider_verified / provider_error_code`).
  - `POST /api/v2/communications/installations/revoke` — user-authenticated, called on logout.
  - `GET  /api/v2/communications/admin/push/diagnostics` — owner-only, independent status of each stage.
  - `POST /api/v2/communications/admin/push/test-self` — owner-only, enqueues + drains synchronously.
- **Frontend**: `src/comm-v2/push-channels-v2.ts` (5 new channels with `AndroidNotificationVisibility.PRIVATE` — no clinical detail on lock screen); `src/comm-v2/installation.ts` (SecureStore installation UUID, `getDevicePushTokenAsync` native token, permission → token → register → dry-run verification chain, `addPushTokenListener` for rotation, `revokeV2Installation` on logout). `auth.tsx` calls `registerV2Installation` on every session establish and `revokeV2Installation` on `signOut`. `_layout.tsx` registers v2 channels at module scope and attaches the rotation listener.
- **Verified via `tests/smoke_comm2_fcm.py`**: firebase_admin initialises against project `consulturo-87dfa`, OAuth mint succeeds, dry-run against a bogus token returns `category=invalidate code=INVALID_ARGUMENT` (proving real Google traffic), push.send handler idempotent for no-devices case, permanent-error path correctly invalidates the installation.
- **Emergent legacy relay** retained in parallel — controlled by `COMMUNICATIONS_V2_PUSH_ENABLED` flag (default off). Cutover requires user's physical-device acceptance test.
- **Blocked on user**: Publish → build APK → install on physical Android → tap Notifications Health "Send test push" to complete acceptance gate.

## Comm-3 (Notification Centre V2) — SHIPPED (Jun 2026)
- **Backend service** `services/comm_inbox.py`: 7-category taxonomy (appointments / care_updates / reminders / announcements / system / security / marketing); `create_inbox_item` idempotent via unique (user_id, item_type, source_id); action-type ALLOW-LIST (`open_booking / open_prescription / open_document / open_conversation / open_broadcast / open_home / open_security / open_availability / open_video_room / open_notice / none`) — arbitrary URLs are stripped at persistence; cursor pagination (opaque base64 of created_at + id); server-computed unread counts (exact, never derived on client); batch mark-read (explicit ids only — Messages screen can never clear the notification bell); archive.
- **Endpoints (Comm-3)**:
  - `GET  /api/v2/communications/me` — per-user effective flag snapshot for the frontend gate.
  - `GET  /api/v2/communications/inbox` — cursor-paginated list.
  - `GET  /api/v2/communications/inbox/counts` — exact server-computed unread counts.
  - `POST /api/v2/communications/inbox/{id}/read`
  - `POST /api/v2/communications/inbox/read-batch`
  - `POST /api/v2/communications/inbox/{id}/archive`
- **Legacy mirror shim**: `services/notifications.py::create_notification` now dual-writes to `comm_inbox_items` when `COMMUNICATIONS_V2_MIRROR_LEGACY` is on (default true). Silent-fail; never blocks legacy path. Personal-message kinds (`personal`, `message`, `chat`, `inbox`) are correctly EXCLUDED — Comm-4 will handle those in `comm_conversations`/`comm_messages`.
- **Legacy backfill migration** `migrations/comm_v2_inbox_backfill.py`: idempotent, rerunnable copy of `db.notifications` → `comm_inbox_items` with dedupe via `comm_migration_map`. Runs on startup; bails out fast when done. Preserves read/unread state.
- **Frontend** `src/comm-v2/communications-provider.tsx`: single source of truth for unread counts + refresh. Foreground refresh via `AppState`, 60s periodic tick, and `triggerCommV2Refresh()` external hook wired to push-tap. Flag-gated via `/api/v2/communications/me` (safe no-op when master flag is off).
- **Verified** (`tests/smoke_comm3_inbox.py` + real-data backfill): 108 legacy rows → 106 mirrored + 2 personal-msgs skipped; idempotent 2nd run = 0 writes; 0 arbitrary-URL action_targets; category coercion, dedupe, cursor pagination, batch read-only-supplied-ids, cross-user isolation, archive-with-include_archived — all pass.
