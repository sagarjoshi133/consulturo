import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import {
  RxDoc,
  printPrescription,
  downloadPrescriptionPdf,
  sharePrescriptionPdf,
  loadClinicSettings,
  ClinicSettings,
} from '../../src/rx-pdf';
import { haptics } from '../../src/haptics';

export default function PrescriptionDetail() {
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isOwner = user?.role === 'owner';
  // Bottom safe-area inset so the absolute-positioned action bar
  // (Edit / Print / PDF / Share / Delete) doesn't get clipped by the
  // Android nav-gesture pill or the iOS home-indicator. Replaces the
  // earlier hardcoded paddingBottom: ios?28:10 which was wrong on
  // gesture-nav phones (Pixel 7 / S22) and on Dynamic-Island iPhones.
  const insets = useSafeAreaInsets();

  const [rx, setRx] = useState<RxDoc | null>(null);
  const [settings, setSettings] = useState<ClinicSettings>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>(''); // 'print' | 'pdf' | 'delete'

  const load = useCallback(async () => {
    try {
      const [rxRes, s] = await Promise.all([
        api.get(`/prescriptions/${id}`),
        loadClinicSettings(),
      ]);
      setRx(rxRes.data);
      setSettings(s);
    } catch {
      setRx(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runPrint = async () => {
    if (!rx) return;
    setBusy('print');
    await printPrescription(rx, settings);
    setBusy('');
  };

  const runDownload = async () => {
    if (!rx) return;
    setBusy('pdf');
    await downloadPrescriptionPdf(rx, settings);
    setBusy('');
  };

  const runShare = async () => {
    if (!rx) return;
    setBusy('share');
    haptics.tap();
    await sharePrescriptionPdf(rx, settings);
    setBusy('');
  };

  const runDelete = () => {
    if (!rx) return;
    const doDelete = async () => {
      setBusy('delete');
      try {
        await api.delete(`/prescriptions/${rx.prescription_id}`);
        router.back();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Error', msg);
      } finally {
        setBusy('');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this prescription permanently?')) doDelete();
    } else {
      Alert.alert('Delete prescription?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!rx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Prescription</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={54} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="rx-detail-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Prescription</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* Patient header card */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.patientName}>{rx.patient_name || '—'}</Text>
              <Text style={styles.metaLine}>
                {[rx.patient_age ? `${rx.patient_age} yrs` : '', rx.patient_gender || ''].filter(Boolean).join(' · ')}
                {rx.patient_phone ? `  ·  ${rx.patient_phone}` : ''}
              </Text>
              {rx.registration_no ? (
                <View style={styles.regPill}>
                  <Ionicons name="id-card-outline" size={12} color={COLORS.primary} />
                  <Text style={styles.regPillText}>Reg. {rx.registration_no}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.rxPill}>
              <Text style={styles.rxPillText}>Rx</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
            <Info k="Visit" v={rx.visit_date || (rx.created_at ? format(new Date(rx.created_at), 'dd-MM-yyyy') : '')} />
            {rx.ref_doctor ? <Info k="Referred by" v={rx.ref_doctor} /> : null}
            <Info k="Rx ID" v={rx.prescription_id} mono />
          </View>
        </View>

        {rx.vitals ? <Section title="Vitals" body={rx.vitals} /> : null}
        {rx.chief_complaints ? <Section title="Chief Complaints" body={rx.chief_complaints} /> : null}
        {rx.investigation_findings ? <Section title="Investigation Findings" body={rx.investigation_findings} /> : null}
        {rx.diagnosis ? <Section title="Diagnosis" body={rx.diagnosis} /> : null}

        <Text style={styles.sectionTitle}>Medications</Text>
        {(rx.medicines || []).length === 0 ? (
          <Text style={styles.empty2}>No medicines prescribed.</Text>
        ) : (
          (rx.medicines || []).map((m, i) => (
            <View key={i} style={styles.medCard}>
              <View style={styles.medHead}>
                <View style={styles.medNumBadge}>
                  <Text style={styles.medNumBadgeText}>{i + 1}</Text>
                </View>
                <Text style={styles.medName}>{m.name}</Text>
              </View>
              {m.dosage ? <Text style={styles.medDose}>{m.dosage}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {m.frequency ? <Tag text={m.frequency} /> : null}
                {m.duration ? <Tag text={`× ${m.duration}`} /> : null}
                {m.timing ? <Tag text={m.timing} /> : null}
              </View>
              {m.instructions ? <Text style={styles.medInstr}>{m.instructions}</Text> : null}
            </View>
          ))
        )}

        {rx.investigations_advised ? <Section title="Investigations Advised" body={rx.investigations_advised} /> : null}
        {rx.advice ? <Section title="Advice" body={rx.advice} /> : null}
        {rx.follow_up ? <Section title="Follow-up" body={rx.follow_up} /> : null}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        <ActionBtn
          icon="create-outline"
          label="Edit"
          onPress={() => router.push({ pathname: '/prescriptions/new', params: { rxId: rx.prescription_id } } as any)}
          testID="rx-action-edit"
        />
        <ActionBtn
          icon="print-outline"
          label="Print"
          onPress={runPrint}
          loading={busy === 'print'}
          testID="rx-action-print"
        />
        <ActionBtn
          icon="download-outline"
          label="PDF"
          onPress={runDownload}
          loading={busy === 'pdf'}
          testID="rx-action-pdf"
        />
        <ActionBtn
          icon="share-social-outline"
          label="Share"
          onPress={runShare}
          loading={busy === 'share'}
          testID="rx-action-share"
        />
        {isOwner && (
          <ActionBtn
            icon="trash-outline"
            label="Delete"
            color={COLORS.accent}
            onPress={runDelete}
            loading={busy === 'delete'}
            testID="rx-action-delete"
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Info({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  if (!v) return null;
  return (
    <View style={{ minWidth: 90 }}>
      <Text style={styles.infoK}>{k}</Text>
      <Text style={[styles.infoV, mono && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 }]} numberOfLines={1}>
        {v}
      </Text>
    </View>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{text}</Text>
    </View>
  );
}

function ActionBtn({
  icon,
  label,
  onPress,
  loading,
  color,
  testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  loading?: boolean;
  color?: string;
  testID?: string;
}) {
  const c = color || COLORS.primary;
  return (
    <TouchableOpacity onPress={onPress} style={[styles.actionBtn]} disabled={loading} testID={testID}>
      {loading ? (
        <ActivityIndicator color={c} size="small" />
      ) : (
        <Ionicons name={icon} size={20} color={c} />
      )}
      <Text style={[styles.actionBtnText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  empty2: { ...FONTS.body, color: COLORS.textSecondary, fontStyle: 'italic' },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  patientName: { ...FONTS.h3, color: COLORS.textPrimary },
  metaLine: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  regPill: { marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary + '12', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  regPillText: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },
  rxPill: { backgroundColor: COLORS.primary + '18', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 12 },
  rxPillText: { ...FONTS.label, color: COLORS.primary, fontSize: 12 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  infoK: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoV: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginTop: 2 },

  sectionTitle: { ...FONTS.label, color: COLORS.primary, marginTop: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 },
  sectionBody: { ...FONTS.body, color: COLORS.textPrimary, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, lineHeight: 20 },

  medCard: { backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  medHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  medNumBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  medNumBadgeText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 12 },
  medName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15, flex: 1 },
  medDose: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginLeft: 36, marginTop: 2 },
  medInstr: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic', marginLeft: 36, marginTop: 6 },
  tag: { backgroundColor: COLORS.primary + '10', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 36 },
  tagText: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },

  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: COLORS.border, paddingVertical: 10, paddingHorizontal: 10 },
  actionBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 3 },
  actionBtnText: { ...FONTS.label, fontSize: 11 },
});
