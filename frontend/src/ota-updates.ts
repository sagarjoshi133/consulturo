/**
 * Runtime helper for EAS Update — checks for a new published update
 * in the background and silently applies it.
 *
 * Why this exists:
 *   - We ship full native APKs via `eas build`, but 90 % of fixes are
 *     JS-only. Before installing expo-updates, every fix required a
 *     20-minute EAS build + manual sideload. With expo-updates +
 *     `eas update`, a fix goes live in ~2 minutes to every installed
 *     device.
 *
 *   - This module is intentionally defensive: on Expo Go / web, the
 *     updates module is unavailable, so we no-op silently.
 *
 * ─── 2026-06-04 hot-fix: "app falls back to homepage every 5-10s" ───
 * Previous version reloaded the JS bundle whenever
 * `Updates.checkForUpdateAsync()` reported an available update — and
 * re-checked on EVERY AppState 'active' transition. In production we
 * hit a runtime-version mismatch / rollback scenario where the same
 * update kept reporting as "available" forever, so:
 *
 *   cold start → check → "available" → reload → new cold start
 *   → check → still "available" → reload → ∞ loop
 *
 * The user perceived this as "every page I open, the app jumps back
 * to homepage after 5-10 seconds, no error, no banner". Spot on —
 * `Updates.reloadAsync()` IS a silent cold-restart that lands at "/".
 *
 * Three guards added below to break the loop:
 *   1. Persistent cooldown — after a successful reload we record the
 *      timestamp; the next check is skipped for OTA_COOLDOWN_MS.
 *   2. Same-manifest dedupe — if the "available" update's manifestId
 *      matches the bundle we just installed, never reload again.
 *   3. AppState re-check moved behind the same cooldown so a quick
 *      background-foreground bounce can't trigger a reload chain.
 */
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Persistent cooldown after a successful OTA reload. Set high enough
 *  that a misbehaving channel can't immediately re-trigger another
 *  reload before the user has had a chance to use the app. */
const OTA_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const KEY_LAST_OTA_RELOAD = '@consulturo/ota.last-reload-ts.v1';
const KEY_LAST_OTA_MANIFEST = '@consulturo/ota.last-manifest.v1';

/** True only in a standalone build that supports EAS Update. */
function canCheck(): boolean {
  // Expo Go (`Constants.appOwnership === 'expo'`) cannot fetch OTA.
  // Web also cannot — updates is a native module.
  if (Platform.OS === 'web') return false;
  if (Constants.appOwnership === 'expo') return false;
  // expo-updates is disabled in dev by default.
  if (__DEV__) return false;
  if (!Updates.isEnabled) return false;
  return true;
}

let checkInFlight = false;
let didCheckThisSession = false;

/** True if we successfully reloaded within OTA_COOLDOWN_MS — used to
 *  short-circuit any further checks in this session. */
async function isInCooldown(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_OTA_RELOAD);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < OTA_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** Extract a stable id for the manifest currently running (or about to
 *  be reloaded). Falls back to JSON.stringify for older Expo SDKs that
 *  don't expose `updateId`. */
function manifestIdOf(m: any): string {
  if (!m) return '';
  if (typeof m.id === 'string') return m.id;
  if (typeof m.updateId === 'string') return m.updateId;
  try {
    return String((m as any).manifest?.id || '');
  } catch {
    return '';
  }
}

async function runOnce(): Promise<void> {
  if (!canCheck() || checkInFlight) return;
  if (await isInCooldown()) return;
  checkInFlight = true;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return;

    // ── Same-manifest dedupe ─────────────────────────────────────
    // If the "available" manifest is the same one we already
    // installed (e.g. a rollback / runtime-version mismatch keeps
    // re-advertising the same payload), refuse to reload again.
    const incomingId = manifestIdOf((r as any).manifest);
    const lastApplied = (await AsyncStorage.getItem(KEY_LAST_OTA_MANIFEST)) || '';
    const currentId = (Updates as any).updateId || '';
    if (incomingId && (incomingId === lastApplied || incomingId === currentId)) {
      return;
    }

    await Updates.fetchUpdateAsync();
    try {
      await AsyncStorage.setItem(KEY_LAST_OTA_RELOAD, String(Date.now()));
      if (incomingId) {
        await AsyncStorage.setItem(KEY_LAST_OTA_MANIFEST, incomingId);
      }
    } catch {
      // Storage failure shouldn't block the update.
    }
    // ── 2026-06-11 fix: NO mid-session reload ───────────────────────
    // Previously we called Updates.reloadAsync() ~1.5 s after cold
    // start. To the user this looked like the app "crashing":
    // they'd open the app, navigate to Dashboard / Patients /
    // My Records, and the bundle would silently restart back to "/"
    // (with a splash-screen flash). The downloaded update is now
    // applied automatically on the NEXT cold launch instead —
    // standard expo-updates behaviour, zero session interruption.
  } catch {
    // Network issues, auth failures, rollback protection — all
    // treated as "no update right now". Never surfaces to user.
  } finally {
    checkInFlight = false;
  }
}

