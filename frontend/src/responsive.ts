/**
 * Responsive utilities for ConsultUro.
 *
 * The mobile-first design ships exactly as today on:
 *   • Native APK (Android / iOS)
 *   • Mobile web browsers (any width < 768 px)
 *
 * On desktop / tablet web (Platform.OS === 'web' AND width >= 768 px)
 * we layer a "Web Desktop Mode" overlay:
 *   • Sidebar nav replaces bottom tabs.
 *   • Content is centered with a max-width.
 *   • Multi-column grids on wide screens.
 *   • Tighter typography & paddings (web reads denser).
 *
 * Force-desktop overrides:
 *   1. `localStorage.force_view = "desktop"` (set by the in-app toggle in
 *      the More tab) — wins over everything.
 *   2. `localStorage.force_view = "mobile"`  — forces the mobile layout
 *      even on a wide screen. Useful for previewing the phone layout
 *      from desktop.
 *   3. UA override "Request Desktop Site" (Chrome/Safari mobile) — most
 *      browsers also widen the viewport when this is on so the existing
 *      width-based check usually fires; the UA tokens here are a
 *      best-effort fallback for browsers that don't widen.
 *
 * Use `useResponsive()` anywhere in the React tree to branch UI.
 */
import { useWindowDimensions, Platform } from 'react-native';
import { useEffect, useState } from 'react';

