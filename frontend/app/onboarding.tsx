/* ConsultUro — 3-slide animated onboarding shown on first launch.
 *
 * - Horizontal paged ScrollView (native behaviour on iOS & Android).
 * - Reanimated fade/scale entry animation per slide when it becomes active.
 * - Pill page indicator morphs between dots.
 * - Skip top-right + context-aware bottom CTA ("Next" / "Get Started").
 * - AsyncStorage flag "hasSeenOnboarding.v1" — set when user completes
 *   or skips. Cold-boot redirect happens in app/index.tsx.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  FadeInUp,
  FadeInDown,
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADIUS, LOGO_URL } from '../src/theme';
import { useI18n } from '../src/i18n';
import LanguageDropdown from '../src/language-dropdown';
import { haptics } from '../src/haptics';

const ONBOARDING_KEY = 'hasSeenOnboarding.v1';

export async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
  } catch {}
}

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(ONBOARDING_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export default function Onboarding() {
  const router = useRouter();
  const { t } = useI18n();
  const [page, setPage] = React.useState(0);
  const scrollRef = React.useRef<ScrollView>(null);
  const { width } = Dimensions.get('window');

  const finish = async () => {
    haptics.success();
    await markOnboardingSeen();
    router.replace('/(tabs)' as any);
  };

  const skip = async () => {
    haptics.tap();
    await markOnboardingSeen();
    router.replace('/(tabs)' as any);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) {
      setPage(p);
      haptics.select();
    }
  };

  const goNext = () => {
    if (page < 2) {
      haptics.tap();
      scrollRef.current?.scrollTo({ x: width * (page + 1), animated: true });
    } else {
      finish();
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient
        colors={['#EAF6F7', '#FFFFFF']}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Top bar: language switcher + Skip */}
        <View style={styles.topBar}>
          <LanguageDropdown testID="onboarding-lang" />
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={skip} style={styles.skipBtn} testID="onboarding-skip">
            <Text style={styles.skipText}>{t('onboarding.skip') || 'Skip'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          <SlideWelcome width={width} active={page === 0} />
          <SlideFeatures width={width} active={page === 1} />
          <SlidePrivacy width={width} active={page === 2} />
        </ScrollView>

        {/* Indicator + CTA */}
        <View style={styles.bottom}>
          <View style={styles.dots}>
            {[0, 1, 2].map((i) => (
              <Dot key={i} active={page === i} />
            ))}
          </View>

          <TouchableOpacity
            onPress={goNext}
            style={styles.cta}
            testID="onboarding-next"
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[COLORS.primaryLight, COLORS.primary, COLORS.primaryDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ctaInner}
            >
              <Text style={styles.ctaText}>
                {page < 2 ? t('onboarding.next') || 'Next' : t('onboarding.getStarted') || 'Get Started'}
              </Text>
              <Ionicons
                name={page < 2 ? 'arrow-forward' : 'checkmark-done'}
                size={20}
                color="#fff"
              />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

// -------- Dot --------
function Dot({ active }: { active: boolean }) {
  const w = useSharedValue(active ? 22 : 8);
  React.useEffect(() => {
    w.value = withTiming(active ? 22 : 8, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, w]);
  const animStyle = useAnimatedStyle(() => ({
    width: w.value,
    backgroundColor: active ? COLORS.primary : '#C9DADE',
  }));
  return <Animated.View style={[styles.dot, animStyle]} />;
}

// -------- Slide 1: Welcome --------
function SlideWelcome({ width, active }: { width: number; active: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.slide, { width }]}>
      {active && (
        <Animated.View entering={ZoomIn.duration(600)} style={styles.logoHalo}>
          <Image source={{ uri: LOGO_URL }} style={styles.logo} />
        </Animated.View>
      )}
      <View style={{ height: 30 }} />
      {active && (
        <Animated.Text entering={FadeInUp.delay(200).duration(500)} style={styles.slideTitle}>
          {t('onboarding.slide1.title') || 'Welcome to ConsultUro'}
        </Animated.Text>
      )}
      {active && (
        <Animated.Text entering={FadeInUp.delay(350).duration(500)} style={styles.slideSub}>
          {t('onboarding.slide1.subtitle') ||
            'Your personal urology care companion from Dr. Sagar Joshi.'}
        </Animated.Text>
      )}
      {/* Credential chips */}
      {active && (
        <Animated.View entering={FadeInUp.delay(500).duration(500)} style={styles.chipsRow}>
          <View style={styles.credChip}>
            <Ionicons name="medical" size={12} color={COLORS.primary} />
            <Text style={styles.credChipText}>Consultant Urologist</Text>
          </View>
          <View style={styles.credChip}>
            <Ionicons name="cut" size={12} color={COLORS.primary} />
            <Text style={styles.credChipText}>Laparoscopic</Text>
          </View>
          <View style={styles.credChip}>
            <Ionicons name="ribbon" size={12} color={COLORS.primary} />
            <Text style={styles.credChipText}>Transplant Surgeon</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

// -------- Slide 2: Features --------
function SlideFeatures({ width, active }: { width: number; active: boolean }) {
  const { t } = useI18n();
  const features: { icon: any; family: 'ion' | 'mci'; labelKey: string; fallback: string }[] = [
    { icon: 'calendar', family: 'ion', labelKey: 'onboarding.slide2.f1', fallback: 'Online & In-person consults' },
    { icon: 'book', family: 'ion', labelKey: 'onboarding.slide2.f2', fallback: 'Education in 3 languages' },
    { icon: 'calculator-variant', family: 'mci', labelKey: 'onboarding.slide2.f3', fallback: '10+ urology calculators' },
    { icon: 'notifications', family: 'ion', labelKey: 'onboarding.slide2.f4', fallback: 'Appointment reminders' },
  ];
  return (
    <View style={[styles.slide, { width }]}>
      {active && (
        <Animated.View entering={ZoomIn.duration(500)} style={styles.heroIconCircleLg}>
          <MaterialCommunityIcons name="stethoscope" size={56} color={COLORS.primary} />
        </Animated.View>
      )}
      <View style={{ height: 24 }} />
      {active && (
        <Animated.Text entering={FadeInUp.delay(150).duration(500)} style={styles.slideTitle}>
          {t('onboarding.slide2.title') || 'Everything you need'}
        </Animated.Text>
      )}
      {active && (
        <Animated.Text entering={FadeInUp.delay(300).duration(500)} style={styles.slideSub}>
          {t('onboarding.slide2.subtitle') ||
            'Book consultations, read trusted guides, use calculators, and track your health — all in one place.'}
        </Animated.Text>
      )}
      {active && (
        <View style={styles.featureGrid}>
          {features.map((f, i) => (
            <Animated.View
              key={f.labelKey}
              entering={FadeInUp.delay(400 + i * 90).duration(450)}
              style={styles.featureCard}
            >
              <View style={styles.featureIconWrap}>
                {f.family === 'mci' ? (
                  <MaterialCommunityIcons name={f.icon} size={22} color={COLORS.primary} />
                ) : (
                  <Ionicons name={f.icon} size={22} color={COLORS.primary} />
                )}
              </View>
              <Text style={styles.featureLabel} numberOfLines={2}>
                {t(f.labelKey) !== f.labelKey ? t(f.labelKey) : f.fallback}
              </Text>
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
}

// -------- Slide 3: Privacy / Get started --------
function SlidePrivacy({ width, active }: { width: number; active: boolean }) {
  const { t } = useI18n();
  return (
    <View style={[styles.slide, { width }]}>
      {active && (
        <Animated.View entering={ZoomIn.duration(500)} style={styles.heroIconCircleLg}>
          <Ionicons name="shield-checkmark" size={56} color={COLORS.primary} />
        </Animated.View>
      )}
      <View style={{ height: 24 }} />
      {active && (
        <Animated.Text entering={FadeInUp.delay(150).duration(500)} style={styles.slideTitle}>
          {t('onboarding.slide3.title') || 'Private, secure & handy'}
        </Animated.Text>
      )}
      {active && (
        <Animated.Text entering={FadeInUp.delay(300).duration(500)} style={styles.slideSub}>
          {t('onboarding.slide3.subtitle') ||
            'Your data stays encrypted. Pull-to-refresh, offline indicator, haptic feedback and smart search throughout.'}
        </Animated.Text>
      )}
      {active && (
        <Animated.View entering={FadeInDown.delay(500).duration(500)} style={styles.trustRow}>
          <TrustBadge icon="lock-closed" label="Encrypted" />
          <TrustBadge icon="cloud-offline" label="Offline-aware" />
          <TrustBadge icon="sparkles" label="Haptic UI" />
        </Animated.View>
      )}
    </View>
  );
}

function TrustBadge({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.trustBadge}>
      <Ionicons name={icon} size={16} color={COLORS.primary} />
      <Text style={styles.trustText}>{label}</Text>
    </View>
  );
}

// -------- styles --------
const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  skipBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18 },
  skipText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 13 },

  slide: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },

  logoHalo: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  logo: {
    width: 130,
    height: 130,
    borderRadius: 65,
  },

  heroIconCircleLg: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    borderWidth: 2,
    borderColor: COLORS.primary + '18',
  },

  slideTitle: {
    ...FONTS.h1,
    color: COLORS.textPrimary,
    fontSize: 26,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  slideSub: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 22,
    fontSize: 15,
    paddingHorizontal: 6,
  },

  chipsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  credChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  credChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 22,
    maxWidth: 360,
  },
  featureCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0B3142',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  featureIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureLabel: {
    ...FONTS.bodyMedium,
    color: COLORS.textPrimary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },

  trustRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 28,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
    shadowColor: '#0B3142',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  trustText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  bottom: {
    paddingHorizontal: 22,
    paddingBottom: Platform.OS === 'ios' ? 12 : 20,
    paddingTop: 10,
    gap: 18,
    alignItems: 'center',
  },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 8, borderRadius: 4 },
  cta: { width: '100%', borderRadius: RADIUS.pill, overflow: 'hidden' },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  ctaText: {
    ...FONTS.h4,
    color: '#fff',
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
  },
});
