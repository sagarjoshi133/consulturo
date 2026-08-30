// Receipt / Payment-receipt HTML & PDF utilities (Phase 3.8.1).
//
// Visual goals — match the premium prescription PDF aesthetics so
// patients get a coherent brand, but use GREEN instead of
// teal / cyan so a receipt is instantly distinguishable from an Rx.
//
// Sections (top→bottom):
//   1. Header (logo + doctor brand block + clinic/contact lines)
//      OR letterhead banner if the clinic owner has enabled one.
//   2. "PAYMENT RECEIPT" ribbon (green gradient) with receipt number
//      + date on a glance — the visual anchor that says "this is NOT
//      an Rx".
//   3. Patient summary grid (Patient · Reg No · Mobile · Date · Mode)
//   4. Itemised services table (description · type · qty · rate · amount)
//   5. Totals card (subtotal · discount · GST · grand total)
//   6. Big paid confirmation strip with PAID / PARTIAL stamp + mode.
//   7. Notes (when present).
//   8. Footer — QR (verify), "Our Promise" pillar, caduceus +
//      sanskrit blessing, signature block. Identical 4-pillar layout
//      to the Rx for brand consistency.
//   9. Dashed audit footer with timestamp + "ConsultUro" stamp.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform, Alert } from 'react-native';
import QRCode from 'qrcode';
import { LOGO_URL } from './theme';
import { loadClinicSettings, ClinicSettings } from './rx-pdf';
import api from './api';

// ─── Backend PDF bridge ─────────────────────────────────────────
// Sends our premium receipt HTML to /api/render/pdf (WeasyPrint
// server-side) and returns a real PDF blob (web) or a file URI
// (native). This is the SAME endpoint used by the prescription
// share flow, so behaviour is consistent across documents.
async function fetchReceiptPdfFromBackend(
  html: string,
  filename: string,
): Promise<{ blob?: Blob; uri?: string }> {
  const resp = await api.post('/render/pdf', { html, filename }, {
    responseType: Platform.OS === 'web' ? 'blob' : 'arraybuffer',
    timeout: 90_000,
  });
  if (Platform.OS === 'web') {
    return { blob: resp.data as Blob };
  }
  // Native: write bytes to a cache file and return the path
  const ab: ArrayBuffer = resp.data as ArrayBuffer;
  const bytes = new Uint8Array(ab);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  const b64 = (globalThis as any).btoa
    ? (globalThis as any).btoa(bin)
    : Buffer.from(bytes).toString('base64');
  const uri = `${(FileSystem as any).cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: (FileSystem as any).EncodingType?.Base64 || 'base64' });
  return { uri };
}

function safeMsg(e: any, fallback: string): string {
  const apiMsg = e?.response?.data?.detail;
  return apiMsg || e?.message || fallback;
}

function showWebAlert(message: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.alert(message); } catch {}
  } else {
    try { Alert.alert('Notice', message); } catch {}
  }
}

function buildReceiptFilename(r: Receipt, size: ReceiptSize): string {
  const safeName = (r.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return `Receipt-${safeName || 'Patient'}-${r.receipt_no || r.receipt_id}_${size}.pdf`;
}

export type ReceiptItem = {
  description: string;
  service_type?: string | null;
  qty?: number;
  amount?: number;
  line_total?: number;
};

export type Receipt = {
  receipt_id: string;
  receipt_no: string;
  patient_name?: string | null;
  patient_phone?: string | null;
  patient_email?: string | null;
  registration_no?: string | null;
  items?: ReceiptItem[];
  subtotal?: number;
  discount?: number;
  gst_enabled?: boolean;
  gst_pct?: number;
  gst_amount?: number;
  total?: number;
  paid?: number;
  balance?: number;
  mode?: string;
  payment_ref?: string | null;
  notes?: string | null;
  receipt_date?: string;
  created_by_name?: string;
  created_at?: string;
};

// ─────────────────────────── helpers ───────────────────────────
const escapeHtml = (s?: any) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );

const fmt = (n: any) =>
  Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ddmmyyyy = (iso?: string | null) => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

const nowIST = () => {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${mi} IST`;
};

