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
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  // Letterhead — banner image (data URI / URL) that REPLACES the
  // entire app-logo / clinic-name / contact-info header strip on
  // every page of the Rx PDF when `use_letterhead` is true.
  letterhead_image_b64?: string;
  use_letterhead?: boolean;
  // Per-clinic editable copy for the "Patient Education" tips card
  // and the "Need Help?" mini-card. Both accept simple HTML; falls
  // back to the built-in defaults when null/empty.
  patient_education_html?: string;
  need_help_html?: string;
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

  // Letterhead — when enabled by primary_owner in the Branding panel,
  // the supplied banner image REPLACES the entire app-logo + clinic-
  // name + contact strip at the top of the page. Falls back to the
  // built-in branded header when not enabled or the image is empty.
  const letterheadEnabled = !!(settings.use_letterhead && (settings.letterhead_image_b64 || '').trim());
  const letterheadSrc = letterheadEnabled ? String(settings.letterhead_image_b64 || '').trim() : '';
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
  // Sourced from clinic_settings.patient_education_html when the
  // primary_owner has provided custom copy in the Branding panel,
  // otherwise falls back to the built-in urology lifestyle bullets.
  // Stored HTML is rendered as-is — the Branding panel sanitises the
  // input on the way in (no <script>, no <iframe>, etc.).
  const _eduCustom = (settings as any)?.patient_education_html?.trim?.() || '';
  const tipsCard = `
  <section class="sec tipsCard">
    <div class="sech">Patient Education</div>
    <div class="secb">
      ${_eduCustom
        ? `<div class="custom-rt">${_eduCustom}</div>`
        : `<ul class="tipsList">
        <li><b>Hydrate</b> · 2–3 L water/day; sip through the day</li>
        <li><b>Bladder discipline</b> · void by clock, don't hold</li>
        <li><b>Avoid</b> · tobacco, late caffeine, heavy alcohol</li>
        <li><b>Diet</b> · low salt, less spicy; high-fibre meals</li>
      </ul>`}
    </div>
  </section>`;

  // ---- Clinic / emergency contact mini-card (D)
  // Same custom-or-default pattern as Patient Education above.
  const _helpCustom = (settings as any)?.need_help_html?.trim?.() || '';
  const clinicCard = `
  <section class="sec clinicCard">
    <div class="sech">Need Help?</div>
    <div class="secb">
      ${_helpCustom
        ? `<div class="custom-rt">${_helpCustom}</div>`
        : `<div class="ccRow"><span class="ccIcon">📞</span><span class="ccText">${escapeHtml(clinicPhone)}</span></div>
      <div class="ccRow"><span class="ccIcon">🏥</span><span class="ccText">${escapeHtml(clinicName)}</span></div>
      <div class="ccRow"><span class="ccIcon">🕐</span><span class="ccText">Mon–Sat · 10 AM – 8 PM</span></div>`}
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
      /* Keep the .page element filling the entire printed sheet so
         the .footwrap rule (margin-top:auto) actually pushes the
         bottom row to the page edge when the prescription body is
         short. Previously this was min-height:0 which collapsed the
         page to content height — the QR / Promise / Sign row + the
         "Digitally generated..." footer ended up dragging up under
         a sparse body, against the user's request. */
      min-height: 100vh;
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

  /* ---- Letterhead (custom banner) ---------------------------------- */
  /* Replaces the .head + .brand strip when use_letterhead is on. We
     constrain the height so any aspect ratio fits gracefully — tall
     banners get scaled down, wide banners fill the column. */
  .letterhead{
    width:100%;
    margin: 0 0 6px 0;
    text-align:center;
    border-bottom: 1px solid #DCE3E6;
    padding-bottom: 6px;
  }
  .letterhead img{
    max-width: 100%;
    max-height: 36mm;       /* ~ enough for a real letterhead banner   */
    object-fit: contain;
    display: block;
    margin: 0 auto;
  }
  /* Compact meta strip rendered just below the letterhead so Date /
     Time / Rx ID / Ref-by stay accessible even when the custom
     letterhead doesn't include those fields. */
  .metaStrip{
    display:flex;
    flex-wrap:wrap;
    justify-content: space-between;
    gap: 6px 12px;
    font-size: 9px;
    color: #5E7C81;
    border-bottom: 1px solid #ECF1F2;
    padding: 2px 0 4px;
    margin: 0 0 6px;
  }
  .metaStrip b{ color:#1A2E35; }

  /* ---- ConsultUro brand stamp — shown on every page ---------------- */
  /* Sits inside the page-level dashed footer. In screen + print
     modes it rides along with the .foot block. For multi-page Rx, the
     .page element is duplicated by the renderer so the stamp repeats
     on every page automatically. */
  .consulturo-stamp{
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 8.5px;
    color: #0A5E6B;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  .consulturo-stamp .cu-dot{
    width: 8px; height: 8px;
    border-radius: 4px;
    background: linear-gradient(135deg, #0E7C8B, #15B8C7);
    box-shadow: 0 0 0 2px rgba(14,124,139,0.18);
  }
  .consulturo-stamp .cu-text{ color:#0A5E6B; }
  .consulturo-stamp .cu-tag{ color:#5E7C81; font-weight: 500; text-transform: none; letter-spacing: 0; }
</style></head>
<body>
<div class="page">
  <div class="watermark">ConsultUro</div>

  ${letterheadEnabled ? `
  <div class="letterhead">
    <img src="${escapeHtml(letterheadSrc)}" alt="Letterhead"/>
  </div>` : `
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
  </div>`}

  ${letterheadEnabled ? `
  <div class="metaStrip">
    <span><b>Date:</b> ${escapeHtml(visitDisplay)}</span>
    <span><b>Time:</b> ${escapeHtml(timeStr)}</span>
    ${rx.ref_doctor ? `<span><b>Ref. by:</b> ${escapeHtml(rx.ref_doctor)}</span>` : ''}
    <span><b>Rx ID:</b> <span style="font-family:monospace;">${escapeHtml(rx.prescription_id)}</span></span>
  </div>` : ''}

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
    <div class="consulturo-stamp">
      <span class="cu-dot"></span>
      <span class="cu-text">ConsultUro</span>
      <span class="cu-tag">· Generated on ConsultUro Platform</span>
    </div>
  </div>
</div>
</body></html>`;
}

