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

export default function PhoneAuthModal({ visible, onClose, onSuccess }: Props) {
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

  const fullPhone = `${country}${phone.replace(/\D/g, '')}`;
  const isValidPhone = phone.replace(/\D/g, '').length >= 10;

  const sendCode = async () => {
    if (!firebaseAuth) {
      setErr(
        Platform.OS === 'web'
          ? 'Phone sign-in is unavailable in this browser. Try Email Code instead.'
          : 'Phone sign-in is not available — please reinstall the app.'
      );
      return;
    }
    if (!isValidPhone) { setErr('Enter a valid 10-digit phone number.'); return; }
    setErr(''); setBusy(true);
    try {
      const conf = await firebaseAuth().signInWithPhoneNumber(fullPhone);
      setConfirmation(conf);
      setStep('enter-code');
      setResendIn(30);
    } catch (e: any) {
      setErr(e?.message || 'Could not send SMS — check the number and try again.');
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
      setErr(e?.response?.data?.detail || e?.message || 'Verification failed.');
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
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <PrimaryButton
                  title={busy ? 'Sending…' : 'Send SMS code'}
                  onPress={sendCode}
                  disabled={busy || !isValidPhone}
                  style={{ marginTop: 14 }}
                  icon={<Ionicons name="send" size={18} color="#fff" />}
                  testID="phone-auth-send"
                />
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
  err: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 6 },
  linkText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
});
