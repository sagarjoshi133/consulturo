import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from './auth';
import { useI18n } from './i18n';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton } from './components';

// Light validation: 10-15 digits accepted
function isValidPhone(p: string) {
  const digits = (p || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Blocks the entire app in a modal until the signed-in user has a phone number
 * saved. Every role (owner/doctor/staff/patient) must complete this.
 * The user can still edit their phone later via More → My Profile / My Records.
 */
export function PhoneGate() {
  const { user, refresh } = useAuth() as any;
  const { t } = useI18n();
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Only show when a user is signed-in AND has no phone saved.
  const visible = !!user && !user.phone;

  const save = async () => {
    setErr('');
    if (!isValidPhone(phone)) {
      setErr(t('phoneGate.invalid'));
      return;
    }
    setSaving(true);
    try {
      await api.patch('/auth/me', { phone });
      if (refresh) await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={() => {}}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: COLORS.bg }}
      >
        <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="cellphone-check" size={46} color="#fff" />
          </View>
          <Text style={styles.title}>{t('phoneGate.title')}</Text>
          <Text style={styles.subtitle}>
            {user?.role && user.role !== 'patient'
              ? t('phoneGate.subtitleStaff')
              : t('phoneGate.subtitlePatient')}
          </Text>
        </LinearGradient>

        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t('phoneGate.label')}</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t('phoneGate.placeholder')}
            placeholderTextColor={COLORS.textDisabled}
            keyboardType="phone-pad"
            style={styles.input}
            autoFocus
            testID="phone-gate-input"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={18} color={COLORS.primary} />
            <Text style={styles.infoText}>
              {t('phoneGate.info')}
            </Text>
          </View>
          <PrimaryButton
            title={saving ? t('phoneGate.saving') : t('phoneGate.save')}
            onPress={save}
            disabled={saving}
            icon={<Ionicons name="checkmark-circle" size={18} color="#fff" />}
            style={{ marginTop: 24 }}
            testID="phone-gate-save"
          />
          {user?.email ? (
            <Text style={styles.signedAs}>{t('phoneGate.signedAs', { email: user.email })}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 80 : 48, paddingBottom: 36, borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  iconCircle: { alignSelf: 'center', width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { ...FONTS.h2, color: '#fff', textAlign: 'center' },
  subtitle: { ...FONTS.body, color: '#E0F7FA', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  label: { ...FONTS.label, color: COLORS.textSecondary },
  input: { marginTop: 8, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 16, paddingVertical: 14, ...FONTS.bodyLarge, color: COLORS.textPrimary, fontSize: 18 },
  err: { ...FONTS.body, color: COLORS.accent, marginTop: 8 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 16, padding: 12, backgroundColor: COLORS.primary + '12', borderRadius: RADIUS.md },
  infoText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  signedAs: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 16, fontSize: 12 },
});
