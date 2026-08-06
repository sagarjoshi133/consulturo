import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import api from './api';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';
import { useResponsive } from './responsive';

/**
 * First-run consent gate — shown once after sign-in if the user hasn't
 * accepted the required Privacy/Terms + medical-data storage consent.
 *
 * Renders nothing for guests or users whose consent is already on record.
 */
export function ConsentGate() {
  const { user } = useAuth();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [data, setData] = useState(false);
  const [policy, setPolicy] = useState(false);
  const [marketing, setMarketing] = useState(true);
  const [busy, setBusy] = useState(false);
  // Desktop: show as a centered modal card (not a bottom sheet).
  const r = useResponsive();
  const isDesktop = r.isWebDesktop;

  const check = useCallback(async () => {
    if (!user) return;
    try {
      const { data: rec } = await api.get('/consent');
      const already = !!(rec && rec.data_consent && rec.policy_consent);
      setShow(!already);
    } catch {
      // On error (e.g. offline), don't block the user.
      setShow(false);
    }
  }, [user]);

  useEffect(() => { check(); }, [check]);

  if (!user || !show) return null;

  const submit = async () => {
    if (!data || !policy) {
      const msg = 'Please accept both mandatory items to continue.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
      else Alert.alert('Consent required', msg);
      return;
    }
    setBusy(true);
    try {
      await api.post('/consent', {
        data_consent: true,
        policy_consent: true,
        marketing_consent: !!marketing,
      });
      setShow(false);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save consent — please try again.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={show} animationType="slide" transparent statusBarTranslucent>
      {/* Dimmed backdrop */}
      <View style={styles.backdrop} pointerEvents="box-none" />
      {/* Bottom sheet card */}
      <SafeAreaView edges={['bottom']} style={[styles.sheetWrap, isDesktop && styles.sheetWrapDesktop]} pointerEvents="box-none">
        <View style={[styles.sheet, isDesktop && styles.sheetDesktop]}>
          <View style={styles.grabber} />
          <LinearGradient colors={COLORS.heroGradient} style={styles.sheetHero}>
            <View style={styles.shieldIcon}>
              <Ionicons name="shield-checkmark" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>Your privacy, first.</Text>
              <Text style={styles.heroSub}>
                Before you continue, please review and accept the following.
              </Text>
            </View>
          </LinearGradient>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            showsVerticalScrollIndicator
            bounces
            style={styles.sheetBody}
          >
            <ConsentItem
              testID="consent-data"
              checked={data}
              onToggle={() => setData(!data)}
              required
              title="Medical Data Storage"
              desc="I consent to ConsultUro securely storing my personal and medical information (appointments, prescriptions, health records) for consultation purposes."
            />
            <ConsentItem
              testID="consent-policy"
              checked={policy}
              onToggle={() => setPolicy(!policy)}
              required
              title="Privacy Policy & Terms of Use"
              desc={
                <Text style={styles.descText}>
                  I have read and agree to the{' '}
                  <Text style={styles.link} onPress={() => router.push('/privacy' as any)}>Privacy Policy</Text>
                  {' '}and{' '}
                  <Text style={styles.link} onPress={() => router.push('/terms' as any)}>Terms of Use</Text>.
                </Text>
              }
            />
            <ConsentItem
              testID="consent-marketing"
              checked={marketing}
              onToggle={() => setMarketing(!marketing)}
              title="Reminders (Optional)"
              desc="I agree to receive appointment reminders and important updates from ConsultUro via WhatsApp, SMS, and in-app notifications."
            />

            <View style={styles.noteCard}>
              <Ionicons name="information-circle" size={16} color={COLORS.primary} />
              <Text style={styles.noteText}>
                You can update these preferences anytime from your profile.
              </Text>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.primaryBtn, (!data || !policy || busy) && styles.primaryBtnDisabled]}
              onPress={submit}
              disabled={!data || !policy || busy}
              testID="consent-accept"
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{busy ? 'Saving…' : 'Accept & Continue'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ConsentItem({
  testID,
  checked,
  onToggle,
  title,
  desc,
  required,
}: {
  testID?: string;
  checked: boolean;
  onToggle: () => void;
  title: string;
  desc: React.ReactNode;
  required?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={[styles.card, checked && styles.cardChecked]} testID={testID}>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && <Ionicons name="checkmark" size={18} color="#fff" />}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {required && (
            <View style={styles.requiredTag}>
              <Text style={styles.requiredTagText}>REQUIRED</Text>
            </View>
          )}
        </View>
        {typeof desc === 'string' ? (
          <Text style={styles.descText}>{desc}</Text>
        ) : (
          desc
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  /* Desktop: center the card vertically + horizontally, cap width to
     540 so it reads like a premium consent prompt instead of a full-
     width bottom sheet. */
  sheetWrapDesktop: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '88%',
    overflow: 'hidden',
  },
  sheetDesktop: {
    borderRadius: 20,
    width: '100%',
    maxWidth: 560,
    maxHeight: 720,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, backgroundColor: '#D0D9DB', borderRadius: 2, marginTop: 8, marginBottom: 4 },
  sheetHero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  shieldIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...FONTS.h4, color: '#fff', fontSize: 17 },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.9)', marginTop: 2, lineHeight: 19, fontSize: 13 },
  sheetBody: { flexGrow: 0 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  cardChecked: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  descText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  link: { color: COLORS.primary, fontFamily: 'DMSans_700Bold' },
  requiredTag: { backgroundColor: COLORS.accent + '18', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  requiredTagText: { ...FONTS.label, color: COLORS.accent, fontSize: 9, letterSpacing: 0.3 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.primary + '0A', borderWidth: 1, borderColor: COLORS.primary + '22', padding: 10, borderRadius: RADIUS.md, marginTop: 4 },
  noteText: { flex: 1, ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  footer: { padding: 14, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: '#fff' },
  primaryBtn: { backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.pill, alignItems: 'center' },
  primaryBtnDisabled: { backgroundColor: COLORS.textDisabled },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 16 },
});