/** Load latest homepage + clinic settings (merged) so the Rx renderer
 *  has access to BOTH the homepage doctor/clinic strip and the new
 *  Branding-panel-managed Letterhead / Patient-Education / Need-Help
 *  customisations stored in `clinic_settings`. Either endpoint can fail
 *  independently — we degrade gracefully.
 */
export async function loadClinicSettings(): Promise<ClinicSettings> {
  const [hp, cs] = await Promise.all([
    api.get('/settings/homepage').then((r) => r.data || {}).catch(() => ({})),
    api.get('/clinic-settings').then((r) => r.data || {}).catch(() => ({})),
  ]);
  // homepage settings already include the canonical clinic_name /
  // clinic_phone / doctor_degrees fields. clinic-settings adds the
  // letterhead, use_letterhead, patient_education_html, need_help_html
  // (and a parallel clinic_name; homepage wins if both set).
  return { ...cs, ...hp,
    letterhead_image_b64: cs.letterhead_image_b64 || hp.letterhead_image_b64,
    use_letterhead: cs.use_letterhead ?? hp.use_letterhead,
    patient_education_html: cs.patient_education_html || hp.patient_education_html,
    need_help_html: cs.need_help_html || hp.need_help_html,
  };
}

// Sanitises any error/value into a short, plain-text message safe to put into
// window.alert / Alert.alert. Defends in depth against the "raw HTML/CSS dump
// to screen" bug — if the message contains ANY tag-like, CSS-like, or
// long-block-of-code-looking content, we discard it and surface the
// fallback instead. The full original error is still console.error'd for
// engineering diagnosis.
function safeMsg(e: any, fallback: string): string {
  try {
    // eslint-disable-next-line no-console
    console.error('[rx-pdf] action failed:', e);
  } catch {}
  let raw: any = e?.response?.data?.detail ?? e?.message ?? e;
  if (raw == null) return fallback;
  let m: string;
  if (typeof raw === 'string') {
    m = raw;
  } else {
    try { m = String(raw); } catch { return fallback; }
  }
  // Quick heuristic — if the message looks like it contains an HTML
  // template (style/script/html/body/meta/link/table tags), or
  // CSS at-rules (@page / @media / @keyframes / @font-face), or a
  // CSS comment block, or a `selector { … }` declaration — treat
  // it as a CODE LEAK and silently switch to the friendly fallback.
  // This is the defense that prevents the prior bug from ever
  // recurring even if some upstream code path stringifies the Rx
  // template into an error message.
  const looksLikeCode =
    /<\s*\/?\s*(style|script|html|head|body|meta|link|table|div|section|span)\b/i.test(m) ||
    /@(page|media|keyframes|font-face|import|charset)\b/i.test(m) ||
    /\/\*[\s\S]*?\*\//.test(m) ||
    (/\{[^{}]{0,400}[:;][^{}]{0,400}\}/.test(m) && /(:|;)/.test(m)) ||
    (m.length > 600);
  if (looksLikeCode) return fallback;
  // Strip residual tags (defensive — should already be gone via the
  // heuristic above), control chars, and collapse whitespace.
  m = m.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!m) return fallback;
  if (m.length > 240) m = m.slice(0, 237) + '…';
  return m;
}

