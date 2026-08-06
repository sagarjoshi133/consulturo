/**
 * Cross-platform Alert helpers.
 *
 * Background: React Native's `Alert.alert(...)` is a NATIVE OS dialog
 * — it works flawlessly on iOS / Android. On `react-native-web` it
 * is a silent no-op (the docs say "not supported on web"). That
 * silently breaks every confirm dialog in the app whenever a user
 * opens the web preview / Vercel build, including:
 *   - IPD > Consents > delete trash icon
 *   - IPD > Discharge > "Finalise discharge" button
 *   - AiField overwrite-confirm modal in the discharge tab
 *   - Bed-transfer error fallbacks
 *
 * This module wraps the two patterns we actually use (a one-button
 * info alert and a two-button destructive/confirm dialog) and routes
 * web to `window.alert` / `window.confirm` so the user always sees a
 * dialog. Native still uses `Alert.alert` for the polished bottom-
 * sheet UI.
 *
 * Usage:
 *   import { confirmAction, infoAlert } from './cross-alert';
 *   confirmAction({
 *     title: 'Delete consent?',
 *     message: 'This will remove the consent. Continue?',
 *     confirmText: 'Delete',
 *     destructive: true,
 *     onConfirm: async () => { await api.delete(...); },
 *   });
 *
 *   infoAlert('Saved', 'Vitals stored to the chart.');
 */
import { Alert, Platform } from 'react-native';

export function infoAlert(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}

export interface ConfirmActionOptions {
  title: string;
  message: string;
  /** Button label for the confirmation action (default: "Confirm"). */
  confirmText?: string;
  /** Button label for the cancel action (default: "Cancel"). */
  cancelText?: string;
  /** When true, the native dialog renders the confirm button in red. */
  destructive?: boolean;
  /** Called only on confirm. May be async — we await + swallow errors so
   *  the caller can keep its own try/catch for backend errors. */
  onConfirm: () => void | Promise<void>;
  /** Optional cancel handler (rarely needed). */
  onCancel?: () => void;
}

export function confirmAction(opts: ConfirmActionOptions): void {
  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
    onConfirm,
    onCancel,
  } = opts;

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return;
    // window.confirm() shows ONE OK / Cancel choice — destructive
    // styling is not available on web. We still respect the action.
    const ok = window.confirm(`${title}\n\n${message}`);
    if (ok) {
      try { void onConfirm(); } catch { /* caller handles */ }
    } else {
      try { onCancel?.(); } catch {}
    }
    return;
  }

  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel', onPress: () => { try { onCancel?.(); } catch {} } },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: () => { try { void onConfirm(); } catch {} },
    },
  ]);
}
