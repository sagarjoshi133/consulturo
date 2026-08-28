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
import { buildEncounterHtml } from '../../src/encounter-pdf';
import { loadClinicSettings } from '../../src/rx-pdf';
import { sharePdfFromHtml } from '../../src/pdf-share';
import { sharePdfThenWhatsApp } from '../../src/whatsapp-pdf';
import { haptics } from '../../src/haptics';
import { useAuth } from '../../src/auth';

const PRESCRIBER_ROLES = ['doctor', 'owner', 'primary_owner', 'partner', 'super_owner'];

const STAGE_META: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'Open', color: '#B45309', bg: '#FEF3C7' },
  in_consultation: { label: 'In Consultation', color: '#6D28D9', bg: '#EDE9FE' },
  completed: { label: 'Completed', color: '#047857', bg: '#D1FAE5' },
};
const PAY_META: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Payment pending', color: '#B45309', bg: '#FEF3C7' },
  paid: { label: 'Paid', color: '#047857', bg: '#D1FAE5' },
  waived: { label: 'Waived off', color: '#64748B', bg: '#F1F5F9' },
};

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
  const { user } = useAuth();
  const canWaive = PRESCRIBER_ROLES.includes(String((user as any)?.role || ''));
  const { id } = useLocalSearchParams<{ id: string }>();
  const [enc, setEnc] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [startingConsult, setStartingConsult] = useState(false);
  const [waiving, setWaiving] = useState(false);

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
      const html = await buildEncounterHtml(enc, await loadClinicSettings());
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

  const sendWhatsApp = useCallback(async () => {
    if (!enc) return;
    if (!String(enc.patient_phone || '').replace(/\D/g, '')) {
      const msg = 'No phone number on file for this patient.';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Cannot send', msg);
      return;
    }
    setSendingWa(true);
    try {
      const settings = await loadClinicSettings();
      const html = await buildEncounterHtml(enc, settings);
      const safeName = String(enc.patient_name || 'patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
      const filename = `Visit-Summary-${safeName || 'Patient'}-${String(enc.encounter_id).slice(0, 8)}`;
      await sharePdfThenWhatsApp(html, filename, `Visit Summary — ${enc.patient_name || ''}`.trim(), {
        patientName: enc.patient_name,
        patientPhone: enc.patient_phone,
        countryCode: settings.country_code || '+91',
        docKind: 'visit',
        followUpDate: enc.follow_up_date || null,
        doctorName: settings.doctor_name || enc.created_by_name || null,
        enabled: settings.whatsapp_auto_prompt_enabled !== false,
      });
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Could not share to WhatsApp';
      if (Platform.OS === 'web') window.alert(String(msg));
      else Alert.alert('Share failed', String(msg));
    } finally {
      setSendingWa(false);
    }
  }, [enc]);

  const startConsultation = useCallback(async () => {
    if (!enc) return;
    setStartingConsult(true);
    try {
      await api.post(`/encounters/${enc.encounter_id}/start-consultation`);
      invalidateCached('worklist:');
      router.push({ pathname: '/prescriptions/new', params: { encounterId: enc.encounter_id } } as any);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not start consultation';
      if (Platform.OS === 'web') window.alert(String(msg)); else Alert.alert('Error', String(msg));
    } finally {
      setStartingConsult(false);
    }
  }, [enc, router]);

  const recordPayment = useCallback(() => {
    if (!enc) return;
    router.push({
      pathname: '/billing/new',
      params: {
        encounter_id: enc.encounter_id,
        patient_name: enc.patient_name || '',
        patient_phone: enc.patient_phone || '',
        amount: enc.fee_amount ? String(enc.fee_amount) : '',
        description: 'Consultation',
        service_type: 'consultation',
      },
    } as any);
  }, [enc, router]);

  const waiveFee = useCallback(() => {
    if (!enc) return;
    const run = async () => {
      setWaiving(true);
      try {
        await api.post(`/encounters/${enc.encounter_id}/waive`);
        invalidateCached('worklist:');
        haptics.success();
        await load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not waive charges';
        if (Platform.OS === 'web') window.alert(String(msg)); else Alert.alert('Error', String(msg));
      } finally {
        setWaiving(false);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Waive the consultation charge for this encounter?')) void run();
    } else {
      Alert.alert('Waive charges?', 'Mark this consultation as waived off (no charge).', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Waive', style: 'destructive', onPress: run },
      ]);
    }
  }, [enc, load]);

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
          <View style={styles.badgeRow}>
            {!!STAGE_META[enc.stage] && (
              <View style={[styles.badge, { backgroundColor: STAGE_META[enc.stage].bg }]}>
                <Text style={[styles.badgeText, { color: STAGE_META[enc.stage].color }]}>{STAGE_META[enc.stage].label}</Text>
              </View>
            )}
            {!!PAY_META[enc.payment_status] && (
              <View style={[styles.badge, { backgroundColor: PAY_META[enc.payment_status].bg }]}>
                <Text style={[styles.badgeText, { color: PAY_META[enc.payment_status].color }]}>
                  {PAY_META[enc.payment_status].label}{enc.fee_amount ? ` · ₹${enc.fee_amount}` : ''}
                </Text>
              </View>
            )}
          </View>
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
        <Section label="IPSS" value={enc.ipss} />
        {!!(enc.inv_blood || enc.inv_psa || enc.inv_usg || enc.inv_uroflowmetry || enc.inv_ct || enc.inv_mri || enc.investigation_findings) && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionLabel}>Investigations (Findings)</Text>
            {[['Blood', enc.inv_blood], ['PSA', enc.inv_psa], ['USG', enc.inv_usg], ['Uroflowmetry', enc.inv_uroflowmetry], ['CT', enc.inv_ct], ['MRI', enc.inv_mri]]
              .filter(([, v]) => !!v)
              .map(([k, v]) => (
                <Text key={k as string} style={styles.sectionText}><Text style={styles.invKey}>{k}: </Text>{v as string}</Text>
              ))}
            {!!enc.investigation_findings && <Text style={styles.sectionText}>{enc.investigation_findings}</Text>}
          </View>
        )}
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

        <TouchableOpacity
          style={styles.waBtn}
          onPress={sendWhatsApp}
          disabled={sendingWa}
          testID="encdet-whatsapp-btn"
        >
          {sendingWa ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="logo-whatsapp" size={18} color="#fff" />}
          <Text style={styles.waBtnText}>Send to WhatsApp</Text>
        </TouchableOpacity>


        {/* ── Consultation flow ──────────────────────────────────── */}
        {enc.prescription_id ? (
          <TouchableOpacity
            style={styles.rxBtn}
            onPress={() => router.push(`/prescriptions/${enc.prescription_id}` as any)}
            testID="encdet-open-rx"
          >
            <Ionicons name="document-text" size={18} color={COLORS.success} />
            <Text style={[styles.rxBtnText, { color: COLORS.success }]}>Open prescription</Text>
            <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.rxBtn, { backgroundColor: COLORS.primary }]}
            onPress={startConsultation}
            disabled={startingConsult}
            testID="encdet-start-consult"
          >
            {startingConsult ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="medkit" size={18} color="#fff" />}
            <Text style={[styles.rxBtnText, { color: '#fff' }]}>
              {enc.stage === 'in_consultation' ? 'Resume Consultation' : 'Start Consultation'}
            </Text>
          </TouchableOpacity>
        )}

        {/* ── Billing ────────────────────────────────────────────── */}
        <View style={styles.billBlock}>
          <View style={styles.billHead}>
            <Ionicons name="cash-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.billTitle}>Billing</Text>
            {!!PAY_META[enc.payment_status] && (
              <View style={[styles.badge, { backgroundColor: PAY_META[enc.payment_status].bg, marginLeft: 'auto' }]}>
                <Text style={[styles.badgeText, { color: PAY_META[enc.payment_status].color }]}>{PAY_META[enc.payment_status].label}</Text>
              </View>
            )}
          </View>
          {!!enc.fee_amount && <Text style={styles.billFee}>Consultation fee: ₹{enc.fee_amount}</Text>}
          {enc.payment_status !== 'waived' && (
            <View style={styles.billActions}>
              <TouchableOpacity style={styles.billPayBtn} onPress={recordPayment} testID="encdet-record-payment">
                <Ionicons name="card-outline" size={16} color="#fff" />
                <Text style={styles.billPayText}>{enc.payment_status === 'paid' ? 'Add another receipt' : 'Record payment'}</Text>
              </TouchableOpacity>
              {canWaive && (
                <TouchableOpacity style={styles.billWaiveBtn} onPress={waiveFee} disabled={waiving} testID="encdet-waive">
                  {waiving ? <ActivityIndicator size="small" color="#64748B" /> : <Ionicons name="remove-circle-outline" size={16} color="#64748B" />}
                  <Text style={styles.billWaiveText}>Waive charges</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {enc.payment_status === 'waived' && !!enc.waived_by_name && (
            <Text style={styles.waivedNote}>Waived by {enc.waived_by_name}</Text>
          )}
        </View>
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
  waBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#25D366', borderRadius: RADIUS.md, paddingVertical: 14, marginTop: 10,
  },
  waBtnText: { ...FONTS.bodyMedium, fontSize: 14, color: '#fff' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: { borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { ...FONTS.bodyMedium, fontSize: 11.5 },
  invKey: { ...FONTS.bodyMedium, color: COLORS.textSecondary },
  billBlock: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 10, marginTop: 6,
  },
  billHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  billTitle: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary },
  billFee: { ...FONTS.body, fontSize: 13.5, color: COLORS.textSecondary },
  billActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  billPayBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 12, minWidth: 150,
  },
  billPayText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13.5 },
  billWaiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 14,
  },
  billWaiveText: { ...FONTS.bodyMedium, color: '#64748B', fontSize: 13.5 },
  waivedNote: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, fontStyle: 'italic' },
});
