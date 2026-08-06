/**
 * ConsultUro — Patient Dark Mode foundation (Phase 5.22).
 *
 * Lives ALONGSIDE the existing brand `ThemeContext` (which controls
 * primary brand colors per clinic). This module controls *light vs
 * dark* — orthogonal to brand.
 *
 * Strategy:
 *   1. Keep the existing static `COLORS` export from theme.ts as the
 *      LIGHT palette so the doctor dashboard / IPD / surgery / billing
 *      / branding / etc. don't break — they still `import { COLORS }`
 *      directly and never see dark mode.
 *   2. Patient-facing screens (home tab, /reviews, /profile,
 *      /my-records, /book, /bookings) migrate to `useDarkMode()`
 *      which returns either the light or dark palette based on the
 *      user's saved preference + system theme follow.
 *   3. Default for new installs = LIGHT (per user spec).
 *   4. Persisted in AsyncStorage under `@consulturo/theme-mode.v1`.
 *
 * The dark palette is a softened version of the brand teal:
 *   • Background `#0F1416` (near-black with a hint of teal)
 *   • Surface  `#1A2426`
 *   • Primary  `#5BC8D7` (lighter brand teal that pops on dark)
 *   • Text     `#E2ECEC` primary, `#9DB1B5` secondary
 *   • Border   `#243036`
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLORS as LIGHT_COLORS } from './theme';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Dark palette — softened teal brand on near-black. */
export const DARK_COLORS = {
  primary: '#5BC8D7',
  primaryLight: '#7FE0EE',
  primaryDark: '#0E7C8B',
  accent: '#FF6B6B',
  accentLight: '#3A1F1F',
  whatsapp: '#25D366',
  bg: '#0F1416',
  surface: '#1A2426',
  textPrimary: '#E2ECEC',
  textSecondary: '#9DB1B5',
  textDisabled: '#5E7C81',
  textTertiary: '#7A8E92',
  border: '#243036',
  gradient: ['#0E7C8B', '#5BC8D7'] as const,
  heroGradient: ['#0A2024', '#1A3F47', '#0E7C8B'] as const,
  cardShadow: 'rgba(0, 0, 0, 0.35)',
  success: '#22C55E',
  warning: '#FBBF24',
  gold: '#F5C26B',
  goldText: '#2D1A00',
} as const;

/** Light palette — re-uses the existing static COLORS so values
 *  match the legacy `import { COLORS }` consumers exactly. */
export const LIGHT_PALETTE = {
  ...LIGHT_COLORS,
  textTertiary: '#7A8E92',
} as const;

export type ModePalette = typeof LIGHT_PALETTE;

const KEY = '@consulturo/theme-mode.v1';

type Ctx = {
  mode: ThemeMode;
  effective: 'light' | 'dark';
  colors: ModePalette;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const DarkModeContext = createContext<Ctx>({
  mode: 'light',
  effective: 'light',
  colors: LIGHT_PALETTE,
  setMode: async () => {},
});

export function DarkModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, _setMode] = useState<ThemeMode>('light');
  const system = useColorScheme(); // 'light' | 'dark' | null

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') {
          _setMode(raw);
        }
      } catch {
        // Storage unavailable — stick with default.
      }
    })();
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    _setMode(next);
    try {
      await AsyncStorage.setItem(KEY, next);
    } catch {
      // Persist failure is non-fatal.
    }
  }, []);

  const effective: 'light' | 'dark' = useMemo(() => {
    if (mode === 'system') return (system === 'dark' ? 'dark' : 'light');
    return mode;
  }, [mode, system]);

  const colors = effective === 'dark' ? (DARK_COLORS as unknown as ModePalette) : LIGHT_PALETTE;

  return (
    <DarkModeContext.Provider value={{ mode, effective, colors, setMode }}>
      {children}
    </DarkModeContext.Provider>
  );
}

/** Primary hook for patient-side screens. */
export function useDarkMode(): Ctx {
  return useContext(DarkModeContext);
}

/** Convenience — just the colors. */
export function useDarkModeColors(): ModePalette {
  return useContext(DarkModeContext).colors;
}

/** Returns the appropriate `expo-status-bar` style. */
export function useStatusBarStyle(): 'light' | 'dark' {
  // `style="light"` = LIGHT TEXT (used when bg is dark).
  return useContext(DarkModeContext).effective === 'dark' ? 'light' : 'dark';
}

/** Convenience hook returning just the screen background color
 *  (light/dark per current mode). Designed for low-touch retrofitting of
 *  patient-facing screens — callers replace `COLORS.bg` with this value. */
export function useScreenBg(): string {
  return useContext(DarkModeContext).colors.bg;
}

/** Returns boolean indicating whether dark mode is effectively active. */
export function useIsDark(): boolean {
  return useContext(DarkModeContext).effective === 'dark';
}

/** Convenience hook returning ready-made style overrides for the
 *  most-common patterns in legacy screens (root bg, white surface
 *  cards, primary/secondary text). Designed for low-touch retrofitting
 *  — callers apply them as a SECOND style entry, e.g.:
 *    `style={[styles.screen, d.screen]}`
 *  and only the colours flip in dark mode; layout stays identical. */
export function useDarkOverrides() {
  const { colors, effective } = useContext(DarkModeContext);
  const isDark = effective === 'dark';
  return {
    isDark,
    colors,
    /** Apply to the root View / SafeAreaView background. */
    screen:   isDark ? { backgroundColor: colors.bg } : null,
    /** Apply to white cards / sheets (e.g. backgroundColor: '#fff'). */
    surface:  isDark ? { backgroundColor: colors.surface, borderColor: colors.border } : null,
    /** Apply to body / heading text. */
    textP:    isDark ? { color: colors.textPrimary } : null,
    textS:    isDark ? { color: colors.textSecondary } : null,
    /** Apply to subtle dividers / borders. */
    border:   isDark ? { borderColor: colors.border } : null,
  };
}
