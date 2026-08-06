/**
 * consultation-window.ts
 *
 * Helpers for the "Start Consultation / Join Video" feature (Item 7).
 *
 * A confirmed booking becomes "consultable" when the current wall-clock
 * time lies within a window around the scheduled time. Default window
 * is ±15 minutes, but callers can override (e.g. tele-consults may want
 * a wider 30-min window).
 *
 * The helpers are pure (no React) so they can be reused by:
 *   - BookingsPanel (Dashboard → Bookings tab)
 *   - TodayGlance widget
 *   - Booking detail page (/bookings/[id])
 *   - Patient app (future)
 *
 * NOTE: All time math is local-device-time. We do NOT attempt to
 * normalise to a clinic timezone here — bookings are stored in the
 * clinic's local time and rendered the same way (12h with the existing
 * `display12h` helper). Mixing across time zones would require a
 * separate refactor.
 */

export type ConsultationStatus = 'upcoming' | 'now' | 'past' | 'invalid';

export interface ConsultationWindowInfo {
  status: ConsultationStatus;
  /** Minutes until the appointment. Negative if past. */
  minutesUntil: number;
  /** Human-friendly label like "Starts in 7 min" or "Started 3 min ago". */
  label: string;
  /** True when the [-windowMin, +windowMin] window contains "now". */
  inWindow: boolean;
}

/**
 * Combine a YYYY-MM-DD date and an HH:mm[:ss] time into a Date object
 * in the device's local timezone.
 */
export function parseBookingDateTime(date?: string | null, time?: string | null): Date | null {
  if (!date || !time) return null;
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!dateMatch) return null;
  // Accept "HH:mm" or "HH:mm:ss"
  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!timeMatch) return null;
  const [, y, m, d] = dateMatch;
  const [, hh, mm, ss] = timeMatch;
  const dt = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    ss ? Number(ss) : 0,
    0,
  );
  return isNaN(dt.getTime()) ? null : dt;
}

export function getConsultationWindow(
  date?: string | null,
  time?: string | null,
  opts?: { windowMin?: number; now?: Date },
): ConsultationWindowInfo {
  const windowMin = opts?.windowMin ?? 15;
  const now = opts?.now ?? new Date();
  const dt = parseBookingDateTime(date, time);
  if (!dt) {
    return { status: 'invalid', minutesUntil: 0, label: '', inWindow: false };
  }

  const diffMs = dt.getTime() - now.getTime();
  const minutesUntil = Math.round(diffMs / 60000);

  let status: ConsultationStatus;
  if (minutesUntil > windowMin) status = 'upcoming';
  else if (minutesUntil < -windowMin) status = 'past';
  else status = 'now';

  let label = '';
  if (status === 'now') {
    if (minutesUntil > 0) label = `Starts in ${minutesUntil} min`;
    else if (minutesUntil < 0) label = `Started ${Math.abs(minutesUntil)} min ago`;
    else label = 'Starting now';
  } else if (status === 'upcoming') {
    if (minutesUntil < 60) label = `In ${minutesUntil} min`;
    else if (minutesUntil < 24 * 60) {
      const h = Math.floor(minutesUntil / 60);
      const m = minutesUntil % 60;
      label = m === 0 ? `In ${h}h` : `In ${h}h ${m}m`;
    } else {
      const days = Math.floor(minutesUntil / (24 * 60));
      label = `In ${days}d`;
    }
  } else if (status === 'past') {
    const m = Math.abs(minutesUntil);
    if (m < 60) label = `${m} min ago`;
    else if (m < 24 * 60) label = `${Math.floor(m / 60)}h ago`;
    else label = `${Math.floor(m / (24 * 60))}d ago`;
  }

  return {
    status,
    minutesUntil,
    label,
    inWindow: status === 'now',
  };
}

/**
 * Subset of the booking shape consumed by the helper. Bookings come from
 * `/api/bookings/all` and `/api/bookings/{id}`.
 */
export interface BookingForWindow {
  status?: string;
  booking_date?: string;
  booking_time?: string;
  mode?: string; // 'online' | 'in-person'
}

/**
 * Should the "Start Consultation" CTA be shown for this booking?
 * Rules:
 *   - status MUST be `confirmed` (we don't show on requested/cancelled/etc)
 *   - current time must be within the consultation window
 */
export function shouldShowStartCta(
  b: BookingForWindow | null | undefined,
  opts?: { windowMin?: number; now?: Date },
): boolean {
  if (!b || b.status !== 'confirmed') return false;
  return getConsultationWindow(b.booking_date, b.booking_time, opts).inWindow;
}

/**
 * Returns true when the booking is for a tele-consult / video call.
 *
 * The bookings collection stores TWO equivalent values for video:
 *   · `mode === 'online'` — set by the original booking flow.
 *   · `mode === 'video'`  — overwritten by the auto-provision helper
 *     in `routers/bookings.py` once a 100ms room is created on
 *     confirm. Both are treated as video by every UI surface.
 *
 * Anything else (`'in-person'`, undefined, …) is in-person.
 */
export function isVideoBooking(b: BookingForWindow | null | undefined): boolean {
  if (!b) return false;
  const m = (b.mode || '').toLowerCase();
  return m === 'online' || m === 'video' || m.startsWith('video');
}
