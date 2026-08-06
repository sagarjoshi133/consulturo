/*
 * /admin/video-settings.tsx — clinic-wide video consultation
 * preferences screen. Renders the settings exposed by
 * GET/PUT /api/video/settings as a clean toggle list with
 * Save-on-change semantics (debounced) so doctors don't have to
 * remember to tap a save button.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../src/api';
import PermissionGate from '../../src/permission-gate';
import { COLORS, FONTS, RADIUS } from '../../src/theme';

type VideoSettings = {
  auto_provision_on_confirm: boolean;
  auto_notify_patient: boolean;
  default_mic_on: boolean;
  default_camera_on: boolean;
  waiting_room: boolean;
  auto_record: boolean;
  allow_join_minutes_before: number;
  allow_join_minutes_after: number;
  pre_call_reminder_minutes: number;
  show_clinic_branding: boolean;
  // Bundle A+B+C
  enable_precall_intake: boolean;
  no_show_grace_minutes: number;
  enable_post_call_feedback: boolean;
  // Bundle G+H
  enable_recording_consent: boolean;
  enable_auto_summary: boolean;
  // Bundle E+F+I
  enable_rx_draft: boolean;
  enable_queue_position: boolean;
  enable_attachments: boolean;
};

const DEFAULTS: VideoSettings = {
  auto_provision_on_confirm: true,
  auto_notify_patient: true,
  default_mic_on: false,
  default_camera_on: true,
  waiting_room: true,
  auto_record: false,
  allow_join_minutes_before: 15,
  allow_join_minutes_after: 60,
  pre_call_reminder_minutes: 5,
  show_clinic_branding: true,
  enable_precall_intake: true,
  no_show_grace_minutes: 15,
  enable_post_call_feedback: true,
  enable_recording_consent: false,
  enable_auto_summary: true,
  enable_rx_draft: true,
  enable_queue_position: true,
  enable_attachments: true,
};

export default function VideoSettingsScreen() {
  return (
    <PermissionGate require="can_manage_settings" title="Video Consultation">
      <VideoSettingsInner />
    </PermissionGate>
  );
}

function VideoSettingsInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [settings, setSettings] = useState<VideoSettings>(DEFAULTS);
  const [domain, setDomain] = useState('consulturo.app.100ms.live');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/video/settings')
      .then((r) => {
        setSettings({ ...DEFAULTS, ...(r.data?.settings || {}) });
        setDomain(r.data?.domain || domain);
      })
      .catch((e) => setError(e?.response?.data?.detail || 'Could not load settings.'))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (next: VideoSettings) => {
    setSaving(true);
    setError(null);
    try {
      const r = await api.put('/video/settings', next);
      setSettings({ ...DEFAULTS, ...(r.data?.settings || {}) });
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Save failed.');
      Alert.alert('Save failed', e?.response?.data?.detail || 'Try again.');
    } finally {
      setSaving(false);
    }
  }, []);

  const onBool = (k: keyof VideoSettings) => (v: boolean) => {
    const next = { ...settings, [k]: v };
    setSettings(next); save(next);
  };

  const onInt = (k: keyof VideoSettings) => (raw: string) => {
    const n = Math.max(0, parseInt(raw || '0', 10) || 0);
    setSettings((p) => ({ ...p, [k]: n }));
  };
  const onIntCommit = (k: keyof VideoSettings) => () => {
    save({ ...settings });
  };

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primaryDark} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Video consultation</Text>
        {saving ? <ActivityIndicator size="small" color={COLORS.primary} /> : <View style={{ width: 22 }} />}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <Ionicons name="globe-outline" size={16} color={COLORS.primary} />
          <Text style={styles.brandRowText}>Custom domain: <Text style={{ fontWeight: '700', color: COLORS.primaryDark }}>{domain}</Text></Text>
        </View>

        {error ? <Text style={styles.errText}>{error}</Text> : null}

        {/* AUTOMATION */}
        <Section title="Automation">
          <ToggleRow
            label="Auto-provision room when booking confirmed"
            sub="A 100ms room is created the moment you confirm a video booking — the patient gets their join link in the confirmation message."
            value={settings.auto_provision_on_confirm}
            onChange={onBool('auto_provision_on_confirm')}
            testID="ts-auto-provision"
          />
          <ToggleRow
            label="Auto-send link to patient"
            sub="On provision, automatically WhatsApp / push the patient their join link."
            value={settings.auto_notify_patient}
            onChange={onBool('auto_notify_patient')}
            testID="ts-auto-notify"
          />
        </Section>

        {/* JOIN UX */}
        <Section title="Join experience">
          <ToggleRow
            label="Waiting room"
            sub="Patient lands in a clinic-branded waiting screen until you admit them."
            value={settings.waiting_room}
            onChange={onBool('waiting_room')}
          />
          <ToggleRow
            label="Show ConsultUro branding in waiting room"
            sub="Logo, doctor name, clinic name visible during pre-call."
            value={settings.show_clinic_branding}
            onChange={onBool('show_clinic_branding')}
          />
          <ToggleRow
            label="Patient mic ON by default"
            sub="Mic state when the patient first joins. Off is more polite (avoids dog/TV noise on join)."
            value={settings.default_mic_on}
            onChange={onBool('default_mic_on')}
          />
          <ToggleRow
            label="Patient camera ON by default"
            sub="Camera state when patient first joins."
            value={settings.default_camera_on}
            onChange={onBool('default_camera_on')}
          />
        </Section>

        {/* PRIVACY */}
        <Section title="Privacy & recording">
          <ToggleRow
            label="Auto-record every consult"
            sub="OFF by default. Turn ON only with explicit patient consent. Recordings live in 100ms cloud and count against your plan minutes."
            value={settings.auto_record}
            onChange={onBool('auto_record')}
            danger={settings.auto_record}
          />
        </Section>

        {/* TIMING */}
        <Section title="Join window">
          <IntRow
            label="Allow join (minutes before appointment)"
            value={settings.allow_join_minutes_before}
            onChange={onInt('allow_join_minutes_before')}
            onBlur={onIntCommit('allow_join_minutes_before')}
          />
          <IntRow
            label="Allow join (minutes after appointment)"
            value={settings.allow_join_minutes_after}
            onChange={onInt('allow_join_minutes_after')}
            onBlur={onIntCommit('allow_join_minutes_after')}
          />
          <IntRow
            label="Send pre-call reminder (minutes before)"
            value={settings.pre_call_reminder_minutes}
            onChange={onInt('pre_call_reminder_minutes')}
            onBlur={onIntCommit('pre_call_reminder_minutes')}
          />
        </Section>

        {/* PATIENT EXPERIENCE — Bundle A+B+C */}
        <Section title="Patient experience">
          <ToggleRow
            label="Pre-call vitals & symptom intake"
            sub="Patients fill an optional BP/temperature/symptoms form before joining — visible on your console the moment they submit."
            value={settings.enable_precall_intake}
            onChange={onBool('enable_precall_intake')}
            testID="ts-precall-intake"
          />
          <ToggleRow
            label="Ask for feedback after the call"
            sub="1-tap 5-star rating + optional comment. Low ratings (≤3) alert you on Telegram."
            value={settings.enable_post_call_feedback}
            onChange={onBool('enable_post_call_feedback')}
            testID="ts-post-feedback"
          />
          <IntRow
            label="Auto-mark no-show after (minutes)"
            value={settings.no_show_grace_minutes}
            onChange={onInt('no_show_grace_minutes')}
            onBlur={onIntCommit('no_show_grace_minutes')}
          />
        </Section>

        {/* CLINICAL TOOLS — Bundle G+H */}
        <Section title="Clinical tools">
          <ToggleRow
            label="Ask patient for recording consent"
            sub="Patient sees a consent banner on the pre-call screen. Recording can only start after they tap 'I consent'."
            value={settings.enable_recording_consent}
            onChange={onBool('enable_recording_consent')}
            testID="ts-recording-consent"
          />
          <ToggleRow
            label="AI-generated post-call summary"
            sub="Shows a 'Generate summary' button on the staff console. Drafts a SOAP note + a WhatsApp follow-up message from your notes + the patient's intake."
            value={settings.enable_auto_summary}
            onChange={onBool('enable_auto_summary')}
            testID="ts-auto-summary"
          />
          <ToggleRow
            label="AI-drafted prescription"
            sub="Shows 'Generate Rx draft' on the summary card — pre-fills a Prescription form with diagnosis, investigations, advice, and suggested medicines. You must review & sign."
            value={settings.enable_rx_draft}
            onChange={onBool('enable_rx_draft')}
            testID="ts-rx-draft"
          />
        </Section>

        {/* PATIENT WORKFLOW — Bundle F + I */}
        <Section title="Patient workflow">
          <ToggleRow
            label="Live queue position"
            sub="Patient sees 'You are #2 in line · est wait 8 min' while waiting on the pre-call screen."
            value={settings.enable_queue_position}
            onChange={onBool('enable_queue_position')}
            testID="ts-queue"
          />
          <ToggleRow
            label="Allow file & image attachments"
            sub="Both patient and doctor can upload reports, X-ray/USG snapshots, and lab PDFs (max 8 MB per file) — stored on the booking."
            value={settings.enable_attachments}
            onChange={onBool('enable_attachments')}
            testID="ts-attachments"
          />
        </Section>

        <View style={{ height: insets.bottom + 24 }} />
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionInner}>{children}</View>
    </View>
  );
}

