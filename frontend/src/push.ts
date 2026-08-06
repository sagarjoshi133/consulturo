/**
 * Expo Push helper — aligns with the Emergent Push playbook (June 2026).
 *
 * Key differences from the previous (broken) implementation:
 *   • Uses `getDevicePushTokenAsync()` — the NATIVE FCM/APNs token
 *     — instead of `getExpoPushTokenAsync`. This is REQUIRED for
 *     production APKs/IPAs because the Emergent push relay
 *     (SuprSend) sends FCM/APNs payloads directly.
 *   • POSTs to `/api/register-push` (the canonical Emergent
 *     endpoint), forwarding `{user_id, platform, device_token}`.
 *   • The legacy `/api/push/register` endpoint (Expo-token based)
 *     is no longer called.
 *   • Foreground display + Android channel setup live at module
 *     scope in `app/_layout.tsx` per the playbook — this file
 *     focuses ONLY on permission / token / register flow.
 *
 * On web: hard no-op. expo-notifications APIs throw on web.
 */
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import api from './api';
import { captureError } from './sentry';

export type PushDiagnosticReason =
  | 'web_unsupported'
  | 'simulator'
  | 'permission_denied'
  | 'token_fetch_failed'
  | 'api_register_failed'
  | 'success';

export type PushState = {
  token: string | null;
  reason: PushDiagnosticReason;
  platform: string | null;
  at: number;
  error?: string;
};

let lastRegisteredToken: string | null = null;
let lastState: PushState = {
  token: null,
  reason: 'web_unsupported',
  platform: null,
  at: 0,
};
let appStateListenerAttached = false;

function pushLog(tag: string, detail?: unknown) {
  try {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[push] ${tag}`, detail ?? '');
    }
  } catch {}
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function getPushState(): PushState {
  return { ...lastState };
}

function setState(s: PushState) {
  lastState = s;
  pushLog('state', s);
}

/**
 * Native FCM/APNs token — the Emergent push relay's required token
 * format. Falls back through 3 attempts on transient errors.
 */
async function fetchNativeTokenWithRetry(): Promise<string> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await Notifications.getDevicePushTokenAsync();
      if (res && typeof res.data === 'string' && res.data.length > 0) {
        return res.data;
      }
      lastErr = new Error('Empty native token response');
    } catch (e: any) {
      lastErr = e;
    }
    await sleep(600 * Math.pow(2, attempt));
  }
  throw lastErr || new Error('getDevicePushTokenAsync failed');
}

/**
 * Ask permission + fetch native device token + register with backend.
 * Safe to call on every app open — backend upserts idempotently.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') {
    setState({ token: null, reason: 'web_unsupported', platform: 'web', at: Date.now() });
    return null;
  }
  if (!Device.isDevice) {
    setState({ token: null, reason: 'simulator', platform: Platform.OS, at: Date.now() });
    return null;
  }

  attachAppStateListener();

  try {
    // 1. Permission flow
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      pushLog('requesting-permission');
      const req = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = req.status;
    }
    if (status !== 'granted') {
      setState({ token: null, reason: 'permission_denied', platform: Platform.OS, at: Date.now() });
      return null;
    }

    // 2. Native token fetch (with retry)
    let token: string;
    try {
      token = await fetchNativeTokenWithRetry();
    } catch (e: any) {
      setState({
        token: null,
        reason: 'token_fetch_failed',
        platform: Platform.OS,
        at: Date.now(),
        error: e?.message || String(e),
      });
      captureError(e, { scope: 'push-registration', step: 'getDevicePushTokenAsync' });
      return null;
    }
    if (!token) {
      setState({ token: null, reason: 'token_fetch_failed', platform: Platform.OS, at: Date.now() });
      return null;
    }

    // 3. POST to backend (the relay endpoint). The backend uses the
    //    authenticated user_id from session — we don't need to send it.
    let postErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.post('/register-push', {
          platform: Platform.OS,
          device_token: token,
        });
        postErr = null;
        break;
      } catch (e: any) {
        postErr = e;
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    if (postErr) {
      setState({
        token,
        reason: 'api_register_failed',
        platform: Platform.OS,
        at: Date.now(),
        error: postErr?.message || String(postErr),
      });
      captureError(postErr, { scope: 'push-registration', step: '/register-push' });
      return null;
    }

    lastRegisteredToken = token;
    setState({ token, reason: 'success', platform: Platform.OS, at: Date.now() });
    return token;
  } catch (e: any) {
    setState({
      token: null,
      reason: 'token_fetch_failed',
      platform: Platform.OS,
      at: Date.now(),
      error: e?.message || String(e),
    });
    captureError(e, { scope: 'push-registration', step: 'outer' });
    return null;
  }
}

/**
 * Subscribe to taps on push notifications (warm + cold-start).
 * Returns an unsubscribe function. Caller is responsible for invoking
 * it on unmount.
 */
export function attachNotificationListeners(
  onTap: (data: Record<string, any>) => void,
): () => void {
  if (Platform.OS === 'web') {
    return () => {};
  }
  // Warm tap — user taps while the app is open or backgrounded.
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    try {
      onTap(resp.notification?.request?.content?.data || {});
    } catch {}
  });
  // Cold-start tap — user tapped while the app was killed.
  // We fire the same `onTap` so deep-link routing is unified.
  Notifications.getLastNotificationResponseAsync()
    .then((resp) => {
      if (!resp) return;
      try {
        onTap(resp.notification?.request?.content?.data || {});
      } catch {}
    })
    .catch(() => {});
  return () => sub.remove();
}

function attachAppStateListener() {
  if (appStateListenerAttached) return;
  appStateListenerAttached = true;
  const handler = (next: AppStateStatus) => {
    if (next === 'active') {
      registerForPushNotifications().catch((e) => pushLog('resume-register-failed', e));
    }
  };
  try {
    AppState.addEventListener('change', handler);
  } catch (e) {
    pushLog('appstate-attach-failed', e);
  }
}
