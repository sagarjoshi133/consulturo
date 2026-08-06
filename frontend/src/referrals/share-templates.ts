/**
 * Trilingual WhatsApp/share message templates for the Refer-a-Patient
 * feature. Owner can extend these later via Settings; for now the
 * copy is hard-coded with sensible defaults.
 */
export type ShareLang = 'en' | 'hi' | 'gu';

export function buildShareMessage({
  lang, link, referrerName, clinicName,
}: {
  lang: ShareLang;
  link: string;
  referrerName?: string | null;
  clinicName?: string | null;
}): string {
  const r = (referrerName || 'A friend').trim();
  const c = (clinicName || 'ConsultUro').trim();
  if (lang === 'hi') {
    return (
      `नमस्ते! मैं आपको ${c} पर Dr. Sagar Joshi (मूत्र-रोग विशेषज्ञ) से परामर्श करने की सिफारिश करता हूँ। ` +
      `मुझे यहां बहुत अच्छा अनुभव रहा।\n\n` +
      `आप यहां से सीधे बुक कर सकते हैं:\n${link}\n\n— ${r}`
    );
  }
  if (lang === 'gu') {
    return (
      `નમસ્તે! હું તમને ${c} પર Dr. Sagar Joshi (મૂત્રરોગ વિશેષજ્ન) પાસેથી પરામર્શ લેવાની સલાહ આપું છું। ` +
      `મને અહીં ખુબ સારો અનુભવ થયો છે।\n\n` +
      `તમે અહીંથી સીધો બુક કરી શકો છો:\n${link}\n\n— ${r}`
    );
  }
  return (
    `Hi! I'd like to recommend Dr. Sagar Joshi (urologist) at ${c} ` +
    `for any urological concerns. I had a great experience.\n\n` +
    `You can book directly here:\n${link}\n\n— ${r}`
  );
}
