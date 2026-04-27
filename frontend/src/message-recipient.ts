/**
 * Helper for the staff-side "Send Message" buttons on bookings,
 * consultations and the booking-detail page.
 *
 * Bookings often store only a phone number — the patient may not be a
 * registered user yet. Rather than hide the message button in that case,
 * we always show it and resolve the recipient on tap:
 *
 *   1. If we already have `patient_user_id` (booking joined with user) →
 *      open the composer pre-filled.
 *   2. Else, call /api/messages/lookup-by-phone. If a registered user
 *      matches the phone → open composer pre-filled.
 *   3. Otherwise, show a friendly toast suggesting WhatsApp.
 *
 * This keeps the UX consistent across rows without forcing the staff
 * to figure out which patients have downloaded the app.
 */
import api from './api';

export type MessageRecipient = {
  user_id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  picture?: string;
};

export type ResolveInput = {
  patient_user_id?: string | null;
  patient_name?: string | null;
  patient_phone?: string | null;
  country_code?: string | null;
  patient_email?: string | null;
};

export type ResolveResult =
  | { ok: true; recipient: MessageRecipient }
  | { ok: false; reason: 'no_phone' | 'not_registered' | 'error' };

export async function resolvePatientRecipient(b: ResolveInput): Promise<ResolveResult> {
  // Fast path: booking already has a linked user_id.
  if (b.patient_user_id) {
    return {
      ok: true,
      recipient: {
        user_id: b.patient_user_id,
        name: b.patient_name || undefined,
        phone: b.patient_phone || undefined,
        email: b.patient_email || undefined,
        role: 'patient',
      },
    };
  }
  const phone = (b.patient_phone || '').trim();
  if (!phone) return { ok: false, reason: 'no_phone' };
  try {
    const { data } = await api.get('/messages/lookup-by-phone', { params: { phone } });
    if (data?.found && data.user?.user_id) {
      return {
        ok: true,
        recipient: {
          user_id: data.user.user_id,
          name: data.user.name || b.patient_name || undefined,
          phone: data.user.phone || phone,
          email: data.user.email || b.patient_email || undefined,
          role: data.user.role || 'patient',
          picture: data.user.picture,
        },
      };
    }
    return { ok: false, reason: 'not_registered' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
