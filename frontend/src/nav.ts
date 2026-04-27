/**
 * Safer navigation helpers that always take the user SOMEWHERE.
 *
 * Plain `router.back()` silently no-ops when the navigation stack is empty
 * (e.g. cold-started on a deep-linked screen). We've seen a handful of
 * "I press back and nothing happens" bugs for exactly this reason.
 *
 * Use `goBackSafe(router)` everywhere in place of `router.back()` on
 * Android. It:
 *   1. Pops the stack if there's history
 *   2. Otherwise replaces to a sane landing point (home tabs by default)
 */
import type { Router } from 'expo-router';

export function goBackSafe(router: Router, fallback: string = '/(tabs)') {
  try {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as any);
    }
  } catch {
    try { router.replace(fallback as any); } catch { /* last resort */ }
  }
}
