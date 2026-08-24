/**
 * Backend Disaster-Recovery (DR) Failover
 * ----------------------------------------
 * When the primary backend (urology-pro.emergent.host) is unreachable
 * (Cloudflare 520 / 502 / 503 / 504 / network error / DNS failure) we
 * transparently fail over to the preview backend
 * (urology-pro.preview.emergentagent.com) so users can keep working.
 *
 * Trade-offs the caller should know about
 * ---------------------------------------
 *  1. The preview backend has its OWN MongoDB. If it diverges from the
 *     production DB, writes during fail-over land in preview Mongo and
 *     will NOT auto-sync back when production recovers.
 *  2. We surface a sticky banner ("Connected to backup server") via
 *     a `setOnFallback` callback so the user is never surprised.
 *  3. Failover is sticky-for-the-session. Once we land on the
 *     fallback we keep using it until the app reloads. Re-probing the
 *     primary on every request would double latency.
 *
 * The probe runs ONLY when a request actually fails with a DR-class
 * error — there is no proactive health ping on startup. That keeps
 * the happy path (primary up) zero-overhead.
 */
import { AxiosError } from 'axios';

const PRIMARY = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
const FALLBACKS = (process.env.EXPO_PUBLIC_BACKEND_FALLBACKS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

let _activeBase: string = PRIMARY;
let _onFallback: ((on: boolean, base: string) => void) | null = null;

/** Subscribe to fallback activation events (banner UI etc.) */
export function setOnFallback(cb: (on: boolean, base: string) => void): void {
  _onFallback = cb;
}

/** Current backend base URL (without /api suffix). */
export function getActiveBase(): string {
  return _activeBase;
}

/** True once we've failed over from the primary. */
export function isOnFallback(): boolean {
  return _activeBase !== PRIMARY;
}

/** True if the given axios error indicates the backend itself is down. */
export function isDrClassError(err: unknown): boolean {
  const ax = err as AxiosError;
  if (!ax) return false;
  // Network failures (no response, DNS, connection reset, CORS-after-down).
  if (!ax.response) {
    const code = ax.code || '';
    if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ETIMEDOUT') return true;
    if ((ax.message || '').toLowerCase().includes('network error')) return true;
    return false;
  }
  const status = ax.response.status;
  // 5xx server / gateway errors that mean the upstream is unreachable.
  // 520-524 are Cloudflare's "origin down" family.
  return status === 502 || status === 503 || status === 504 ||
         status === 520 || status === 521 || status === 522 ||
         status === 523 || status === 524;
}

/**
 * Probe each fallback URL in order. Returns the first one that
 * responds 200 to /api/health, or null if none answer.
 */
async function probeFallback(): Promise<string | null> {
  for (const url of FALLBACKS) {
    try {
      const resp = await fetch(`${url}/api/health`, { method: 'GET' });
      if (resp.ok) {
        try {
          const j = await resp.json();
          if (j && j.ok) return url;
        } catch {
          return url; // 200 even without JSON is good enough.
        }
      }
    } catch {
      // Move on to next fallback.
    }
  }
  return null;
}

/** Attempt to activate a working fallback. Returns the new base URL. */
export async function activateFallback(): Promise<string | null> {
  if (isOnFallback()) return _activeBase;
  const winner = await probeFallback();
  if (!winner) return null;
  _activeBase = winner;
  try { _onFallback?.(true, winner); } catch {}
  // Best-effort log so devs see the switch in browser DevTools.
  // eslint-disable-next-line no-console
  console.warn(`[backend-health] Primary unreachable — failed over to ${winner}`);
  return winner;
}

/**
 * Proactive boot-time health check.
 *
 * Called once when the app starts (before the first data fetch). If
 * the PRIMARY backend answers `/api/health` within `timeoutMs` we stay
 * on it (zero-overhead happy path). If it times out / errors / returns
 * non-200, we immediately fail over to a healthy fallback so the very
 * first screen loads against a working backend instead of every
 * request waiting out the full axios timeout when the primary origin
 * is down (e.g. a failed/degraded production deploy).
 *
 * Safe no-op when PRIMARY is unset (web same-origin) or we've already
 * failed over.
 */
export async function ensureHealthyBackend(timeoutMs = 4000): Promise<void> {
  if (isOnFallback()) return;
  if (!PRIMARY) return;
  if (FALLBACKS.length === 0) return; // nothing to fall over to anyway
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let ok = false;
    try {
      const resp = await fetch(`${PRIMARY}/api/health`, { method: 'GET', signal: ctrl.signal });
      ok = !!resp && resp.ok;
    } finally {
      clearTimeout(t);
    }
    if (ok) return; // primary healthy — stay put
  } catch {
    // network error / abort → treat primary as down
  }
  // Primary unhealthy or unreachable → switch to a fallback if one is up.
  await activateFallback();
}

/** For tests / manual reset (e.g. on app reload). */
export function resetFallback(): void {
  _activeBase = PRIMARY;
  try { _onFallback?.(false, PRIMARY); } catch {}
}
