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
 *     updates module is unavailable, so we no-op silently. In
 *     production APKs it runs once on app start + again whenever the
 *     app returns from background.
 */
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

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

async function runOnce(): Promise<void> {
  if (!canCheck() || checkInFlight) return;
  checkInFlight = true;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (r.isAvailable) {
      await Updates.fetchUpdateAsync();
      // Reload silently — next tick so any in-flight renders finish.
      setTimeout(() => {
        Updates.reloadAsync().catch(() => {});
      }, 1500);
    }
  } catch {
    // Network issues, auth failures, rollback protection — all
    // treated as "no update right now". Never surfaces to user.
  } finally {
    checkInFlight = false;
  }
}

/** Call once from the root `_layout.tsx` after initial hydration. */
export function initOtaUpdates(): () => void {
  // Fire-and-forget initial check.
  runOnce();

  // Re-check when the app returns from background. Keeps long-running
  // sessions current without forcing a cold restart.
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') runOnce();
  });
  return () => sub.remove();
}

/** Programmatic check — used by the "Check for updates" menu item. */
export async function checkForUpdateNow(): Promise<'updated' | 'latest' | 'unavailable' | 'error'> {
  if (!canCheck()) return 'unavailable';
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return 'latest';
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return 'updated';
  } catch {
    return 'error';
  }
}
