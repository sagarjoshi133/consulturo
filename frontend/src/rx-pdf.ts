// Shared prescription HTML / PDF utilities used by both the composer and the
// list-action buttons (Print, Download PDF).
//
// Kept framework-light so it can be imported from any screen.
//
// Visual goals (Urology revamp, June 2026):
//   • Header pushed up — minimal top padding so the doctor's brand block
//     starts close to the page edge.
//   • Compact A4 — fits a typical visit on 1 page; auto-extends to multiple
//     pages for lengthy Rx (page-break-inside controls + repeating thead).
//   • Sectioned body — 11 main bands (Patient · Vitals · Complaints · IPSS
//     · Examination · Investigations · Diagnosis · Medications · Investigations
//     advised · Advice · Follow-up). Empty subsections are NEVER rendered.
//   • Watermark — large rotated "ConsultUro" mark behind everything for
//     authenticity branding.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { LOGO_URL } from './theme';
import { displayDate, parseUIDate } from './date';
import api from './api';

export type RxMed = {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  timing?: string;
};

export type RxDoc = {
  prescription_id: string;
  patient_name?: string;
  patient_age?: number | string;
  patient_gender?: string;
  patient_phone?: string;
  patient_address?: string;
  registration_no?: string;
  ref_doctor?: string;
  visit_date?: string;
  // legacy free-text vitals + new structured fields
  vitals?: string;
  vitals_pulse?: string;
  vitals_bp?: string;
  chief_complaints?: string;
  ipss_recent?: string;
  // Examination subsections
  exam_pa?: string;
  exam_ext_genitalia?: string;
  exam_eum?: string;
  exam_testis?: string;
  exam_dre?: string;
  // Investigation subsections
  investigation_findings?: string; // legacy
  inv_blood?: string;
  inv_psa?: string;
  inv_usg?: string;
  inv_uroflowmetry?: string;
  inv_ct?: string;
  inv_mri?: string;
  inv_pet?: string;
  diagnosis?: string;
  medicines?: RxMed[];
  investigations_advised?: string;
  advice?: string;
  follow_up?: string;
  status?: string;
  created_at?: string;
};

export type ClinicSettings = {
  clinic_name?: string;
  clinic_address?: string;
  clinic_phone?: string;
  doctor_degrees?: string;
  doctor_reg_no?: string;
  signature_url?: string;
};

const escapeHtml = (s?: string | number) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );

/** Render a "Field: value" row inside a section — only when value is non-empty. */
function row(label: string, value?: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  // Newlines in textarea content become <br/>
  const html = escapeHtml(v).replace(/\n/g, '<br/>');
  return `<div class="row"><span class="rk">${escapeHtml(label)}</span><span class="rv">${html}</span></div>`;
}

/** Wrap a list of pre-rendered subsection rows into a section band — but only
 * if at least one of them is non-empty (so we never print a header followed
 * by nothing). */
function section(title: string, rowsHtml: string[]): string {
  const body = rowsHtml.filter(Boolean).join('');
  if (!body) return '';
  return `<section class="sec"><div class="sech">${escapeHtml(title)}</div><div class="secb">${body}</div></section>`;
}

