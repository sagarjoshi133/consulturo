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
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  | 'relay_not_configured'
  | 'relay_upstream_error'
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

// ── Installation id (Phase A) ────────────────────────────────────────
// A stable per-install UUID sent with every token registration so the
// backend can dedupe rows when the FCM token rotates for this install.
const INSTALL_ID_KEY = 'consulturo_installation_id';
let cachedInstallationId: string | null = null;

async function getInstallationId(): Promise<string> {
  if (cachedInstallationId) return cachedInstallationId;
  try {
    let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(INSTALL_ID_KEY, id);
    }
    cachedInstallationId = id;
  } catch {
    // Storage unavailable — fall back to a session-scoped id.
    cachedInstallationId = `inst_mem_${Math.random().toString(36).slice(2, 12)}`;
  }
  return cachedInstallationId;
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
    //    Phase A: the backend now returns TYPED non-2xx errors —
    //      503 relay_not_configured  (preview env; token mirrored, deterministic — no retry)
    //      502 relay_unauthorized / relay_upstream_error (transient — retried)
    const installationId = await getInstallationId();
    let postErr: any = null;
    let typedCode: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.post('/register-push', {
          platform: Platform.OS,
          device_token: token,
          installation_id: installationId,
        });
        postErr = null;
        typedCode = null;
        break;
      } catch (e: any) {
        postErr = e;
        const detail = e?.response?.data?.detail;
        typedCode =
          (detail && typeof detail === 'object' && detail.error_code) || null;
        if (typedCode === 'relay_not_configured') break; // deterministic — retrying won't help
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    if (postErr) {
      const reason: PushDiagnosticReason =
        typedCode === 'relay_not_configured'
          ? 'relay_not_configured'
          : typedCode
          ? 'relay_upstream_error'
          : 'api_register_failed';
      const detail = postErr?.response?.data?.detail;
      setState({
        token,
        reason,
        platform: Platform.OS,
        at: Date.now(),
        error:
          (detail && typeof detail === 'object' && detail.message) ||
          postErr?.message ||
          String(postErr),
      });
      // relay_not_configured is expected in preview — don't spam Sentry.
      if (reason !== 'relay_not_configured') {
        captureError(postErr, { scope: 'push-registration', step: '/register-push', code: typedCode || 'none' });
      }
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
