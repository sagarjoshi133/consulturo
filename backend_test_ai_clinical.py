"""Phase 5.12 — AI clinical-document drafts smoke test."""
import json
import os
import sys
import requests

BASE = "http://localhost:8001/api"
OWNER = "test_session_1776770314741"
PATIENT = "test_pt_1780251062837"

passes = 0
fails = []


def check(name, cond, detail=""):
    global passes
    if cond:
        passes += 1
        print(f"  ✅ {name}")
    else:
        fails.append((name, detail))
        print(f"  ❌ {name} — {detail}")


def post(path, body, token=None, timeout=60):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = requests.post(BASE + path, headers=headers, json=body, timeout=timeout)
    return r


# ─── TEST 1: /api/ai/medical-certificate/draft ────────────────────
print("\n=== TEST 1: medical-certificate/draft ===")

# 1a. no auth → 401
r = post("/ai/medical-certificate/draft", {"kind": "sick_leave"})
check("1a no-auth → 401", r.status_code == 401, f"got {r.status_code}: {r.text[:200]}")

# 1b. patient → 403
r = post("/ai/medical-certificate/draft", {"kind": "sick_leave"}, token=PATIENT)
check("1b patient → 403", r.status_code == 403, f"got {r.status_code}: {r.text[:200]}")

# 1c. clinician → 200 with non-empty advice
body = {
    "kind": "sick_leave",
    "diagnosis": "Acute viral fever with myalgia",
    "patient_age": 34,
    "patient_gender": "Male",
    "days": 3,
}
r = post("/ai/medical-certificate/draft", body, token=OWNER, timeout=60)
ok = r.status_code == 200
check("1c clinician → 200", ok, f"got {r.status_code}: {r.text[:300]}")
if ok:
    j = r.json()
    advice = j.get("advice", "")
    check("1c advice present & non-empty", isinstance(advice, str) and len(advice.strip()) > 0,
          f"advice={advice!r}")
    # sentence count proxy
    n_sentences = advice.count(".") + advice.count("!") + advice.count("?")
    check("1c advice 2–4 sentences (proxy)", 2 <= n_sentences <= 6,
          f"sentence-end count={n_sentences}, len={len(advice)} text={advice[:250]!r}")
    print(f"  [advice]: {advice[:400]}")


# ─── TEST 2: /api/ai/progress-note/draft ──────────────────────────
print("\n=== TEST 2: progress-note/draft ===")
body = {
    "diagnosis": "Post-PCNL day 2",
    "pod": 2,
    "vitals": {"BP": "124/78", "Pulse": "82", "Temp": "98.4F"},
    "chief_complaints": "Mild flank pain, otherwise well",
}
r = post("/ai/progress-note/draft", body, token=OWNER, timeout=60)
ok = r.status_code == 200
check("2 clinician → 200", ok, f"got {r.status_code}: {r.text[:300]}")
if ok:
    j = r.json()
    note = j.get("note", "")
    check("2 note present & non-empty", isinstance(note, str) and len(note.strip()) > 0,
          f"note={note!r}")
    upper = note.upper()
    # SOAP sections: look for S:, O:, A:, P: or 'SUBJECTIVE','OBJECTIVE',etc
    for letter, full in [("S", "SUBJECTIVE"), ("O", "OBJECTIVE"), ("A", "ASSESSMENT"), ("P", "PLAN")]:
        has = (f"{letter}:" in note) or (full in upper) or (f"\n{letter} " in note) or note.strip().startswith(f"{letter}:") or note.strip().startswith(f"{letter} ")
        check(f"2 SOAP section '{letter}' present", has, f"could not find {letter}/{full}")
    print(f"  [note]: {note[:500]}")


# ─── TEST 3: /api/ai/discharge-summary/generate ───────────────────
print("\n=== TEST 3: discharge-summary/generate (Claude — slow) ===")
body = {
    "patient_name": "Ramesh Patel",
    "patient_age": 52,
    "patient_gender": "Male",
    "registration_no": "001280526",
    "diagnosis": "Right distal ureteric calculus (8 mm) with mild hydroureteronephrosis",
    "presenting_complaints": "Right-sided colicky flank pain x 5 days, one episode of haematuria",
    "past_history": "No comorbidities. No prior surgery.",
    "examination_findings": "Vitals stable. Right renal angle tenderness. Abdomen soft.",
    "investigations": "CT KUB: 8 mm distal right ureteric calculus with mild HUN. Serum creatinine 1.0 mg/dL. Urine routine: 8-10 RBC/hpf.",
    "surgery_name": "Right URSL + DJ stenting",
    "surgery_date": "2025-05-29",
    "operative_note_seed": "Semirigid URS, holmium laser fragmentation, complete stone clearance, 6Fr/26cm DJ stent placed",
    "course_in_hospital": "Uneventful post-op recovery. Pain controlled. Stable haematuria.",
    "admission_date": "2025-05-28",
    "discharge_date": "2025-05-30",
    "discharge_medications": "Tab Tamsulosin 0.4 mg HS x 14 days; Tab Paracetamol 650 mg SOS; Cap Cefixime 200 mg BD x 5 days",
    "advice": "Adequate hydration (3 L/day). Avoid heavy lifting for 2 weeks. Report fever/severe pain.",
    "follow_up": "OPD review in 2 weeks. Plan DJ stent removal at 3 weeks.",
    "final_status": "Stable, afebrile, tolerating orally.",
}
r = post("/ai/discharge-summary/generate", body, token=OWNER, timeout=90)
ok = r.status_code == 200
check("3 clinician → 200", ok, f"got {r.status_code}: {r.text[:500]}")
if ok:
    j = r.json()
    summary = j.get("summary", "")
    model = j.get("model", "")
    check("3 summary present & non-empty", isinstance(summary, str) and len(summary.strip()) > 0)
    check("3 model == 'claude-sonnet-4-5'", model == "claude-sonnet-4-5", f"got model={model!r}")
    required_headers = [
        "PATIENT IDENTIFICATION",
        "DIAGNOSIS",
        "OPERATIVE NOTE",
        "COURSE IN HOSPITAL",
        "DISCHARGE MEDICATIONS",
        "ADVICE ON DISCHARGE",
        "FOLLOW-UP PLAN",
    ]
    for h in required_headers:
        check(f"3 header '{h}' present", h in summary, f"missing header {h}")
    wc = len(summary.split())
    check("3 word count ≥ 450", wc >= 450, f"got {wc} words")
    print(f"  [summary first 600 chars]:\n{summary[:600]}")
    print(f"  ...")
    print(f"  [summary length]: {len(summary)} chars / {wc} words")


# ─── REPORT ───────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"PASSED: {passes}")
print(f"FAILED: {len(fails)}")
for n, d in fails:
    print(f"  - {n}: {d}")

sys.exit(0 if not fails else 1)
