# Patient Autofill & Unregistered Patients (Session 2026-08-23)

## Goal
1. **Autofill contact details** for logged-in patients on the booking form
    so a patient can book their own visit without re-typing name/phone.
    Every field stays fully editable so the same patient can book for
    a family member.
2. **Unregistered Patients** — surface guest / walk-in / phone-in
    patients (who booked but never signed up) inside the Patients tab
    so staff can invite them later.

## Backend

### Data model (no new collections)
Reuses the canonical `patients` registry (Phase D).
Definition: a patient is **registered** iff a `users` doc exists
whose phone (last-10 digits) OR email matches the patient's row.
Complement = **unregistered**.

### New endpoints
```
GET /api/registry/patients?registration_status=all|registered|unregistered
    &q=<search>&limit=&skip=
GET /api/registry/patients/summary
    → {total, registered, unregistered}
```

### Implementation
`routers/patient_registry.py::search_patients` now materialises the
"registered set" of (phone_digits, email) via a single `users`
sweep, then applies a `$in`/`$nin` filter to the existing patient
search. `/summary` re-uses that logic with `count_documents`.

## Frontend

### Booking form (`app/(tabs)/book.tsx`)
`useEffect` watches the logged-in `user`. If `role === 'patient'`
(or empty), the fields `patientName`, `phone`, `age`, `gender` are
prefilled from the user's profile ONCE. Every field remains fully
editable. Staff / owner accounts are exempt (they always type the
patient's number).

### Patients directory (`app/patients/index.tsx`)
Brand new browsable list with three pill tabs:
`Unregistered · N`   `Registered · N`   `All · N`.
- Pill counts are hydrated from `/summary`.
- Search box narrows within the current tab.
- Each row shows name, phone, email, age, gender, reg_no.
- "Book" quick-action deep-links to `/book?phone=…&name=…`.
- Contextual banner on the Unregistered tab explaining what they are
    and inviting staff to convert them.

### Entry point (`src/home/staff-patients-screen.tsx`)
The existing staff Patients tab (a phone-search shortcut) now has a
"Patient directory" tile at the top opening `/patients` directly.

## Smoke test
`tests/smoke_unregistered_patients.py` — HTTP end-to-end:
    * all|registered|unregistered filters
    * summary totals invariant
    * 400 for invalid registration_status
    * cleanup preserves DB state
PASSING.

## No new collections. No migration required.
Legacy bookings already stamp `patient_id` via `resolve_patient_id`,
so every historical guest booking already has a canonical registry
row waiting to appear on the Unregistered tab.

---

## Invite Walk-Ins & Duplicate Detection (Session 2)

### Backend

`POST /api/registry/patients/{patient_id}/invite`
  * Returns a share-ready payload — never sends anything itself.
  * Fields: `join_url`, `share_message`, `wa_url`, `sms_uri`,
    `mailto_uri`, `invited_at`.
  * When the patient has an email → issues a 7-day magic-link
    token in `db.auth_magic_tokens` with kind=`walkin_invite`, so
    the sign-in flow is truly one-tap on the receiving device.
  * When only a phone is on file → falls back to the /login web
    URL (OTP path).
  * Stamps `invited_at`, `invited_by`, bumps `invite_count` on
    the registry row.
  * 400 when both phone and email are missing.

`GET /api/registry/patients/{patient_id}/duplicates`
  * Non-invasive detection (only READS the registry).
  * Signals:
    - **STRONG** — same `phone_digits` (last-10) or `email`.
    - **WEAK**   — normalised name-token overlap (first two tokens)
      only when phone/email don't CONFLICT.
  * Excludes self + rows already merged.
  * Returns `[{...patient, confidence, reasons[]}, ...]`.

Existing `POST /api/registry/patients/{keep_id}/merge` unchanged —
the frontend pipes into it directly with the surfaced `duplicate_patient_id`.

### Frontend

Patients directory (`app/patients/index.tsx`) now shows two extra
buttons on every card:

  * **Invite** (Unregistered tab only) → opens a bottom-sheet with
    five channel buttons: WhatsApp, SMS, Email (mailto), native
    Share…, Copy link. Once invited, the card gains a subtle green
    "invited" chip.
  * **Duplicates** (all tabs) → opens a bottom-sheet listing the
    candidate rows with STRONG/WEAK confidence tags and a
    "Merge into this" action per row. Merges are guarded by a
    web-confirm / native destructive Alert, then optimistically
    remove the merged row from the list and refresh the summary.

### Smoke tests
`tests/smoke_walkin_invite_merge.py` — 9 assertions covering all
three channels per patient shape, `invited_at`/`invite_count`
stamping, no-contact 400, STRONG phone dup, WEAK name dup, unrelated
name excluded, merge absorbs, and merged rows drop out of the next
duplicates fetch. PASSING.

---

## Bulk Invites & Invite Analytics (Session 3)

### Backend (`routers/patient_registry_bulk.py`)

`POST /api/registry/invites/bulk`
  * Body: `{patient_ids[], template_id?, send_via_wa_business?}`
  * Uses `_build_invite_payload()` on every ID — same magic-link /
    wa.me / SMS / mailto generation as the single-patient endpoint.
  * When `template_id` is supplied, its `title + body` becomes the
    override message (bumps template use_count / last_used_at just
    like the single-apply endpoint).
  * Records a batch doc in `walkin_invite_batches` for the audit
    trail: `{batch_id, template_id, template_snapshot, patient_ids,
    ok_count, error_count, created_by, created_at,
    send_via_wa_business_requested}`.
  * Returns `{ok_count, error_count, results[]}` where each result
    contains the share payload OR an `error` code (`no_contact`,
    `not_found`, `invite_failed`).
  * `send_via_wa_business` is accepted but silently falls back to
    queue mode (placeholder for future WA Business API integration).

`GET /api/registry/invites/analytics`
  * "Any signup with matching phone/email AFTER invited_at counts as
    conversion." Users created BEFORE invited_at (pre-existing accounts)
    are NOT counted.
  * Returns `{total_invited, invites_last_7d, invites_last_30d,
    converted_total, converted_within_7d, converted_within_30d,
    conversion_rate_total, conversion_rate_7d, conversion_rate_30d}`.
  * TZ-safe: coerces every Mongo datetime to UTC-aware before comparing.

`GET /api/registry/invites/batches?limit=`
  * Lists the last N bulk-invite batches with counts + template
    snapshot. Redacts `patient_ids` (only `patient_count` is
    surfaced) to keep the payload lean.

Route paths intentionally live under `/registry/invites/*` — putting
them under `/registry/patients/*` would have been captured by the
existing parametric `/registry/patients/{patient_id}` route.

### Frontend

Patients directory (`app/patients/index.tsx`):
  * **Analytics tile** at the top of the screen (hidden when
    total_invited=0), showing overall conversion + 7d/30d deltas.
    Tap-through anchor is the screen itself for the MVP.
  * **Multi-select mode**:
    - Enter via "Select" button (Unregistered tab only) OR long-press
      on any walk-in card.
    - Cards render a checkbox instead of the avatar; row background
      turns primary-tinted when selected.
    - Sticky bottom bar shows count + "Bulk Invite" CTA.
  * **Template picker sheet** (opens on "Bulk Invite"):
    - "Default invite text" row + one row per active Broadcast Studio
      template (via `/v2/communications/broadcast-templates`).
    - Tap = fire `/registry/invites/bulk` and swap to queue view.
  * **Queue view**:
    - Per-patient row with a small WA / SMS / Email button that
      opens the pre-filled compose sheet on the OS.
    - Errored patients show a red hint ("no phone/email on file", etc).
    - "Done" closes the flow and exits select mode.

Owner dashboard card (`src/home/super-owner-home.tsx`):
  * "Invite → sign-up" card between platform-stats and demo accounts,
    only rendered when total_invited > 0.
  * Shows "X of Y walk-ins signed up · 42% conversion · Last 7d: A ·
    30d: B".
  * Tap → deep-links to `/patients` so owner can see the underlying
    list.

### Smoke test
`tests/smoke_walkin_bulk_analytics.py` — 8 HTTP assertions:
  * bulk invite with template override (3 ok / 2 errors mixed)
  * invited_at + invite_count stamped for every processed patient
  * template use_count + last_used_at bumped
  * batch doc persisted
  * /invite-batches lists the new batch
  * analytics baseline snapshot
  * conversion count jumps by exactly 1 after simulating a signup
  * pre-existing users (created BEFORE invite) NOT counted
  PASSING.


