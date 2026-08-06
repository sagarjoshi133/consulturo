/**
 * useUnsavedFormGuard — Wave 2 · I
 *
 * Prevents accidental loss of half-typed form data. When `dirty` is true:
 *   • Native (iOS/Android): intercepts router back swipes & hardware
 *     back button — shows a confirm dialog.
 *   • Web: hooks `beforeunload` to show the browser's "Leave this page?"
 *     dialog when the user closes the tab or hits the browser back button.
 *
 * Usage:
 *   const dirty = wasFormEdited;
 *   useUnsavedFormGuard(dirty, { message: 'Discard this Rx?' });
 *
 *   // To explicitly bypass after Save Success:
 *   const guard = useUnsavedFormGuard(dirty);
 *   await save();
 *   guard.bypass(() => router.back());
 */
import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { confirmAction } from './cross-alert';

type Opts = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
};

export function useUnsavedFormGuard(
  dirty: boolean,
  opts: Opts = {},
): { bypass: (then?: () => void) => void } {
  const {
    title = 'Discard changes?',
    message = 'You have unsaved changes. Leaving will discard them.',
    confirmText = 'Discard',
    cancelText = 'Stay',
  } = opts;

  // Allow callers to skip the next guard check (e.g. just after a
  // successful save).
  const bypassRef = useRef(false);
  const navigation = useNavigation();

  // 1) Native hardware-back interceptor.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!dirty || bypassRef.current) {
          bypassRef.current = false;
          return false; // let default back happen
        }
        confirmAction({
          title, message, confirmText, cancelText,
          destructive: true,
          onConfirm: () => {
            bypassRef.current = true;
            try { (navigation as any).goBack?.(); } catch { /* noop */ }
          },
        });
        return true; // block default back
      });
      return () => sub.remove();
    }, [dirty, title, message, confirmText, cancelText, navigation]),
  );

  // 2) Expo-Router navigation listener — covers in-app back swipes &
  //    programmatic navigation while still mounted.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const unsub = (navigation as any).addListener?.('beforeRemove', (e: any) => {
      if (!dirty || bypassRef.current) {
        bypassRef.current = false;
        return;
      }
      e.preventDefault();
      confirmAction({
        title, message, confirmText, cancelText,
        destructive: true,
        onConfirm: () => {
          bypassRef.current = true;
          try { (navigation as any).dispatch?.(e.data.action); } catch { /* noop */ }
        },
      });
    });
    return unsub;
  }, [dirty, navigation, title, message, confirmText, cancelText]);

  // 3) Web: browser unload (close tab / hit browser back).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    const handler = (ev: BeforeUnloadEvent) => {
      if (!dirty || bypassRef.current) return;
      ev.preventDefault();
      // Most browsers ignore the custom message; the dialog text is
      // browser-controlled. Setting returnValue triggers the prompt.
      (ev as any).returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, message]);

  return {
    bypass: (then?: () => void) => {
      bypassRef.current = true;
      try { then?.(); } catch { /* noop */ }
    },
  };
}
