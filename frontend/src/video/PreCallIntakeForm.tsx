/*
 * PreCallIntakeForm — patient self-reports vitals + symptoms BEFORE
 * the video consultation starts. Doctor sees these on the staff
 * console (server.video-call-actions.tsx).
 *
 * All fields are OPTIONAL — patients can skip and join straight away.
 * Submit returns ok and the parent screen advances to "join".
 *
 * Layout: compact card that lives inside the pre-call screen. Mobile-
 * first 2-column grid for vitals; symptoms as chip multi-select.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';

const UROLOGY_SYMPTOMS = [
  'Burning urination',
  'Frequency',
  'Urgency',
  'Blood in urine',
  'Flank pain',
  'Lower abdominal pain',
  'Weak stream',
  'Incomplete emptying',
  'Fever',
  'Nausea',
  'Difficulty starting',
  'Nocturia (night urination)',
];

type Props = {
  bookingId: string;
  onSubmitted?: () => void;
  onSkip?: () => void;
};

export default function PreCallIntakeForm({ bookingId, onSubmitted, onSkip }: Props) {
  const [bpSys, setBpSys] = useState('');
  const [bpDia, setBpDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [temp, setTemp] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weight, setWeight] = useState('');
  const [complaint, setComplaint] = useState('');
  const [duration, setDuration] = useState('');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleSymptom = (s: string) => {
    setSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const submit = useCallback(async () => {
    Keyboard.dismiss();
    setSubmitting(true); setErr(null);
    try {
      const num = (v: string) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
      };
      await api.post(`/video/bookings/${bookingId}/precall`, {
        bp_systolic: num(bpSys), bp_diastolic: num(bpDia),
        pulse: num(pulse), temperature_c: num(temp),
        spo2: num(spo2), weight_kg: num(weight),
        chief_complaint: complaint.trim() || null,
        duration: duration.trim() || null,
        symptoms,
        notes: notes.trim() || null,
      });
      onSubmitted?.();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Could not save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [bookingId, bpSys, bpDia, pulse, temp, spo2, weight, complaint, duration, symptoms, notes, onSubmitted]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="clipboard-outline" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Quick check-in</Text>
            <Text style={styles.headerSub}>
              Fill what you can — every field is optional. The doctor sees this before the call starts.
            </Text>
          </View>
        </View>

        {/* Vitals 2-column */}
        <Text style={styles.sectionLabel}>Vitals</Text>
        <View style={styles.row}>
          <Field label="BP (sys)" value={bpSys} setValue={setBpSys} placeholder="120" suffix="mmHg" keyboardType="number-pad" />
          <Field label="BP (dia)" value={bpDia} setValue={setBpDia} placeholder="80" suffix="mmHg" keyboardType="number-pad" />
        </View>
        <View style={styles.row}>
          <Field label="Pulse" value={pulse} setValue={setPulse} placeholder="72" suffix="bpm" keyboardType="number-pad" />
          <Field label="Temperature" value={temp} setValue={setTemp} placeholder="36.8" suffix="°C" keyboardType="decimal-pad" />
        </View>
        <View style={styles.row}>
          <Field label="SpO₂" value={spo2} setValue={setSpo2} placeholder="98" suffix="%" keyboardType="number-pad" />
          <Field label="Weight" value={weight} setValue={setWeight} placeholder="70" suffix="kg" keyboardType="decimal-pad" />
        </View>

        {/* Chief complaint */}
        <Text style={styles.sectionLabel}>Why are you here today?</Text>
        <TextInput
          style={styles.bigInput}
          placeholder="E.g. burning urination, blood in urine, flank pain…"
          placeholderTextColor="#9AAFB3"
          value={complaint}
          onChangeText={setComplaint}
          maxLength={500}
        />
        <TextInput
          style={[styles.bigInput, { marginTop: 8 }]}
          placeholder="Duration (e.g. since 3 days)"
          placeholderTextColor="#9AAFB3"
          value={duration}
          onChangeText={setDuration}
          maxLength={120}
        />

        {/* Symptom chips */}
        <Text style={styles.sectionLabel}>Tick any that apply</Text>
        <View style={styles.chipsWrap}>
          {UROLOGY_SYMPTOMS.map((s) => {
            const on = symptoms.includes(s);
            return (
              <TouchableOpacity
                key={s}
                onPress={() => toggleSymptom(s)}
                style={[styles.chip, on && styles.chipOn]}
              >
                {on ? <Ionicons name="checkmark" size={13} color={COLORS.primary} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Free notes */}
        <Text style={styles.sectionLabel}>Anything else?</Text>
        <TextInput
          style={[styles.bigInput, { minHeight: 70, textAlignVertical: 'top' }]}
          placeholder="Allergies, current medicines, recent investigations…"
          placeholderTextColor="#9AAFB3"
          value={notes}
          onChangeText={setNotes}
          multiline
          maxLength={1500}
        />

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={onSkip}
            disabled={submitting}
            testID="precall-skip"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={submit}
            disabled={submitting}
            testID="precall-submit"
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.submitText}>Save & continue</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label, value, setValue, placeholder, suffix, keyboardType,
}: {
  label: string; value: string; setValue: (v: string) => void;
  placeholder: string; suffix?: string; keyboardType?: any;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor="#A0B5B8"
          keyboardType={keyboardType || 'default'}
          maxLength={6}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 32 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.primary + '22', marginBottom: 14,
  },
  headerIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 15 },
  headerSub: { color: '#5E7C81', fontSize: 11.5, lineHeight: 16, marginTop: 2 },

  sectionLabel: {
    ...FONTS.h4, color: COLORS.primaryDark, fontSize: 12,
    letterSpacing: 0.6, textTransform: 'uppercase',
    marginTop: 12, marginBottom: 8,
  },
  row: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  fieldWrap: { flex: 1 },
  fieldLabel: { color: '#5E7C81', fontSize: 11, marginBottom: 4 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#DDEAEE',
    paddingHorizontal: 10,
  },
  input: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 14, color: COLORS.textPrimary },
  suffix: { color: '#7B9298', fontSize: 11, marginLeft: 6 },

  bigInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDEAEE',
    borderRadius: RADIUS.md, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, color: COLORS.textPrimary,
  },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDEAEE',
  },
  chipOn: { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary },
  chipText: { fontSize: 12.5, color: COLORS.textPrimary },
  chipTextOn: { color: COLORS.primary, fontWeight: '700' },

  err: { color: COLORS.accent, fontSize: 12, marginTop: 10 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  skipBtn: {
    flex: 1, paddingVertical: 14, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: '#DDEAEE', alignItems: 'center', backgroundColor: '#fff',
  },
  skipText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  submitBtn: {
    flex: 2, flexDirection: 'row', gap: 8,
    paddingVertical: 14, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