export async function buildRxHtml(rx: RxDoc, settings: ClinicSettings = {}): Promise<string> {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || 'https://www.drsagarjoshi.com').replace(/\/$/, '');
  const verifyUrl = `${base}/api/rx/verify/${rx.prescription_id}`;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      margin: 1,
      width: 180,
      color: { dark: '#0A5E6B', light: '#FFFFFF' },
    });
  } catch {
    qrDataUrl = '';
  }

  const visitDisplay =
    displayDate(parseUIDate(rx.visit_date || '') || rx.visit_date || '') ||
    rx.visit_date ||
    (rx.created_at ? format(new Date(rx.created_at), 'dd-MM-yyyy') : '');
  const timeStr = rx.created_at ? format(new Date(rx.created_at), 'hh:mm a') : format(new Date(), 'hh:mm a');
  const nowStamp = rx.created_at ? format(new Date(rx.created_at), 'dd-MM-yyyy h:mm a') : format(new Date(), 'dd-MM-yyyy h:mm a');

  const clinicName = (settings.clinic_name || 'Sterling Hospitals').trim();
  const clinicAddr = (settings.clinic_address || 'Sterling Hospitals, Race Course Road, Vadodara – 390007').trim();
  const clinicPhone = (settings.clinic_phone || '+91 81550 75669').trim();
  const degrees = (settings.doctor_degrees || 'MBBS · MS · DrNB (Urology)').trim();
  const drReg = (settings.doctor_reg_no || 'G-53149').trim();
  const signatureUrl = (settings.signature_url || '').trim();
  const patientReg = rx.registration_no || '';

  const ageSex = [rx.patient_age || '', rx.patient_gender || ''].filter((x) => String(x).trim()).join(' / ');

  // Medications (kept as a real <table> so frequency/instructions read clean)
  const meds = (rx.medicines || []).filter((m) => m && m.name);
  const medRows = meds
    .map((m, i) => {
      const details: string[] = [];
      if (m.frequency) details.push(`<b>${escapeHtml(m.frequency)}</b>`);
      if (m.duration) details.push(`× ${escapeHtml(m.duration)}`);
      if (m.timing) details.push(`· ${escapeHtml(m.timing)}`);
      return `
    <tr>
      <td class="num">${i + 1}</td>
      <td>
        <div class="medname">${escapeHtml(m.name)}</div>
        ${m.dosage ? `<div class="meddose">${escapeHtml(m.dosage)}</div>` : ''}
      </td>
      <td class="sig-line">
        ${details.join(' ')}
        ${m.instructions ? `<div class="medinstr">${escapeHtml(m.instructions)}</div>` : ''}
      </td>
    </tr>`;
    })
    .join('');

  // ---- Build sections (each hides itself if empty) -----------------------
  // Each section is rendered once and slotted into a multi-column body grid.

  // Vitals — left column block
  const vitalsParts: string[] = [];
  if (rx.vitals_pulse) vitalsParts.push(`<div class="row"><span class="rk">Pulse</span><span class="rv"><b>${escapeHtml(rx.vitals_pulse)}</b></span></div>`);
  if (rx.vitals_bp) vitalsParts.push(`<div class="row"><span class="rk">BP</span><span class="rv"><b>${escapeHtml(rx.vitals_bp)}</b></span></div>`);
  const vitalsBody = vitalsParts.length
    ? vitalsParts.join('')
    : (rx.vitals ? `<div class="para">${escapeHtml(rx.vitals)}</div>` : '');
  const vitalsSection = vitalsBody
    ? `<section class="sec"><div class="sech">Vitals</div><div class="secb">${vitalsBody}</div></section>`
    : '';

  // Recent IPSS — left column (renamed to "IPSS (If applicable)" per
  // clinician feedback so urology cases that don't apply IPSS still read
  // naturally without an awkward "Recent" prefix).
  const ipssSection = rx.ipss_recent
    ? `<section class="sec"><div class="sech">IPSS <span class="sechSub">(If applicable)</span></div><div class="secb"><div class="para">${escapeHtml(rx.ipss_recent).replace(/\n/g, '<br/>')}</div></div></section>`
    : '';

  // Investigation findings — left column (subsections hidden if empty)
  const invFromSubs = section('Investigations (Findings)', [
    row('Blood', rx.inv_blood),
    row('PSA', rx.inv_psa),
    row('USG', rx.inv_usg),
    row('Uroflowmetry', rx.inv_uroflowmetry),
    row('CT', rx.inv_ct),
    row('MRI', rx.inv_mri),
    row('PET', rx.inv_pet),
  ]);
  const investigationsSection = invFromSubs
    || (rx.investigation_findings
      ? `<section class="sec"><div class="sech">Investigations (Findings)</div><div class="secb"><div class="para">${escapeHtml(rx.investigation_findings).replace(/\n/g, '<br/>')}</div></div></section>`
      : '');

  // Right-column UPPER (2/5): Chief Complaints, Examination, Findings & Diagnosis
  const ccSection = rx.chief_complaints
    ? `<section class="sec"><div class="sech">Chief Complaints</div><div class="secb"><div class="para">${escapeHtml(rx.chief_complaints).replace(/\n/g, '<br/>')}</div></div></section>`
    : '';
  // Examination: rendered ONLY when at least one of the 5 subsections has
  // content. The `section()` helper bails early when every row is blank so
  // an unfilled exam never shows in the final PDF (per requirement).
  const examSection = section('Examination', [
    row('P/A', rx.exam_pa),
    row('Ext. Genitalia', rx.exam_ext_genitalia),
    row('EUM', rx.exam_eum),
    row('Testis', rx.exam_testis),
    row('DRE', rx.exam_dre),
  ]);
  const diagnosisSection = rx.diagnosis
    ? `<section class="sec"><div class="sech">Findings &amp; Diagnosis</div><div class="secb"><div class="para">${escapeHtml(rx.diagnosis).replace(/\n/g, '<br/>')}</div></div></section>`
    : '';

  // Right-column LOWER (3/5): Medications, Advice, Follow-up
  // (Investigations Advised has been moved to the LEFT column so left/right
  //  visually balance, and so all "lab/test" data — both done & advised —
  //  reads in one continuous stack.)
  const medsSection = meds.length
    ? `<section class="sec medsec"><div class="sech"><span class="rxmark">℞</span> Medications</div>
        <div class="secb">
          <table class="meds">
            <colgroup><col style="width:22px"/><col style="width:42%"/><col/></colgroup>
            <thead><tr><th>#</th><th>Medicine / Dosage</th><th>Schedule &amp; Instructions</th></tr></thead>
            <tbody>${medRows}</tbody>
          </table>
        </div></section>`
    : '';
  const planParts: string[] = [];
  if (rx.advice)
    planParts.push(`<section class="sec"><div class="sech">Advice</div><div class="secb"><div class="para">${escapeHtml(rx.advice).replace(/\n/g, '<br/>')}</div></div></section>`);
  if (rx.follow_up)
    planParts.push(`<section class="sec"><div class="sech">Follow-up</div><div class="secb"><div class="para">${escapeHtml(rx.follow_up).replace(/\n/g, '<br/>')}</div></div></section>`);

  // Investigations Advised — now lives in the LEFT column, sitting under
  // "Investigations (Findings)" as a "what's next" pair to "what's done".
  const invAdvisedSection = rx.investigations_advised
    ? `<section class="sec"><div class="sech">Investigations Advised</div><div class="secb"><div class="para">${escapeHtml(rx.investigations_advised).replace(/\n/g, '<br/>')}</div></div></section>`
    : '';

  // ---- Patient Education tips (always rendered — fills left col gracefully)
  // Hardcoded urology-relevant lifestyle bullets. Kept short so it reads as
  // a helpful sticker, not a marketing block. Future: drive from clinic
  // settings (settings.tips) so the doctor can edit per-specialty.
  const tipsCard = `
  <section class="sec tipsCard">
    <div class="sech">Patient Education</div>
    <div class="secb">
      <ul class="tipsList">
        <li><b>Hydrate</b> · 2–3 L water/day; sip through the day</li>
        <li><b>Bladder discipline</b> · void by clock, don't hold</li>
        <li><b>Avoid</b> · tobacco, late caffeine, heavy alcohol</li>
        <li><b>Diet</b> · low salt, less spicy; high-fibre meals</li>
      </ul>
    </div>
  </section>`;

  // ---- Clinic / emergency contact mini-card (D)
  const clinicCard = `
  <section class="sec clinicCard">
    <div class="sech">Need Help?</div>
    <div class="secb">
      <div class="ccRow"><span class="ccIcon">📞</span><span class="ccText">${escapeHtml(clinicPhone)}</span></div>
      <div class="ccRow"><span class="ccIcon">🏥</span><span class="ccText">${escapeHtml(clinicName)}</span></div>
      <div class="ccRow"><span class="ccIcon">🕐</span><span class="ccText">Mon–Sat · 10 AM – 8 PM</span></div>
    </div>
  </section>`;

  // Assemble the body grid columns. We render the columns even when one is
  // partially empty so the layout doesn't collapse.
  const leftCol = [
    vitalsSection,
    ipssSection,
    investigationsSection,
    invAdvisedSection,
    tipsCard,
    clinicCard,
  ].filter(Boolean).join('');
  const rightUpper = [ccSection, examSection, diagnosisSection].filter(Boolean).join('');
  const rightLower = [medsSection, planParts.join('')].filter(Boolean).join('');

  return `
<html><head><meta charset="utf-8"/>
<style>
  /* ---- A4 page setup ------------------------------------------------- */
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body{
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    color:#1A2E35;
    font-size:11.5px;
    line-height:1.45;
    background:#E5E9EC;
  }
  .page{
    width: 210mm;
    min-height: 297mm;
    /* tighter top padding — pulls header up; matches user request.
       Bottom padding bumped to 22mm so the footer line + sign block
       sit comfortably above the page edge, not flush against it. */
    padding: 12mm 14mm 22mm 14mm;
    margin: 8mm auto;
    background: #fff;
    box-sizing: border-box;
    box-shadow: 0 4px 18px rgba(0,0,0,0.12);
    position: relative;
    overflow: hidden;
    /* Flex column so the footer can be pushed to the bottom of the page
       via "margin-top: auto" regardless of body content length. */
    display: flex;
    flex-direction: column;
  }
  @media print {
    body{background:#fff;}
    .page{
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 12mm 14mm 22mm 14mm;
      box-shadow: none;
      page-break-after: always;
    }
  }

  /* ---- Watermark ---------------------------------------------------- */
  .watermark{
    position:absolute;
    top:50%; left:50%;
    transform:translate(-50%,-50%) rotate(-22deg);
    font-size:96px;
    color:rgba(14,124,139,0.055);
    font-weight:900;
    letter-spacing:6px;
    pointer-events:none;
    z-index:0;
    white-space:nowrap;
  }

  /* ---- Header ------------------------------------------------------- */
  .head{
    display:flex; justify-content:space-between; align-items:stretch;
    border-bottom:2.5px solid #0E7C8B;
    padding-bottom:8px;
    position:relative; z-index:1;
  }
  .brand{display:flex; align-items:stretch; gap:12px;}
  .brand img{
    width:78px; height:78px; border-radius:10px;
    object-fit:cover; flex-shrink:0; align-self:center;
  }
  .brand .info{display:flex; flex-direction:column; justify-content:center;}
  .brand h1{margin:0; color:#0E7C8B; font-size:20px; letter-spacing:.3px;}
  .brand .degrees{color:#1A2E35; font-size:11px; font-weight:600; margin-top:2px;}
  .brand p{margin:1px 0; color:#5E7C81; font-size:10.5px; line-height:1.35;}
  .meta{text-align:right; font-size:10.5px; color:#5E7C81; align-self:center;}
  .meta .line{margin-bottom:2px;}
  .meta b{color:#1A2E35;}

  /* ---- Patient summary band ---------------------------------------- */
  .pd{
    background:#F4F9F9;
    border:1px solid #E2ECEC;
    border-radius:6px;
    padding:7px 12px;
    margin-top:8px;
    display:grid;
    grid-template-columns: 1.4fr 0.7fr 1fr 1fr 1fr;
    gap:2px 12px;
    position:relative; z-index:1;
  }
  .pd .k{
    font-size:8.5px; color:#5E7C81; text-transform:uppercase;
    letter-spacing:.5px; margin-bottom:1px;
  }
  .pd .v{color:#1A2E35; font-weight:600; font-size:11px;}
  .pdAddr{
    grid-column: 1 / -1;
    border-top:1px dashed #D1DDDD;
    padding-top:4px; margin-top:3px;
  }
  .colPlaceholder{flex:1;}

  /* ---- Sections ----------------------------------------------------- */
  .sec{
    margin-top:8px;
    page-break-inside: avoid;
    break-inside: avoid;
    position:relative; z-index:1;
  }
  .sec:first-child{margin-top:0;}
  .sech{
    background: linear-gradient(90deg, #0E7C8B 0%, #14a0b3 100%);
    color:#fff;
    padding:4px 9px;
    border-radius:4px 4px 0 0;
    font-size:10.5px;
    font-weight:700;
    letter-spacing:.5px;
    text-transform:uppercase;
  }
  .sechSub{
    font-weight:500;
    text-transform:none;
    letter-spacing:.2px;
    font-style:italic;
    opacity:.85;
    font-size:9.5px;
    margin-left:4px;
  }
  .secb{
    padding:6px 9px 5px;
    border:1px solid #DCEAEA;
    border-top:none;
    border-radius:0 0 4px 4px;
    background:#FCFEFE;
  }
  .row{display:flex; gap:6px; padding:1.5px 0; line-height:1.4;}
  .rk{
    flex-shrink:0;
    min-width:88px;
    font-size:10px;
    color:#5E7C81;
    font-weight:600;
  }
  .rv{flex:1; color:#1A2E35; font-size:11px;}
  .vitalsLine{font-size:11px; color:#1A2E35;}
  .para{font-size:11px; color:#1A2E35; white-space:pre-wrap; line-height:1.45;}

  /* ---- Body 3-zone grid -------------------------------------------- */
  .bodyGrid{
    display:flex;
    gap:6px;
    margin-top:8px;
    align-items:stretch;
    position:relative; z-index:1;
  }
  .colLeft{
    flex: 1 1 33.33%;
    max-width:33.33%;
    display:flex;
    flex-direction:column;
    gap:6px;
  }
  .colRight{
    flex: 2 1 66.66%;
    max-width:66.66%;
    display:flex;
    flex-direction:column;
    gap:6px;
  }
  .colRight .upper, .colRight .lower{
    display:flex;
    flex-direction:column;
    gap:6px;
  }

  /* ---- Patient Education tips card -------------------------------- */
  .tipsCard .sech{
    background: linear-gradient(90deg, #16A085 0%, #1abc9c 100%);
  }
  .tipsCard .secb{
    background: #F1FAF7;
    border-color: #C8EAE0;
  }
  .tipsList{
    margin:0; padding:0; list-style:none;
  }
  .tipsList li{
    font-size:10px; color:#1A2E35;
    padding:2px 0 2px 14px;
    position:relative;
    line-height:1.45;
  }
  .tipsList li:before{
    content:"";
    position:absolute; left:2px; top:7px;
    width:5px; height:5px; border-radius:50%;
    background:#16A085;
  }
  .tipsList b{color:#0E7C8B; font-weight:700;}

  /* ---- Clinic / Need Help mini-card -------------------------------- */
  .clinicCard .sech{
    background: linear-gradient(90deg, #6B4FBB 0%, #8e6ce5 100%);
  }
  .clinicCard .secb{
    background: #F7F4FE;
    border-color: #DDD3F4;
    padding:6px 9px;
  }
  .ccRow{
    display:flex; align-items:center; gap:7px;
    padding:2px 0; line-height:1.4;
  }
  .ccIcon{font-size:11px;}
  .ccText{font-size:10.5px; color:#1A2E35; font-weight:600;}

  /* ---- Medications table ------------------------------------------- */
  .medsec .secb{padding:0; background:#fff;}
  table.meds{
    width:100%;
    border-collapse:collapse;
    border-spacing:0;
    border:none;
  }
  table.meds th{
    background:#F4F9F9;
    color:#0E7C8B;
    padding:5px 8px;
    text-align:left;
    font-size:10px;
    font-weight:700;
    letter-spacing:.4px;
    border-bottom:1px solid #DCEAEA;
  }
  table.meds td{
    padding:6px 8px;
    border-bottom:1px solid #E2ECEC;
    vertical-align:top;
    font-size:10.5px;
  }
  table.meds tr{page-break-inside: avoid; break-inside: avoid;}
  table.meds tr:last-child td{border-bottom:none;}
  table.meds thead{display: table-header-group;}
  .num{font-weight:700; color:#0E7C8B; width:22px; text-align:center; font-size:11.5px;}
  .medname{font-weight:700; color:#1A2E35; font-size:11.5px; line-height:1.2;}
  .meddose{color:#5E7C81; font-size:9.5px; margin-top:2px;}
  .medinstr{color:#5E7C81; font-size:9.5px; font-style:italic; margin-top:2px;}
  .rxmark{font-family:'Times New Roman',serif; font-size:15px; font-weight:700;}

  /* ---- Footer / 4-col grid: QR · Promise · Blessing · Signature ----
     Tight 4-pillar band hugged to the bottom of the page (margin-top:auto)
     just above the dashed footer text. All four cells share the same
     min-height (82px) and content is vertically centred inside each. */
  .footwrap{
    display:grid;
    grid-template-columns: repeat(4, 1fr);
    align-items:stretch;
    margin-top:auto;
    padding-top:6px;
    gap:6px;
    page-break-inside: avoid;
    break-inside: avoid;
    position:relative; z-index:1;
  }
  .footCell{
    justify-self:center;
    text-align:center;
    width:100%;
    max-width:175px;
    min-height:82px;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    gap:2px;
  }

  /* QR block — kept readable for scanning */
  .qrBlock img{width:64px; height:64px;}
  .qrCap{font-size:8px; color:#5E7C81; margin-top:2px; line-height:1.25;}
  .qrCap b{color:#0E7C8B;}

  /* Practice promise card — tightened to ~82px */
  .promiseBox{
    border:1px solid #DCEAEA;
    border-radius:5px;
    padding:6px 6px 7px;
    background:linear-gradient(180deg, #F4F9F9 0%, #FCFEFE 100%);
    width:100%;
    box-sizing:border-box;
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    height:82px;
  }
  .promiseHead{
    font-size:7px;
    font-weight:800;
    color:#0E7C8B;
    text-transform:uppercase;
    letter-spacing:1.2px;
    margin-bottom:2px;
  }
  .promiseDivider{
    width:30px; height:1.5px;
    background: linear-gradient(90deg, #0E7C8B 0%, #14a0b3 100%);
    border-radius:1px;
    margin-bottom:4px;
  }
  .promiseValues{
    display:flex;
    flex-direction:column;
    gap:1px;
    align-items:center;
  }
  .promiseValue{
    font-size:9.5px;
    color:#1A2E35;
    font-weight:600;
    letter-spacing:.3px;
    line-height:1.2;
  }

  /* Center blessing — tightened, still readable */
  .centerMark{
    font-size:18px;
    color:#0A5E6B;
    line-height:1;
    opacity:.85;
    margin-bottom:2px;
  }
  .centerSanskrit{
    font-family: 'Sanskrit Text', 'Noto Serif Devanagari', 'Tiro Devanagari Sanskrit',
                  'Mangal', 'Hind Vadodara', 'Adobe Devanagari', serif;
    font-size:14.5px;
    color:#0A5E6B;
    font-weight:600;
    line-height:1.25;
    letter-spacing:.3px;
  }
  .centerTrans{
    font-style:italic;
    font-size:8.5px;
    color:#5E7C81;
    margin-top:2px;
    letter-spacing:.3px;
    line-height:1.3;
  }

  /* Signature — the e-signature is the visual hero of the cell.
     "Digitally Signed" pill stamp removed per user request; the date
     timestamp now lives in the bottom dashed footer line so legal trace
     isn't lost. */
  .signature{
    font-family:'Brush Script MT','Lucida Handwriting','Segoe Script',cursive;
    font-size:42px; color:#0A5E6B; line-height:1;
    margin-bottom:1px; letter-spacing:.5px;
  }
  .sigImg{
    height:64px;
    max-width:170px;
    object-fit:contain;
    margin:0 auto 1px;
    display:block;
  }
  .sigLine{border-top:1px solid #1A2E35; width:130px; margin:1px auto 0;}
  .sigName{font-weight:700; font-size:10.5px; color:#1A2E35; margin-top:2px;}
  .sigSub{color:#5E7C81; font-size:8px; line-height:1.3;}

  .foot{
    margin-top:8px;
    border-top:1px dashed #D1DDDD;
    padding-top:5px;
    font-size:8.5px;
    color:#5E7C81;
    text-align:center;
    line-height:1.5;
    position:relative; z-index:1;
  }
</style></head>
<body>
<div class="page">
  <div class="watermark">ConsultUro</div>

  <div class="head">
    <div class="brand">
      <img src="${LOGO_URL}"/>
      <div class="info">
        <h1>Dr. Sagar Joshi</h1>
        <div class="degrees">${escapeHtml(degrees)}</div>
        <p>Consultant Urologist, Laparoscopic &amp; Transplant Surgeon</p>
        <p>${escapeHtml(clinicName)} · ${escapeHtml(clinicPhone)}</p>
        <p style="font-size:9.5px;">Reg. No. ${escapeHtml(drReg)}</p>
      </div>
    </div>
    <div class="meta">
      <div class="line"><b>Date:</b> ${escapeHtml(visitDisplay)}</div>
      <div class="line"><b>Time:</b> ${escapeHtml(timeStr)}</div>
      ${rx.ref_doctor ? `<div class="line"><b>Ref. by:</b> ${escapeHtml(rx.ref_doctor)}</div>` : ''}
      <div class="line"><b>Rx ID:</b> <span style="font-family:monospace;font-size:9.5px;">${escapeHtml(rx.prescription_id)}</span></div>
    </div>
  </div>

  <div class="pd">
    <div><div class="k">Patient</div><div class="v">${escapeHtml(rx.patient_name) || '—'}</div></div>
    <div><div class="k">Age / Sex</div><div class="v">${escapeHtml(ageSex) || '—'}</div></div>
    <div><div class="k">Phone</div><div class="v">${escapeHtml(rx.patient_phone) || '—'}</div></div>
    <div><div class="k">Visit</div><div class="v">${escapeHtml(visitDisplay)}</div></div>
    <div><div class="k">Reg. No.</div><div class="v">${patientReg ? escapeHtml(patientReg) : '—'}</div></div>
    ${rx.patient_address ? `
    <div class="pdAddr">
      <div class="k">Address</div>
      <div class="v" style="font-weight:500; font-size:11px;">${escapeHtml(rx.patient_address).replace(/\n/g, ', ')}</div>
    </div>` : ''}
  </div>

  ${vitalsSection || ipssSection || investigationsSection || ccSection || examSection || diagnosisSection || medsSection || planParts.length ? `
  <div class="bodyGrid">
    <div class="colLeft">
      ${leftCol || '<div class="colPlaceholder"></div>'}
    </div>
    <div class="colRight">
      ${rightUpper ? `<div class="upper">${rightUpper}</div>` : ''}
      ${rightLower ? `<div class="lower">${rightLower}</div>` : ''}
    </div>
  </div>` : ''}

  <div class="footwrap">
    ${qrDataUrl ? `
    <div class="qrBlock footCell">
      <img src="${qrDataUrl}"/>
      <div class="qrCap"><b>Scan to verify</b><br/>Via ConsultUro</div>
    </div>` : `<div class="qrBlock footCell"></div>`}

    <div class="promiseBlock footCell">
      <div class="promiseBox">
        <div class="promiseHead">Our Promise</div>
        <div class="promiseDivider"></div>
        <div class="promiseValues">
          <div class="promiseValue">Compassion</div>
          <div class="promiseValue">Precision</div>
          <div class="promiseValue">Outcomes</div>
        </div>
      </div>
    </div>

    <div class="centerBlock footCell">
      <div class="centerMark">&#x2695;</div>
      <div class="centerSanskrit">सर्वे सन्तु निरामयाः</div>
      <div class="centerTrans">May all be free from disease</div>
    </div>

    <div class="sigBlock footCell">
      ${signatureUrl
        ? `<img class="sigImg" src="${escapeHtml(signatureUrl)}" alt="Signature"/>`
        : `<div class="signature">Sagar Joshi</div>`}
      <div class="sigLine"></div>
      <div class="sigName">Dr. Sagar Joshi</div>
      <div class="sigSub">Reg. No. ${escapeHtml(drReg)}</div>
    </div>
  </div>

  <div class="foot">
    Digitally generated &amp; signed prescription · ${escapeHtml(clinicName)} · ${escapeHtml(clinicAddr)}<br/>
    Signed: <b>${escapeHtml(nowStamp)}</b> · Verify at <b>${escapeHtml(verifyUrl)}</b> · Not valid without clinician stamp.
  </div>
</div>
</body></html>`;
}

