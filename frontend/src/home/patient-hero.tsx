/**
 * PatientHero — Shared home hero block used at the top of every role's
 * home screen (patient, owner, super-owner, staff).
 *
 * Per design decision (2026-05-21) the home page should feel like
 * "one app" regardless of role — same greeting, same ConsultUro brand,
 * same Dr. Sagar Joshi doctor card. Role-specific cockpit content
 * (KPI tiles, quick actions, etc.) renders BELOW this hero, NOT
 * instead of it.
 *
 * Visual identity:
 *   • Cover-photo backdrop (optional, from /settings/homepage)
 *   • Tri-gradient overlay (primaryDark → primary → primaryLight)
 *   • Greeting line ("Namaste, <first-name>") + "ConsultUro" wordmark
 *   • Icon row: language pill, inbox, notifications, profile/avatar
 *   • Doctor card with photo + name + specialty + credentials badge
 *
 * Fetches homepage settings on mount; falls back to bundled
 * DOCTOR_PHOTO_URL + default tagline if the endpoint fails.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, DOCTOR_PHOTO_URL } from '../theme';
import { useAuth } from '../auth';
import { useNotifications } from '../notifications';
import { useI18n } from '../i18n';
import { useThemeColors } from '../theme-context';
import api from '../api';

type HomepageSettings = {
  doctor_photo_url?: string;
  cover_photo_url?: string;
  doctor_name?: string;
  tagline?: string;
};

export default function PatientHero({ scrollY }: { scrollY?: SharedValue<number> }) {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { unread, personalUnread } = useNotifications();
  const themeColors = useThemeColors();

  // Web-only hero parallax — doctor photo drifts up at 0.4× scroll
  // speed and the gradient subtly fades, mimicking premium product
  // sites. Native and SSR fallback to no transform so we don't pay
  // any animation cost when the gain is marginal.
  const parallaxEnabled = Platform.OS === 'web' && !!scrollY;
  const photoStyle = useAnimatedStyle(() => {
    if (!scrollY || Platform.OS !== 'web') return {};
    const y = scrollY.value || 0;
    return {
      transform: [
        { translateY: interpolate(y, [0, 300], [0, -32], Extrapolation.CLAMP) },
        { scale: interpolate(y, [0, 300], [1, 1.04], Extrapolation.CLAMP) },
      ],
    };
  });
  const heroOverlayStyle = useAnimatedStyle(() => {
    if (!scrollY || Platform.OS !== 'web') return {};
    const y = scrollY.value || 0;
    return {
      opacity: interpolate(y, [0, 280], [0, 0.18], Extrapolation.CLAMP),
    };
  });

  const [homepage, setHomepage] = useState<HomepageSettings | null>(null);
  // Live IST clock — refreshed every 30 s. Drives the date/time pill +
  // the clinic-open status dot in the hero.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Build IST-formatted strings for the date pill.
  const istDate = useMemo(
    () =>
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(now),
    [now],
  );
  const istTime = useMemo(
    () =>
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(now),
    [now],
  );

  // Clinic-open heuristic — Mon–Sat, 09:00–19:00 IST. Future work:
  // fetch from /api/availability so the doctor can override this from
  // the dashboard.
  const clinicStatus = useMemo(() => {
    const istHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        hour12: false,
      }).format(now),
    );
    const istWeekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
    }).format(now);
    const isSunday = istWeekday === 'Sun';
    const isOpen = !isSunday && istHour >= 9 && istHour < 19;
    return {
      isOpen,
      label: isOpen ? 'Open now' : isSunday ? 'Closed today' : 'Closed',
      color: isOpen ? '#22C55E' : '#EF4444',
    };
  }, [now]);

  useEffect(() => {
    let alive = true;
    api
      .get('/settings/homepage')
      .then((r) => {
        if (alive && r?.data) setHomepage(r.data);
      })
      .catch(() => {
        /* swallow — defaults will be used */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Cycle language on each tap: en → hi → gu → en
  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang as any) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';

  // Build translucent gradient variants so the cover photo (if any)
  // remains slightly visible behind the gradient. Mirrors the
  // patient-home implementation exactly.
  const heroGradient = useMemo(() => {
    const toRgba = (hex: string, alpha: number): string => {
      const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
      if (!m) return `rgba(14,124,139,${alpha})`;
      const r = parseInt(m[1].slice(0, 2), 16);
      const g = parseInt(m[1].slice(2, 4), 16);
      const b = parseInt(m[1].slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };
    return [
      toRgba(themeColors.primaryDark, 0.85),
      toRgba(themeColors.primary, 0.82),
      toRgba(themeColors.primaryLight, 0.78),
    ] as const;
  }, [themeColors]);

  return (
    <View style={styles.heroWrap}>
      {homepage?.cover_photo_url ? (
        <Image
          source={{ uri: homepage.cover_photo_url }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : null}
      <LinearGradient colors={heroGradient} style={styles.hero}>
        {/* Subtle scroll-driven dim overlay — only animates on web so
            users feel a premium parallax depth as the page scrolls. */}
        {parallaxEnabled && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: '#000' }, heroOverlayStyle]}
          />
        )}
        <SafeAreaView edges={['top']}>
          <View style={styles.heroHeader}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.greeting} numberOfLines={1}>
                {user
                  ? `${t('home.namaste')}, ${(user.name || '').split(' ')[0]}`
                  : t('home.namaste')}
              </Text>
              <Text style={styles.brand}>ConsultUro</Text>
              {/* Live IST date/time + clinic-open status pill — sits
                  just under the wordmark for a glanceable "what time
                  is it / are we open" indicator. */}
              <View style={styles.statusRow}>
                <View style={styles.datePill}>
                  <Ionicons name="time" size={11} color="#fff" />
                  <Text style={styles.datePillText} numberOfLines={1}>
                    {istDate} · {istTime} IST
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <View style={[styles.statusDot, { backgroundColor: clinicStatus.color }]} />
                  <Text style={styles.statusPillText} numberOfLines={1}>
                    {clinicStatus.label}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.heroActions}>
              <TouchableOpacity
                onPress={cycleLang}
                style={styles.langCircle}
                testID="hero-lang"
                accessibilityLabel={`Language: ${lang}`}
              >
                <Text style={styles.langBadgeText} allowFontScaling={false}>
                  {langBadge}
                </Text>
              </TouchableOpacity>
              {user ? (
                <TouchableOpacity
                  onPress={() => router.push('/inbox' as any)}
                  style={styles.bellCircle}
                  testID="hero-inbox"
                  accessibilityLabel="Personal messages"
                >
                  <Ionicons name="chatbubbles" size={19} color="#fff" />
                  {personalUnread > 0 && (
                    <View style={styles.bellBadge}>
                      <Text style={styles.bellBadgeText}>
                        {personalUnread > 9 ? '9+' : String(personalUnread)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
              {user ? (
                <TouchableOpacity
                  onPress={() => router.push('/notifications' as any)}
                  style={styles.bellCircle}
                  testID="hero-bell"
                >
                  <Ionicons name="notifications" size={20} color="#fff" />
                  {unread > 0 && (
                    <View style={styles.bellBadge}>
                      <Text style={styles.bellBadgeText}>
                        {unread > 9 ? '9+' : String(unread)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => router.push((user ? '/profile' : '/login') as any)}
                style={styles.avatarCircle}
                testID="hero-profile-button"
              >
                {user?.picture ? (
                  <Image
                    source={{ uri: user.picture }}
                    style={{ width: 36, height: 36, borderRadius: 18 }}
                  />
                ) : (
                  <Ionicons
                    name={user ? 'person' : 'log-in-outline'}
                    size={22}
                    color="#fff"
                  />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Doctor card — same identity card for every role per Dr.
              Joshi's 2026-05-21 spec ("hero/header style should be
              the same for everyone, as it was before"). */}
          <View style={styles.doctorCard}>
            <Animated.View style={parallaxEnabled ? photoStyle : undefined}>
              <Image
                source={{ uri: homepage?.doctor_photo_url || DOCTOR_PHOTO_URL }}
                style={styles.doctorPhoto}
              />
            </Animated.View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.doctorName}>
                {homepage?.doctor_name || 'Dr. Sagar Joshi'}
              </Text>
              <Text style={styles.doctorSpec}>
                {t('home.consultantUrologist')}
              </Text>
              <Text style={styles.doctorSubtitle}>
                {lang === 'en'
                  ? homepage?.tagline || t('home.doctorTagline')
                  : t('home.doctorTagline')}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Ionicons name="ribbon" size={11} color={COLORS.primary} />
                  <Text style={styles.badgeText}>MBBS · MS · DrNB</Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    backgroundColor: COLORS.primaryDark,
    // Premium multi-layer shadow — adds visual lift below the hero
    // card so it feels like it floats above the page.
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.22,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greeting: {
    ...FONTS.body,
    color: '#E0F7FA',
    letterSpacing: 0.2,
  },
  brand: {
    ...FONTS.h2,
    color: '#fff',
    fontSize: 28,
    letterSpacing: -0.6,
    // Subtle text-shadow gives the wordmark depth on cover-photo
    // backgrounds while staying invisible on flat gradients.
    textShadowColor: 'rgba(0,0,0,0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  datePillText: {
    color: '#fff',
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusPillText: {
    color: COLORS.textPrimary,
    fontFamily: 'Manrope_700Bold',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bellCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.5,
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Manrope_700Bold',
  },
  doctorCard: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    // Glass-morphism inner highlight + subtle outer shadow for a
    // frosted-glass feel that lifts the card off the gradient.
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  doctorPhoto: {
    width: 100,
    height: 100,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  doctorName: {
    ...FONTS.h3,
    color: '#fff',
    fontSize: 21,
    letterSpacing: -0.3,
  },
  doctorSpec: {
    ...FONTS.bodyMedium,
    color: '#E0F7FA',
    marginTop: 2,
    letterSpacing: 0.1,
  },
  doctorSubtitle: {
    ...FONTS.body,
    color: '#B2EBF2',
    fontSize: 12,
    letterSpacing: 0.1,
    marginTop: 1,
  },
  badgeRow: { flexDirection: 'row', marginTop: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  badgeText: {
    ...FONTS.label,
    color: COLORS.primary,
    fontSize: 10,
    letterSpacing: 0.3,
  },
});
