import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  activateFallback,
  getActiveBase,
  isDrClassError,
  isOnFallback,
} from './backend-health';

// PROD_FALLBACK is the always-on Emergent deployment URL used when
// EXPO_PUBLIC_BACKEND_URL is not set (e.g., APK builds where EAS env
// vars were dropped). It is sourced from an env var first so that the
// production / staging / preview deployments can each ship with their
// own backend URL without code changes; if even that is missing we
// fall back to a sane literal so APKs never end up pointing at
// localhost. The preview URL was retired in v1.0.9 — it auto-sleeps
// and caused 502 / Network Errors on Google Sign-In, prescription PDF,
// share, etc. for installed APK users.
const PROD_FALLBACK =
  process.env.EXPO_PUBLIC_PROD_FALLBACK_URL ||
  process.env.EXPO_PUBLIC_BACKEND_FALLBACKS?.split(',')[0]?.trim() ||
  'https://urology-pro.emergent.host';
// On web, only use localhost when explicitly running `expo start` on
// the developer's own machine (hostname === 'localhost' or '127.0.0.1').
// Any other web origin (Vercel, custom domain) must hit the live
// production backend even if EXPO_PUBLIC_BACKEND_URL got dropped at
// build time. This prevents a recurrence of the "Network Error /
// timeout 15000ms" bug on consulturo.vercel.app where the bundled web
// app was attempting to reach localhost:8001 from the user's browser.
function webDefaultBackend(): string {
  if (typeof window === 'undefined') return PROD_FALLBACK;
  const host = window.location?.hostname || '';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:8001';
  return PROD_FALLBACK;
}
const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  (Platform.OS === 'web' ? webDefaultBackend() : PROD_FALLBACK);

// Initial /api base — may be swapped at runtime when DR fail-over kicks
// in (see ./backend-health.ts). We never mutate axios.defaults.baseURL
// directly because individual calls (e.g. attachments / streamed
// downloads) build URLs from API_BASE eagerly. Instead we resolve the
// effective base via a request interceptor on every call.
export const API_BASE = `${BACKEND_URL.replace(/\/$/, '')}/api`;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
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
// (502/503/504/520-524) or a network error, we probe configured
// fallback URLs and retry the original request against the first one
// that responds healthy. The decision sticks for the rest of the
// session (no per-request re-probing) so latency stays sane.
//
// We tag requests with `__drRetried` to prevent infinite retry loops:
// if the fallback also fails, the original error propagates to the
// caller.
api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError & { config?: AxiosRequestConfig & { __drRetried?: boolean } }) => {
    const cfg = error.config;
    if (!cfg || cfg.__drRetried) return Promise.reject(error);
    if (!isDrClassError(error)) return Promise.reject(error);

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
