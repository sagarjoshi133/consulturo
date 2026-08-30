/**
 * Overview tab — patient demographics, dx/procedure summary, bed
 * transfer history timeline, discharge summary (if discharged),
 * combined IPD file PDF generator, and doctor's private note.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { COLORS } from '../../theme';
import { useToast } from '../../toast';
import { formatISTShort } from '../../date';
import { buildDischargeSummaryHtml } from '../../discharge-summary-pdf';
import { loadClinicSettings } from '../../rx-pdf';
import { sharePdfFromHtml } from '../../pdf-share';
import { ipdStyles as styles } from '../styles';
import { Row, PrivateNoteField } from '../components';
import type { Admission } from '../types';

export default function OverviewTab({
  admission, admissionId, isDischarged, bedTransfers,
}: {
  admission: Admission;
  admissionId: string;
  isDischarged: boolean;
  bedTransfers: any[];
}) {
  const toast = useToast();
  const a = admission;
  const [busy, setBusy] = React.useState<null | 'discharge' | 'ipdfile'>(null);

  const exportDischargeSummary = async () => {
    if (busy) return;
    setBusy('discharge');
    try {
      const { data: ds } = await api.get(`/ipd/admissions/${admissionId}/discharge-summary`);
      // Brand the PDF with the owner-set clinic name / letterhead / signature.
      let clinic: any = undefined;
      try {
        const cs: any = await loadClinicSettings();
        clinic = {
          name: cs.clinic_name,
          address: cs.clinic_address || cs.address,
          phone: cs.clinic_phone || cs.phone,
          doctor_name: cs.doctor_name,
          doctor_degrees: cs.doctor_degrees,
          doctor_reg_no: cs.doctor_reg_no,
          letterhead_image_b64: cs.letterhead_image_b64,
          use_letterhead: cs.use_letterhead,
          signature_image_b64: cs.signature_image_b64,
        };
      } catch { /* non-fatal — template falls back to defaults */ }
      const html = buildDischargeSummaryHtml({ ...ds, clinic });
      await sharePdfFromHtml(html, `Discharge-${a.ipd_no}.pdf`, `Discharge Summary · ${a.ipd_no}`);
    } catch (e: any) {
      Alert.alert('Export failed', e?.response?.data?.detail || e?.message || 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  const exportIPDFile = async () => {
    if (busy) return;
    setBusy('ipdfile');
    try {
      const { data } = await api.get(`/ipd/admissions/${admissionId}/ipd-file-html`);
      if (!data?.html) throw new Error('No content returned from server');
      await sharePdfFromHtml(data.html, `IPD-${a.ipd_no}.pdf`, `IPD File · ${a.ipd_no}`);
      toast.success('IPD file ready.');
    } catch (e: any) {
      Alert.alert('Export failed', e?.response?.data?.detail || e?.message || 'Unknown error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.detCard}>
      <Row label="Phone" value={a.patient_phone || '—'} />
      <Row label="Diagnosis" value={a.diagnosis || '—'} />
      <Row label="Planned procedure" value={a.planned_procedure || '—'} />
      <Row label="Consulting doctor" value={a.consulting_doctor || '—'} />
      <Row label="Presenting complaints" value={a.presenting_complaints || '—'} />
      <Row label="Past history" value={a.past_history || '—'} />
      <Row label="Investigations" value={a.investigations_summary || '—'} />
      <Row label="Admitted at" value={formatISTShort(a.admitted_at)} />
      {bedTransfers.length > 0 ? (
        <View style={{ marginTop: 10 }}>
          <Text style={[styles.subTitle, { fontSize: 12, marginBottom: 6 }]}>Bed transfer history</Text>
          {bedTransfers.map((t: any) => (
            <View key={t.id} style={styles.transferRow}>
              <Ionicons name="swap-horizontal" size={14} color="#F59E0B" />
              <Text style={styles.transferText}>
                <Text style={{ fontWeight: '700' }}>{t.from_ward || 'General'}{t.from_bed_id ? ` (${t.from_bed_id})` : ''}</Text>
                {' → '}
                <Text style={{ fontWeight: '700' }}>{t.to_ward}{t.to_bed_id ? ` (${t.to_bed_id})` : ''}</Text>
              </Text>
              <Text style={styles.transferMeta}>{formatISTShort(t.transferred_at)}{t.reason ? ` · ${t.reason}` : ''}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {isDischarged ? <Row label="Discharged at" value={formatISTShort(a.discharged_at)} /> : null}
      {isDischarged && a.discharge_summary ? (
        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={styles.subTitle}>Discharge summary</Text>
          <Row label="Final diagnosis" value={a.discharge_summary.final_diagnosis} />
          <Row label="Procedures done" value={a.discharge_summary.procedures_done} />
          <Row label="Course" value={a.discharge_summary.course_in_hospital} />
          <Row label="Condition" value={a.discharge_summary.condition_at_discharge} />
          <Row label="Follow-up" value={a.discharge_summary.follow_up_date || a.discharge_summary.follow_up_plan || '—'} />
          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 10 }, busy === 'discharge' && { opacity: 0.7 }]}
            onPress={exportDischargeSummary}
            disabled={busy !== null}
            testID="ipd-export-discharge"
          >
            {busy === 'discharge' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="document-text" size={16} color="#fff" />
            )}
            <Text style={styles.primaryBtnText}>
              {busy === 'discharge' ? 'Generating…' : 'Export Discharge Summary PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Combined IPD File PDF */}
      <View style={styles.detCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.subTitle}>Combined IPD File</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 10.5 }}>
            All admission docs in one PDF
          </Text>
        </View>
        <Text style={styles.noteText}>
          Generates a single PDF containing the admission form,
          vitals chart, daily progress notes, medications,
          signed consents, operative note, discharge summary,
          medical certificates, and the doctor's private note —
          sequentially. Attach it to the patient's file or
          share via WhatsApp.
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 1 }, busy === 'ipdfile' && { opacity: 0.7 }]}
            onPress={exportIPDFile}
            disabled={busy !== null}
            testID="ipd-file-export"
          >
            {busy === 'ipdfile' ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="folder-open" size={16} color="#fff" />
            )}
            <Text style={styles.primaryBtnText}>
              {busy === 'ipdfile' ? 'Generating…' : 'Generate / Download IPD File PDF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Doctor's Private Note */}
      <View style={styles.detCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.subTitle}>Doctor's Private Note</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.privatePill}>
            <Ionicons name="lock-closed" size={10} color="#6B7280" />
            <Text style={styles.privatePillText}>Self-use only</Text>
          </View>
        </View>
        <PrivateNoteField admissionId={admissionId} initial={a.private_note || ''} />
      </View>
    </View>
  );
}
