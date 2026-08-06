/**
 * Rx Templates Manager — Wave 1 · C
 *
 * CRUD UI for Rx templates. Each template stores a diagnosis,
 * meds list, advice, follow-up. Templates appear in the Rx
 * composer ("Apply template" button) for one-tap Rx writing.
 *
 * Backend: GET/POST/PATCH/DELETE /api/rx-templates
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
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useSafeBack } from '../../src/use-safe-back';
import { useToast } from '../../src/toast';
import { confirmAction } from '../../src/cross-alert';
import { EmptyState } from '../../src/empty-state';
import { SkeletonCard } from '../../src/skeleton';
import { haptics } from '../../src/haptics';
import {
  listRxTemplates,
  saveRxTemplate,
  deleteRxTemplate,
  RxTemplate,
  RxTemplateMed,
} from '../../src/wave1/api';

const EMPTY: RxTemplate = {
  template_id: '',
  name: '',
  diagnosis: '',
  medicines: [],
  investigations: '',
  advice: '',
  follow_up: '',
};

const STARTER_TEMPLATES: Partial<RxTemplate>[] = [
  {
    name: 'UTI — Uncomplicated (Adult)',
    diagnosis: 'Uncomplicated UTI',
    medicines: [
      { name: 'Tab Nitrofurantoin', dose: '100 mg', frequency: 'BD', duration: '5 days', instructions: 'After food' },
      { name: 'Tab Paracetamol', dose: '500 mg', frequency: 'TDS', duration: '3 days', instructions: 'SOS for fever' },
    ],
    investigations: 'Urine R/M + C&S if recurrent',
    advice: 'Plenty of oral fluids · Repeat urine after 7 days',
    follow_up: '1 week',
  },
  {
    name: 'BPH — Starter (Tamsulosin)',
    diagnosis: 'BPH with LUTS',
    medicines: [
      { name: 'Tab Tamsulosin', dose: '0.4 mg', frequency: 'OD', duration: '30 days', instructions: 'HS, after food' },
    ],
    investigations: 'PSA · USG KUB · IPSS reassessment',
    advice: 'Avoid evening caffeine · Bladder retraining',
    follow_up: '4 weeks',
  },
  {
    name: 'Ureteric colic',
    diagnosis: 'Ureteric calculus',
    medicines: [
      { name: 'Inj Diclofenac', dose: '75 mg', frequency: 'STAT', duration: '1 dose', instructions: 'IM' },
      { name: 'Tab Tamsulosin', dose: '0.4 mg', frequency: 'OD', duration: '14 days', instructions: 'HS' },
      { name: 'Tab Drotaverine', dose: '80 mg', frequency: 'TDS', duration: '5 days', instructions: 'SOS for colic' },
    ],
    investigations: 'NCCT KUB · S. Creatinine · Urine R/M',
    advice: '3 L oral fluids · Sieve urine for stone fragments',
    follow_up: '1 week with NCCT',
  },
];

export default function RxTemplatesScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const safeBack = useSafeBack('/admin' as any);

  const [items, setItems] = useState<RxTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<RxTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await listRxTemplates();
      setItems(r);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const addStarter = (s: Partial<RxTemplate>) => {
    setEditor({ ...EMPTY, ...s, template_id: '', medicines: s.medicines || [] } as RxTemplate);
  };

  const newBlank = () => setEditor({ ...EMPTY, medicines: [{ name: '', dose: '', frequency: '', duration: '', instructions: '' }] });

  const handleSave = async () => {
    if (!editor) return;
    if (!(editor.name || '').trim()) {
      haptics.warning();
      toast.error('Template name required');
      return;
    }
    setSaving(true);
    try {
      const cleanedMeds = (editor.medicines || []).filter((m) => (m.name || '').trim());
      await saveRxTemplate({ ...editor, medicines: cleanedMeds });
      haptics.success();
      toast.success(editor.template_id ? 'Template updated' : 'Template created');
      setEditor(null);
      void load();
    } catch (e: any) {
      haptics.error();
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (t: RxTemplate) => {
    confirmAction({
      title: 'Delete template?',
      message: `"${t.name}" will be removed. Past prescriptions are unaffected.`,
      confirmText: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteRxTemplate(t.template_id);
          toast.success('Template deleted');
          void load();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Delete failed');
        }
      },
    });
  };

  const updateMed = (i: number, field: keyof RxTemplateMed, value: string) => {
    if (!editor) return;
    const meds = [...(editor.medicines || [])];
    meds[i] = { ...meds[i], [field]: value };
    setEditor({ ...editor, medicines: meds });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="tpl-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rx Templates</Text>
        <TouchableOpacity onPress={newBlank} style={styles.iconBtn} testID="tpl-new">
          <Ionicons name="add-circle" size={26} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 10 }}>
          <SkeletonCard height={80} />
          <SkeletonCard height={80} />
          <SkeletonCard height={80} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
          <View style={styles.heroCard}>
            <Ionicons name="medkit" size={20} color="#fff" />
            <Text style={styles.heroTitle}>One-tap Rx for common patterns</Text>
            <Text style={styles.heroSub}>
              Create reusable templates (UTI starter, BPH, ureteric colic, post-op…).
              Apply them in the Rx composer to fill diagnosis, meds, advice, and follow-up in one tap.
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.starterCard}>
              <Text style={styles.starterTitle}>Quick start — pick a starter template</Text>
              {STARTER_TEMPLATES.map((s, i) => (
                <TouchableOpacity key={i} onPress={() => addStarter(s)} style={styles.starterRow}>
                  <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.starterName}>{s.name}</Text>
                    <Text style={styles.muted}>{s.diagnosis}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <View style={{ height: 8 }} />
              <TouchableOpacity onPress={newBlank} style={styles.outlineBtn}>
                <Ionicons name="add" size={16} color={COLORS.primary} />
                <Text style={styles.outlineBtnText}>  Create blank template</Text>
              </TouchableOpacity>
            </View>
          ) : (
            items.map((t) => (
              <View key={t.template_id} style={styles.tplCard}>
                <View style={styles.tplHead}>
                  <Text style={styles.tplName}>{t.name}</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity onPress={() => setEditor(t)} style={styles.smallBtn} testID={`tpl-edit-${t.template_id}`}>
                      <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(t)} style={styles.smallBtn} testID={`tpl-del-${t.template_id}`}>
                      <Ionicons name="trash-outline" size={14} color={COLORS.accent} />
                    </TouchableOpacity>
                  </View>
                </View>
                {t.diagnosis ? <Text style={styles.tplDx}>Dx: {t.diagnosis}</Text> : null}
                {(t.medicines || []).slice(0, 3).map((m, i) => (
                  <Text key={i} style={styles.tplMed} numberOfLines={1}>
                    • {m.name}{m.dose ? ` ${m.dose}` : ''}{m.frequency ? ` · ${m.frequency}` : ''}{m.duration ? ` × ${m.duration}` : ''}
                  </Text>
                ))}
                {(t.medicines?.length || 0) > 3 ? (
                  <Text style={styles.muted}>+{(t.medicines?.length || 0) - 3} more</Text>
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      {/* Editor */}
      <Modal visible={!!editor} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setEditor(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setEditor(null)} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{editor?.template_id ? 'Edit template' : 'New template'}</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.iconBtn} testID="tpl-save">
              {saving ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="checkmark" size={24} color={COLORS.primary} />}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
            {editor && (
              <>
                <Text style={styles.label}>Template name *</Text>
                <TextInput
                  value={editor.name}
                  onChangeText={(v) => setEditor({ ...editor, name: v })}
                  placeholder="e.g. UTI starter"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.input}
                  testID="tpl-name"
                />
                <Text style={styles.label}>Diagnosis</Text>
                <TextInput
                  value={editor.diagnosis || ''}
                  onChangeText={(v) => setEditor({ ...editor, diagnosis: v })}
                  placeholder="e.g. Uncomplicated UTI"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.input}
                  testID="tpl-dx"
                />

                <Text style={styles.label}>Medicines</Text>
                {(editor.medicines || []).map((m, i) => (
                  <View key={i} style={styles.medCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.medIdx}>#{i + 1}</Text>
                      <TouchableOpacity
                        onPress={() => setEditor({ ...editor, medicines: editor.medicines!.filter((_, j) => j !== i) })}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={14} color={COLORS.accent} />
                      </TouchableOpacity>
                    </View>
                    <TextInput
                      value={m.name}
                      onChangeText={(v) => updateMed(i, 'name', v)}
                      placeholder="Drug name"
                      placeholderTextColor={COLORS.textDisabled}
                      style={styles.input}
                    />
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                      <TextInput
                        value={m.dose}
                        onChangeText={(v) => updateMed(i, 'dose', v)}
                        placeholder="Dose (500 mg)"
                        placeholderTextColor={COLORS.textDisabled}
                        style={[styles.input, { flex: 1 }]}
                      />
                      <TextInput
                        value={m.frequency}
                        onChangeText={(v) => updateMed(i, 'frequency', v)}
                        placeholder="Freq (BD/TDS)"
                        placeholderTextColor={COLORS.textDisabled}
                        style={[styles.input, { flex: 1 }]}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                      <TextInput
                        value={m.duration}
                        onChangeText={(v) => updateMed(i, 'duration', v)}
                        placeholder="Duration"
                        placeholderTextColor={COLORS.textDisabled}
                        style={[styles.input, { flex: 1 }]}
                      />
                      <TextInput
                        value={m.instructions}
                        onChangeText={(v) => updateMed(i, 'instructions', v)}
                        placeholder="Instructions"
                        placeholderTextColor={COLORS.textDisabled}
                        style={[styles.input, { flex: 1 }]}
                      />
                    </View>
                  </View>
                ))}
                <TouchableOpacity
                  onPress={() => setEditor({ ...editor, medicines: [...(editor.medicines || []), { name: '', dose: '', frequency: '', duration: '', instructions: '' }] })}
                  style={styles.outlineBtn}
                  testID="tpl-add-med"
                >
                  <Ionicons name="add" size={14} color={COLORS.primary} />
                  <Text style={styles.outlineBtnText}>  Add medicine</Text>
                </TouchableOpacity>

                <Text style={styles.label}>Investigations</Text>
                <TextInput
                  value={editor.investigations || ''}
                  onChangeText={(v) => setEditor({ ...editor, investigations: v })}
                  placeholder="e.g. Urine R/M, USG KUB"
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  multiline
                />
                <Text style={styles.label}>Advice</Text>
                <TextInput
                  value={editor.advice || ''}
                  onChangeText={(v) => setEditor({ ...editor, advice: v })}
                  placeholder="Lifestyle advice, dietary instructions…"
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                  multiline
                />
                <Text style={styles.label}>Follow up</Text>
                <TextInput
                  value={editor.follow_up || ''}
                  onChangeText={(v) => setEditor({ ...editor, follow_up: v })}
                  placeholder="e.g. 1 week with reports"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.input}
                />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff',
  },
  iconBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17, flex: 1, textAlign: 'center' },
  center: { padding: 40, alignItems: 'center' },

  heroCard: {
    backgroundColor: COLORS.primary,
    padding: 14, borderRadius: RADIUS.lg,
    alignItems: 'center', marginBottom: 14, gap: 6,
  },
  heroTitle: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15, textAlign: 'center' },
  heroSub: { ...FONTS.body, color: '#E0F2F5', fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  starterCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  starterTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 8 },
  starterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: COLORS.border + '55',
  },
  starterName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5 },

  tplCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12, marginBottom: 10, gap: 3,
  },
  tplHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tplName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  tplDx: { ...FONTS.body, color: COLORS.primary, fontSize: 12 },
  tplMed: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  smallBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F9' },

  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.primary,
    paddingHorizontal: 14, paddingVertical: 9, alignSelf: 'flex-start',
    marginTop: 8,
  },
  outlineBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  label: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 11, marginTop: 12, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14, color: COLORS.textPrimary, backgroundColor: '#fff',
  },
  medCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    padding: 10, marginBottom: 8,
  },
  medIdx: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
});
