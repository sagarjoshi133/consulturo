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

## Comm-4 (Patient ↔ Clinic Messaging V2) — SHIPPED (Jun 2026)
- **One "ConsultUro Clinic" conversation per patient** — unique index on `comm_conversations.patient_user_id`, idempotent `get_or_create` with race-safe collision handling.
- **Conversation state machine**: `open / awaiting_clinic / awaiting_patient / escalated_to_doctor / resolved / archived`. Server enforces all transitions; illegal transitions raise `ValueError`. Patient send auto-transitions to `awaiting_clinic`, staff send to `awaiting_patient`.
- **Message state machine**: `saved → recipient_inbox_created → push_queued → provider_accepted → recipient_app_synced → read`. Delivery is NEVER declared on FCM 200 alone — `recipient_app_synced` is bumped only when the recipient's app actually lists the message; `read` requires explicit `POST /messages/{id}/read`.
- **Idempotency-Key REQUIRED** for message create (header `Idempotency-Key` OR `body.idempotency_key`). Scoped by sender to prevent cross-user collision on short keys. Replays return the ORIGINAL persisted message body.
- **Sender identity dual layer**: `sender_display = "ConsultUro Clinic"` (patient-facing brand), `sender_audit = {actor_user_id, actor_role, actor_display_name}` (compliance-preserved actual sender).
- **Fanout via durable outbox**: staff senders → all owner-tier users receive an inbox item + push event; patient senders → owner-tier gets an inbox item + push. Stable `dedupe_key = msgpush:{msg_id}:{recipient_uid}` so retries never duplicate. Push copy is GENERIC (spec-compliant privacy) — real content only inside the authenticated app.
- **Per-side unread counters**: `unread_for_patient` / `unread_for_clinic`. Reading opposite-side message decrements ONLY the reader's side. Reading own message is a no-op. Double-read is idempotent.
- **Endpoints (Comm-4, 9 new)**:
  - `GET  /api/v2/communications/conversations` (staff: all + unread-first + search + state filter; patient: own only, auto-created on first GET)
  - `POST /api/v2/communications/conversations/get-or-create` (patient: own; staff: with `patient_user_id`)
  - `GET  /api/v2/communications/conversations/{id}/messages` (cursor pagination by sequence_number; bumps `recipient_app_synced` for received msgs, writes `comm_message_receipts.delivered_at`)
  - `POST /api/v2/communications/conversations/{id}/messages` (requires Idempotency-Key)
  - `POST /api/v2/communications/messages/{id}/read` (bumps state → `read`, writes receipt read_at, decrements opposite-side counter)
  - `POST /api/v2/communications/conversations/{id}/assign|escalate|resolve|reopen` (staff-only; illegal transitions rejected; audit logged to `comm_audit_log`)
- **Verified via `tests/smoke_comm4_messaging.py`** — 14/14 conditions passing (idempotency, dedupe, state machine, unread counters, cross-patient isolation, staff-only gates, illegal transitions, non-staff assignee rejection).
- **Frontend `CommunicationsProvider`** extended with `messageCounts.total_unread` + `conversation_count`. Refresh runs both count queries in parallel on foreground / 60s tick / push-tap. Still flag-gated via `/v2/communications/me`.
- **Attachments still deferred** behind `COMMUNICATIONS_V2_ATTACHMENTS_ENABLED=false` per spec (no durable private storage decision made yet).

## Comm-5 (Broadcast Studio) — SHIPPED (Jun 2026)
- **Full lifecycle**: draft → pending_approval → approved (recipients frozen) → scheduled → dispatching → completed / partially_failed. Rejected/cancelled terminal states from appropriate pre-states. Server enforces every transition; illegal jumps rejected.
- **Audience modes**: patients / staff / both / selected_patients / patients_with_future_appointments. Audience is FROZEN into `comm_broadcast_recipients` at approve time with `has_active_installation_at_freeze` + `excluded_reason` (consent opt-out). Dispatch NEVER re-queries the audience.
- **Owner-only actions** (approve, reject, schedule, cancel, retry-failed); staff can create/edit/submit drafts.
- **Dispatch via durable outbox**: `broadcast.dispatch` event enqueued with `available_at=scheduled_at`. Handler creates one inbox item per recipient (item_type=v2_broadcast, dedupe on unique index) and per-recipient `push.send` events (dedupe_key=`bcast:{id}:push:{uid}`) so retries never duplicate.
- **Retry-failed** only requeues rows in `push_enqueue_error` or `provider_error` — excluded and already-accepted rows are untouched.
- **Honest analytics**: `intended_recipients / excluded_recipients / inbox_items_created / push_eligible / push_enqueued / provider_accepted / provider_failed / invalid_tokens / app_opened / broadcast_read` — every counter INDEPENDENT. Spec-required non-conflation note included in the API response.
- **Push handler hook**: on successful FCM send, `provider_accepted_at` stamped on the recipient row. On permanent error, `provider_error_code` recorded and delivery_status → `provider_error`. Inbox `mark_read` on a `v2_broadcast` item forwards `read_at` and `app_opened_at` to the recipient row.
- **11 endpoints** under `/api/v2/communications/broadcasts/*`.
- **Verified** (`tests/smoke_comm5_broadcasts.py`) — 15/15 acceptance conditions pass on 22 real patient users. Notable: freezing captured 1 opt-out correctly; excluded patients received zero inbox items; analytics counters stayed truthful post-dispatch (`broadcast_read=1`, `provider_accepted=0` — independent).

## Comm-6 (Home Notice Banner) — SHIPPED (Jun 2026)
- **Backend service** `services/comm_home_notices.py`: CRUD + `list_active_for_user` (audience filter patient/staff/both, active window, dismissal exclusion, priority ordering by urgency > style-priority > published_at desc).
- **6 endpoints** under `/api/v2/communications/home-notices/*` and `/admin/home-notices/*`. Owner-only for admin write; any authenticated user for `active` and `dismiss`.
- **Publication does NOT create push or inbox items** — spec-compliant. "Also create Broadcast" is a separate explicit action (Comm-5).
- **Frontend** `src/comm-v2/home-notice-ticker.tsx`: horizontally-below-safe-area ticker; rotates every 6s when >1 notice; tap pauses + opens validated action; dismiss button (unless notice is non-dismissible); **reduce-motion aware** (static wrapped text when enabled); AsyncStorage-cached last successful response for offline fallback; foreground + 5-min periodic refresh.
- **Wired into home screen** `(tabs)/index.tsx` — renders below hero card, above legacy AnnouncementsBanner. Flag-gated via server response (safe no-op for users outside canary).
- **Two mock notices seeded** for owner review:
  - `[warning]` "🕉️ Clinic closed for Diwali · Nov 12–14. Emergencies: call the on-call line…"
  - `[success]` "✨ New: video consultations are now live. Book a video slot from the Bookings tab."

## Canary status
- **`COMMUNICATIONS_V2_CANARY_USER_IDS = [user_4775ed40276e]`** — Dr. Sagar Joshi (primary_owner, sagar.joshi133@gmail.com) is the first canary user.
- Enabled for canary: `home_notices`, `messages`, `broadcasts`. Master `COMMUNICATIONS_V2_ENABLED` remains false so no other user sees any V2 UI yet.
- Push v2 flag stays OFF pending physical-device acceptance test.

## Comm V2 endpoint surface — 39 endpoints total

