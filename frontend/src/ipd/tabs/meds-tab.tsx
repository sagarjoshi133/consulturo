/**
 * Medications tab — add via drug repository picker, list ongoing
 * and stopped meds, stop active meds.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { COLORS } from '../../theme';
import { useToast } from '../../toast';
import DrugPicker from '../../drug-picker';
import { ipdStyles as styles } from '../styles';
import { SmallField } from '../components';

export default function MedsTab({
  admissionId, isDischarged, meds, busy, setBusy, load,
}: {
  admissionId: string;
  isDischarged: boolean;
  meds: any[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  load: () => Promise<void>;
}) {
  const toast = useToast();
  const [medDraft, setMedDraft] = useState<any>(null);

  const submitMed = async () => {
    if (busy || !medDraft) return;
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/drugs`, {
        ...medDraft,
        start_date: new Date().toISOString().slice(0, 10),
        status: 'active',
      });
      toast.success('Medication added.');
      setMedDraft(null);
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Unknown');
    } finally {
      setBusy(false);
    }
  };

  const stopMed = async (id: string) => {
    try {
      await api.post(`/ipd/admissions/${admissionId}/drugs/${id}/stop`);
      toast.success('Stopped.');
      await load();
    } catch (e: any) {
      Alert.alert('Stop failed', e?.response?.data?.detail || 'Unknown');
    }
  };

  const ongoing = meds.filter((m: any) => m.status !== 'stopped');
  const stopped = meds.filter((m: any) => m.status === 'stopped');

  return (
    <View>
      {!isDischarged ? (
        <View style={styles.detCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={styles.subTitle}>Add Medication</Text>
            <View style={{ flex: 1 }} />
            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>
              Repository · 100+ urology meds
            </Text>
          </View>
          <DrugPicker
            onPick={(d) => {
              setMedDraft({
                drug_id: d.drug_id,
                drug: d.name,
                brand: (d.brands && d.brands[0]) || '',
                category: d.category,
                form: d.form,
                dose: d.default_dose || d.default_strength || '',
                route: d.default_route || '',
                frequency: d.default_frequency || '',
                duration: d.default_duration || '',
                notes: '',
              });
            }}
            testID="ipd-med-picker"
          />
          {medDraft ? (
            <View style={[styles.detCard, { marginTop: 10, backgroundColor: '#F4F9F9' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontWeight: '700', color: COLORS.primary, fontSize: 14, flex: 1 }}>
                  {medDraft.drug}
                  {medDraft.brand ? ` (${medDraft.brand})` : ''}
                </Text>
                <TouchableOpacity onPress={() => setMedDraft(null)} hitSlop={10}>
                  <Ionicons name="close" size={18} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <SmallField label="Dose" value={medDraft.dose} onChange={(v: string) => setMedDraft({ ...medDraft, dose: v })} />
                <SmallField label="Route" value={medDraft.route} onChange={(v: string) => setMedDraft({ ...medDraft, route: v })} />
                <SmallField label="Frequency" value={medDraft.frequency} onChange={(v: string) => setMedDraft({ ...medDraft, frequency: v })} />
                <SmallField label="Duration" value={medDraft.duration} onChange={(v: string) => setMedDraft({ ...medDraft, duration: v })} />
              </View>
              <TextInput
                value={medDraft.notes}
                onChangeText={(v) => setMedDraft({ ...medDraft, notes: v })}
                placeholder="Notes (optional, e.g. with food / monitor renal fn)"
                placeholderTextColor={COLORS.textSecondary}
                style={[styles.input, { marginTop: 8 }]}
              />
              <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} disabled={busy} onPress={submitMed}>
                <Ionicons name="add-circle" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Add to Chart</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Ongoing list */}
      <View style={styles.detCard}>
        <Text style={styles.subTitle}>Ongoing Medications</Text>
        {ongoing.length === 0 ? (
          <Text style={styles.noteText}>No active medications.</Text>
        ) : (
          ongoing.map((m: any) => (
            <View key={m.id} style={styles.medRow}>
              <View style={[styles.medFormBubble, { backgroundColor: m.is_injectable || m.form === 'injection' || m.form === 'iv_fluid' ? '#FEE2E2' : '#E0F2FE' }]}>
                <Ionicons name="medical" size={14} color={m.form === 'injection' || m.form === 'iv_fluid' ? '#DC2626' : '#0284C7'} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.medName} numberOfLines={1}>
                  {m.drug}{m.brand ? ` (${m.brand})` : ''}
                </Text>
                <Text style={styles.medSub} numberOfLines={1}>
                  {[m.dose, m.frequency, m.route, m.duration].filter(Boolean).join(' · ')}
                </Text>
                {m.notes ? <Text style={styles.medNotes} numberOfLines={2}>{m.notes}</Text> : null}
              </View>
              {!isDischarged ? (
                <TouchableOpacity onPress={() => stopMed(m.id)} style={styles.stopBtn} hitSlop={10} testID={`med-stop-${m.id}`}>
                  <Ionicons name="stop-circle" size={18} color="#DC2626" />
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        )}
      </View>

      {/* Stopped list */}
      {stopped.length > 0 ? (
        <View style={styles.detCard}>
          <Text style={[styles.subTitle, { color: COLORS.textSecondary }]}>Stopped</Text>
          {stopped.map((m: any) => (
            <View key={m.id} style={[styles.medRow, { opacity: 0.55 }]}>
              <Ionicons name="stop-circle" size={18} color={COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.medName, { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                  {m.drug}{m.brand ? ` (${m.brand})` : ''}
                </Text>
                <Text style={styles.medSub} numberOfLines={1}>
                  {[m.dose, m.frequency, m.route].filter(Boolean).join(' · ')}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
