import React, { useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Platform, TouchableOpacity, Linking as RNLinking } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { isDrClassError } from '../src/backend-health';

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
  const [errorKind, setErrorKind] = useState<'generic' | 'backend_down' | 'no_session'>('generic');
  const [status, setStatus] = useState<'running' | 'exchanging' | 'success' | 'error'>('running');

  // Retry the same exchange flow without bouncing back to /login.
  const retry = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try { window.location.reload(); return; } catch {}
    }
    processed.current = false;
    setStatus('running');
    setError('');
  };

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
        setErrorKind('no_session');
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
        const status520 = e?.response?.status;
        const isBackendDown = isDrClassError(e);
        const msg = e?.response?.data?.detail || e?.message || 'Session exchange failed';
        setStatus('error');
        if (isBackendDown) {
          setErrorKind('backend_down');
          setError(
            status520
              ? `Our server is temporarily unavailable (HTTP ${status520}). This usually clears within a minute or two.`
              : 'Could not reach our server. Please check your internet connection and try again.'
          );
        } else {
          setErrorKind('generic');
          setError(`Could not complete sign-in: ${msg}`);
        }
      }
    };
    run();
  }, []);

  if (status === 'error') {
    const isBackendDown = errorKind === 'backend_down';
    const icon = isBackendDown ? 'cloud-offline' : 'alert-circle';
    const color = isBackendDown ? '#F59E0B' : COLORS.primary;
    return (
      <View style={styles.c}>
        <View style={[styles.iconWrap, { backgroundColor: color + '18' }]}>
          <Ionicons name={icon as any} size={36} color={color} />
        </View>
        <Text style={styles.errTitle}>
          {isBackendDown ? 'Service temporarily unavailable' : "Sign-in couldn't complete"}
        </Text>
        <Text style={styles.err}>{error}</Text>
        {isBackendDown ? (
          <Text style={styles.hint}>
            Tip: tap "Try again" — the app will automatically use a backup server if our main service is down.
          </Text>
        ) : null}
        <View style={styles.btnRow}>
          <TouchableOpacity
            onPress={retry}
            style={[styles.btn, { backgroundColor: color }]}
            testID="auth-retry"
          >
            <Ionicons name="refresh" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.replace('/login')}
            style={styles.btnGhost}
            testID="auth-back-login"
          >
            <Text style={styles.btnGhostText}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
        {isBackendDown ? (
          <TouchableOpacity
            onPress={() => RNLinking.openURL('mailto:support@emergent.sh?subject=ConsultUro%20backend%20down').catch(() => {})}
            style={{ marginTop: 8 }}
          >
            <Text style={styles.linkText}>Contact support →</Text>
          </TouchableOpacity>
        ) : null}
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
  errTitle: { ...FONTS.h3, color: COLORS.textPrimary, textAlign: 'center', maxWidth: 320 },
  err: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 360,
    lineHeight: 21,
  },
  hint: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textDisabled,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: -4,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  btnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 15 },
  btnGhost: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnGhostText: { color: COLORS.textPrimary, ...FONTS.bodyMedium, fontSize: 14 },
  linkText: { color: COLORS.primary, ...FONTS.bodyMedium, fontSize: 12 },
});