## Comm-7 (Frontend V2 screens) — SHIPPED (Jun 2026)
- **Six new screens** under `/app/comm-v2/*`:
  - `index.tsx` — canary hub with 3 tiles (Notification Centre / Messages / Broadcast Studio) + live unread counters from the `CommunicationsProvider`.
  - `inbox.tsx` — Notification Centre: 7 category chips with server-computed unread numbers · unread-first · cursor pagination · "Mark shown as read" (spec-compliant — only touches ids currently on screen, never wipes items the user hasn't seen) · long-press to archive · validated deep-linking via action_type (open_booking / open_prescription / open_conversation / open_broadcast / open_home).
  - `conversations/index.tsx` — staff view: all conversations, state-filter chips (all / awaiting_clinic / awaiting_patient / escalated / resolved), unread-first + search over last_message_preview · per-side unread badge · patient view: their one auto-created conversation.
  - `conversations/[id].tsx` — thread with reverse-chrono list · reply-to via long-press · Idempotency-Key regenerated per compose+send (header + body fallback) · read-mark on scroll-into-view for received messages · staff action bar (escalate / resolve / reopen) · honest delivery-state hints under own messages (sent / delivered / read).
  - `broadcasts/index.tsx` — Broadcast Studio list with state-filter chips, live "New" button.
  - `broadcasts/compose.tsx` — draft composer / edit-rejected · title (200), body (4000), category (5), audience mode (4 radio options with hints) · Save-draft OR Submit-for-approval buttons.
  - `broadcasts/[id].tsx` — detail with rejection reason box · audience preview card (intended/included/excluded/push-eligible + exclusion reasons) · analytics card with 9 INDEPENDENT counters + non-conflation note · owner action bar (Approve / Reject-with-reason / Send-now / Cancel / Retry-failed) · meta section.
- **Design tokens** (`src/comm-v2/ui-tokens.ts`) — shared muted-clinical palette, category & state labels, relative time formatter, chip/card/empty styles. Every V2 screen inherits the same look.
- **Owner entry point** — the More tab now shows a "Communications V2 (preview)" tile under Admin (owner-only) that opens `/comm-v2`.
- **Verified**: hub loads, renders "Canary not active" panel correctly for unauthenticated sessions, layout is functional at 390×844 viewport. Existing legacy screens untouched — cutover happens in Comm-8/9.

## Deploy-Readiness Hardening — SHIPPED (Jun 2026)
- **DB_NAME fail-fast** — removed hardcoded `"consulturo"` fallback from both `backend/server.py` and `backend/db.py`; startup now raises RuntimeError if `DB_NAME` env var is unset. Deploy pipeline supplies it explicitly.
- **Frontend api.ts localhost literal removed** — `frontend/src/api.ts` no longer ships `http://localhost:8001`; on web, defaults to `window.location.origin` so same-origin deploys and local Metro dev both work (Metro proxies `/api/*` to :8001).
- **MongoDB unique-index resilience** — `_ensure_unique_indexes_and_cleanup_orphans` in `backend/server.py` now (a) runs a pre-index dedup that quarantines duplicate `email` / `phone` values on `users` (renames field on duplicate rows so the partial index skips them, never deletes rows) and (b) wraps each `create_index` in its own try/except so one bad row cannot crash startup.
- **Bloat pruning** — uninstalled unused packages `pydocket`, `spotipy`, `fakeredis`, `burner-redis`, `redis` and re-froze `backend/requirements.txt` (240 lines, down from 245). Removed transitive `google-cloud-firestore==2.27.0` line (still pulled in by `firebase_admin` at install time — never imported in code).
- **`.gitignore` fix** — corrected `test_credentials.md` path (was `/app/memory/…` which never matched the repo-relative path; now `/memory/test_credentials.md` + `memory/test_credentials.md`).
- **Health probes** — `GET /`, `GET /healthz`, `GET /readyz` all return 200 for K8s.
- **`deployment_agent` verdict**: `warn` (no BLOCKERs; remaining WARNs are user-owned iOS `GoogleService-Info.plist` + eas.json policy note + Apple Store account-deletion flow — none block K8s deploy).

## Account Deletion + Duplicate Review Tool — SHIPPED (Jun 2026)
- **Account Deletion (Apple App Store Guideline 5.1.1(v))** — new `DELETE /api/auth/me` (routers/auth.py). PATIENT accounts only (staff/owner get 403 → must be off-boarded from Team panel). Hard-deletes personal data (user_sessions, push/comm installations, ipss_history, notes, notification/comm inbox, patient↔clinic conversations+messages, drafts) and ANONYMISES retained clinical records (bookings/prescriptions/surgeries/receipts → patient PII scrubbed, `deleted_account:true`, `user_id:null`), then deletes the users doc. Audit row `account.self_delete`.
  - Frontend: Profile → Danger zone shows a red **"Delete my account"** button (patients only), opening a type-to-confirm ("DELETE") modal; on success signs out and routes to `/signed-out`. testIDs: `profile-delete-account`, `delete-confirm-input`, `delete-confirm-btn`.
- **Duplicate Review Tool (quarantined emails/phones)** — the startup dedup renames duplicate `email`/`phone` → `email_dup_quarantine`/`phone_dup_quarantine`. Two new owner-only endpoints (routers/admin_users.py):
  - `GET /api/admin/users/quarantined-duplicates` — lists each quarantined row with its activity counts and the canonical live account holding the value (`canonical_exists`).
  - `POST /api/admin/users/resolve-quarantine` `{quarantined_user_id, action:"merge"|"restore"}` — **merge** re-stamps activity onto the canonical account then deletes the stub; **restore** (only when no live holder) renames `*_dup_quarantine` back to the real field. Audit row `users.resolve_quarantine`.
  - Frontend: new **"Quarantined email / phone"** section appended to `admin/dup-merge.tsx` (super_owner/primary_owner). Per-row Merge or Restore button. testIDs: `quarantine-row-*`, `quarantine-merge-*`, `quarantine-restore-*`, `quarantine-empty`.
  - Backend verified via curl: list (2 rows), merge (booking re-stamped, stub deleted), restore (phone renamed back), staff-block on DELETE /auth/me (403).

## Installed-app "everything slow / endless loading / Sign Out does nothing" — FIXED (Jun 2026)
Root cause: the installed APK targets the **production** backend (`urology-pro.emergent.host`) with preview as DR fallback. When production is down/degraded (deploy failing), the client did not fail over for data screens, so Patients/Bookings/Directory spun forever and Sign Out hung.
- **`src/api.ts`** — DR failover gate refined: a pure NETWORK/timeout error (no HTTP response: ERR_NETWORK/ECONNABORTED/ETIMEDOUT) now triggers failover on ANY path (a down origin should never leave data screens spinning); 5xx RESPONSES still restricted to the true-infra allowlist (keeps the Comm-0 anti-flap behaviour). Added `/auth/me` to the allowlist (the app calls `/auth/me`, not `/me`, so boot failover was previously never eligible).
- **`src/backend-health.ts`** — new `ensureHealthyBackend(timeoutMs=4000)`: proactive one-shot `/api/health` probe of the primary on boot; if it times out/errors, immediately fails over to a healthy fallback so the first screen loads against a working backend (no 15s stalls). No-op when PRIMARY unset or no fallbacks.
- **`src/auth.tsx`** — (1) `refresh()` calls `ensureHealthyBackend()` before the first `/auth/me`. (2) **Sign Out is now instant & reliable**: clears local session (`setUser(null)` + removes token) FIRST, then fires `revokeV2Installation()` + `/auth/logout` (5s timeout) in the background — a dead/slow backend can no longer make Sign Out appear to do nothing.
- NOTE: these are client-side fixes → the installed app needs a **new build (or OTA update)** to pick them up. The deeper fix is getting production deployed successfully (the WAKEUP_ENVIRONMENT infra timeout).
- Verified in preview: Patients screen loads with data, no boot regression.

## Production "everything slow / endless loading everywhere" — ROOT CAUSE FIXED (Jun 2026)
Confirmed the production backend is UP and fast for public routes (`/api/health` → `{"ok":true,"db":"connected"}` 0.8s, `/api/doctor` 0.3s) — it was NOT down. The real cause: **missing MongoDB indexes on the auth hot-path**. Every authenticated request runs `get_current_user` → `db.user_sessions.find_one({session_token})` + `db.users.find_one({user_id})`, and the demo middleware repeats both on writes. The codebase created indexes on `users.email/phone` + tenancy/registry collections but **never on `user_sessions.session_token`, `user_sessions.user_id`, or `users.user_id`**. On the sandbox's tiny local Mongo this is invisible; on the production Atlas cluster (network latency + a `user_sessions` collection that grows on every login and was never pruned) each lookup became a FULL COLLECTION SCAN, so every screen (Dashboard/Today, Patients, Bookings, …) crawled.
- **`backend/server.py`** `_ensure_unique_indexes_and_cleanup_orphans` (idempotent startup) now also creates:
  - `sessions_token_unique` — unique index on `user_sessions.session_token` (falls back to non-unique if a legacy dup exists)
  - `sessions_user_id_idx` — on `user_sessions.user_id`
  - `sessions_ttl` — TTL index on `user_sessions.expires_at` (expireAfterSeconds=0) so expired sessions auto-purge and the collection stays small
  - `users_user_id_unique` — unique index on `users.user_id` (falls back to non-unique)
- Verified on preview: all 4 indexes created, no startup errors, `/auth/me` 4ms, `/analytics/dashboard` 16ms, `/bookings/all` 6ms.
- **REQUIRES REDEPLOY** so the indexes are built on the production Atlas cluster (created automatically on backend startup; Atlas builds them in the background, does not block the health probe). This is the definitive fix for the production slowness.

## Production slowness — DEEPER FIX (unindexed hot queries + blocking booking sweep) (Jun 2026)
Follow-up after the app was still slow post auth-index fix. Verified production backend is healthy (health 0.55s, /doctor 0.25s, /auth/me w/ bogus token 0.1–0.3s → auth lookups already fast) and production logs show NO errors → confirms a pure PERFORMANCE issue (unindexed data queries amplified by Atlas latency + real data volume), not a crash. Root causes + fixes:
- **`GET /api/analytics/dashboard`** fires ~15 `count_documents` + 5 full cursor sweeps filtered on `status`/`clinic_id`/`booking_date`/`mode`, and **`GET /api/registry/patients` + `/summary`** sweep all patient users + `$in` counts on `patients` — all unindexed. Powered every Dashboard/Today/Patients screen → seconds each on Atlas.
- **`server.py`** `_ensure_unique_indexes_and_cleanup_orphans` now also creates (idempotent) data-query indexes: bookings `(clinic_id,status)`, `(clinic_id,created_at)`, `status`, `booking_date`, `user_id`, `mode`; surgeries `(clinic_id,date)`,`(clinic_id,created_at)`; prescriptions `(clinic_id,created_at)`,`user_id`; receipts `(clinic_id,created_at)`,`user_id`; patients `email`,`merged_into` (phone_digits/clinic_id already existed); notification_inbox + comm_inbox_items `(user_id,created_at)`.
- **`routers/bookings.py` `_auto_mark_missed`** (ran on EVERY `/bookings/all`, which is polled from dashboard/glance/alerts/60s poller): was a per-row loop doing `update_one` + `create_notification` + `push_to_user` (external HTTP push per booking) synchronously in the request path. Rewritten to: (1) THROTTLE — at most once per 120s per clinic filter; (2) BULK — single `update_many` flip; (3) NON-BLOCKING — notifications+push moved to a fire-and-forget `asyncio.create_task`.
- Verified on preview: all indexes created, no startup errors, `/bookings/all` 19ms, `/analytics/dashboard` 26ms, `/registry/patients` 9ms, `/summary` 6ms, `/invites/analytics` 5ms.
- **REQUIRES REDEPLOY** — indexes build on production Atlas at startup and the new sweep code ships; both take effect only after redeploy.

## Production slowness — ROUND-TRIP REDUCTION (the real cause: ~0.5s Atlas latency × many sequential queries) (Jun 2026)
User confirmed: even AFTER the index redeploy, every screen still takes ~10-30s to load on the installed APK (both WiFi + mobile data), eventually loading (not hanging). Diagnosis: production has a real ~0.5s round-trip baseline (even the trivial `/api/health` takes 0.55s), so the hot endpoints' HIGH NUMBER OF SEQUENTIAL DB OPERATIONS — not scan cost — is the bottleneck. Indexes fix scan time, not round-trip count. Fixes (all collapse round-trips):
- **`routers/analytics.py` `/api/analytics/dashboard`** (powers Dashboard/Today) — was ~19 sequential DB ops (14 `count_documents` + 5 full sweeps, several scanning the same collection twice). Rewritten to ONE streaming pass per collection computing every counter in Python (exact same output): now **3 sweeps + 1 count**. Preserves `_month_bucket`/`$exists` semantics.
- **`routers/patient_registry.py`** — the Patients screen opens 3 endpoints at once (search + `/summary` + `/invites/analytics`) that each streamed the ENTIRE `users` collection. Added a shared 30s in-memory cache (`_get_registered_sets`) so the parallel calls + rapid tab re-opens reuse ONE user sweep instead of three.
- **`server.py`** — added a `[SLOW]` request logger (logs any request ≥ SLOW_REQUEST_MS, default 800ms) so future production slowness can be pinpointed to the exact endpoint from the deploy logs.
- Verified on preview: analytics/dashboard returns identical numbers, all registry endpoints 4-7ms, no startup errors.
- **REQUIRES REDEPLOY** to take effect on production.

## Tab Caching — stale-while-revalidate (Jun 2026)
Client-side fix so switching away and back to a tab shows the last-loaded data INSTANTLY instead of a full-screen spinner + refetch every time.
- **`src/data-cache.ts`** (new) — tiny in-memory session cache: `getCached`/`setCached`/`hasCached`/`invalidateCached`. In-memory only (survives tab switches/navigation, cleared on sign-out; never persists another account's data across launch).
- **`src/admin-overview-panel.tsx`** (Dashboard/Today) — seeds `data`/`todayBookings` from cache, shows spinner only when nothing is cached, refreshes quietly in the background, writes cache on success (key `admin-overview`).
- **`src/dashboard/bookings-panel.tsx`** — seeds `items` from cache `bookings-all`, spinner only on first-ever load; keeps prior list on a failed refresh.
- **`app/patients/index.tsx`** — caches the unfiltered list per tab (`patients:items:{tab}`) + shared `patients:summary` / `patients:analytics`; on tab switch shows cached rows instantly then background-refreshes (searches stay live/uncached).
- **`src/auth.tsx`** — `signOut()` calls `invalidateCached()` so no stale data leaks between accounts.
- Verified: Dashboard renders cached Today panel + stats, lint clean (no new issues), no runtime errors. Frontend-only → live on preview now; installed app needs a fresh build.

## Pull-to-Refresh Hint — "Updated just now" freshness line (Jun 2026)
- **`src/updated-hint.tsx`** (new) — `<UpdatedHint at={ts}/>` + `timeAgo()` helper. Subtle grey line that self-updates every 30s ("just now" → "N min ago" → "N hr ago").
- Wired into the 3 cached screens, each tracking `updatedAt` (set on successful load): **Dashboard/Today** (under the Today header), **Bookings** (under the toolbar), **Patients** (under the header). Tells staff how fresh the instantly-shown cached data is.
- Verified on preview: "Updated just now" renders under the Today header; lint clean. Frontend-only → needs a fresh build for the installed app.


## Production slowness — FINAL ROOT-CAUSE FIX: per-request auth/tenancy tax (Jun 2026)
User confirmed slowness persisted post-redeploy on a real APK. Diagnosis: EVERY authenticated
request paid 3-4 sequential Atlas round-trips BEFORE the endpoint query ran:
session lookup + user lookup (get_current_user) + membership/default-clinic lookup (resolve_clinic_id).
Fixes:
- NEW `/app/backend/services/auth_cache.py`: 30s in-process TTL cache token→user (max 5000 entries).
- `server.py resolve_session_user()`: single $lookup aggregation (user_sessions ⋈ users) on cache
  miss = 1 round trip instead of 2; shared by get_current_user AND demo middleware.
- IMMEDIATE invalidation: logout (invalidate_token), account deletion + PATCH /auth/me +
  email-verify (invalidate_user). Admin role/permission tweaks propagate within ≤30s TTL.
- `services/tenancy.py`: 60s TTL cache for membership validation + default clinic;
  `invalidate_tenancy_cache()` called in upsert_membership, member remove, clinic archive/restore.
- FRONTEND `data-cache.ts` v2: persists entries to AsyncStorage (`dc:*`, 400KB/key cap),
  `hydrateCache()` at boot, `ensureCacheOwner(userId)` wipes on account switch, cleared on
  sign-out/401. Cold app start now paints last-known data instantly.
- `auth.tsx` INSTANT BOOT: hydrates `cached_user` + data cache from AsyncStorage and renders
  immediately; /auth/me verifies in background (401/403 → sign-out); ensureHealthyBackend no
  longer blocks first paint.
- SWR caching extended to: surgery-panel (surgeries:items/presets), prescriptions panels
  (rx:items), my-bookings, inbox (inbox:received). Already cached: admin-overview, bookings-all,
  patients, notes.
- Testing iteration 26: 17/17 backend pytest (`tests/test_auth_cache_and_tenancy.py`) + frontend
  smoke PASS. NOTE: many older pytest files contain stale hardcoded session tokens purged by the
  sessions TTL index — re-seed via user_sessions upsert, not code changes.

## Production slowness — EVIDENCE-BASED DIAGNOSIS ROUND (Jun 2026, cont.)
User reports slowness persists on a freshly built APK, on EVERY tab tap mid-session.
Measured PRODUCTION backend directly from the dev container:
  /api/health 130-460ms · /api/blog (139KB real DB payload) 0.5-0.9s (gzip via Cloudflare→35KB)
  auth lookup ~170ms → SERVER IS FAST. Bottleneck must be device-side (network path from
  user's phone, payload transfer size, or stale APK).
Shipped this round:
- NEW `/app/frontend/app/net-check.tsx` — "Connection Diagnostics" screen: shows active backend
  URL, fallback status, app version; "Run speed test" measures health x3, /auth/me, /bookings/me,
  /blog + staff-only heavy endpoints (/bookings/all, /analytics/dashboard, /registry/patients,
  /surgeries, /prescriptions, /inbox/all) with ms + KB per row and a plain-language verdict.
  Linked from: More tab (Account section, all roles incl. signed-out), Profile screen, Help screen.
- server.py slow-logger now includes response SIZE and logs `[BIG]` for any response >300KB even
  when fast — so deploy logs reveal oversized payloads (mobile transfer time is invisible to
  server-side timing alone).
NEXT STEP (waiting on user): redeploy → open production app via Expo Go QR (no APK build needed)
→ More → Connection Diagnostics → Run speed test → screenshot. Verdict decides next fix:
  slow rows on staff endpoints w/ large KB ⇒ paginate/project heavy endpoints
  (/api/surgeries currently returns up to 5000 full docs, /bookings/all + /prescriptions 500).
  fast rows ⇒ APK/runtime issue on device.

## Phase E — Clinical Core (encounters + AI dictation + diagnosis registry) — SHIPPED (Jun 2026)
Backend `/app/backend/routers/encounters.py` (registered in server.py; indexes enc_clinic_created,
enc_phone, dxr_clinic_label):
- POST/GET(list paginated {items,total,has_more})/GET-id/PATCH/DELETE /api/encounters — clinic-scoped
  on EVERY route via _scoped_find (tester-flagged gap fixed). Delete: owner-tier or author only.
- POST /api/encounters/{id}/link-rx — two-way encounter↔prescription linkage.
- GET /api/diagnoses?q= — clinic diagnosis registry typeahead, auto-learned from saved encounters
  (usage_count ranking).
- POST /api/ai/encounter-dictation — Whisper-1 → Claude Sonnet 4.5 → SOAP JSON
  (chief_complaint/subjective/objective/assessment/plan/diagnoses). Reuses wave3 helpers.
Frontend: app/encounters/{index,new,[id]}.tsx. New/edit form: patient autofill by phone, vitals row,
SOAP inputs, diagnosis chips w/ typeahead, Dictate button (VoiceDictationSheet generalized with
upload/title/subtitle/example props; uploadDictation() extracted in src/wave3/api.ts).
Detail: sections, Create-Rx button → /prescriptions/new?encounterId= (prefills patient+complaint+
diagnosis+plan; links back after save). Entry: More tab → Practice → "Encounters".

## Trim Heavy Screens — progressive pagination — SHIPPED (Jun 2026)
Backend: limit/skip(+q) on GET /api/surgeries (search: name/phone/surgery_name/hospital/diagnosis),
GET /api/prescriptions (name/phone/diagnosis), GET /api/bookings/all (+status; auto-missed sweep
runs on UNfiltered scope). Defaults unchanged → responses stay plain arrays (backward compat).
Frontend `src/progressive-fetch.ts` fetchPaged(): renders after EVERY 200-row page. Wired into
surgery-panel, dashboard prescriptions-panel, prescriptions/index, bookings-panel,
consultations-panel (now server-filtered status=confirmed). Dashboard pending badge poll now
requests only status=requested&limit=200.
Testing: iteration 27 — 22/22 backend pytest + full frontend flow PASS
(tests/test_encounters_phase_e.py; re-run green after tenancy hardening).

## i18n fix — More tab "Encounters" & "Net Check" labels — SHIPPED (Jun 2026)
Root cause: i18n t() returns the raw key string on a missing key, so the `|| 'fallback'` in
more.tsx never triggered — buttons showed literal "more.encounters"/"more.netCheck". Added the
missing keys (encounters, encountersSub, netCheck, netCheckSub) to en.ts/hi.ts/gu.ts under `more`.
Verified via screenshot: raw keys gone, "Connection Diagnostics" renders. Frontend-only.

## Account deletion — 30-day restore window + deletion receipt — SHIPPED (Jun 2026)
DELETE /api/auth/me (patient-only, staff 403) now SOFT-deletes: sets pending_deletion +
deletion_purge_at(+30d), keeps account/session usable, emails a receipt with a restore link.
Restore: POST /api/auth/me/restore (in-app banner) OR GET /api/auth/restore/redirect?token=
(email link). Permanent purge/anonymise runs from server 60s loop (routers.auth.
sweep_purge_due_accounts) once grace elapses. /api/auth/me surfaces pending_deletion +
deletion_purge_at. Frontend: src/deletion-banner.tsx (amber banner + Cancel) on Profile + More;
delete button hidden while pending; modal copy updated to explain the 30-day grace.
Email via Emergent-managed proxy (services/mailer.py, EMERGENT_EMAIL_KEY + EMAIL_FROM_NAME).

## Rich link sharing (Open Graph unfurl) — SHIPPED (Jun 2026)
Backend routers/share.py: GET /api/share/{kind}[/{ident}] serves OG + Twitter Card meta HTML
(title/description/image/url) + JS redirect to the canonical in-app page, so links unfurl in
WhatsApp/social. Kinds: home, book, clinic/<slug>, blog/<id>, guide/<key>, videos, education,
refer/<code>. Server-resolves clinic/blog/guide metadata; query params t/d/img override; ref
preserved for referral attribution. Frontend src/share.ts (shareLink/buildShareUrl) wired into
share buttons: Blog detail, Clinic page, Refer (WhatsApp+native), Guide detail, Videos, Education.
Tested: iteration 28 — 12/12 backend pytest + frontend flows PASS.

## Encounter Follow-ups — SHIPPED (Jun 2026)
Encounters gained follow_up_date (YYYY-MM-DD). new.tsx form: quick chips (1w/2w/1m/3m) + date
input. Detail shows a "Follow-up: <date>" badge. GET /api/encounters/followups?scope=today|upcoming
(IST-based). Surfaced BOTH on Dashboard Today tab (AdminOverviewPanel "Follow-ups due today" +
View all link) AND a dedicated /encounters/followups screen (Today/Upcoming tabs), reachable from
the Encounters list header. Provider gets a push/notification at 09:00 IST on the due day via
routers.encounters.scan_and_fire_encounter_followups in the server 60s loop (follow_up_at +
follow_up_notified flag, re-armed on date change). Tested: iteration 29 (8/8 backend + frontend).

## Share Poster (branded OG image fallback) — SHIPPED (Jun 2026)
GET /api/share/poster.png?t=&s= renders a 1200x630 branded teal card (Pillow, Liberation Sans).
share.py now uses the item's own image (blog cover / clinic cover) when present, else falls back
to the generated poster as og:image — so every shared link unfurls with a polished card.

## Deferred
- Branded Sender (emails from consulturo.com): user chose LATER. When ready: verify consulturo.com
  in Resend (DNS at Squarespace), set RESEND_FROM_EMAIL=noreply@consulturo.com, route account mail
  via the branded Resend sender. Currently using Emergent-managed email (reliable, no DNS needed).

## Follow-up Reschedule — SHIPPED (Jun 2026)
/encounters/followups rows now have a Reschedule action → bottom sheet with quick chips
(1w/2w/1m/3m from today) + date input; Save PATCHes /api/encounters/{id} {follow_up_date}
(re-arms the reminder), "Remove follow-up" clears it. Verified via screenshot + curl PATCH.

## Announcement Scheduling — ALREADY LIVE (verified Jun 2026)
Feature already exists end-to-end: admin/announcements.tsx form has Start/End date fields
(ISODateField), backend routers/announcements.py public feed filters on start_at/end_at
(auto show/hide). Verified: future-start and past-end announcements are correctly hidden.
Location for owner: More → Administration → Announcements.

## Announcement Preview — SHIPPED (Jun 2026)
admin/announcements.tsx editor now shows a "Live preview" card at the top rendering the current
draft exactly as the banner will look (src/announcements/preview-card.tsx, mirrors banner.tsx),
with an EN/HI/GU language toggle. No fetch; updates live as the owner edits.

## Follow-up Done — SHIPPED (Jun 2026)
POST /api/encounters/{id}/followup/done (staff) sets follow_up_done=true (+done_at, notified=true)
— encounter is RETAINED, just drops off the Follow-ups list + dashboard today card
(list query filters follow_up_done != true). Rescheduling (PATCH follow_up_date) re-opens it
(follow_up_done=false). Frontend: "Mark done" button (optimistic removal) beside Reschedule on
/encounters/followups. Verified: curl (done/hidden/retained/reopen) + screenshots.

## Announcement Templates — SHIPPED (Jun 2026)
admin/announcements.tsx: a horizontal "Start from a template" row with 5 ready-made trilingual
banners (Holiday closure, Health camp, New service, Doctor on leave, Timings changed). Tapping a
chip opens the editor pre-filled (title/body EN+HI+GU, variant, icon, CTA, placements, pinned)
with {date}/{service} style placeholders to tweak. Verified via screenshot (prefill works).

## Completed Follow-ups Log — SHIPPED (Jun 2026)
GET /api/encounters/followups?scope=done → completed follow-ups sorted by follow_up_done_at desc
(exposes follow_up_done_at). POST /api/encounters/{id}/followup/reopen → follow_up_done=false,
re-arms reminder if date still future. Frontend: /encounters/followups now has a 3rd "Done" tab
showing completed rows with a green "done on <date>" badge + a "Reopen" action. Verified:
curl (done list/reopen round-trip) + screenshots.

## Follow-up Count Badge — SHIPPED (Jun 2026)
Encounters list header "Follow-ups" button now shows a small count badge of follow-ups due today
(fetched via /encounters/followups?scope=today on focus). Verified: badge shows "1" with one due.

## Dashboard Follow-up Count — SHIPPED (Jun 2026)
AdminOverviewPanel "Follow-ups due today" section header now shows a count pill (followups.length)
next to the title, visible on the Today tab (default dashboard landing). Verified via screenshot.

## Overdue Follow-ups — SHIPPED (Jun 2026)
GET /api/encounters/followups?scope=overdue → follow_up_date < today(IST), not done, oldest first.
followups.tsx: 4th "Overdue" tab (red), red badge on rows, screen accepts ?scope= param.
Dashboard (AdminOverviewPanel): red "N overdue follow-ups" alert (fetches scope=overdue count)
linking to /encounters/followups?scope=overdue. Verified curl + screenshots.

## Patient E2E QA sweep (iteration 30) — findings + fixes
- Backend 19/19 pytest pass; patient scoping clean; auth/me, bookings, records, IPSS OK.
- FIXED (HIGH): profile.tsx used 4 undefined i18n keys (rowAppearance/Sub, rowNetCheck/Sub) →
  raw keys shown. Added to en/hi/gu. Verified: no raw keys, "Appearance"/"Connection Diagnostics" render.
- NON-ISSUE (web-only): desktop-UA browser at narrow width shows the web sidebar (isUaDesktopHint) —
  a Playwright artifact; real installed phone (Platform.OS!=web) always renders mobile UI.
- LOW: /api/inbox + /api/messaging/permissions 404 for patients but screens handle gracefully.

## Empty Inbox Polish — SHIPPED (Jun 2026)
inbox.tsx empty state redesigned: tinted circular icon bubble, "No messages yet" heading, warmer
copy ("You're all set. When the clinic team writes to you, their message will appear right here."),
and a "Browse Help & FAQs" CTA (→ /help) for patients on the Inbox tab. Verified via screenshot.

## Booking Reminders (day before) — SHIPPED (Jun 2026)
routers/bookings.py sweep_booking_reminders(now) runs in the server 60s loop: finds confirmed
bookings dated tomorrow (IST) with reminder_sent != true + user_id, sends an in-app notification
("📅 Appointment tomorrow") + push, and flags reminder_sent so each patient is reminded once.
Rescheduling to a new date resets reminder_sent (PATCH booking_date). Verified via live loop:
notification created + flag set, then auto-cleaned.

## Encounters ↔ Booking/Patient integration — SHIPPED (Jun 2026)
Wired the clinical chain Appointment → Encounter → Prescription → patient record:
- Backend encounters.py: EncounterBody + doc now carry patient_user_id (+ existing booking_id);
  list endpoint accepts booking_id & patient_user_id filters (patient_phone already existed);
  _LIST_PROJECTION exposes patient_user_id.
- bookings/[id].tsx consultation room: "Start/Open encounter" button ALONGSIDE "Create prescription"
  (openEncounter deep-links /encounters/new prefilled with booking_id, patient_user_id, name, phone,
  age, sex, reason→chief_complaint). Green "Visit recorded — open encounter" chip shows when an
  encounter exists for the booking (queries ?booking_id=). Booking status left unchanged (per user).
- encounters/new.tsx: reads prefill params + sends booking_id + patient_user_id on create.
- patient-db/[phone].tsx: new collapsible "Encounters" section listing the patient's visit notes
  (?patient_phone=) so staff see per-patient history. Encounters remain STAFF-ONLY (patients don't see them).
Verified: curl (all 3 link filters) + screenshot (Visit-recorded chip on booking detail).

## Reason Auto-Fill (past-visit context) + Complete Visit — SHIPPED (Jun 2026)
encounters/new.tsx (create mode):
- Past-visit context card: fetches the patient's most recent encounter (?patient_phone=, then GET
  detail) and shows Last visit date, Complaint, Diagnosis, Plan, and Follow-up — so doctors start
  with continuity. (Booking reason→chief_complaint prefill was already in place.)
- "Save & complete visit" button (shown only when opened from a booking): saves the encounter AND
  PATCHes the linked booking status→'completed' in one tap; invalidates bookings + encounters cache.
  Regular "Save encounter" leaves booking status untouched.
Verified: screenshot (context card + prefilled fields + button) + curl (PATCH status→completed).

## Quick Vitals + Visit Summary PDF — SHIPPED (Jun 2026)
encounters/new.tsx (Vitals section):
- Quick Vitals tap-to-fill chips: "Normal BP" → BP 120/80, "Normal Pulse" → Pulse 72,
  "All normal" → BP 120/80 + Pulse 72 + Temp 98.6 + SpO2 98. Values stay editable/clearable
  so staff can adjust or blank them out during rush times. Haptic feedback on tap.
encounters/[id].tsx (Encounter detail):
- "Export Visit Summary PDF" (body button + header share icon) generates a clean one-page PDF
  via existing sharePdfFromHtml (real .pdf file, never OS print dialog).
- New builder src/encounter-pdf.ts (buildEncounterHtml / buildEncounterSummaryHtml) mirrors the
  rx-pdf.ts branded look. Branding (clinic name/address/phone, doctor degrees/reg no, signature,
  letterhead) sourced from loadClinicSettings() so it matches Branding & Settings > Clinic &
  Prescription Details. Renders: header/letterhead, "Visit Summary" title, patient band, vitals
  chips, diagnoses, SOAP sections, follow-up, verify QR + signature footer + ConsultUro stamp.
Verified: testing_agent iteration_31 (tap-fill correctness, editable/clearable, PDF export triggers
render/pdf + download with 0 console errors, detail-screen regression clean).

## Send Visit Summary to WhatsApp — SHIPPED (Jun 2026)
encounters/[id].tsx:
- Green "Send to WhatsApp" button (testID encdet-whatsapp-btn) below the Export PDF action.
- Reuses existing sharePdfThenWhatsApp (src/whatsapp-pdf.ts): renders the visit-summary PDF, shares
  it via OS share sheet (WhatsApp attaches the real file), then prompts to open the patient's chat
  with a pre-filled note. Guards: no phone on file → friendly alert; skips prompt if
  whatsapp_auto_prompt_enabled is false.
- Added new docKind 'visit' + message template to buildWaMessage. Country code + doctor name +
  follow-up date pulled from loadClinicSettings()/encounter.
Verified: screenshot (both buttons render) + interactive web test — tap triggers render/pdf, PDF
download, then confirm dialog "Open WhatsApp chat with <patient>?", 0 console errors.

## Web sidebar parity + Connectivity RCA (Jun 2026)
web-shell.tsx (desktop sidebar) was missing several items present in the mobile More tab.
Added for parity: Encounters (Practice), Dup-Merge Accounts (super_owner), Rx Templates (prescribers),
Analytics Dashboard + Communications V2 (owner), Invite a Friend (Explore), Help + Connection
Diagnostics (App), Privacy + Terms (About). Encounters verified visible in Practice section.

Connectivity RCA (production APK v1.0.33, /net-check screenshot: ALL endpoints timeout(20s)):
- Production backend https://urology-pro.emergent.host is HEALTHY — curl to /api/health returns
  200 {"ok":true,"db":"connected"} in ~0.18s (HTTP/2, server: cloudflare, via: 1.1 google).
  Fallback https://urology-pro.preview.emergentagent.com also 200 in ~0.2s.
- The diagnostics screen uses a RAW fetch() (no axios/interceptors/AsyncStorage) to /api/health and
  still times out at 20s → app networking code is NOT at fault; the device cannot complete an HTTPS
  connection to Cloudflare's edge on that network at that moment (DNS/TLS/route/captive-portal/ISP).
- Both primary + fallback are on the SAME Cloudflare edge (104.18.x), so DR failover cannot rescue a
  Cloudflare-path failure. Not a code bug — needs device/network confirmation (WiFi vs mobile data).

## FIX: Production Android APK "can't reach server" — Expo SDK 54 Hermes networking bug (Jun 2026)
Symptom: APK v1.0.33 /net-check showed ALL endpoints timeout(20s), on every network/location, while
the production backend was 100% healthy (curl /api/health → 200 in ~0.18s). Even the diagnostics
screen's BARE fetch() hung → not app-logic, not the network.
Root cause: Documented Expo SDK 54 regression — Hermes/New-Architecture Android `fetch()` hangs/fails
in production builds while working in Expo Go/web (github.com/expo/expo/issues/40061). Affects fetch
and anything on it (boot health probes in backend-health.ts, expo-auth-session, diagnostics, uploads).
axios is unaffected (RN axios uses its own XHR adapter).
Fixes applied:
1. `yarn expo install --fix` → expo 54.0.35→54.0.37 (+ expo-constants 18.0.14, expo-file-system
   19.0.24, expo-updates 29.0.20) which ship the official networking race-condition fixes.
2. Added Android-only XMLHttpRequest fetch polyfill (src/net/fetch-polyfill.ts) that replaces the
   broken Hermes global.fetch with an XHR-backed impl (different, working RN network stack). Installed
   FIRST via new custom entry: index.js imports src/net/install (side-effect) BEFORE expo-router/entry.
   package.json main changed expo-router/entry → index.js. iOS/web keep native fetch (no-op there).
VALIDATION: Cannot be tested in Expo Go/web preview (bug is production-build-only). User MUST redeploy
+ generate a fresh APK, then re-run Connection Diagnostics — pings should now turn green.
Escalation if still failing after rebuild: set app.json newArchEnabled:false (New-Arch is the root
trigger) — bigger change, kept as fallback.

## FIX (round 2): disabled New Architecture + confirmed rebuild requirement (Jun 2026)
User reported "same issue continues + diagnostic collapses to homepage" — but PREVIEW /net-check runs
green (87/84/97ms) and does NOT collapse. Confirms app code + backend are healthy; failure is specific
to the INSTALLED old APK (v1.0.33) which does NOT contain the previous fixes (fixes are build-time only).
Added the root-cause lever: app.json newArchEnabled true→false (New Architecture is the documented
trigger of the SDK 54 Hermes Android networking hang). Now the next build carries: expo 54.0.37 patch
+ Android XHR fetch polyfill + New Arch OFF.
CRITICAL: user MUST Publish (redeploy) → generate a NEW Android build → install it. The old installed
APK will behave identically until rebuilt. If a FRESH build still fails, escalate to Emergent support
(build/deploy/Cloudflare infra).

## FIX (round 3 — ACTUAL root-cause fix): route Android networking through expo/fetch (Jun 2026)
DIAGNOSIS (systematic): backend healthy (preview + prod /api/health = ok), no SDK version
mismatches, web/preview boots fine. User's REAL symptom on the installed APK = extreme LATENCY
(app + sections load only after minutes, every reload slow again), NOT a hard failure.
Per expo/expo#40061 maintainer thread: the SDK 54 Android bug makes BOTH global fetch AND
XMLHttpRequest (i.e. axios) extremely slow — "applies to any client we use". The confirmed fix is
expo/fetch (Expo's own native networking) — "if I use expo/fetch then it's not slow".
=> The round-1/2 XHR polyfill could NOT have fixed it: axios uses XHR (untouched by that shim) and
   XHR is ALSO affected. Round-2 newArchEnabled:false additionally broke the EAS build (reanimated
   requires New Arch) and was reverted.
CHANGES:
1. src/net/fetch-polyfill.ts — rewritten: global fetch on Android now routes http(s) → expo/fetch
   (fast), local file://data://blob:/Request → native fetch. iOS/web untouched. Fixes all RAW fetch()
   calls (backend-health probes, attachment/PDF downloads).
2. src/api.ts — axios instance now uses axios's BUILT-IN fetch adapter (via getFetch from
   'axios/unsafe/adapters/fetch.js') transported by expo/fetch on Android. Request:null forces the
   string-URL branch so expo/fetch (string-URL only) gets the URL directly. This is what actually
   makes API calls fast (axios default XHR adapter was the slow path).
VERIFIED: full Android JS bundle resolves (3128 modules; Hermes bytecode step only fails in THIS
container due to missing hermesc binary — runs fine on EAS). Web preview boots clean, no regression.
newArchEnabled stays TRUE.
VALIDATION: Android-only, build-time — user MUST Publish → generate a fresh Android build → install
it, then retest. Old installed APK will behave identically until rebuilt.

## FIX (round 4): self-contained expo/fetch axios adapter + axios-path diagnostics (Jun 2026)
CONTEXT: After round-3 (getFetch-based expo/fetch adapter) + the tarball-corrupt-file fix, user
rebuilt & installed the LATEST build — STILL slow ("Patient DB, Bookings, Dashboard load late /
reload everytime"). Ruled OUT: OTA reload loop (ota-updates.ts no longer reloads mid-session, only
on next cold launch); backend latency (prod urology-pro.emergent.host TTFB 0.1-0.5s from server).
=> Slowness is client-side on Android, and the getFetch deep-import adapter (relies on axios internals
   resolving under Hermes) could not be verified on-device.
CHANGES:
1. NEW src/net/expo-fetch-adapter.ts — hand-rolled, fully self-contained axios adapter backed by
   expo/fetch. Zero dependency on axios internals. Supports json/text/arraybuffer/blob, timeout,
   AbortSignal, validateStatus, AxiosError shape (so DR-failover interceptor + 410 handler still work).
2. src/api.ts — Android axios instance now uses expoFetchAdapter directly (replaced getFetch approach).
   iOS/web keep axios default adapter.
3. app/net-check.tsx — Connection Diagnostics now ALSO probes via the axios `api` instance
   ("App transport (axios) #1/#2") alongside raw-fetch pings, to localise slowness (network vs axios
   path) on the next build.
VERIFIED: Android JS bundle resolves (3099 modules); web preview boots, no regression; lint clean.
NOTE: expo export in THIS container creates a corrupt-named junk file when the Hermes bytecode step
fails (no runnable hermesc) — MUST delete it after any export (it breaks the EAS tarball upload).
VALIDATION: Android build-time only — user MUST rebuild + reinstall, then run Connection Diagnostics
and share the numbers. If axios rows are fast but screens still slow => app-level (re-fetch/render);
if all rows slow => device/network → escalate to Emergent support. testing_agent CANNOT reproduce
(Android-native-build-only bug; it tests web/preview which is unaffected).

## ROOT CAUSE IDENTIFIED (round 5): Cloudflare EDGE rate-limiting / bot-protection, NOT app code (Jun 2026)
User ran the new in-app Connection Diagnostics on-device (app v1.0.36, backend urology-pro.emergent.host,
backup NOT active). Results: /health ping#1 16882ms(200), ping#2 12513ms(429), ping#3 10277ms(429),
/auth/me 7434ms(429), /bookings/me 5195ms(429), /blog 4487ms(429), Dashboard 16075ms(200),
Patients registry 15007ms(429), Surgeries network error, Inbox 14860ms(200). Worst 16.9s. Both WiFi+data.
KEY DIAGNOSIS:
- Origin healthy & fast: curl prod /api/health = 0.1-0.5s TTFB; 15 concurrent burst = ALL 200 <1s, NO 429.
- Prod host is behind CLOUDFLARE: headers server:cloudflare, cf-ray:...-ORD, via:1.1 google.
- Our FastAPI CANNOT emit these 429s: slowapi Limiter default_limits=[] and /health has NO limit decorator,
  yet device gets 429 on /health. 429 bodies ~5KB (our app 429 JSON is tiny) => Cloudflare challenge/
  rate-limit HTML page.
CONCLUSION: Cloudflare edge rate-limiting / bot-protection on the production deployment throttles + 429s
the mobile client (likely IP/User-Agent bot rules) while origin is fine. NOT fixable via app code.
ACTION: Escalated via support_agent — user to email support@emergent.sh (Job ID + host + v1.0.36 +
diagnostics screenshots) requesting Cloudflare edge rate-limit/bot-protection review for
urology-pro.emergent.host. The earlier SDK54 expo/fetch work (round 3/4) stays in — harmless and correct
for the Hermes latency class — but the PRIMARY blocker is the Cloudflare edge, on Emergent's side.

## FEATURE: Encounter → Consultation → Billing unified worklist (Jun 2026)
Backend (encounters.py, receipts.py, prescriptions.py, models.py):
- Encounter model extended: ipss, inv_blood/psa/usg/uroflowmetry/ct/mri, investigation_findings,
  stage (open→in_consultation→completed), payment_status (pending/paid/waived), fee_amount, booking_date/time.
- GET /api/encounters/worklist — merges confirmed bookings WITHOUT an encounter (stage=to_start) +
  real encounters; returns items + counts{to_start,open,in_consultation,completed}. Clinic-scoped.
- POST /api/encounters/{id}/start-consultation — stage→in_consultation, stamps fee_amount from
  clinic consultation_fee_inr.
- POST /api/encounters/{id}/waive — PRESCRIBER only (is_prescriber); payment_status→waived.
- GET /api/encounters/{id}/billing — fee, linked receipts (by encounter_id) + patient receipt history.
- recompute_encounter_payment(): paid when linked receipts cover fee; waived never auto-cleared.
- mark_encounter_completed(): called from prescriptions finalize (create final / draft→final) when
  Rx carries encounter_id → stage=completed + prescription_id linked.
- ReceiptBody.encounter_id + PrescriptionCreate.encounter_id added; receipts.create recomputes
  encounter payment after insert.
Frontend:
- app/encounters/index.tsx REWRITTEN as reception worklist: filter chips (All/To Start/Open/In
  Consult/Completed w/ counts), stage chips + payment badges, per-row actions (Start Encounter /
  Edit intake / Start Consultation / Resume / View). "N pending actions today".
- app/encounters/new.tsx: added IPSS + Investigations (blood/psa/usg/uroflow/ct/mri + findings)
  sections; saved to encounter. Booking prefill via params.
- app/encounters/[id].tsx: stage + payment badges, IPSS/investigations display, Start/Resume
  Consultation (calls start-consultation → /prescriptions/new?encounterId), Billing block
  (Record payment → /billing/new?encounter_id, Waive [doctor only]).
- app/prescriptions/new.tsx: encounter prefill now carries vitals/IPSS/investigations; payload
  includes encounter_id so finalize auto-completes the encounter.
- app/billing/new.tsx: accepts encounter_id param, sends it in receipt payload.
VERIFIED (curl, owner token): create w/ ipss+inv → start-consultation(fee 500) → linked receipt
auto-marks paid → waive→waived → billing summary correct. Worklist renders (screenshot).
Seeded confirmed booking bk_wltest_* (today) for To-Start path testing.

## FEATURE: Daily Collection + Encounter-PDF billing + Pending-dues follow-up (Jun 2026)
Backend (routers/encounters.py):
- GET /api/encounters/collection-summary?date= — day-end summary across the day's encounters:
  collected (sum receipts.paid linked to those encounters), pending_due (sum fee for pending w/ fee>0),
  waived_total, counts{paid,pending,waived,total}, pending_list[]. IST day bounds via _ist_day_bounds_utc.
- GET /api/encounters/pending-dues?days=7 — unpaid encounters (payment_status=pending, fee>0) last N days;
  items + count + total_due. Reception day-end follow-up list.
Frontend:
- NEW app/encounters/collection.tsx — date stepper, 3 stat cards (Collected/Pending/Waived), today's
  unpaid follow-up list + carry-over (7d) list, each with "Collect" → /billing/new?encounter_id=...
- app/encounters/index.tsx — added "Collection" header button (testID wl-collection).
- src/encounter-pdf.ts — added Billing band to Visit Summary PDF: payment status tag (PAID/PENDING/
  WAIVED) + consultation fee + receipt no. EncounterDoc extended (payment_status, fee_amount, receipt_no).
- app/encounters/[id].tsx — load() now fetches /billing to get latest receipt_no; passed into
  buildEncounterHtml for both Export PDF and Send-WhatsApp.
VERIFIED (curl): collection-summary → collected 500, pending_due 1000, waived 500, counts, pending_list=2;
pending-dues count=2 total_due=1000. Collection screen renders (screenshot). PDF babel-compiles.

## FEATURE: Payment-mode drawer + Monthly revenue + Patient timeline (Jun 2026)
Backend (routers/encounters.py):
- collection-summary now returns `drawer` = ALL receipts dated `day` (clinic-scoped) grouped by
  normalized mode (Cash/UPI/Card/Wallet/Cheque/Other) via _norm_mode + _drawer_by_mode → {total, modes[]}.
- GET /api/encounters/revenue-report?month=YYYY-MM — OWNER-tier only (role in super_owner/primary_owner/
  owner/partner else 403). Returns collected/waived_total/outstanding + counts + per-day series[].
- GET /api/encounters/patient-timeline?phone=&encounter_id= — {phone, visits[] (encounters), receipts[]}
  clinic-scoped, newest first.
Frontend:
- app/encounters/collection.tsx — "Drawer by mode" section (mode chips w/ amount+txn count); owner-only
  "Month" header button → /encounters/revenue.
- NEW app/encounters/revenue.tsx — month stepper, Collected/Outstanding/Waived cards, counts, per-day
  stacked bars (collected/outstanding/waived).
- NEW app/encounters/timeline.tsx — patient summary (visits/paid/due), Visits list (→ encounter detail),
  Receipts list (→ billing detail).
- app/encounters/[id].tsx — "Patient history & billing" button → /encounters/timeline?phone=&name=.
VERIFIED (curl): drawer total 1500 Cash; revenue-report collected 500/waived 500/outstanding 1000, 3
series days; patient-timeline 1 visit + 2 receipts. Screenshots: revenue + timeline render correctly.

## FEATURE: Revenue report Share-PDF + month-over-month Compare (Jun 2026)
Frontend-only (no new backend; reuses GET /encounters/revenue-report per month + src/pdf-share
sharePdfFromHtml + src/rx-pdf loadClinicSettings):
- app/encounters/revenue.tsx:
  - load() now also fetches PREVIOUS month's report (Promise.all) → Compare card: "Up/Down X% vs
    <prev month>", this vs last collected + delta, green/red trend styling.
  - "Share PDF" header button (testID rev-share) → buildReportHtml(rep, prev, label, prevLabel,
    clinicSettings) → sharePdfFromHtml (opens native share sheet: WhatsApp/email/save). HTML includes
    clinic name, month, 3 summary cards, compare line, and per-day table.
VERIFIED: screenshot shows Share PDF button + compare card ("Up 100% vs Jul 2026, ₹500 vs ₹0 (+₹500)").
Lint/babel clean.

## FIX: Push-registration flood → Cloudflare 429s — persistent cooldown guard (Jun 2026)
Production reported registerV2Installation() (src/comm-v2/installation.ts) firing thousands of
times/hour (boot + login + FCM token-rotation listener), tripping Cloudflare's rate limiter → 429s
→ app slow/broken. Fix (client-side only, native path):
- Added a cooldown guard INSIDE registerV2Installation (covers every caller automatically).
- last-attempt timestamp + consecutive-failure count persisted to SecureStore (survives kill/relaunch).
- Guard runs BEFORE any work: within cooldown → returns {ok:false, reason:'cooldown'}, no network call.
- Timestamp stamped BEFORE the api.post (not after) so a crash mid-request still enforces cooldown.
- Exponential backoff on repeated failures: base 5m → 10m → 20m → 40m → 60m cap; reset to base on
  a successful backend response.
- No Cloudflare/edge/tier changes (per user). Native-only path (web short-circuits) → not
  web-testable; needs a new build/OTA to reach the installed app.

## FIX: Encounter payment status not updating + Push deep-links + Duplicate Review (Jun 2026)
Three user-reported items:
1. **Encounter payment status not updating after recording a payment — FIXED.** Backend chain
   (POST /api/receipts w/ encounter_id → recompute_encounter_payment) was already correct (curl-
   verified: flips encounters.payment_status pending→paid). Root cause was FRONTEND stale cache:
   billing/new.tsx never invalidated the worklist/encounters SWR cache after saving a receipt, so
   /encounters rows kept showing "Payment pending". Fix: billing/new.tsx now calls
   invalidateCached('worklist:')+('encounters:') on a successful save when payload.encounter_id is
   set. Encounter detail already reloaded via useFocusEffect. Verified (testing iteration 35):
   badge flips to "Paid" on BOTH detail + worklist. (Billing prefills default consultation_fee_inr
   when the encounter has no fee, so ₹0 receipts aren't an issue.)
2. **Push notification deep-links — FIXED (native-only, needs build to verify).** app/_layout.tsx
   push-tap handler only routed legacy `type`/`link` payloads; Comm V2 pushes carry `inbox_action`
   + target ids and were a no-op on tap. Added V2 routing: type='v2_message'/inbox_action=
   'open_conversation' → /comm-v2/conversations/[id]; inbox_action='open_broadcast' →
   /comm-v2/broadcasts/[id] (else /comm-v2/inbox); any other V2 inbox_action → /comm-v2/inbox. Also
   added type='receipt_issued' → /receipts/[id], and the generic fallback now honours `deep_link`
   (not just `link`). V2 pushes only fan out to canary users so V2 screens are unlocked for them.
   NOT web-testable (native push) — requires a new build/OTA to validate on device.
3. **Duplicate Review Tool — ALREADY SHIPPED, verified.** admin/dup-merge.tsx (owner-only,
   reachable via More → "Dup-Merge Accounts" and web-shell) already has the quarantined email/phone
   Merge/Restore section backed by GET /api/admin/users/quarantined-duplicates + POST
   /api/admin/users/resolve-quarantine. Renders cleanly for owner (testing iteration 35).

## FIX: PDF branding (header overlap / footer dup) + settings-driven + speed (Jun 2026)
User: receipt PDF header had overlapping text (wrapped doctor tagline collided with the clinic
line), footer duplicated the clinic name, PDF gen felt slow, and all branding must come from
Branding & Settings.
- **Header overlap FIXED (receipt-pdf.ts).** The receipt header used `align-items:stretch` +
  `justify-content:center` without `flex:1 1 auto; min-width:0`, so the wrapped tagline overlapped
  the next line. Rewrote `.head/.brand/.brand .info/.brand p/.meta` to mirror the proven rx-pdf
  flex layout (min-width:0, flex-start, line-height 1.4). Verified via standalone render: 5 header
  lines stack cleanly, no overlap.
- **Footer duplication FIXED.** Footer was `clinicName · clinicAddr`, but the address field already
  begins with the clinic name → "ConsultUro Clinic · ConsultUro Clinic, Gotri…". Added `footerClinicLine`
  dedupe: if the address already contains the clinic name, show the address alone.
- **Settings-driven branding.** receipt-pdf.ts + rx-pdf.ts no longer hardcode "Dr. Sagar Joshi" /
  "Consultant Urologist, Laparoscopic & Transplant Surgeon" / "Sagar Joshi" signature — all pulled
  from settings (`doctor_name`, new `doctor_title`, degrees, reg-no, signature). Added `doctor_title`
  to ClinicSettings type + loadClinicSettings (from clinic_settings.doctor_title / homepage). Other
  PDFs (encounter/discharge/cert/consent) already read clinic name/address/degrees/doctor_name from
  settings.
- **Speed.** loadClinicSettings() fired 3 API round-trips on EVERY PDF export (~1.5s on prod). Added
  a 5-min in-memory cache + `invalidateClinicSettingsCache()` (called from branding-panel &
  homepage-panel saves) so back-to-back exports reuse one fetch and edits still reflect immediately.

## FIX: Sanskrit tofu on receipt + clinic-name branding on every PDF (Jun 2026)
- **Sanskrit mantra rendered as boxes (tofu) on the receipt footer — FIXED.** receipt-pdf.ts
  `.centerSanskrit` had NO Devanagari font-family (inherited 'Inter' → missing-glyph boxes). Added a
  Devanagari font stack ('Noto Serif Devanagari','Sanskrit Text','Kohinoor Devanagari','Mangal',…)
  so real devices render from their system Devanagari font, PLUS a Google Fonts <link> (Noto Serif
  Devanagari) in the <head> of BOTH receipt-pdf.ts and rx-pdf.ts so web/desktop exports (which lack
  a local Devanagari font) also render. rx-pdf's stack reordered to prefer 'Noto Serif Devanagari'.
  Verified via standalone render: "सर्वे सन्तु निरामयाः" renders correctly.
- **Clinic name on EVERY PDF — gap fixed.** All PDFs display the owner-set clinic_name in the header:
  rx/receipt/encounter (`settings.clinic_name`), discharge main export + medical cert (map
  cs.clinic_name→clinic.name), consent (settings.clinic_name). The ONE gap was the IPD
  Overview-tab discharge export (src/ipd/tabs/overview-tab.tsx) which called
  buildDischargeSummaryHtml(ds) with NO clinic → defaulted to "ConsultUro Clinic". Now loads
  clinic settings (cached loadClinicSettings) and passes {name, address, phone, doctor_*,
  letterhead, signature} so it brands with the owner's clinic name like the other exports.

## FIX: Appointment push delivery + deep-link + booking success i18n + history collapse (Jun 2026)
1&2. **Appointment pushes not delivered + tap didn't open the appointment — FIXED (native-only).**
   Root cause: booking events (new_booking, confirmed, rejected, cancelled, rescheduled, completed,
   reminder) fire via legacy push_to_user/push_to_owner (Emergent relay → Expo fallback), but the
   deployed app registers its REAL native token via the Comm-V2 FCM pipeline (comm_installations),
   and the Expo fallback can't send to native FCM tokens. Added a Comm-2 FCM v1 fanout to BOTH
   push_to_user and push_to_owner (services/notifications.py): when the relay isn't configured /
   delivers nothing, enqueue a comm_outbox 'push.send' (aggregate_type 'legacy_push', payload
   {user_id,title,body,category,data}) so the FCM v1 handler delivers to the registered device.
   Gracefully no-ops when comm_fcm not configured (preview). Verified confirm flow returns 200 with
   no errors.
   Deep-link (app/_layout.tsx): booking_confirmed/rejected/cancelled/completed/note/rescheduled/
   reminder/missed now open /bookings/[id] (the concerned appointment) via data.booking_id (fallback
   /my-bookings); new_booking/booking_cancelled_by_patient open /bookings/[id] for staff (fallback
   /dashboard). /bookings/[id] already supports the patient (non-staff) view.
   NOTE: push DELIVERY is native-only — verify on a rebuilt device build.
3. **Booking success screen showed raw i18n keys — FIXED.** Added missing book.* keys to
   en/hi/gu (whatsNext, nextBodyInPerson, nextBodyOnline, call, directions, addEmail,
   emailNeededTitle, cancel). Verified: readable text now shows. (testing iter 36 PASS)
4. **Same-patient history reordered + collapsible — FIXED.** app/bookings/[id].tsx: moved the
   'Same patient history' card to the BOTTOM (after Actions), wrapped in a collapsible
   (historyExpanded state, default COLLAPSED) with a chevron toggle (testIDs bk-history-toggle,
   bk-history-card, bk-history-row-*). Verified expand/collapse (testing iter 36 PASS).

## FIX: Video-consultation attachments — can't attach PDF + blank/no-op open (Jun 2026)
Booking detail (/bookings/[id]) 'Reports & images' card (src/video/AttachmentsCard.tsx):
- ROOT CAUSE 1: component imported the NEW expo-file-system v19 (`import * as FileSystem from
  'expo-file-system'`) but called legacy APIs (readAsStringAsync / writeAsStringAsync /
  cacheDirectory / EncodingType) which the v19 root no longer exports → threw on device →
  (a) PDF pick read failed = "can't attach PDF", (b) openFile write threw silently = "does nothing
  on installed app". Fixed by importing `expo-file-system/legacy` (same as src/attachments.ts).
- ROOT CAUSE 2 (web open blank popup): openFile did `window.open('data:...;base64,...')` — browsers
  BLOCK top-level navigation to data: URLs → blank popup. Fixed: build a Blob → object URL →
  window.open(url) with an anchor-download fallback if the popup is blocked. Revoke after 60s.
- ROOT CAUSE 3 (PDF upload on web): pickDocument read base64 via FileSystem.readAsStringAsync which
  is native-only → failed in the browser. Added readAssetBase64() that uses FileReader on web
  (asset.file / fetch(uri).blob()) and expo-file-system on native.
- Native open now uses Sharing.shareAsync (system "Open with…") instead of Linking.openURL(file://)
  which Android rejects.
- Verified on WEB (testing iter 37): PDF chip → blob download, image thumb → real blob: tab, 0
  console errors. Native path uses the proven expo-sharing pattern — verify after a rebuild.

## REVAMP: Patient Database screen (src/home/staff-patient-db.tsx) (Jun 2026)
User: two buttons (Directory tile + Invite-conversion tile) both opened the SAME /patients page — keep
only ONE (Directory); conversion analytics chip should show ONLY on the Directory page; put search +
filters on one line (search ¾ left, filters ¼ right); make a compact space-saving Directory button.
- Removed the redundant big "Invite → sign-up conversion" tile from the Patient DB home (the chip
  already lives on the Directory page /patients/index.tsx — now shown ONLY there). Also removed the
  now-unused analytics fetch/state here.
- Replaced the large "Patient directory" tile with a COMPACT header pill (people icon + "Directory" +
  a small badge showing the unregistered count) → saves a full card's height. testID
  patient-db-open-directory preserved.
- Export CSV button condensed to a compact icon-only button beside the Directory pill.
- Search + Filters now share one row (styles.controlsRow): search input flex:3 (¾) left, a Filters
  dropdown button flex:1 (¼) right showing the active month (or "All") with options/chevron icons.
  Replaced the horizontal month "pills" scroller with a Modal month picker (FilterOption rows,
  checkmark on active). testIDs patient-db-filter, patient-db-filter-opt-*.
- Verified on web (desktop shell): single Directory pill w/ badge, one-line search+filter, modal opens
  and lists All months + last 6 months. Renders full-width on mobile (flexbox).

## FEATURE: Quick status filter chips on Patient Database (Jun 2026)
Added one-tap status chips inside the Filters dropdown of the Patient DB (src/home/staff-patient-db.tsx):
All / Registered / Unregistered / Has dues.
- Backend: /api/patient-db/list (+ /export) now accept `status` = registered|unregistered|has_dues.
  registered/unregistered reuse patient_registry._get_registered_sets() (phone_digits/email match
  against patient user accounts). has_dues = patients whose phone_digits appear in confirmed bookings
  with an outstanding balance (payment_status pending_offline/missing/null/"" AND paid_offline!=True).
  Search/month/status combined via $and so clauses don't clobber. Verified: All=11, registered=2,
  unregistered=9, has_dues=1.
- Frontend: `status` state wired into list + export params; Filters modal shows a Status chips row +
  Month list + "Clear all" + "Done"; the ¼-width Filters button reflects active state ("Has dues",
  a month label, or "2 filters"). Verified on web: selecting "Has dues" filtered to the 1 due patient.

## FIX: Patient invite link → consulturo.com (Jun 2026)
User: bulk-invite from Unregistered list works, but the invite LINK was wrong/not working; they've
routed consulturo.com → the Vercel web app.
- Root cause: both single invite (routers/patient_registry.py) and bulk invite
  (routers/patient_registry_bulk.py) built the join_url from the BACKEND/preview host
  (urology-pro.preview.emergentagent.com), and the email path used the backend HTML bridge
  /auth/magic/redirect whose relative /magic-link link breaks when frontend & backend are on
  different domains.
- Fix: added _public_app_url() = env PUBLIC_APP_URL or default https://consulturo.com. Invite links
  now:
    • phone-first  → {app_url}/login?ref=walkin
    • email        → {app_url}/magic-link?token=... (Vercel web app's /magic-link screen exchanges
                     the token via the API and signs in), deep link consulturo:///magic-link?token=
  Applied to BOTH single and bulk endpoints. Verified via curl + UI: invite modal shows
  https://consulturo.com/login?ref=walkin; bulk (/registry/invites/bulk) returns consulturo.com links.
- Bulk Invite itself already existed end-to-end (Directory /patients → "Select" multi-select →
  /registry/invites/bulk → queue with per-patient WhatsApp/SMS send). No new UI needed.
- NOTE for deploy: PUBLIC_APP_URL overrides the domain; the Vercel build's EXPO_PUBLIC_BACKEND_URL
  must point to the production backend so /login OTP + /magic-link token exchange work.

## FEATURE: Invite Follow-up — auto-flag stale invites for re-invite (Jun 2026)
Patients invited ≥7 days ago who still haven't signed up are auto-flagged for a gentle re-invite.
- Backend (routers/patient_registry.py):
  • GET /registry/patients now accepts registration_status=stale_invite (unregistered + invited_at
    ≤ now-7d) and annotates EVERY row with a computed `needs_reinvite` boolean (tz-safe parse of
    invited_at as datetime OR ISO string; excludes registered patients).
  • GET /registry/patients/summary now returns `stale_invite` count for the tab badge.
- Frontend Directory (app/patients/index.tsx):
  • New "Re-invite · N" tab (TAB_STATUS maps it → stale_invite) between Unregistered and Registered.
  • Orange "re-invite" chip on any row where needs_reinvite (shown in place of the green "invited"
    chip). New styles reinviteChip/reinviteTxt.
  • Per-row Invite action now shows in BOTH unregistered + reinvite tabs (labelled "Re-invite" in the
    reinvite tab); existing bulk Select→/registry/invites/bulk works in this tab too.
  • Optimistic updates clear needs_reinvite (and bump invite_count) after (re)inviting so the badge
    and tab reflect immediately.
- Verified (backend curl + web UI): backdated NoteTest → summary stale_invite=1, Re-invite tab lists
  it with the badge + Re-invite button; needs_reinvite=True.

## FIX+FEATURE: Dashboard crash-hardening, tab-bar trim, Directory fix, Video UX (Jun 2026)
User report: on the PRODUCTION Android APK the Dashboard, My Bookings and My Records
"crash" back to the Home tab; also wanted the Dashboard lightened (keep Analytics) and a
Video-consultation UX polish. Root-cause of the "crash-to-home": a NATIVE crash (JS bundle
reload → Expo Router lands at "/"), most consistent with memory pressure from the dashboard
keeping every visited panel mounted for the whole session + two screens lacking a top-level
error boundary.

Changes (frontend only):
- src/dashboard/content-pager.tsx: WINDOWED mounting. Previously every visited panel stayed
  mounted forever (all ~13). Now only the active tab ± 1 neighbour stays mounted; far panels
  are UNMOUNTED to release memory (native views, cached payloads, timers). Bounds peak memory
  to 3 panels → removes the OOM that dumped users to Home.
- app/dashboard.tsx:
  • Trimmed the horizontal tab bar to 6 PRIMARY tabs (Today, Bookings, Consults, Rx,
    Availability, Analytics — module-scoped PRIMARY_TAB_IDS). Analytics KEPT per user.
  • Less-frequent tabs (Surgeries, IPD, Referrers, Invites, Broadcasts, Team, Notifs, Backups)
    are reached from the More tab + web sidebar (already deep-link via /dashboard?tab=X) and
    still render on demand.
  • barTabs = primary + a PINNED `extraTabId`. extraTabId is stored in its OWN state (set when
    `tab` becomes non-primary) so a transient tab change (web pager scroll-settle) can never
    drop the deep-linked tab's pill / unmount its panel. Passed to BOTH the tab bar and
    ContentPager.
  • Guarded `user.name.split(' ')` → `(user.name || '')` (hard-crash if name ever missing).
  NOTE (web-preview only): ContentPager's web `onScroll` settle can mis-land the horizontal
  page for a deep-linked non-primary tab (shows a primary panel's content). Native is
  unaffected — settle fires only on real gestures (onMomentumScrollEnd/onScrollEndDrag), never
  on programmatic scrollTo — so ?tab=surgeries/broadcasts/team open the correct panel on device.
- app/my-bookings.tsx & app/my-records.tsx: bodies wrapped in a top-level AppErrorBoundary
  (label + onBack) — a render error now shows the "Try again / Go back" card instead of
  appearing to crash to Home. (Dashboard already had one.)
- app/patients/index.tsx: FIXED "setUpdatedAt is not defined" crash left over from the WIP
  Directory refactor — added the missing `updatedAt` state + rendered <UpdatedHint>. Directory
  layout confirmed: Analytics conversion chip pinned top, Search (¾) + Filters dropdown (¼) on
  one row.
- app/video/[code].tsx (in-call screen): Leave button re-themed to a COLORS.primary pill with
  "Leave" label, repositioned to insets.top+12 so it clears the notch/status bar; callShell
  padded by safe-area top+bottom so the 100ms WebView controls clear the Android home/gesture bar.

Verified: iteration_38 frontend testing PASS for dashboard 6-tab bar, tab switching, /my-bookings,
/my-records, /patients (no setUpdatedAt error). Deep-link pinned-pill regression fixed & re-verified
via screenshots. Video screen: lint clean; visual verify recommended on a real device (no live 100ms
room code in seed).

STILL BLOCKED (infra, not code): production Android network timeouts / 429s = Cloudflare edge block —
requires Emergent Support escalation. Fixes above apply to PREVIEW; user must redeploy for APK.
