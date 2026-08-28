// Visit Summary PDF — one-page clinical encounter export.
//
// Mirrors the clean, branded look of the prescription PDF (rx-pdf.ts) so a
// completed Encounter can be handed to the patient / attached to WhatsApp as
// a tidy summary. All branding (clinic name, address, phone, doctor degrees,
// reg no, signature, letterhead) is sourced from the SAME clinic settings
// used by the Rx renderer via `loadClinicSettings()`, so a change in
// Branding & Settings → Clinic & Prescription Details flows through here too.
//
// Rendering is delegated to `sharePdfFromHtml` which produces a REAL .pdf
// file (never the OS print dialog).

import QRCode from 'qrcode';
import { LOGO_URL } from './theme';
import { parseBackendDate, formatISTDate, formatISTTime } from './date';
import { loadClinicSettings, type ClinicSettings } from './rx-pdf';

export type EncounterVitals = {
  bp?: string;
  pulse?: string;
  temp?: string;
  spo2?: string;
  weight?: string;
};

export type EncounterDoc = {
  encounter_id: string;
  patient_name?: string;
  patient_age?: number | string;
  patient_sex?: string;
  patient_phone?: string;
  created_at?: string;
  created_by_name?: string;
  vitals?: EncounterVitals;
  diagnoses?: string[];
  chief_complaint?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  follow_up_date?: string;
  prescription_id?: string;
  payment_status?: string;
  fee_amount?: number | string | null;
  receipt_no?: string;
};

const escapeHtml = (s?: string | number) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );

/** SOAP-style section band — hidden entirely when the value is empty. */
function section(title: string, value?: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  const html = escapeHtml(v).replace(/\n/g, '<br/>');
  return `<section class="sec"><div class="sech">${escapeHtml(title)}</div><div class="secb"><div class="para">${html}</div></div></section>`;
}