function ToggleRow({
  label, sub, value, onChange, danger, testID,
}: {
  label: string; sub?: string; value: boolean; onChange: (v: boolean) => void; danger?: boolean; testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sub ? <Text style={[styles.rowSub, danger ? { color: '#B91C1C' } : null]}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#C9D8DC', true: COLORS.primary + '99' }}
        thumbColor={value ? COLORS.primary : '#fff'}
        ios_backgroundColor="#C9D8DC"
      />
    </View>
  );
}

function IntRow({
  label, value, onChange, onBlur,
}: {
  label: string; value: number; onChange: (v: string) => void; onBlur: () => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={onChange}
        onBlur={onBlur}
        onSubmitEditing={onBlur}
        keyboardType="number-pad"
        inputMode="numeric"
        style={styles.intInput}
        returnKeyType="done"
        maxLength={3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#F4F9FA' },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F9FA' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2ECEC' },
  topTitle: { color: COLORS.primaryDark, ...FONTS.h4, fontSize: 16 },
  scroll: { paddingTop: 12, paddingBottom: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2ECEC' },
  brandRowText: { fontSize: 12, color: '#5E7C81' },
  errText: { marginHorizontal: 16, color: '#B91C1C', fontSize: 12.5, marginVertical: 6 },
  section: { marginTop: 14, marginHorizontal: 16 },
  sectionTitle: { color: COLORS.primaryDark, fontSize: 11, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  sectionInner: { backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: '#E2ECEC', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: '#E2ECEC' },
  rowLabel: { color: '#1A2E35', ...FONTS.bodyMedium, fontSize: 13.5 },
  rowSub: { color: '#5E7C81', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  intInput: { borderWidth: 1, borderColor: COLORS.primary + '44', borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 7, minWidth: 60, textAlign: 'center', color: COLORS.primaryDark, fontWeight: '700', fontSize: 14, backgroundColor: '#F4F9FA' },
});
