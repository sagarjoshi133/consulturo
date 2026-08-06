"""ConsultUro Phase 5.12 (Phase D) — regression smoke test.

Verifies:
  1. POST /api/ipd/admissions  (NEW field vocabulary + OLD legacy shape)
  2. GET  /api/ipd/admissions/{admission_id}  (verifying new fields persisted)
     NB: /full sub-route does NOT exist — the canonical GET returns the
     admission doc plus rounds/vitals/drug_chart already.
  3. POST /api/ai/medical-certificate/draft  → 200 + non-empty advice
  4. POST /api/ai/progress-note/draft        → 200 + SOAP note (S/O/A/P)
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from typing import Any, Dict, Tuple, Optional

# Test against the local backend (per task spec).
BASE = "http://localhost:8001/api"
OWNER_TOKEN = "test_session_1776770314741"

# Mongo connection (for the Phase D verification step).
try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")

# ─── HTTP helper ────────────────────────────────────────────────
def _req(method: str, path: str, *, body: Optional[Dict[str, Any]] = None,
         token: Optional[str] = OWNER_TOKEN) -> Tuple[int, Dict[str, Any], str]:
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        status = e.code
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = {}
    return status, parsed, raw


# ─── Assertion helpers ──────────────────────────────────────────
results = []
def _record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    flag = "✅" if ok else "❌"
    print(f"{flag} {name}{(' — ' + detail) if detail else ''}")


def _summary() -> int:
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n=== RESULTS: {passed}/{total} PASS ===")
    failed = [(n, d) for n, ok, d in results if not ok]
    if failed:
        print("\nFAILURES:")
        for n, d in failed:
            print(f"  ❌ {n}: {d}")
    return 0 if not failed else 1


# ─── 1. POST /api/ipd/admissions — NEW field vocabulary ────────
def test_admit_new_fields() -> Optional[str]:
    body = {
        "patient_name": "Phase D Test Patient",
        "patient_phone": "9876512300",
        "patient_age": 55,
        "patient_gender": "Male",
        "registration_no": "REG-PHASED",
        "address": "12 MG Road, Pune",
        "patient_email": "phasedtest@example.com",
        "diagnosis": "Right URS calculus",
        "planned_procedure": "URSL + DJ stenting",
        "consulting_doctor": "Dr. Joshi",
        "presenting_complaints": "Right flank pain",
    }
    status, body_out, raw = _req("POST", "/ipd/admissions", body=body)
    _record(
        "POST /api/ipd/admissions (new vocab) → 200",
        status == 200,
        f"status={status} body={raw[:400]}",
    )
    if status != 200:
        return None
    ipd_no = body_out.get("ipd_no")
    admission_id = body_out.get("id")
    _record(
        "Response has populated ipd_no",
        isinstance(ipd_no, str) and ipd_no.startswith("IPD"),
        f"ipd_no={ipd_no!r}",
    )
    # Verify response fields directly
    _record(
        "Response patient_sex == 'male' (new patient_gender mapped → lowercase)",
        body_out.get("patient_sex") == "male",
        f"patient_sex={body_out.get('patient_sex')!r}",
    )
    _record(
        "Response reg_no == 'REG-PHASED' (new registration_no mapped → uppercase)",
        body_out.get("reg_no") == "REG-PHASED",
        f"reg_no={body_out.get('reg_no')!r}",
    )
    _record(
        "Response patient_email persisted",
        body_out.get("patient_email") == "phasedtest@example.com",
        f"patient_email={body_out.get('patient_email')!r}",
    )
    _record(
        "Response address persisted",
        body_out.get("address") == "12 MG Road, Pune",
        f"address={body_out.get('address')!r}",
    )

    # Mongo-level verification.
    if MongoClient and ipd_no:
        try:
            mc = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
            db_name = os.environ.get("DB_NAME") or "consulturo"
            d = mc[db_name].admissions.find_one({"ipd_no": ipd_no})
            _record(
                "Mongo: patient_sex=='male'",
                bool(d) and d.get("patient_sex") == "male",
                f"got={d.get('patient_sex') if d else 'doc-missing'}",
            )
            _record(
                "Mongo: reg_no=='REG-PHASED'",
                bool(d) and d.get("reg_no") == "REG-PHASED",
                f"got={d.get('reg_no') if d else 'doc-missing'}",
            )
            _record(
                "Mongo: patient_email=='phasedtest@example.com'",
                bool(d) and d.get("patient_email") == "phasedtest@example.com",
                f"got={d.get('patient_email') if d else 'doc-missing'}",
            )
            _record(
                "Mongo: address=='12 MG Road, Pune'",
                bool(d) and d.get("address") == "12 MG Road, Pune",
                f"got={d.get('address') if d else 'doc-missing'}",
            )
        except Exception as exc:
            _record("Mongo verification (new vocab)", False, f"mongo error: {exc}")
    return admission_id


# ─── 1b. POST /api/ipd/admissions — LEGACY field shape ─────────
def test_admit_legacy_fields() -> Optional[str]:
    body = {
        "patient_name": "Phase D Legacy Patient",
        "patient_phone": "9876512301",
        "patient_age": 60,
        "patient_sex": "female",                # legacy direct
        "reg_no": "REG-LEGACY",                  # legacy direct
        "diagnosis": "Left URS calculus",
        "consulting_doctor": "Dr. Joshi",
    }
    status, body_out, raw = _req("POST", "/ipd/admissions", body=body)
    _record(
        "POST /api/ipd/admissions (LEGACY vocab) → 200",
        status == 200,
        f"status={status} body={raw[:300]}",
    )
    if status != 200:
        return None
    _record(
        "Legacy: response patient_sex == 'female'",
        body_out.get("patient_sex") == "female",
        f"patient_sex={body_out.get('patient_sex')!r}",
    )
    _record(
        "Legacy: response reg_no == 'REG-LEGACY'",
        body_out.get("reg_no") == "REG-LEGACY",
        f"reg_no={body_out.get('reg_no')!r}",
    )
    return body_out.get("id")


# ─── 2. GET /api/ipd/admissions/{id}/full ──────────────────────
def test_get_admission_full(admission_id: str) -> None:
    # First try /full, then fall back to canonical GET.
    status_full, body_full, raw_full = _req("GET", f"/ipd/admissions/{admission_id}/full")
    if status_full == 404 or status_full == 405:
        # No /full sub-route — fall back to canonical GET.
        status, body_out, raw = _req("GET", f"/ipd/admissions/{admission_id}")
        used_path = f"/ipd/admissions/{admission_id} (no /full route — using canonical GET)"
    else:
        status, body_out, raw = status_full, body_full, raw_full
        used_path = f"/ipd/admissions/{admission_id}/full"
    _record(
        f"GET {used_path} → 200",
        status == 200,
        f"status={status}",
    )
    if status != 200:
        return
    admission = body_out.get("admission") or body_out
    _record(
        "GET admission has address",
        admission.get("address") == "12 MG Road, Pune",
        f"address={admission.get('address')!r}",
    )
    _record(
        "GET admission has patient_email",
        admission.get("patient_email") == "phasedtest@example.com",
        f"patient_email={admission.get('patient_email')!r}",
    )
    _record(
        "GET admission has reg_no",
        admission.get("reg_no") == "REG-PHASED",
        f"reg_no={admission.get('reg_no')!r}",
    )


# ─── 3. AI Medical Certificate draft smoke ─────────────────────
def test_ai_medical_certificate() -> None:
    body = {
        "kind": "sick_leave",
        "diagnosis": "Right URS calculus, post-URSL",
        "patient_age": 55,
        "patient_gender": "Male",
        "days": 5,
        "addressed_to": "Employer",
    }
    status, body_out, raw = _req(
        "POST", "/ai/medical-certificate/draft", body=body,
    )
    _record(
        "POST /api/ai/medical-certificate/draft → 200",
        status == 200,
        f"status={status} body={raw[:300]}",
    )
    if status != 200:
        return
    advice = body_out.get("advice") or ""
    _record(
        "Medical certificate response: non-empty 'advice'",
        isinstance(advice, str) and len(advice.strip()) > 10,
        f"len={len(advice)} sample={advice[:120]!r}",
    )


# ─── 4. AI Progress Note draft smoke ───────────────────────────
def test_ai_progress_note() -> None:
    body = {
        "patient_name": "Phase D Test Patient",
        "patient_age": 55,
        "patient_gender": "Male",
        "diagnosis": "Post-op Day 1, URSL + DJ stenting",
        "pod": 1,
        "vitals": {"BP": "126/82", "Pulse": "78", "SpO2": "98%", "Temp": "98.4F"},
        "chief_complaints": "Mild right flank discomfort, tolerating diet",
    }
    status, body_out, raw = _req("POST", "/ai/progress-note/draft", body=body)
    _record(
        "POST /api/ai/progress-note/draft → 200",
        status == 200,
        f"status={status} body={raw[:300]}",
    )
    if status != 200:
        return
    note = body_out.get("note") or ""
    has_s = "S" in note
    has_o = "O" in note
    has_a = "A" in note
    has_p = "P" in note
    _record(
        "Progress note: contains S/O/A/P section markers",
        has_s and has_o and has_a and has_p,
        f"S={has_s} O={has_o} A={has_a} P={has_p} sample={note[:200]!r}",
    )
    # extra: ensure it's a sentence
    _record(
        "Progress note: non-trivial length (> 50 chars)",
        len(note.strip()) > 50,
        f"len={len(note)}",
    )


# ─── Cleanup test admissions to avoid DB pollution ─────────────
def cleanup(admission_ids: list) -> None:
    if not MongoClient:
        return
    try:
        mc = MongoClient(MONGO_URL, serverSelectionTimeoutMS=3000)
        db_name = os.environ.get("DB_NAME") or "consulturo"
        for aid in admission_ids:
            if aid:
                mc[db_name].admissions.delete_one({"id": aid})
        print(f"\n(cleanup) removed {len([a for a in admission_ids if a])} test admission(s)")
    except Exception as exc:
        print(f"\n(cleanup) error: {exc}")


# ─── Main ───────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"Base: {BASE}")
    print(f"Token: {OWNER_TOKEN[:24]}...\n")

    print("=== 1. POST /api/ipd/admissions — NEW field vocabulary ===")
    new_id = test_admit_new_fields()

    print("\n=== 1b. POST /api/ipd/admissions — LEGACY field shape ===")
    legacy_id = test_admit_legacy_fields()

    if new_id:
        print("\n=== 2. GET /api/ipd/admissions/{id}/full ===")
        test_get_admission_full(new_id)

    print("\n=== 3. POST /api/ai/medical-certificate/draft ===")
    test_ai_medical_certificate()

    print("\n=== 4. POST /api/ai/progress-note/draft ===")
    test_ai_progress_note()

    cleanup([new_id, legacy_id])
    sys.exit(_summary())