// Show a clean, user-friendly alert. Always strips HTML / unsafe content.
function showWebAlert(message: string) {
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
  }
}

/**
 * Web-only: Print the supplied HTML using a hidden <iframe srcdoc>.
 *
 * Why iframe (srcdoc) and not window.open?
 *  • The Emergent preview, the EAS preview, and many corporate intranets
 *    embed our app inside an outer iframe. Inside such an iframe,
 *    window.open() is frequently blocked or returns a Window that can't
 *    receive document.write() — both modes manifested as "raw HTML on
 *    screen" earlier.
 *  • A same-document iframe with `srcdoc` always renders, never triggers
 *    a popup blocker, and lets us call iframe.contentWindow.print()
 *    which behaves identically to a real top-level print on every modern
 *    browser (Chrome/Edge/Safari/Firefox).
 *  • The previous Blob+anchor fallback could navigate the parent frame
 *    in some browsers, replacing the React app with the raw Rx HTML —
 *    the visual bug the user reported.
 */
function webPrintViaIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      return reject(new Error('Print is only available on Web'));
    }
    // Tear down any leftover iframe from a prior print; otherwise multiple
    // attempts stack up and trigger duplicate print dialogs.
    const prev = document.getElementById('__rx_print_frame__');
    if (prev && prev.parentNode) {
      try { prev.parentNode.removeChild(prev); } catch {}
    }
    const iframe = document.createElement('iframe');
    iframe.id = '__rx_print_frame__';
    iframe.setAttribute('aria-hidden', 'true');
    // Off-screen but ATTACHED so the browser actually lays out & paints
    // (visibility:hidden / display:none would skip paint, breaking print).
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    let settled = false;
    const cleanup = (delay = 60_000) => {
      // Defer DOM removal so the browser can keep painting the
      // iframe while the user interacts with the print dialog.
      setTimeout(() => {
        try { iframe.parentNode?.removeChild(iframe); } catch {}
      }, delay);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup(0);
      reject(err);
    };
    iframe.onload = () => {
      try {
        const w = iframe.contentWindow;
        if (!w) return fail(new Error('Print frame unavailable'));
        // Wait for any embedded images (logo, signature, QR, letterhead)
        // to finish loading before invoking print() — otherwise a fast
        // print() can fire before the layout settles and produce a blank
        // page on Safari/Firefox.
        const doc = w.document;
        const imgs = Array.from(doc?.images || []);
        const wait = imgs.length === 0
          ? Promise.resolve()
          : Promise.all(
              imgs.map((img) =>
                new Promise<void>((r) => {
                  if ((img as HTMLImageElement).complete) return r();
                  img.addEventListener('load', () => r(), { once: true });
                  img.addEventListener('error', () => r(), { once: true });
                  setTimeout(r, 800);
                })
              )
            );
        wait.then(() => {
          try { w.focus(); w.print(); } catch {}
          finish();
        });
      } catch (err: any) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    };
    iframe.onerror = () => fail(new Error('Failed to load print frame'));
    document.body.appendChild(iframe);
    // `srcdoc` is set after appending so onload fires reliably (Safari).
    try {
      iframe.srcdoc = html;
    } catch (e: any) {
      // Older browsers without srcdoc — fall back to document.write.
      try {
        const w = iframe.contentWindow;
        if (w) {
          w.document.open();
          w.document.write(html);
          w.document.close();
        } else {
          fail(new Error('Print frame unsupported'));
        }
      } catch (err: any) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    }
    // Safety net for browsers where onload never fires (rare).
    setTimeout(() => {
      if (settled) return;
      try {
        const w = iframe.contentWindow;
        if (w) { w.focus(); w.print(); }
      } catch {}
      finish();
    }, 2500);
  });
}

