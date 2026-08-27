/**
 * Android fetch polyfill — Expo SDK 54 Hermes / New-Architecture fix.
 *
 * WHY THIS EXISTS
 * ---------------
 * Expo SDK 54 shipped a regression in the Hermes engine's networking
 * layer under the New Architecture on Android: `fetch()` (and anything
 * built on it) can HANG indefinitely / fail with "Network request
 * failed" in production/dev builds — while the same request works fine
 * from a browser, curl, or Expo Go. It reproduces on EVERY network
 * because it is a client-side engine bug, not a connectivity problem.
 *
 * Tracking issue: https://github.com/expo/expo/issues/40061
 *
 * THE FIX
 * -------
 * Replace the broken global `fetch` with an implementation backed by
 * `XMLHttpRequest`, which uses React Native's separate (working)
 * networking module and side-steps the Hermes fetch path entirely.
 * iOS + Web are untouched — they keep the native `fetch`.
 *
 * This must run BEFORE any code performs a network request (installed
 * from the app entry point, see /app/frontend/index.js).
 */
import { Platform } from 'react-native';

const originalFetch = globalThis.fetch;

function parseUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

function parseResponseHeaders(xhr: XMLHttpRequest): Headers {
  const headers = new Headers();
  const raw = xhr.getAllResponseHeaders() || '';
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) {
        try { headers.append(key, value); } catch { /* skip invalid header */ }
      }
    }
  }
  return headers;
}

function createResponse(xhr: XMLHttpRequest, url: string): Response {
  const bodyText: string = xhr.responseType === '' || xhr.responseType === 'text'
    ? (xhr.responseText ?? '')
    : '';
  const resp = {
    ok: xhr.status >= 200 && xhr.status < 300,
    status: xhr.status,
    statusText: xhr.statusText || '',
    headers: parseResponseHeaders(xhr),
    url,
    redirected: false,
    type: 'basic' as ResponseType,
    body: null,
    bodyUsed: false,
    async json() { return JSON.parse(bodyText || xhr.responseText || 'null'); },
    async text() { return bodyText || xhr.responseText || ''; },
    async blob() { return new Blob([xhr.response]); },
    async arrayBuffer() { return xhr.response; },
    async formData() { throw new Error('formData() not supported by fetch polyfill'); },
    async bytes() { return new Uint8Array(xhr.response); },
    clone() { return { ...this }; },
  } as unknown as Response;
  return resp;
}

function setRequestHeaders(xhr: XMLHttpRequest, headers: HeadersInit | undefined): void {
  if (!headers) return;
  const apply = (k: string, v: string) => { try { xhr.setRequestHeader(k, v); } catch { /* ignore */ } };
  if (headers instanceof Headers) {
    headers.forEach((value, key) => apply(key, value));
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) apply(key, String(value));
  } else {
    for (const [key, value] of Object.entries(headers)) apply(key, String(value));
  }
}

function sendRequest(xhr: XMLHttpRequest, body: BodyInit | undefined | null): void {
  if (body == null) { xhr.send(); return; }
  if (typeof body === 'string') { xhr.send(body); return; }
  if (body instanceof FormData) { xhr.send(body as any); return; }
  if (body instanceof URLSearchParams) { xhr.send(body.toString()); return; }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body as any)) { xhr.send(body as any); return; }
  if (body instanceof Blob) { xhr.send(body as any); return; }
  try { xhr.send(JSON.stringify(body)); } catch { xhr.send(String(body)); }
}

function xhrFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    const url = parseUrl(input);
    const method = (init?.method || 'GET').toUpperCase();
    const xhr = new XMLHttpRequest();

    // Honour an AbortSignal passed by the caller (axios/expo use this
    // to enforce timeouts) so aborted requests reject promptly.
    const signal = init?.signal as AbortSignal | undefined;
    const onAbort = () => { try { xhr.abort(); } catch { /* noop */ } };
    if (signal) {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };

    xhr.onload = () => { cleanup(); resolve(createResponse(xhr, url)); };
    xhr.onerror = () => { cleanup(); reject(new TypeError('Network request failed')); };
    xhr.ontimeout = () => { cleanup(); reject(new TypeError('Network request timed out')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };

    try {
      xhr.open(method, url, true);
      // Preserve response body as text unless a binary body is needed.
      setRequestHeaders(xhr, init?.headers);
      if (init?.credentials === 'include') xhr.withCredentials = true;
      sendRequest(xhr, init?.body ?? null);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Install the XHR-backed fetch on Android only. Safe no-op elsewhere. */
export function installFetchPolyfill(): void {
  if (Platform.OS !== 'android') return;
  try {
    (globalThis as any).fetch = xhrFetch as typeof fetch;
    console.log('[fetch-polyfill] XMLHttpRequest-based fetch installed (Android SDK 54 fix)');
  } catch (e) {
    console.warn('[fetch-polyfill] failed to install, keeping native fetch', e);
  }
}

/** Restore the native fetch (debugging/testing only). */
export function restoreOriginalFetch(): void {
  if (Platform.OS === 'android' && originalFetch) {
    (globalThis as any).fetch = originalFetch;
  }
}
