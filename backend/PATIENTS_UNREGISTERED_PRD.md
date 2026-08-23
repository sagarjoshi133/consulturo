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
