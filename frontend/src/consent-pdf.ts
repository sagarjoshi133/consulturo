// Premium Surgical-Consent HTML / PDF utilities.
//
// Visual goals (June 2026 redesign per Dr Sagar Joshi's brief):
//   • Premium A4 layout — proper margins, header/footer on every page.
//   • Trilingual — section headings rendered in EN · हिंदी · ગુજરાતી
//     and primary-language body. Devanagari + Gujarati fonts loaded
//     via WeasyPrint-friendly CSS @font-family stack.
//   • Minimal branding — ConsultUro mark on the left of the header,
//     clinic + doctor brand block on the right, thin teal accent
//     underneath. Footer carries the audit triplet (Consent ID ·
//     Doctor · Generated at) in muted text.
//   • Blank-signature ready — three signature blocks with clean
//     baseline-rules so the patient / witness / doctor can sign on
//     paper after printing. When a signed PNG dataURL is provided
//     it is embedded above the line; otherwise the line stays blank.
//
// This file is intentionally framework-light: it only builds an
// HTML string + thin wrappers around print/share. The actual PDF
// rendering happens server-side via /api/render/pdf (WeasyPrint)
// so the on-paper output matches the on-screen one across web,
// iOS and Android.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform, Alert } from 'react-native';
import { LOGO_URL } from './theme';
import { loadClinicSettings, ClinicSettings } from './rx-pdf';
import api from './api';

export type Lang = 'en' | 'hi' | 'gu';

export type ConsentDoc = {
  consent_id: string;
  procedure_key: string;
  // Phase 6.2 — multi-procedure consents. When present, the PDF
  // renders each procedure as its own section under one combined
  // title; falls back to `procedure_snapshot` for legacy docs.
  procedure_keys?: string[];
  procedure_snapshot?: any;
  procedure_snapshots?: any[];
  language: Lang;
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  patient_age?: number | string;
  patient_sex?: string;
  registration_no?: string;
  booking_id?: string;
  patient_signature_b64?: string | null;
  witness_name?: string | null;
  witness_signature_b64?: string | null;
  doctor_signature_b64?: string | null;
  created_at?: string;
};

// ─── Trilingual copy ─────────────────────────────────────────────
// The body of the consent is rendered in the patient's chosen
// language. Section HEADINGS, however, always carry their EN / HI /
// GU label triplet so the document remains legible to any reviewer
// (relatives, hospital admins, courts) regardless of their fluency.

const COMMON_RISKS: Record<Lang, string[]> = {
  en: [
    'Risks related to anaesthesia (allergic reactions, breathing difficulty, rare cardiac events).',
    'Bleeding requiring blood transfusion (rare in most procedures, more likely in major surgery).',
    'Infection at surgical / catheter / wound site requiring antibiotics or further treatment.',
    'Deep vein thrombosis (DVT) and pulmonary embolism — preventable with early ambulation and stockings.',
    'Prolonged hospital stay or readmission if recovery is slower than expected.',
    'Need for additional procedures or open conversion if minimally-invasive approach fails.',
    'Allergic reaction to medications, dressings, antiseptics or contrast (if used).',
  ],
  hi: [
    'एनेस्थीसिया से संबंधित जोखिम (एलर्जी, सांस लेने में कठिनाई, दुर्लभ हृदय घटनाएं)।',
    'रक्तस्राव जिसके लिए Blood transfusion की आवश्यकता पड़ सकती है (अधिकांश प्रक्रियाओं में दुर्लभ, बड़ी सर्जरी में अधिक संभावित)।',
    'सर्जिकल/कैथेटर/घाव स्थल पर संक्रमण; एंटीबायोटिक या आगे के उपचार की आवश्यकता।',
    'डीप वेन थ्रोम्बोसिस (DVT) और पल्मोनरी एम्बोलिज़्म — जल्दी चलने और मोजों से इसे रोका जा सकता है।',
    'अपेक्षा से धीमी रिकवरी होने पर लंबा अस्पताल प्रवास या पुनः भर्ती।',
    'न्यूनतम-आक्रामक दृष्टिकोण विफल होने पर अतिरिक्त प्रक्रिया/ओपन रूपांतरण आवश्यक।',
    'दवाओं, ड्रेसिंग, एंटीसेप्टिक या कंट्रास्ट (यदि उपयोग) से एलर्जी।',
  ],
  gu: [
    'એનેસ્થેસિયા સંબંધિત જોખમો (એલર્જી, શ્વાસ લેવામાં મુશ્કેલી, દુર્લભ હૃદય ઘટનાઓ).',
    'રક્તસ્રાવ જેના માટે Blood transfusion ની જરૂર પડી શકે છે (મોટાભાગની પ્રક્રિયાઓમાં દુર્લભ, મોટી સર્જરીમાં વધુ સંભવ).',
    'સર્જિકલ/કેથેટર/ઘા સ્થળે ચેપ; એન્ટિબાયોટિક અથવા આગળની સારવાર જરૂરી.',
    'ડીપ વેન થ્રોમ્બોસિસ (DVT) અને પલ્મોનરી એમ્બોલિઝમ — વહેલા ચાલવાથી અને મોજાંથી અટકાવી શકાય.',
    'અપેક્ષા કરતાં ધીમી રિકવરી હોય તો લાંબું હોસ્પિટલ રોકાણ અથવા પુનઃ દાખલ.',
    'ન્યૂનતમ-આક્રમક અભિગમ નિષ્ફળ જાય તો વધારાની પ્રક્રિયા/ઓપન રૂપાંતરની જરૂર.',
    'દવાઓ, ડ્રેસિંગ, એન્ટિસેપ્ટિક અથવા કોન્ટ્રાસ્ટ (વપરાય તો)થી એલર્જી.',
  ],
};

