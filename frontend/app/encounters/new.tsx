/**
 * New / Edit Encounter — Clinical Core (Phase E).
 * SOAP-note form with AI dictation (Whisper → Claude), vitals row,
 * diagnosis typeahead from the clinic's learned registry, and patient
 * autofill by phone (same lookup the Rx composer uses).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import api from '../../src/api';
import { uploadDictation } from '../../src/wave3/api';
import { VoiceDictationSheet } from '../../src/voice-dictation-sheet';
import { invalidateCached } from '../../src/data-cache';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';
import { haptics } from '../../src/haptics';

const SEXES = ['Male', 'Female', 'Other'];

export default function EncounterFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string }>();
  const editId = (params.editId || '') as string;
  const isEdit = !!editId;

  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [dictateOpen, setDictateOpen] = useState(false);

  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [chief, setChief] = useState('');
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [bp, setBp] = useState('');
  const [pulse, setPulse] = useState('');
  const [temp, setTemp] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [dxInput, setDxInput] = useState('');
  const [dxSuggestions, setDxSuggestions] = useState<string[]>([]);

  // Load existing encounter for edit mode.
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await api.get(`/encounters/${editId}`);
        setPhone(data.patient_phone || '');
        setName(data.patient_name || '');
        setAge(data.patient_age || '');
        setSex(data.patient_sex || '');
        setChief(data.chief_complaint || '');
        setSubjective(data.subjective || '');
        setObjective(data.objective || '');
        setAssessment(data.assessment || '');
        setPlan(data.plan || '');
        setDiagnoses(data.diagnoses || []);
        const v = data.vitals || {};
        setBp(v.bp || ''); setPulse(v.pulse || ''); setTemp(v.temp || '');
        setSpo2(v.spo2 || ''); setWeight(v.weight || '');
      } catch {
        Alert.alert('Error', 'Could not load encounter');
        goBackSafe(router, '/encounters');
      } finally {
        setLoadingExisting(false);
      }
    })();
  }, [editId, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Patient autofill by phone (create mode only).
  useEffect(() => {
    if (isEdit) return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/patients/lookup', { params: { phone: digits } });
        if (data?.found && !name && data.name) setName(data.name);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Diagnosis typeahead from clinic registry.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/diagnoses', { params: { q: dxInput } });
        const labels: string[] = (data?.items || []).map((i: any) => i.label);
        setDxSuggestions(labels.filter((l) => !diagnoses.some((d) => d.toLowerCase() === l.toLowerCase())));
      } catch { setDxSuggestions([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [dxInput, diagnoses]);

  const addDx = useCallback((label: string) => {
    const v = label.trim();
    if (!v) return;
    setDiagnoses((prev) => (prev.some((d) => d.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v]));
    setDxInput('');
  }, []);

  const removeDx = useCallback((label: string) => {
    setDiagnoses((prev) => prev.filter((d) => d !== label));
  }, []);

  const onDictation = useCallback((r: any) => {
    const p = r?.parsed || {};
    if (p.chief_complaint) setChief((cur) => cur || p.chief_complaint);
    if (p.subjective) setSubjective((cur) => (cur ? `${cur}\n${p.subjective}` : p.subjective));
    if (p.objective) setObjective((cur) => (cur ? `${cur}\n${p.objective}` : p.objective));
    if (p.assessment) setAssessment((cur) => (cur ? `${cur}\n${p.assessment}` : p.assessment));
    if (p.plan) setPlan((cur) => (cur ? `${cur}\n${p.plan}` : p.plan));
    if (Array.isArray(p.diagnoses) && p.diagnoses.length) {
      setDiagnoses((prev) => {
        const merged = [...prev];
        for (const d of p.diagnoses) {
          if (!merged.some((m) => m.toLowerCase() === String(d).toLowerCase())) merged.push(String(d));
        }
        return merged;
      });
    }
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert('Missing info', 'Patient name is required.');
      return;
    }
    setSaving(true);
    try {
      const body = {
        patient_name: name.trim(),
        patient_phone: phone.trim(),
        patient_age: age.trim(),
        patient_sex: sex,
        chief_complaint: chief.trim(),
        subjective: subjective.trim(),
        objective: objective.trim(),
        assessment: assessment.trim(),
        plan: plan.trim(),
        vitals: { bp, pulse, temp, spo2, weight },
        diagnoses,
      };
      const { data } = isEdit
        ? await api.patch(`/encounters/${editId}`, body)
        : await api.post('/encounters', body);
      invalidateCached('encounters:');
      haptics.success();
      router.replace(`/encounters/${data.encounter_id}` as any);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save the encounter';
      if (Platform.OS === 'web') window.alert(String(msg));
      else Alert.alert('Save failed', String(msg));
    } finally {
      setSaving(false);
    }
  }, [name, phone, age, sex, chief, subjective, objective, assessment, plan, bp, pulse, temp, spo2, weight, diagnoses, isEdit, editId, router]);

  if (loadingExisting) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters')} style={styles.backBtn} testID="encform-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEdit ? 'Edit Encounter' : 'New Encounter'}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.dictateBtn} onPress={() => setDictateOpen(true)} testID="encform-dictate">
          <Ionicons name="mic" size={16} color="#fff" />
          <Text style={styles.dictateText}>Dictate</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Patient</Text>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1.2 }]} placeholder="Phone" placeholderTextColor={COLORS.textDisabled} keyboardType="phone-pad" value={phone} onChangeText={setPhone} testID="encform-phone" />
            <TextInput style={[styles.input, { flex: 2 }]} placeholder="Patient name *" placeholderTextColor={COLORS.textDisabled} value={name} onChangeText={setName} testID="encform-name" />
          </View>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Age" placeholderTextColor={COLORS.textDisabled} keyboardType="number-pad" value={age} onChangeText={setAge} />
            <View style={[styles.sexRow, { flex: 2.4 }]}>
              {SEXES.map((s) => (
                <TouchableOpacity key={s} style={[styles.sexChip, sex === s && styles.sexChipActive]} onPress={() => setSex(sex === s ? '' : s)}>
                  <Text style={[styles.sexChipText, sex === s && styles.sexChipTextActive]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={styles.section}>Vitals</Text>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, styles.vital]} placeholder="BP" placeholderTextColor={COLORS.textDisabled} value={bp} onChangeText={setBp} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Pulse" placeholderTextColor={COLORS.textDisabled} value={pulse} onChangeText={setPulse} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Temp" placeholderTextColor={COLORS.textDisabled} value={temp} onChangeText={setTemp} />
            <TextInput style={[styles.input, styles.vital]} placeholder="SpO₂" placeholderTextColor={COLORS.textDisabled} value={spo2} onChangeText={setSpo2} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Wt (kg)" placeholderTextColor={COLORS.textDisabled} value={weight} onChangeText={setWeight} />
          </View>

          <Text style={styles.section}>Clinical Note</Text>
          <TextInput style={styles.input} placeholder="Chief complaint" placeholderTextColor={COLORS.textDisabled} value={chief} onChangeText={setChief} testID="encform-chief" />
          <TextInput style={[styles.input, styles.multi]} placeholder="Subjective — history & symptoms" placeholderTextColor={COLORS.textDisabled} value={subjective} onChangeText={setSubjective} multiline />
          <TextInput style={[styles.input, styles.multi]} placeholder="Objective — examination findings" placeholderTextColor={COLORS.textDisabled} value={objective} onChangeText={setObjective} multiline />
          <TextInput style={[styles.input, styles.multi]} placeholder="Assessment — impression / differential" placeholderTextColor={COLORS.textDisabled} value={assessment} onChangeText={setAssessment} multiline />
          <TextInput style={[styles.input, styles.multi]} placeholder="Plan — investigations, Rx, follow-up" placeholderTextColor={COLORS.textDisabled} value={plan} onChangeText={setPlan} multiline />

          <Text style={styles.section}>Diagnoses</Text>
          <View style={styles.chipsRow}>
            {diagnoses.map((d) => (
              <TouchableOpacity key={d} style={styles.dxChip} onPress={() => removeDx(d)}>
                <Text style={styles.dxChipText}>{d}</Text>
                <Ionicons name="close" size={12} color={COLORS.primaryDark} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.dxInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Add diagnosis…"
              placeholderTextColor={COLORS.textDisabled}
              value={dxInput}
              onChangeText={setDxInput}
              onSubmitEditing={() => addDx(dxInput)}
              testID="encform-dx-input"
            />
            <TouchableOpacity style={styles.dxAddBtn} onPress={() => addDx(dxInput)} disabled={!dxInput.trim()}>
              <Ionicons name="add" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          {dxSuggestions.length > 0 && (
            <View style={styles.suggestions}>
              {dxSuggestions.slice(0, 6).map((s) => (
                <TouchableOpacity key={s} style={styles.suggestionChip} onPress={() => addDx(s)}>
                  <Text style={styles.suggestionText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
            testID="encform-save"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
            <Text style={styles.saveText}>{isEdit ? 'Save changes' : 'Save encounter'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <VoiceDictationSheet
        visible={dictateOpen}
        onClose={() => setDictateOpen(false)}
        onResult={onDictation}
        upload={(uri, filename) => uploadDictation('/ai/encounter-dictation', uri, { filename })}
        title="Voice → Clinical Note"
        subtitle="Dictate the encounter out loud. We'll structure it into SOAP sections."
        example={'"55-year-old male with burning micturition for 3 days. Afebrile, abdomen soft. Impression: UTI. Plan urine culture and empirical Nitrofurantoin, review in 5 days."'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  dictateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  dictateText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  body: { padding: 16, paddingBottom: 60 },
  section: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  rowWrap: { flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 11,
    ...FONTS.body, fontSize: 14, color: COLORS.textPrimary, marginBottom: 8,
  },
  multi: { minHeight: 74, textAlignVertical: 'top' },
  vital: { flex: 1, paddingHorizontal: 8 },
  sexRow: { flexDirection: 'row', gap: 6 },
  sexChip: {
    flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface,
  },
  sexChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sexChipText: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary },
  sexChipTextActive: { color: '#fff', fontWeight: '600' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  dxChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  dxChipText: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.primaryDark },
  dxInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dxAddBtn: {
    width: 44, height: 44, borderRadius: RADIUS.md, backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  suggestionChip: {
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  suggestionText: { ...FONTS.body, fontSize: 12.5, color: COLORS.textSecondary },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 15, marginTop: 22,
  },
  saveText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15 },
});
