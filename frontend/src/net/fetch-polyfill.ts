/**
 * Android networking fix for Expo SDK 54 (Hermes / New Architecture).
 *
 * ROOT CAUSE — https://github.com/expo/expo/issues/40061
 * ------------------------------------------------------
 * On Android under SDK 54, React Native's default networking stack —
 * used by BOTH the global `fetch` AND `XMLHttpRequest` (i.e. axios) —
 * is extremely slow / intermittently fails. Requests can take minutes
 * or appear to hang while the very same endpoint answers instantly
 * from a browser / curl. iOS and Web are unaffected.
 *
 * The community- and maintainer-confirmed fix is to route requests
 * through `expo/fetch` — Expo's own native networking implementation —
 * which bypasses the broken Hermes/OkHttp path entirely and is fast.
 *
 * WHY THE OLD XHR POLYFILL DID NOT WORK
 * -------------------------------------
 * A previous attempt swapped global `fetch` for an XMLHttpRequest-based
 * shim. But (a) axios on React Native already uses XHR directly, so the
 * shim never touched it, and (b) XHR is affected by the SAME bug — so
 * the app stayed slow. `expo/fetch` is the actual fix.
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 * 1. Replaces the global `fetch` on Android with a wrapper that sends
 *    http(s) requests via `expo/fetch` (fast) while leaving local
 *    resources (file://, data:, blob:, and Request objects) on the
 *    native fetch — `expo/fetch` only accepts a network string URL.
 * 2. Re-exports `expoFetch` so the axios instance can use it as its
 *    transport (see src/api.ts). Swapping global fetch alone does NOT
 *    fix axios because axios uses XHR by default.
 */
import { Platform } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';

export { expoFetch };

const nativeFetch: typeof fetch = globalThis.fetch;

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Hybrid fetch: expo/fetch for network http(s), native fetch for everything else. */
function hybridFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string' || input instanceof URL) {
    const url = typeof input === 'string' ? input : input.href;
    if (isHttpUrl(url)) {
      return expoFetch(url, init as any) as unknown as Promise<Response>;
    }
  }
  // Request objects + file:// / data: / blob: URIs → keep native fetch.
  return nativeFetch(input as any, init);
}

/** Install the expo/fetch-backed global fetch on Android only. No-op elsewhere. */
export function installFetchPolyfill(): void {
  if (Platform.OS !== 'android') return;
  try {
    (globalThis as any).fetch = hybridFetch;
    console.log('[fetch-polyfill] expo/fetch installed for Android (SDK 54 network fix)');
  } catch (e) {
    console.warn('[fetch-polyfill] failed to install expo/fetch, keeping native fetch', e);
  }
}
