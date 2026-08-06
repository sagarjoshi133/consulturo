/**
 * Sentry integration for ConsultUro.
 *
 * Uses @sentry/react-native. Safe to call from web and Expo Go —
 * the native module is loaded lazily so missing-native-binding
 * errors never crash the app during development.
 *
 * Activation checklist (one-time, user action):
 *   1. Create a free account at https://sentry.io
 *   2. Create a new project: platform "React Native", name "ConsultUro"
 *   3. Copy the DSN from Project Settings → Client Keys (DSN)
 *   4. Set EXPO_PUBLIC_SENTRY_DSN=<that DSN> in frontend/.env
 *   5. Rebuild or ship via `eas update` — Sentry auto-initialises
 *      on next cold start and captures all unhandled errors +
 *      promise rejections + React-Native JS crashes.
 *
 * Without a DSN, every function here is a cheap no-op. The
 * reportError() call sites are already everywhere in the codebase.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Lazy-require @sentry/react-native. On web this is still fine — the
// library provides a web build. On Expo Go the native module may be
// missing; wrapping in try/catch guarantees we never throw at import
// time.
let SentryModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SentryModule = require('@sentry/react-native');
} catch {
  SentryModule = null;
}

const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN || '').trim();

let ready = false;
let enabled = false;

function safeRelease(): string {
  const cfg: any = Constants.expoConfig || {};
  const version = cfg.version || '0.0.0';
  return `consulturo@${version}`;
}

export function initSentry() {
  if (ready) return;
  ready = true;

  if (!DSN) {
    // eslint-disable-next-line no-console
    console.log('[sentry] disabled — set EXPO_PUBLIC_SENTRY_DSN to enable');
    return;
  }
  if (!SentryModule || typeof SentryModule.init !== 'function') {
    // eslint-disable-next-line no-console
    console.log('[sentry] native module unavailable — skipping init');
    return;
  }

  try {
    SentryModule.init({
      dsn: DSN,
      // 10 % traces is a pragmatic default — enough to catch perf
      // regressions without blowing the free-tier quota.
      tracesSampleRate: 0.1,
      // Attach stack traces to `console.error` entries automatically
      attachStacktrace: true,
      // Drop events raised before initSentry() completes to avoid
      // noise from the React-Native launch sequence.
      enableAutoSessionTracking: true,
      // Useful release + environment tags.
      release: safeRelease(),
      environment: __DEV__ ? 'dev' : 'production',
      // Filter out completely expected / benign errors that would
      // otherwise pollute the dashboard.
      ignoreErrors: [
        // Network offline — handled by OfflineBanner
        'Network request failed',
        'AbortError',
      ],
    });
    enabled = true;
    // eslint-disable-next-line no-console
    console.log(`[sentry] active — release=${safeRelease()} platform=${Platform.OS}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] init failed:', e);
  }
}

export function reportError(err: unknown, ctx?: Record<string, any>) {
  try {
    // eslint-disable-next-line no-console
    console.error('[error]', err, ctx || '');
    if (enabled && SentryModule?.captureException) {
      if (ctx) {
        SentryModule.withScope((scope: any) => {
          try {
            Object.entries(ctx).forEach(([k, v]) => scope.setExtra(k, v));
          } catch { /* noop */ }
          SentryModule.captureException(err);
        });
      } else {
        SentryModule.captureException(err);
      }
    }
  } catch {
    /* never crash the caller because of Sentry */
  }
}

export const captureError = reportError;

export function setSentryUser(user: { id?: string; email?: string; user_id?: string; role?: string } | null) {
  if (!enabled || !SentryModule?.setUser) return;
  try {
    if (!user) {
      SentryModule.setUser(null);
      return;
    }
    SentryModule.setUser({
      id: user.user_id || user.id,
      email: user.email,
      segment: user.role,
    });
  } catch { /* noop */ }
}

export function addBreadcrumb(message: string, data?: Record<string, any>) {
  if (!enabled || !SentryModule?.addBreadcrumb) return;
  try {
    SentryModule.addBreadcrumb({
      message,
      level: 'info',
      data,
      timestamp: Date.now() / 1000,
    });
  } catch { /* noop */ }
}