// ─────────────────────────── builder ───────────────────────────
async function buildHtml(r: Receipt, s: ClinicSettings, size: 'A4' | 'A5' = 'A4'): Promise<string> {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || 'https://www.drsagarjoshi.com').replace(/\/$/, '');
  const verifyUrl = `${base}/api/receipts/${r.receipt_id}`;

  // QR — SVG (no Canvas) so it renders on both web and APK WebView.
  let qrSvg = '';
  try {
    qrSvg = await QRCode.toString(verifyUrl, {
      type: 'svg',
      margin: 1,
      width: 160,
      // Amber instead of teal — receipt-distinct.
      color: { dark: '#8B5A1A', light: '#FFFFFF' },
    });
    qrSvg = qrSvg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!DOCTYPE[^>]*>/g, '').trim();
  } catch {
    qrSvg = '';
  }

  const clinicName = (s.clinic_name || 'Sterling Hospitals').trim();
  const clinicAddr = (s.clinic_address || 'Sterling Hospitals, Race Course Road, Vadodara – 390007').trim();
  const clinicPhone = (s.clinic_phone || '+91 81550 75669').trim();
  const degrees = (s.doctor_degrees || 'MBBS · MS · DrNB (Urology)').trim();
  const drReg = (s.doctor_reg_no || 'G-53149').trim();
  const doctorName = (s.doctor_name || 'Dr. Sagar Joshi').trim();
  const doctorTitle = (s.doctor_title || 'Consultant Urologist, Laparoscopic & Transplant Surgeon').trim();
  const signatureUrl = (s.signature_url || '').trim();

  // Footer clinic line — the address field often already begins with the
  // clinic name (e.g. "ConsultUro Clinic, Gotri…"), which made the footer
  // read "ConsultUro Clinic · ConsultUro Clinic, Gotri…". De-dupe: if the
  // address already contains the clinic name, show the address alone.
  const _addrHasName = clinicAddr.toLowerCase().includes(clinicName.toLowerCase());
  const footerClinicLine = _addrHasName ? clinicAddr : `${clinicName} · ${clinicAddr}`;

  const letterheadOn = !!(s.use_letterhead && (s.letterhead_image_b64 || '').trim());
  const letterheadSrc = letterheadOn ? String(s.letterhead_image_b64 || '').trim() : '';

  const items = r.items || [];
  const itemRows = items.map((it, i) => {
    const lineTotal = it.line_total ?? (Number(it.qty ?? 1) * Number(it.amount ?? 0));
    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="medname">${escapeHtml(it.description || '')}</div>
          ${it.service_type ? `<div class="meddose">${escapeHtml(it.service_type)}</div>` : ''}
        </td>
        <td class="qty">${fmt(it.qty ?? 1)}</td>
        <td class="rate">₹ ${fmt(it.amount ?? 0)}</td>
        <td class="amt">₹ ${fmt(lineTotal)}</td>
      </tr>`;
  }).join('');

  const totalNum = Number(r.total ?? 0);
  const paidNum = Number(r.paid ?? totalNum);
  const balNum = Number(r.balance ?? 0);
  const fullyPaid = balNum <= 0;
  const stampText = fullyPaid ? 'PAID IN FULL' : 'PARTIAL PAYMENT';
  const stampColor = fullyPaid ? '#16A34A' : '#15803D';

  const totalsRows = [
    `<tr><td>Subtotal</td><td class="amt">₹ ${fmt(r.subtotal)}</td></tr>`,
    (r.discount || 0) > 0 ? `<tr><td>Discount</td><td class="amt minus">− ₹ ${fmt(r.discount)}</td></tr>` : '',
    r.gst_enabled && (r.gst_amount || 0) > 0
      ? `<tr><td>GST (${fmt(r.gst_pct)}%)</td><td class="amt">₹ ${fmt(r.gst_amount)}</td></tr>`
      : '',
    `<tr class="grand"><td>Grand Total</td><td class="amt">₹ ${fmt(totalNum)}</td></tr>`,
    `<tr><td>Paid via ${escapeHtml(r.mode || 'Cash')}${r.payment_ref ? ` <span class="ref">(${escapeHtml(r.payment_ref)})</span>` : ''}</td><td class="amt paid">₹ ${fmt(paidNum)}</td></tr>`,
    balNum > 0 ? `<tr class="bal"><td>Balance pending</td><td class="amt minus">₹ ${fmt(balNum)}</td></tr>` : '',
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Receipt ${escapeHtml(r.receipt_no)}</title>
<style>
  @page { size: ${size === 'A5' ? 'A5' : 'A4'}; margin: ${size === 'A5' ? '6mm 7mm' : '10mm 11mm'}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f4f6f8; }
  body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    color: #1A2E35;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    ${size === 'A5' ? 'font-size: 9px;' : ''}
  }

  /* On screen, render the receipt as a centered "paper" card so the
     preview is readable. On print, fall back to full-bleed. */
  @media screen {
    body { padding: 12px 0; }
    .page {
      width: ${size === 'A5' ? '148mm' : '210mm'};
      margin: 0 auto;
      background: #fff;
      padding: ${size === 'A5' ? '6mm 7mm' : '10mm 11mm'};
      box-shadow: 0 4px 16px rgba(0,0,0,0.10);
      border-radius: 4px;
    }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .page { padding: 0; box-shadow: none; border-radius: 0; }
  }

  .page {
    width: 100%;
    min-height: ${size === 'A5' ? '195mm' : '277mm'};
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* ── Watermark ────────────────────────────────────────────── */
  .watermark {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-22deg);
    font-size: 110px;
    font-weight: 800;
    color: rgba(217, 119, 6, 0.05);
    letter-spacing: 3px;
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }

  /* ── Header ─────────────────────────────────────────────────
     Same skeleton as the Rx header, but the accent bar across
     the top is AMBER so the eye knows this is a payment doc. */
  .topAccent {
    height: 4px;
    background: linear-gradient(90deg, #15803D 0%, #16A34A 50%, #22C55E 100%);
    border-radius: 2px;
    margin-bottom: 8px;
    position: relative; z-index: 1;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1.5px solid #E2ECEC;
    padding-bottom: 8px;
    position: relative; z-index: 1;
    gap: 12px;
  }
  .brand { display: flex; align-items: flex-start; gap: 12px; flex: 1 1 auto; min-width: 0; }
  .brand img {
    width: 70px; height: 70px; border-radius: 10px;
    object-fit: cover; flex-shrink: 0; align-self: flex-start;
    box-shadow: 0 2px 4px rgba(0,0,0,0.08);
  }
  .brand .info { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  .brand h1 { margin: 0; color: #0E7C8B; font-size: 19px; letter-spacing: .3px; line-height: 1.15; }
  .brand .degrees { color: #1A2E35; font-size: 11px; font-weight: 600; margin-top: 3px; line-height: 1.3; }
  .brand p { margin: 2px 0 0; color: #5E7C81; font-size: 10.5px; line-height: 1.4; }
  .brand .regno { font-size: 9.5px; color: #5E7C81; }

  .meta { text-align: right; font-size: 10.5px; color: #5E7C81; align-self: flex-start; flex: 0 0 auto; padding-top: 2px; white-space: nowrap; }
  .meta .line { margin-bottom: 2px; }
  .meta b { color: #1A2E35; }

  /* ── Receipt ribbon ─────────────────────────────────────── */
  .ribbon {
    background: linear-gradient(95deg, #15803D 0%, #16A34A 100%);
    color: #fff;
    padding: 10px 18px;
    border-radius: 8px;
    margin-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 3px 8px rgba(217,119,6,0.20);
    position: relative; z-index: 1;
  }
  .ribbon .rL .kicker {
    font-size: 9px;
    letter-spacing: 3px;
    font-weight: 700;
    opacity: .85;
    text-transform: uppercase;
  }
  .ribbon .rL .rcno {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 1.5px;
    line-height: 1;
    margin-top: 4px;
    font-family: 'SF Mono', 'Menlo', monospace;
  }
  .ribbon .rR { text-align: right; }
  .ribbon .rR .kicker {
    font-size: 9px;
    letter-spacing: 2px;
    font-weight: 700;
    opacity: .85;
    text-transform: uppercase;
  }
  .ribbon .rR .rdate {
    font-size: 14px;
    font-weight: 700;
    margin-top: 4px;
  }

  /* ── Patient summary ────────────────────────────────────── */
  .pd {
    background: #FFFBEB;
    border: 1px solid #FDE68A;
    border-radius: 6px;
    padding: 8px 12px;
    margin-top: 10px;
    display: grid;
    grid-template-columns: 1.4fr 0.9fr 1fr 1fr 1fr;
    gap: 4px 12px;
    position: relative; z-index: 1;
  }
  .pd .k {
    font-size: 8.5px; color: #14532D; text-transform: uppercase;
    letter-spacing: .5px; margin-bottom: 1px; font-weight: 700;
  }
  .pd .v { color: #1A2E35; font-weight: 600; font-size: 11px; }

  /* ── Section headers (matching Rx style, green accent) ────────────────── */
  .sec { margin-top: 10px; page-break-inside: avoid; break-inside: avoid; position: relative; z-index: 1; }
  .sech {
    background: linear-gradient(90deg, #15803D 0%, #16A34A 100%);
    color: #fff;
    padding: 5px 10px;
    border-radius: 4px 4px 0 0;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: .5px;
    text-transform: uppercase;
  }
  .secb {
    padding: 0;
    border: 1px solid #FDE68A;
    border-top: none;
    border-radius: 0 0 4px 4px;
    background: #FFFFFF;
  }

  /* ── Items table ──────────────────────────────────────── */
  table.items {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    border: none;
  }
  table.items th {
    background: #FFFBEB;
    color: #14532D;
    padding: 6px 8px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .4px;
    border-bottom: 1px solid #FDE68A;
  }
  table.items th.amt, table.items th.qty, table.items th.rate { text-align: right; }
  table.items td {
    padding: 7px 8px;
    border-bottom: 1px solid #FEF3C7;
    vertical-align: top;
    font-size: 10.5px;
  }
  table.items tr:last-child td { border-bottom: none; }
  table.items td.num {
    font-weight: 700; color: #15803D; width: 22px; text-align: center; font-size: 11px;
  }
  table.items td.qty, table.items td.rate, table.items td.amt {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', 'Menlo', monospace;
  }
  table.items .medname { font-weight: 700; color: #1A2E35; font-size: 11.5px; line-height: 1.2; }
  table.items .meddose { color: #14532D; font-size: 9.5px; margin-top: 2px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px; }

  /* ── Totals card (right-aligned, premium) ────────────── */
  .totalsWrap {
    display: flex;
    justify-content: flex-end;
    margin-top: 10px;
    position: relative; z-index: 1;
  }
  .totalsCard {
    width: 64%;
    background: linear-gradient(180deg, #FFFBEB 0%, #FEF3C7 100%);
    border: 1.5px solid #22C55E;
    border-radius: 8px;
    padding: 4px 0;
    box-shadow: 0 2px 6px rgba(217,119,6,0.08);
  }
  table.totals { width: 100%; border-collapse: collapse; }
  table.totals td {
    padding: 4px 14px;
    font-size: 11px;
    color: #1A2E35;
  }
  table.totals td.amt {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', 'Menlo', monospace;
    font-weight: 600;
  }
  table.totals td.minus { color: #DC2626; }
  table.totals tr.grand td {
    padding-top: 8px; padding-bottom: 8px;
    font-size: 14px;
    font-weight: 700;
    color: #14532D;
    border-top: 1.5px solid #15803D;
    background: rgba(255,255,255,0.5);
  }
  table.totals td.paid { color: #15803D; }
  table.totals tr.bal td {
    border-top: 1px dashed #DC2626;
    color: #DC2626;
    font-weight: 700;
  }
  .ref { color: #5E7C81; font-size: 9.5px; font-weight: 500; }

  /* ── PAID badge (inline, right-aligned next to totals) ─────────────── */
  .paidBadgeRow {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 14px;
    position: relative; z-index: 1;
  }
  .paidBadge {
    border: 2.5px solid;
    padding: 6px 14px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 2px;
    border-radius: 6px;
    transform: rotate(-3deg);
    opacity: 0.85;
    font-family: 'Inter', sans-serif;
    box-shadow: 0 2px 4px rgba(0,0,0,0.06);
    background: rgba(255,255,255,0.5);
  }
  .paidBadge .stampSub {
    display: block;
    font-size: 9px;
    letter-spacing: 1.2px;
    margin-top: 2px;
    font-weight: 600;
    opacity: 0.9;
  }

  /* ── Notes ──────────────────────────────────────── */
  .notes {
    margin-top: 12px;
    padding: 8px 12px;
    background: #FFFBEB;
    border-left: 3px solid #15803D;
    border-radius: 0 6px 6px 0;
    font-size: 10.5px;
    color: #1A2E35;
    line-height: 1.5;
    font-style: italic;
    position: relative; z-index: 1;
  }
  .notes b { font-style: normal; color: #14532D; }

  /* ── Spacer to push footer to bottom ────────────── */
  .rcSpacer { flex: 1 1 auto; min-height: 0; }

  /* ── Footer — 4-pillar (QR · promise · blessing · signature) ───── */
  .footwrap {
    margin-top: 12px;
    border-top: 1.5px solid #E2ECEC;
    padding-top: 10px;
    display: grid;
    grid-template-columns: 1fr 1.1fr 1fr 1.2fr;
    gap: 12px;
    align-items: stretch;
    position: relative; z-index: 1;
  }
  .footCell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 4px 0;
  }
  .qrBlock svg { width: 78px; height: 78px; }
  .qrCap {
    margin-top: 3px;
    font-size: 9px;
    color: #5E7C81;
    line-height: 1.3;
  }
  .qrCap b { color: #1A2E35; font-size: 9.5px; }

  .promiseBox {
    border: 1px dashed #15803D;
    border-radius: 6px;
    padding: 6px 8px;
    width: 100%;
  }
  .promiseHead { font-size: 9px; font-weight: 700; color: #14532D; letter-spacing: 1.2px; text-transform: uppercase; }
  .promiseDivider { width: 28px; height: 1.5px; background: #15803D; margin: 4px auto; }
  .promiseValues { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; }
  .promiseValue { font-size: 8.5px; color: #1A2E35; font-weight: 600; }

  .centerMark { font-size: 26px; color: #15803D; line-height: 1; margin-bottom: 2px; }
  .centerSanskrit { font-size: 11px; color: #1A2E35; font-weight: 700; }
  .centerTrans { font-size: 8.5px; color: #5E7C81; font-style: italic; margin-top: 1px; }

  .signature {
    font-family: 'Brush Script MT', 'Lucida Handwriting', 'Segoe Script', cursive;
    font-size: 36px; color: #0A5E6B; line-height: 1; margin-bottom: 1px;
    letter-spacing: .5px;
  }
  .sigImg { height: 56px; max-width: 150px; object-fit: contain; margin: 0 auto 1px; display: block; }
  .sigLine { border-top: 1px solid #1A2E35; width: 120px; margin: 1px auto 0; }
  .sigName { font-weight: 700; font-size: 10px; color: #1A2E35; margin-top: 2px; }
  .sigSub { color: #5E7C81; font-size: 8px; line-height: 1.3; }

  /* ── Audit footer ──────────────────────────────── */
  .foot {
    margin-top: 6px;
    border-top: 1px dashed #D1DDDD;
    padding-top: 4px;
    font-size: 8.5px;
    color: #5E7C81;
    text-align: center;
    line-height: 1.45;
    position: relative; z-index: 1;
  }
  .consulturo-stamp {
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
  .cu-dot {
    width: 8px; height: 8px;
    border-radius: 4px;
    background: linear-gradient(135deg, #15803D, #22C55E);
    box-shadow: 0 0 0 2px rgba(217,119,6,0.18);
  }
  .cu-tag { color: #5E7C81; font-weight: 500; text-transform: none; letter-spacing: 0; }

  /* Letterhead override (when clinic has uploaded a banner) */
  .letterhead {
    width: 100%;
    margin: 0 0 4px 0;
    text-align: center;
    border-bottom: 1px solid #DCE3E6;
    padding-bottom: 6px;
    position: relative; z-index: 1;
  }
  .letterhead img {
    max-width: 100%;
    max-height: ${size === 'A5' ? '24mm' : '36mm'};
    object-fit: contain;
    display: block;
    margin: 0 auto;
  }

  /* ── A5 density overrides ──────────────────────────────────
     Tighten paddings, fonts and the watermark so the whole
     receipt still fits comfortably on one half-sheet. */
  .size-a5 .watermark { font-size: 80px; }
  .size-a5 .brand img { width: 52px; height: 52px; }
  .size-a5 .brand h1 { font-size: 15px; }
  .size-a5 .brand .degrees { font-size: 9px; }
  .size-a5 .brand p { font-size: 8.5px; }
  .size-a5 .brand .regno { font-size: 8px; }
  .size-a5 .meta { font-size: 8.5px; }
  .size-a5 .ribbon { padding: 6px 12px; margin-top: 10px; }
  .size-a5 .ribbon .rL .kicker, .size-a5 .ribbon .rR .kicker { font-size: 7.5px; letter-spacing: 2px; }
  .size-a5 .ribbon .rL .rcno { font-size: 16px; letter-spacing: 1px; }
  .size-a5 .ribbon .rR .rdate { font-size: 11px; }
  .size-a5 .pd { padding: 6px 10px; margin-top: 8px; gap: 3px 10px; }
  .size-a5 .pd .k { font-size: 7px; }
  .size-a5 .pd .v { font-size: 9px; }
  .size-a5 .sec { margin-top: 8px; }
  .size-a5 .sech { padding: 4px 8px; font-size: 9px; }
  .size-a5 table.items th { padding: 4px 6px; font-size: 8px; }
  .size-a5 table.items td { padding: 4px 6px; font-size: 9px; }
  .size-a5 table.items .medname { font-size: 9.5px; }
  .size-a5 table.items .meddose { font-size: 8px; }
  .size-a5 .paidBadge { padding: 4px 10px; font-size: 11px; letter-spacing: 1.5px; }
  .size-a5 .paidBadge .stampSub { font-size: 7.5px; }
  .size-a5 .totalsCard { width: 70%; }
  .size-a5 table.totals td { padding: 3px 10px; font-size: 9px; }
  .size-a5 table.totals tr.grand td { font-size: 12px; padding-top: 5px; padding-bottom: 5px; }
  .size-a5 .notes { padding: 6px 10px; font-size: 9px; margin-top: 8px; }
  .size-a5 .footwrap { gap: 8px; margin-top: 10px; padding-top: 8px; }
  .size-a5 .qrBlock svg { width: 60px; height: 60px; }
  .size-a5 .qrCap { font-size: 8px; }
  .size-a5 .promiseBox { padding: 5px 6px; }
  .size-a5 .promiseHead { font-size: 8px; }
  .size-a5 .promiseValue { font-size: 7.5px; }
  .size-a5 .centerMark { font-size: 22px; }
  .size-a5 .centerSanskrit { font-size: 10px; }
  .size-a5 .centerTrans { font-size: 7.5px; }
  .size-a5 .signature { font-size: 30px; }
  .size-a5 .sigImg { height: 44px; max-width: 130px; }
  .size-a5 .sigName { font-size: 9px; }
  .size-a5 .sigSub { font-size: 7px; }
  .size-a5 .foot { font-size: 7.5px; padding-top: 3px; }
  .size-a5 .consulturo-stamp { font-size: 7.5px; }
</style></head>
<body>
<div class="page size-${size.toLowerCase()}">
  <div class="watermark">RECEIPT</div>
  <div class="topAccent"></div>

  ${letterheadOn ? `
  <div class="letterhead">
    <img src="${escapeHtml(letterheadSrc)}" alt="Letterhead" />
  </div>` : `
  <div class="head">
    <div class="brand">
      <img src="${LOGO_URL}" alt="logo"/>
      <div class="info">
        <h1>${escapeHtml(doctorName)}</h1>
        <div class="degrees">${escapeHtml(degrees)}</div>
        <p>${escapeHtml(doctorTitle)}</p>
        <p>${escapeHtml(clinicName)} · ${escapeHtml(clinicPhone)}</p>
        <p class="regno">Reg. No. ${escapeHtml(drReg)}</p>
      </div>
    </div>
    <div class="meta">
      <div class="line"><b>Receipt:</b> ${escapeHtml(r.receipt_no)}</div>
      <div class="line"><b>Date:</b> ${escapeHtml(ddmmyyyy(r.receipt_date))}</div>
      <div class="line"><b>Mode:</b> ${escapeHtml(r.mode || 'Cash')}</div>
      <div class="line"><b>RC ID:</b> <span style="font-family:'SF Mono',monospace;font-size:9.5px;">${escapeHtml(r.receipt_id)}</span></div>
    </div>
  </div>`}

  <!-- The green ribbon: instant "this is a receipt, not an Rx" cue. -->
  <div class="ribbon">
    <div class="rL">
      <div class="kicker">Payment Receipt</div>
      <div class="rcno">${escapeHtml(r.receipt_no)}</div>
    </div>
    <div class="rR">
      <div class="kicker">Issued on</div>
      <div class="rdate">${escapeHtml(ddmmyyyy(r.receipt_date))}</div>
    </div>
  </div>

  <div class="pd">
    <div><div class="k">Patient</div><div class="v">${escapeHtml(r.patient_name) || '—'}</div></div>
    <div><div class="k">Reg. No.</div><div class="v">${r.registration_no ? escapeHtml(r.registration_no) : '—'}</div></div>
    <div><div class="k">Mobile</div><div class="v">${escapeHtml(r.patient_phone) || '—'}</div></div>
    <div><div class="k">Paid by</div><div class="v">${escapeHtml(r.mode || 'Cash')}</div></div>
    <div><div class="k">${r.payment_ref ? 'Reference' : 'Receipt no.'}</div><div class="v">${r.payment_ref ? escapeHtml(r.payment_ref) : escapeHtml(r.receipt_no)}</div></div>
  </div>

  <div class="sec">
    <div class="sech">Services Rendered</div>
    <div class="secb">
      <table class="items">
        <thead>
          <tr>
            <th style="width:24px">#</th>
            <th>Description</th>
            <th class="qty" style="width:60px">Qty</th>
            <th class="rate" style="width:90px">Rate</th>
            <th class="amt" style="width:100px">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#999;padding:14px">No items</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- PAID badge inline above the totals card -->
  <div class="paidBadgeRow">
    <div class="paidBadge" style="color:${stampColor};border-color:${stampColor};">${escape(stampText)}<span class="stampSub">${escape((r.mode || 'CASH').toUpperCase())}</span></div>
  </div>

  <div class="totalsWrap">
    <div class="totalsCard">
      <table class="totals">${totalsRows}</table>
    </div>
  </div>

  ${r.notes ? `
  <div class="notes">
    <b>Note:</b> ${escapeHtml(r.notes)}
  </div>` : ''}

  <div class="rcSpacer"></div>

  <!-- 4-pillar footer matching the Rx so brand stays coherent -->
  <div class="footwrap">
    <div class="footCell qrBlock">
      ${qrSvg || ''}
      <div class="qrCap"><b>Scan to verify</b><br/>Via ConsultUro</div>
    </div>

    <div class="footCell">
      <div class="promiseBox">
        <div class="promiseHead">Thank You</div>
        <div class="promiseDivider"></div>
        <div class="promiseValues">
          <div class="promiseValue">Compassion</div>
          <div class="promiseValue">Precision</div>
          <div class="promiseValue">Outcomes</div>
        </div>
      </div>
    </div>

    <div class="footCell">
      <div class="centerMark">&#x2695;</div>
      <div class="centerSanskrit">सर्वे सन्तु निरामयाः</div>
      <div class="centerTrans">May all be free from disease</div>
    </div>

    <div class="footCell">
      ${signatureUrl
        ? `<img class="sigImg" src="${escapeHtml(signatureUrl)}" alt="Signature"/>`
        : `<div class="signature">${escapeHtml(doctorName.replace(/^Dr\.?\s*/i, ''))}</div>`}
      <div class="sigLine"></div>
      <div class="sigName">${escapeHtml(doctorName)}</div>
      <div class="sigSub">Reg. No. ${escapeHtml(drReg)}</div>
    </div>
  </div>

  <div class="foot">
    Computer-generated receipt · ${escapeHtml(footerClinicLine)}<br/>
    Issued: <b>${escapeHtml(nowIST())}</b> · This is the only valid record of payment. Retain for your records.
    <div class="consulturo-stamp">
      <span class="cu-dot"></span>
      <span>ConsultUro</span>
      <span class="cu-tag">· Generated on ConsultUro Platform</span>
    </div>
  </div>
</div>
</body></html>`;
}

// Helper for in-line CSS string interpolation safety
function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// ────────────────────────── public api ─────────────────────────
export type ReceiptSize = 'A4' | 'A5';

export async function safeBuildHtml(r: Receipt, size: ReceiptSize = 'A4'): Promise<string> {
  try {
    const s = await loadClinicSettings();
    return await buildHtml(r, s, size);
  } catch {
    return await buildHtml(r, {} as ClinicSettings, size);
  }
}

export async function printReceipt(r: Receipt, size: ReceiptSize = 'A4') {
  const html = await safeBuildHtml(r, size);
  if (Platform.OS === 'web') {
    // expo-print's web fallback prints the *current* page (the React
    // Native rendered DOM) instead of our HTML — so we drive it
    // manually via an iframe.
    await webPrintHtml(html);
    return;
  }
  // ── Native (iOS / Android) ────────────────────────────────────
  // Two-step flow: render the HTML to a PDF FILE first, then hand
  // that file URI to Print.printAsync. Passing html directly to
  // Print.printAsync has, in some Android OEM builds, been observed
  // to fall back to printing the current activity (the React Native
  // screen) — see user-reported regression on RC260531017. The
  // file-URI route is rock-solid because Android Print Framework
  // already knows how to render PDFs.
  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    await Print.printAsync({ uri });
    return;
  } catch (err) {
    // Fall through to the html-direct call as a last resort. If
    // even that fails, surface the error.
    await Print.printAsync({ html });
  }
}

