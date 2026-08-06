// Catch-all 404 route.
//
// Expo Router falls back here when a deep link or browser URL doesn't
// match any of the registered file-based routes. For ConsultUro this
// shouldn't normally happen, but we DO see it occasionally when:
//   • A magic-link email opens the OS browser before the app is
//     installed (e.g. tapping the link from a desktop browser without
//     the APK).
//   • The native `consulturo://...` deep link is mis-parsed and the
//     OS hands the URL to expo-router as a foreign route.
//
// Rather than show a hard 404, we try to recover by sniffing the URL
// for a ?token=… parameter (magic-link) or ?session_id=… (Google
// OAuth) and forwarding the user to the right screen. Failing that
// we render a friendly fallback with a "Back to sign in" CTA.

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const u = new URL(window.location.href);
      const token = u.searchParams.get('token');
      if (token) {
        router.replace({ pathname: '/magic-link', params: { token } } as any);
        return;
      }
      const sid = u.searchParams.get('session_id');
      if (sid) {
        router.replace({ pathname: '/auth-callback', params: { session_id: sid } } as any);
        return;
      }
      // Common deep-link path remnants: e.g. "/magic-link/abc?token=..."
      // — Expo Router web sometimes 404s on trailing-segment links.
      if (/magic-link/i.test(u.pathname) && token) {
        router.replace({ pathname: '/magic-link', params: { token } } as any);
        return;
      }
    } catch {
      // No-op — render the fallback below.
    }
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.c}>
        <Text style={styles.emoji}>🔎</Text>
        <Text style={styles.title}>This page could not be found</Text>
        <Text style={styles.body}>
          The link you followed may have expired, been mistyped, or was meant
          for a different screen. Please head back to sign in or try again
          from the app.
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/')}>
          <Text style={styles.btnText}>Back to home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.altBtn]} onPress={() => router.replace('/login')}>
          <Text style={[styles.btnText, { color: COLORS.primary }]}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.bg, gap: 12 },
  emoji: { fontSize: 56, marginBottom: 6 },
  title: { ...FONTS.h3, color: COLORS.textPrimary, textAlign: 'center' },
  body: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 8, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: RADIUS.pill, minWidth: 220, alignItems: 'center' },
  altBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.primary },
  btnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
});
