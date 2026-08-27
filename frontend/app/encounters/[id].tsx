/**
 * Encounter detail — Clinical Core (Phase E).
 * Read view of one encounter with actions: Create/open linked Rx,
 * Edit, Delete.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { invalidateCached } from '../../src/data-cache';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';
import { buildEncounterSummaryHtml } from '../../src/encounter-pdf';
import { sharePdfFromHtml } from '../../src/pdf-share';

function fmtDateTime(v?: string): string {
  if (!v) return '';
  try {
    return new Date(v).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(v); }
}

export default function EncounterDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [enc, setEnc] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/encounters/${id}`);
      setEnc(data);
    } catch {
      setEnc(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doDelete = useCallback(() => {
    const run = async () => {
      setDeleting(true);
      try {
        await api.delete(`/encounters/${id}`);
        invalidateCached('encounters:');
        goBackSafe(router, '/encounters');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        if (Platform.OS === 'web') window.alert(String(msg));
        else Alert.alert('Delete failed', String(msg));
      } finally {
        setDeleting(false);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this encounter? This cannot be undone.')) void run();
    } else {
      Alert.alert('Delete encounter?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]);
    }
  }, [id, router]);

  const exportPdf = useCallback(async () => {
    if (!enc) return;
    setExporting(true);
    try {
      const html = await buildEncounterSummaryHtml(enc);
      const safeName = String(enc.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
      const filename = `Visit-Summary-${safeName || 'Patient'}-${String(enc.encounter_id).slice(0, 8)}`;
      await sharePdfFromHtml(html, filename, `Visit Summary — ${enc.patient_name || ''}`.trim());
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not generate the visit summary';
      if (Platform.OS === 'web') window.alert(String(msg));
      else Alert.alert('Export failed', String(msg));
    } finally {
      setExporting(false);
    }
  }, [enc]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }
  if (!enc) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}><Text style={styles.err}>Encounter not found.</Text></View>
      </SafeAreaView>
    );
  }

  const vitals = enc.vitals || {};
  const vitalPairs: [string, string][] = [
    ['BP', vitals.bp], ['Pulse', vitals.pulse], ['Temp', vitals.temp],
    ['SpO₂', vitals.spo2], ['Wt', vitals.weight],
  ].filter(([, v]) => !!v) as [string, string][];

  const Section = ({ label, value }: { label: string; value?: string }) =>
    value ? (
      <View style={styles.sectionBlock}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionText}>{value}</Text>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters')} style={styles.backBtn} testID="encdet-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Encounter</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={exportPdf} style={styles.iconBtn} disabled={exporting} testID="encdet-export">
          {exporting ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="share-outline" size={20} color={COLORS.primary} />}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push(`/encounters/new?editId=${enc.encounter_id}` as any)} style={styles.iconBtn} testID="encdet-edit">
          <Ionicons name="create-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={doDelete} style={styles.iconBtn} disabled={deleting} testID="encdet-delete">
          {deleting ? <ActivityIndicator size="small" color={COLORS.danger} /> : <Ionicons name="trash-outline" size={20} color={COLORS.danger} />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.patient}>
            {enc.patient_name}
            {!!(enc.patient_age || enc.patient_sex) && (
              <Text style={styles.patientMeta}>  {enc.patient_age}{enc.patient_sex ? `/${enc.patient_sex[0]}` : ''}</Text>
            )}
          </Text>
          {!!enc.patient_phone && <Text style={styles.meta}>{enc.patient_phone}</Text>}
          <Text style={styles.meta}>
            {fmtDateTime(enc.created_at)}{enc.created_by_name ? ` · ${enc.created_by_name}` : ''}
          </Text>
          {!!enc.follow_up_date && (
            <View style={styles.fuBadge}>
              <Ionicons name="calendar" size={13} color="#B45309" />
              <Text style={styles.fuBadgeText}>Follow-up: {enc.follow_up_date}</Text>
            </View>
          )}
          {vitalPairs.length > 0 && (
            <View style={styles.vitalsRow}>
              {vitalPairs.map(([k, v]) => (
                <View key={k} style={styles.vitalChip}>
                  <Text style={styles.vitalKey}>{k}</Text>
                  <Text style={styles.vitalVal}>{v}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {(enc.diagnoses || []).length > 0 && (
          <View style={styles.chipsRow}>
            {enc.diagnoses.map((d: string) => (
              <View key={d} style={styles.dxChip}><Text style={styles.dxChipText}>{d}</Text></View>
            ))}
          </View>
        )}

        <Section label="Chief Complaint" value={enc.chief_complaint} />
        <Section label="Subjective" value={enc.subjective} />
        <Section label="Objective" value={enc.objective} />
        <Section label="Assessment" value={enc.assessment} />
        <Section label="Plan" value={enc.plan} />

        <TouchableOpacity
          style={styles.exportBtn}
          onPress={exportPdf}
          disabled={exporting}
          testID="encdet-export-btn"
        >
          {exporting ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="document-attach-outline" size={18} color={COLORS.primary} />}
          <Text style={styles.exportBtnText}>Export Visit Summary PDF</Text>
        </TouchableOpacity>


        {enc.prescription_id ? (
          <TouchableOpacity
            style={styles.rxBtn}
            onPress={() => router.push(`/prescriptions/${enc.prescription_id}` as any)}
            testID="encdet-open-rx"
          >
            <Ionicons name="document-text" size={18} color={COLORS.success} />
            <Text style={[styles.rxBtnText, { color: COLORS.success }]}>Open linked prescription</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.rxBtn, { backgroundColor: COLORS.primary }]}
            onPress={() => router.push(`/prescriptions/new?encounterId=${enc.encounter_id}` as any)}
            testID="encdet-create-rx"
          >
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={[styles.rxBtnText, { color: '#fff' }]}>Create prescription from this encounter</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { ...FONTS.body, color: COLORS.accent },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  backBtn: { padding: 4 },
  headerTitle: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  iconBtn: { padding: 8 },
  body: { padding: 16, paddingBottom: 60, gap: 12 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  patient: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  patientMeta: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary },
  meta: { ...FONTS.body, fontSize: 12.5, color: COLORS.textSecondary },
  vitalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  vitalChip: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: COLORS.bg, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: COLORS.border,
  },
  vitalKey: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.textSecondary },
  vitalVal: { ...FONTS.bodyMedium, fontSize: 12, color: COLORS.textPrimary },
  fuBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5, marginTop: 8,
  },
  fuBadgeText: { ...FONTS.bodyMedium, fontSize: 12, color: '#92400E' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dxChip: { backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dxChipText: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.primaryDark },
  sectionBlock: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 4,
  },
  sectionLabel: { ...FONTS.bodyMedium, fontSize: 11.5, color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionText: { ...FONTS.body, fontSize: 14, color: COLORS.textPrimary, lineHeight: 21 },
  rxBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.success + '14', borderRadius: RADIUS.md, paddingVertical: 14, marginTop: 6,
  },
  rxBtnText: { ...FONTS.bodyMedium, fontSize: 14 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary + '10', borderWidth: 1, borderColor: COLORS.primary + '33',
    borderRadius: RADIUS.md, paddingVertical: 14, marginTop: 6,
  },
  exportBtnText: { ...FONTS.bodyMedium, fontSize: 14, color: COLORS.primary },
});