/** Load latest homepage settings (cached per call). */
export async function loadClinicSettings(): Promise<ClinicSettings> {
  try {
    const { data } = await api.get('/settings/homepage');
    return data || {};
  } catch {
    return {};
  }
}

// Opens the Rx HTML in a new browser tab. Used by both Print and PDF actions
// on web. Returns the opened Window (or null if popup was blocked).
function openRxInNewTab(html: string, autoPrint: boolean): Window | null {
  if (typeof window === 'undefined') return null;
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const w = window.open(blobUrl, '_blank', 'noopener');
  if (!w) {
    window.location.assign(blobUrl);
    return null;
  }
  if (autoPrint) {
    try {
      w.addEventListener('load', () => {
        setTimeout(() => {
          try { w.focus(); w.print(); } catch {}
        }, 400);
      });
    } catch {}
  }
  setTimeout(() => {
    try { URL.revokeObjectURL(blobUrl); } catch {}
  }, 60000);
  return w;
}

// ─── Backend PDF bridge ────────────────────────────────────────────────────
// Sends the HTML we already build to /api/render/pdf which returns a real
// PDF (rendered by WeasyPrint). On web we return a blob URL; on native we
// also write the bytes to a local file via expo-file-system so they can be
// fed straight into Print.printAsync / Sharing.shareAsync.
import * as FileSystem from 'expo-file-system/legacy';