const DECLARATION: Record<Lang, string> = {
  en: 'I have read and understood the above information about the procedure, its benefits, alternatives, and possible risks. All my questions have been answered to my satisfaction. I voluntarily consent to undergo the above procedure under the care of the operating team and authorise additional procedures that may be deemed necessary during the operation in my best interest.',
  hi: 'मैंने ऊपर दी गई प्रक्रिया, उसके लाभ, विकल्प एवं संभावित जोखिमों की जानकारी पढ़ी और समझी है। मेरे सभी प्रश्नों के संतोषजनक उत्तर दिए गए हैं। मैं अपनी स्वेच्छा से ऑपरेटिंग टीम की देखरेख में उक्त प्रक्रिया हेतु सहमति देता/देती हूँ तथा ऑपरेशन के दौरान मेरे हित में आवश्यक समझी जाने वाली अतिरिक्त प्रक्रियाओं हेतु भी अनुमति देता/देती हूँ।',
  gu: 'મેં ઉપર આપેલી પ્રક્રિયા, તેના લાભો, વિકલ્પો અને સંભવિત જોખમો વિશેની માહિતી વાંચી અને સમજી છે. મારા તમામ પ્રશ્નોના સંતોષકારક જવાબ આપવામાં આવ્યા છે. હું મારી સ્વેચ્છાથી ઓપરેટિંગ ટીમની દેખરેખ હેઠળ ઉપરની પ્રક્રિયા માટે સંમતિ આપું છું તથા ઓપરેશન દરમિયાન મારા હિતમાં જરૂરી માનેલી વધારાની પ્રક્રિયાઓ માટે પણ મંજૂરી આપું છું.',
};

// Trilingual triplet for section headings: [EN, HI, GU]
const SECTIONS = {
  procedure: ['Procedure', 'प्रक्रिया', 'પ્રક્રિયા'],
  commonRisks: ['Common surgical risks', 'सामान्य सर्जिकल जोखिम', 'સામાન્ય સર્જિકલ જોખમો'],
  specRisks: ['Procedure-specific risks', 'प्रक्रिया-विशिष्ट जोखिम', 'પ્રક્રિયા-વિશિષ્ટ જોખમો'],
  alts: ['Alternatives', 'विकल्प', 'વિકલ્પો'],
  decl: ['Declaration of Consent', 'सहमति घोषणा', 'સંમતિ ઘોષણા'],
  patient: ['Patient', 'रोगी', 'દર્દી'],
  date: ['Date', 'दिनांक', 'તારીખ'],
  regNo: ['Reg. No.', 'पंजी क्रं', 'નોંધણી નં.'],
  age: ['Age / Sex', 'आयु / लिंग', 'ઉંમર / લિંગ'],
  phone: ['Phone', 'फ़ोन', 'ફોન'],
  sigPatient: ['Patient', 'रोगी', 'દર્દી'],
  sigWitness: ['Witness', 'गवाह', 'સાક્ષી'],
  sigDoctor: ['Doctor', 'डॉक्टर', 'ડોક્ટર'],
  sigDate: ['Date & Time', 'दिनांक एवं समय', 'તારીખ અને સમય'],
  consentTitle: ['Surgical Informed Consent', 'सर्जिकल सूचित सहमति', 'સર્જિકલ માહિતગાર સંમતિ'],
};

const NOT_PROVIDED: Record<Lang, string> = {
  en: 'Not provided',
  hi: 'प्रदान नहीं किया',
  gu: 'આપેલ નથી',
};

const PRIMARY = '#E11D48';
const PRIMARY_DARK = '#9F1239';