// ─── Backend PDF bridge ────────────────────────────────────────────────────
// Sends the HTML we already build to /api/render/pdf which returns a real
// PDF (rendered by WeasyPrint). On web we return a blob URL; on native we
// also write the bytes to a local file via expo-file-system so they can be
// fed straight into Print.printAsync / Sharing.shareAsync.
//
// (FileSystem is now imported once at the top of the file.)

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
      // Web print: render the Rx into a hidden <iframe srcdoc> and
      // call iframe.contentWindow.print(). This is the most robust
      // approach for our environment because:
      //   • It works inside the Emergent Kubernetes-ingress preview
      //     (which is itself iframed and blocks window.open).
      //   • It never opens a top-level navigation that could replace
      //     the React app with the raw Rx HTML — the visual bug the
      //     user reported earlier.
      //   • It sidesteps popup-blockers entirely.
      await webPrintViaIframe(html);
      return;
    }

    // Native: hand the HTML straight to expo-print. The OS renders
    // the PDF locally (Android: PrintManager / iOS: UIPrintInteraction)
    // and shows the native print dialog — no network, no timeout.
    await Print.printAsync({ html });
  } catch (e: any) {
    const msg = safeMsg(e, 'Could not print prescription');
    if (Platform.OS === 'web') showWebAlert(msg);
    else Alert.alert('Print failed', msg);
  }
}

/** Download / save the PDF locally.
 *
 *  Native: uses `Print.printToFileAsync({ html })` to generate the PDF
 *  on-device (~500 ms), then writes it to the user's chosen folder via
 *  Storage Access Framework (Android) or to the app's Documents
 *  directory (iOS). No share-sheet pop-up — this is a SAVE action.
 *
 *  Web: backend `/render/pdf` (WeasyPrint) returns a real PDF blob,
 *  which is delivered to the user via a programmatic <a download>.
 *  Same on desktop and mobile web. If the renderer is unreachable
 *  the user sees a clean error — we DON'T silently switch to a print
 *  dialog because the doctor explicitly chose "Download".
 */
