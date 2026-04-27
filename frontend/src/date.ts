import { format, parse, isValid } from 'date-fns';

// Preferred UI format across the app
export const UI_DATE_FORMAT = 'dd-MM-yyyy';
export const UI_DATE_PLACEHOLDER = 'DD-MM-YYYY';

// Storage format (ISO) — keep unchanged on DB
export const ISO_DATE_FORMAT = 'yyyy-MM-dd';

/**
 * Format an ISO date string (yyyy-MM-dd) for display as DD-MM-YYYY.
 * Falls back to the raw string if invalid.
 */
export function displayDate(iso?: string | null): string {
  if (!iso) return '';
  // Try ISO yyyy-MM-dd first
  const parsed = parse(iso, ISO_DATE_FORMAT, new Date());
  if (isValid(parsed)) return format(parsed, UI_DATE_FORMAT);
  // Try if it's already a Date-parseable string (createdAt etc.)
  const d = new Date(iso);
  if (isValid(d)) return format(d, UI_DATE_FORMAT);
  return String(iso);
}

/** Full date/time like 13-04-2025, 9:30 AM (12-hour) */
export function displayDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isValid(d)) return format(d, 'dd-MM-yyyy, h:mm a');
  return String(iso);
}

/** Long weekday format e.g. Mon, 13-04-2025 */
export function displayDateLong(iso?: string | null): string {
  if (!iso) return '';
  const parsed = parse(iso, ISO_DATE_FORMAT, new Date());
  if (isValid(parsed)) return format(parsed, 'EEE, dd-MM-yyyy');
  const d = new Date(iso);
  if (isValid(d)) return format(d, 'EEE, dd-MM-yyyy');
  return String(iso);
}

/**
 * Parse a user-typed DD-MM-YYYY (or DD/MM/YYYY) string and return ISO YYYY-MM-DD.
 * Returns empty string if unparseable.
 */
export function parseUIDate(s: string): string {
  if (!s) return '';
  const cleaned = s.replace(/[\/.]/g, '-').trim();
  // Already ISO?
  const iso = parse(cleaned, ISO_DATE_FORMAT, new Date());
  if (isValid(iso)) return format(iso, ISO_DATE_FORMAT);
  const parsed = parse(cleaned, UI_DATE_FORMAT, new Date());
  if (isValid(parsed)) return format(parsed, ISO_DATE_FORMAT);
  return '';
}

/** Today in ISO */
export function todayISO(): string {
  return format(new Date(), ISO_DATE_FORMAT);
}

/** Today in DD-MM-YYYY */
export function todayUI(): string {
  return format(new Date(), UI_DATE_FORMAT);
}

/**
 * Convert a 24-h time string (HH:mm) to 12-h with AM/PM (h:mm a).
 * Returns the original string if it cannot be parsed.
 */
export function display12h(hhmm?: string | null): string {
  if (!hhmm) return '';
  const parsed = parse(hhmm, 'HH:mm', new Date());
  if (isValid(parsed)) return format(parsed, 'h:mm a');
  // Already 12h?
  const p2 = parse(hhmm, 'h:mm a', new Date());
  if (isValid(p2)) return format(p2, 'h:mm a');
  return String(hhmm);
}

/**
 * Convert 12-h input (e.g. "2:30 PM") back to 24-h HH:mm for storage.
 */
export function to24h(s: string): string {
  if (!s) return '';
  const p = parse(s, 'h:mm a', new Date());
  if (isValid(p)) return format(p, 'HH:mm');
  const p2 = parse(s, 'HH:mm', new Date());
  if (isValid(p2)) return format(p2, 'HH:mm');
  return s;
}

// =====================================================================
// IST (Indian Standard Time) helpers — use these instead of toLocaleString()
// for anything the clinic team or patients will see, so outputs are
// consistent regardless of the device timezone (e.g. a patient travelling
// abroad still sees the appointment in IST).
// =====================================================================

const IST_TZ = 'Asia/Kolkata';

/** Convert any ISO/Date to an IST-zoned formatted string.
 *  Example: 2025-10-20T04:30:00Z → "20 Oct 2025, 10:00 AM" */
export function formatIST(
  input?: string | Date | null,
  opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  },
): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: IST_TZ }).format(d);
  } catch {
    // Older JS engines without full ICU may not know Asia/Kolkata — fall back
    // to manual +5:30 offset.
    const ms = d.getTime() + 5.5 * 3600 * 1000;
    const shifted = new Date(ms);
    return shifted.toISOString().replace('T', ' ').slice(0, 16) + ' IST';
  }
}

/** Short IST date only — "20 Oct 2025" */
export function formatISTDate(input?: string | Date | null): string {
  return formatIST(input, { day: '2-digit', month: 'short', year: 'numeric' });
}

/** IST time only — "10:00 AM" */
export function formatISTTime(input?: string | Date | null): string {
  return formatIST(input, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Relative-friendly IST timestamp — "Today, 10:00 AM", "Yesterday, 3:45 PM"
 *  or falls back to full format. */
export function formatISTRelative(input?: string | Date | null): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const now = new Date();
  const ms = d.getTime();
  const dayDelta = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) /
      86400000,
  );
  const timePart = formatISTTime(d);
  if (dayDelta === 0) return `Today, ${timePart}`;
  if (dayDelta === 1) return `Yesterday, ${timePart}`;
  if (dayDelta === -1) return `Tomorrow, ${timePart}`;
  if (dayDelta > 0 && dayDelta < 7) {
    const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: IST_TZ }).format(d);
    return `${weekday}, ${timePart}`;
  }
  return formatIST(d);
}

/** Current IST Date (as a Date object shifted to IST) — helpful for comparisons. */
export function nowIST(): Date {
  const n = new Date();
  return new Date(n.getTime() + (5.5 * 3600 * 1000 - n.getTimezoneOffset() * 60 * 1000));
}

/**
 * Parse a backend ISO timestamp safely.
 *
 * Backend stores `datetime.now(timezone.utc)` → MongoDB → motor returns
 * tz-naive UTC → FastAPI serialises as "2026-04-25T18:00:00.123" (no
 * trailing Z). `new Date(naive)` then interprets the string as the
 * device's LOCAL time, which on Indian phones is IST = UTC+5:30, so
 * "now" timestamps appeared as ~5–6h in the future / past in the UI
 * (e.g. "about 6 hours ago" for a notification just sent).
 *
 * This helper appends Z when no timezone marker is present so the
 * parser always sees a UTC instant. Pass any Date returned by this
 * function to formatDistanceToNow / formatIST etc. for correct output.
 */
export function parseBackendDate(input?: string | Date | null): Date {
  if (!input) return new Date(NaN);
  if (input instanceof Date) return input;
  const s = String(input).trim();
  // Already has TZ marker? trust it.
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  // ISO without TZ — coerce to UTC.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s + 'Z');
  return new Date(s);
}
