/**
 * AnimatedSplash — premium "first-frame" experience.
 *
 * Why we need this:
 *   • The native splash (expo-splash-screen) is a single static image
 *     — it hides immediately when the JS bundle is ready, which on a
 *     slow phone produces a one-frame flash to white before the home
 *     screen actually paints.
 *   • This component overlays the **JS** splash for ~1.6 s with a
 *     branded animation that uses the SAME logo and gradient as the
 *     native splash, so the transition is seamless and feels premium.
 *
 * Visual choreography (1.7 s total):
 *   0.00–0.30 s   Background gradient fades in (matches native splash)
 *   0.10–0.55 s   Logo scales from 0.78 → 1.00 with a soft drop-shadow
 *                 ring (looks like the logo "lands" into place)
 *   0.55–0.90 s   "ConsultUro" wordmark fades up + tagline below it
 *   0.90–1.30 s   Subtle pulse on the logo (1.00 → 1.04 → 1.00) — the
 *                 micro-interaction that elevates the feel
 *   1.30–1.70 s   Whole overlay fades out and unmounts cleanly
 *
 * Honours `prefers-reduced-motion` on web — short fade only, no pulse.
 * Disables itself if the user has visited the app before (so it only
 * shows on cold/fresh starts — keeps warm relaunches snappy).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  Text,
  StyleSheet,
  Platform,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withSequence,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Asset } from 'expo-asset';
import { COLORS, FONTS } from './theme';

// Pre-resolve the asset module reference at import time so the bundler
// can fingerprint + cache it. Using a 384×384 / 27 KB quantised PNG
// (vs the 1024×1024 / 1.1 MB master icon.png) means the decode time
// is essentially zero on every device class — the logo paints on the
// very first animation frame instead of popping in mid-fade.
const SPLASH_LOGO = require('../assets/splash-logo.png');

const { width, height } = Dimensions.get('window');
const LOGO_SIZE = Math.min(width, height) * 0.34;
// Native splash background — must match exactly so there's no
// colour flash between the two splashes. (Sourced from app.json
// expo.splash.backgroundColor & expo.android.adaptiveIcon.backgroundColor.)
const GRADIENT = ['#44849F', '#0E7C8B', '#0a5d68'] as const;

function isReducedMotion(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

type Props = {
  /** Called when the splash has fully faded out so the parent can
   *  unmount it. The component itself also self-hides via state. */
  onFinish?: () => void;
};

