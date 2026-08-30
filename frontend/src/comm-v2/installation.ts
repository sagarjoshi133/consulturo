/**
 * Communications V2 device installation registration.
 *
 * One "installation" is a per-device UUID (persistent in SecureStore)
 * that outlives FCM token rotations. The backend stores it in
 * `comm_installations`.
 *
 * Contract with the spec:
 *   - Uses `getDevicePushTokenAsync()` (native FCM/APNs token),
 *     NEVER `getExpoPushTokenAsync()`.
 *   - Creates Android channels BEFORE requesting permission (done in
 *     app/_layout.tsx at module scope).
 *   - Re-registers on token rotation via `addPushTokenListener`.
 *   - Revokes the account↔installation binding on logout.
 *   - Never returns `registered: true` when the provider is
 *     unconfigured or the backend didn't store the token — the API
 *     returns { stored, provider_configured, provider_verified }
 *     independently and we surface each.
 *
 * All entry points are safe to call on web (short-circuit to
 * `{ ok: false, reason: 'web_unsupported' }` — the app doesn't rely
 * on push on web).
 */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Localization from 'expo-localization';
import { Platform } from 'react-native';
import api from '../api';

const INSTALLATION_KEY = 'consulturo_installation_id_v2';
const LAST_TOKEN_KEY = 'consulturo_last_fcm_token_v2';

// --- Persistent registration cooldown ------------------------------------
// registerV2Installation() is called from several places (app boot, login,
// and the FCM token-rotation listener). If any of those fire in a tight
// loop the app can hammer /v2/communications/installations/register
// thousands of times, tripping Cloudflare's rate limiter (HTTP 429) and
// making the whole app appear slow/broken. To prevent that, we persist the
// last-attempt timestamp (survives app kill/relaunch) and skip the call
// entirely if we attempted too recently. On repeated failures the cooldown
// grows exponentially up to a cap instead of retrying on a fixed schedule.
const LAST_ATTEMPT_KEY = 'consulturo_reg_last_attempt_v2';
const FAIL_COUNT_KEY = 'consulturo_reg_fail_count_v2';
const BASE_COOLDOWN_MS = 5 * 60 * 1000; // normal: 5 min between attempts
const MAX_COOLDOWN_MS = 60 * 60 * 1000; // cap the failure backoff at 60 min

/** Cooldown window for the given consecutive-failure count.
 *  0 failures → base (5m); then 10m → 20m → 40m → 60m (capped). */
function _cooldownFor(failCount: number): number {
  if (failCount <= 0) return BASE_COOLDOWN_MS;
  return Math.min(BASE_COOLDOWN_MS * Math.pow(2, failCount), MAX_COOLDOWN_MS);
}

async function _getStoredNum(key: string): Promise<number> {
  try {
    const v = await SecureStore.getItemAsync(key);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function _setStoredNum(key: string, val: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, String(val));
  } catch {}
}

export type RegistrationResult = {
  ok: boolean;
  installation_id?: string;
  token_preview?: string | null;
  stored?: boolean;
  provider_configured?: boolean;
  provider_verified?: boolean;
  provider_error_code?: string | null;
  provider_init_error?: string | null;
  permission_status?: string;
  reason?: string;
  error?: string;
};

/** Persistent per-device UUID — kept in SecureStore so a data-wipe of the
 *  app resets it (which is what we want; a new "installation" is born). */
