/**
 * Discharge Summary PDF — Phase 5.12 redesign for multi-page output.
 *
 * Visually matches the new Medical Certificate + Prescription:
 *   · Same Rx-style branded header (custom letterhead image when
 *     uploaded, else the doctor-info strip with logo + clinic line +
 *     reg. no.).
 *   · Discharge-purple accent bar + meta strip (IPD No. + date band).
 *   · 12-section clinical layout matching the AI-generated narrative
 *     (PATIENT IDENTIFICATION → DIAGNOSIS → PRESENTING COMPLAINTS →
 *     PAST HISTORY → EXAMINATION ON ADMISSION → INVESTIGATIONS →
 *     OPERATIVE NOTE (visually prominent) → COURSE IN HOSPITAL →
 *     CONDITION AT DISCHARGE → DISCHARGE MEDICATIONS →
 *     ADVICE ON DISCHARGE → FOLLOW-UP PLAN).
 *   · Operative Note rendered with its own bordered card + step bullets
 *     so the surgeon can scan it quickly during chart review.
 *   · Page-break-friendly: each section uses `break-inside: avoid` so
 *     WeasyPrint never splits a section across two pages.
 *   · Signature block + dashed rectangular Clinic Stamp & Seal area
 *     on the last page, identical visual weight to the Medical Cert.
 */
import { DOC_THEME } from './doc-theme';

type Vitals = Record<string, any>;
type DrugRow = { drug?: string; dose?: string; route?: string; freq?: string; duration?: string };
type Round = { note_at?: string; note_text?: string; note?: string; written_by?: string };

type DischargeSummary = {
  final_diagnosis?: string;
  procedures_done?: string;
  operative_note?: string;
  course_in_hospital?: string;
  condition_at_discharge?: string;
  discharge_meds?: string;
  diet_advice?: string;
  follow_up_plan?: string;
  follow_up_date?: string;
  advice?: string;
  danger_signs?: string;
  discharged_by?: string;
  discharged_by_id?: string;
  edited_at?: string;
};

type Admission = {
  id?: string;
  ipd_no?: string;
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  patient_age?: number;
  patient_gender?: string;
  patient_sex?: string;
  reg_no?: string;
  registration_no?: string;
  address?: string;
  admitted_at?: string;
  discharged_at?: string;
  diagnosis?: string;
  consulting_doctor?: string;
  presenting_complaints?: string;
  past_history?: string;
  examination_findings?: string;
  investigations_summary?: string;
  planned_procedure?: string;
  ward?: string;
  bed_label?: string;
  discharge_summary?: DischargeSummary;
};

type Clinic = {
  name?: string;
  address?: string;
  phone?: string;
  doctor_name?: string;
  doctor_degrees?: string;
  doctor_reg_no?: string;
  letterhead_image_b64?: string;
  use_letterhead?: boolean;
  signature_image_b64?: string;
};

type Bundle = {
  admission: Admission;
  vitals_recent?: Vitals[];
  drug_chart?: DrugRow[];
  rounds?: Round[];
  clinic?: Clinic;
};

function esc(s: string | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
}

function fmtDay(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return iso; }
}

function paragraphs(s: string | undefined | null): string {
  if (!s) return '<em style="color:#94A3B8">Not documented.</em>';
  return esc(s)
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

/**
 * Render the operative-note block. We try to detect bullet-style
 * lines (lines starting with "-", "*", "1." etc.) and render them as
 * an HTML list for readability; otherwise we fall back to a paragraph.
 */
function operativeNoteBlock(text: string | undefined | null): string {
  if (!text || !text.trim()) {
    return '<em style="color:#94A3B8">Not documented.</em>';
  }
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const allBullets = lines.length >= 2 && lines.every((l) => /^[-*•]|^\d+[.)]/.test(l));
  if (allBullets) {
    const items = lines.map((l) => `<li>${esc(l.replace(/^[-*•]\s*|^\d+[.)]\s*/, ''))}</li>`).join('');
    return `<ul class="opSteps">${items}</ul>`;
  }
  return paragraphs(text);
}

