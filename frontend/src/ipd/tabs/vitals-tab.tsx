/**
 * Vitals tab — record + history.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { formatISTShort } from '../../date';
import { ipdStyles as styles } from '../styles';
import { VitalInput } from '../components';

export default function VitalsTab({
  admissionId, isDischarged, data, busy, setBusy, load,
}: {
  admissionId: string;
  isDischarged: boolean;
  data: any;
  busy: boolean;
  setBusy: (b: boolean) => void;
  load: () => Promise<void>;
}) {
  const [vitals, setVitals] = useState<any>({});

  const addVitals = useCallback(async () => {
    const payload: any = {};
    Object.keys(vitals).forEach((k) => {
      const v = vitals[k];
      if (v !== undefined && v !== '') payload[k] = isNaN(Number(v)) ? v : Number(v);
    });
    if (Object.keys(payload).length === 0) {
      Alert.alert('No data', 'Enter at least one vital.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/vitals`, payload);
      setVitals({});
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Unknown');
    } finally { setBusy(false); }
  }, [admissionId, vitals, load, setBusy]);

  return (
    <View>
      {!isDischarged ? (
        <View style={styles.detCard}>
          <Text style={styles.subTitle}>Record vitals</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <VitalInput label="BP sys" value={vitals.bp_sys} onChange={(v: string) => setVitals({ ...vitals, bp_sys: v })} />
            <VitalInput label="BP dia" value={vitals.bp_dia} onChange={(v: string) => setVitals({ ...vitals, bp_dia: v })} />
            <VitalInput label="Pulse" value={vitals.pulse} onChange={(v: string) => setVitals({ ...vitals, pulse: v })} />
            <VitalInput label="SpO2" value={vitals.spo2} onChange={(v: string) => setVitals({ ...vitals, spo2: v })} />
            <VitalInput label="Temp °C" value={vitals.temp_c} onChange={(v: string) => setVitals({ ...vitals, temp_c: v })} />
            <VitalInput label="RR" value={vitals.rr} onChange={(v: string) => setVitals({ ...vitals, rr: v })} />
            <VitalInput label="Glucose" value={vitals.glucose_mg_dl} onChange={(v: string) => setVitals({ ...vitals, glucose_mg_dl: v })} />
            <VitalInput label="Urine ml" value={vitals.urine_output_ml} onChange={(v: string) => setVitals({ ...vitals, urine_output_ml: v })} />
            <VitalInput label="Pain 0-10" value={vitals.pain_score} onChange={(v: string) => setVitals({ ...vitals, pain_score: v })} />
          </View>
          <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }, { marginTop: 10 }]} onPress={addVitals} disabled={busy}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Save vitals</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text style={styles.subTitle}>History ({data.vitals.length})</Text>
      {data.vitals.length === 0 ? (
        <Text style={styles.empty}>No vitals yet.</Text>
      ) : (
        data.vitals.map((v: any) => (
          <View key={v.id} style={styles.detCard}>
            <Text style={styles.noteTime}>{formatISTShort(v.recorded_at)} · {v.recorded_by}</Text>
            <Text style={styles.noteText}>
              {v.bp_sys ? `BP ${v.bp_sys}/${v.bp_dia} · ` : ''}
              {v.pulse ? `HR ${v.pulse} · ` : ''}
              {v.spo2 ? `SpO₂ ${v.spo2}% · ` : ''}
              {v.temp_c ? `T ${v.temp_c}°C · ` : ''}
              {v.rr ? `RR ${v.rr} · ` : ''}
              {v.glucose_mg_dl ? `Glu ${v.glucose_mg_dl} · ` : ''}
              {v.pain_score != null ? `Pain ${v.pain_score}/10` : ''}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
