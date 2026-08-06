// Phone-OTP sign-in modal — uses Firebase Auth on native (NOT web).
// Flow:
//   1) Enter phone (E.164, e.g. +91 98765 43210)
//   2) Firebase sends SMS via signInWithPhoneNumber
//   3) Enter the 6-digit code → confirm() returns a Firebase user
//   4) Get Firebase ID token → POST /api/auth/firebase-phone/verify
//   5) If status == 'needs_email' → show email-add screen → re-call with email
//   6) Otherwise we have our session_token → sign in.
//
// Web preview falls back gracefully (Firebase Native SDK isn't available
// there) by hiding this option in the login UI on Platform.OS === 'web'.

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton } from './components';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Optional fallback callback — if phone-auth fails the user can
   *  tap "Try Email Code instead" which closes the modal and asks
   *  the host (login screen) to focus the email field. */
  onSwitchToEmail?: () => void;
};

// Lazily require the right SDK per platform so the bundle works on both:
//   • Native (iOS/Android) → @react-native-firebase/auth
//   • Web                  → firebase web SDK shim (./firebase-web)
let firebaseAuth: any = null;
if (Platform.OS === 'web') {
  try { firebaseAuth = require('./firebase-web').default; } catch (_e) { firebaseAuth = null; }
} else {
  try { firebaseAuth = require('@react-native-firebase/auth').default; } catch (_e) { firebaseAuth = null; }
}

