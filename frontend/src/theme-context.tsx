/**
 * ThemeContext — exposes the active clinic's resolved brand colors.
 *
 * Behavior:
 *  • On mount AND whenever the active clinic_id changes (TenantContext),
 *    refetch /api/clinic-settings to read `brand_theme` and resolve it
 *    into a {primary, primaryLight, primaryDark} triplet.
 *  • Falls back to platform default ("teal") on any error / no value.
 *  • Components consume via `useTheme()` — they get a live object that
 *    updates when the owner switches theme in the Branding panel.
 *
 * NOTE: the *static* COLORS export from `theme.ts` continues to drive
 * everything else (text, borders, backgrounds, badges) so we don't have
 * to refactor the entire codebase. Only hero gradients + primary CTAs
 * + active-tab tint read from the theme context.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_THEME, type BrandTheme, type ThemeColors, resolveTheme } from './theme-presets';
import api from './api';
import { useTenant } from './tenant-context';

type ThemeContextValue = {
  /** Resolved {primary, primaryLight, primaryDark} for the active clinic. */
  colors: ThemeColors;
  /** Raw brand_theme as stored ({preset} or {primary,light,dark}). */
  theme: BrandTheme | null;
  /** Hard-refresh from the backend (call after PATCHing /clinic-settings). */
  refresh: () => Promise<void>;
  /** Optimistic update — Branding panel calls this after a save so the
   *  whole app reacts instantly without waiting for the next refresh. */
  setTheme: (theme: BrandTheme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: DEFAULT_THEME,
  theme: null,
  refresh: async () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { currentClinicId } = useTenant();
  const [theme, setThemeRaw] = useState<BrandTheme | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get('/clinic-settings');
      const bt = (r?.data?.brand_theme || null) as BrandTheme | null;
      setThemeRaw(bt);
    } catch {
      setThemeRaw(null);
    }
  }, []);

  // Initial load + whenever the active clinic switches, refetch.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClinicId]);

  const colors = useMemo(() => resolveTheme(theme), [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      theme,
      refresh,
      setTheme: (t: BrandTheme) => setThemeRaw(t),
    }),
    [colors, theme, refresh],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Convenience hook returning ONLY the color triplet — most call sites
 *  just need `theme.primary`. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
