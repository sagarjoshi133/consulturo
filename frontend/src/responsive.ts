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
 * Use `useResponsive()` anywhere in the React tree to branch UI.
 */
import { useWindowDimensions, Platform } from 'react-native';

export const BREAKPOINTS = {
  // < 768   → phone / mobile web (mobile-first design)
  // 768–1024 → web tablet (centered content, single-col still)
  // ≥ 1024  → web desktop (sidebar nav, multi-col grids)
  // ≥ 1440  → wide desktop (more columns possible)
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

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
};

/**
 * Hook — re-renders on viewport resize. Safe on native (returns
 * `isMobile = true` always).
 *
 * Desktop mode is enabled when EITHER condition is met:
 *   1. Width ≥ 1024 px (any device this wide), OR
 *   2. Width ≥ 900 px AND landscape orientation (width > height) —
 *      this catches tablets in landscape (iPad, Android tablets,
 *      Surface, etc.) which read more like a desktop than a phone.
 *
 * Phones in landscape (typical max ~900 px) stay in mobile mode.
 */
export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isPlatformWeb = Platform.OS === 'web';

  const landscape = width > height;
  // Tablet-landscape detection. We require:
  //   • Web platform
  //   • Width >= 900 px (excludes iPhone-class phones at any orientation)
  //   • Height >= 600 px (excludes phones held in landscape — those have
  //     only ~400-450 px of height which can't fit a sidebar layout)
  //   • Currently in landscape orientation (width > height)
  // Result: iPad/Android tablet landscape → desktop. Phone landscape →
  // stays in mobile layout where it belongs.
  const isTabletLandscape =
    isPlatformWeb &&
    width >= 900 &&
    height >= 600 &&
    width < BREAKPOINTS.desktop &&
    landscape;
  const isWebTablet = isPlatformWeb && width >= BREAKPOINTS.tablet && width < 900 && !isTabletLandscape;
  const isWebDesktop = (isPlatformWeb && width >= BREAKPOINTS.desktop) || isTabletLandscape;
  const isWebWide = isPlatformWeb && width >= BREAKPOINTS.wide;
  const isWebMedium = isWebTablet || isWebDesktop;
  const isWeb = isWebMedium; // semantic alias used by call sites
  const isMobile = !isWebMedium;

  let cols: 1 | 2 | 3 = 1;
  if (isWebWide) cols = 3;
  else if (isWebDesktop) cols = 2;

  // Centred content max-width tuned per mode. Tablet is narrower so
  // the line length stays readable on 768–900 px screens.
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
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w >= BREAKPOINTS.desktop) return true;
  // Tablet landscape (>=900 wide, >=600 tall, landscape) → desktop.
  // Height threshold excludes phones held in landscape orientation.
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
