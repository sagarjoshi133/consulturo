/**
 * Discharge tab — either shows "already discharged" or the discharge
 * form. On finalise, generates the combined IPD file PDF.
 *
 * Phase 6.3 — every clinically-narrative field has an inline
 * "✨ Generate with AI" button that pulls the full admission context
 * (rounds, vitals, meds, consents, surgeries with operative notes)
 * from the backend and asks Claude Sonnet 4.5 to draft just that
 * field. All fields stay editable so the surgeon can correct any
 * inaccuracies before finalising.
 *
 * Also adds:
 *   • Operative Notes field (auto-populated from linked surgery's
 *     `operative_note`, AI-fillable too).
 *   • Drug picker modal for "Discharge medications" — search the
 *     in-app drug repository, tap to append formatted lines.
 */
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Modal, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api';
import { COLORS, FONTS, RADIUS } from '../../theme';
import { useToast } from '../../toast';
import { confirmAction, infoAlert } from '../../cross-alert';
import { ISODateField } from '../../date-picker';
import { sharePdfFromHtml } from '../../pdf-share';
import { ipdStyles as styles } from '../styles';
import { Field, AiField } from '../components';
import type { DischargeForm, Admission } from '../types';

const EMPTY_DISCHARGE: DischargeForm = {
  final_diagnosis: '',
  procedures_done: '',
  operative_notes: '',
  course_in_hospital: '',
  condition_at_discharge: 'Stable, improved',
  discharge_meds: '',
  diet_advice: '',
  follow_up_plan: '',
  follow_up_date: '',
  advice: '',
};