export async function shareReceiptPdf(r: Receipt, size: ReceiptSize = 'A4') {
  const filename = buildReceiptFilename(r, size);
  try {
    const html = await safeBuildHtml(r, size);

    if (Platform.OS === 'web') {
      // Web SHARE = real PDF blob + Web Share API (with download fallback).
      // Spec (mirrors the Rx share flow):
      //   1. Backend WeasyPrint → real PDF blob.
      //   2. If browser supports navigator.canShare({ files }) (Chrome
      //      on Android, Safari on iOS) → open the OS share sheet
      //      with the PDF attached.
      //   3. Else → save the PDF to Downloads + brief instruction so
      //      the doctor knows where to find it.
      let blob: Blob | undefined;
      try {
        const r2 = await fetchReceiptPdfFromBackend(html, filename);
        blob = r2.blob;
      } catch (e: any) {
        showWebAlert(safeMsg(e, 'Could not generate PDF for sharing. Please retry.'));
        return;
      }
      if (!blob || blob.size === 0) {
        showWebAlert('PDF service returned an empty file. Please retry.');
        return;
      }

      // Try Web Share API first
      try {
        const FileCtor: any = (typeof File !== 'undefined') ? File : null;
        if (FileCtor && (navigator as any)?.canShare) {
          const file = new FileCtor([blob], filename, { type: 'application/pdf' });
          if ((navigator as any).canShare({ files: [file] })) {
            await (navigator as any).share({
              files: [file],
              title: filename,
              text: `Receipt ${r.receipt_no}`,
            });
            return;
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return; // user dismissed
        // Other errors → fall through to download fallback
      }

      // Fallback: download + alert
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
        showWebAlert(safeMsg(e, 'Could not share receipt'));
      }
      return;
    }

    // ── Native (iOS / Android) ───────────────────────────────────
    // Native SHARE = generate PDF via expo-print → open OS share sheet.
    // expo-print's printToFileAsync on native produces the same PDF
    // as our HTML template (no Activity-fallback bug), so we use it
    // here instead of the backend bridge for speed.
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (!uri) throw new Error('No PDF file generated');

    let target = uri;
    try {
      const dir = (FileSystem as any).cacheDirectory || '';
      const renamed = `${dir}${filename}`;
      await FileSystem.moveAsync({ from: uri, to: renamed });
      target = renamed;
    } catch {
      // rename failed → keep original temp path
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target, {
        mimeType: 'application/pdf',
        dialogTitle: `Share Receipt ${r.receipt_no}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Sharing unavailable', `File saved at: ${target}`);
    }
  } catch (e: any) {
    const msg = safeMsg(e, 'Could not share receipt');
    if (Platform.OS === 'web') showWebAlert(msg);
    else Alert.alert('Share failed', msg);
  }
}

export async function downloadReceiptPdf(r: Receipt, size: ReceiptSize = 'A4') {
  const filename = buildReceiptFilename(r, size);
  try {
    const html = await safeBuildHtml(r, size);

    if (Platform.OS === 'web') {
      // Web DOWNLOAD = real PDF blob → trigger <a download>.
      let blob: Blob | undefined;
      try {
        const r2 = await fetchReceiptPdfFromBackend(html, filename);
        blob = r2.blob;
      } catch (e: any) {
        showWebAlert(safeMsg(e, 'Could not generate PDF. Please retry.'));
        return;
      }
      if (!blob || blob.size === 0) {
        showWebAlert('PDF service returned an empty file. Please retry.');
        return;
      }
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
      } catch (e: any) {
        showWebAlert(safeMsg(e, 'Could not download receipt'));
      }
      return;
    }

    // ── Native ───────────────────────────────────────────────────
    // For DOWNLOAD on native we behave the same as SHARE — generate
    // the PDF then hand it to the OS share-sheet (which lets the
    // user save it to Downloads / Drive / WhatsApp / etc.). Native
    // platforms don't have a dedicated "Downloads folder" concept
    // that we can write to without storage permissions.
    return shareReceiptPdf(r, size);
  } catch (e: any) {
    const msg = safeMsg(e, 'Could not download receipt');
    if (Platform.OS === 'web') showWebAlert(msg);
    else Alert.alert('Download failed', msg);
  }
}

// ─────────────────── web-specific helpers ───────────────────
// Render the receipt HTML in a hidden iframe and trigger its print
// dialog. This way the browser prints OUR HTML — not the React
// Native screen.
async function webPrintHtml(html: string): Promise<void> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  return new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const cleanup = () => {
      try { document.body.removeChild(iframe); } catch {}
      resolve();
    };

    const triggerPrint = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) { cleanup(); return; }
        win.focus();
        // Some browsers fire onafterprint synchronously; others not.
        // Schedule a fallback cleanup either way.
        (win as any).onafterprint = cleanup;
        win.print();
        setTimeout(cleanup, 5000);
      } catch {
        cleanup();
      }
    };

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { cleanup(); return; }
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for assets (logo, QR svg) to lay out before printing.
    if (iframe.contentWindow) {
      iframe.contentWindow.addEventListener('load', () => setTimeout(triggerPrint, 350));
    }
    setTimeout(triggerPrint, 800);
  });
}

// Open a new tab/window with the receipt HTML and auto-trigger the
// browser's print dialog so the user can "Save as PDF". Replaces
// the old behaviour that just dumped about:blank with HTML and
// required the user to manually hunt for the print menu.
function webOpenForPrint(html: string, r: Receipt) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const wrappedHtml = html.replace(
    '</head>',
    `<title>Receipt ${escapeHtml(r.receipt_no || r.receipt_id)}</title>
    <script>
      // Auto-trigger print once the layout is ready. The user can
      // then choose "Save as PDF" to get a real PDF download or
      // route the receipt to a physical printer.
      window.addEventListener('load', function() {
        setTimeout(function() {
          try { window.focus(); window.print(); } catch(e) {}
        }, 400);
      });
    </script>
    </head>`
  );
  const win = window.open('', '_blank');
  if (!win) {
    // Pop-up blocked → fall back to in-place print iframe
    webPrintHtml(html).catch(() => {});
    return;
  }
  win.document.open();
  win.document.write(wrappedHtml);
  win.document.close();
}
