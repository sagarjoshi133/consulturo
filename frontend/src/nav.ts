/**
 * Safer navigation helpers that always take the user SOMEWHERE.
 *
 * Plain `(router.canGoBack() ? router.back() : router.replace('/' as any))` silently no-ops when the navigation stack is empty
 * (e.g. cold-started on a deep-linked screen). We've seen a handful of
 * "I press back and nothing happens" bugs for exactly this reason.
 *
 * Use `goBackSafe(router)` everywhere in place of `(router.canGoBack() ? router.back() : router.replace('/' as any))` on
 * Android. It:
 *   1. Pops the stack if there's history
 *   2. Otherwise replaces to a sane landing point (home tabs by default)
 */
import type { Router } from 'expo-router';

export function goBackSafe(router: Router, fallback: string = '/(tabs)') {
  try {
    if (router.canGoBack()) {
      (router.canGoBack() ? router.back() : router.replace('/' as any));
    } else {
      router.replace(fallback as any);
    }
  } catch {
    try { router.replace(fallback as any); } catch { /* last resort */ }
  }
}
