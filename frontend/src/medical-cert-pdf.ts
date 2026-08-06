/**
 * Medical Certificate PDF — Phase 5.12 redesign.
 *
 * Renders an A4 letterhead-style page that visually mirrors the
 * Prescription:
 *   · Same clinic branding strip at the top (logo + clinic name +
 *     doctor name + degrees + reg. no.) when no custom letterhead is
 *     uploaded; OR the custom letterhead image when one IS uploaded.
 *   · A bold "MEDICAL CERTIFICATE" title in DOC_THEME gold accent.
 *   · Patient identification block (name, age/sex, reg. no., phone,
 *     address, email).
 *   · Clinical timeline grid: Date of Consultation · Diagnosis ·
 *     Date of Admission · Date of Surgery · Name of Surgery · Date
 *     of Discharge (per Dr. Joshi spec 2026-06-01).
 *   · Kind-specific narrative body (sick leave / fitness / unfit /
 *     summary).
 *   · Optional advice / instructions.
 *   · Signature block AND a rectangular stamp / seal area for the
 *     clinic's official wet stamp.
 *   · Bottom rule footer with verification notice.
 *
 * The output HTML is consumed by:
 *   · web — opened in a new window and printed via window.print()
 *   · native — passed to expo-print's printAsync (returns to PDF)
 *   · WeasyPrint backend — POST /api/render/pdf returns a binary blob
 */
import { DOC_THEME } from './doc-theme';

type Kind = 'sick_leave' | 'fitness' | 'unfit_for_duty' | 'medical_summary';

type Cert = {
  cert_id?: string;
  kind?: Kind | string;
  patient_name?: string;
  patient_age?: number;
  patient_gender?: string;
  patient_phone?: string;
  patient_email?: string;
  patient_address?: string;
  registration_no?: string;
  addressed_to?: string;
  diagnosis?: string;
  advice?: string;
  start_date?: string;
  end_date?: string;
  resume_date?: string;
  days?: number;
  summary?: string;
  // Phase 5.12 clinical timeline fields
  consultation_date?: string;
  admission_date?: string;
  surgery_date?: string;
  surgery_name?: string;
  discharge_date?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  issued_by_name?: string;
  created_at?: string;
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

function esc(s: string | undefined | null): string {
  if (!s) return '';
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
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return iso; }
}

function kindHeading(k: string | undefined): string {
  switch (k) {
    case 'sick_leave': return 'Medical Certificate &mdash; Sick Leave';
    case 'unfit_for_duty': return 'Medical Certificate &mdash; Unfit for Duty';
    case 'fitness': return 'Fitness Certificate';
    case 'medical_summary': return 'Medical Summary';
    default: return 'Medical Certificate';
  }
}

function bodyText(c: Cert): string {
  const age = c.patient_age ? `, ${c.patient_age} years` : '';
  const gen = c.patient_gender ? ` (${esc(c.patient_gender)})` : '';
  const name = `<strong>${esc(c.patient_name)}</strong>`;
  const dx = c.diagnosis ? esc(c.diagnosis) : 'medical reasons';
  switch (c.kind) {
    case 'sick_leave':
      return `This is to certify that ${name}${age}${gen} was examined by me on ${fmtDate(c.consultation_date || c.start_date)} and is advised <strong>rest from work for ${c.days ?? '?'} day${(c.days || 0) === 1 ? '' : 's'}</strong> (from ${fmtDate(c.start_date)} to ${fmtDate(c.end_date)}) due to ${dx}.${c.resume_date ? ` The patient may resume duty on <strong>${fmtDate(c.resume_date)}</strong>.` : ''}`;
    case 'unfit_for_duty':
      return `This is to certify that ${name}${age}${gen} is currently <strong>unfit for duty</strong> due to ${dx} for a period of ${c.days ?? '?'} day${(c.days || 0) === 1 ? '' : 's'} starting ${fmtDate(c.start_date)}. A formal review is advised after this period.`;
    case 'fitness':
      return `This is to certify that ${name}${age}${gen} has been examined by me and is found to be <strong>medically fit</strong> to resume normal activities / duty / sports as of ${fmtDate(c.consultation_date || c.created_at)}. There are no contraindications to physical exertion within reasonable limits.`;
    case 'medical_summary':
      return `${name}${age}${gen} was under my medical care. ${esc(c.summary || '')}`;
    default:
      return `${name}${age}${gen} &mdash; ${dx}.`;
  }
}

/**
 * Build the timeline grid (consultation / admission / surgery /
 * discharge). Only rows with a value are rendered to keep the
 * certificate clean for simple sick-leave use cases.
 */
