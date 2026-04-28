// Login — revamped, compact layout that respects device safe areas
// (notch, status bar AND the bottom navigation / gesture inset).
//
// Design goals:
//  • One hero CTA (Google) with a tasteful, compact size — not oversized.
//  • Alternative sign-in methods appear as a clean grid of small cards
//    (Phone, WebView, Email Link, Email OTP, Guest) so they're glanceable
//    and thumb-friendly without dominating the screen.
//  • Uses ScrollView with `contentContainerStyle` so on shorter devices
//    nothing gets clipped, and SafeAreaView with edges=['top','bottom']
//    so we never collide with system gesture bars or notches.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Platform,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, LOGO_URL, RADIUS } from '../src/theme';
import { useAuth } from '../src/auth';
import api, { API_BASE } from '../src/api';
import { haptics } from '../src/haptics';
import EmailAuthModal, { EmailAuthMode } from '../src/email-auth';
import WebViewSignIn from '../src/webview-signin';
import PhoneAuthModal from '../src/phone-auth';

// Lightweight UUID-v4-ish — good enough for one-time-use handoff ids.
function makeHandoffId(): string {
  try {
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const buf = new Uint8Array(16);
      c.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;
      const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {}
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

const SCREEN_H = Dimensions.get('window').height;
import { useResponsive } from '../src/responsive';

const COMPACT = SCREEN_H < 720; // small phones (e.g., iPhone SE)

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, exchangeSessionId, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [emailMode, setEmailMode] = useState<EmailAuthMode | null>(null);
  const [showWebView, setShowWebView] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  // Desktop: render the auth surface as a centered 480-wide premium
  // card on a themed background. Mobile keeps the original full-
  // screen look.
  const r = useResponsive();
  const isDesktop = r.isWebDesktop;

  const onAlternativeSuccess = async () => {
    await refresh();
    setEmailMode(null);
    setShowWebView(false);
    setShowPhone(false);
    router.replace('/(tabs)');
  };

  useEffect(() => {
    if (user) router.replace('/(tabs)');
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [user]);

  const pollHandoff = (handoffId: string, onReady: () => void) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 300) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      try {
        const r = await api.get(`/auth/handoff/${handoffId}`);
        if (r?.data?.status === 'ready' && r.data.session_token) {
          await AsyncStorage.setItem('session_token', r.data.session_token);
          if (pollRef.current) clearInterval(pollRef.current);
          await refresh();
          try { WebBrowser.dismissAuthSession(); } catch {}
          onReady();
        }
      } catch {}
    }, 1000);
  };

  const lastHandoffRef = useRef<string>('');
  const [showManualCheck, setShowManualCheck] = useState(false);
  useEffect(() => {
    if (!busy) { setShowManualCheck(false); return; }
    const t = setTimeout(() => setShowManualCheck(true), 10000);
    return () => clearTimeout(t);
  }, [busy]);
  const manualCheck = async () => {
    const handoffId = lastHandoffRef.current;
    if (!handoffId) {
      try { WebBrowser.dismissAuthSession(); } catch {}
      await refresh();
      if (user) router.replace('/(tabs)');
      return;
    }
    try {
      const r = await api.get(`/auth/handoff/${handoffId}`);
      if (r?.data?.status === 'ready' && r.data.session_token) {
        await AsyncStorage.setItem('session_token', r.data.session_token);
        await refresh();
        try { WebBrowser.dismissAuthSession(); } catch {}
        router.replace('/(tabs)');
      } else {
        await refresh();
        if (user) router.replace('/(tabs)');
      }
    } catch {
      await refresh();
      if (user) router.replace('/(tabs)');
    }
  };

  const handleGoogleLogin = async () => {
    haptics.medium();
    if (Platform.OS === 'web') {
      const redirectUrl = window.location.origin + '/auth-callback';
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
      setBusy(true);
      window.location.href = authUrl;
      return;
    }
    const backend = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    let handoffId = '';
    try {
      handoffId = makeHandoffId();
      await api.post('/auth/handoff/init', { handoff_id: handoffId });
    } catch {
      handoffId = '';
    }
    const httpsRedirect = `${backend}/auth-callback${handoffId ? `/${encodeURIComponent(handoffId)}` : ''}`;
    // Use the TRIPLE-slash form so Expo Router treats `auth-callback` as
    // a PATH (not a host). With `consulturo://auth-callback?...` some
    // Android builds parse `auth-callback` as the host, miss the route
    // and crash (or fall back to the unmatched-route page). The
    // `consulturo:///auth-callback?...` form unambiguously routes to
    // /app/auth-callback.tsx.
    const deepReturn = 'consulturo:///auth-callback';
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(httpsRedirect)}`;
    setBusy(true);
    let pollResolved = false;
    if (handoffId) {
      lastHandoffRef.current = handoffId;
      pollHandoff(handoffId, () => {
        pollResolved = true;
        router.replace('/(tabs)');
      });
    }
    try {
      const result = await WebBrowser.openAuthSessionAsync(authUrl, deepReturn);
      if (pollResolved) return;
      if (result.type === 'success' && result.url) {
        const m = result.url.match(/session_id=([^&#]+)/);
        if (m && m[1]) {
          await exchangeSessionId(m[1]);
          router.replace('/(tabs)');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    haptics.tap();
    router.replace('/(tabs)');
  };

  // Alternative sign-in methods rendered as compact, glanceable cards.
  // We always render Phone — if web, it's disabled with an "App only" hint
  // so users on the web preview can still SEE the option exists.
  type Method = {
    key: string;
    label: string;
    sub: string;
    icon: keyof typeof Ionicons.glyphMap;
    bg: string;
    fg: string;
    onPress: () => void;
    disabled?: boolean;
    testID: string;
  };

  const methods: Method[] = [
    {
      key: 'phone',
      label: 'Phone (SMS)',
      sub: 'OTP via SMS',
      icon: 'call',
      bg: '#16A6B8' + '14',
      fg: '#0E7C8B',
      onPress: () => { haptics.tap(); setShowPhone(true); },
      testID: 'login-phone',
    },
    {
      key: 'magic',
      label: 'Email Link',
      sub: 'Tap link in email',
      icon: 'link',
      bg: '#7C3AED' + '14',
      fg: '#7C3AED',
      onPress: () => { haptics.tap(); setEmailMode('magic'); },
      testID: 'login-magic',
    },
    {
      key: 'otp',
      label: 'Email Code',
      sub: '6-digit OTP',
      icon: 'keypad',
      bg: '#0EA5E9' + '14',
      fg: '#0284C7',
      onPress: () => { haptics.tap(); setEmailMode('otp'); },
      testID: 'login-otp',
    },
    ...(Platform.OS !== 'web' ? [{
      key: 'webview',
      label: 'WebView',
      sub: 'Google, in-app',
      icon: 'logo-google' as any,
      bg: '#EA4335' + '14',
      fg: '#EA4335',
      onPress: () => { haptics.tap(); setShowWebView(true); },
      testID: 'login-webview',
    }] : []),
  ];

  return (
    <LinearGradient colors={COLORS.heroGradient} style={{ flex: 1 }}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 8) + 8 },
            isDesktop && {
              // Desktop: center a premium card in a 480-wide column
              // on a subtle themed background. Mobile unchanged.
              maxWidth: 480,
              alignSelf: 'center',
              width: '100%',
              marginTop: 36,
              marginBottom: 36,
              backgroundColor: '#fff',
              borderRadius: 20,
              padding: 32,
              shadowColor: '#0B3142',
              shadowOpacity: 0.12,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 12 },
              elevation: 8,
            } as any,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand header — compact on small phones */}
          <View style={[styles.top, COMPACT && { marginTop: 12, paddingHorizontal: 20 }]}>
            <Image
              source={{ uri: LOGO_URL }}
              style={[styles.logo, COMPACT && { width: 78, height: 78, borderRadius: 20 }]}
            />
            <Text style={[styles.brand, COMPACT && { fontSize: 26, marginTop: 12 }]}>ConsultUro</Text>
            <Text style={styles.tagline}>Dr. Sagar Joshi</Text>
            <Text style={styles.sub} numberOfLines={2}>
              Consultant Urologist · Laparoscopic & Transplant Surgeon
            </Text>
          </View>

          {/* White rounded card */}
          <View style={styles.card}>
            <Text style={styles.welcome}>Welcome</Text>
            <Text style={styles.welcomeSub}>
              Sign in to book consultations, get prescriptions and more.
            </Text>

            {/* Hero CTA — compact, properly sized */}
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={handleGoogleLogin}
              testID="login-google-button"
              style={[styles.heroBtn, busy && { opacity: 0.7 }]}
              disabled={busy}
            >
              <LinearGradient
                colors={COLORS.gradient}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.heroBtnInner}
              >
                <Ionicons name="logo-google" size={18} color="#fff" />
                <Text style={styles.heroBtnText}>
                  {busy ? 'Opening browser…' : 'Continue with Google'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            {busy ? (
              <Text style={styles.hint} testID="login-hint" numberOfLines={2}>
                After signing in, return here — we'll auto-detect.
              </Text>
            ) : null}

            {showManualCheck ? (
              <TouchableOpacity
                onPress={manualCheck}
                testID="login-manual-check"
                style={styles.manualCheckBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh" size={14} color={COLORS.primary} />
                <Text style={styles.manualCheckText}>I've signed in — sync now</Text>
              </TouchableOpacity>
            ) : null}

            {/* Divider */}
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR USE</Text>
              <View style={styles.orLine} />
            </View>

            {/* Method grid — 2 columns of compact cards */}
            <View style={styles.methodGrid}>
              {methods.map((m) => (
                <TouchableOpacity
                  key={m.key}
                  onPress={m.onPress}
                  disabled={m.disabled}
                  activeOpacity={0.82}
                  testID={m.testID}
                  style={[
                    styles.methodCard,
                    { backgroundColor: m.bg },
                    m.disabled && { opacity: 0.45 },
                  ]}
                >
                  <View style={[styles.methodIcon, { backgroundColor: m.fg + '20' }]}>
                    <Ionicons name={m.icon} size={18} color={m.fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.methodLabel, { color: m.fg }]} numberOfLines={1}>
                      {m.label}
                    </Text>
                    <Text style={styles.methodSub} numberOfLines={1}>{m.sub}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Guest — minimal, secondary */}
            <TouchableOpacity
              onPress={handleSkip}
              testID="login-guest-button"
              style={styles.guestBtn}
              activeOpacity={0.75}
            >
              <Ionicons name="person-outline" size={15} color={COLORS.textSecondary} />
              <Text style={styles.guestText}>Continue as guest</Text>
            </TouchableOpacity>

            <Text style={styles.legal}>
              By continuing, you agree to the Terms & Privacy Policy.
            </Text>
            <Text style={styles.debugStrip} numberOfLines={1} testID="login-debug-strip">
              v1.0.6 · {API_BASE.replace('https://', '').replace('/api', '')}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Modals */}
      <EmailAuthModal
        visible={emailMode !== null}
        mode={emailMode}
        onClose={() => setEmailMode(null)}
        onSuccess={onAlternativeSuccess}
      />
      <WebViewSignIn
        visible={showWebView}
        onClose={() => setShowWebView(false)}
        onSuccess={onAlternativeSuccess}
      />
      <PhoneAuthModal
        visible={showPhone}
        onClose={() => setShowPhone(false)}
        onSuccess={onAlternativeSuccess}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  top: {
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  logo: {
    width: 92,
    height: 92,
    borderRadius: 22,
    backgroundColor: '#fff',
  },
  brand: {
    ...FONTS.h1,
    color: '#fff',
    marginTop: 14,
    fontSize: 30,
  },
  tagline: {
    ...FONTS.h4,
    color: '#E0F7FA',
    marginTop: 4,
    fontSize: 14,
  },
  sub: {
    ...FONTS.body,
    color: '#E0F7FA',
    textAlign: 'center',
    marginTop: 3,
    opacity: 0.9,
    fontSize: 12,
    maxWidth: 320,
    lineHeight: 16,
  },

  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
  },
  welcome: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 22 },
  welcomeSub: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
  },

  // Hero Google button — compact (~46px tall) but prominent
  heroBtn: {
    marginTop: 18,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
      },
      android: { elevation: 3 },
    }),
  },
  heroBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    paddingHorizontal: 18,
    gap: 8,
  },
  heroBtnText: {
    color: '#fff',
    fontSize: 15,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.2,
  },

  hint: {
    ...FONTS.body,
    color: COLORS.primary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
    lineHeight: 16,
  },

  manualCheckBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
  },
  manualCheckText: {
    color: COLORS.primary,
    fontSize: 12,
    fontFamily: 'Manrope_700Bold',
  },

  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 12,
    gap: 10,
  },
  orLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  orText: {
    ...FONTS.label,
    color: COLORS.textDisabled,
    fontSize: 10,
    letterSpacing: 1.2,
  },

  // 2-column grid of compact method cards
  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  methodCard: {
    flexBasis: '47.5%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: RADIUS.lg,
    minHeight: 56,
  },
  methodIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodLabel: {
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
  },
  methodSub: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 10.5,
    marginTop: 1,
  },

  guestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 9,
  },
  guestText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: 'DMSans_500Medium',
  },

  legal: {
    ...FONTS.body,
    color: COLORS.textDisabled,
    textAlign: 'center',
    marginTop: 6,
    fontSize: 11,
    lineHeight: 15,
  },
  debugStrip: {
    ...FONTS.body,
    color: COLORS.textDisabled,
    textAlign: 'center',
    marginTop: 4,
    fontSize: 9.5,
    opacity: 0.7,
  },
});
