/**
 * Rounds tab — daily progress notes with AI-draft assistance.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { COLORS } from '../../theme';
import { formatISTShort } from '../../date';
import { ipdStyles as styles } from '../styles';

export default function RoundsTab({
  admissionId, isDischarged, data, busy, setBusy, load,
}: {
  admissionId: string;
  isDischarged: boolean;
  data: any;
  busy: boolean;
  setBusy: (b: boolean) => void;
  load: () => Promise<void>;
}) {
  const [roundText, setRoundText] = useState('');

  const addRound = useCallback(async () => {
    if (!roundText.trim()) return;
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/rounds`, { note_text: roundText.trim() });
      setRoundText('');
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Unknown');
    } finally { setBusy(false); }
  }, [admissionId, roundText, load, setBusy]);

  const draftWithAI = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const adm = data?.admission || {};
      const vitalsList = data?.vitals || [];
      const latest = vitalsList[0] || {};
      const priorNote = (data?.rounds && data.rounds[0]?.note_text) || '';
      const r = await api.post('/ai/progress-note/draft', {
        patient_name: adm.patient_name,
        patient_age: adm.patient_age,
        patient_gender: adm.patient_sex || adm.patient_gender,
        diagnosis: adm.diagnosis,
        vitals: latest && Object.keys(latest).length ? {
          BP: latest.bp,
          Pulse: latest.pulse,
          Temp: latest.temp,
          SpO2: latest.spo2,
        } : undefined,
        prior_notes: priorNote ? priorNote.slice(0, 600) : '',
        chief_complaints: adm.presenting_complaints,
      });
      const note = (r.data?.note || '').trim();
      if (note) setRoundText(note);
    } catch (e: any) {
      Alert.alert('AI draft failed', e?.response?.data?.detail || 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, data, setBusy]);

  return (
    <View>
      {!isDischarged ? (
        <View style={styles.detCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Text style={styles.subTitle}>Add daily note</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={draftWithAI} style={styles.aiInlineBtn} disabled={busy}>
              <Ionicons name="sparkles" size={12} color="#fff" />
              <Text style={styles.aiInlineBtnText}>Draft with AI</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            multiline
            value={roundText}
            onChangeText={setRoundText}
            placeholder="Subjective. Objective. Plan."
            placeholderTextColor={COLORS.textTertiary}
          />
          <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }]} onPress={addRound} disabled={busy}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Save note</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text style={styles.subTitle}>History ({data.rounds.length})</Text>
      {data.rounds.length === 0 ? (
        <Text style={styles.empty}>No notes yet.</Text>
      ) : (
        data.rounds.map((r: any) => (
          <View key={r.id} style={styles.detCard}>
            <Text style={styles.noteTime}>{formatISTShort(r.note_at)}</Text>
            <Text style={styles.noteAuthor}>{r.written_by || '—'}</Text>
            <Text style={styles.noteText}>{r.note_text}</Text>
          </View>
        ))
      )}
    </View>
  );
}
