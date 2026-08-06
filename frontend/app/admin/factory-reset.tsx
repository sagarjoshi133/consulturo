/**
 * Factory Reset — /admin/factory-reset
 *
 * Destructive flow that wipes every clinical/operational/analytics
 * row scoped to the owner's clinic_id. Designed for the
 * super_owner + primary_owner to use ONCE — at the end of the
 * testing phase, right before the clinic opens for real patients.
 *
 * Multi-step guard so an accidental tap never reaches the API:
 *
 *   1. Warning page  — lists exactly what gets wiped vs preserved,
 *                       big "Take a backup first" reminder with a
 *                       link to /dashboard?tab=backups.
 *   2. Confirm page  — user types the EXACT clinic name + receives
 *                       a one-time OTP at their registered email.
 *                       Both inputs must be correct.
 *   3. Final tap     — only enabled when both fields are valid, with
 *                       a 5-second cool-down on the button so even
 *                       fat-finger presses can't fire it instantly.
 *
 * On success → toast with deletion counts + a router.replace('/')
 * so the owner lands on a clean Home screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToast } from '../../src/toast';
import { useAuth } from '../../src/auth';
import { confirmAction } from '../../src/cross-alert';

type Step = 'warn' | 'confirm' | 'done';

export default function FactoryResetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const role = (user as any)?.role || '';
  const isAllowed = role === 'super_owner' || role === 'primary_owner';

  const [step, setStep] = useState<Step>('warn');
  const [clinicName, setClinicName] = useState<string>('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpRequesting, setOtpRequesting] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<{ deleted_total: number; deleted: Record<string, number> } | null>(null);

  // Load the configured clinic name so the typed-match check has a
  // ground truth to compare against. Falls back to the empty string
  // (which the backend will surface as a clearer error).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/clinic-settings');
        const nm = (r.data?.clinic_name || r.data?.name || '').trim();
        if (!cancelled) setClinicName(nm);
      } catch { /* will fail loudly on submit */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // 5-second cool-down after enabling the Reset button so accidental
  // double-taps can't fire it instantly.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const typedMatches = useMemo(
    () => clinicName.length > 0 && typedName.trim().toLowerCase() === clinicName.trim().toLowerCase(),
    [typedName, clinicName],
  );
  const canSubmit = typedMatches && otpCode.trim().length >= 4 && !busy && cooldown === 0;

  if (!isAllowed) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
            style={styles.iconBtn}
            testID="reset-back"
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Factory Reset</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.lockedTitle}>Owner-only action</Text>
          <Text style={styles.lockedSub}>
            Only the clinic&apos;s Primary Owner or the ConsultUro Super Owner
            can factory-reset the app.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const requestOtp = async () => {
    setOtpRequesting(true);
    try {
      await api.post('/admin/factory-reset/request-otp');
      setOtpRequested(true);
      // Start the 5-second cool-down so the user pauses before
      // hitting Reset — they just received an email, they should
      // read it carefully first.
      setCooldown(5);
      toast.success('Confirmation code sent to your email.');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not send confirmation code.');
    } finally {
      setOtpRequesting(false);
    }
  };

  const runReset = () => {
    confirmAction({
      title: 'Erase ALL clinic data?',
      message:
        `This will permanently delete every patient, prescription, IPD admission, ` +
        `surgery, consent, receipt, message, and notification for "${clinicName}". ` +
        `This action CANNOT be undone. Continue only if you have taken a backup.`,
      confirmText: 'Yes, erase everything',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const r = await api.post('/admin/factory-reset/execute', {
            clinic_name: typedName.trim(),
            otp_code: otpCode.trim(),
          });
          setResult({
            deleted_total: r.data?.deleted_total || 0,
            deleted: r.data?.deleted || {},
          });
          setStep('done');
          toast.success(`Factory reset complete — ${r.data?.deleted_total || 0} records erased.`);
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Factory reset failed.');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
          style={styles.iconBtn}
          testID="reset-back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Factory Reset</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>

        {/* Step 1 — Warning */}
        {step === 'warn' && (
          <>
            <View style={styles.dangerCard} testID="reset-step-warn">
              <View style={styles.dangerBadge}>
                <Ionicons name="warning" size={26} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>You are about to erase every patient record</Text>
              <Text style={styles.dangerSub}>
                This action is irreversible. Use it ONCE — at the end of the
                testing phase, right before the clinic opens for real patients.
              </Text>
            </View>

            <Section title="Backup FIRST">
              <Bullet text="Open Administration → Backups and download a fresh snapshot." />
              <Bullet text="Verify the snapshot opens in MongoDB Compass / Atlas before you continue here." />
              <TouchableOpacity
                onPress={() => router.push('/dashboard?tab=backups' as any)}
                style={styles.backupCta}
                testID="reset-take-backup"
              >
                <Ionicons name="cloud-download-outline" size={16} color="#fff" />
                <Text style={styles.backupCtaText}>Open Backups now</Text>
              </TouchableOpacity>
            </Section>

            <Section title="What WILL be erased">
              <Bullet text="All patient records, registrations, IPD admissions & discharges" />
              <Bullet text="All prescriptions, surgeries & operative notes, surgical consents" />
              <Bullet text="All bookings, consultations, daily rounds, vitals, drug charts" />
              <Bullet text="All medical certificates, receipts & billing entries" />
              <Bullet text="All inbox messages, broadcasts, push history, notifications" />
              <Bullet text="All analytics data, audit log, IPSS / bladder-diary / tool scores" />
              <Bullet text="Registration / IPD / receipt counters (reset to 1)" />
            </Section>

            <Section title="What is PRESERVED">
              <Bullet text="Your user account & all team members (you stay logged in)" />
              <Bullet text="Clinic settings — branding, letterhead, Rx print mode, partner permissions" />
              <Bullet text="Bed configuration, OT rooms, fee templates" />
              <Bullet text="Consulting schedule & blocked dates" />
              <Bullet text="Custom drug library & referring-doctor list" />
              <Bullet text="Platform content — announcements, blog, videos catalog" />
              <Bullet text="Backup credentials (Google Drive OAuth)" />
            </Section>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
                style={[styles.btn, styles.btnGhost]}
                testID="reset-cancel-warn"
              >
                <Text style={[styles.btnText, { color: COLORS.textPrimary }]} numberOfLines={1}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setStep('confirm')}
                style={[styles.btn, styles.btnDanger, { flex: 1.6 }]}
                testID="reset-next-warn"
              >
                <Text style={styles.btnText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
                  Backup taken · continue
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Step 2 — Type clinic name + OTP */}
        {step === 'confirm' && (
          <>
            <View style={[styles.dangerCard, { backgroundColor: '#7F1D1D' }]} testID="reset-step-confirm">
              <View style={styles.dangerBadge}>
                <Ionicons name="finger-print" size={26} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>Confirm your identity</Text>
              <Text style={styles.dangerSub}>
                Type the clinic name exactly as shown, then enter the
                6-digit code we&apos;ll email to{' '}
                <Text style={{ fontWeight: '700' }}>{(user as any)?.email || 'your owner email'}</Text>.
              </Text>
            </View>

            <Section title="Step 1 of 2 — Clinic name">
              <Text style={styles.help}>
                Type this clinic name to enable Step 2:
              </Text>
              <View style={styles.nameBadge}>
                <Text selectable style={styles.nameBadgeText}>{clinicName || '— not configured —'}</Text>
              </View>
              <TextInput
                value={typedName}
                onChangeText={setTypedName}
                placeholder="Type clinic name here"
                style={[styles.input, typedMatches && styles.inputOk]}
                autoCapitalize="words"
                autoCorrect={false}
                testID="reset-typed-name"
              />
              {typedName.length > 0 && !typedMatches ? (
                <Text style={[styles.help, { color: '#B91C1C' }]}>
                  Doesn&apos;t match. Type the name exactly as shown above.
                </Text>
              ) : null}
            </Section>

            <Section title="Step 2 of 2 — Email confirmation code">
              {!otpRequested ? (
                <TouchableOpacity
                  onPress={requestOtp}
                  disabled={!typedMatches || otpRequesting}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    (!typedMatches || otpRequesting) && styles.btnDisabled,
                  ]}
                  testID="reset-send-otp"
                >
                  {otpRequesting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="mail" size={16} color="#fff" />
                      <Text style={styles.btnText}>  Send code to my email</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <>
                  <Text style={styles.help}>
                    Code sent. Check your inbox & enter the 6-digit code below.
                    The code expires in 10 minutes.
                  </Text>
                  <TextInput
                    value={otpCode}
                    onChangeText={(v) => setOtpCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="000000"
                    style={[styles.input, otpCode.length === 6 && styles.inputOk]}
                    keyboardType="number-pad"
                    maxLength={6}
                    testID="reset-otp-code"
                  />
                  <TouchableOpacity onPress={requestOtp} disabled={otpRequesting} style={{ alignSelf: 'flex-end' }}>
                    <Text style={styles.resendLink}>
                      {otpRequesting ? 'Sending…' : 'Resend code'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </Section>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setStep('warn')}
                style={[styles.btn, styles.btnGhost]}
                testID="reset-back-warn"
              >
                <Text style={[styles.btnText, { color: COLORS.textPrimary }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={runReset}
                disabled={!canSubmit}
                style={[
                  styles.btn,
                  styles.btnDanger,
                  { flex: 1.4 },
                  !canSubmit && styles.btnDisabled,
                ]}
                testID="reset-execute"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="trash" size={16} color="#fff" />
                    <Text style={styles.btnText} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
                      {cooldown > 0 ? `  Wait ${cooldown}s…` : '  Erase ALL data'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Step 3 — Done */}
        {step === 'done' && (
          <>
            <View style={[styles.dangerCard, { backgroundColor: '#065F46' }]} testID="reset-step-done">
              <View style={[styles.dangerBadge, { backgroundColor: '#10B981' }]}>
                <Ionicons name="checkmark" size={28} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>Factory reset complete</Text>
              <Text style={styles.dangerSub}>
                {result?.deleted_total || 0} records erased across{' '}
                {Object.keys(result?.deleted || {}).length} collections. Your
                clinic settings, team and schedule are intact.
              </Text>
            </View>

            {result && result.deleted_total > 0 ? (
              <Section title="What was erased">
                {Object.entries(result.deleted)
                  .filter(([, n]) => n > 0)
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([k, n]) => (
                    <View key={k} style={styles.kvRow}>
                      <Text style={styles.kvKey}>{k}</Text>
                      <Text style={styles.kvVal}>{n}</Text>
                    </View>
                  ))}
              </Section>
            ) : null}

            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, styles.btnPrimary, { marginTop: 16 }]}
              testID="reset-done-home"
            >
              <Ionicons name="home" size={16} color="#fff" />
              <Text style={styles.btnText}>  Go to Home</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },
  dangerCard: {
    backgroundColor: '#B91C1C',
    borderRadius: RADIUS.lg,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  dangerBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#7F1D1D',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  dangerTitle: { ...FONTS.h2, color: '#fff', textAlign: 'center', marginBottom: 6 },
  dangerSub: { ...FONTS.body, color: '#FECACA', textAlign: 'center', fontSize: 13 },
  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    ...FONTS.bodyMedium,
    fontSize: 13,
    color: COLORS.primary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.primary,
    marginTop: 7,
  },
  bulletText: { ...FONTS.body, fontSize: 13, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },
  backupCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  backupCtaText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  help: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginBottom: 6, lineHeight: 18 },
  nameBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  nameBadgeText: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    color: COLORS.textPrimary,
    backgroundColor: '#fff',
  },
  inputOk: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  resendLink: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13, marginTop: 6 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    minHeight: 44,
    overflow: 'hidden',
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnDanger: { backgroundColor: '#DC2626' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  btnDisabled: { opacity: 0.45 },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14, textAlign: 'center' },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '55',
  },
  kvKey: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  kvVal: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  lockedCard: {
    margin: 16,
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lockedTitle: { ...FONTS.h2, color: COLORS.textPrimary },
  lockedSub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
});
