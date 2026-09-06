"""ConsultUro · IPD File PDF bundler — Phase 5.30.

Builds the single all-in-one PDF for an admission, combining:

  1. Admission Form          (patient details, diagnosis, planned procedure)
  2. Vitals chart            (time-series table of all recorded vitals)
  3. Daily Progress Notes    (rounds, newest first)
  4. Medications Chart       (active + stopped)
  5. Consents (Surgical)     (linked via admission_id; one section per consent)
  6. Operative Note          (from discharge_summary.operative_note)
  7. Discharge Summary       (full DS panel)
  8. Medical Certificates    (linked by patient phone OR admission_id)
  9. Doctor's Private Note   (admission.private_note — visible only to clinical staff)

Returns plain HTML; the frontend posts it to `/api/render/html` to get a
real PDF via WeasyPrint. This keeps PDF rendering server-side and lets
each section render with print-friendly fonts/page-breaks.
"""

from __future__ import annotations
from datetime import datetime
from typing import Any, Dict, List, Optional
import html as _html


def _esc(v: Any) -> str:
    if v is None:
        return ""
    return _html.escape(str(v))


def _fmt_ts(v: Any) -> str:
    if not v:
        return ""
    s = str(v)
    if "T" in s:
        return s.replace("T", " ").split("+")[0][:16]
    return s


