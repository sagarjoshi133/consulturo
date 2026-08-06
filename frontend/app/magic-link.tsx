// Web magic-link landing route.
//
// The backend's /auth/magic/redirect bridge bounces here when the user
// taps a magic-link email AND the native app isn't installed (so the
// `consulturo://` deep link fails). We read ?token=… from the URL,
// exchange it via /api/auth/magic/exchange, save the session_token,
// and route the user into the app — same behavior as on native.
//
// This route also works on the installed APK (Expo Router will pick up
// `consulturo://magic-link?token=…` because we registered the path),
// but in practice native uses the deep-link listener in src/auth.tsx.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import api from '../src/api';
import { useAuth } from '../src/auth';

export default function MagicLink() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { refresh } = useAuth();
  const ran = useRef(false);
  const [status, setStatus] = useState<'running' | 'success' | 'error'>('running');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const run = async () => {
      // Recover token from ?query (web) or expo-router params (native).
      let token = (params.token as string | undefined) || '';
      if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
        try {
          const u = new URL(window.location.href);
          token = u.searchParams.get('token') || '';
        } catch {}
      }
      if (!token) {
        setStatus('error');
        setErr('No sign-in token in the link. Please request a new magic link.');
        return;
      }
      try {
        const { data } = await api.post('/auth/magic/exchange', { token });
        await AsyncStorage.setItem('session_token', data.session_token);
        await refresh();
        // Strip the token from the URL bar so a refresh doesn't re-fire.
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try { window.history.replaceState(null, '', '/'); } catch {}
        }
        setStatus('success');
        router.replace('/(tabs)');
      } catch (e: any) {
        setStatus('error');
        setErr(
          e?.response?.data?.detail ||
            'This link is no longer valid. Please request a fresh magic link.'
        );
      }
    };
    run();
  }, []);

  if (status === 'error') {
    return (
      <View style={styles.c}>
        <Text style={styles.title}>Couldn't sign you in</Text>
        <Text style={styles.body}>{err}</Text>
        <TouchableOpacity style={styles.btn} onPress={() => router.replace('/login')}>
          <Text style={styles.btnText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.c}>
      <ActivityIndicator color={COLORS.primary} size="large" />
      <Text style={styles.body}>Signing you in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg, padding: 24, gap: 14 },
  title: { ...FONTS.h3, color: COLORS.textPrimary, textAlign: 'center' },
  body: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
  btn: { marginTop: 16, backgroundColor: COLORS.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: RADIUS.pill },
  btnText: { color: '#fff', ...FONTS.bodyMedium },
});
