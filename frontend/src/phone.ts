/**
 * Phone-number helpers used by the booking, consultation and prescription
 * surfaces. Keeps the logic in one place so a missing country-code on a
 * `wa.me/` URL can never resurface — every WhatsApp action funnels through
 * `whatsappLink()` below.
 */

/**
 * Stitch together a country-code + local phone into the international
 * digits-only form that WhatsApp / wa.me expects (no leading +).
 *
 * Rules:
 *   - If the phone already contains a leading "+", strip non-digits and
 *     return as-is (assume caller already encoded the country).
 *   - If the phone is > 10 digits, assume the country is baked in.
 *   - Otherwise prepend the stored `countryCode` (default +91).
 */
export function toInternationalDigits(countryCode?: string, phone?: string): string {
  if (!phone) return '';
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;
  if (digits.length > 10) return digits;
  const cc = (countryCode || '+91').replace(/\D/g, '');
  return cc + digits;
}

/** Build a wa.me link with the country-code-prefixed digits + optional text. */
export function whatsappLink(countryCode: string | undefined, phone: string | undefined, text?: string): string {
  const intl = toInternationalDigits(countryCode, phone);
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${intl}${q}`;
}

/** tel: deeplink with country-code prefix where possible. */
export function telLink(countryCode: string | undefined, phone: string | undefined): string {
  const intl = toInternationalDigits(countryCode, phone);
  return intl ? `tel:+${intl}` : `tel:${phone || ''}`;
}
