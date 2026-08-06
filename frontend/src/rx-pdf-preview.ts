/**
 * previewSampleRx — render a sample Prescription PDF using the
 * current clinic settings so a Primary Owner can see exactly how
 * their letterhead, custom Patient Education, and Need-Help blocks
 * will appear on a real Rx — WITHOUT having to create a fake
 * patient + draft prescription.
 *
 * Mounted on the Branding panel under the "Prescription Look"
 * category (and visible at the top of the panel for at-a-glance
 * verification).
 *
 * Web: opens the rendered HTML in a new tab so the user can use
 *      the browser print preview / Save-as-PDF dialog.
 * Native: hands the HTML to expo-print's native preview screen.
 */
import { Platform, Alert } from 'react-native';
import * as Print from 'expo-print';
import { buildRxHtml, loadClinicSettings, type RxDoc, type ClinicSettings } from './rx-pdf';

// Realistic-but-clearly-fake demo Rx — uses a placeholder patient,
// two common BPH medications, an IPSS score, and full follow-up so
// every section of the template is rendered. Marked with a "SAMPLE"
// banner via the patient_name + reg-no so it can never be confused
// with a real prescription.
const SAMPLE_RX: RxDoc = {
  prescription_id: 'SAMPLE-PREVIEW',
  patient_name: '[ Sample Patient ]',
  patient_age: 62,
  patient_gender: 'Male',
  patient_phone: '+91-90000-00000',
  patient_address: 'Vadodara, Gujarat',
  registration_no: 'PREVIEW01',
  ref_doctor: 'Self-walk-in',
  visit_date: new Date().toISOString().slice(0, 10),
  chief_complaints:
    'LUTS for 6 months — weak stream, nocturia ×3, urgency with hesitancy. No haematuria, no dysuria.',
  vitals: 'BP 132/84 · HR 78 · BMI 26.4',
  vitals_pulse: '78 / min',
  vitals_bp: '132/84 mmHg',
  vitals_temp: '98.4 °F',
  vitals_spo2: '98 %',
  vitals_height: '170 cm',
  vitals_weight: '76 kg',
  vitals_bmi: '26.4',
  examination:
    'Abdomen soft, no tenderness · Bilateral renal areas non-tender · DRE: prostate ~35 g, smooth, firm, non-tender, no nodules.',
  investigations:
    'USG KUB: prostate 38 cc, post-void residue 60 mL, no hydronephrosis · Uroflowmetry: Qmax 9 mL/s · PSA 1.4 ng/mL · Urine R/M normal.',
  investigations_advised: 'Repeat PSA in 6 months. Bring uroflowmetry pre-follow-up.',
  diagnosis: 'Benign Prostatic Hyperplasia (BPH) with mild bother — IPSS 14, QoL 3.',
  ipss_score: 14,
  ipss_qol: 3,
  medicines: [
    {
      name: 'Urimax (Tamsulosin 0.4 mg)',
      dosage: '0.4 mg',
      frequency: 'OD',
      duration: '30 days',
      timing: 'After dinner',
      instructions: 'May cause mild dizziness initially — stand slowly when starting.',
    },
    {
      name: 'Dutas (Dutasteride 0.5 mg)',
      dosage: '0.5 mg',
      frequency: 'OD',
      duration: '90 days',
      timing: 'After breakfast',
      instructions: 'Effect noticeable after 3-6 months. Continue indefinitely.',
    },
  ],
  advice:
    'Hydrate well — avoid > 2 L past 6 PM to reduce nocturia. Reduce caffeine after 4 PM. Practice timed voiding every 2-3 hours during the day.',
  follow_up_date: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  follow_up_notes: 'Repeat USG KUB + uroflowmetry. Bring void diary for 3 days before visit.',
};

export async function previewSampleRx(settings?: ClinicSettings): Promise<void> {
  try {
    const s = settings || (await loadClinicSettings());
    const html = await buildRxHtml(SAMPLE_RX, s);

    if (Platform.OS === 'web') {
      // Open the preview in a new tab via a Blob URL — same-origin
      // navigation that browsers render reliably even inside iframed
      // previews. We deliberately AVOID the legacy
      // `window.open('') + document.write()` pattern because it
      // (a) returned null inside the Kubernetes-ingress preview
      // iframe and (b) sometimes fell back to navigating the
      // parent frame, replacing the React app with the raw HTML.
      const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      let opened: Window | null = null;
      try {
        opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
      } catch {}
      if (opened) {
        // Defer revoke so the new tab has time to fetch the blob.
        setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch {} }, 60000);
        return;
      }
      // Popup blocked — try an anchor-click fallback (some browsers
      // permit this when window.open is denied). Then revoke either
      // way so we don't leak Blob memory.
      try {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          try { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); } catch {}
        }, 60000);
        window.alert(
          'Allow pop-ups for this site to see the sample Rx in a new tab. If a tab did not open, check your browser pop-up blocker.',
        );
      } catch {
        try { URL.revokeObjectURL(blobUrl); } catch {}
        window.alert('Could not open the sample Rx preview. Please allow pop-ups for this site.');
      }
      return;
    }

    // Native: hand to expo-print which shows the OS print preview.
    // The preview screen lets the user pinch-zoom + tap "Save as PDF"
    // exactly like a real Rx flow.
    await Print.printAsync({ html });
  } catch (e: any) {
    // Sanitise message — never let the Rx HTML template leak into an alert.
    let raw: any = e?.message ?? e;
    let msg: string = typeof raw === 'string' ? raw : String(raw ?? '');
    // If the message looks like leaked HTML/CSS, replace with a safe fallback.
    const looksLikeCode =
      /<\s*\/?\s*(style|script|html|head|body|meta|table|div|section)\b/i.test(msg) ||
      /@(page|media|keyframes|font-face)\b/i.test(msg) ||
      /\/\*[\s\S]*?\*\//.test(msg) ||
      msg.length > 600;
    if (looksLikeCode) msg = 'Could not render sample preview';
    msg = msg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (msg.length > 240) msg = msg.slice(0, 237) + '…';
    if (!msg) msg = 'Could not render sample preview';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Preview failed', msg);
  }
}