def build_ipd_file_html(
    admission: Dict[str, Any],
    rounds: List[Dict[str, Any]],
    vitals: List[Dict[str, Any]],
    meds: List[Dict[str, Any]],
    consents: List[Dict[str, Any]],
    discharge_summary: Optional[Dict[str, Any]],
    medical_certificates: List[Dict[str, Any]],
    clinic_settings: Dict[str, Any],
    operative_note: Optional[str] = None,
) -> str:
    a = admission or {}
    ds = discharge_summary or {}
    clinic_name = _esc(clinic_settings.get("clinic_name") or "Sterling Hospitals")
    consultant = _esc(clinic_settings.get("consultant_name") or "Dr. Sagar Joshi")
    address = _esc(clinic_settings.get("address") or "")
    phone = _esc(clinic_settings.get("phone") or "")

    def section(title: str, body: str, color: str = "#0E7C8B") -> str:
        return f"""
        <section class="sec">
          <div class="secHead" style="border-color:{color};">
            <span class="secNum"></span>{_esc(title)}
          </div>
          <div class="secBody">{body}</div>
        </section>
        """

    # ── 1. Admission form ──────────────────────────────────────────
    admission_table = f"""
    <table class="kv">
      <tr><td>Patient</td><td><b>{_esc(a.get('patient_name'))}</b></td>
          <td>Age / Sex</td><td>{_esc(a.get('patient_age') or '—')} / {_esc((a.get('patient_sex') or a.get('patient_gender') or '—')).title()}</td></tr>
      <tr><td>Phone</td><td>{_esc(a.get('patient_phone') or '—')}</td>
          <td>Reg. No.</td><td>{_esc(a.get('reg_no') or a.get('registration_no') or '—')}</td></tr>
      <tr><td>Address</td><td colspan="3">{_esc(a.get('address') or '—')}</td></tr>
      <tr><td>IPD No.</td><td><b>{_esc(a.get('ipd_no'))}</b></td>
          <td>Ward / Bed</td><td>{_esc(a.get('ward') or 'General')} {_esc(a.get('bed_id') or '')}</td></tr>
      <tr><td>Admitted</td><td>{_fmt_ts(a.get('admitted_at'))}</td>
          <td>Status</td><td><b style="color:{'#16A34A' if a.get('status')=='active' else '#DC2626'}">{_esc((a.get('status') or '').upper())}</b></td></tr>
      <tr><td>Diagnosis</td><td colspan="3"><b>{_esc(a.get('diagnosis') or '—')}</b></td></tr>
      <tr><td>Planned procedure</td><td colspan="3">{_esc(a.get('planned_procedure') or '—')}</td></tr>
      <tr><td>Consulting doctor</td><td colspan="3">{_esc(a.get('consulting_doctor') or '—')}</td></tr>
      <tr><td>Presenting complaints</td><td colspan="3">{_esc(a.get('presenting_complaints') or '—')}</td></tr>
      <tr><td>Past history</td><td colspan="3">{_esc(a.get('past_history') or '—')}</td></tr>
      <tr><td>Investigations summary</td><td colspan="3">{_esc(a.get('investigations_summary') or '—')}</td></tr>
      {f'<tr><td>From prescription</td><td colspan="3">Rx #{_esc(a.get("from_prescription_id"))}</td></tr>' if a.get('from_prescription_id') else ''}
    </table>
    """

    # ── 2. Vitals ─────────────────────────────────────────────────
    if vitals:
        vitals_rows = ""
        for v in vitals:
            vitals_rows += f"""<tr>
              <td>{_fmt_ts(v.get('recorded_at') or v.get('created_at'))}</td>
              <td>{_esc(v.get('bp') or v.get('BP') or '—')}</td>
              <td>{_esc(v.get('pulse') or '—')}</td>
              <td>{_esc(v.get('temp') or '—')}</td>
              <td>{_esc(v.get('spo2') or '—')}</td>
              <td>{_esc(v.get('rr') or '—')}</td>
              <td>{_esc(v.get('notes') or '')}</td>
            </tr>"""
        vitals_body = f"""
        <table class="grid">
          <thead><tr><th>Time</th><th>BP</th><th>Pulse</th><th>Temp</th><th>SpO₂</th><th>RR</th><th>Notes</th></tr></thead>
          <tbody>{vitals_rows}</tbody>
        </table>
        """
    else:
        vitals_body = '<p class="muted">No vitals recorded.</p>'

    # ── 3. Progress notes ────────────────────────────────────────
    if rounds:
        notes_body = ""
        for r in rounds:
            notes_body += f"""
            <div class="note">
              <div class="noteHead">
                <b>{_esc(r.get('author_name') or r.get('created_by') or 'Clinician')}</b>
                <span class="muted"> · {_fmt_ts(r.get('created_at'))}</span>
                {f'<span class="pill">POD {_esc(r.get("pod"))}</span>' if r.get("pod") is not None else ''}
              </div>
              <div class="noteBody">{_esc(r.get('note_text') or '').replace(chr(10), '<br/>')}</div>
            </div>
            """
    else:
        notes_body = '<p class="muted">No progress notes.</p>'

    # ── 4. Medications ───────────────────────────────────────────
    if meds:
        active = [m for m in meds if (m.get("status") or "active") != "stopped"]
        stopped = [m for m in meds if (m.get("status") or "active") == "stopped"]
        def med_rows(lst):
            return "".join(
                f"""<tr>
                  <td>{_esc(m.get('drug'))}{f' ({_esc(m.get("brand"))})' if m.get('brand') else ''}</td>
                  <td>{_esc(m.get('dose') or '—')}</td>
                  <td>{_esc(m.get('route') or '—')}</td>
                  <td>{_esc(m.get('frequency') or '—')}</td>
                  <td>{_esc(m.get('duration') or '—')}</td>
                  <td>{_esc(m.get('notes') or '')}</td>
                </tr>"""
                for m in lst
            )
        meds_body = f"""
        <h4>Ongoing ({len(active)})</h4>
        {('<table class="grid"><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Notes</th></tr></thead><tbody>' + med_rows(active) + '</tbody></table>') if active else '<p class="muted">None.</p>'}
        {('<h4 style="margin-top:10px;color:#6B7280;">Stopped (' + str(len(stopped)) + ')</h4><table class="grid muted"><thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th><th>Notes</th></tr></thead><tbody>' + med_rows(stopped) + '</tbody></table>') if stopped else ''}
        """
    else:
        meds_body = '<p class="muted">No medications recorded.</p>'

    # ── 5. Consents ──────────────────────────────────────────────
    if consents:
        consent_body = ""
        for c in consents:
            proc = (c.get("procedure_snapshot") or {}).get("name") or {}
            proc_en = proc.get("en") or c.get("procedure_key") or "Procedure"
            consent_body += f"""
            <div class="consentCard">
              <div class="consentHead">
                <b>{_esc(proc_en)}</b>
                <span class="muted"> · {_esc((c.get('language') or 'en').upper())} · {_fmt_ts(c.get('created_at'))}</span>
              </div>
              <div class="muted">
                Witness: {_esc(c.get('witness_name') or '—')}
                {' · ✓ Patient signed' if c.get('patient_signature_b64') else ''}
                {' · ✓ Doctor signed' if c.get('doctor_signature_b64') else ''}
                {' · ✓ Witness signed' if c.get('witness_signature_b64') else ''}
              </div>
            </div>
            """
    else:
        consent_body = '<p class="muted">No consents linked to this admission.</p>'

    # ── 6. Operative note ────────────────────────────────────────
    op_note = operative_note or ds.get("operative_note") or ""
    op_body = (
        f'<div class="prose">{_esc(op_note).replace(chr(10), "<br/>")}</div>'
        if op_note
        else '<p class="muted">No operative note recorded.</p>'
    )

    # ── 7. Discharge summary ─────────────────────────────────────
    if ds:
        ds_body = f"""
        <table class="kv">
          <tr><td>Final diagnosis</td><td colspan="3"><b>{_esc(ds.get('final_diagnosis') or '—')}</b></td></tr>
          <tr><td>Procedures done</td><td colspan="3">{_esc(ds.get('procedures_done') or '—')}</td></tr>
          <tr><td>Course in hospital</td><td colspan="3">{_esc(ds.get('course_in_hospital') or '—').replace(chr(10), '<br/>')}</td></tr>
          <tr><td>Condition at discharge</td><td>{_esc(ds.get('condition_at_discharge') or '—')}</td>
              <td>Discharged at</td><td>{_fmt_ts(ds.get('discharged_at') or a.get('discharged_at'))}</td></tr>
          <tr><td>Discharge meds</td><td colspan="3">{_esc(ds.get('discharge_meds') or '—').replace(chr(10), '<br/>')}</td></tr>
          <tr><td>Diet advice</td><td colspan="3">{_esc(ds.get('diet_advice') or '—')}</td></tr>
          <tr><td>Follow-up plan</td><td colspan="3">{_esc(ds.get('follow_up_plan') or '—')}{(' on ' + _esc(ds.get('follow_up_date'))) if ds.get('follow_up_date') else ''}</td></tr>
          <tr><td>Advice</td><td colspan="3">{_esc(ds.get('advice') or '—').replace(chr(10), '<br/>')}</td></tr>
          {f'<tr><td>Danger signs</td><td colspan="3">{_esc(ds.get("danger_signs") or "")}</td></tr>' if ds.get('danger_signs') else ''}
        </table>
        """
    else:
        ds_body = '<p class="muted">Discharge summary not yet generated.</p>'

    # ── 8. Medical certificates ──────────────────────────────────
    if medical_certificates:
        certs_body = ""
        for c in medical_certificates:
            certs_body += f"""
            <div class="consentCard">
              <div class="consentHead">
                <b>{_esc((c.get('kind') or 'Medical Certificate').replace('_', ' ').title())}</b>
                <span class="muted"> · {_fmt_ts(c.get('created_at'))}</span>
              </div>
              <div class="prose">{_esc(c.get('text') or c.get('content') or '').replace(chr(10), '<br/>')}</div>
            </div>
            """
    else:
        certs_body = '<p class="muted">No medical certificates issued.</p>'

    # ── (Doctor's private note intentionally EXCLUDED) ───────────
    # The private note is staff-only clinical shorthand and must never
    # appear in the generated IPD / discharge summary PDF that is shared
    # with the patient. It stays viewable in-app on the Overview tab.

    sections_html = "".join([
        section("1 · Admission Form", admission_table),
        section("2 · Vitals Chart", vitals_body, "#0EA5E9"),
        section("3 · Daily Progress Notes", notes_body, "#F59E0B"),
        section("4 · Medications", meds_body, "#DC2626"),
        section("5 · Consents", consent_body, "#7C3AED"),
        section("6 · Operative Note", op_body, "#DB2777"),
        section("7 · Discharge Summary", ds_body, "#16A34A"),
        section("8 · Medical Certificates", certs_body, "#CA8A04"),
    ])

    css = """
    <style>
      @page { size: A4; margin: 16mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Inter', 'Helvetica', Arial, sans-serif; font-size: 11pt; color: #1A2E35; line-height: 1.45; }
      .hdr { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #0E7C8B; padding-bottom:10px; margin-bottom:14px; }
      .hdr h1 { margin:0; color:#0E7C8B; font-size:22px; letter-spacing:.3px; }
      .hdr .sub { color:#5E7C81; font-size:11px; }
      .hdr .meta { text-align:right; font-size:10.5px; color:#5E7C81; }
      .cover { background:#0E7C8B; color:#fff; padding:18px 20px; border-radius:10px; margin-bottom:16px; }
      .cover h2 { margin:0; font-size:18px; }
      .cover p { margin:4px 0 0; opacity:.9; font-size:11.5px; }
      .toc { background:#F4F9F9; border:1px solid #E2ECEC; border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:11.5px; }
      .toc b { color:#0E7C8B; }
      .sec { margin-top:14px; page-break-inside: avoid; }
      .secHead { border-left:6px solid #0E7C8B; padding:6px 10px; font-weight:700; font-size:13px; color:#1A2E35; background:#F4F9F9; }
      .secBody { padding:8px 4px 14px; }
      .kv { width:100%; border-collapse:collapse; font-size:11pt; }
      .kv td { padding:5px 8px; border-bottom:1px dashed #E2ECEC; vertical-align:top; }
      .kv td:nth-child(odd) { color:#5E7C81; font-size:10.5pt; width:25%; }
      .grid { width:100%; border-collapse:collapse; font-size:10.5pt; }
      .grid th, .grid td { padding:5px 8px; border:1px solid #E2ECEC; text-align:left; }
      .grid th { background:#F4F9F9; color:#0E7C8B; font-weight:700; font-size:10pt; }
      .muted { color:#6B7280; font-size:10.5pt; font-style: italic; }
      .pill { background:#0E7C8B22; color:#0E7C8B; padding:1px 6px; border-radius:8px; font-size:10pt; margin-left:6px; }
      .note { border:1px solid #E2ECEC; border-radius:6px; padding:8px 10px; margin-bottom:8px; }
      .noteHead { font-size:10.5pt; margin-bottom:4px; }
      .noteBody { font-size:11pt; }
      .consentCard { border:1px solid #E2ECEC; border-radius:6px; padding:8px 10px; margin-bottom:6px; background:#FCFCFD; }
      .consentHead { margin-bottom:3px; }
      .prose { font-size:11pt; }
      h4 { margin:8px 0 4px; color:#1A2E35; font-size:11pt; }
    </style>
    """

    cover = f"""
    <div class="cover">
      <h2>IPD File — {_esc(a.get('ipd_no'))}</h2>
      <p>{_esc(a.get('patient_name'))} · {_esc(a.get('patient_age') or '—')} y · {_esc((a.get('patient_sex') or a.get('patient_gender') or '—')).title()}</p>
      <p>{_esc(a.get('diagnosis') or '—')}</p>
      <p style="margin-top:8px; font-size:10pt;">Admitted: {_fmt_ts(a.get('admitted_at'))} · {('Discharged: ' + _fmt_ts(a.get('discharged_at'))) if a.get('discharged_at') else 'Currently active'}</p>
    </div>
    """

    toc = """
    <div class="toc">
      <b>Contents:</b>
      1. Admission Form ·
      2. Vitals Chart ·
      3. Daily Progress Notes ·
      4. Medications ·
      5. Consents ·
      6. Operative Note ·
      7. Discharge Summary ·
      8. Medical Certificates ·
      9. Doctor's Private Note
    </div>
    """

    return f"""<!doctype html>
    <html><head><meta charset="utf-8"><title>IPD File · {_esc(a.get('ipd_no'))}</title>{css}</head>
    <body>
      <div class="hdr">
        <div>
          <h1>{clinic_name}</h1>
          <div class="sub">{consultant} · {address} · {phone}</div>
        </div>
        <div class="meta">
          <div><b>IPD File</b></div>
          <div>IPD No.: <b>{_esc(a.get('ipd_no'))}</b></div>
          <div>Generated: {datetime.now().strftime('%d-%m-%Y %H:%M')}</div>
        </div>
      </div>
      {cover}
      {toc}
      {sections_html}
    </body></html>
    """
