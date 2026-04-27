import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH

// Synchronously (before any effect runs) sniff the URL for a session_id. The
// Emergent OAuth playbook specifically calls this out: useEffect runs AFTER
// first render which is too late and causes a race against AuthProvider's
// /auth/me check.
function getSessionIdFromWindow(): { id: string | null; seen: string } {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { id: null, seen: '' };
  }
  const seen = window.location.href || '';
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const m = (hash + '&' + search).match(/session_id=([^&]+)/);
  return { id: m ? decodeURIComponent(m[1]) : null, seen };
}

export default function AuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const { exchangeSessionId } = useAuth();
  const processed = useRef(false);
  // Capture synchronously — before the first paint / any effect.
  const syncSniff = useRef(getSessionIdFromWindow());
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<'running' | 'exchanging' | 'success' | 'error'>('running');

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const run = async () => {
      let sessionId =
        (params.session_id as string | undefined) || syncSniff.current.id || undefined;
      let urlSeen = syncSniff.current.seen;

      if (!sessionId) {
        try {
          const initial = await Linking.getInitialURL();
          if (initial) {
            urlSeen = urlSeen || initial;
            const m = initial.match(/session_id=([^&#]+)/);
            if (m) sessionId = m[1];
          }
        } catch {}
      }

      if (!sessionId) {
        setStatus('error');
        setError(
          urlSeen
            ? `No session_id found in callback URL:\n${urlSeen}`
            : 'No session_id found in the callback URL.'
        );
        return;
      }

      try {
        setStatus('exchanging');
        await exchangeSessionId(sessionId);
        // Strip the fragment so a refresh does not re-trigger us.
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            window.history.replaceState(null, '', window.location.pathname);
          } catch {}
        }
        setStatus('success');
        router.replace('/(tabs)');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || e?.message || 'Session exchange failed';
        setStatus('error');
        setError(`Could not complete sign-in: ${msg}`);
      }
    };
    run();
  }, []);

  if (status === 'error') {
    return (
      <View style={styles.c}>
        <Text style={styles.errTitle}>Sign-in couldn't complete</Text>
        <Text style={styles.err}>{error}</Text>
        <TouchableOpacity
          onPress={() => router.replace('/login')}
          style={styles.btn}
          testID="auth-back-login"
        >
          <Text style={styles.btnText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.c}>
      <ActivityIndicator color={COLORS.primary} size="large" />
      <Text style={styles.t}>
        {status === 'exchanging' ? 'Completing sign-in…' : 'Signing you in…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
    gap: 16,
    padding: 24,
  },
  t: { ...FONTS.body, color: COLORS.textSecondary },
  errTitle: { ...FONTS.h3, color: COLORS.textPrimary, textAlign: 'center' },
  err: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  btn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  btnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 15 },
});
