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

