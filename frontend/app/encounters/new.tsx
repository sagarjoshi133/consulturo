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
  const params = useLocalSearchParams<{
    editId?: string; booking_id?: string; patient_user_id?: string;
    patient_name?: string; patient_phone?: string; patient_age?: string;
    patient_sex?: string; chief_complaint?: string;
  }>();
  const editId = (params.editId || '') as string;
  const isEdit = !!editId;
  // Linkage carried from a booking's consultation room.
  const bookingId = (params.booking_id || '') as string;
  const patientUserId = (params.patient_user_id || '') as string;

  const [loadingExisting, setLoadingExisting] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [dictateOpen, setDictateOpen] = useState(false);

  const [phone, setPhone] = useState(isEdit ? '' : (params.patient_phone || ''));
  const [name, setName] = useState(isEdit ? '' : (params.patient_name || ''));
  const [age, setAge] = useState(isEdit ? '' : (params.patient_age || ''));
  const [sex, setSex] = useState(isEdit ? '' : (params.patient_sex || ''));
  const [chief, setChief] = useState(isEdit ? '' : (params.chief_complaint || ''));
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [bp, setBp] = useState('');
  const [pulse, setPulse] = useState('');
  const [temp, setTemp] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [ipss, setIpss] = useState('');
  const [invBlood, setInvBlood] = useState('');
  const [invPsa, setInvPsa] = useState('');
  const [invUsg, setInvUsg] = useState('');
  const [invUroflow, setInvUroflow] = useState('');
  const [invCt, setInvCt] = useState('');
  const [invMri, setInvMri] = useState('');
  const [invFindings, setInvFindings] = useState('');
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [dxInput, setDxInput] = useState('');
  const [dxSuggestions, setDxSuggestions] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState<string>('');
  const [pastVisit, setPastVisit] = useState<any | null>(null);
  const [completing, setCompleting] = useState(false);

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
        setIpss(data.ipss || '');
        setInvBlood(data.inv_blood || ''); setInvPsa(data.inv_psa || '');
        setInvUsg(data.inv_usg || ''); setInvUroflow(data.inv_uroflowmetry || '');
        setInvCt(data.inv_ct || ''); setInvMri(data.inv_mri || '');
        setInvFindings(data.investigation_findings || '');
        setDiagnoses(data.diagnoses || []);
        setFollowUp(data.follow_up_date || '');
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

  // Past-visit context (create mode) — surface the patient's most recent
  // encounter so the doctor starts with continuity.
  useEffect(() => {
    if (isEdit) return;
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 10) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/encounters', { params: { patient_phone: digits, limit: 1 } });
        const last = (data?.items || [])[0];
        if (!last) { if (alive) setPastVisit(null); return; }
        // Fetch full detail for assessment/plan (not in the list projection).
        try {
          const det = await api.get(`/encounters/${last.encounter_id}`);
          if (alive) setPastVisit(det.data || last);
        } catch {
          if (alive) setPastVisit(last);
        }
      } catch { if (alive) setPastVisit(null); }
    })();
    return () => { alive = false; };
  }, [phone, isEdit]);

  const save = useCallback(async (opts?: { complete?: boolean }) => {
    if (!name.trim()) {
      Alert.alert('Missing info', 'Patient name is required.');
      return;
    }
    const doComplete = !!opts?.complete;
    if (doComplete) setCompleting(true); else setSaving(true);
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
        ipss: ipss.trim(),
        inv_blood: invBlood.trim(), inv_psa: invPsa.trim(), inv_usg: invUsg.trim(),
        inv_uroflowmetry: invUroflow.trim(), inv_ct: invCt.trim(), inv_mri: invMri.trim(),
        investigation_findings: invFindings.trim(),
        vitals: { bp, pulse, temp, spo2, weight },
        diagnoses,
        follow_up_date: followUp || null,
        ...(isEdit ? {} : {
          booking_id: bookingId || null,
          patient_user_id: patientUserId || null,
        }),
      };
      const { data } = isEdit
        ? await api.patch(`/encounters/${editId}`, body)
        : await api.post('/encounters', body);
      // Complete Visit: also close the linked appointment.
      if (doComplete && bookingId) {
        try {
          await api.patch(`/bookings/${bookingId}`, { status: 'completed' });
          invalidateCached('bookings:');
        } catch { /* encounter still saved; ignore booking failure */ }
      }
      invalidateCached('encounters:');
      haptics.success();
      router.replace(`/encounters/${data.encounter_id}` as any);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save the encounter';
      if (Platform.OS === 'web') window.alert(String(msg));
      else Alert.alert('Save failed', String(msg));
    } finally {
      setSaving(false);
      setCompleting(false);
    }
  }, [name, phone, age, sex, chief, subjective, objective, assessment, plan, ipss, invBlood, invPsa, invUsg, invUroflow, invCt, invMri, invFindings, bp, pulse, temp, spo2, weight, diagnoses, followUp, isEdit, editId, router, bookingId, patientUserId]);

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
          {!isEdit && pastVisit && (
            <View style={styles.pastCard} testID="encform-past-visit">
              <View style={styles.pastHead}>
                <Ionicons name="time-outline" size={15} color={COLORS.primaryDark} />
                <Text style={styles.pastTitle}>
                  Last visit{pastVisit.created_at ? ` · ${String(pastVisit.created_at).slice(0, 10)}` : ''}
                </Text>
              </View>
              {!!pastVisit.chief_complaint && (
                <Text style={styles.pastLine}><Text style={styles.pastLabel}>Complaint: </Text>{pastVisit.chief_complaint}</Text>
              )}
              {Array.isArray(pastVisit.diagnoses) && pastVisit.diagnoses.length > 0 && (
                <Text style={styles.pastLine}><Text style={styles.pastLabel}>Diagnosis: </Text>{pastVisit.diagnoses.join(', ')}</Text>
              )}
              {!!(pastVisit.assessment || pastVisit.plan) && (
                <Text style={styles.pastLine} numberOfLines={3}>
                  <Text style={styles.pastLabel}>Plan: </Text>{pastVisit.plan || pastVisit.assessment}
                </Text>
              )}
              {!!pastVisit.follow_up_date && (
                <Text style={styles.pastLine}><Text style={styles.pastLabel}>Follow-up set: </Text>{pastVisit.follow_up_date}</Text>
              )}
            </View>
          )}

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
          <View style={styles.quickVitalsRow}>
            <TouchableOpacity
              style={styles.qvChip}
              onPress={() => { setBp('120/80'); haptics.light(); }}
              testID="qv-bp"
            >
              <Ionicons name="pulse-outline" size={13} color={COLORS.primaryDark} />
              <Text style={styles.qvChipText}>Normal BP</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.qvChip}
              onPress={() => { setPulse('72'); haptics.light(); }}
              testID="qv-pulse"
            >
              <Ionicons name="heart-outline" size={13} color={COLORS.primaryDark} />
              <Text style={styles.qvChipText}>Normal Pulse</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.qvChip, styles.qvChipStrong]}
              onPress={() => { setBp('120/80'); setPulse('72'); setTemp('98.6'); setSpo2('98'); haptics.success(); }}
              testID="qv-all"
            >
              <Ionicons name="checkmark-done" size={13} color="#fff" />
              <Text style={[styles.qvChipText, styles.qvChipTextStrong]}>All normal</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, styles.vital]} placeholder="BP" placeholderTextColor={COLORS.textDisabled} value={bp} onChangeText={setBp} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Pulse" placeholderTextColor={COLORS.textDisabled} value={pulse} onChangeText={setPulse} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Temp" placeholderTextColor={COLORS.textDisabled} value={temp} onChangeText={setTemp} />
            <TextInput style={[styles.input, styles.vital]} placeholder="SpO₂" placeholderTextColor={COLORS.textDisabled} value={spo2} onChangeText={setSpo2} />
            <TextInput style={[styles.input, styles.vital]} placeholder="Wt (kg)" placeholderTextColor={COLORS.textDisabled} value={weight} onChangeText={setWeight} />
          </View>

          <Text style={styles.section}>Chief Complaint</Text>
          <TextInput style={styles.input} placeholder="Chief complaint" placeholderTextColor={COLORS.textDisabled} value={chief} onChangeText={setChief} testID="encform-chief" />

          <Text style={styles.section}>IPSS</Text>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="IPSS score (e.g. 18/35 severe)" placeholderTextColor={COLORS.textDisabled} value={ipss} onChangeText={setIpss} testID="encform-ipss" />
            <TouchableOpacity style={styles.ipssBtn} onPress={() => router.push('/ipss' as any)} testID="encform-ipss-tool">
              <Ionicons name="calculator-outline" size={16} color={COLORS.primaryDark} />
              <Text style={styles.ipssBtnText}>Tool</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.section}>Investigations (Findings)</Text>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Blood" placeholderTextColor={COLORS.textDisabled} value={invBlood} onChangeText={setInvBlood} testID="encform-inv-blood" />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="PSA" placeholderTextColor={COLORS.textDisabled} value={invPsa} onChangeText={setInvPsa} testID="encform-inv-psa" />
          </View>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="USG" placeholderTextColor={COLORS.textDisabled} value={invUsg} onChangeText={setInvUsg} testID="encform-inv-usg" />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="Uroflowmetry" placeholderTextColor={COLORS.textDisabled} value={invUroflow} onChangeText={setInvUroflow} testID="encform-inv-uroflow" />
          </View>
          <View style={styles.rowWrap}>
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="CT" placeholderTextColor={COLORS.textDisabled} value={invCt} onChangeText={setInvCt} />
            <TextInput style={[styles.input, { flex: 1 }]} placeholder="MRI" placeholderTextColor={COLORS.textDisabled} value={invMri} onChangeText={setInvMri} />
          </View>
          <TextInput style={[styles.input, styles.multi]} placeholder="Other investigation findings / notes" placeholderTextColor={COLORS.textDisabled} value={invFindings} onChangeText={setInvFindings} multiline testID="encform-inv-findings" />

          <Text style={styles.section}>Doctor{'\u2019'}s Clinical Note</Text>
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

          <Text style={styles.section}>Follow-up</Text>
          <View style={styles.chipsRow}>
            {[
              { label: '1 week', days: 7 },
              { label: '2 weeks', days: 14 },
              { label: '1 month', days: 30 },
              { label: '3 months', days: 90 },
            ].map((opt) => {
              const val = (() => { const d = new Date(); d.setDate(d.getDate() + opt.days); return d.toISOString().slice(0, 10); })();
              const active = followUp === val;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.fuChip, active && styles.fuChipActive]}
                  onPress={() => setFollowUp(active ? '' : val)}
                  testID={`encform-fu-${opt.days}`}
                >
                  <Text style={[styles.fuChipText, active && styles.fuChipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
            {!!followUp && (
              <TouchableOpacity style={styles.fuClear} onPress={() => setFollowUp('')} testID="encform-fu-clear">
                <Ionicons name="close" size={13} color="#B45309" />
                <Text style={styles.fuClearText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Follow-up date (YYYY-MM-DD)"
            placeholderTextColor={COLORS.textDisabled}
            value={followUp}
            onChangeText={setFollowUp}
            autoCapitalize="none"
            testID="encform-fu-input"
          />
          {!!followUp && (
            <Text style={styles.fuHint}>Patient will be listed under Follow-ups on {followUp}. You{'\u2019'}ll get a reminder that morning.</Text>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={() => save()}
            disabled={saving || completing}
            testID="encform-save"
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={20} color="#fff" />}
            <Text style={styles.saveText}>{isEdit ? 'Save changes' : 'Save encounter'}</Text>
          </TouchableOpacity>

          {!isEdit && !!bookingId && (
            <TouchableOpacity
              style={[styles.completeBtn, completing && { opacity: 0.6 }]}
              onPress={() => save({ complete: true })}
              disabled={saving || completing}
              testID="encform-complete-visit"
            >
              {completing ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="checkmark-done" size={20} color={COLORS.primary} />}
              <Text style={styles.completeText}>Save & complete visit</Text>
            </TouchableOpacity>
          )}
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
  quickVitalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  qvChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '2E',
    borderRadius: RADIUS.pill, paddingHorizontal: 11, paddingVertical: 7,
  },
  qvChipStrong: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  qvChipText: { ...FONTS.bodyMedium, fontSize: 12, color: COLORS.primaryDark },
  qvChipTextStrong: { color: '#fff' },
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
  fuChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  fuChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  fuChipText: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.textSecondary },
  fuChipTextActive: { color: '#fff' },
  fuClear: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D',
  },
  fuClearText: { ...FONTS.bodyMedium, fontSize: 12, color: '#B45309' },
  fuHint: { ...FONTS.body, fontSize: 11.5, color: COLORS.textSecondary, marginTop: -4, marginBottom: 6 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 15, marginTop: 22,
  },
  saveText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15 },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '40',
    borderRadius: RADIUS.md, paddingVertical: 14, marginTop: 12,
  },
  completeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 15 },
  pastCard: {
    backgroundColor: COLORS.primary + '0D', borderWidth: 1, borderColor: COLORS.primary + '2A',
    borderRadius: RADIUS.md, padding: 12, marginBottom: 16, gap: 4,
  },
  pastHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  pastTitle: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.primaryDark },
  pastLine: { ...FONTS.body, fontSize: 12.5, color: COLORS.textPrimary, lineHeight: 18 },
  pastLabel: { ...FONTS.bodyMedium, color: COLORS.textSecondary },
  ipssBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8,
    backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '2E',
    borderRadius: RADIUS.md, paddingHorizontal: 12, justifyContent: 'center',
  },
  ipssBtnText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.primaryDark },
});