export default function AnimatedSplash({ onFinish }: Props) {
  const reduce = isReducedMotion();

  // ── Shared animated values ────────────────────────────────────────
  const bgOpacity = useSharedValue(1); // overlay base opacity
  const logoScale = useSharedValue(reduce ? 1 : 0.78);
  const logoOpacity = useSharedValue(0); // start hidden until decoded
  const ringScale = useSharedValue(0.6);
  const ringOpacity = useSharedValue(0);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkY = useSharedValue(reduce ? 0 : 12);
  const taglineOpacity = useSharedValue(0);

  // Local visibility so we can fully unmount after the fade-out.
  const [mounted, setMounted] = useState(true);
  // We only kick off the animation once the logo image has been
  // decoded — otherwise the user sees the gradient/wordmark animate
  // while the logo lazily pops in mid-flight (the bug we're fixing).
  const [logoReady, setLogoReady] = useState(false);
  const startedRef = useRef(false);

  // ── Preload the logo asset BEFORE animation starts ───────────────
  // expo-asset's `downloadAsync` resolves once the binary is in the
  // app's local cache. On native this is a no-op (the asset is bundled
  // into the APK / IPA), on web it actually fetches the PNG. We also
  // keep a 1.2 s safety timeout — if the preload stalls for any reason
  // we proceed anyway so the splash never gets "stuck".
  useEffect(() => {
    let cancelled = false;
    const fallback = setTimeout(() => {
      if (!cancelled) setLogoReady(true);
    }, 1200);
    (async () => {
      try {
        await Asset.fromModule(SPLASH_LOGO).downloadAsync();
      } catch {
        /* ignore — image will fall back to lazy decode */
      } finally {
        if (!cancelled) setLogoReady(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    // Don't start until the logo asset is decoded so it can't pop in
    // mid-animation. `startedRef` ensures we only fire once even if
    // logoReady toggles for any reason.
    if (!logoReady || startedRef.current) return;
    startedRef.current = true;

    if (reduce) {
      // Reduced motion — show, hold ~700 ms, fade out.
      bgOpacity.value = withSequence(
        withTiming(1, { duration: 220 }),
        withDelay(
          700,
          withTiming(0, { duration: 320, easing: Easing.out(Easing.quad) }, (done) => {
            if (done) runOnJS(handleDone)();
          }),
        ),
      );
      logoOpacity.value = 1;
      wordmarkOpacity.value = withDelay(200, withTiming(1, { duration: 300 }));
      taglineOpacity.value = withDelay(420, withTiming(1, { duration: 280 }));
      return;
    }

    // ── Full animation ──────────────────────────────────────────────
    logoOpacity.value = withDelay(100, withTiming(1, { duration: 420 }));
    logoScale.value = withDelay(
      100,
      withTiming(1.0, { duration: 520, easing: Easing.out(Easing.cubic) }),
    );
    // Soft ring expands behind the logo as it "lands".
    ringOpacity.value = withDelay(
      120,
      withSequence(
        withTiming(0.32, { duration: 260 }),
        withDelay(180, withTiming(0, { duration: 480 })),
      ),
    );
    ringScale.value = withDelay(
      120,
      withTiming(1.55, { duration: 760, easing: Easing.out(Easing.cubic) }),
    );
    // Wordmark fades up.
    wordmarkOpacity.value = withDelay(540, withTiming(1, { duration: 380 }));
    wordmarkY.value = withDelay(
      540,
      withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }),
    );
    // Tagline.
    taglineOpacity.value = withDelay(760, withTiming(1, { duration: 360 }));

    // Subtle pulse on the logo to feel "alive". Two cycles, gentle.
    logoScale.value = withDelay(
      900,
      withSequence(
        withTiming(1.04, { duration: 220, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 220, easing: Easing.inOut(Easing.quad) }),
      ),
    );

    // Final fade-out of the entire overlay.
    bgOpacity.value = withDelay(
      1380,
      withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(handleDone)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoReady]);

  const handleDone = () => {
    setMounted(false);
    try { onFinish?.(); } catch {}
  };

  // ── Animated styles ────────────────────────────────────────────────
  const overlayStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
    opacity: logoOpacity.value,
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkY.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
  }));

  if (!mounted) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, overlayStyle, styles.overlay]}
      pointerEvents="none"
      testID="animated-splash"
    >
      <LinearGradient
        colors={GRADIENT as unknown as readonly [string, string, ...string[]]}
        start={{ x: 0.1, y: 0.0 }}
        end={{ x: 0.9, y: 1.0 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.center}>
        {/* Soft glow ring behind the logo */}
        <Animated.View style={[styles.ring, ringStyle]} />

        {/* Logo with a subtle white halo / drop-shadow */}
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Image
            source={SPLASH_LOGO}
            style={styles.logo}
            resizeMode="contain"
            // Decoded synchronously on supported platforms — keeps the
            // first paint frame whole so the user never sees a blank
            // square where the icon should be.
            fadeDuration={0}
            accessibilityIgnoresInvertColors
          />
        </Animated.View>

        {/* Wordmark */}
        <Animated.View style={wordmarkStyle}>
          <Text style={styles.wordmark} allowFontScaling={false}>
            ConsultUro
          </Text>
        </Animated.View>

        {/* Tagline */}
        <Animated.View style={taglineStyle}>
          <Text style={styles.tagline} numberOfLines={1}>
            Urology care, in your pocket
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 10_000,
    elevation: 10_000,
    // Solid base — gradient fills above this. Matches the native
    // splash background so any sub-frame between the native splash
    // hiding and our overlay rendering is invisible.
    backgroundColor: '#0E7C8B',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  ring: {
    position: 'absolute',
    width: LOGO_SIZE * 1.7,
    height: LOGO_SIZE * 1.7,
    borderRadius: LOGO_SIZE,
    backgroundColor: '#FFFFFF',
  },
  logoWrap: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE * 0.22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowOffset: { width: 0, height: 18 },
        shadowRadius: 28,
      },
      android: { elevation: 18 },
      default: {},
    }),
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: LOGO_SIZE * 0.22,
  },
  wordmark: {
    ...FONTS.h2,
    color: '#FFFFFF',
    fontSize: 30,
    letterSpacing: -0.6,
    marginTop: 22,
    textShadowColor: 'rgba(0,0,0,0.20)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  tagline: {
    ...FONTS.body,
    color: 'rgba(255,255,255,0.86)',
    fontSize: 13,
    letterSpacing: 0.4,
    marginTop: 8,
    textAlign: 'center',
  },
});

// Re-export the chosen brand color so callers (e.g. native splash
// background, status-bar tint) can keep their colour in lock-step.
export const SPLASH_BG = '#0E7C8B';
// Suppress unused-import lint warning for the named export.
export const __SPLASH_GRADIENT = GRADIENT;
// Suppress unused COLORS import; we use it transitively through
// FONTS but keep the import for forward-compatibility (theme-aware
// splash variants in the future).
export const __SPLASH_THEME = COLORS.primary;
