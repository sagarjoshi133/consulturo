import axios, { AxiosError, AxiosRequestConfig } from 'axios';
// @ts-ignore — deep import of axios's fetch-adapter factory (ships no types).
// Allowed by axios's package "exports" map: "./unsafe/*" → "./lib/*".
import { getFetch } from 'axios/unsafe/adapters/fetch.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { expoFetch } from './net/fetch-polyfill';
import {
  activateFallback,
  getActiveBase,
  isDrClassError,
  isOnFallback,
} from './backend-health';

// PROD_FALLBACK is the always-on production backend URL used when
// EXPO_PUBLIC_BACKEND_URL is not set (e.g., APK builds where EAS env
// vars were dropped). Sourced from EXPO_PUBLIC_PROD_FALLBACK_URL or
// the first entry of EXPO_PUBLIC_BACKEND_FALLBACKS. If neither is
// configured the app cannot reach the backend — we surface a clear
// error to the developer instead of shipping a stale literal.
const PROD_FALLBACK =
  process.env.EXPO_PUBLIC_PROD_FALLBACK_URL ||
  process.env.EXPO_PUBLIC_BACKEND_FALLBACKS?.split(',')[0]?.trim() ||
  '';
// On web, only use localhost when explicitly running `expo start` on
// the developer's own machine (hostname === 'localhost' or '127.0.0.1').
// Any other web origin (Vercel, custom domain) must hit the live
// production backend even if EXPO_PUBLIC_BACKEND_URL got dropped at
// build time. This prevents a recurrence of the "Network Error /
// timeout 15000ms" bug on consulturo.vercel.app where the bundled web
// app was attempting to reach localhost:8001 from the user's browser.
//
// NOTE: we intentionally do NOT ship a hardcoded `http://localhost:...`
// literal — even on `localhost` the local Metro dev server proxies
// `/api/*` to the backend, so using `window.location.origin` works
// both in local dev and in same-origin web deployments.
function webDefaultBackend(): string {
  if (typeof window === 'undefined') return PROD_FALLBACK;
  const origin = window.location?.origin;
  if (typeof origin === 'string' && origin) {
    return origin;
  }
  return PROD_FALLBACK;
}
const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Platform.OS === 'web' ? webDefaultBackend() : PROD_FALLBACK);

if (!BACKEND_URL) {
  console.error(
    '[api] EXPO_PUBLIC_BACKEND_URL is not set and no fallback configured. '
    + 'Set EXPO_PUBLIC_BACKEND_URL or EXPO_PUBLIC_PROD_FALLBACK_URL / '
    + 'EXPO_PUBLIC_BACKEND_FALLBACKS at build time.',
  );
}

// Initial /api base — may be swapped at runtime when DR fail-over kicks
// in (see ./backend-health.ts). We never mutate axios.defaults.baseURL
// directly because individual calls (e.g. attachments / streamed
// downloads) build URLs from API_BASE eagerly. Instead we resolve the
// effective base via a request interceptor on every call.
export const API_BASE = `${BACKEND_URL.replace(/\/$/, '')}/api`;

// ─── Android SDK 54 networking fix ─────────────────────────────────────
// axios defaults to the XHR adapter on React Native, but XHR is ALSO hit
// by the Expo SDK 54 Android networking regression (requests are extremely
// slow / hang — see ./net/fetch-polyfill.ts and expo/expo#40061). We swap
// axios onto its BUILT-IN fetch adapter, transported by `expo/fetch`
// (Expo's native networking) which bypasses the broken path and is fast.
//
// `Request: null` forces axios's fetch adapter down its string-URL branch
// (`_fetch(url, options)`) so `expo/fetch` — which only accepts a string
// URL, not a Request object — receives the URL directly.
function buildAndroidFetchAdapter(): AxiosRequestConfig['adapter'] {
  return getFetch({
    env: {
      fetch: (url: string, init?: any) => expoFetch(url, init),
      Request: null,
      Response: null,
    },
  });
}

const androidFetchAdapter =
  Platform.OS === 'android' ? buildAndroidFetchAdapter() : undefined;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  ...(androidFetchAdapter ? { adapter: androidFetchAdapter } : {}),
});

// ─── Multi-tenant header injection ─────────────────────────────────────
// `TenantContext` calls `setActiveClinicId(id)` whenever the user picks
// a clinic from the switcher. Subsequent axios requests then carry
// `X-Clinic-Id: <id>` so the backend scopes its query.
//
// Why a module-level variable instead of axios.defaults.headers? Because
// (a) tests sometimes spin up multiple axios instances, (b) we want the
// Authorization header to be set per-request from AsyncStorage, and
// (c) keeping all per-request mutation in one interceptor is easier to
// reason about than mixing headers across two layers.
let _activeClinicId: string | null = null;

/** Update the X-Clinic-Id header injected on every subsequent request. */
export function setActiveClinicId(id: string | null): void {
  _activeClinicId = id && id.length ? id : null;
}

/** Read-only accessor (used by debug pages / tests). */
export function getActiveClinicId(): string | null {
  return _activeClinicId;
}