export default function PhoneAuthModal({ visible, onClose, onSuccess, onSwitchToEmail }: Props) {
  const [step, setStep] = useState<'enter-phone' | 'enter-code' | 'add-email'>('enter-phone');
  const [country, setCountry] = useState('+91');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [confirmation, setConfirmation] = useState<any>(null);
  const [idToken, setIdToken] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (visible) {
      setStep('enter-phone');
      setPhone(''); setCode(''); setEmail('');
      setConfirmation(null); setIdToken('');
      setErr(''); setBusy(false);
    }
  }, [visible]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Strip any leading 0 that users habitually type before the
  // 10-digit Indian mobile number — Firebase E.164 expects exactly
  // 10 digits after the +91 country code, so a "098…" produces an
  // "invalid phone number" error otherwise.
  const cleanedPhone = phone.replace(/\D/g, '').replace(/^0+/, '');
  const fullPhone = `${country}${cleanedPhone}`;
  const isValidPhone = cleanedPhone.length === 10;

  // Friendlier copy for the well-known Firebase Auth error codes —
  // surfaces actionable next steps instead of opaque "auth/xxx"
  // strings (Dr. Joshi reported phone-OTP "not working" Jun-17
  // without a precise repro — we now print the underlying code in
  // small text so we can diagnose any future failure remotely).
  const friendlyAuthError = (e: any): string => {
    const code: string = e?.code || '';
    if (code.includes('captcha-check-failed') || code.includes('app-not-authorized')) {
      return 'Anti-bot check failed. If you are on the web preview, please add this site to your Firebase Console → Authorised Domains and retry. On the Android APK, the SHA-1 fingerprint of the build must be registered in Firebase.';
    }
    if (code.includes('invalid-phone-number')) {
      return 'That phone number looks invalid. Use a 10-digit Indian mobile number, e.g. 98765 43210 (no leading 0).';
    }
    if (code.includes('too-many-requests') || code.includes('quota-exceeded')) {
      return 'Too many attempts from this device. Wait an hour or use Email Code below.';
    }
    if (code.includes('network-request-failed')) {
      return 'Network problem. Check your connection and retry.';
    }
    if (code.includes('billing-not-enabled')) {
      return 'Firebase phone auth needs billing enabled on the project. Please use Email Code for now and ask the admin to enable Blaze plan on the Firebase project.';
    }
    if (code.includes('invalid-verification-code')) {
      return 'Wrong code. Double-check the SMS and re-enter all 6 digits.';
    }
    if (code.includes('code-expired') || code.includes('session-expired')) {
      return 'Code expired. Tap "Resend" to receive a fresh one.';
    }
    return e?.message || 'Could not send SMS — check the number and try again.';
  };

  const sendCode = async () => {
    if (!firebaseAuth) {
      setErr(
        Platform.OS === 'web'
          ? 'Phone sign-in is unavailable in this browser. Try Email Code instead.'
          : 'Phone sign-in is not available — please reinstall the app.'
      );
      return;
    }
    if (!isValidPhone) { setErr('Enter a valid 10-digit phone number (no leading 0).'); return; }
    setErr(''); setBusy(true);
    try {
      const conf = await firebaseAuth().signInWithPhoneNumber(fullPhone);
      setConfirmation(conf);
      setStep('enter-code');
      setResendIn(30);
    } catch (e: any) {
      // Print full error to console so we can diagnose remotely
      // when the user reports "phone OTP not working".
      // eslint-disable-next-line no-console
      console.log('[phone-auth] signInWithPhoneNumber failed:', e?.code, e?.message, e);
      const msg = friendlyAuthError(e);
      setErr(e?.code ? `${msg}\n(code: ${e.code})` : msg);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    if (!confirmation) return;
    if (code.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setErr(''); setBusy(true);
    try {
      const userCredential = await confirmation.confirm(code);
      const token = await userCredential.user.getIdToken();
      setIdToken(token);
      // Exchange with our backend.
      const { data } = await api.post('/auth/firebase-phone/verify', { id_token: token });
      if (data.status === 'needs_email') {
        setStep('add-email');
        return;
      }
      await AsyncStorage.setItem('session_token', data.session_token);
      onSuccess();
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.log('[phone-auth] verifyCode failed:', e?.code, e?.message, e?.response?.data, e);
      const detail = e?.response?.data?.detail;
      if (detail) {
        setErr(String(detail));
      } else {
        const msg = friendlyAuthError(e);
        setErr(e?.code ? `${msg}\n(code: ${e.code})` : msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitEmail = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErr('Enter a valid email.'); return; }
    if (!idToken) { setErr('Session expired — please re-verify your phone.'); return; }
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/firebase-phone/verify', {
        id_token: idToken,
        email: email.trim().toLowerCase(),
      });
      if (data.status !== 'ok' || !data.session_token) {
        setErr(data?.detail || 'Could not finalise account.');
        return;
      }
      await AsyncStorage.setItem('session_token', data.session_token);
      onSuccess();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not save email.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
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
              <Text style={styles.title}>
                {step === 'enter-phone' ? 'Sign in with phone' :
                 step === 'enter-code' ? 'Verify code' : 'Add your email'}
              </Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {step === 'enter-phone' && (
              <>
                <Text style={styles.body}>
                  We'll send a 6-digit code to your phone via SMS.
                </Text>
                <View style={styles.phoneRow}>
                  <View style={styles.countryBox}>
                    <Text style={styles.countryText}>{country}</Text>
                  </View>
                  <TextInput
                    value={phone}
                    onChangeText={(s) => setPhone(s.replace(/\D/g, '').slice(0, 10))}
                    placeholder="98765 43210"
                    placeholderTextColor={COLORS.textDisabled}
                    keyboardType="phone-pad"
                    maxLength={10}
                    style={styles.phoneInput}
                    testID="phone-auth-number"
                  />
                </View>
                {err ? (
                  <View style={styles.errCard}>
                    <Ionicons name="warning" size={14} color="#B91C1C" style={{ marginTop: 1 }} />
                    <Text style={[styles.err, { flex: 1 }]}>{err}</Text>
                  </View>
                ) : null}
                <PrimaryButton
                  title={busy ? 'Sending…' : 'Send SMS code'}
                  onPress={sendCode}
                  disabled={busy || !isValidPhone}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name="send" size={18} color="#fff" />}
                  testID="phone-auth-send"
                />
                {/* Always-visible fallback — if Firebase phone-auth is
                    misconfigured (web reCAPTCHA, native SHA-1, etc.)
                    the user still has a route to sign in via email. */}
                {onSwitchToEmail ? (
                  <TouchableOpacity
                    onPress={() => { onClose(); setTimeout(onSwitchToEmail, 100); }}
                    style={styles.fallbackBtn}
                    testID="phone-auth-switch-email"
                  >
                    <Ionicons name="mail-outline" size={16} color={COLORS.primary} />
                    <Text style={[styles.linkText, { marginLeft: 6 }]}>
                      Use Email Code instead
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </>
            )}

            {step === 'enter-code' && (
              <>
                <Text style={styles.body}>
                  Enter the 6-digit code sent to <Text style={{ fontWeight: '700' }}>{fullPhone}</Text>
                </Text>
                <TextInput
                  value={code}
                  onChangeText={(s) => setCode(s.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={[styles.input, styles.codeInput]}
                  testID="phone-auth-code"
                  autoFocus
                />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <PrimaryButton
                  title={busy ? 'Verifying…' : 'Verify'}
                  onPress={verifyCode}
                  disabled={busy || code.length !== 6}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name="checkmark" size={18} color="#fff" />}
                  testID="phone-auth-verify"
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                  <TouchableOpacity onPress={() => setStep('enter-phone')}>
                    <Text style={styles.linkText}>← Change number</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={sendCode} disabled={resendIn > 0 || busy} style={(resendIn > 0 || busy) && { opacity: 0.4 }}>
                    <Text style={styles.linkText}>Resend{resendIn > 0 ? ` (${resendIn}s)` : ''}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {step === 'add-email' && (
              <>
                <Text style={styles.body}>
                  Almost done — please add your email so you can also sign in with email,
                  receive prescriptions and stay in sync.
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
                  testID="phone-auth-email"
                />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <PrimaryButton
                  title={busy ? 'Finishing…' : 'Finish sign-in'}
                  onPress={submitEmail}
                  disabled={busy}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name="checkmark-done" size={18} color="#fff" />}
                  testID="phone-auth-finish"
                />
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
    paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  body: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  phoneRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  countryBox: {
    backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, justifyContent: 'center', height: 48,
  },
  countryText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  phoneInput: {
    flex: 1, backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, fontSize: 15, color: COLORS.textPrimary, height: 48,
  },
  input: {
    backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15, color: COLORS.textPrimary, marginTop: 12,
  },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  err: { ...FONTS.body, color: '#B91C1C', fontSize: 12, lineHeight: 17 },
  errCard: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  fallbackBtn: {
    marginTop: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  linkText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
});
