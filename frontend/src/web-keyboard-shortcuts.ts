/**
 * web-keyboard-shortcuts.ts
 *
 * Global ⌘K / Ctrl+K → /search shortcut on web.
 * Installed once from the root layout. No-op on native.
 */
import { Platform } from 'react-native';

let installed = false;

export function installWebKeyboardShortcuts(onCmdK: () => void): void {
  if (installed) return;
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  const handler = (ev: KeyboardEvent) => {
    const isCmd = ev.metaKey || ev.ctrlKey;
    if (isCmd && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      try { onCmdK(); } catch { /* noop */ }
    }
    // "/" focus shortcut — only when not already typing into an input.
    if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || (document.activeElement as any)?.isContentEditable;
      if (!editable) {
        ev.preventDefault();
        try { onCmdK(); } catch {}
      }
    }
  };
  window.addEventListener('keydown', handler);
}