function escapeHtml(s?: string | number | null): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function formatLocalStamp(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    // 31 May 2026, 7:23 AM
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${date} · ${time}`;
  } catch {
    return iso;
  }
}

/** Trilingual section heading — primary lang in bold, the other two
 *  shown as a muted subtitle (always in EN · HI · GU order). */
function sectionHeading(triplet: string[], lang: Lang): string {
  const order: Lang[] = ['en', 'hi', 'gu'];
  const primaryIdx = order.indexOf(lang);
  const others = triplet
    .map((t, i) => ({ t, i }))
    .filter((x) => x.i !== primaryIdx)
    .map((x) => x.t);
  return `
    <div class="sec-h">
      <span class="sec-bar"></span>
      <span class="sec-h-primary">${escapeHtml(triplet[primaryIdx])}</span>
      <span class="sec-h-others">${escapeHtml(others.join('  ·  '))}</span>
    </div>`;
}

/** Single signature box — embeds the b64 image when present, else
 *  leaves the baseline-rule blank for manual pen-and-paper signing. */
function sigBlock(opts: {
  imgB64?: string | null;
  roleTriplet: string[];
  lang: Lang;
  name: string;
}): string {
  const order: Lang[] = ['en', 'hi', 'gu'];
  const primary = opts.roleTriplet[order.indexOf(opts.lang)];
  const others = opts.roleTriplet
    .map((t, i) => ({ t, i }))
    .filter((x) => x.i !== order.indexOf(opts.lang))
    .map((x) => x.t)
    .join(' · ');
  return `
    <div class="sig-cell">
      <div class="sig-box">
        ${opts.imgB64
          ? `<img class="sig-img" src="${opts.imgB64}" alt="signature"/>`
          : `<div class="sig-box-hint">Sign here</div>`}
      </div>
      <div class="sig-role">${escapeHtml(primary)} <span class="sig-role-sub">· ${escapeHtml(others)}</span></div>
      <div class="sig-name">${escapeHtml(opts.name || '—')}</div>
      <div class="sig-meta-row">
        <span class="lbl">Date</span>
        <span class="sig-date-rule"></span>
      </div>
    </div>`;
}

/** Trilingual 3-column paragraph block — same content rendered in
 *  EN / HI / GU side-by-side. Each cell carries the appropriate
 *  language class so we can tweak per-script colour/spacing. */
function triParagraph(en: string, hi: string, gu: string, opts?: { wrapper?: 'declaration' | null }): string {
  const inner = `
    <table class="tri"><colgroup>
      <col style="width:33.33%"/>
      <col style="width:33.33%"/>
      <col style="width:33.33%"/>
    </colgroup><tbody><tr>
      <td class="tri-col tri-en">${escapeHtml(en).replace(/\n/g, '<br/>') || '<span class="muted">—</span>'}</td>
      <td class="tri-col tri-hi">${escapeHtml(hi).replace(/\n/g, '<br/>') || '<span class="muted">—</span>'}</td>
      <td class="tri-col tri-gu">${escapeHtml(gu).replace(/\n/g, '<br/>') || '<span class="muted">—</span>'}</td>
    </tr></tbody></table>`;
  if (opts?.wrapper === 'declaration') {
    return `<div class="declaration-wrap">${inner}</div>`;
  }
  return inner;
}

/** Trilingual risk-list table — every row carries the same risk in
 *  EN / HI / GU so a multilingual reader can compare line-by-line. */
function triRiskTable(items: { en: string; hi: string; gu: string }[]): string {
  if (!items.length) {
    return `<div class="muted" style="margin-top:4pt;font-size:8.5pt">—</div>`;
  }
  const rows = items
    .map(
      (it, i) => `
    <tr>
      <td class="rn">${i + 1}</td>
      <td class="tri-en">${escapeHtml(it.en) || '—'}</td>
      <td class="tri-hi">${escapeHtml(it.hi) || '—'}</td>
      <td class="tri-gu">${escapeHtml(it.gu) || '—'}</td>
    </tr>`,
    )
    .join('');
  return `
    <table class="tri-risks">
      <colgroup>
        <col class="rn-col"/>
        <col class="lang-col"/>
        <col class="lang-col"/>
        <col class="lang-col"/>
      </colgroup>
      <thead><tr>
        <th class="rn">#</th>
        <th>English</th>
        <th>हिंदी</th>
        <th>ગુજરાતી</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function buildConsentHtml(c: ConsentDoc, settings: ClinicSettings = {}): string {
  const lang: Lang = (c.language || 'en') as Lang;
  // Phase 6.2 — multi-procedure consents. `procedure_snapshots` is
  // preferred when present; otherwise we wrap the legacy single
  // `procedure_snapshot` in a one-element array so the rest of the
  // builder is uniform.
  const allSnapshots: any[] = (
    Array.isArray(c.procedure_snapshots) && c.procedure_snapshots.length > 0
      ? c.procedure_snapshots
      : (c.procedure_snapshot ? [c.procedure_snapshot] : [])
  );
  const proc = allSnapshots[0] || {};
  const isMulti = allSnapshots.length > 1;
  const combinedName = allSnapshots.length > 0
    ? allSnapshots.map((s) => s?.name?.[lang] || s?.name?.en).filter(Boolean).join(' + ')
    : (c.procedure_key || '—');
  const procName: string = combinedName || '—';
  // Show the EN procedure name as a subtitle when the patient's lang
  // is not EN — keeps the doc reviewable by non-native readers.
  const combinedNameEn = allSnapshots.length > 0
    ? allSnapshots.map((s) => s?.name?.en).filter(Boolean).join(' + ')
    : '';
  const procNameAlt = lang !== 'en' ? combinedNameEn : '';

  // ── Trilingual content arrays (EN / HI / GU) ────────────────────
  // The procedure_snapshot already carries all 3 languages because
  // the wizard snapshots the full template at sign-time.
  const procDescTri = {
    en: proc?.procedure?.en || '',
    hi: proc?.procedure?.hi || '',
    gu: proc?.procedure?.gu || '',
  };
  const procAltsTri = {
    en: proc?.alternatives?.en || '',
    hi: proc?.alternatives?.hi || '',
    gu: proc?.alternatives?.gu || '',
  };
  const specRisksTri: { en: string; hi: string; gu: string }[] = (proc?.specific_risks || []).map(
    (r: any) => ({
      en: r?.en || '',
      hi: r?.hi || r?.en || '',
      gu: r?.gu || r?.en || '',
    }),
  );
  const commonRisksTri: { en: string; hi: string; gu: string }[] = COMMON_RISKS.en.map((en, i) => ({
    en,
    hi: COMMON_RISKS.hi[i] || '',
    gu: COMMON_RISKS.gu[i] || '',
  }));
  const anaesthesia = (proc?.anesthesia || proc?.anaesthesia || '').toString().trim();

  const clinicName = (settings.clinic_name || 'Sterling Hospitals').trim();
  const clinicAddr = (settings.clinic_address || 'Race Course Road, Vadodara – 390007').trim();
  const clinicPhone = (settings.clinic_phone || '+91 81550 75669').trim();
  const docName = ((settings as any)?.doctor_name || 'Dr Sagar Joshi').toString().trim();
  const degrees = (settings.doctor_degrees || 'MBBS · MS · DrNB (Urology)').trim();
  const drReg = (settings.doctor_reg_no || 'G-53149').trim();
  const logoSrc = LOGO_URL;

  const titleTriplet = SECTIONS.consentTitle;
  const titlePrimary = titleTriplet[(['en', 'hi', 'gu'] as Lang[]).indexOf(lang)];
  const otherTitles = titleTriplet
    .map((t, i) => ({ t, i }))
    .filter((x) => x.i !== (['en', 'hi', 'gu'] as Lang[]).indexOf(lang))
    .map((x) => x.t)
    .join('  ·  ');

  const stamp = formatLocalStamp(c.created_at);
  const ageSex = [c.patient_age || '', c.patient_sex || ''].filter((x) => String(x).trim()).join(' / ');
  const regNo = c.registration_no || '—';

  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"/>
<title>Surgical Consent · ${escapeHtml(c.consent_id)}</title>
<style>
  /* ── A4 page + running header/footer ─────────────────────────────── */
  @page {
    size: A4;
    margin: 22mm 12mm 18mm 12mm;
    @top-center {
      content: element(pageHeader);
      vertical-align: bottom;
    }
    @bottom-center {
      content: element(pageFooter);
      vertical-align: top;
    }
  }

  /* Fallback for engines (WeasyPrint supports "position: running";
     for browser print we re-render header at top of .page). */
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial,
                 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Gujarati',
                 'Mangal', 'Shruti', sans-serif;
    color: #1A2E35;
    font-size: 9.5pt;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Running header ───────────────────────────────────────────────── */
  .page-header {
    position: running(pageHeader);
    width: 100%;
  }
  .header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 4pt;
    border-bottom: 1.2pt solid ${PRIMARY};
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7pt;
  }
  .brand-logo {
    width: 26pt;
    height: 26pt;
    object-fit: cover;
    border-radius: 5pt;
    border: 0.8pt solid #DDEAEE;
  }
  .brand-text { line-height: 1.15; }
  .brand-name {
    font-size: 11pt;
    font-weight: 700;
    color: ${PRIMARY_DARK};
    letter-spacing: 0.2pt;
  }
  .brand-tag {
    font-size: 7pt;
    color: #5E7C81;
    text-transform: uppercase;
    letter-spacing: 1pt;
  }
  .clinic-block { text-align: right; line-height: 1.2; }
  .clinic-doc {
    font-size: 9.5pt;
    font-weight: 700;
    color: ${PRIMARY_DARK};
  }
  .clinic-deg {
    font-size: 7pt;
    color: #5E7C81;
  }
  .clinic-name {
    font-size: 7.5pt;
    color: #1A2E35;
    margin-top: 1pt;
  }
  .clinic-addr {
    font-size: 6.5pt;
    color: #6A8388;
  }

  /* ── Running footer ───────────────────────────────────────────────── */
  .page-footer {
    position: running(pageFooter);
    width: 100%;
    border-top: 0.8pt solid ${PRIMARY}88;
    padding-top: 5pt;
    font-size: 7.5pt;
    color: #5E7C81;
  }
  .footer-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .footer-table td {
    vertical-align: middle;
    padding: 0;
  }
  .footer-left-cell {
    text-align: left;
    width: 60%;
    padding-right: 10pt;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .footer-right-cell {
    text-align: right;
    width: 40%;
    padding-left: 10pt;
    white-space: nowrap;
  }
  .footer-logo {
    width: 11pt;
    height: 11pt;
    vertical-align: -2pt;
    margin-right: 4pt;
    border-radius: 2pt;
    border: 0.4pt solid #E2ECEC;
  }
  .footer-mark {
    color: ${PRIMARY_DARK};
    font-weight: 800;
    letter-spacing: 0.6pt;
    font-size: 8pt;
    margin-right: 4pt;
  }
  .footer-divider {
    display: inline-block;
    width: 0.6pt;
    height: 8pt;
    background: #C9D8DC;
    vertical-align: middle;
    margin: 0 5pt;
  }
  .footer-meta { font-size: 7.5pt; color: #5E7C81; }
  .pageno::before { content: "Page " counter(page) " / " counter(pages); }

  /* ── Browser-print fallback (Chrome / Safari don't honour
       position: running) — duplicate header/footer inline. ─────────── */
  @media print {
    .page-header-inline,
    .page-footer-inline { display: block; }
  }
  .page-header-inline { margin-bottom: 10pt; }
  .page-footer-inline {
    margin-top: 18pt;
    border-top: 0.8pt solid ${PRIMARY}88;
    padding-top: 6pt;
    font-size: 7.5pt;
    color: #5E7C81;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .page-footer-inline .footer-left { display: flex; gap: 6pt; align-items: center; }
  .page-footer-inline .footer-logo {
    width: 12pt;
    height: 12pt;
    object-fit: cover;
    border-radius: 2pt;
    border: 0.4pt solid #E2ECEC;
  }
  .page-footer-inline .footer-mark {
    color: ${PRIMARY_DARK};
    font-weight: 800;
    letter-spacing: 0.6pt;
    font-size: 8pt;
  }
  .page-footer-inline .footer-divider {
    width: 0.6pt;
    height: 10pt;
    background: #C9D8DC;
  }

  /* ── Doc title strip ──────────────────────────────────────────────── */
  .doc-title-wrap {
    margin-top: 2pt;
    margin-bottom: 8pt;
    text-align: center;
  }
  .doc-eyebrow {
    display: inline-block;
    background: ${PRIMARY}14;
    color: ${PRIMARY_DARK};
    border: 0.5pt solid ${PRIMARY}55;
    padding: 1.5pt 9pt;
    border-radius: 9pt;
    font-size: 7pt;
    font-weight: 600;
    letter-spacing: 0.6pt;
    text-transform: uppercase;
  }
  .doc-eyebrow-sub {
    color: #6A8388;
    font-weight: 500;
    margin-left: 5pt;
    text-transform: none;
    letter-spacing: 0;
  }
  .doc-title {
    margin: 5pt auto 1pt auto;
    font-size: 15pt;
    font-weight: 700;
    color: ${PRIMARY_DARK};
    letter-spacing: -0.2pt;
    line-height: 1.18;
    text-align: center;
  }
  .doc-title-alt {
    font-size: 8.5pt;
    color: #6A8388;
    font-style: italic;
    text-align: center;
  }

  /* ── Patient summary strip ───────────────────────────────────────── */
  .pat-strip {
    width: 100%;
    border-collapse: collapse;
    margin-top: 2pt;
    margin-bottom: 9pt;
    background: #F4F9FA;
    border: 0.5pt solid #D7E6E9;
    border-radius: 3pt;
    overflow: hidden;
  }
  .pat-strip td {
    padding: 4pt 7pt;
    vertical-align: middle;
    border-right: 0.5pt solid #DCE9EC;
    width: 20%;
    text-align: left;
  }
  .pat-strip td:last-child { border-right: 0; }
  .pat-strip .lbl {
    display: block;
    font-size: 6.5pt;
    color: #6A8388;
    text-transform: uppercase;
    letter-spacing: 0.7pt;
    margin-bottom: 1pt;
    text-align: left;
  }
  .pat-strip .val {
    display: block;
    font-size: 9pt;
    color: #1A2E35;
    font-weight: 600;
    text-align: left;
    line-height: 1.2;
  }

  /* ── Section heading ─────────────────────────────────────────────── */
  .sec {
    margin-top: 7pt;
  }
  /* Phase 6.2 — multi-procedure block heading */
  .proc-block {
    margin-top: 10pt;
    padding-top: 6pt;
    border-top: 0.5pt dashed ${PRIMARY}40;
  }
  .proc-block:first-of-type {
    border-top: 0;
    padding-top: 0;
  }
  .proc-block-heading {
    font-size: 11pt;
    font-weight: 800;
    color: ${PRIMARY_DARK};
    letter-spacing: 0.3pt;
    text-transform: uppercase;
    margin-bottom: 4pt;
  }
  .sec-h {
    display: flex;
    align-items: baseline;
    gap: 7pt;
    margin-bottom: 3pt;
    border-bottom: 0.4pt dashed ${PRIMARY}55;
    padding-bottom: 1.5pt;
  }
  .sec-bar {
    display: inline-block;
    width: 2.5pt;
    height: 10pt;
    background: ${PRIMARY};
    border-radius: 1.5pt;
    margin-top: 1pt;
  }
  .sec-h-primary {
    font-size: 10.5pt;
    font-weight: 700;
    color: ${PRIMARY_DARK};
    letter-spacing: 0.2pt;
  }
  .sec-h-others {
    font-size: 8pt;
    color: #6A8388;
    font-weight: 500;
  }

  /* ── Trilingual 3-column content layout ──────────────────────────── */
  .tri {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 3pt 0 0 0;
    table-layout: fixed;
  }
  .tri td.tri-col {
    width: 33.33%;
    padding: 4pt 7pt;
    vertical-align: top;
    border-right: 0.4pt dotted #D7E6E9;
    text-align: justify;
    hyphens: auto;
    font-size: 8.8pt;
    line-height: 1.42;
    color: #1A2E35;
  }
  .tri td.tri-col:last-child { border-right: 0; }
  .tri td.tri-col.tri-hi,
  .tri td.tri-col.tri-gu {
    color: #2D4A53;
  }
  .tri .tri-lang-pill {
    display: inline-block;
    background: ${PRIMARY}14;
    color: ${PRIMARY_DARK};
    font-size: 6pt;
    font-weight: 700;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    padding: 0.5pt 4pt;
    border-radius: 6pt;
    margin-bottom: 2pt;
  }
  .meta-line {
    margin: 4pt 0 0 0;
    padding: 3pt 7pt;
    background: #F4F9FA;
    border-radius: 2pt;
    font-size: 8.5pt;
    color: #2D4A53;
  }

  /* ── Trilingual risk table (4 cols: #, EN, HI, GU) ───────────────── */
  .tri-risks {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    margin: 3pt 0 0 0;
  }
  .tri-risks col.rn-col { width: 16pt; }
  .tri-risks col.lang-col { width: auto; }
  .tri-risks th {
    background: ${PRIMARY}10;
    color: ${PRIMARY_DARK};
    font-size: 6.5pt;
    font-weight: 700;
    letter-spacing: 0.7pt;
    text-transform: uppercase;
    padding: 2pt 5pt;
    border-bottom: 0.5pt solid ${PRIMARY}40;
    text-align: left;
  }
  .tri-risks th.rn { text-align: center; }
  .tri-risks td {
    padding: 3pt 6pt;
    vertical-align: top;
    border-bottom: 0.3pt dotted #DCE9EC;
    border-right: 0.4pt dotted #D7E6E9;
    font-size: 8.5pt;
    line-height: 1.4;
    color: #1A2E35;
    text-align: justify;
    hyphens: auto;
  }
  .tri-risks td.rn {
    text-align: center;
    font-weight: 700;
    color: ${PRIMARY};
    font-size: 8pt;
    border-right: 0.4pt solid #DCE9EC;
  }
  .tri-risks td:last-child,
  .tri-risks th:last-child { border-right: 0; }
  .tri-risks tr:last-child td { border-bottom: 0; }
  .tri-risks td.tri-hi,
  .tri-risks td.tri-gu { color: #2D4A53; }
  .muted { color: #98AAAE; font-style: italic; }

  /* ── Declaration block (3-col trilingual) ────────────────────────── */
  .declaration-wrap {
    margin-top: 4pt;
    padding: 5pt 0;
    background: ${PRIMARY}0A;
    border-left: 2.2pt solid ${PRIMARY};
    border-radius: 0 3pt 3pt 0;
  }
  .declaration-wrap .tri td.tri-col {
    font-size: 8.5pt;
    line-height: 1.5;
    border-right-style: solid;
    border-right-color: ${PRIMARY}33;
    color: #1A2E35;
  }

  /* ── Signature grid ──────────────────────────────────────────────── */
  .sig-grid {
    display: flex;
    gap: 10pt;
    margin-top: 14pt;
    page-break-inside: avoid;
    page-break-before: avoid;
    break-inside: avoid;
    break-before: avoid;
  }
  .sig-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .sig-box {
    height: 50pt;
    border: 0.8pt solid ${PRIMARY_DARK};
    border-radius: 3pt;
    background: #FCFEFE;
    position: relative;
    margin-bottom: 4pt;
    overflow: hidden;
  }
  .sig-box-hint {
    position: absolute;
    bottom: 3pt;
    right: 6pt;
    font-size: 6.2pt;
    color: #B0C2C5;
    letter-spacing: 0.5pt;
    text-transform: uppercase;
  }
  .sig-img {
    position: absolute;
    top: 3pt;
    bottom: 3pt;
    left: 3pt;
    right: 3pt;
    max-height: 44pt;
    max-width: 100%;
    object-fit: contain;
    margin: 0 auto;
    display: block;
  }
  .sig-role {
    font-size: 7.5pt;
    color: ${PRIMARY_DARK};
    text-transform: uppercase;
    letter-spacing: 0.8pt;
    font-weight: 700;
    text-align: center;
  }
  .sig-role-sub {
    color: #98AAAE;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    font-size: 7pt;
  }
  .sig-name {
    font-size: 8.8pt;
    color: #1A2E35;
    margin-top: 1pt;
    text-align: center;
    font-weight: 600;
  }
  .sig-meta-row {
    display: flex;
    justify-content: space-between;
    margin-top: 3pt;
    border-top: 0.4pt dashed #C9D8DC;
    padding-top: 2pt;
  }
  .sig-meta-row .lbl {
    font-size: 6.5pt;
    color: #6A8388;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
  }
  .sig-date-rule {
    flex: 1;
    border-bottom: 0.4pt solid #1A2E35;
    margin-left: 5pt;
    margin-bottom: 1pt;
  }
</style></head><body>

  <!-- ── Running (WeasyPrint) header — appears on every page ─────────── -->
  <div class="page-header">
    <div class="header-bar">
      <div class="brand">
        <img class="brand-logo" src="${logoSrc}" alt="ConsultUro"/>
        <div class="brand-text">
          <div class="brand-name">ConsultUro</div>
          <div class="brand-tag">Urology Care Platform</div>
        </div>
      </div>
      <div class="clinic-block">
        <div class="clinic-doc">${escapeHtml(docName)}</div>
        <div class="clinic-deg">${escapeHtml(degrees)} · Reg ${escapeHtml(drReg)}</div>
        <div class="clinic-name">${escapeHtml(clinicName)}</div>
        <div class="clinic-addr">${escapeHtml(clinicAddr)} · ${escapeHtml(clinicPhone)}</div>
      </div>
    </div>
  </div>

  <!-- ── Running footer — appears on every page ──────────────────────── -->
  <div class="page-footer">
    <table class="footer-table"><tr>
      <td class="footer-left-cell">
        <img class="footer-logo" src="${logoSrc}" alt=""/><span class="footer-mark">CONSULTURO</span><span class="footer-divider"></span><span class="footer-meta">${escapeHtml(clinicName)}</span>
      </td>
      <td class="footer-right-cell">
        <span class="footer-meta">#${escapeHtml(c.consent_id)}<span class="footer-divider"></span><span class="pageno"></span></span>
      </td>
    </tr></table>
  </div>

  <!-- ── Title strip ─────────────────────────────────────────────────── -->
  <div class="doc-title-wrap">
    <span class="doc-eyebrow">${escapeHtml(titlePrimary)}<span class="doc-eyebrow-sub">${escapeHtml(otherTitles)}</span></span>
    <div class="doc-title">${escapeHtml(procName)}</div>
    ${procNameAlt ? `<div class="doc-title-alt">${escapeHtml(procNameAlt)}</div>` : ''}
  </div>

  <!-- ── Patient strip ───────────────────────────────────────────────── -->
  <table class="pat-strip"><tbody><tr>
    <td>
      <span class="lbl">${escapeHtml(SECTIONS.patient[0])}</span>
      <span class="val">${escapeHtml(c.patient_name || '—')}</span>
    </td>
    <td>
      <span class="lbl">${escapeHtml(SECTIONS.regNo[0])}</span>
      <span class="val">${escapeHtml(regNo)}</span>
    </td>
    <td>
      <span class="lbl">${escapeHtml(SECTIONS.age[0])}</span>
      <span class="val">${escapeHtml(ageSex || '—')}</span>
    </td>
    <td>
      <span class="lbl">${escapeHtml(SECTIONS.phone[0])}</span>
      <span class="val">${escapeHtml(c.patient_phone || '—')}</span>
    </td>
    <td>
      <span class="lbl">${escapeHtml(SECTIONS.date[0])}</span>
      <span class="val">${escapeHtml(stamp || '—')}</span>
    </td>
  </tr></tbody></table>

  <!-- ── Procedure(s) ──────────────────────────────────────────────── -->
  ${isMulti ? allSnapshots.map((sp, idx) => {
    const spName = sp?.name?.[lang] || sp?.name?.en || '';
    const spDesc = {
      en: sp?.procedure?.en || '',
      hi: sp?.procedure?.hi || '',
      gu: sp?.procedure?.gu || '',
    };
    const spAlts = {
      en: sp?.alternatives?.en || '',
      hi: sp?.alternatives?.hi || '',
      gu: sp?.alternatives?.gu || '',
    };
    const spRisks: { en: string; hi: string; gu: string }[] = (sp?.specific_risks || []).map((r: any) => ({
      en: r?.en || '',
      hi: r?.hi || r?.en || '',
      gu: r?.gu || r?.en || '',
    }));
    const spAna = (sp?.anesthesia || sp?.anaesthesia || '').toString().trim();
    return `
  <section class="sec proc-block">
    <div class="proc-block-heading">${escapeHtml(`${idx + 1}. ${spName}`)}</div>
    ${sectionHeading(SECTIONS.procedure, lang)}
    ${triParagraph(spDesc.en, spDesc.hi, spDesc.gu)}
    ${spAna ? `<div class="meta-line"><b>Anaesthesia · एनेस्थीसिया · એનેસ્થેસિયા:</b> ${escapeHtml(spAna)}</div>` : ''}
    ${sectionHeading(SECTIONS.specRisks, lang)}
    ${triRiskTable(spRisks)}
    ${sectionHeading(SECTIONS.alts, lang)}
    ${triParagraph(spAlts.en, spAlts.hi, spAlts.gu)}
  </section>`;
  }).join('') : `
  <section class="sec">
    ${sectionHeading(SECTIONS.procedure, lang)}
    ${triParagraph(procDescTri.en, procDescTri.hi, procDescTri.gu)}
    ${anaesthesia ? `<div class="meta-line"><b>Anaesthesia · एनेस्थीसिया · એનેસ્થેસિયા:</b> ${escapeHtml(anaesthesia)}</div>` : ''}
  </section>

  <!-- ── Procedure-specific risks (trilingual table) ─────────────────── -->
  <section class="sec">
    ${sectionHeading(SECTIONS.specRisks, lang)}
    ${triRiskTable(specRisksTri)}
  </section>

  <!-- ── Alternatives ────────────────────────────────────────────────── -->
  <section class="sec">
    ${sectionHeading(SECTIONS.alts, lang)}
    ${triParagraph(procAltsTri.en, procAltsTri.hi, procAltsTri.gu)}
  </section>`}

  <!-- ── Common surgical risks (trilingual table) ────────────────────── -->
  <section class="sec">
    ${sectionHeading(SECTIONS.commonRisks, lang)}
    ${triRiskTable(commonRisksTri)}
  </section>

  <!-- ── Declaration ─────────────────────────────────────────────────── -->
  <section class="sec">
    ${sectionHeading(SECTIONS.decl, lang)}
    ${triParagraph(DECLARATION.en, DECLARATION.hi, DECLARATION.gu, { wrapper: 'declaration' })}
  </section>

  <!-- ── Signature grid ──────────────────────────────────────────────── -->
  <div class="sig-grid">
    ${sigBlock({
      imgB64: c.patient_signature_b64,
      roleTriplet: SECTIONS.sigPatient,
      lang,
      name: c.patient_name || NOT_PROVIDED[lang],
    })}
    ${sigBlock({
      imgB64: c.witness_signature_b64,
      roleTriplet: SECTIONS.sigWitness,
      lang,
      name: c.witness_name || NOT_PROVIDED[lang],
    })}
    ${sigBlock({
      imgB64: c.doctor_signature_b64,
      roleTriplet: SECTIONS.sigDoctor,
      lang,
      name: docName,
    })}
  </div>

  <!-- ── End of document body ─────────────────────────────────────────── -->

</body></html>`;
}

// ─── Action helpers ─────────────────────────────────────────────
// All three (print, download, share) route through the backend
// WeasyPrint endpoint so the on-paper output is pixel-identical
// across web, iOS and Android.

async function fetchConsentPdfFromBackend(
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
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: 'base64' });
  return { uri };
}

function filenameFor(c: ConsentDoc): string {
  const safe = (c.patient_name || 'patient').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 32);
  return `Consent-${safe}-${c.consent_id}.pdf`;
}

export async function loadConsentSettings(): Promise<ClinicSettings> {
  try {
    return await loadClinicSettings();
  } catch {
    return {};
  }
}

export async function printConsentPdf(c: ConsentDoc, settings: ClinicSettings): Promise<void> {
  const html = buildConsentHtml(c, settings);
  const filename = filenameFor(c);
  try {
    const { blob, uri } = await fetchConsentPdfFromBackend(html, filename);
    if (Platform.OS === 'web' && blob) {
      const url = URL.createObjectURL(blob);
      const w: any = typeof window !== 'undefined' ? window : null;
      if (!w) throw new Error('Window unavailable');
      const newWin = w.open(url, '_blank');
      if (newWin) {
        // Once the new tab loads the PDF, trigger its print dialog.
        setTimeout(() => { try { newWin.print(); } catch {} }, 800);
      }
      return;
    }
    if (uri) {
      // expo-print can load a local PDF file in the system print sheet.
      await Print.printAsync({ uri });
    }
  } catch (e: any) {
    // Fallback: print the HTML directly (rare — only when /render/pdf
    // is unreachable, e.g. on a stale Vercel build).
    if (Platform.OS === 'web') {
      const w: any = typeof window !== 'undefined' ? window : null;
      if (!w) return;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const newWin = w.open(url, '_blank');
      if (newWin) setTimeout(() => { try { newWin.print(); } catch {} }, 600);
      return;
    }
    try { await Print.printAsync({ html }); } catch (err: any) {
      Alert.alert('Print failed', err?.message || e?.message || 'Could not print.');
    }
  }
}

export async function downloadConsentPdf(c: ConsentDoc, settings: ClinicSettings): Promise<void> {
  const html = buildConsentHtml(c, settings);
  const filename = filenameFor(c);
  try {
    const { blob, uri } = await fetchConsentPdfFromBackend(html, filename);
    if (Platform.OS === 'web' && blob) {
      const url = URL.createObjectURL(blob);
      const a: any = typeof document !== 'undefined' ? document.createElement('a') : null;
      if (!a) return;
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    if (uri && (await Sharing.isAvailableAsync())) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: '.pdf' });
    }
  } catch (e: any) {
    Alert.alert('Download failed', e?.response?.data?.detail || e?.message || 'Could not download PDF.');
  }
}