/** Call once from the root `_layout.tsx` after initial hydration. */
export function initOtaUpdates(): () => void {
  // Cold-start check — fire-and-forget. Guarded so background→foreground
  // bounces don't re-arm a fresh check while one is still in flight.
  if (!didCheckThisSession) {
    didCheckThisSession = true;
    runOnce();
  }

  // We deliberately DROPPED the per-AppState-active re-check that
  // the previous implementation had. It was the second half of the
  // reload-loop: every time the user dismissed the OS notification
  // shade or task switcher, AppState would flip back to 'active' and
  // re-arm runOnce → fetch → reload → cold-start → infinite loop.
  //
  // The cold-start check above is sufficient for the clinic-app's
  // usage pattern (users open the app fresh many times a day). Long
  // continuous sessions will still pick up the latest bundle the
  // next morning when the app is opened cold.
  //
  // Return a no-op disposer to keep the existing _layout.tsx API.
  return () => {};
}

/** Programmatic check — used by the "Check for updates" menu item.
 *  This BYPASSES the cooldown because the user explicitly asked
 *  for it (e.g. from the Settings → About screen). */
export async function checkForUpdateNow(): Promise<'updated' | 'latest' | 'unavailable' | 'error'> {
  if (!canCheck()) return 'unavailable';
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return 'latest';
    const incomingId = manifestIdOf((r as any).manifest);
    const currentId = (Updates as any).updateId || '';
    if (incomingId && incomingId === currentId) return 'latest';
    await Updates.fetchUpdateAsync();
    try {
      await AsyncStorage.setItem(KEY_LAST_OTA_RELOAD, String(Date.now()));
      if (incomingId) {
        await AsyncStorage.setItem(KEY_LAST_OTA_MANIFEST, incomingId);
      }
    } catch {}
    await Updates.reloadAsync();
    return 'updated';
  } catch {
    return 'error';
  }
}

/** Diagnostic helper for the Settings → About screen / support agent.
 *  Returns the timestamp of the last OTA reload + the manifest id we
 *  last applied. Both may be null on a fresh install. */
export async function getOtaDiagnostics(): Promise<{
  lastReloadAt: number | null;
  lastManifestId: string | null;
  currentManifestId: string;
  inCooldown: boolean;
  cooldownMs: number;
}> {
  let lastReloadAt: number | null = null;
  let lastManifestId: string | null = null;
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_OTA_RELOAD);
    if (raw) lastReloadAt = parseInt(raw, 10);
    lastManifestId = (await AsyncStorage.getItem(KEY_LAST_OTA_MANIFEST)) || null;
  } catch {}
  return {
    lastReloadAt,
    lastManifestId,
    currentManifestId: (Updates as any).updateId || '',
    inCooldown: await isInCooldown(),
    cooldownMs: OTA_COOLDOWN_MS,
  };
}

/** Reset the OTA cooldown — exposed for support / "force-update"
 *  diagnostic flows. Safe to no-op silently if AsyncStorage fails. */
export async function resetOtaCooldown(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_LAST_OTA_RELOAD);
    await AsyncStorage.removeItem(KEY_LAST_OTA_MANIFEST);
  } catch {}
}

// Keep `AppState` import alive even though we no longer use it — a
// future iteration may want to re-introduce a long-cooldown background
// check. Suppressing the unused-import lint without polluting the
// public API.
void AppState;
