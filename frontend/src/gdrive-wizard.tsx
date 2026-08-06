/**
 * Google Drive backup mirror — in-app OAuth wizard.
 *
 * Flow (one-tap):
 *  1. Configure OAuth client (one-time) — owner pastes the client_id
 *     and client_secret from their Google Cloud OAuth credential.
 *     The redirect URI to register in Google is shown right above
 *     the fields so the user can copy it.
 *  2. Authorize — tap the button, backend builds a Google OAuth URL
 *     with a one-time state, frontend opens it in the device
 *     browser. User signs in, taps Allow.
 *  3. Google redirects to our backend `/oauth/callback`, which
 *     exchanges the code, writes rclone.conf, persists env, and
 *     renders an HTML success page with a `consulturo://` deep link
 *     back to the app.
 *  4. Wizard polls `/mirror/info` every 3 s on focus — when
 *     `configured` flips to true, we show the success card.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Platform,
  Alert,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConnected?: () => void;
};

type ClientResp = {
  configured: boolean;
  client_id: string | null;
  redirect_uri: string;
  public_backend_url: string;
};

type InfoResp = {
  rclone_installed: boolean;
  has_gdrive_remote: boolean;
  configured: boolean;
  current_mode: string;
  current_remote: string;
};

export default function GDriveWizard({ visible, onClose, onConnected }: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientResp | null>(null);
  const [info, setInfo] = useState<InfoResp | null>(null);
  const [step, setStep] = useState<'client' | 'authorize' | 'done'>('client');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [folder, setFolder] = useState('consulturo-backups');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStarted, setAuthStarted] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([
        api.get<ClientResp>('/admin/backup/mirror/oauth/client'),
        api.get<InfoResp>('/admin/backup/mirror/info'),
      ]);
      setClient(c.data);
      setInfo(i.data);
      // Decide step from current state.
      if (i.data.configured) setStep('done');
      else if (c.data.configured) setStep('authorize');
      else setStep('client');
      return i.data;
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load wizard state.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setAuthStarted(false);
    void refreshStatus();
  }, [visible, refreshStatus]);

  // Poll while the user is in the authorize step waiting for callback.
  useEffect(() => {
    if (!visible || !authStarted) return;
    const id = setInterval(async () => {
      const fresh = await refreshStatus();
      if (fresh?.configured) {
        clearInterval(id);
        onConnected?.();
      }
    }, 3000);
    return () => clearInterval(id);
  }, [visible, authStarted, refreshStatus, onConnected]);

  const saveClient = async () => {
    setError(null);
    if (!clientId.trim() || !clientSecret.trim()) {
      setError('Both Client ID and Client Secret are required.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/backup/mirror/oauth/client', {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      });
      setClientId('');
      setClientSecret('');
      await refreshStatus();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not save client.');
    } finally {
      setBusy(false);
    }
  };

  const startAuthorize = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api.get<{ authorize_url: string }>(
        '/admin/backup/mirror/oauth/url',
        { params: { folder: folder.trim() || 'consulturo-backups' } }
      );
      await Linking.openURL(r.data.authorize_url);
      setAuthStarted(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not start authorization.');
    } finally {
      setBusy(false);
    }
  };

  const copyRedirectUri = async () => {
    const uri = client?.redirect_uri || '';
    if (!uri) return;
    try {
      if (Platform.OS === 'web') {
        await (navigator as any).clipboard?.writeText(uri);
      } else {
        // RN's Clipboard is deprecated but still works on most devices;
        // wrap so it never crashes if the host doesn't expose it.
        (Clipboard as any).setString?.(uri);
      }
      if (Platform.OS === 'web') {
        // eslint-disable-next-line no-alert, no-undef
        window.alert('Redirect URI copied. Paste it in Google Cloud Console → Authorized redirect URIs.');
      } else {
        Alert.alert('Copied', 'Paste the URI in Google Cloud Console → Authorized redirect URIs.');
      }
    } catch {
      /* swallow */
    }
  };

  const disconnect = async () => {
    const proceed = async () => {
      setBusy(true);
      try {
        await api.post('/admin/backup/mirror/disconnect');
        await refreshStatus();
        onConnected?.();
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Could not disconnect.');
      } finally {
        setBusy(false);
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert, no-undef
      if (typeof window !== 'undefined' && window.confirm('Disconnect Google Drive mirror? Local backups continue.')) {
        void proceed();
      }
      return;
    }
    Alert.alert(
      'Disconnect Google Drive?',
      'Backups will continue to be saved locally — only the off-host mirror stops.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => { void proceed(); } },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.bar}>
          <TouchableOpacity onPress={onClose} style={styles.back} testID="gdrive-close">
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Google Drive backup</Text>
          <TouchableOpacity onPress={() => setShowHelp(s => !s)} style={styles.back} testID="gdrive-help">
            <Ionicons name="help-circle-outline" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Steps strip */}
          {step !== 'done' && (
            <View style={styles.steps}>
              <StepDot n={1} active={step === 'client'} done={step !== 'client'} label="OAuth client" />
              <View style={styles.stepSep} />
              <StepDot n={2} active={step === 'authorize'} done={false} label="Authorize" />
              <View style={styles.stepSep} />
              <StepDot n={3} active={false} done={false} label="Done" />
            </View>
          )}

          {/* Help/explainer */}
          {showHelp && (
            <View style={styles.help}>
              <Text style={styles.helpTitle}>How this works</Text>
              <Text style={styles.helpBody}>
                ConsultUro uses your own Google Cloud OAuth credential to push the daily backup archive into your Drive. You'll need to (1) create a Google Cloud project, (2) enable the Drive API, (3) create an OAuth client (Web application type), and (4) paste the Client ID + Secret here.
              </Text>
              <TouchableOpacity
                onPress={() => { onClose(); setTimeout(() => router.push('/admin/backup-setup-guide' as any), 250); }}
                style={styles.helpCta}
                testID="gdrive-open-guide"
              >
                <Ionicons name="book-outline" size={14} color="#fff" />
                <Text style={styles.helpCtaText}>  Open full 5-minute setup guide</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Step 1: OAuth client setup ───────────────────── */}
          {step === 'client' && (
            <>
              <Text style={styles.h2}>1 · Connect your Google Cloud OAuth client</Text>
              <Text style={styles.body2}>
                In Google Cloud Console → APIs & Services → Credentials, create an <Text style={styles.bold}>OAuth 2.0 Client ID</Text> (type: <Text style={styles.bold}>Web application</Text>) and add this exact redirect URI:
              </Text>

              <View style={styles.uriBox}>
                <Text style={styles.uriText} numberOfLines={2}>
                  {client?.redirect_uri || '— backend URL not configured —'}
                </Text>
                <TouchableOpacity onPress={copyRedirectUri} style={styles.copyBtn} testID="gdrive-copy-uri">
                  <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Client ID</Text>
              <TextInput
                style={styles.input}
                placeholder="123456789-abcdef.apps.googleusercontent.com"
                placeholderTextColor={COLORS.textDisabled}
                value={clientId}
                onChangeText={setClientId}
                autoCapitalize="none"
                autoCorrect={false}
                testID="gdrive-client-id"
              />
              <Text style={styles.label}>Client Secret</Text>
              <TextInput
                style={styles.input}
                placeholder="GOCSPX-..."
                placeholderTextColor={COLORS.textDisabled}
                value={clientSecret}
                onChangeText={setClientSecret}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                testID="gdrive-client-secret"
              />

              {error ? (
                <View style={styles.err}>
                  <Ionicons name="alert-circle" size={14} color={COLORS.accent} />
                  <Text style={styles.errText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={saveClient}
                disabled={busy}
                style={[styles.btn, styles.btnPrimary, { marginTop: 14 }, busy && { opacity: 0.6 }]}
                testID="gdrive-save-client"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={16} color="#fff" />}
                <Text style={styles.btnText}>{busy ? 'Saving…' : 'Save & continue'}</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Step 2: Authorize ────────────────────────────── */}
          {step === 'authorize' && (
            <>
              <Text style={styles.h2}>2 · Authorize Google Drive</Text>
              {client?.client_id ? (
                <Text style={styles.muted}>
                  Using client <Text style={styles.code}>{client.client_id.slice(0, 24)}…</Text>
                </Text>
              ) : null}

              <Text style={[styles.body2, { marginTop: 8 }]}>
                Tap <Text style={styles.bold}>Authorize Google Drive</Text> below. Your browser will open the Google sign-in page. Pick the clinic-owned account, tap <Text style={styles.bold}>Allow</Text>, and you'll be sent back here automatically.
              </Text>

              <Text style={styles.label}>Folder name on Drive</Text>
              <TextInput
                style={styles.input}
                value={folder}
                onChangeText={setFolder}
                autoCapitalize="none"
                autoCorrect={false}
                testID="gdrive-folder"
              />

              {error ? (
                <View style={styles.err}>
                  <Ionicons name="alert-circle" size={14} color={COLORS.accent} />
                  <Text style={styles.errText}>{error}</Text>
                </View>
              ) : null}

              {authStarted ? (
                <View style={styles.poll}>
                  <ActivityIndicator color={COLORS.primary} />
                  <Text style={styles.pollText}>Waiting for authorization to complete… If you cancelled, tap Authorize again.</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={startAuthorize}
                disabled={busy}
                style={[styles.btn, styles.btnPrimary, { marginTop: 14 }, busy && { opacity: 0.6 }]}
                testID="gdrive-authorize"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="logo-google" size={16} color="#fff" />}
                <Text style={styles.btnText}>{busy ? 'Opening…' : 'Authorize Google Drive'}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setStep('client')} style={[styles.btn, styles.btnGhost, { marginTop: 8 }]}>
                <Text style={[styles.btnText, { color: COLORS.primary }]}>← Edit OAuth client</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Step 3: Done ─────────────────────────────────── */}
          {step === 'done' && (
            <View style={[styles.card, { borderColor: COLORS.success + '66' }]}>
              <View style={styles.cardHead}>
                <Ionicons name="checkmark-circle" size={26} color={COLORS.success} />
                <Text style={[styles.cardTitle, { color: COLORS.success, fontSize: 16 }]}>
                  Mirror active
                </Text>
              </View>
              <Text style={styles.body2}>
                Backups mirror to <Text style={styles.code}>{info?.current_remote || 'gdrive:consulturo-backups'}</Text>.
              </Text>
              <Text style={styles.muted}>
                The daily backup job will push every new archive automatically. You can tap "Backup now" on the Backups screen to push immediately.
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                <TouchableOpacity onPress={onClose} style={[styles.btn, styles.btnPrimary, { flex: 1 }]} testID="gdrive-finish">
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={styles.btnText}>Finish</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={disconnect} style={[styles.btn, styles.btnDanger, { flex: 1 }]} testID="gdrive-disconnect">
                  <Ionicons name="cloud-offline" size={15} color="#fff" />
                  <Text style={styles.btnText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  const bg = done ? COLORS.success : active ? COLORS.primary : COLORS.border;
  const fg = done || active ? '#fff' : COLORS.textSecondary;
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <View style={[styles.stepDot, { backgroundColor: bg }]}>
        {done ? (
          <Ionicons name="checkmark" size={14} color="#fff" />
        ) : (
          <Text style={{ ...FONTS.bodyMedium, color: fg, fontSize: 12 }}>{n}</Text>
        )}
      </View>
      <Text style={[styles.stepLabel, (active || done) && { color: COLORS.textPrimary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1, textAlign: 'center', fontSize: 15 },
  body: { padding: 16, paddingBottom: 40 },

  steps: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, marginTop: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  stepSep: { flex: 0.5, height: 1, backgroundColor: COLORS.border, marginHorizontal: -4 },

  h2: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16, marginBottom: 6 },
  body2: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  bold: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  code: { fontFamily: 'monospace' as any, color: COLORS.primary, fontSize: 12 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12, marginBottom: 6 },

  input: {
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    backgroundColor: '#fff',
    color: COLORS.textPrimary,
    fontSize: 13,
  },

  uriBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary + '08',
    marginTop: 6,
  },
  uriText: { ...FONTS.body, fontFamily: 'monospace' as any, fontSize: 11, color: COLORS.primary, flex: 1 },
  copyBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: { backgroundColor: COLORS.accent },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  card: {
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: 16,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { ...FONTS.bodyMedium, fontSize: 14 },

  poll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary + '12',
    marginTop: 14,
  },
  pollText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1, lineHeight: 17 },

  help: {
    padding: 12,
    backgroundColor: COLORS.primary + '10',
    borderRadius: RADIUS.sm,
    marginBottom: 14,
  },
  helpTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 4 },
  helpBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },
  helpCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  helpCtaText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },

  err: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    backgroundColor: COLORS.accent + '15',
    borderRadius: RADIUS.sm,
    marginTop: 14,
  },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 12, flex: 1, lineHeight: 17 },
});
