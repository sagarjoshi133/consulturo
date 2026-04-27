/**
 * Thin Sentry wrapper for the frontend.
 *
 * Today this is a no-op stub that only logs to console — because @sentry/
 * react-native requires a native module that isn't available in Expo Go.
 * When you ship via EAS Build, install @sentry/react-native and wire it
 * here — the rest of the app already calls reportError() / setUser()
 * through this module so no other changes will be needed.
 *
 * Setup for production (do at EAS time):
 *   1. npx expo install @sentry/react-native
 *   2. Add `@sentry/react-native/expo` to app.json plugins array.
 *   3. Set EXPO_PUBLIC_SENTRY_DSN in .env.
 *   4. Replace the body of initSentry() below with:
 *        import * as Sentry from '@sentry/react-native';
 *        Sentry.init({ dsn: DSN, tracesSampleRate: 0.1 });
 */

const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN || '').trim();

let ready = false;

export function initSentry() {
  if (ready) return;
  ready = true;
  if (!DSN) {
    // eslint-disable-next-line no-console
    console.log('[sentry] disabled — set EXPO_PUBLIC_SENTRY_DSN to enable');
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[sentry] configured (native SDK stub — wire @sentry/react-native when building via EAS).');
}

export function reportError(err: unknown, ctx?: Record<string, any>) {
  try {
    // eslint-disable-next-line no-console
    console.error('[error]', err, ctx || '');
  } catch {
    /* noop */
  }
}

// Alias kept for callsites that prefer the `capture*` naming convention.
export const captureError = reportError;

export function setSentryUser(user: { id?: string; email?: string } | null) {
  void user;
  // no-op in stub
}
