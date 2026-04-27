// In-app WebView Google sign-in. Replaces the Custom-Tabs flow when that's
// failing on a particular Android device — we fully own the navigation,
// intercept the redirect to /auth-callback, extract the session_id and
// exchange it ourselves. No deep-links, no polling, no Custom Tabs.

import React, { useState, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api, { API_BASE } from './api';
import { COLORS, FONTS } from './theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function WebViewSignIn({ visible, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [exchanging, setExchanging] = useState(false);
  const [err, setErr] = useState('');
  const exchangedRef = useRef(false);
  const insets = useSafeAreaInsets();

  // We point the WebView's redirect at the /auth-callback HTML bridge —
  // it serves a tiny page that runs JS we then INTERCEPT in the URL handler.
  const backend = API_BASE.replace(/\/api$/, '');
  const redirect = `${backend}/auth-callback/__webview__`;
  const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;

  const handleNav = async (req: { url: string }) => {
    if (exchangedRef.current) return false;
    const url = req.url || '';
    // Look for ?session_id= or #session_id= anywhere in the URL.
    const m = url.match(/session_id=([^&#]+)/);
    if (m && url.includes('/auth-callback')) {
      exchangedRef.current = true;
      setExchanging(true);
      setErr('');
      try {
        const sid = decodeURIComponent(m[1]);
        const { data } = await api.post('/auth/session', { session_id: sid });
        await AsyncStorage.setItem('session_token', data.session_token);
        onSuccess();
      } catch (e: any) {
        setErr(e?.response?.data?.detail || 'Sign-in failed. Please try again.');
        exchangedRef.current = false;
      } finally {
        setExchanging(false);
      }
      return false; // block the WebView from navigating further
    }
    return true;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="webview-signin-close">
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Sign in with Google</Text>
          <View style={{ width: 36 }} />
        </View>

        {visible && (
          <WebView
            source={{ uri: authUrl }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onShouldStartLoadWithRequest={handleNav as any}
            onNavigationStateChange={(nav) => { handleNav({ url: nav.url }); }}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            originWhitelist={['*']}
            testID="webview-signin"
          />
        )}

        {(loading || exchanging) && (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator color={COLORS.primary} size="large" />
            <Text style={styles.overlayText}>
              {exchanging ? 'Signing you in…' : 'Loading…'}
            </Text>
          </View>
        )}

        {err ? (
          <View style={styles.errBar}>
            <Ionicons name="alert-circle" size={16} color="#fff" />
            <Text style={styles.errText}>{err}</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 16 },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  overlayText: { ...FONTS.bodyMedium, color: COLORS.primary, marginTop: 12, fontSize: 14 },
  errBar: {
    position: 'absolute', bottom: 24, left: 16, right: 16,
    backgroundColor: COLORS.accent, padding: 12, borderRadius: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errText: { ...FONTS.bodyMedium, color: '#fff', flex: 1, fontSize: 13 },
});