export const BREAKPOINTS = {
  // < 768   → phone / mobile web (mobile-first design)
  // 768–1024 → web tablet (centered content, single-col still)
  // ≥ 1024  → web desktop (sidebar nav, multi-col grids)
  // ≥ 1440  → wide desktop (more columns possible)
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

export type ForceView = 'desktop' | 'mobile' | 'auto';
const FORCE_VIEW_KEY = 'force_view';

/** Read the stored override (web only). Falls back to 'auto'. */
export function getForcedView(): ForceView {
  if (Platform.OS !== 'web') return 'auto';
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = window.localStorage?.getItem(FORCE_VIEW_KEY);
    return v === 'desktop' || v === 'mobile' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Persist the override. Pass 'auto' to clear it. */
export function setForcedView(v: ForceView): void {
  if (Platform.OS !== 'web') return;
  if (typeof window === 'undefined') return;
  try {
    if (v === 'auto') window.localStorage?.removeItem(FORCE_VIEW_KEY);
    else window.localStorage?.setItem(FORCE_VIEW_KEY, v);
    // Update the <meta name="viewport"> so a forced-desktop choice on
    // a narrow phone actually widens the layout (the browser will lay
    // out at the synthetic width and the user can pinch-zoom). Force-
    // mobile / auto restore the device-width default.
    try {
      const head = document?.head;
      if (head) {
        let meta = head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
        if (!meta) {
          meta = document.createElement('meta');
          meta.name = 'viewport';
          head.appendChild(meta);
        }
        meta.content = v === 'desktop'
          ? 'width=1280, initial-scale=0.5, user-scalable=yes'
          : 'width=device-width, initial-scale=1, user-scalable=yes';
      }
    } catch {}
    // Notify in-page subscribers so the new mode applies immediately
    // without a full reload.
    window.dispatchEvent(new Event('forceview-change'));
  } catch {}
}

/** UA hint: did the browser send a "request desktop site" UA? */
function isUaDesktopHint(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  // Heuristics — when "Request Desktop Site" is enabled:
  //   • iOS Safari sends a UA containing "Macintosh" instead of "iPhone".
  //   • Android Chrome strips the "Mobile" token and reports as Linux.
  // We treat presence of Macintosh / Windows / X11 with NO "mobile"
  // token as a desktop request. Phones / tablets without the override
  // always include "mobile" in their UA.
  if (/macintosh|windows nt|x11; (linux|cros)/i.test(ua) && !/mobile/i.test(ua)) {
    return true;
  }
  return false;
}

export type ResponsiveInfo = {
  /** Total viewport width in CSS px. */
  width: number;
  /** Total viewport height in CSS px. */
  height: number;
  /** True only on web at width >= 768. */
  isWeb: boolean;
  /** Web 768–1023 px. Centered content, single-column still. */
  isWebTablet: boolean;
  /** Web ≥ 1024 px. Sidebar nav, multi-column grids enabled. */
  isWebDesktop: boolean;
  /** Web ≥ 1440 px. Maximum columns / spacing. */
  isWebWide: boolean;
  /** Convenience: any web ≥ 768 (tablet OR desktop). */
  isWebMedium: boolean;
  /** Mobile = native OR (web AND width < 768). The current shipped design. */
  isMobile: boolean;
  /** Suggested column count for grids: 1 / 2 / 3. */
  cols: 1 | 2 | 3;
  /** Suggested content max-width for centered layouts. */
  contentMaxWidth: number;
  /** Current effective override: 'desktop' | 'mobile' | 'auto'. */
  forcedView: ForceView;
};

/**
 * Hook — re-renders on viewport resize and on the user toggling the
 * View-mode override in the More tab. Safe on native (always
 * `isMobile = true`).
 *
 * Effective desktop-mode formula:
 *   • forcedView === 'desktop'   → desktop, regardless of width.
 *   • forcedView === 'mobile'    → mobile, regardless of width.
 *   • UA "request desktop site"  → desktop.
 *   • Width ≥ 1024 px            → desktop.
 *   • Width ≥ 900 px in landscape (and tall enough) → desktop.
 *   • else                       → mobile.
 */
export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isPlatformWeb = Platform.OS === 'web';

  // Track localStorage override + UA hint reactively. We re-read both
  // on the custom 'forceview-change' event (fired by setForcedView).
  const [forcedView, setForcedViewState] = useState<ForceView>(() => getForcedView());
  const [uaDesktop, setUaDesktop] = useState<boolean>(() => isUaDesktopHint());
  useEffect(() => {
    if (!isPlatformWeb) return;
    const onChange = () => {
      setForcedViewState(getForcedView());
      setUaDesktop(isUaDesktopHint());
    };
    window.addEventListener('forceview-change', onChange);
    return () => window.removeEventListener('forceview-change', onChange);
  }, [isPlatformWeb]);

  const landscape = width > height;
  const isTabletLandscape =
    isPlatformWeb &&
    width >= 900 &&
    height >= 600 &&
    width < BREAKPOINTS.desktop &&
    landscape;
  let isWebTablet = isPlatformWeb && width >= BREAKPOINTS.tablet && width < 900 && !isTabletLandscape;
  let isWebDesktop = (isPlatformWeb && width >= BREAKPOINTS.desktop) || isTabletLandscape;
  let isWebWide = isPlatformWeb && width >= BREAKPOINTS.wide;

  // Honour overrides (forced or UA-based) on web only — they cannot
  // make a native app become "desktop".
  if (isPlatformWeb) {
    if (forcedView === 'desktop') {
      isWebDesktop = true;
      isWebTablet = false;
      // wide stays driven by actual width — a forced-desktop render on
      // a 360-wide viewport should NOT pretend to be 1440.
    } else if (forcedView === 'mobile') {
      isWebDesktop = false;
      isWebTablet = false;
      isWebWide = false;
    } else if (uaDesktop) {
      // Browser said "give me the desktop site" — honour it.
      isWebDesktop = true;
    }
  }

  const isWebMedium = isWebTablet || isWebDesktop;
  const isWeb = isWebMedium;
  const isMobile = !isWebMedium;

  let cols: 1 | 2 | 3 = 1;
  if (isWebWide) cols = 3;
  else if (isWebDesktop) cols = 2;

  const contentMaxWidth = isWebWide ? 1280 : isWebDesktop ? 1100 : isWebTablet ? 720 : width;

  return {
    width,
    height,
    isWeb,
    isWebTablet,
    isWebDesktop,
    isWebWide,
    isWebMedium,
    isMobile,
    cols,
    contentMaxWidth,
    forcedView,
  };
}

/**
 * Static check (no hook). Use only outside React (e.g. early-init
 * code). Do NOT use inside components — use `useResponsive` instead so
 * the UI re-renders on resize.
 */
export function isWebDesktopStatic(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false; // SSR guard
  const forced = getForcedView();
  if (forced === 'desktop') return true;
  if (forced === 'mobile') return false;
  if (isUaDesktopHint()) return true;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= BREAKPOINTS.desktop) return true;
  if (w >= 900 && h >= 600 && w > h) return true;
  return false;
}

/**
 * Pixel sizes used across the desktop-web layout.
 */
export const DESKTOP = {
  sidebarWidth: 248,
  sidebarCollapsedWidth: 72,
  topbarHeight: 56,
  contentPadX: 32,
  contentPadY: 24,
  cardGap: 16,
} as const;