export async function getOrCreateInstallationId(): Promise<string> {
  try {
    let id = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (id && id.length >= 16) return id;
    // Prefer OS install ID on Android where available (stable across
    // token rotations but not across app reinstalls).
    let seed: string | null = null;
    try {
      seed = (Application as any).getAndroidId?.() || Application.applicationId || null;
    } catch {}
    id = `${(seed || 'inst').slice(0, 32)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await SecureStore.setItemAsync(INSTALLATION_KEY, id);
    return id;
  } catch {
    // SecureStore unavailable (web, some devices) — fall back to a
    // deterministic per-session UUID.
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function _permissionSnapshot(): Promise<{ granted: boolean; status: string; canAskAgain: boolean }> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return {
      granted: p.status === 'granted',
      status: p.status || 'unknown',
      canAskAgain: p.canAskAgain !== false,
    };
  } catch {
    return { granted: false, status: 'error', canAskAgain: true };
  }
}

/**
 * Full registration flow:
 *   1. Snapshot permission status.
 *   2. If not granted, request it once.
 *   3. Get native token via getDevicePushTokenAsync().
 *   4. POST to /api/v2/communications/installations/register.
 *   5. Cache last token so we can detect rotations on next boot.
 */
export async function registerV2Installation(): Promise<RegistrationResult> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web_unsupported' };
  }

  // 0: persistent cooldown guard — BEFORE any work. Every caller (boot,
  // login, token-rotation listener) is covered automatically, so a tight
  // loop can never flood the backend / trip Cloudflare's rate limiter.
  const nowTs = Date.now();
  const lastAttempt = await _getStoredNum(LAST_ATTEMPT_KEY);
  const failCount = await _getStoredNum(FAIL_COUNT_KEY);
  const cooldown = _cooldownFor(failCount);
  if (lastAttempt > 0 && nowTs - lastAttempt < cooldown) {
    return { ok: false, reason: 'cooldown' };
  }

  // 1 & 2: permission
  const before = await _permissionSnapshot();
  let permStatus = before.status;
  let granted = before.granted;
  if (!granted && before.canAskAgain) {
    try {
      const req = await Notifications.requestPermissionsAsync();
      permStatus = req.status || permStatus;
      granted = req.status === 'granted';
    } catch (e) {
      return { ok: false, reason: 'permission_request_failed', permission_status: permStatus, error: String(e) };
    }
  }
  if (!granted) {
    return { ok: false, reason: 'permission_denied', permission_status: permStatus };
  }

  // 3: native token — NEVER Expo push token per Comm V2 spec
  let deviceToken: string;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    deviceToken = (t as any)?.data || '';
    if (!deviceToken) throw new Error('empty_token');
  } catch (e) {
    return { ok: false, reason: 'token_fetch_failed', error: String(e), permission_status: permStatus };
  }

  const installationId = await getOrCreateInstallationId();
  const provider = Platform.OS === 'ios' ? 'apns' : 'fcm';

  // 4: register with backend
  // Stamp the attempt timestamp BEFORE the network call (not after) so that
  // even if the app crashes mid-request the cooldown still takes effect on
  // the next launch and we don't re-flood the endpoint.
  await _setStoredNum(LAST_ATTEMPT_KEY, Date.now());
  let resp: any;
  try {
    const r = await api.post('/v2/communications/installations/register', {
      installation_id: installationId,
      provider,
      platform: Platform.OS,
      device_token: deviceToken,
      permission_status: permStatus,
      app_version: Application.nativeApplicationVersion || undefined,
      build_number: Application.nativeBuildVersion || undefined,
      runtime_version: (Application as any).runtimeVersion || undefined,
      device_model: (Device.modelName || Device.deviceName || undefined) as any,
      locale: (Localization.getLocales?.()?.[0]?.languageTag) || undefined,
      timezone: (Localization.getCalendars?.()?.[0]?.timeZone) || undefined,
    });
    resp = r.data;
  } catch (e: any) {
    // Failure → grow the cooldown for the next attempt (exponential backoff).
    await _setStoredNum(FAIL_COUNT_KEY, failCount + 1);
    return {
      ok: false,
      reason: 'backend_register_failed',
      error: e?.response?.data?.detail || e?.message || String(e),
      permission_status: permStatus,
    };
  }

  // Success reaching the backend → reset the failure backoff to base.
  await _setStoredNum(FAIL_COUNT_KEY, 0);

  // 5: cache token for rotation detection
  try { await SecureStore.setItemAsync(LAST_TOKEN_KEY, deviceToken); } catch {}

  // "ok" is true only when EVERY link in the chain worked — the spec
  // forbids reporting registered:true if the provider isn't verified.
  const provOK = Boolean(resp?.provider_configured) && Boolean(resp?.provider_verified);
  return {
    ok: Boolean(resp?.stored) && provOK,
    installation_id: installationId,
    token_preview: resp?.token_preview || null,
    stored: Boolean(resp?.stored),
    provider_configured: Boolean(resp?.provider_configured),
    provider_verified: Boolean(resp?.provider_verified),
    provider_error_code: resp?.provider_error_code || null,
    provider_init_error: resp?.provider_init_error || null,
    permission_status: permStatus,
  };
}

/** Called on logout — revoke the account↔installation binding
 *  server-side. Retains the installation row (for token diagnostics)
 *  but sets status=revoked and clears user_id. */
export async function revokeV2Installation(): Promise<{ ok: boolean }> {
  if (Platform.OS === 'web') return { ok: true };
  try {
    const id = await SecureStore.getItemAsync(INSTALLATION_KEY);
    if (!id) return { ok: true };
    await api.post('/v2/communications/installations/revoke', { installation_id: id });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** Attach an `addPushTokenListener` to auto-re-register when FCM
 *  rotates the token. Returns the subscription so the caller can
 *  remove it on unmount / logout. */
export function attachV2TokenRotationListener(): { remove: () => void } | null {
  if (Platform.OS === 'web') return null;
  try {
    const sub = Notifications.addPushTokenListener(async (_tok) => {
      try { await registerV2Installation(); } catch {}
    });
    return sub;
  } catch {
    return null;
  }
}