export async function buildEncounterHtml(enc: EncounterDoc, settings: ClinicSettings = {}): Promise<string> {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || 'https://www.drsagarjoshi.com').replace(/\/$/, '');
  const verifyUrl = `${base}/api/encounters/${enc.encounter_id}`;

  // Verify QR — rendered as inline SVG (works on web + native).
  let qrSvg = '';
  try {
    qrSvg = await QRCode.toString(verifyUrl, {
      type: 'svg', margin: 1, width: 160,
      color: { dark: '#0A5E6B', light: '#FFFFFF' },
    });
    qrSvg = qrSvg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '').trim();
  } catch { qrSvg = ''; }

  const createdDate = enc.created_at ? parseBackendDate(enc.created_at) : null;
  const visitDisplay = createdDate ? formatISTDate(createdDate) : formatISTDate(new Date());
  const timeStr = createdDate ? formatISTTime(createdDate) : formatISTTime(new Date());
  const nowStamp = createdDate
    ? `${formatISTDate(createdDate)} ${formatISTTime(createdDate)} IST`
    : `${formatISTDate(new Date())} ${formatISTTime(new Date())} IST`;

  const clinicName = (settings.clinic_name || 'Sterling Hospitals').trim();
  const clinicAddr = (settings.clinic_address || 'Sterling Hospitals, Race Course Road, Vadodara – 390007').trim();
  const clinicPhone = (settings.clinic_phone || '+91 81550 75669').trim();
  const degrees = (settings.doctor_degrees || 'MBBS · MS · DrNB (Urology)').trim();
  const drReg = (settings.doctor_reg_no || 'G-53149').trim();
  const doctorName = (settings.doctor_name || 'Dr. Sagar Joshi').trim();
  const signatureUrl = (settings.signature_url || '').trim();

  const letterheadEnabled = !!(settings.use_letterhead && (settings.letterhead_image_b64 || '').trim());
  const letterheadSrc = letterheadEnabled ? String(settings.letterhead_image_b64 || '').trim() : '';

  const ageSex = [enc.patient_age || '', enc.patient_sex || ''].filter((x) => String(x).trim()).join(' / ');

  // Vitals chips — only render the ones that were filled.
  const v = enc.vitals || {};
  const vitalPairs: [string, string][] = ([
    ['Pulse', v.pulse], ['BP', v.bp], ['Temp', v.temp], ['SpO₂', v.spo2], ['Weight', v.weight],
  ] as [string, string | undefined][]).filter(([, val]) => !!(val || '').trim()) as [string, string][];
  const vitalsBlock = vitalPairs.length
    ? `<section class="sec"><div class="sech">Vitals</div><div class="secb"><div class="vitalsRow">${
        vitalPairs.map(([k, val]) =>
          `<div class="vitalChip"><span class="vk">${escapeHtml(k)}</span><span class="vv">${escapeHtml(val)}</span></div>`
        ).join('')
      }</div></div></section>`
    : '';

  // Diagnoses chips.
  const dx = (enc.diagnoses || []).filter((d) => (d || '').trim());
  const dxBlock = dx.length
    ? `<section class="sec"><div class="sech">Diagnoses</div><div class="secb"><div class="dxRow">${
        dx.map((d) => `<span class="dxChip">${escapeHtml(d)}</span>`).join('')
      }</div></div></section>`
    : '';

  const soap = [
    section('Chief Complaint', enc.chief_complaint),
    section('Subjective', enc.subjective),
    section('Objective', enc.objective),
    section('Assessment', enc.assessment),
    section('Plan', enc.plan),
  ].filter(Boolean).join('');

  const followBlock = (enc.follow_up_date || '').trim()
    ? `<section class="sec"><div class="sech">Follow-up</div><div class="secb"><div class="para"><b>${escapeHtml(enc.follow_up_date)}</b></div></div></section>`
    : '';

  // Billing / payment status band.
  const payStatus = String(enc.payment_status || '').toLowerCase();
  const payMeta: Record<string, { label: string; bg: string; fg: string }> = {
    paid: { label: 'PAID', bg: '#D1FAE5', fg: '#047857' },
    pending: { label: 'PAYMENT PENDING', bg: '#FEF3C7', fg: '#B45309' },
    waived: { label: 'WAIVED OFF', bg: '#F1F5F9', fg: '#475569' },
  };
  const pm = payMeta[payStatus];
  const feeNum = Number(enc.fee_amount || 0);
  const billingBlock = pm
    ? `<section class="sec"><div class="sech">Billing</div><div class="secb"><div class="billRow">
         <span class="payTag" style="background:${pm.bg};color:${pm.fg};">${pm.label}</span>
         ${feeNum > 0 ? `<span class="billFee">Consultation fee: <b>₹${escapeHtml(String(feeNum))}</b></span>` : ''}
         ${(enc.receipt_no || '').trim() ? `<span class="billRcpt">Receipt: <b>${escapeHtml(enc.receipt_no)}</b></span>` : ''}
       </div></div></section>`
    : '';

  return `
<html><head><meta charset="utf-8"/>
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body{
    font-family: -apple-system, Helvetica, Arial, sans-serif;
    color:#1A2E35; font-size:11.5px; line-height:1.45; background:#E5E9EC;
  }
  .page{
    width: 210mm; min-height: 297mm; padding: 12mm 14mm 10mm 14mm;
    margin: 8mm auto; background:#fff; box-sizing:border-box;
    box-shadow: 0 4px 18px rgba(0,0,0,0.12); position:relative; overflow:hidden;
    display:flex; flex-direction:column;
  }
  @media print { body{background:#fff;} .page{width:auto; min-height:100vh; margin:0; box-shadow:none; page-break-after:always;} }
  .watermark{
    position:absolute; top:50%; left:50%;
    transform:translate(-50%,-50%) rotate(-22deg);
    font-size:96px; color:rgba(14,124,139,0.055); font-weight:900;
    letter-spacing:6px; pointer-events:none; z-index:0; white-space:nowrap;
  }
  .head{
    display:flex; justify-content:space-between; align-items:flex-start;
    border-bottom:2.5px solid #0E7C8B; padding-bottom:8px; position:relative; z-index:1; gap:12px;
  }
  .brand{ display:flex; align-items:flex-start; gap:12px; flex:1 1 auto; min-width:0; }
  .brand img{ width:72px; height:72px; border-radius:10px; object-fit:cover; flex-shrink:0; }
  .brand .info{ display:flex; flex-direction:column; flex:1 1 auto; min-width:0; }
  .brand h1{ margin:0; color:#0E7C8B; font-size:20px; letter-spacing:.3px; line-height:1.15; }
  .brand .degrees{ color:#1A2E35; font-size:11px; font-weight:600; margin-top:3px; line-height:1.3; }
  .brand p{ margin:2px 0 0; color:#5E7C81; font-size:10.5px; line-height:1.4; }
  .meta{ text-align:right; font-size:10.5px; color:#5E7C81; align-self:flex-start; flex:0 0 auto; padding-top:2px; white-space:nowrap; }
  .meta .line{ margin-bottom:2px; }
  .meta b{ color:#1A2E35; }
  .docTitle{
    text-align:center; margin:10px 0 2px; font-size:13px; font-weight:800;
    color:#0E7C8B; text-transform:uppercase; letter-spacing:1.4px; position:relative; z-index:1;
  }
  .pd{
    background:#F4F9F9; border:1px solid #E2ECEC; border-radius:6px; padding:9px 14px; margin-top:8px;
    display:grid; grid-template-columns: minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1.2fr);
    column-gap:16px; row-gap:4px; position:relative; z-index:1;
  }
  .pd > div{ min-width:0; }
  .pd .k{ font-size:8.5px; color:#5E7C81; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .pd .v{ color:#1A2E35; font-weight:600; font-size:11px; overflow-wrap:anywhere; word-break:break-word; }
  .sec{ margin-top:8px; page-break-inside:avoid; break-inside:avoid; position:relative; z-index:1; }
  .sech{
    background: linear-gradient(90deg, #0E7C8B 0%, #14a0b3 100%); color:#fff;
    padding:4px 9px; border-radius:4px 4px 0 0; font-size:10.5px; font-weight:700; letter-spacing:.5px; text-transform:uppercase;
  }
  .secb{ padding:7px 10px 6px; border:1px solid #DCEAEA; border-top:none; border-radius:0 0 4px 4px; background:#FCFEFE; }
  .para{ font-size:11.5px; color:#1A2E35; white-space:pre-wrap; line-height:1.5; }
  .vitalsRow{ display:flex; flex-wrap:wrap; gap:8px; }
  .vitalChip{ display:flex; align-items:baseline; gap:5px; background:#F4F9F9; border:1px solid #DCEAEA; border-radius:16px; padding:4px 12px; }
  .vk{ font-size:9.5px; color:#5E7C81; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
  .vv{ font-size:12.5px; color:#1A2E35; font-weight:700; }
  .dxRow{ display:flex; flex-wrap:wrap; gap:6px; }
  .dxChip{ background:#0E7C8B14; color:#0A5E6B; border-radius:14px; padding:4px 11px; font-size:11px; font-weight:600; }
  .billRow{ display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; font-size:11px; color:#1A2E35; }
  .payTag{ border-radius:14px; padding:3px 11px; font-size:10px; font-weight:800; letter-spacing:.6px; }
  .billFee b, .billRcpt b{ color:#0A5E6B; }
  .spacer{ flex:1 1 auto; min-height:0; }
  .footwrap{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; padding-top:10px; page-break-inside:avoid; break-inside:avoid; position:relative; z-index:1; }
  .qrBlock{ text-align:center; flex:0 0 auto; }
  .qrBlock svg{ width:60px; height:60px; display:block; }
  .qrCap{ font-size:8px; color:#5E7C81; margin-top:2px; line-height:1.25; }
  .qrCap b{ color:#0E7C8B; }
  .sigBlock{ text-align:center; flex:0 0 auto; }
  .sigImg{ height:60px; max-width:170px; object-fit:contain; margin:0 auto 1px; display:block; }
  .signature{ font-family:'Brush Script MT','Lucida Handwriting','Segoe Script',cursive; font-size:38px; color:#0A5E6B; line-height:1; margin-bottom:1px; }
  .sigLine{ border-top:1px solid #1A2E35; width:150px; margin:1px auto 0; }
  .sigName{ font-weight:700; font-size:11px; color:#1A2E35; margin-top:2px; }
  .sigSub{ color:#5E7C81; font-size:8.5px; line-height:1.3; }
  .foot{
    margin-top:8px; border-top:1px dashed #D1DDDD; padding-top:4px; font-size:8.5px;
    color:#5E7C81; text-align:center; line-height:1.4; position:relative; z-index:1;
  }
  .foot b{ color:#1A2E35; }
  .consulturo-stamp{
    margin-top:4px; display:flex; align-items:center; justify-content:center; gap:6px;
    font-size:8.5px; color:#0A5E6B; font-weight:700; letter-spacing:.4px; text-transform:uppercase;
  }
  .consulturo-stamp .cu-dot{ width:8px; height:8px; border-radius:4px; background:linear-gradient(135deg,#0E7C8B,#15B8C7); }
  .consulturo-stamp .cu-tag{ color:#5E7C81; font-weight:500; text-transform:none; letter-spacing:0; }
  .letterhead{ width:100%; margin:0 0 6px 0; text-align:center; border-bottom:1px solid #DCE3E6; padding-bottom:6px; }
  .letterhead img{ max-width:100%; max-height:36mm; object-fit:contain; display:block; margin:0 auto; }
  .metaStrip{ display:flex; flex-wrap:wrap; justify-content:space-between; gap:6px 12px; font-size:9px; color:#5E7C81; border-bottom:1px solid #ECF1F2; padding:2px 0 4px; margin:0 0 6px; }
  .metaStrip b{ color:#1A2E35; }
</style></head>
<body>
<div class="page">
  <div class="watermark">${escapeHtml(clinicName)}</div>

  ${letterheadEnabled ? `
  <div class="letterhead"><img src="${escapeHtml(letterheadSrc)}" alt="Letterhead"/></div>
  <div class="metaStrip">
    <span><b>Date:</b> ${escapeHtml(visitDisplay)}</span>
    <span><b>Time:</b> ${escapeHtml(timeStr)}</span>
    <span><b>Visit ID:</b> <span style="font-family:monospace;">${escapeHtml(enc.encounter_id)}</span></span>
  </div>` : `
  <div class="head">
    <div class="brand">
      <img src="${LOGO_URL}"/>
      <div class="info">
        <h1>${escapeHtml(doctorName)}</h1>
        <div class="degrees">${escapeHtml(degrees)}</div>
        <p>${escapeHtml(clinicName)} · ${escapeHtml(clinicPhone)}</p>
        <p style="font-size:9.5px;">Reg. No. ${escapeHtml(drReg)}</p>
      </div>
    </div>
    <div class="meta">
      <div class="line"><b>Date:</b> ${escapeHtml(visitDisplay)}</div>
      <div class="line"><b>Time:</b> ${escapeHtml(timeStr)}</div>
      <div class="line"><b>Visit ID:</b> <span style="font-family:monospace;font-size:9.5px;">${escapeHtml(enc.encounter_id)}</span></div>
    </div>
  </div>`}

  <div class="docTitle">Visit Summary</div>

  <div class="pd">
    <div><div class="k">Patient</div><div class="v">${escapeHtml(enc.patient_name) || '—'}</div></div>
    <div><div class="k">Age / Sex</div><div class="v">${escapeHtml(ageSex) || '—'}</div></div>
    <div><div class="k">Phone</div><div class="v">${escapeHtml(enc.patient_phone) || '—'}</div></div>
    <div><div class="k">Seen by</div><div class="v">${escapeHtml(enc.created_by_name) || escapeHtml(doctorName)}</div></div>
  </div>

  ${vitalsBlock}
  ${dxBlock}
  ${soap}
  ${billingBlock}
  ${followBlock}

  <div class="spacer"></div>

  <div class="footwrap">
    ${qrSvg ? `<div class="qrBlock">${qrSvg}<div class="qrCap"><b>Scan to verify</b><br/>Via ConsultUro</div></div>` : `<div class="qrBlock"></div>`}
    <div class="sigBlock">
      ${signatureUrl
        ? `<img class="sigImg" src="${escapeHtml(signatureUrl)}" alt="Signature"/>`
        : `<div class="signature">${escapeHtml(doctorName.replace(/^Dr\.?\s*/i, ''))}</div>`}
      <div class="sigLine"></div>
      <div class="sigName">${escapeHtml(doctorName)}</div>
      <div class="sigSub">Reg. No. ${escapeHtml(drReg)}</div>
    </div>
  </div>

  <div class="foot">
    Visit summary · ${escapeHtml(clinicName)} · ${escapeHtml(clinicAddr)}<br/>
    Generated: <b>${escapeHtml(nowStamp)}</b> · This is a clinical summary, not a prescription.
    <div class="consulturo-stamp">
      <span class="cu-dot"></span>
      <span class="cu-text">ConsultUro</span>
      <span class="cu-tag">· Generated on ConsultUro Platform</span>
    </div>
  </div>
</div>
</body></html>`;
}

/** Convenience: load clinic settings + build the encounter summary HTML. */
export async function buildEncounterSummaryHtml(enc: EncounterDoc, settings?: ClinicSettings): Promise<string> {
  const s = settings || (await loadClinicSettings());
  return buildEncounterHtml(enc, s);
}