export async function downloadPrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  // ── Web flow — every step is isolated so the user gets a clear
  //    success or a clean error message; never the wrong path.
  if (Platform.OS === 'web') {
    let html: string;
    try {
      const s = settings || (await loadClinicSettings());
      html = await buildRxHtml(rx, s);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[rx-pdf] buildRxHtml failed:', e);
      showWebAlert(safeMsg(e, 'Could not generate PDF. Please retry.'));
      return;
    }

    const safeName = (rx.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const suffix = rx.registration_no || rx.prescription_id;
    const filename = `Prescription-${safeName || 'Patient'}-${suffix}.pdf`;

    // DOWNLOAD on web means "save a real .pdf file to the user's
    // Downloads folder" — same on desktop AND on mobile. We always go
    // through the backend WeasyPrint renderer because that's the only
    // way to produce an actual PDF in the browser. Print and Share
    // have their own dedicated paths; we don't fall back to either
    // here — the doctor explicitly tapped "Download".
    try {
      const { blob } = await fetchPdfFromBackend(html);
      if (!blob || blob.size === 0) {
        showWebAlert('PDF service returned an empty file. Please retry.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
      }, 4000);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error('[rx-pdf] backend PDF failed:', e);
      showWebAlert(safeMsg(e, 'Could not generate PDF. Please retry.'));
    }
    return;
  }

  // ─── Native (iOS / Android) ─────────────────────────────────────────
  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(rx, s);

    const safeName = (rx.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const suffix = rx.registration_no || rx.prescription_id;
    const filename = `Prescription-${safeName || 'Patient'}-${suffix}.pdf`;

    // Render PDF on-device via expo-print. Skips the entire
    // network round-trip so it's near-instant and never times out.
    const { uri } = await Print.printToFileAsync({ html });
    if (!uri) throw new Error('No PDF file generated');

    // ─── True "Save to device" — never opens the share sheet ───
    // Android: use Storage Access Framework. We ask the user once for
    // a directory (cached in AsyncStorage) and write subsequent PDFs
    // there silently.
    if (Platform.OS === 'android') {
      const saved = await saveToAndroidUserFolder(uri, filename);
      if (saved.ok) {
        Alert.alert('Prescription saved', `Saved as ${filename}\n${saved.where}`);
      } else if (saved.cancelled) {
        // User dismissed the directory chooser — silent: don't fall back to share.
      } else {
        // Fallback to a guaranteed-writable cache copy and surface the path.
        const fallback = `${FileSystem.documentDirectory}${filename}`;
        try {
          await FileSystem.copyAsync({ from: uri, to: fallback });
        } catch {}
        Alert.alert(
          'Saved internally',
          `Could not write to the chosen folder. Saved inside the app at:\n${fallback}`,
        );
      }
      return;
    }

    // iOS: write to the app's Documents directory (visible in Files
    // → On My iPhone → ConsultUro provided UIFileSharingEnabled is on).
    if (Platform.OS === 'ios') {
      try {
        const subDir = `${FileSystem.documentDirectory}Prescriptions/`;
        await FileSystem.makeDirectoryAsync(subDir, { intermediates: true }).catch(() => {});
        const target = `${subDir}${filename}`;
        await FileSystem.copyAsync({ from: uri, to: target });
        Alert.alert(
          'Prescription saved',
          `Saved as ${filename}\nFiles → On My iPhone → ConsultUro → Prescriptions`,
        );
      } catch (e: any) {
        Alert.alert('Save failed', safeMsg(e, 'Could not save the PDF.'));
      }
      return;
    }

    // Other native platforms (rare) — keep the share fallback so the
    // user isn't dead-ended.
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
    Alert.alert('PDF preview failed', safeMsg(e, 'Could not generate PDF'));
  }
}

/** Share the PDF FILE via the OS share-sheet.
 *
 *  Native (iOS/Android): generate the PDF on-device with
 *  `Print.printToFileAsync({ html })` (~500 ms) then hand the URI to
 *  `Sharing.shareAsync()` which pops the OS share-sheet. The recipient
 *  receives the actual PDF as an attachment.
 *
 *  Web: backend WeasyPrint → real PDF File. We then try the Web
 *  Share API (Chrome on Android, Safari on iOS Web) which opens the
 *  native share-sheet with the PDF directly attached. If the browser
 *  doesn't support sharing files (most desktop browsers), we fall
 *  back to a silent download + a brief instruction so the user can
 *  attach the file from their Downloads folder.
 */
