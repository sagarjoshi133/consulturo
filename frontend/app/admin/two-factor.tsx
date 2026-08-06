/**
 * Two-Factor Authentication setup — Wave 5 (AA).
 *
 * Owner-only screen. Walks the owner through enrolling a TOTP
 * authenticator (Google Authenticator, Authy, 1Password, etc.).
 *
 * Flow:
 *   1. GET /api/security/2fa/status — show current state.
 *   2. POST /api/security/2fa/setup — receive secret + otpauth URL.
 *      Render the QR code (react-native-qrcode-svg).
 *   3. User scans the QR, enters the 6-digit code.
 *   4. POST /api/security/2fa/verify — promotes pending → active.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useSafeBack } from '../../src/use-safe-back';
import { useDarkOverrides } from '../../src/dark-mode';
import {
  totpSetup,
  totpStatus,
  totpVerify,
  totpDisable,
  type TotpSetup,
  type TotpStatus,
} from '../../src/wave5/api';

export default function TwoFactorScreen() {
  const safeBack = useSafeBack('/profile' as any);
  const d = useDarkOverrides();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setupData, setSetupData] = useState<TotpSetup | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const s = await totpStatus();
      setStatus(s);
    } catch (e: any) {
      setStatus(null);
      setErr(e?.response?.data?.detail || 'Could not load 2FA status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const startSetup = async () => {
    setBusy(true);
    setErr('');
    try {
      const d = await totpSetup('ConsultUro Owner');
      setSetupData(d);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not start 2FA setup');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.replace(/\s/g, '').length < 6) {
      setErr('Enter the 6-digit code from your authenticator');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await totpVerify(code.replace(/\s/g, ''));
      setSetupData(null);
      setCode('');
      await reload();
      Alert.alert('Two-factor enabled', 'You\u2019ll be asked for a code from your authenticator on every sign-in from a new device.');
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Code didn\u2019t match. Make sure your phone\u2019s time is automatic.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    const proceed = async () => {
      setBusy(true);
      setErr('');
      try {
        await totpDisable();
        await reload();
      } catch (e: any) {
        setErr(e?.response?.data?.detail || 'Could not disable 2FA');
      } finally {
        setBusy(false);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Disable two-factor? Your account will be less secure.')) {
        void proceed();
      }
    } else {
      Alert.alert(
        'Disable two-factor?',
        'Your account will rely on the password only.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Disable', style: 'destructive', onPress: () => void proceed() },
        ],
      );
    }
  };

  const copySecret = async () => {
    if (!setupData?.secret) return;
    try { await Clipboard.setStringAsync(setupData.secret); } catch {}
    Alert.alert('Copied', 'Paste the secret into your authenticator app if you can\u2019t scan the QR.');
  };

  return (
    <SafeAreaView style={[styles.screen, d.screen]} edges={['top', 'bottom']}>
      <View style={[styles.header, d.surface]}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="twofa-back">
          <Ionicons name="arrow-back" size={22} color={d.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, d.textP]}>Two-factor authentication</Text>
          <Text style={[styles.headerSub, d.textS]}>Owner-only · TOTP via Google Authenticator</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Status card */}
            <View style={[styles.card, status?.enabled ? styles.cardOn : styles.cardOff, d.surface]}>
              <Ionicons
                name={status?.enabled ? 'shield-checkmark' : 'shield-outline'}
                size={32}
                color={status?.enabled ? '#16A34A' : d.colors.textSecondary}
              />
              <Text style={[styles.statusTitle, d.textP]}>
                {status?.enabled ? 'Two-factor is ON' : 'Two-factor is OFF'}
              </Text>
              <Text style={[styles.statusSub, d.textS]}>
                {status?.enabled
                  ? 'Sign-ins from new devices need a 6-digit code from your authenticator app.'
                  : 'Add a second factor so a stolen password alone can\u2019t reach patient data.'}
              </Text>
              {status?.enabled ? (
                <TouchableOpacity onPress={disable} style={styles.dangerBtn} disabled={busy} testID="twofa-disable">
                  <Ionicons name="shield-off" size={16} color="#fff" />
                  <Text style={styles.dangerBtnText}>Disable</Text>
                </TouchableOpacity>
              ) : !setupData ? (
                <TouchableOpacity onPress={startSetup} style={styles.primaryBtn} disabled={busy} testID="twofa-start">
                  <Ionicons name="qr-code" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>{busy ? 'Setting up…' : 'Set up now'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Setup flow */}
            {!status?.enabled && setupData ? (
              <View style={[styles.setupBox, d.surface]}>
                <Text style={[styles.stepTitle, d.textP]}>Step 1 · Scan this code</Text>
                <Text style={[styles.stepBody, d.textS]}>
                  Open Google Authenticator (or Authy / 1Password) → tap <Text style={{ fontWeight: '700' }}>+</Text> → Scan a QR.
                </Text>
                <View style={styles.qrWrap}>
                  <QRCode value={setupData.otpauth_url} size={196} backgroundColor="white" />
                </View>
                <TouchableOpacity onPress={copySecret} style={styles.secretChip} testID="twofa-copy-secret">
                  <Ionicons name="copy" size={14} color={COLORS.primary} />
                  <Text style={styles.secretText} selectable>
                    {setupData.secret.match(/.{1,4}/g)?.join(' ') || setupData.secret}
                  </Text>
                </TouchableOpacity>

                <Text style={[styles.stepTitle, { marginTop: 18 }, d.textP]}>Step 2 · Enter the 6-digit code</Text>
                <Text style={[styles.stepBody, d.textS]}>
                  Your authenticator will show a new 6-digit code every 30 seconds.
                </Text>
                <View style={styles.codeRow}>
                  <TextInput
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="123 456"
                    placeholderTextColor={COLORS.textDisabled}
                    keyboardType="number-pad"
                    style={styles.codeInput}
                    maxLength={6}
                    testID="twofa-code-input"
                  />
                  <TouchableOpacity
                    onPress={verify}
                    style={[styles.primaryBtn, code.length < 6 && { opacity: 0.5 }]}
                    disabled={busy || code.length < 6}
                    testID="twofa-verify"
                  >
                    <Text style={styles.primaryBtnText}>{busy ? 'Verifying…' : 'Verify'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {err ? (
              <View style={styles.errBox}>
                <Ionicons name="alert-circle" size={14} color="#DC2626" />
                <Text style={styles.errText}>{err}</Text>
              </View>
            ) : null}

            <View style={[styles.tipsBox, d.surface]}>
              <Text style={[styles.tipsTitle, d.textP]}>What is two-factor?</Text>
              <Text style={[styles.tipsLine, d.textS]}>• A second proof of identity in addition to your password.</Text>
              <Text style={[styles.tipsLine, d.textS]}>• Codes are generated locally on your phone — no SMS cost.</Text>
              <Text style={[styles.tipsLine, d.textS]}>• Recommended apps: Google Authenticator, Microsoft Authenticator, Authy, 1Password.</Text>
              <Text style={[styles.tipsLine, d.textS]}>• If you lose your phone, contact the platform admin to disable 2FA on your account.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },

  card: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1,
    alignItems: 'center', padding: 18, gap: 10,
  },
  cardOn: { borderColor: '#16A34A55' },
  cardOff: { borderColor: COLORS.border },
  statusTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  statusSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  primaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 11,
    borderRadius: RADIUS.pill, marginTop: 6,
  },
  primaryBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
  dangerBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: '#DC2626', paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.pill, marginTop: 6,
  },
  dangerBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },

  setupBox: {
    marginTop: 16, backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
  },
  stepTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  stepBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },

  qrWrap: {
    alignSelf: 'center', marginTop: 14, padding: 10, backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  secretChip: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.primary + '12', borderRadius: 12,
  },
  secretText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12, letterSpacing: 1 },

  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  codeInput: {
    flex: 1, backgroundColor: COLORS.bg,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 18, letterSpacing: 4, color: COLORS.textPrimary,
    fontFamily: 'Manrope_700Bold' as any,
  },

  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FEE2E2', borderRadius: RADIUS.md,
  },
  errText: { ...FONTS.body, color: '#991B1B', fontSize: 12.5, flex: 1, lineHeight: 17 },

  tipsBox: {
    marginTop: 16, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  tipsTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 6 },
  tipsLine: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 19 },
});