export default function DischargeTab({
  admission, admissionId, isDischarged, busy, setBusy, onClose,
}: {
  admission: Admission;
  admissionId: string;
  isDischarged: boolean;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const a = admission;
  const [discharge, setDischarge] = useState<DischargeForm>(EMPTY_DISCHARGE);
  // Phase 6.3 — track which AI field is currently being drafted so we
  // can disable all OTHER AI buttons + show a per-field spinner.
  const [busyAi, setBusyAi] = useState<string | null>(null);
  const [drugPickerOpen, setDrugPickerOpen] = useState(false);

  // Seed final diagnosis + procedures from the admission so the
  // clinician doesn't retype what's already on the chart. Also pull
  // the operative_note from the most recent linked surgery (if any)
  // so we land in the tab with sensible defaults already populated.
  useEffect(() => {
    setDischarge((d) => ({
      ...d,
      final_diagnosis: d.final_diagnosis || a.diagnosis || '',
      procedures_done: d.procedures_done || a.planned_procedure || '',
    }));
  }, [a.diagnosis, a.planned_procedure]);

  useEffect(() => {
    // Pre-fill operative_notes from the linked surgery once on mount.
    // The /api/surgeries list endpoint doesn't filter server-side by
    // admission_id, so we fetch all and pick the most recent surgery
    // tied to this admission that has a non-empty operative_note.
    if (discharge.operative_notes) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/surgeries');
        const items: any[] = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        const linked = items
          .filter((s) => s.admission_id === admissionId || (s.booking_id && s.booking_id === a.booking_id))
          .filter((s) => (s.operative_note || '').trim().length > 0);
        // Prefer the most-recent surgery (sorted DESC by `date` already).
        const withNote = linked[0];
        if (!cancelled && withNote) {
          setDischarge((d) => ({
            ...d,
            operative_notes: d.operative_notes || withNote.operative_note,
          }));
        }
      } catch {
        // best-effort prefill — silent if surgeries endpoint differs.
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId]);

  const submitDischarge = useCallback(() => {
    if (!discharge.final_diagnosis?.trim()) {
      infoAlert('Required', 'Final diagnosis is required.');
      return;
    }
    confirmAction({
      title: 'Discharge patient?',
      message: 'This will close the admission and free the bed. Continue?',
      confirmText: 'Discharge',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          // Map frontend `operative_notes` (plural) → backend
          // `operative_note` (singular) which is the existing
          // schema field. Everything else lines up 1:1.
          const payload = {
            ...discharge,
            operative_note: discharge.operative_notes,
          };
          await api.post(`/ipd/admissions/${admissionId}/discharge`, payload);
          toast.success('Discharged.');
          // Auto-generate combined IPD File PDF on discharge.
          try {
            const { data } = await api.get(`/ipd/admissions/${admissionId}/ipd-file-html`);
            if (data?.html) {
              await sharePdfFromHtml(
                data.html,
                `IPD-${data.ipd_no || a.ipd_no || admissionId}.pdf`,
                `IPD File · ${data.ipd_no || a.ipd_no || ''}`,
              );
              toast.success('IPD File PDF ready.');
            }
          } catch {
            // Non-fatal — user can re-trigger from the overview tab.
          }
          onClose();
        } catch (e: any) {
          infoAlert('Discharge failed', e?.response?.data?.detail || 'Unknown');
        } finally {
          setBusy(false);
        }
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admissionId, discharge, toast, onClose, setBusy]);

  const appendDrug = useCallback((line: string) => {
    setDischarge((d) => ({
      ...d,
      discharge_meds: d.discharge_meds
        ? `${d.discharge_meds.trim()}\n${line}`
        : line,
    }));
  }, []);

  if (isDischarged) {
    return (
      <View style={styles.detCard}>
        <Text style={styles.subTitle}>Already discharged</Text>
        <Text style={styles.noteText}>This admission is closed. View summary in Overview tab.</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.detCard}>
        <Field label="Final diagnosis *" value={discharge.final_diagnosis} onChange={(v: string) => setDischarge({ ...discharge, final_diagnosis: v })} />
        <Field label="Procedures done" value={discharge.procedures_done} onChange={(v: string) => setDischarge({ ...discharge, procedures_done: v })} />

        <AiField
          label="Operative Notes (detailed)"
          value={discharge.operative_notes}
          onChange={(v) => setDischarge({ ...discharge, operative_notes: v })}
          multiline
          placeholder="Pulled from the linked OT surgery record — or tap ✨ to draft from the chart."
          admissionId={admissionId}
          fieldKey="operative_notes"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-operative-notes"
        />

        <AiField
          label="Course in hospital"
          value={discharge.course_in_hospital}
          onChange={(v) => setDischarge({ ...discharge, course_in_hospital: v })}
          multiline
          admissionId={admissionId}
          fieldKey="course_in_hospital"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-course"
        />

        <AiField
          label="Condition at discharge"
          value={discharge.condition_at_discharge}
          onChange={(v) => setDischarge({ ...discharge, condition_at_discharge: v })}
          multiline
          admissionId={admissionId}
          fieldKey="condition_at_discharge"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-condition"
        />

        {/* Discharge medications — AI + drug picker */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <Text style={[styles.fieldLabel, { marginTop: 0, flex: 1 }]}>Discharge medications</Text>
          <TouchableOpacity
            onPress={() => setDrugPickerOpen(true)}
            style={inline.pickBtn}
            testID="dis-meds-picker"
          >
            <Ionicons name="medical" size={12} color={COLORS.primary} />
            <Text style={inline.pickBtnText}>Pick from drug list</Text>
          </TouchableOpacity>
        </View>
        <AiField
          label=""
          value={discharge.discharge_meds}
          onChange={(v) => setDischarge({ ...discharge, discharge_meds: v })}
          multiline
          placeholder="One drug per line — name · strength · route · frequency · duration"
          admissionId={admissionId}
          fieldKey="discharge_meds"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-meds"
        />

        <AiField
          label="Diet advice"
          value={discharge.diet_advice}
          onChange={(v) => setDischarge({ ...discharge, diet_advice: v })}
          multiline
          admissionId={admissionId}
          fieldKey="diet_advice"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-diet"
        />

        <AiField
          label="Follow-up plan"
          value={discharge.follow_up_plan}
          onChange={(v) => setDischarge({ ...discharge, follow_up_plan: v })}
          multiline
          admissionId={admissionId}
          fieldKey="follow_up_plan"
          busyAi={busyAi}
          setBusyAi={setBusyAi}
          testID="dis-followup"
        />

        <View style={{ marginTop: 8 }}>
          <Text style={{ ...FONTS.label, color: COLORS.textSecondary, marginBottom: 4 }}>Follow-up date</Text>
          <ISODateField
            value={discharge.follow_up_date || ''}
            onChange={(v) => setDischarge({ ...discharge, follow_up_date: v })}
            placeholder="DD-MM-YYYY"
          />
        </View>

        <Field
          label="Other advice"
          value={discharge.advice}
          onChange={(v: string) => setDischarge({ ...discharge, advice: v })}
          multiline
        />

        <TouchableOpacity
          style={[styles.primaryBtn, busy && { opacity: 0.6 }, { marginTop: 10, backgroundColor: '#dc2626' }]}
          onPress={submitDischarge}
          disabled={busy || busyAi !== null}
          testID="dis-finalise"
        >
          <Ionicons name="log-out" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Finalise discharge</Text>
        </TouchableOpacity>
      </View>

      <DrugPickerModal
        visible={drugPickerOpen}
        onClose={() => setDrugPickerOpen(false)}
        onPick={appendDrug}
      />
    </View>
  );
}

// ───────────────────────── Drug picker modal ─────────────────────

type DrugRow = {
  drug_id: string;
  name: string;
  category?: string;
  form?: string;
  brands?: string[];
  default_strength?: string;
  default_frequency?: string;
  default_duration?: string;
  default_route?: string;
};

function DrugPickerModal({
  visible, onClose, onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (line: string) => void;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DrugRow[]>([]);
  const [picked, setPicked] = useState<DrugRow | null>(null);
  const [strength, setStrength] = useState('');
  const [route, setRoute] = useState('PO');
  const [frequency, setFrequency] = useState('BD');
  const [duration, setDuration] = useState('5 days');

  // Debounce search → fetch.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/drug-repository', { params: { q: q.trim() || undefined, limit: 40 } })
        .then((r) => { if (!cancelled) setItems(r.data?.items || []); })
        .catch(() => { if (!cancelled) setItems([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, visible]);

  // Reset state when modal opens.
  useEffect(() => {
    if (visible) {
      setQ('');
      setPicked(null);
      setStrength('');
      setRoute('PO');
      setFrequency('BD');
      setDuration('5 days');
    }
  }, [visible]);

  const addCurrent = () => {
    if (!picked) return;
    const parts = [picked.name];
    if (strength.trim()) parts.push(strength.trim());
    if (route.trim()) parts.push(route.trim());
    if (frequency.trim()) parts.push(frequency.trim());
    if (duration.trim()) parts.push(`× ${duration.trim()}`);
    const line = parts.join(' · ');
    onPick(line);
    setPicked(null);
  };

  const grouped = useMemo(() => {
    const g: Record<string, DrugRow[]> = {};
    items.forEach((d) => {
      const k = d.category || 'Other';
      if (!g[k]) g[k] = [];
      g[k].push(d);
    });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={inline.modalRoot}>
        <View style={inline.modalHeader}>
          <Text style={inline.modalTitle}>Pick discharge medication</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={COLORS.textPrimary} /></TouchableOpacity>
        </View>

        <View style={inline.searchBar}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by drug or brand name…"
            placeholderTextColor={COLORS.textTertiary}
            style={inline.searchInput}
            autoFocus
          />
        </View>

        {picked ? (
          <View style={inline.pickedCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
              <Text style={inline.pickedName}>{picked.name}</Text>
              <Text style={inline.pickedMeta}>{picked.form || ''}</Text>
            </View>
            <View style={inline.row2}>
              <View style={inline.col}>
                <Text style={inline.lbl}>Strength</Text>
                <TextInput style={inline.smallInput} value={strength} onChangeText={setStrength} placeholder="e.g. 500 mg" placeholderTextColor={COLORS.textTertiary} />
              </View>
              <View style={inline.col}>
                <Text style={inline.lbl}>Route</Text>
                <TextInput style={inline.smallInput} value={route} onChangeText={setRoute} placeholder="PO / IV / IM / SC" placeholderTextColor={COLORS.textTertiary} />
              </View>
            </View>
            <View style={inline.row2}>
              <View style={inline.col}>
                <Text style={inline.lbl}>Frequency</Text>
                <TextInput style={inline.smallInput} value={frequency} onChangeText={setFrequency} placeholder="OD / BD / TDS / QID" placeholderTextColor={COLORS.textTertiary} />
              </View>
              <View style={inline.col}>
                <Text style={inline.lbl}>Duration</Text>
                <TextInput style={inline.smallInput} value={duration} onChangeText={setDuration} placeholder="e.g. 5 days" placeholderTextColor={COLORS.textTertiary} />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <TouchableOpacity onPress={() => setPicked(null)} style={[inline.ctaSecondary, { flex: 1 }]}>
                <Text style={inline.ctaSecondaryText}>Back to list</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={addCurrent} style={[inline.ctaPrimary, { flex: 1 }]}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={inline.ctaPrimaryText}>Add to list</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 60 }}>
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: 24 }} />
            ) : grouped.length === 0 ? (
              <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 24, textAlign: 'center' }}>No matches</Text>
            ) : grouped.map(([cat, list]) => (
              <View key={cat} style={{ marginBottom: 14 }}>
                <Text style={inline.catTitle}>{cat}</Text>
                {list.map((d) => (
                  <TouchableOpacity
                    key={d.drug_id}
                    style={inline.drugRow}
                    onPress={() => {
                      setPicked(d);
                      setStrength(d.default_strength || '');
                      setRoute(d.default_route || (d.form?.toLowerCase().includes('inj') ? 'IV' : 'PO'));
                      setFrequency(d.default_frequency || 'BD');
                      setDuration(d.default_duration || '5 days');
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={inline.drugName}>{d.name}</Text>
                      {(d.brands && d.brands.length > 0) ? (
                        <Text style={inline.drugMeta} numberOfLines={1}>
                          {d.brands.slice(0, 3).join(' · ')}
                          {d.form ? ` · ${d.form}` : ''}
                        </Text>
                      ) : d.form ? (
                        <Text style={inline.drugMeta}>{d.form}</Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// Local styles (kept inline to avoid bloating ipdStyles for one screen).
const inline = {
  pickBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, backgroundColor: COLORS.primary + '15',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  pickBtnText: { color: COLORS.primary, fontSize: 11, fontWeight: '600' as const },
  modalRoot: { flex: 1, backgroundColor: COLORS.bg },
  modalHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    padding: 14, paddingTop: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
  },
  modalTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  searchBar: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    marginHorizontal: 12, marginTop: 12, paddingHorizontal: 12, height: 42,
    backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, ...FONTS.body, fontSize: 14 },
  catTitle: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  drugRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    padding: 12, marginBottom: 6,
    borderRadius: RADIUS.md, backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  drugName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  drugMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  pickedCard: { margin: 12, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, gap: 6 },
  pickedName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  pickedMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  row2: { flexDirection: 'row' as const, gap: 8, marginTop: 6 },
  col: { flex: 1 },
  lbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  smallInput: {
    height: 36, paddingHorizontal: 10,
    borderRadius: RADIUS.md, backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.textPrimary,
  },
  ctaPrimary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.primary },
  ctaPrimaryText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
  ctaSecondary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  ctaSecondaryText: { color: COLORS.textPrimary, ...FONTS.bodyMedium, fontSize: 14 },
};
