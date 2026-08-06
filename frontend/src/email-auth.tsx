// Modal flows for the two email-based sign-in alternatives:
//   • Magic Link  — email a one-tap link, app exchanges deep-link token
//   • OTP         — email a 6-digit code, user types it in
// Both call our /api/auth/{magic|otp}/* endpoints. On success, we store
// the session_token in AsyncStorage (matching the rest of the app's auth
// model) and call the supplied onSuccess callback.

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton } from './components';

export type EmailAuthMode = 'magic' | 'otp';

type Props = {
  visible: boolean;
  mode: EmailAuthMode | null;
  onClose: () => void;
  onSuccess: () => void; // called after session_token saved
};

export default function EmailAuthModal({ visible, mode, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'enter-email' | 'sent' | 'enter-code'>('enter-email');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const codeRef = useRef<TextInput | null>(null);

  // Reset every time the modal is opened with a (potentially) different mode.
  useEffect(() => {
    if (visible) {
      setEmail('');
      setCode('');
      setStep('enter-email');
      setErr('');
      setBusy(false);
    }
  }, [visible, mode]);

  // 30-sec resend cool-down so users can't accidentally spam the email.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const requestEmail = async () => {
    if (!isValidEmail) { setErr('Please enter a valid email.'); return; }
    setErr('');
    setBusy(true);
    try {
      const path = mode === 'magic' ? '/auth/magic/request' : '/auth/otp/request';
      await api.post(path, { email: email.trim().toLowerCase() });
      setStep(mode === 'magic' ? 'sent' : 'enter-code');
      setResendIn(30);
      // For OTP flow, immediately focus the code input.
      if (mode === 'otp') setTimeout(() => codeRef.current?.focus(), 200);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not send email — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setErr('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/otp/verify', {
        email: email.trim().toLowerCase(),
        code: code.trim(),
      });
      await AsyncStorage.setItem('session_token', data.session_token);
      onSuccess();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'magic' ? 'Sign in with Magic Link' : 'Sign in with Email Code';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      // statusBarTranslucent so the backdrop reaches the very top edge
      // (Android), and the modal can size itself correctly when the
      // keyboard slides up from the bottom navigation bar.
      statusBarTranslucent
    >
      <SafeAreaView style={styles.backdrop} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={{ width: '100%', flex: 1, justifyContent: 'flex-end' }}
        >
          <ScrollView
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={onClose} testID="email-auth-close">
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {step === 'enter-email' && (
              <>
                <Text style={styles.body}>
                  {mode === 'magic'
                    ? "We'll email you a one-tap link to sign in."
                    : "We'll email you a 6-digit code to enter here."}
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.textDisabled}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  style={styles.input}
                  testID="email-auth-email"
                />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <PrimaryButton
                  title={busy ? 'Sending…' : (mode === 'magic' ? 'Send link' : 'Send code')}
                  onPress={requestEmail}
                  disabled={busy || !isValidEmail}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name={mode === 'magic' ? 'link' : 'keypad'} size={18} color="#fff" />}
                  testID="email-auth-send"
                />
              </>
            )}

            {step === 'sent' && mode === 'magic' && (
              <>
                <View style={styles.iconCircle}>
                  <Ionicons name="mail" size={32} color={COLORS.primary} />
                </View>
                <Text style={styles.body}>
                  We sent a magic link to <Text style={{ fontWeight: '700' }}>{email}</Text>.
                  Open the email on this device and tap the link.
                </Text>
                <Text style={styles.hint}>
                  Didn't get it? Check spam, or resend{resendIn > 0 ? ` in ${resendIn}s` : ''}.
                </Text>
                <TouchableOpacity
                  onPress={requestEmail}
                  disabled={resendIn > 0 || busy}
                  style={[styles.linkBtn, (resendIn > 0 || busy) && { opacity: 0.4 }]}
                  testID="email-auth-resend"
                >
                  <Ionicons name="refresh" size={14} color={COLORS.primary} />
                  <Text style={styles.linkBtnText}>Resend</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>
                  After tapping the link, the app will sign you in automatically.
                </Text>
              </>
            )}

            {step === 'enter-code' && mode === 'otp' && (
              <>
                <Text style={styles.body}>
                  Enter the 6-digit code we emailed to{' '}
                  <Text style={{ fontWeight: '700' }}>{email}</Text>.
                </Text>
                <TextInput
                  ref={codeRef}
                  value={code}
                  onChangeText={(s) => setCode(s.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.input, styles.codeInput]}
                  testID="email-auth-code"
                />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <PrimaryButton
                  title={busy ? 'Verifying…' : 'Verify'}
                  onPress={verifyCode}
                  disabled={busy || code.length !== 6}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name="checkmark" size={18} color="#fff" />}
                  testID="email-auth-verify"
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => setStep('enter-email')} testID="email-auth-back">
                    <Text style={styles.linkText}>← Change email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={requestEmail}
                    disabled={resendIn > 0 || busy}
                    style={(resendIn > 0 || busy) && { opacity: 0.4 }}
                  >
                    <Text style={styles.linkText}>
                      Resend{resendIn > 0 ? ` (${resendIn}s)` : ''}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 32,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  body: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    color: COLORS.textPrimary,
    marginTop: 12,
  },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  err: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 6 },
  hint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 17 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  linkBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  linkText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginVertical: 12,
  },
});