function timelineGrid(c: Cert): string {
  const rows: Array<{ label: string; value: string }> = [];
  if (c.consultation_date) rows.push({ label: 'Date of Consultation', value: fmtDate(c.consultation_date) });
  if (c.diagnosis) rows.push({ label: 'Diagnosis', value: esc(c.diagnosis) });
  if (c.admission_date) rows.push({ label: 'Date of Admission', value: fmtDate(c.admission_date) });
  if (c.surgery_date) rows.push({ label: 'Date of Surgery', value: fmtDate(c.surgery_date) });
  if (c.surgery_name) rows.push({ label: 'Name of Surgery', value: esc(c.surgery_name) });
  if (c.discharge_date) rows.push({ label: 'Date of Discharge', value: fmtDate(c.discharge_date) });
  if (rows.length === 0) return '';
  return `<div class="timeline">
    <div class="timelineHead">Clinical Summary</div>
    <table class="tlTable">
      ${rows.map((r) => `<tr>
        <td class="tlLabel">${r.label}</td>
        <td class="tlValue">${r.value}</td>
      </tr>`).join('')}
    </table>
  </div>`;
}

export function generateCertificatePdfHtml(c: Cert, clinic?: Clinic): string {
  const accent = DOC_THEME.medical_certificate.accent;       // gold
  const accentDark = '#8B5E0F';
  const clinicName = esc(clinic?.name || 'ConsultUro Clinic');
  const clinicAddress = esc(clinic?.address || '');
  const clinicPhone = esc(clinic?.phone || '');
  const doctorName = esc(c.doctor_name || clinic?.doctor_name || c.issued_by_name || '');
  const doctorDegrees = esc(clinic?.doctor_degrees || '');
  const regNo = esc(c.doctor_reg_no || clinic?.doctor_reg_no || '');
  const issueDate = fmtDate(c.created_at || new Date().toISOString());
  const letterheadEnabled = !!(clinic?.use_letterhead && (clinic.letterhead_image_b64 || '').trim());
  const letterheadSrc = letterheadEnabled ? String(clinic?.letterhead_image_b64 || '').trim() : '';
  const sigImg = (clinic?.signature_image_b64 || '').trim();

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Medical Certificate &mdash; ${esc(c.patient_name)}</title>
<style>
 @page { size: A4; margin: 14mm 14mm 14mm 14mm; }
 * { box-sizing: border-box; }
 body { margin: 0; font-family: 'Georgia', 'Times New Roman', serif; color: #1F2937; background: #fff; }
 .page { position: relative; padding: 0; min-height: 265mm; display: flex; flex-direction: column; }

 /* Top accent rule — same visual weight as Rx top rule */
 .topRule { height: 6px; background: ${accent}; border-radius: 3px; margin-bottom: 12px; }

 /* Header strip — Rx-style branding when no letterhead image is set */
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

 /* Custom letterhead (image) replaces the entire .head strip */
 .letterhead { margin-bottom: 12px; }
 .letterhead img { width: 100%; max-height: 36mm; object-fit: contain; display: block; }

 /* Meta strip — Date / Certificate No. */
 .metaStrip {
   display: flex; justify-content: space-between; align-items: center;
   margin: 10px 0 14px; padding: 6px 10px;
   background: ${accent}10; border-left: 3px solid ${accent}; border-radius: 4px;
   font-size: 10.5px; color: #374151;
 }
 .metaStrip b { color: #0F172A; }

 /* Title */
 .title {
   font-size: 17px; font-weight: 800; color: ${accent};
   letter-spacing: 3px; text-align: center;
   margin: 14px 0 18px; text-transform: uppercase;
 }
 .title .kindBadge {
   display: inline-block; padding: 3px 10px; border-radius: 999px;
   background: ${accent}; color: #fff; font-size: 9.5px;
   letter-spacing: 1px; font-weight: 700; margin-left: 8px;
   vertical-align: middle;
 }

 /* Patient block */
 .patientBlock {
   margin: 0 0 14px; padding: 10px 14px;
   background: ${accent}08; border: 1px solid ${accent}33; border-radius: 6px;
 }
 .pBlockTable { width: 100%; border-collapse: collapse; font-size: 11px; }
 .pBlockTable .k { color: #6B7280; width: 22%; padding: 3px 0; }
 .pBlockTable .v { font-weight: 700; color: #0F172A; padding: 3px 0; }

 /* Timeline grid (consultation / admission / surgery / discharge) */
 .timeline { margin-bottom: 16px; }
 .timelineHead {
   font-size: 11px; font-weight: 700; color: ${accentDark};
   letter-spacing: 1.4px; text-transform: uppercase; margin-bottom: 6px;
 }
 .tlTable { width: 100%; border-collapse: collapse; font-size: 11.5px; }
 .tlTable tr:nth-child(odd) { background: ${accent}06; }
 .tlTable td { padding: 6px 10px; border-bottom: 1px solid ${accent}22; }
 .tlLabel { color: #4B5563; font-weight: 600; width: 38%; }
 .tlValue { color: #0F172A; font-weight: 700; }

 /* Addressee + body */
 .addressee {
   font-size: 13px; font-weight: 700; color: #0F172A;
   margin: 8px 0 14px; padding: 6px 10px;
   background: #F9FAFB; border-left: 3px solid #1F2937; border-radius: 4px;
 }
 .body {
   font-size: 13px; line-height: 1.85; color: #1F2937;
   text-align: justify; margin-bottom: 16px;
 }
 .body strong { color: #0F172A; }

 .advice {
   margin-top: 14px; font-size: 12px; font-style: italic; color: #374151;
   padding: 10px 14px; border-left: 3px solid ${accent}; background: ${accent}0A;
   border-radius: 0 4px 4px 0;
 }

 /* Signature + stamp row — sits flush with bottom of page */
 .sigSpacer { flex: 1; min-height: 24px; }
 .sigStampRow {
   margin-top: 28px; display: flex; align-items: flex-end;
   justify-content: space-between; gap: 16px;
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

 /* Bottom rule footer */
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
     ${regNo ? `<div class="reg">Reg. No. ${regNo}</div>` : ''}
   </div>
 </div>`}

 <div class="metaStrip">
   <span><b>Certificate No.:</b> ${esc(c.cert_id || '—')}</span>
   <span><b>Date of Issue:</b> ${issueDate}</span>
 </div>

 <div class="title">
   ${kindHeading(c.kind)}
   <span class="kindBadge">${DOC_THEME.medical_certificate.label.toUpperCase()}</span>
 </div>

 <div class="patientBlock">
  <table class="pBlockTable">
   <tr>
    <td class="k">Patient Name:</td>
    <td class="v">${esc(c.patient_name || '—')}</td>
    <td class="k">Reg. No.:</td>
    <td class="v">${esc(c.registration_no || '—')}</td>
   </tr>
   <tr>
    <td class="k">Age / Gender:</td>
    <td class="v" style="font-weight:500">${c.patient_age ? esc(String(c.patient_age) + ' yrs') : '—'}${c.patient_gender ? ' / ' + esc(c.patient_gender) : ''}</td>
    <td class="k">Phone:</td>
    <td class="v" style="font-weight:500">${esc(c.patient_phone || '—')}</td>
   </tr>
   ${c.patient_address ? `<tr>
    <td class="k" style="vertical-align:top">Address:</td>
    <td class="v" colspan="3" style="font-weight:500">${esc(c.patient_address)}</td>
   </tr>` : ''}
   ${c.patient_email ? `<tr>
    <td class="k">Email:</td>
    <td class="v" colspan="3" style="font-weight:500">${esc(c.patient_email)}</td>
   </tr>` : ''}
  </table>
 </div>

 ${timelineGrid(c)}

 <div class="addressee">${esc(c.addressed_to || 'TO WHOM IT MAY CONCERN')}</div>

 <div class="body">${bodyText(c)}</div>

 ${c.advice ? `<div class="advice"><strong>Advice / Instructions:</strong> ${esc(c.advice)}</div>` : ''}

 <div class="sigSpacer"></div>

 <div class="sigStampRow">
  <div class="stampBox">
   <div class="stampInner">CLINIC STAMP<br/>&amp; SEAL</div>
  </div>
  <div class="sign">
   ${sigImg ? `<img class="sigImg" src="${esc(sigImg)}" alt="Signature"/>` : ''}
   <div class="sigLine"></div>
   <div class="sigName">${doctorName || '&mdash;'}</div>
   ${doctorDegrees ? `<div class="sigQual">${doctorDegrees}</div>` : ''}
   ${regNo ? `<div class="sigReg">Reg. No. ${regNo}</div>` : ''}
   <div class="sigDate">Date: ${issueDate}</div>
  </div>
 </div>

 <div class="footer">
  <div class="left">${clinicName}</div>
  <div>This is an official medical document &mdash; verify authenticity via the issuing clinic.</div>
 </div>
</div>
</body></html>`;
}
