/**
 * web-alert-polyfill.ts
 *
 * Background
 * ──────────
 * React Native's `Alert.alert(...)` is implemented by react-native-web as
 * a SILENT no-op (the docs explicitly say "Alert is not supported on
 * web"). That breaks dozens of confirmation dialogs in ConsultUro
 * whenever someone uses the web preview / built web app — buttons just
 * appear to do nothing. See cross-alert.ts for the back-story.
 *
 * Per-callsite refactor would touch 200+ files. Instead, this module
 * monkey-patches `Alert.alert` AT APP STARTUP on web only so every
 * existing caller automatically routes to `window.alert` /
 * `window.confirm` underneath. Native (iOS / Android) is untouched — the
 * native `Alert.alert` is fine there.
 *
 * Mapping rules:
 *   • `Alert.alert(title)`                      → window.alert(title)
 *   • `Alert.alert(title, message)`             → window.alert(title + msg)
 *   • `Alert.alert(t, m, [{onPress}])`          → window.alert + onPress()
 *   • `Alert.alert(t, m, [cancel, confirm])`    → window.confirm; if ok →
 *                                                  confirm.onPress(),
 *                                                  else  → cancel.onPress?.()
 *   • `Alert.alert(t, m, [...3+ buttons])`      → window.confirm with
 *                                                  the LAST (or destructive)
 *                                                  button as the confirm
 *                                                  action; first as cancel.
 *
 * Import once from the root layout (`app/_layout.tsx`). No-op on native.
 */
import { Alert, Platform } from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type AlertOptions = Record<string, any>;

let installed = false;

export function installWebAlertPolyfill(): void {
  if (installed) return;
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  installed = true;

  const orig = Alert.alert?.bind(Alert);

  Alert.alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    _options?: AlertOptions,
  ) => {
    try {
      const body = message ? `${title}\n\n${message}` : String(title || '');

      // No buttons → info popup.
      if (!buttons || buttons.length === 0) {
        try { window.alert(body); } catch { /* sandboxed */ }
        return;
      }

      // Exactly one button → info popup, then fire its onPress.
      if (buttons.length === 1) {
        try { window.alert(body); } catch {}
        try { buttons[0]?.onPress?.(); } catch {}
        return;
      }

      // Two-or-more buttons → window.confirm.
      // Identify the "confirm" button: prefer style==='destructive', else
      // the last non-cancel button.
      const cancel =
        buttons.find((b) => b.style === 'cancel') || buttons[0];
      const confirm =
        buttons.find((b) => b.style === 'destructive') ||
        buttons.slice().reverse().find((b) => b.style !== 'cancel') ||
        buttons[buttons.length - 1];

      let ok = false;
      try { ok = window.confirm(body); } catch { ok = false; }
      try {
        if (ok) confirm?.onPress?.();
        else cancel?.onPress?.();
      } catch { /* caller's onPress threw — swallow */ }
    } catch {
      // Last-ditch fallback: try the original (which is a no-op but
      // doesn't throw).
      try { orig?.(title, message as any); } catch {}
    }
  };
}
