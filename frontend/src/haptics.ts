// Thin wrapper around expo-haptics that silently no-ops on web and
// gracefully handles environments where the native module isn't available
// (e.g. Expo Go on certain platforms, simulators without haptic HW, etc.).
//
// Usage:
//   import { haptics } from '@/src/haptics';
//   haptics.tap();            // tiny tap on button / tab press
//   haptics.select();         // lighter, for selections (date / slot / chip)
//   haptics.success();        // after confirm / save
//   haptics.warning();        // soft warning feedback
//   haptics.error();          // hard error feedback

import { Platform } from 'react-native';

type AnyFn = (...args: any[]) => any;
let H: any = null;
try {
  // Lazy require so the web bundle doesn't blow up if module is missing
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  H = require('expo-haptics');
} catch {
  H = null;
}

const isWeb = Platform.OS === 'web';

function safe(fn?: AnyFn, ...args: any[]) {
  if (isWeb || !fn) return;
  try {
    fn(...args);
  } catch {
    // ignore — haptics are best-effort
  }
}

export const haptics = {
  // Light tap — buttons, tabs, generic press
  tap: () => {
    if (!H) return;
    safe(H.impactAsync, H.ImpactFeedbackStyle?.Light);
  },
  // Medium — primary actions like confirm, submit
  medium: () => {
    if (!H) return;
    safe(H.impactAsync, H.ImpactFeedbackStyle?.Medium);
  },
  // Selection tick — date picker, slot chip, toggle
  select: () => {
    if (!H) return;
    safe(H.selectionAsync);
  },
  // Success — after booking confirmed, prescription saved, etc.
  success: () => {
    if (!H) return;
    safe(H.notificationAsync, H.NotificationFeedbackType?.Success);
  },
  warning: () => {
    if (!H) return;
    safe(H.notificationAsync, H.NotificationFeedbackType?.Warning);
  },
  error: () => {
    if (!H) return;
    safe(H.notificationAsync, H.NotificationFeedbackType?.Error);
  },
};

export default haptics;
