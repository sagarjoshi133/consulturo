/**
 * haptics — Wave 2 · J
 *
 * Centralised, fail-safe wrapper around `expo-haptics`. On web /
 * unsupported platforms, every method is a silent no-op. Use these
 * for tiny tactile feedback on key actions:
 *
 *   import { haptics } from '@/haptics';
 *
 *   haptics.tap();        // selection / button press
 *   haptics.success();    // form save, payment confirmed
 *   haptics.warning();    // soft warning, confirm dialog open
 *   haptics.error();      // failed action
 *   haptics.heavy();      // delete / irreversible op
 *
 * The wrapper is intentionally synchronous and swallows all errors
 * so callsites can use it without try/catch in render paths.
 */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function safe(fn: () => Promise<unknown> | unknown) {
  if (Platform.OS === 'web') return;
  try { void Promise.resolve(fn()).catch(() => {}); } catch {}
}

export const haptics = {
  /** Soft selection — button taps, segment switch. */
  tap: () => safe(() => Haptics.selectionAsync()),
  /** Alias of `tap` — kept for back-compat with callers that
   *  read more naturally as `haptics.select()` (segment / chip pick). */
  select: () => safe(() => Haptics.selectionAsync()),
  /** Light impact — confirm a small action. */
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Medium impact — toggle, important select. */
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Heavy impact — destructive / irreversible action. */
  heavy: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  /** Success notification. */
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Warning notification. */
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Error notification. */
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

export default haptics;
