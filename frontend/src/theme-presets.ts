/**
 * Brand-theme presets + helpers.
 *
 * A "theme" is a triplet of hex colors that drives the hero gradient,
 * primary CTA buttons, and active-tab highlight across the clinic's
 * patient-facing surfaces. Per-clinic theme is persisted in
 * `clinic_settings.brand_theme` as either:
 *   • { preset: "<key>" }              – one of the 6 presets below
 *   • { primary, primaryLight, primaryDark }  – fully custom HEX triplet
 *
 * The default ("teal") matches the platform's original color identity.
 */

export type ThemeColors = {
  primary: string;
  primaryLight: string;
  primaryDark: string;
};

export type BrandTheme = {
  preset?: string;
  primary?: string;
  primaryLight?: string;
  primaryDark?: string;
};

export type ThemePreset = ThemeColors & {
  key: string;
  label: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    key: 'teal',
    label: 'Teal',
    primary: '#0E7C8B',
    primaryLight: '#16A6B8',
    primaryDark: '#0A5E6B',
  },
  {
    key: 'royal_blue',
    label: 'Royal Blue',
    primary: '#1E3A8A',
    primaryLight: '#3B82F6',
    primaryDark: '#172554',
  },
  {
    key: 'emerald',
    label: 'Emerald',
    primary: '#047857',
    primaryLight: '#10B981',
    primaryDark: '#064E3B',
  },
  {
    key: 'indigo',
    label: 'Indigo',
    primary: '#4338CA',
    primaryLight: '#6366F1',
    primaryDark: '#312E81',
  },
  {
    key: 'sunset',
    label: 'Sunset',
    primary: '#B45309',
    primaryLight: '#F59E0B',
    primaryDark: '#7C2D12',
  },
  {
    key: 'slate',
    label: 'Slate',
    primary: '#1F2937',
    primaryLight: '#475569',
    primaryDark: '#0F172A',
  },
];

export const DEFAULT_THEME: ThemeColors = {
  primary: THEME_PRESETS[0].primary,
  primaryLight: THEME_PRESETS[0].primaryLight,
  primaryDark: THEME_PRESETS[0].primaryDark,
};

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export function isValidHex(s: string | undefined | null): boolean {
  return !!s && HEX_RE.test(s.trim());
}

export function normalizeHex(s: string): string {
  const v = (s || '').trim();
  if (!HEX_RE.test(v)) return '';
  if (v.length === 4) {
    // Expand #abc → #aabbcc
    const r = v[1], g = v[2], b = v[3];
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }
  return v.toLowerCase();
}

/**
 * Resolve a stored brand_theme into a fully-populated ThemeColors.
 * Falls back to the platform default ("teal") on any malformed input.
 */
export function resolveTheme(brand: BrandTheme | null | undefined): ThemeColors {
  if (!brand) return { ...DEFAULT_THEME };
  // Custom triplet wins if all three are valid hex.
  if (isValidHex(brand.primary) && isValidHex(brand.primaryLight) && isValidHex(brand.primaryDark)) {
    return {
      primary: normalizeHex(brand.primary!),
      primaryLight: normalizeHex(brand.primaryLight!),
      primaryDark: normalizeHex(brand.primaryDark!),
    };
  }
  // Otherwise use the named preset.
  if (brand.preset) {
    const p = THEME_PRESETS.find((x) => x.key === brand.preset);
    if (p) return { primary: p.primary, primaryLight: p.primaryLight, primaryDark: p.primaryDark };
  }
  return { ...DEFAULT_THEME };
}

/** Test whether a given brand_theme matches a preset key. */
export function isPreset(brand: BrandTheme | null | undefined, key: string): boolean {
  if (!brand) return key === 'teal';
  if (brand.preset === key) return true;
  // Also allow detection by exact triplet match (e.g. legacy data
  // with hex but no preset key).
  const p = THEME_PRESETS.find((x) => x.key === key);
  if (!p) return false;
  return (
    normalizeHex(brand.primary || '') === p.primary.toLowerCase() &&
    normalizeHex(brand.primaryLight || '') === p.primaryLight.toLowerCase() &&
    normalizeHex(brand.primaryDark || '') === p.primaryDark.toLowerCase()
  );
}

/** Auto-derive a sensible primaryDark/Light pair from a single hex. */
export function deriveTriplet(primary: string): ThemeColors | null {
  const p = normalizeHex(primary);
  if (!p) return null;
  return {
    primary: p,
    primaryLight: lighten(p, 0.18),
    primaryDark: darken(p, 0.22),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function hexToRgb(hex: string): [number, number, number] {
  const v = normalizeHex(hex);
  return [
    parseInt(v.slice(1, 3), 16),
    parseInt(v.slice(3, 5), 16),
    parseInt(v.slice(5, 7), 16),
  ];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toLowerCase();
}
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = clamp01(amount);
  return rgbToHex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a);
}
export function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = clamp01(amount);
  return rgbToHex(r * (1 - a), g * (1 - a), b * (1 - a));
}