async function fetchPdfFromBackend(html: string): Promise<{ blob?: Blob; uri?: string; bytes?: Uint8Array }>
{
  // PDF rendering goes through WeasyPrint on the backend and can take
  // 5–30 s on a cold-started container, plus the round-trip for the
  // (potentially 1–2 MB) PDF binary. The default 15 s axios timeout
  // throws "timeout of 15000ms exceeded" / "Network Error" before the
  // server has a chance to respond. Bump it to 90 s for this endpoint
  // only — long enough for cold-start + render + transfer, but short
  // enough that a truly stuck request still surfaces an error to the
  // user instead of spinning forever.
  const resp = await api.post('/render/pdf', { html, filename: 'prescription.pdf' }, {
    responseType: Platform.OS === 'web' ? 'blob' : 'arraybuffer',
    timeout: 90_000,
  });
  if (Platform.OS === 'web') {
    return { blob: resp.data as Blob };
  }
  // native: write bytes to a cache file and return the path
  const ab: ArrayBuffer = resp.data as ArrayBuffer;
  const bytes = new Uint8Array(ab);
  // Convert to base64 (chunked, to avoid call-stack limits on big blobs).
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  const b64 = (globalThis as any).btoa
    ? (globalThis as any).btoa(bin)
    : Buffer.from(bytes).toString('base64');
  const uri = `${FileSystem.cacheDirectory}prescription-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, bytes };
}

/** Open the native Print dialog for this prescription.
 *
 *  Native (iOS/Android): uses `Print.printAsync({ html })` directly,
 *  which lets the OS's print engine render the HTML to PDF
 *  on-device — typically <1 second, no network call. This is the
 *  fastest possible path; the previous round-trip to the backend
 *  WeasyPrint endpoint took 5-30 s on cold-start and frequently
 *  surfaced as a "Network Error" alert when it exceeded 15 s.
 *
 *  Web: opens the rendered HTML in a hidden iframe and calls
 *  `iframe.contentWindow.print()`. The browser shows its native print
 *  dialog where the user can either send to a printer or "Save as
 *  PDF" — instant, no backend needed.
 */
export async function printPrescription(rx: RxDoc, settings?: ClinicSettings) {
  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(rx, s);

    if (Platform.OS === 'web') {
      // Web: render HTML in a hidden iframe → trigger browser print.
      // No backend round-trip; the browser's print engine handles
      // both paper-print AND "Save as PDF" via its dialog.
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '-9999px';
      iframe.style.bottom = '-9999px';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const idoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!idoc) throw new Error('Could not open print iframe');
      idoc.open();
      idoc.write(html);
      idoc.close();
      // Give the browser a tick to lay out before printing.
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (e) {
          window.alert('Could not open print dialog: ' + (e as any)?.message);
        }
      }, 250);
      // Clean up the iframe after print dialog closes (60 s safety).
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch {}
      }, 60_000);
      return;
    }

    // Native: hand the HTML straight to expo-print. The OS renders
    // the PDF locally (Android: PrintManager / iOS: UIPrintInteraction)
    // and shows the native print dialog — no network, no timeout.
    await Print.printAsync({ html });
  } catch (e: any) {
    const msg = e?.response?.data?.detail || e?.message || 'Could not print prescription';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Print failed', msg);
  }
}

/** Download / save the PDF locally.
 *
 *  Native: uses `Print.printToFileAsync({ html })` to generate the
 *  PDF on-device (instant) then opens the share-sheet so the user
 *  can save to Files / Drive / Photos. No backend.
 *
 *  Web: still goes through the backend `/render/pdf` (WeasyPrint) so
 *  the user gets a true PDF download with a real filename. Web has
 *  no on-device "HTML→PDF→file" API short of a print dialog.
 */
export async function downloadPrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(rx, s);

    const safeName = (rx.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const suffix = rx.registration_no || rx.prescription_id;
    const filename = `Prescription-${safeName || 'Patient'}-${suffix}.pdf`;

    if (Platform.OS === 'web') {
      // Web: confirm + fetch from backend.
      if (!window.confirm(`Download ${filename}?`)) return;
      const { blob } = await fetchPdfFromBackend(html);
      if (!blob) throw new Error('No PDF blob received');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
      }, 4000);
      return;
    }

    // Native: render PDF on-device via expo-print. Skips the entire
    // network round-trip so it's near-instant and never times out.
    const { uri } = await Print.printToFileAsync({ html });
    if (!uri) throw new Error('No PDF file generated');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: filename,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('PDF generated', `File saved at: ${uri}`);
    }
  } catch (e: any) {
    const msg = e?.response?.data?.detail || e?.message || 'Could not generate PDF';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('PDF preview failed', msg);
  }
}

/** Share the PDF FILE via the OS share-sheet. No verify-link text — the
 *  recipient gets the actual PDF attachment.
 *
 *  Native: on-device PDF (instant). Web: backend PDF (since browsers
 *  can't share files programmatically without a real File object).
 */
export async function sharePrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  const safeName = (rx.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const suffix = rx.registration_no || rx.prescription_id;
  const filename = `Prescription-${safeName || 'Patient'}-${suffix}.pdf`;

  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(rx, s);

    if (Platform.OS === 'web') {
      const { blob } = await fetchPdfFromBackend(html);
      if (!blob) throw new Error('No PDF blob received');
      const file = new File([blob], filename, { type: 'application/pdf' });
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ title: filename, files: [file] });
          return;
        } catch (_e) { /* user cancelled or share failed; fall through */ }
      }
      // Fallback: trigger a download so the user can attach manually.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
      }, 4000);
      window.alert('Your browser does not support direct file sharing — the PDF has been downloaded so you can attach it manually.');
      return;
    }

    // Native: instant on-device PDF via expo-print, then OS share-sheet.
    const { uri } = await Print.printToFileAsync({ html });
    if (!uri) throw new Error('No PDF file generated');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share Prescription',
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Sharing unavailable', `File saved at: ${uri}`);
    }
  } catch (e: any) {
    const msg = e?.response?.data?.detail || e?.message || 'Could not share prescription';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Share failed', msg);
  }
}

/** Convenience: fetch full Rx from API then call the given action. */
export async function fetchRxAndRun(
  prescription_id: string,
  action: (rx: RxDoc) => Promise<void> | void
) {
  try {
    const { data } = await api.get(`/prescriptions/${prescription_id}`);
    await action(data);
  } catch (e: any) {
    const msg = e?.response?.data?.detail || 'Could not load prescription';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Error', msg);
  }
}
