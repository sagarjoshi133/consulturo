/**
 * Auto-send-via-WhatsApp helper that hooks into every clinical PDF
 * surface (Rx, Discharge Summary, Medical Certificate). After the
 * PDF is rendered + shared via the OS share sheet, this helper
 * opens a follow-up wa.me chat with a pre-filled message to the
 * patient so the doctor doesn't have to switch apps, find the
 * patient, and type the same "Here's your Rx, follow-up on …"
 * message every time.
 *
 * Why two steps?
 *   • The OS share sheet (expo-sharing) supports attaching the
 *     real PDF to a WhatsApp message — but it doesn't pre-select
 *     a specific contact (user has to pick from the WA contact
 *     list). On Android, opening WhatsApp via wa.me?phone= jumps
 *     STRAIGHT to that patient's chat — but cannot attach a PDF.
 *   • Combining them gives the best of both: tap "Share PDF" →
 *     attach via share sheet → confirm → we then open the
 *     patient's chat to send a follow-up note ("Your Rx has been
 *     shared. Next follow-up: …"). Doctor reads zero, just taps.
 *
 * Toggles:
 *   • Reads `whatsapp_auto_prompt_enabled` (default true) from the
 *     cached settings hook — owner can disable in Branding
 *     Settings → Communications.
 *   • Always returns silently if the patient has no phone number.
 */
import { Alert, Linking, Platform } from 'react-native';
import { sharePdfFromHtml } from './pdf-share';
import { whatsappLink, toInternationalDigits } from './phone';

export type AutoWaContext = {
  /** Patient first/full name — used to personalise the message. */
  patientName?: string | null;
  /** Patient's stored phone digits (no country code prefix needed). */
  patientPhone?: string | null;
  /** Country code from clinic_settings, e.g. "+91". */
  countryCode?: string | null;
  /** What kind of document was just generated. */
  docKind: 'rx' | 'discharge' | 'medcert';
  /** Optional follow-up date / next visit (DD-MM-YYYY) shown in msg. */
  followUpDate?: string | null;
  /** Optional clinic / doctor name signature for the message body. */
  doctorName?: string | null;
  /** Optional skip flag — owner-controlled opt-out from settings. */
  enabled?: boolean;
};

/** Build the canonical WhatsApp message template per document kind. */
export function buildWaMessage(ctx: AutoWaContext): string {
  const first = (ctx.patientName || 'there').trim().split(/\s+/)[0] || 'there';
  const doc = ctx.doctorName ? `Dr. ${ctx.doctorName.replace(/^Dr\.?\s*/i, '')}` : 'your doctor';
  const followUp = ctx.followUpDate ? `\n\n📅 Next follow-up: ${ctx.followUpDate}` : '';
  switch (ctx.docKind) {
    case 'rx':
      return (
        `Hi ${first}, your prescription from ${doc} is ready 📋\n\n` +
        `Please follow the medications as advised. Reach out if you have any questions.${followUp}\n\n` +
        `— ConsultUro`
      );
    case 'discharge':
      return (
        `Hi ${first}, your discharge summary from ${doc} is attached 🏥\n\n` +
        `Please follow the post-discharge instructions carefully. Take care!${followUp}\n\n` +
        `— ConsultUro`
      );
    case 'medcert':
      return (
        `Hi ${first}, your medical certificate from ${doc} is ready 📄\n\n` +
        `Please find the attached PDF for your records.${followUp}\n\n` +
        `— ConsultUro`
      );
  }
}

/**
 * Generate + share the PDF, then prompt the doctor to also open the
 * patient's WhatsApp chat with a pre-filled note.
 *
 * Behaviour matrix:
 *   • No patientPhone → silently falls back to plain sharePdfFromHtml.
 *   • enabled === false → same as above.
 *   • Otherwise → after the share sheet closes (or download completes
 *     on web), shows a one-tap confirm: "Open WhatsApp chat with
 *     {patient}?" → tap Yes → opens wa.me/<digits>?text=<msg>.
 *
 * @param html      Full HTML document of the PDF to render.
 * @param filename  Output filename (with or without .pdf suffix).
 * @param title     Share-sheet dialog title.
 * @param ctx       Patient + document context for the WA follow-up.
 */
export async function sharePdfThenWhatsApp(
  html: string,
  filename: string,
  title: string,
  ctx: AutoWaContext,
): Promise<void> {
  // 1) Share / download the PDF via the existing pipeline.
  await sharePdfFromHtml(html, filename, title);

  // 2) Guard rails — silent skip when prompt can't help.
  if (ctx.enabled === false) return;
  const digits = toInternationalDigits(ctx.countryCode || '+91', ctx.patientPhone || '');
  if (!digits) return;

  const url = whatsappLink(ctx.countryCode || '+91', ctx.patientPhone || '', buildWaMessage(ctx));
  const patientLabel = (ctx.patientName || '').trim() || 'the patient';
  const openIt = async () => {
    try {
      // On native, `Linking.openURL('whatsapp://send?…')` jumps directly
      // into the WhatsApp app without spawning a browser intermediate.
      // wa.me works too but uses the browser → WhatsApp deep-link
      // round trip. Try the native scheme first; fall back to wa.me.
      const waScheme = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(
        buildWaMessage(ctx),
      )}`;
      if (Platform.OS !== 'web') {
        const supported = await Linking.canOpenURL(waScheme);
        if (supported) {
          await Linking.openURL(waScheme);
          return;
        }
      }
      await Linking.openURL(url);
    } catch {
      try { await Linking.openURL(url); } catch {}
    }
  };

  // 3) Two-button confirm — destructive default = Open chat.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `PDF shared.\n\nOpen WhatsApp chat with ${patientLabel} to send a follow-up message?`,
    );
    if (ok) await openIt();
    return;
  }
  Alert.alert(
    'PDF shared',
    `Open WhatsApp chat with ${patientLabel} to send a follow-up message?`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open WhatsApp', style: 'default', onPress: openIt },
    ],
  );
}