export async function sharePrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  const safeName = (rx.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  const suffix = rx.registration_no || rx.prescription_id;
  const filename = `Prescription-${safeName || 'Patient'}-${suffix}.pdf`;

  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(rx, s);

    if (Platform.OS === 'web') {
      // Web SHARE = Download + Share. Spec:
      //   1. Backend WeasyPrint → real PDF blob.
      //   2. If the browser supports Web Share API with files
      //      (Chrome on Android, Safari on iOS Web) → open the
      //      OS share-sheet with the PDF attached.
      //   3. Else → save the PDF to Downloads + brief instruction.
      // No print-dialog fallback here — the user explicitly chose
      // "Share", not "Print".
      let blob: Blob | undefined;
      try {
        const r = await fetchPdfFromBackend(html);
        blob = r.blob;
      } catch (e: any) {
        showWebAlert(safeMsg(e, 'Could not generate PDF for sharing. Please retry.'));
        return;
      }
      if (!blob || blob.size === 0) {
        showWebAlert('PDF service returned an empty file. Please retry.');
        return;
      }

      // Try Web Share API with a real File attachment.
      try {
        const FileCtor: any = (typeof File !== 'undefined') ? File : null;
        if (FileCtor && (navigator as any)?.canShare) {
          const file = new FileCtor([blob], filename, { type: 'application/pdf' });
          if ((navigator as any).canShare({ files: [file] })) {
            await (navigator as any).share({
              files: [file],
              title: filename,
              text: filename,
            });
            return;
          }
        }
      } catch (e: any) {
        // User dismissed the share-sheet — silent.
        if (e?.name === 'AbortError') return;
        // Other errors: fall through to download fallback.
      }

      // Fallback: silent download + brief alert so the doctor knows
      // where to find the file to attach manually.
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch {}
        }, 4000);
        showWebAlert(
          `Saved "${filename}" to your Downloads. Attach it from there to share with your patient (WhatsApp, Email, etc.).`,
        );
      } catch (e: any) {
        showWebAlert(safeMsg(e, 'Could not share prescription'));
      }
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
    const msg = safeMsg(e, 'Could not share prescription');
    if (Platform.OS === 'web') showWebAlert(msg);
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
    const msg = safeMsg(e, 'Could not load prescription');
    if (Platform.OS === 'web') showWebAlert(msg);
    else Alert.alert('Error', msg);
  }
}


/**
 * Android: write the in-cache PDF to a user-chosen folder via Storage
 * Access Framework. The folder URI is cached in AsyncStorage so the
 * user is asked exactly once; subsequent saves go silently to the
 * same location ("Downloads/ConsultUro" or whatever they picked).
 *
 * Returns:
 *   • { ok: true,  where: "<folder display name>" }  — saved
 *   • { ok: false, cancelled: true }                  — user dismissed picker
 *   • { ok: false, cancelled: false, error?: any }    — write failure
 */
async function saveToAndroidUserFolder(
  srcUri: string,
  filename: string,
): Promise<{ ok: true; where: string } | { ok: false; cancelled: boolean; error?: any }> {
  const KEY = 'rx_save_dir_uri_v1';
  const SAF: any = (FileSystem as any).StorageAccessFramework;
  if (!SAF || typeof SAF.requestDirectoryPermissionsAsync !== 'function') {
    return { ok: false, cancelled: false, error: 'StorageAccessFramework not available' };
  }
  try {
    let dirUri: string | null = null;
    try {
      dirUri = await AsyncStorage.getItem(KEY);
    } catch {}
    // Validate the cached URI is still writable; SAF permissions can
    // be revoked by the user at any time.
    if (dirUri) {
      try {
        // Probe by listing — cheap & avoids surprising the user.
        await SAF.readDirectoryAsync(dirUri);
      } catch {
        dirUri = null;
      }
    }
    if (!dirUri) {
      const perm = await SAF.requestDirectoryPermissionsAsync();
      if (!perm?.granted || !perm?.directoryUri) {
        return { ok: false, cancelled: true };
      }
      dirUri = perm.directoryUri as string;
      try { await AsyncStorage.setItem(KEY, dirUri); } catch {}
    }
    const newFileUri: string = await SAF.createFileAsync(
      dirUri!,
      filename.replace(/\.pdf$/i, ''),
      'application/pdf',
    );
    const data = await FileSystem.readAsStringAsync(srcUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(newFileUri, data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // SAF directory URIs are opaque; render a friendly hint by trimming
    // to the path tail when possible.
    const where = (() => {
      try {
        const decoded = decodeURIComponent(dirUri!);
        const tail = decoded.split(/[:/]/).filter(Boolean).pop() || 'chosen folder';
        return `Saved to: ${tail}`;
      } catch {
        return 'Saved to chosen folder';
      }
    })();
    return { ok: true, where };
  } catch (e) {
    return { ok: false, cancelled: false, error: e };
  }
}

