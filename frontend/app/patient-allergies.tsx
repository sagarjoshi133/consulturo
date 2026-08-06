/**
 * Patient Allergies editor — Wave 1 · D
 *
 * Allows clinicians to record patient drug allergies. Shown as a
 * banner on the Rx form when a phone matches.
 *
 * Backend: GET / PATCH /api/patients/allergies
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useSafeBack } from '../src/use-safe-back';
import { useToast } from '../src/toast';
import { getAllergies, setAllergies } from '../src/wave1/api';

const COMMON_ALLERGIES = [
  'Penicillin',
  'Cephalosporins',
  'Sulfa drugs',
  'NSAIDs',
  'Aspirin',
  'Iodine / contrast',
  'Latex',
  'Codeine',
  'Anaesthetics (lignocaine)',
  'Quinolones',
];

export default function PatientAllergiesScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const params = useLocalSearchParams<{ phone?: string; name?: string }>();
  const phone = (params?.phone as string) || '';
  const name = (params?.name as string) || 'Patient';
  const safeBack = useSafeBack(`/patient-db/${encodeURIComponent(phone)}` as any);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) { setLoading(false); return; }
    (async () => {
      try {
        const r = await getAllergies(phone);
        setItems(r.allergies || []);
        setNotes(r.notes || '');
        setUpdatedAt(r.updated_at || null);
      } catch {}
      setLoading(false);
    })();
  }, [phone]);

  const add = useCallback((v: string) => {
    const t = (v || '').trim();
    if (!t) return;
    setItems((arr) => (arr.some((x) => x.toLowerCase() === t.toLowerCase()) ? arr : [...arr, t]));
    setDraft('');
  }, []);

  const remove = (v: string) => setItems((arr) => arr.filter((x) => x !== v));

  const save = async () => {
    if (!phone) return;
    setSaving(true);
    try {
      await setAllergies(phone, items, notes);
      toast.success('Allergies saved');
      safeBack();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="allergies-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Allergies</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{name} · {phone}</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }} keyboardShouldPersistTaps="handled">
          <View style={styles.warnCard}>
            <Ionicons name="warning" size={18} color="#92400E" />
            <Text style={styles.warnText}>
              Drugs entered here will trigger a warning on every new prescription for this patient.
              Be specific (drug class, not formula).
            </Text>
          </View>

          {/* Current allergies */}
          <Section title={`Current allergies${items.length ? ` · ${items.length}` : ''}`}>
            {items.length === 0 ? (
              <Text style={styles.muted}>No allergies recorded.</Text>
            ) : (
              <View style={styles.chipRow}>
                {items.map((a) => (
                  <TouchableOpacity key={a} style={styles.chip} onPress={() => remove(a)} testID={`allergy-chip-${a}`}>
                    <Text style={styles.chipText}>{a}</Text>
                    <Ionicons name="close-circle" size={14} color="#B91C1C" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Section>

          {/* Add */}
          <Section title="Add allergy">
            <View style={styles.inputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Type a drug or substance"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.input}
                returnKeyType="done"
                onSubmitEditing={() => add(draft)}
                testID="allergy-input"
              />
              <TouchableOpacity
                onPress={() => add(draft)}
                disabled={!draft.trim()}
                style={[styles.addBtn, !draft.trim() && { opacity: 0.4 }]}
                testID="allergy-add"
              >
                <Ionicons name="add" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.muted}>Or pick from common allergies:</Text>
            <View style={styles.chipRow}>
              {COMMON_ALLERGIES.filter((a) => !items.some((x) => x.toLowerCase() === a.toLowerCase())).map((a) => (
                <TouchableOpacity key={a} style={styles.suggestChip} onPress={() => add(a)} testID={`allergy-suggest-${a}`}>
                  <Ionicons name="add" size={12} color={COLORS.primary} />
                  <Text style={styles.suggestChipText}>{a}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Section>

          {/* Notes */}
          <Section title="Reaction notes (optional)">
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Rash + facial swelling within 30 min of amoxicillin (2024)"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
              multiline
              testID="allergy-notes"
            />
          </Section>

          {updatedAt ? (
            <Text style={styles.metaUpd}>Last updated: {new Date(updatedAt).toLocaleString()}</Text>
          ) : null}

          <TouchableOpacity
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            testID="allergy-save"
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Ionicons name="save" size={16} color="#fff" />
                <Text style={styles.saveBtnText}>  Save allergies</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  center: { padding: 40, alignItems: 'center' },

  warnCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FEF3C7', borderColor: '#FBBF24', borderWidth: 1,
    padding: 12, borderRadius: RADIUS.md, marginBottom: 14,
  },
  warnText: { ...FONTS.body, color: '#92400E', fontSize: 12.5, flex: 1, lineHeight: 17 },

  section: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg,
    padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  sectionTitle: {
    ...FONTS.bodyMedium, fontSize: 12,
    color: COLORS.primary, marginBottom: 8,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 6, marginBottom: 4 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FEE2E2', borderWidth: 1, borderColor: '#FCA5A5',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  chipText: { ...FONTS.bodyMedium, color: '#B91C1C', fontSize: 12 },
  suggestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary + '10', borderWidth: 1, borderColor: COLORS.primary + '44',
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
  },
  suggestChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  inputRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  input: {
    flex: 1,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14, color: COLORS.textPrimary, backgroundColor: '#fff',
  },
  addBtn: {
    width: 44, height: 44, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  metaUpd: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginTop: 4, marginBottom: 12, textAlign: 'center' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary,
  },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
