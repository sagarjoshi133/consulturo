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
