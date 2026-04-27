/**
 * Expo Push helper — registers device token with the backend after login.
 *
 * STAGE-1 HARDENED EDITION:
 *   • Verbose, classified error logging (Sentry + console) — no more
 *     silent nulls.
 *   • Multi-fallback projectId resolution: explicit arg → expoConfig →
 *     easConfig → Constants root → manifest.extra.
 *   • Retry with exponential backoff on transient failures (permission
 *     popup race, offline blip, Expo service 5xx).
 *   • Re-register automatically on app resume (AppState listener) so
 *     token rotation / reinstall / OS upgrades don't leave stale state.
 *   • Safe no-op on web + graceful warning surfaced for diagnostics.
 */
import { Platform, AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import api from './api';
import { captureError } from './sentry';

// -------- types --------
export type PushDiagnosticReason =
  | 'web_unsupported'
  | 'simulator'
  | 'permission_denied'
  | 'missing_project_id'
  | 'token_fetch_failed'
  | 'api_register_failed'
  | 'already_registered'
  | 'success';

export type PushState = {
  token: string | null;
  reason: PushDiagnosticReason;
  projectId: string | null;
  at: number; // epoch ms
  error?: string;
};

let lastRegisteredToken: string | null = null;
let lastState: PushState = {
  token: null,
  reason: 'web_unsupported',
  projectId: null,
  at: 0,
};
let appStateListenerAttached = false;

// Dev-visible logger — NEVER throws
function pushLog(tag: string, detail?: unknown) {
  try {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(`[push] ${tag}`, detail ?? '');
    }
  } catch {
    // swallow
  }
}

// -------- Foreground handler (unchanged) --------
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
  }),
});

export async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0E7C8B',
    });
  } catch (e) {
    pushLog('android-channel-failed', e);
  }
}

/**
 * Resolve the EAS projectId from ALL known locations. Returns null only
 * when truly absent so we can surface a loud warning.
 */
function resolveProjectId(): string | null {
  try {
    const fromExpoConfigExtra =
      (Constants.expoConfig as any)?.extra?.eas?.projectId;
    const fromExpoConfig = (Constants.expoConfig as any)?.projectId;
    const fromEasConfig = (Constants as any)?.easConfig?.projectId;
    const fromManifestExtra =
      (Constants as any)?.manifest?.extra?.eas?.projectId ||
      (Constants as any)?.manifest2?.extra?.eas?.projectId;
    const fromExtra = (Constants.expoConfig as any)?.extra?.projectId;
    const id =
      fromExpoConfigExtra ||
      fromExpoConfig ||
      fromEasConfig ||
      fromManifestExtra ||
      fromExtra ||
      null;
    return id && typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function fetchTokenWithRetry(projectId: string | null) {
  // 3 attempts, exponential backoff — handles transient Expo 5xx / net blips
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      if (res?.data) return res.data;
      lastErr = new Error('Empty token response');
    } catch (e: any) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, attempt)); // 500, 1000, 2000
  }
  throw lastErr || new Error('getExpoPushTokenAsync failed');
}

/** Read-only access to the last registration outcome — useful for UI health chips. */
export function getPushState(): PushState {
  return { ...lastState };
}

function setState(s: PushState) {
  lastState = s;
  pushLog('state', s);
}

/** Ask permission + fetch Expo Push Token + send to backend. Returns the token or null. */
export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') {
    setState({
      token: null,
      reason: 'web_unsupported',
      projectId: null,
      at: Date.now(),
    });
    return null;
  }
  if (!Device.isDevice) {
    setState({ token: null, reason: 'simulator', projectId: null, at: Date.now() });
    return null;
  }

  attachAppStateListener();

  try {
    await ensureAndroidChannel();

    // ---- permission flow ----
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      pushLog('requesting-permission');
      const req = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      status = req.status;
    }
    if (status !== 'granted') {
      setState({
        token: null,
        reason: 'permission_denied',
        projectId: null,
        at: Date.now(),
      });
      captureError(new Error('Push permission denied'), {
        scope: 'push-registration',
      });
      return null;
    }

    // ---- projectId resolution ----
    const projectId = resolveProjectId();
    if (!projectId) {
      setState({
        token: null,
        reason: 'missing_project_id',
        projectId: null,
        at: Date.now(),
      });
      captureError(new Error('Missing EAS projectId'), {
        scope: 'push-registration',
        hint:
          'Set expo.extra.eas.projectId in app.json (and rebuild). Without it, ' +
          'Expo push tokens cannot be issued on SDK 49+.',
      });
      return null;
    }

    // ---- token fetch (with retry) ----
    let token: string;
    try {
      token = await fetchTokenWithRetry(projectId);
    } catch (e: any) {
      setState({
        token: null,
        reason: 'token_fetch_failed',
        projectId,
        at: Date.now(),
        error: e?.message || String(e),
      });
      captureError(e, { scope: 'push-registration', step: 'getExpoPushTokenAsync' });
      return null;
    }

    if (!token) {
      setState({
        token: null,
        reason: 'token_fetch_failed',
        projectId,
        at: Date.now(),
      });
      return null;
    }

    // ---- short-circuit if already registered with the same token ----
    if (token === lastRegisteredToken) {
      setState({
        token,
        reason: 'already_registered',
        projectId,
        at: Date.now(),
      });
      return token;
    }

    // ---- POST to backend (with retry) ----
    let postErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await api.post('/push/register', {
          token,
          platform: Platform.OS,
          device_name: Device.deviceName || undefined,
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
        projectId,
        at: Date.now(),
        error: postErr?.message || String(postErr),
      });
      captureError(postErr, { scope: 'push-registration', step: '/push/register' });
      return null;
    }

    lastRegisteredToken = token;
    setState({ token, reason: 'success', projectId, at: Date.now() });
    return token;
  } catch (e: any) {
    // Last-resort catch — should be unreachable now but keeps the app alive
    setState({
      token: null,
      reason: 'token_fetch_failed',
      projectId: resolveProjectId(),
      at: Date.now(),
      error: e?.message || String(e),
    });
    captureError(e, { scope: 'push-registration', step: 'outer' });
    return null;
  }
}

/** Subscribe to taps on notifications — navigates deep-links based on payload. */
export function attachNotificationListeners(
  onTap: (data: Record<string, any>) => void
) {
  const sub1 = Notifications.addNotificationResponseReceivedListener((resp) => {
    try {
      onTap(resp.notification?.request?.content?.data || {});
    } catch {}
  });
  return () => sub1.remove();
}

// -------- Re-register on app resume --------
function attachAppStateListener() {
  if (appStateListenerAttached) return;
  appStateListenerAttached = true;
  const handler = (next: AppStateStatus) => {
    if (next === 'active') {
      // Fire-and-forget. If token is unchanged, register() short-circuits.
      registerForPushNotifications().catch((e) =>
        pushLog('resume-register-failed', e)
      );
    }
  };
  try {
    AppState.addEventListener('change', handler);
  } catch (e) {
    pushLog('appstate-attach-failed', e);
  }
}
