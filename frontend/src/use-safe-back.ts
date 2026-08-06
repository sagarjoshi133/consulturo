/**
 * useSafeBack — bullet-proof back-button helper for expo-router.
 *
 * Background: `router.back()` only works when there's a navigation
 * stack to pop. When a screen is opened by:
 *   • a deep link / push notification
 *   • a web page refresh on a non-root route
 *   • a fresh app launch directly into the route
 *   • a Linking.openURL() from another app
 * …the stack is EMPTY, so `router.back()` is a silent no-op and the
 * user is trapped on the screen (the back chevron in the upper-left
 * appears to do nothing — reported by Dr Joshi Jun-16 across the
 * app).
 *
 * This hook returns a `goBack` function that:
 *   1. Pops the stack if possible (`router.canGoBack()`).
 *   2. Otherwise navigates to the given `fallback` route (default `/`).
 *
 * Usage:
 *   import { useSafeBack } from '../src/use-safe-back';
 *
 *   const goBack = useSafeBack();              // defaults to "/"
 *   const goBack = useSafeBack('/billing');    // explicit fallback
 *
 *   <TouchableOpacity onPress={goBack}> … </TouchableOpacity>
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';

export function useSafeBack(fallback: string = '/') {
  const router = useRouter();
  return useCallback(() => {
    try {
      if (typeof router.canGoBack === 'function' && router.canGoBack()) {
        router.back();
        return;
      }
    } catch {
      // canGoBack() can throw in rare race conditions during route
      // change — swallow and use the fallback.
    }
    try {
      router.replace(fallback as any);
    } catch {
      // Last-ditch: navigate via push if replace is unavailable.
      try { router.push(fallback as any); } catch {}
    }
  }, [router, fallback]);
}
