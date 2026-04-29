import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// CRITICAL: hardcoded production fallback so APK builds NEVER end up
// pointing at localhost when EAS env vars are misconfigured. The first
// candidate to be non-empty wins.
// This is the always-on Emergent deployment URL (full-stack: API +
// MongoDB). The preview URL was retired in v1.0.9 — it auto-sleeps and
// caused 502 / Network Errors on Google Sign-In, prescription PDF,
// share, etc. for installed APK users.
const PROD_FALLBACK = 'https://urology-pro.emergent.host';
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

export default api;
