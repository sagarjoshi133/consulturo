export const COLORS = {
  primary: '#0E7C8B',
  primaryLight: '#16A6B8',
  primaryDark: '#0A5E6B',
  accent: '#E53935',
  accentLight: '#FFEBEE',
  whatsapp: '#25D366',
  bg: '#F4F9F9',
  surface: '#FFFFFF',
  textPrimary: '#1A2E35',
  textSecondary: '#5E7C81',
  textDisabled: '#A0B5B8',
  border: '#E2ECEC',
  gradient: ['#0E7C8B', '#16A6B8'] as const,
  heroGradient: ['#0A5E6B', '#0E7C8B', '#16A6B8'] as const,
  cardShadow: 'rgba(14, 124, 139, 0.10)',
  success: '#16A34A',
  warning: '#F59E0B',
  /** Gold treatment used for premium / Full-Access badging. */
  gold: '#F5C26B',
  goldText: '#5C3D00',
};

/** Single source of truth for elevation. Apply via `...SHADOWS.card`. */
export const SHADOWS = {
  card: {
    shadowColor: '#0E7C8B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  pop: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
};

/** Reusable badge style helper.
 * Usage: `style={badgeStyle('gold')}` — keeps every pill on one canonical look. */
export function badgeStyle(variant: 'primary' | 'success' | 'warning' | 'accent' | 'gold' | 'muted' = 'primary') {
  const map = {
    primary: { bg: COLORS.primary + '18', fg: COLORS.primaryDark, border: COLORS.primary + '44' },
    success: { bg: COLORS.success + '1A', fg: COLORS.success, border: COLORS.success + '44' },
    warning: { bg: COLORS.warning + '1A', fg: COLORS.warning, border: COLORS.warning + '44' },
    accent: { bg: COLORS.accent + '14', fg: COLORS.accent, border: COLORS.accent + '44' },
    gold: { bg: COLORS.gold, fg: COLORS.goldText, border: 'transparent' },
    muted: { bg: COLORS.border, fg: COLORS.textSecondary, border: COLORS.border },
  } as const;
  const c = map[variant];
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.border,
    color: c.fg,
  };
}

export const RADIUS = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 9999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const SHADOW_SOFT = {
  shadowColor: '#0E7C8B',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
};

export const FONTS = {
  h1: { fontFamily: 'Manrope_800ExtraBold', fontSize: 34, lineHeight: 42, letterSpacing: -0.5 },
  h2: { fontFamily: 'Manrope_700Bold', fontSize: 26, lineHeight: 34, letterSpacing: -0.3 },
  h3: { fontFamily: 'Manrope_600SemiBold', fontSize: 22, lineHeight: 28 },
  h4: { fontFamily: 'Manrope_600SemiBold', fontSize: 19, lineHeight: 26 },
  bodyLarge: { fontFamily: 'DMSans_400Regular', fontSize: 17, lineHeight: 25 },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: 'DMSans_500Medium', fontSize: 15, lineHeight: 22 },
  label: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 13,
    lineHeight: 18,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
};

export const LOGO_URL =
  'https://customer-assets.emergentagent.com/job_4d5b1ea9-c5df-4db3-9534-968cd0e87a5b/artifacts/h83dp788_IMG_20250303_112132.jpg';

export const DOCTOR_PHOTO_URL =
  'https://customer-assets.emergentagent.com/job_urology-pro/artifacts/6ng2cxnu_IMG_20260421_191126.jpg';