export function buildDischargeSummaryHtml(bundle: Bundle): string {
  const accent = DOC_THEME.discharge.accent;       // purple
  const accentDark = '#5B21B6';
  const a = bundle.admission || {};
  const s = a.discharge_summary || {};
  const c = bundle.clinic || {};

  const rounds = bundle.rounds || [];
  const drugs = bundle.drug_chart || [];

  const clinicName = esc(c.name || 'ConsultUro Clinic');
  const clinicAddress = esc(c.address || '');
  const clinicPhone = esc(c.phone || '');
  const doctorName = esc(c.doctor_name || s.discharged_by || '');
  const doctorDegrees = esc(c.doctor_degrees || '');
  const docRegNo = esc(c.doctor_reg_no || '');
  const letterheadEnabled = !!(c.use_letterhead && (c.letterhead_image_b64 || '').trim());
  const letterheadSrc = letterheadEnabled ? String(c.letterhead_image_b64 || '').trim() : '';
  const sigImg = (c.signature_image_b64 || '').trim();

  const patientAge = a.patient_age ? `${a.patient_age} yrs` : '—';
  const patientGender = esc(a.patient_gender || a.patient_sex || '');
  const regNo = esc(a.reg_no || a.registration_no || '');
  const lengthOfStay = (() => {
    if (!a.admitted_at || !a.discharged_at) return '';
    try {
      const d1 = new Date(a.admitted_at).getTime();
      const d2 = new Date(a.discharged_at).getTime();
      const days = Math.max(1, Math.round((d2 - d1) / 86400000));
      return `${days} day${days === 1 ? '' : 's'}`;
    } catch { return ''; }
  })();

  const drugRowsHtml = drugs.length
    ? drugs.map((d) => `
      <tr>
        <td>${esc(d.drug || '')}</td>
        <td>${esc(d.dose || '')}</td>
        <td>${esc(d.route || '')}</td>
        <td>${esc(d.freq || '')}</td>
        <td>${esc(d.duration || '')}</td>
      </tr>`).join('')
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Discharge Summary &mdash; ${esc(a.patient_name)} &mdash; ${esc(a.ipd_no)}</title>
<style>
 @page { size: A4; margin: 14mm 14mm 16mm 14mm; }
 * { box-sizing: border-box; }
 body { margin: 0; font-family: 'Georgia', 'Times New Roman', serif; color: #1F2937; background: #fff; line-height: 1.55; }
 .page { padding: 0; }

 /* Accent rule */
 .topRule { height: 6px; background: ${accent}; border-radius: 3px; margin-bottom: 12px; }

 /* Header strip — mirrors the Rx + Medical Cert branding */
 .head { display: flex; gap: 14px; padding-bottom: 12px; border-bottom: 1.5px solid ${accent}55; align-items: center; }
 .head .logo {
   width: 60px; height: 60px; border-radius: 50%;
   background: linear-gradient(135deg, ${accent}, ${accentDark});
   color: #fff; display: flex; align-items: center; justify-content: center;
   font-family: 'Georgia', serif; font-size: 24px; font-weight: 800; letter-spacing: 1px;
   flex-shrink: 0;
 }
 .head .info { flex: 1; }
 .head h1 { margin: 0; font-size: 20px; color: #0F172A; letter-spacing: 0.4px; font-weight: 800; }
 .head .degrees { font-size: 10.5px; color: ${accentDark}; margin-top: 2px; font-style: italic; font-weight: 600; }
 .head .clinicLine { font-size: 10.5px; color: #4B5563; margin-top: 3px; line-height: 1.5; }
 .head .reg { font-size: 9.5px; color: #6B7280; margin-top: 2px; }

 /* Custom letterhead image — replaces the .head strip when uploaded */
 .letterhead { margin-bottom: 12px; }
 .letterhead img { width: 100%; max-height: 36mm; object-fit: contain; display: block; }

 /* Meta strip */
 .metaStrip {
   display: flex; justify-content: space-between; align-items: center;
   margin: 10px 0 16px; padding: 6px 10px;
   background: ${accent}10; border-left: 3px solid ${accent}; border-radius: 4px;
   font-size: 10.5px; color: #374151;
 }
 .metaStrip b { color: #0F172A; }

 /* Big centred title */
 .title {
   font-size: 17px; font-weight: 800; color: ${accent};
   letter-spacing: 3px; text-align: center;
   margin: 6px 0 18px; text-transform: uppercase;
 }
 .title .docBadge {
   display: inline-block; padding: 3px 10px; border-radius: 999px;
   background: ${accent}; color: #fff; font-size: 9.5px;
   letter-spacing: 1px; font-weight: 700; margin-left: 8px;
   vertical-align: middle;
 }

 /* Patient identification block (page 1, top) */
 .patientBlock {
   margin: 0 0 14px; padding: 10px 14px;
   background: ${accent}08; border: 1px solid ${accent}33; border-radius: 6px;
   page-break-inside: avoid;
 }
 .pBlockTable { width: 100%; border-collapse: collapse; font-size: 11px; }
 .pBlockTable .k { color: #6B7280; width: 22%; padding: 3px 0; }
 .pBlockTable .v { font-weight: 700; color: #0F172A; padding: 3px 0; }

 /* Section card — used 9-12 times per discharge */
 .section {
   margin-top: 14px; padding: 12px 14px;
   border: 1px solid #E5E7EB; border-radius: 6px;
   page-break-inside: avoid;
   background: #fff;
 }
 .section h3 {
   margin: 0 0 8px; font-size: 11.5px; color: ${accentDark};
   letter-spacing: 1.6px; text-transform: uppercase;
   border-bottom: 1px solid ${accent}33; padding-bottom: 5px;
 }
 .section p { margin: 0 0 8px; font-size: 11.5px; color: #1F2937; line-height: 1.65; text-align: justify; }
 .section p:last-child { margin-bottom: 0; }
 .section ul { margin: 4px 0 0 16px; padding: 0; }
 .section li { font-size: 11.5px; margin-bottom: 4px; line-height: 1.55; }

 /* Operative Note — most prominent section */
 .opSection {
   margin-top: 18px; padding: 14px 16px;
   border: 1.5px solid ${accent}; border-radius: 8px;
   background: linear-gradient(180deg, ${accent}0F, transparent 70%);
   page-break-inside: avoid;
 }
 .opSection h3 {
   margin: 0 0 10px; font-size: 13px; color: ${accent};
   letter-spacing: 2px; text-transform: uppercase;
 }
 .opSection h3::before {
   content: '⚕  '; font-size: 14px;
 }
 .opSteps { margin: 0; padding-left: 18px; }
 .opSteps li {
   font-size: 11.5px; line-height: 1.7; margin-bottom: 5px; color: #1F2937;
 }
 .opSection p { font-size: 11.5px; line-height: 1.7; text-align: justify; margin: 0 0 8px; }

 /* Two-column grid for short pair sections */
 .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
 .grid2 .section { margin-top: 0; }

 /* Data tables (drug chart) */
 table.data { width: 100%; border-collapse: collapse; margin-top: 6px; }
 table.data th { font-size: 9.5px; color: #64748B; text-transform: uppercase; letter-spacing: 0.8px; padding: 5px 6px; border-bottom: 1.5px solid ${accent}55; text-align: left; }
 table.data td { padding: 6px; border-bottom: 1px solid #F1F5F9; font-size: 11px; }

 /* Danger signs callout */
 .danger {
   margin-top: 14px; padding: 10px 14px;
   background: #FEF2F2; border-left: 4px solid #DC2626;
   border-radius: 0 6px 6px 0;
   font-size: 11px; color: #991B1B; line-height: 1.6;
   page-break-inside: avoid;
 }
 .danger b { color: #7F1D1D; }

 /* Signature + stamp row */
 .sigStampRow {
   margin-top: 32px; display: flex; align-items: flex-end;
   justify-content: space-between; gap: 16px;
   page-break-inside: avoid;
 }
 .stampBox {
   width: 130px; height: 90px;
   border: 1.5px dashed ${accent}; border-radius: 6px;
   display: flex; align-items: center; justify-content: center;
   color: ${accent}; font-size: 9.5px; letter-spacing: 1.2px;
   font-weight: 700; text-align: center;
   background: ${accent}05;
 }
 .stampBox .stampInner {
   border: 1px dotted ${accent}55; border-radius: 4px;
   padding: 24px 14px;
 }
 .sign { text-align: right; min-width: 240px; }
 .sign .sigImg { max-width: 180px; max-height: 50px; margin-bottom: 4px; }
 .sign .sigLine { width: 220px; height: 1.5px; background: #1F2937; margin: 4px 0 6px auto; }
 .sign .sigName { font-weight: 800; font-size: 13px; color: #0F172A; }
 .sign .sigQual { font-size: 10.5px; color: #6B7280; font-style: italic; }
 .sign .sigReg { font-size: 10px; color: #4B5563; margin-top: 1px; }
 .sign .sigDate { font-size: 10px; color: #6B7280; margin-top: 4px; }

 /* Bottom footer */
 .footer {
   margin-top: 18px; padding-top: 8px;
   border-top: 1.5px solid ${accent}55;
   display: flex; justify-content: space-between;
   font-size: 9px; color: #94A3B8;
 }
 .footer .left { font-weight: 700; color: ${accentDark}; letter-spacing: 0.4px; }
</style></head>
<body>
<div class="page">
 <div class="topRule"></div>

 ${letterheadEnabled ? `
 <div class="letterhead">
   <img src="${esc(letterheadSrc)}" alt="Letterhead"/>
 </div>` : `
 <div class="head">
   <div class="logo">CU</div>
   <div class="info">
     <h1>${doctorName || clinicName}</h1>
     ${doctorDegrees ? `<div class="degrees">${doctorDegrees}</div>` : ''}
     <div class="clinicLine">${clinicName}${clinicAddress ? ' &middot; ' + clinicAddress : ''}${clinicPhone ? ' &middot; ' + clinicPhone : ''}</div>
     ${docRegNo ? `<div class="reg">Reg. No. ${docRegNo}</div>` : ''}
   </div>
 </div>`}

 <div class="metaStrip">
   <span><b>IPD No.:</b> ${esc(a.ipd_no || '—')}</span>
   <span><b>Date of Issue:</b> ${fmtDay(s.edited_at || a.discharged_at) || fmtDay(new Date().toISOString())}</span>
 </div>

 <div class="title">
   Discharge Summary
   <span class="docBadge">${DOC_THEME.discharge.label.toUpperCase()}</span>
 </div>

 <!-- 1) Patient Identification -->
 <div class="patientBlock">
  <table class="pBlockTable">
   <tr>
    <td class="k">Patient Name:</td>
    <td class="v">${esc(a.patient_name || '—')}</td>
    <td class="k">Reg. No.:</td>
    <td class="v">${regNo || '—'}</td>
   </tr>
   <tr>
    <td class="k">Age / Gender:</td>
    <td class="v" style="font-weight:500">${patientAge}${patientGender ? ' / ' + patientGender : ''}</td>
    <td class="k">Phone:</td>
    <td class="v" style="font-weight:500">${esc(a.patient_phone || '—')}</td>
   </tr>
   ${a.address ? `<tr>
    <td class="k" style="vertical-align:top">Address:</td>
    <td class="v" colspan="3" style="font-weight:500">${esc(a.address)}</td>
   </tr>` : ''}
   <tr>
    <td class="k">Admitted:</td>
    <td class="v" style="font-weight:500">${fmtDate(a.admitted_at) || '—'}</td>
    <td class="k">Discharged:</td>
    <td class="v" style="font-weight:500">${fmtDate(a.discharged_at) || '—'}</td>
   </tr>
   <tr>
    <td class="k">Ward / Bed:</td>
    <td class="v" style="font-weight:500">${esc(((a.ward || '') + (a.bed_label ? ' · ' + a.bed_label : '')).trim()) || '—'}</td>
    <td class="k">Length of Stay:</td>
    <td class="v" style="font-weight:500">${lengthOfStay || '—'}</td>
   </tr>
   ${a.consulting_doctor ? `<tr>
    <td class="k">Consulting Doctor:</td>
    <td class="v" colspan="3" style="font-weight:500">${esc(a.consulting_doctor)}</td>
   </tr>` : ''}
  </table>
 </div>

 <!-- 2) Final Diagnosis -->
 <div class="section">
   <h3>Final Diagnosis</h3>
   ${paragraphs(s.final_diagnosis || a.diagnosis)}
 </div>

 <!-- 3) Presenting Complaints -->
 ${(a.presenting_complaints || s.final_diagnosis) ? `
 <div class="section">
   <h3>Presenting Complaints</h3>
   ${paragraphs(a.presenting_complaints || 'As per file notes')}
 </div>` : ''}

 <!-- 4) Past History -->
 ${a.past_history ? `
 <div class="section">
   <h3>Past History</h3>
   ${paragraphs(a.past_history)}
 </div>` : ''}

 <!-- 5) Examination on Admission -->
 ${a.examination_findings ? `
 <div class="section">
   <h3>Examination on Admission</h3>
   ${paragraphs(a.examination_findings)}
 </div>` : ''}

 <!-- 6) Investigations -->
 ${a.investigations_summary ? `
 <div class="section">
   <h3>Investigations</h3>
   ${paragraphs(a.investigations_summary)}
 </div>` : ''}

 <!-- 7) OPERATIVE NOTE — most prominent block -->
 ${(s.operative_note || s.procedures_done) ? `
 <div class="opSection">
   <h3>Operative Note</h3>
   ${operativeNoteBlock(s.operative_note || s.procedures_done)}
 </div>` : ''}

 <!-- 8) Course in Hospital -->
 <div class="section">
   <h3>Course in Hospital</h3>
   ${paragraphs(s.course_in_hospital)}
 </div>

 <!-- 9) Condition at Discharge -->
 <div class="section">
   <h3>Condition at Discharge</h3>
   ${paragraphs(s.condition_at_discharge)}
 </div>

 <!-- 10) Discharge Medications -->
 <div class="section">
   <h3>Discharge Medications</h3>
   ${drugRowsHtml ? `
   <table class="data">
    <thead><tr><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead>
    <tbody>${drugRowsHtml}</tbody>
   </table>` : ''}
   ${s.discharge_meds ? `<div style="margin-top:${drugRowsHtml ? '8px' : '0'}">${paragraphs(s.discharge_meds)}</div>` : (!drugRowsHtml ? '<em style="color:#94A3B8">Not documented.</em>' : '')}
 </div>

 <!-- 11) Advice on Discharge -->
 <div class="section">
   <h3>Advice on Discharge</h3>
   ${paragraphs(s.advice || s.diet_advice)}
 </div>

 <!-- 12) Follow-up Plan -->
 <div class="section">
   <h3>Follow-up Plan</h3>
   ${s.follow_up_date ? `<p><b>Next visit:</b> ${esc(fmtDay(s.follow_up_date))}</p>` : ''}
   ${paragraphs(s.follow_up_plan)}
 </div>

 ${s.danger_signs ? `
 <div class="danger">
   <b>⚠ Danger signs — return immediately if:</b><br/>
   ${esc(s.danger_signs).replace(/\n/g, '<br/>')}
 </div>` : ''}

 ${rounds.length ? `
 <div class="section">
   <h3>Daily Progress Highlights</h3>
   <table class="data">
    <thead><tr><th style="width:90px">When</th><th>Note</th><th style="width:90px">By</th></tr></thead>
    <tbody>${rounds.slice(0, 12).map((r) => `
      <tr>
        <td style="font-size:10px;color:#475569;white-space:nowrap">${esc(fmtDate(r.note_at))}</td>
        <td style="font-size:11px;line-height:1.5">${esc(r.note_text || r.note || '').replace(/\n/g, '<br/>')}</td>
        <td style="font-size:10px;color:#64748B">${esc(r.written_by || '')}</td>
      </tr>`).join('')}</tbody>
   </table>
 </div>` : ''}

 <!-- Signature + stamp -->
 <div class="sigStampRow">
  <div class="stampBox">
   <div class="stampInner">CLINIC STAMP<br/>&amp; SEAL</div>
  </div>
  <div class="sign">
   ${sigImg ? `<img class="sigImg" src="${esc(sigImg)}" alt="Signature"/>` : ''}
   <div class="sigLine"></div>
   <div class="sigName">${doctorName || '&mdash;'}</div>
   ${doctorDegrees ? `<div class="sigQual">${doctorDegrees}</div>` : ''}
   ${docRegNo ? `<div class="sigReg">Reg. No. ${docRegNo}</div>` : ''}
   <div class="sigDate">Date: ${fmtDay(a.discharged_at || s.edited_at) || fmtDay(new Date().toISOString())}</div>
  </div>
 </div>

 <div class="footer">
  <div class="left">${clinicName}</div>
  <div>This is an authentic medical document &mdash; verify via the issuing clinic.</div>
 </div>
</div>
</body></html>`;
}