api.interceptors.request.use(async (config) => {
  // DR fail-over — if we've previously failed over to a backup backend
  // for this session, rewrite the baseURL so this request also uses it.
  // (Cheap: just a string comparison + assignment when needed.)
  if (isOnFallback()) {
    const fb = `${getActiveBase()}/api`;
    if (config.baseURL !== fb) config.baseURL = fb;
  }
  const token = await AsyncStorage.getItem('session_token');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  // Skip clinic header on the clinics-listing endpoint itself —
  // otherwise super_owner / cross-tenant lookups would be filtered.
  if (_activeClinicId) {
    const url = (config.url || '').toString();
    const isListingClinics = /^\/clinics(\?|$)/.test(url);
    if (!isListingClinics) {
      config.headers = config.headers || {};
      (config.headers as any)['X-Clinic-Id'] = _activeClinicId;
    }
  }
  return config;
});

// ─── DR fail-over response interceptor ────────────────────────────────
// When the primary backend returns a 5xx-class "origin down" error
// (502/503/504/520-524) or a network error on a CORE INFRASTRUCTURE
// endpoint (auth/health/session), we probe configured fallback URLs
// and retry against the first healthy one. The decision sticks for
// the rest of the session (no per-request re-probing) so latency
// stays sane.
//
// IMPORTANT (Comm-0 fix, Jun-2026): feature-endpoint 5xx responses
// (push relay not configured, LLM upstream down, Razorpay unavailable,
// etc.) MUST NOT flip the entire session onto the preview backend.
// Those endpoints failed for reasons unrelated to backend health, and
// forcing failover was the root cause of the "Connected to backup
// server" banner flapping in production. We now only allow failover
// for a small allowlist of endpoints whose failure genuinely means
// the primary origin is unreachable.
//
// We tag requests with `__drRetried` to prevent infinite retry loops:
// if the fallback also fails, the original error propagates to the
// caller.
const DR_ELIGIBLE_PATH_RES: RegExp[] = [
  /^\/health(\?|$)/,             // /api/health probe
  /^\/me(\?|$)/,                 // caller identity (short form)
  /^\/auth\/me(\?|$)/,           // caller identity — used by AuthProvider on boot
  /^\/auth\/session(\?|$)/,      // OAuth session exchange
  /^\/auth\/refresh(\?|$)/,      // silent session refresh
  /^\/auth\/logout(\?|$)/,       // logout must still work if origin flakes
  /^\/version(\?|$)/,            // version probe
];

function _isDrEligiblePath(url: string | undefined): boolean {
  if (!url) return false;
  // Strip absolute base if any request was sent with a full URL.
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  // baseURL already contains /api, but a few callers prefix it themselves;
  // normalize both shapes.
  const rel = path.replace(/^\/api/, '');
  return DR_ELIGIBLE_PATH_RES.some((re) => re.test(rel));
}

api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError & { config?: AxiosRequestConfig & { __drRetried?: boolean } }) => {
    // ── Comm-9 cutover: normalise 410 Gone from retired legacy
    //    endpoints so screens catching `e.response.data.detail`
    //    display a user-friendly string instead of "[object Object]".
    try {
      const status = (error as any)?.response?.status;
      const detail = (error as any)?.response?.data?.detail;
      if (status === 410 && detail && typeof detail === 'object'
          && detail.error_code === 'legacy_endpoint_retired') {
        const friendly = `${detail.detail || 'This endpoint has moved.'} Please use Communications V2.`;
        (error as any).response.data.detail = friendly;
        (error as any).response.data._legacy_retired = true;
        (error as any).response.data._v2_endpoint = detail.v2_endpoint;
      }
    } catch { /* never let the interceptor throw */ }

    const cfg = error.config;
    if (!cfg || cfg.__drRetried) return Promise.reject(error);
    if (!isDrClassError(error)) return Promise.reject(error);
    // ── Comm-0 gate (refined Jun-2026) ───────────────────────────
    // A 5xx RESPONSE can be an app-logic failure (e.g. push relay not
    // configured → 503) that does NOT mean the origin is down, so we
    // still restrict those to the true-infra allowlist to avoid the
    // old "Connected to backup server" flapping.
    //
    // BUT a pure NETWORK/timeout error (no HTTP response at all —
    // ERR_NETWORK / ECONNABORTED / ETIMEDOUT / DNS failure)
    // unambiguously means the primary origin is unreachable. In that
    // case we fail over on ANY path — otherwise a down primary backend
    // leaves every data screen (Patients, Bookings, …) spinning
    // forever instead of transparently switching to the healthy
    // fallback backend.
    const hasHttpResponse = !!(error as AxiosError).response;
    if (hasHttpResponse && !_isDrEligiblePath(cfg.url)) return Promise.reject(error);

    const winner = await activateFallback();
    if (!winner) return Promise.reject(error);

    // Retry the same request against the new base.
    cfg.__drRetried = true;
    cfg.baseURL = `${winner}/api`;
    try {
      return await api.request(cfg);
    } catch (retryErr) {
      return Promise.reject(retryErr);
    }
  },
);

export default api;
