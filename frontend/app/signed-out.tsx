/**
 * Signed-Out landing — Phase 5.25.
 *
 * Shown immediately after `signOut()`. Gives the user a clean choice
 * instead of dropping them onto a stale logged-in screen or the
 * login modal abruptly:
 *
 *   1. "Go to Homepage" → public patient home (/)
 *   2. "Login Again"   → /login
 *
 * Pleasant gradient hero with the ConsultUro brand mark so this never
 * feels like a dead-end.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { haptics } from '../src/haptics';
import { useDarkOverrides } from '../src/dark-mode';

export default function SignedOut() {
  const router = useRouter();
  const d = useDarkOverrides();

  const goHome = () => {
    haptics.select();
    router.replace('/' as any);
  };
  const goLogin = () => {
    haptics.select();
    router.replace('/login' as any);
  };

  return (
    <SafeAreaView style={[styles.root, d.screen]} edges={['top', 'bottom']}>
      <LinearGradient
        colors={COLORS.heroGradient as any}
        style={styles.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.logoBubble}>
          <Ionicons name="checkmark-circle" size={48} color="#fff" />
        </View>
        <Text style={styles.title}>You've been signed out</Text>
        <Text style={styles.subtitle}>
          Thank you for using ConsultUro. Where would you like to go next?
        </Text>
      </LinearGradient>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={goHome}
          activeOpacity={0.85}
          testID="signed-out-home"
        >
          <Ionicons name="home" size={20} color="#fff" />
          <Text style={[styles.btnText, { color: '#fff' }]}>Go to Homepage</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary, d.surface]}
          onPress={goLogin}
          activeOpacity={0.85}
          testID="signed-out-login"
        >
          <Ionicons name="log-in" size={20} color={COLORS.primary} />
          <Text style={[styles.btnText, { color: COLORS.primary }]}>Login Again</Text>
        </TouchableOpacity>

        <Text style={[styles.footer, d.textS]}>
          Your session has been securely ended on this device.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  hero: {
    paddingVertical: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  logoBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    marginBottom: 20,
  },
  title: {
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: '#fff',
    fontSize: 22,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    fontFamily: FONTS.regular,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 8,
    maxWidth: 420,
  },
  actions: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 36,
    gap: 14,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    gap: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  btnPrimary: {
    backgroundColor: COLORS.primary,
  },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  btnText: {
    fontFamily: FONTS.bold,
    fontWeight: '700',
    fontSize: 15,
  },
  footer: {
    marginTop: 18,
    textAlign: 'center',
    color: COLORS.textSecondary,
    fontFamily: FONTS.regular,
    fontSize: 12,
  },
});
