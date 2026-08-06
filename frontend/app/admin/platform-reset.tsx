/**
 * Platform Reset — /admin/platform-reset
 *
 * Super-Owner ONLY destructive flow that wipes operational data
 * across EVERY clinic on the platform. Sibling of
 * /admin/factory-reset (which scopes to a single clinic).
 *
 * Multi-step guard:
 *   1. Warning page — even louder than the per-clinic one; lists
 *      every tenant that will be touched.
 *   2. Confirm page — user must type the EXACT phrase
 *      "RESET ENTIRE PLATFORM" (case-sensitive) AND enter a fresh
 *      6-digit OTP delivered to the super_owner email.
 *   3. Done page — per-collection counts + count of clinics that
 *      survived intact.
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
const REQUIRED_PHRASE = 'RESET ENTIRE PLATFORM';

export default function PlatformResetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const role = (user as any)?.role || '';
  const isAllowed = role === 'super_owner';

  const [step, setStep] = useState<Step>('warn');
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpRequesting, setOtpRequesting] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<{
    deleted_total: number;
    deleted: Record<string, number>;
    clinics_preserved: number;
  } | null>(null);

  // 5-second cool-down after enabling the Reset button so accidental
  // double-taps can't fire it instantly.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Case-SENSITIVE phrase match — distinct from the per-clinic reset
  // which only requires a case-insensitive clinic-name match. The
  // stronger gate matches the strictly-higher blast radius.
  const phraseMatches = useMemo(
    () => typedPhrase === REQUIRED_PHRASE,
    [typedPhrase],
  );
  const canSubmit = phraseMatches && otpCode.trim().length >= 4 && !busy && cooldown === 0;

  if (!isAllowed) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
            style={styles.iconBtn}
            testID="presets-back"
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Platform Reset</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.lockedTitle}>Super-Owner only</Text>
          <Text style={styles.lockedSub}>
            Platform-wide reset is locked to the platform Super Owner.
            If you need to reset YOUR clinic only, use{' '}
            <Text
              onPress={() => router.replace('/admin/factory-reset' as any)}
              style={{ color: COLORS.primary }}
            >
              Factory Reset
            </Text>{' '}instead.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const requestOtp = async () => {
    setOtpRequesting(true);
    try {
      await api.post('/admin/platform-reset/request-otp');
      setOtpRequested(true);
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
      title: 'Wipe data for EVERY clinic?',
      message:
        `This will permanently delete operational data across every ` +
        `clinic on the ConsultUro platform — not just yours. This ` +
        `action CANNOT be undone. Only proceed if platform-wide ` +
        `backups are confirmed.`,
      confirmText: 'Yes, wipe the platform',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          const r = await api.post('/admin/platform-reset/execute', {
            confirm_phrase: typedPhrase,
            otp_code: otpCode.trim(),
          });
          setResult({
            deleted_total: r.data?.deleted_total || 0,
            deleted: r.data?.deleted || {},
            clinics_preserved: r.data?.clinics_preserved || 0,
          });
          setStep('done');
          toast.success(`Platform reset complete — ${r.data?.deleted_total || 0} records erased.`);
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Platform reset failed.');
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
          testID="presets-back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Platform Reset</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>

        {/* Step 1 — Warning */}
        {step === 'warn' && (
          <>
            <View style={styles.dangerCard} testID="presets-step-warn">
              <View style={styles.dangerBadge}>
                <Ionicons name="nuclear" size={28} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>
                Platform-wide erase — every tenant
              </Text>
              <Text style={styles.dangerSub}>
                This is the platform&apos;s nuclear option. Every clinic
                on ConsultUro will lose its operational data the moment
                you confirm. Use ONCE — at the end of platform-wide
                testing, right before production rollout.
              </Text>
            </View>

            <Section title="Backup FIRST — for every clinic">
              <Bullet text="Open Administration → Backups (under your active clinic context) and verify a recent snapshot exists." />
              <Bullet text="If multiple clinics are live in the testing phase, ask each clinic's owner to confirm their own snapshot too." />
              <TouchableOpacity
                onPress={() => router.push('/dashboard?tab=backups' as any)}
                style={styles.backupCta}
                testID="presets-take-backup"
              >
                <Ionicons name="cloud-download-outline" size={16} color="#fff" />
                <Text style={styles.backupCtaText}>Open Backups</Text>
              </TouchableOpacity>
            </Section>

            <Section title="What WILL be erased — for every clinic">
              <Bullet text="All patient records, registrations, IPD admissions & discharges" />
              <Bullet text="All prescriptions, surgeries, operative notes, surgical consents" />
              <Bullet text="All bookings, consultations, daily rounds, vitals, drug charts" />
              <Bullet text="All medical certificates, receipts, billing entries" />
              <Bullet text="All inbox messages, broadcasts, push history, notifications" />
              <Bullet text="All analytics, audit log, IPSS / bladder-diary / tool scores" />
              <Bullet text="Registration / IPD / receipt counters (reset to 1 platform-wide)" />
            </Section>

            <Section title="What is PRESERVED — across every clinic">
              <Bullet text="All user accounts on the platform (every owner, partner, doctor, nurse, reception & patient stays logged in)" />
              <Bullet text="All clinic records & clinic settings (branding, letterhead, Rx print mode)" />
              <Bullet text="Bed configs, OT rooms, fee templates, schedules per clinic" />
              <Bullet text="Custom drug libraries & referring-doctor lists per clinic" />
              <Bullet text="Platform content — announcements, blog, videos catalog" />
              <Bullet text="Backup credentials (Google Drive OAuth) per clinic" />
            </Section>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
                style={[styles.btn, styles.btnGhost]}
                testID="presets-cancel-warn"
              >
                <Text style={[styles.btnText, { color: COLORS.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setStep('confirm')}
                style={[styles.btn, styles.btnDanger]}
                testID="presets-next-warn"
              >
                <Text style={styles.btnText}>Backups verified — continue</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Step 2 — Phrase + OTP */}
        {step === 'confirm' && (
          <>
            <View style={[styles.dangerCard, { backgroundColor: '#450A0A' }]} testID="presets-step-confirm">
              <View style={styles.dangerBadge}>
                <Ionicons name="finger-print" size={26} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>Final confirmation</Text>
              <Text style={styles.dangerSub}>
                Type the exact phrase below (case-sensitive) and enter
                the 6-digit code sent to{' '}
                <Text style={{ fontWeight: '700' }}>
                  {(user as any)?.email || 'your super-owner email'}
                </Text>.
              </Text>
            </View>

            <Section title="Step 1 of 2 — Type the confirmation phrase">
              <Text style={styles.help}>
                Type this phrase exactly (case-sensitive, no quotes):
              </Text>
              <View style={styles.nameBadge}>
                <Text selectable style={styles.nameBadgeText}>{REQUIRED_PHRASE}</Text>
              </View>
              <TextInput
                value={typedPhrase}
                onChangeText={setTypedPhrase}
                placeholder="Type the phrase here"
                style={[styles.input, phraseMatches && styles.inputOk]}
                autoCapitalize="characters"
                autoCorrect={false}
                testID="presets-typed-phrase"
              />
              {typedPhrase.length > 0 && !phraseMatches ? (
                <Text style={[styles.help, { color: '#B91C1C' }]}>
                  Doesn&apos;t match exactly. Case-sensitive — type{' '}
                  <Text style={{ fontWeight: '700' }}>{REQUIRED_PHRASE}</Text>.
                </Text>
              ) : null}
            </Section>

            <Section title="Step 2 of 2 — Email confirmation code">
              {!otpRequested ? (
                <TouchableOpacity
                  onPress={requestOtp}
                  disabled={!phraseMatches || otpRequesting}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    (!phraseMatches || otpRequesting) && styles.btnDisabled,
                  ]}
                  testID="presets-send-otp"
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
                    Code sent. Check your inbox &amp; enter the 6-digit
                    code below. The code expires in 10 minutes.
                  </Text>
                  <TextInput
                    value={otpCode}
                    onChangeText={(v) => setOtpCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="000000"
                    style={[styles.input, otpCode.length === 6 && styles.inputOk]}
                    keyboardType="number-pad"
                    maxLength={6}
                    testID="presets-otp-code"
                  />
                  <TouchableOpacity
                    onPress={requestOtp}
                    disabled={otpRequesting}
                    style={{ alignSelf: 'flex-end' }}
                  >
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
                testID="presets-back-warn"
              >
                <Text style={[styles.btnText, { color: COLORS.textPrimary }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={runReset}
                disabled={!canSubmit}
                style={[
                  styles.btn,
                  styles.btnDanger,
                  !canSubmit && styles.btnDisabled,
                ]}
                testID="presets-execute"
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="nuclear" size={16} color="#fff" />
                    <Text style={styles.btnText}>
                      {cooldown > 0 ? `  Wait ${cooldown}s…` : '  Wipe the platform'}
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
            <View style={[styles.dangerCard, { backgroundColor: '#065F46' }]} testID="presets-step-done">
              <View style={[styles.dangerBadge, { backgroundColor: '#10B981' }]}>
                <Ionicons name="checkmark" size={28} color="#fff" />
              </View>
              <Text style={styles.dangerTitle}>Platform reset complete</Text>
              <Text style={styles.dangerSub}>
                {result?.deleted_total || 0} records erased across the
                platform. {result?.clinics_preserved || 0} clinic record
                {(result?.clinics_preserved || 0) === 1 ? '' : 's'}
                {' '}preserved with their settings, teams &amp; schedules intact.
              </Text>
            </View>

            {result && result.deleted_total > 0 ? (
              <Section title="What was erased">
                {Object.entries(result.deleted)
                  .filter(([, n]) => (n as number) > 0)
                  .sort((a, b) => (b[1] as number) - (a[1] as number))
                  .map(([k, n]) => (
                    <View key={k} style={styles.kvRow}>
                      <Text style={styles.kvKey}>{k}</Text>
                      <Text style={styles.kvVal}>{String(n)}</Text>
                    </View>
                  ))}
              </Section>
            ) : null}

            <TouchableOpacity
              onPress={() => router.replace('/' as any)}
              style={[styles.btn, styles.btnPrimary, { marginTop: 16 }]}
              testID="presets-done-home"
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
  // Darker, more ominous red than the per-clinic factory-reset palette
  // — visually distinct so the super-owner registers the blast radius.
  dangerCard: {
    backgroundColor: '#7F1D1D',
    borderRadius: RADIUS.lg,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  dangerBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#450A0A',
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
    width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 7,
  },
  bulletText: { ...FONTS.body, fontSize: 13, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },
  backupCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: RADIUS.pill, marginTop: 10, alignSelf: 'flex-start',
  },
  backupCtaText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  help: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginBottom: 6, lineHeight: 18 },
  nameBadge: {
    backgroundColor: '#FEE2E2', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: '#B91C1C',
  },
  nameBadgeText: { ...FONTS.bodyMedium, fontSize: 16, color: '#7F1D1D', letterSpacing: 1 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15, color: COLORS.textPrimary, backgroundColor: '#fff',
  },
  inputOk: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  resendLink: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13, marginTop: 6 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: RADIUS.pill,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnDanger: { backgroundColor: '#7F1D1D' },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  btnDisabled: { opacity: 0.45 },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  kvRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: COLORS.border + '55',
  },
  kvKey: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  kvVal: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  lockedCard: {
    margin: 16, backgroundColor: '#fff', padding: 24,
    borderRadius: RADIUS.lg, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  lockedTitle: { ...FONTS.h2, color: COLORS.textPrimary },
  lockedSub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
});
