/**
 * Discharge Summaries — standalone list / edit / export screen.
 *
 * Lifts the discharge-summary workflow out of the IPD module so
 * staff can search, edit and print all discharge summaries from
 * one place. Source data still lives on `admissions.discharge_summary`,
 * but this screen never goes through the IPD admission detail.
 *
 * Layout:
 *   • Search bar (name / phone / IPD no.)
 *   • Date-range filters (from / to)
 *   • Card list — purple accent strip (DOC_THEME.discharge)
 *     Each row: Patient · IPD No. · Final dx · Discharge date.
 *     Tapping opens an in-screen edit modal with all summary fields.
 *   • Per-row "Print PDF" button (uses /api/render/html + WeasyPrint).
 *
 * Routed from Practice grid → "Discharge Summary".
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DOC_THEME } from '../../src/doc-theme';
import { useResponsive } from '../../src/responsive';
import { useToast } from '../../src/toast';
import { buildDischargeSummaryHtml } from '../../src/discharge-summary-pdf';
import { sharePdfFromHtml } from '../../src/pdf-share';
import { sharePdfThenWhatsApp } from '../../src/whatsapp-pdf';
import { fetchClinicSettings } from '../../src/clinic-settings';
import { ISODateField } from '../../src/date-picker';

type Row = {
  id: string;
  ipd_no?: string;
  patient_name?: string;
  patient_phone?: string;
  patient_age?: number;
  patient_gender?: string;
  admitted_at?: string;
  discharged_at?: string;
  diagnosis?: string;
  final_diagnosis?: string;
  procedures_done?: string;
  condition_at_discharge?: string;
  follow_up_date?: string;
  discharged_by?: string;
};

export default function DischargeSummariesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth() as any;
  const { isWebDesktop } = useResponsive();
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const isStaff = !!user && !['patient'].includes(((user as any).role || '').toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search.trim()) params.q = search.trim();
      if (fromDate.trim()) params.from_date = fromDate.trim();
      if (toDate.trim()) params.to_date = toDate.trim();
      const r = await api.get('/discharge-summaries', { params });
      setItems(r.data?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [search, fromDate, toDate]);

  useEffect(() => { void load(); }, []); // initial only — subsequent loads via the Search button

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(r =>
      (r.patient_name || '').toLowerCase().includes(q) ||
      (r.patient_phone || '').toLowerCase().includes(q) ||
      (r.ipd_no || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="dsch-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Discharge Summaries</Text>
          <Text style={styles.sub}>Search · edit · print · share</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Purple banner — visually identifies the document family */}
        <View style={styles.banner}>
          <View style={[styles.bannerStrip, { backgroundColor: DOC_THEME.discharge.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: DOC_THEME.discharge.accent }]}>
              Discharge Summary
            </Text>
            <Text style={styles.bannerBody}>
              Generated on discharge from the IPD module. You can search, edit and re-print here without leaving this screen.
            </Text>
          </View>
          <Ionicons name="exit" size={32} color={DOC_THEME.discharge.accent} />
        </View>

        {/* Search controls */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Patient name, phone, or IPD No."
            placeholderTextColor={COLORS.textDisabled}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => { void load(); }}
            testID="dsch-search"
          />
          <TouchableOpacity onPress={() => { void load(); }} style={styles.searchBtn} testID="dsch-search-go">
            <Ionicons name="search" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <ISODateField
              value={fromDate}
              onChange={(v) => { setFromDate(v); if (v) void load(); }}
              placeholder="From DD-MM-YYYY"
              testID="dsch-from"
            />
          </View>
          <View style={{ flex: 1 }}>
            <ISODateField
              value={toDate}
              onChange={(v) => { setToDate(v); if (v) void load(); }}
              placeholder="To DD-MM-YYYY"
              testID="dsch-to"
            />
          </View>
        </View>

        <View style={{ marginTop: 18 }}>
          {loading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="exit-outline" size={32} color={COLORS.textDisabled} />
              <Text style={styles.emptyTitle}>No discharge summaries found</Text>
              <Text style={styles.emptyBody}>
                Discharge a patient from the IPD module to see them appear here.
              </Text>
            </View>
          ) : (
            <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } : undefined}>
              {filtered.map(r => (
                <View
                  key={r.id}
                  style={[styles.row, isWebDesktop && { width: '49%' }]}
                  testID={`dsch-row-${r.id}`}
                >
                  <View style={[styles.rowStrip, { backgroundColor: DOC_THEME.discharge.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{r.patient_name || '—'}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      IPD {r.ipd_no || '—'}
                      {r.discharged_at ? ' · Discharged ' + format(new Date(r.discharged_at), 'd MMM yyyy') : ''}
                    </Text>
                    {(r.final_diagnosis || r.diagnosis) ? (
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        Dx: {r.final_diagnosis || r.diagnosis}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    onPress={() => { void exportPdf(r); }}
                    style={[styles.rowBtn, { backgroundColor: DOC_THEME.discharge.accent + '15' }]}
                    testID={`dsch-pdf-${r.id}`}
                  >
                    <Ionicons name="document-text" size={16} color={DOC_THEME.discharge.accent} />
                  </TouchableOpacity>
                  {isStaff && (
                    <TouchableOpacity
                      onPress={() => setEditingId(r.id)}
                      style={styles.rowBtn}
                      testID={`dsch-edit-${r.id}`}
                    >
                      <Ionicons name="pencil" size={16} color={COLORS.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Edit modal */}
      <EditDischargeSummary
        admissionId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={() => { setEditingId(null); void load(); }}
      />
    </SafeAreaView>
  );
}


/* ── PDF export helper ─────────────────────────────────── */

async function exportPdf(r: Row) {
  try {
    const { data: ds } = await api.get(`/ipd/admissions/${r.id}/discharge-summary`);
    // Pull clinic settings so the discharge PDF renders with the
    // doctor's letterhead / signature / branding strip identical to
    // the Rx + Medical Cert PDFs.
    let clinic: any = undefined;
    try {
      const cs: any = await fetchClinicSettings();
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
        // Phase 5.20 — for the WhatsApp follow-up prompt.
        country_code: cs.country_code || '+91',
        whatsapp_auto_prompt_enabled: cs.whatsapp_auto_prompt_enabled !== false,
      };
    } catch {
      // Non-fatal — falls back to defaults inside the template.
    }
    const html = buildDischargeSummaryHtml({ ...ds, clinic });
    const safeName = (r.patient_name || 'Patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const filename = `DischargeSummary-${safeName}-${r.ipd_no || ''}.pdf`;
    // Phase 5.20 — also prompt the doctor to open the patient's
    // WhatsApp chat after the PDF is shared, so they don't have
    // to switch apps + find the contact + type a follow-up note.
    await sharePdfThenWhatsApp(html, filename, 'Share discharge summary', {
      patientName: r.patient_name || null,
      patientPhone: (r as any).patient_phone || (ds && ds.patient_phone) || null,
      countryCode: clinic?.country_code || '+91',
      docKind: 'discharge',
      followUpDate: (ds && ds.follow_up_date) || null,
      doctorName: clinic?.doctor_name || null,
      enabled: clinic?.whatsapp_auto_prompt_enabled !== false,
    });
  } catch (e: any) {
    Alert.alert('Export failed', e?.response?.data?.detail || e?.message || 'Unknown error');
  }
}


/* ── Edit Modal ─────────────────────────────────── */

type EditDraft = {
  final_diagnosis?: string;
  procedures_done?: string;
  operative_note?: string;  // Phase 5.12 — detailed AI-fillable op note
  course_in_hospital?: string;
  condition_at_discharge?: string;
  discharge_meds?: string;
  diet_advice?: string;
  follow_up_plan?: string;
  follow_up_date?: string;
  advice?: string;
  danger_signs?: string;
};

function EditDischargeSummary({
  admissionId, onClose, onSaved,
}: {
  admissionId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const visible = !!admissionId;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState<any>(null);
  const [draft, setDraft] = useState<EditDraft>({});
  const toast = useToast();

  useEffect(() => {
    if (!admissionId) return;
    let live = true;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/ipd/admissions/${admissionId}/discharge-summary`);
        if (!live) return;
        setBundle(data);
        const s = data?.admission?.discharge_summary || {};
        setDraft({
          final_diagnosis: s.final_diagnosis || data?.admission?.diagnosis || '',
          procedures_done: s.procedures_done || '',
          course_in_hospital: s.course_in_hospital || '',
          condition_at_discharge: s.condition_at_discharge || '',
          discharge_meds: s.discharge_meds || '',
          diet_advice: s.diet_advice || '',
          follow_up_plan: s.follow_up_plan || '',
          follow_up_date: s.follow_up_date || '',
          advice: s.advice || '',
          danger_signs: s.danger_signs || '',
        });
      } catch (e: any) {
        Alert.alert('Could not load', e?.response?.data?.detail || e?.message || '');
        onClose();
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [admissionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!admissionId) return;
    setBusy(true);
    try {
      await api.put(`/ipd/admissions/${admissionId}/discharge-summary`, draft);
      toast.show('Discharge summary updated', 'success');
      onSaved();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || e?.message || '');
    } finally {
      setBusy(false);
    }
  };

  const setKv = (k: keyof EditDraft) => (v: string) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} testID="dsch-edit-close">
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Edit Discharge Summary</Text>
            {bundle?.admission ? (
              <Text style={styles.sub}>{bundle.admission.patient_name} · IPD {bundle.admission.ipd_no}</Text>
            ) : null}
          </View>
        </View>
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
              <Field label="Final diagnosis" value={draft.final_diagnosis} onChange={setKv('final_diagnosis')} />

              {/* Phase 5.12 — Claude Sonnet 4.5 generates a complete
                  ≥2-page discharge summary, intelligently expanding
                  whatever notes the surgeon has typed so far. The
                  output is written into Course in hospital + Procedures
                  done + Discharge meds + Advice fields so the doctor
                  can fine-tune before saving. */}
              <TouchableOpacity
                onPress={async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    const adm = bundle?.admission || {};
                    const r = await api.post('/ai/discharge-summary/generate', {
                      patient_name: adm.patient_name,
                      patient_age: adm.patient_age,
                      patient_gender: adm.patient_gender,
                      registration_no: adm.registration_no,
                      diagnosis: draft.final_diagnosis || adm.diagnosis || '',
                      presenting_complaints: adm.chief_complaints || adm.presenting_complaints || '',
                      past_history: adm.past_history || '',
                      examination_findings: adm.examination_findings || '',
                      investigations: adm.investigations || '',
                      surgery_name: draft.procedures_done || adm.surgery_name,
                      surgery_date: adm.surgery_date,
                      operative_note_seed: draft.procedures_done || '',
                      course_in_hospital: draft.course_in_hospital || '',
                      admission_date: adm.admitted_at,
                      discharge_date: adm.discharged_at,
                      discharge_medications: draft.discharge_meds || '',
                      advice: draft.advice || '',
                      follow_up: draft.follow_up_plan || '',
                      final_status: draft.condition_at_discharge || '',
                    });
                    const text = (r.data?.summary || '').trim();
                    if (text) {
                      // Split AI output into our individual fields by
                      // section heading. Best-effort — falls back to
                      // writing the whole thing into course_in_hospital.
                      const grab = (h: string): string => {
                        const re = new RegExp(`${h}[:：]\\s*([\\s\\S]*?)(?=\\n[0-9]+\\)\\s|\\n[A-Z][A-Z]+\\s*[:：]|$)`, 'i');
                        const m = text.match(re);
                        return m ? m[1].trim() : '';
                      };
                      setDraft((d) => ({
                        ...d,
                        operative_note: grab('OPERATIVE NOTE') || d.operative_note,
                        procedures_done: d.procedures_done,
                        course_in_hospital: grab('COURSE IN HOSPITAL') || text,
                        condition_at_discharge: grab('CONDITION AT DISCHARGE') || d.condition_at_discharge,
                        discharge_meds: grab('DISCHARGE MEDICATIONS') || d.discharge_meds,
                        advice: grab('ADVICE ON DISCHARGE') || d.advice,
                        follow_up_plan: grab('FOLLOW-UP PLAN') || d.follow_up_plan,
                      }));
                      toast.show('AI summary inserted — please review & edit', 'success');
                    }
                  } catch (e: any) {
                    Alert.alert('AI generation failed', e?.response?.data?.detail || 'Please try again.');
                  } finally {
                    setBusy(false);
                  }
                }}
                style={styles.aiBtn}
                disabled={busy}
                testID="dsch-ai-generate"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles" size={14} color="#fff" />}
                <Text style={styles.aiBtnText}>Generate detailed summary with AI</Text>
              </TouchableOpacity>

              <Field label="Procedures done" value={draft.procedures_done} onChange={setKv('procedures_done')} multiline />
              <Field
                label="Operative note · detailed (Phase 5.12)"
                value={draft.operative_note}
                onChange={setKv('operative_note')}
                multiline
                placeholder="Indication · Anaesthesia · Position · Incision/Access · Step-by-step procedure · Intra-op findings · Blood loss · Complications · Closure · Post-op orders"
              />
              <Field label="Course in hospital" value={draft.course_in_hospital} onChange={setKv('course_in_hospital')} multiline />
              <Field label="Condition at discharge" value={draft.condition_at_discharge} onChange={setKv('condition_at_discharge')} />
              <Field label="Discharge medications" value={draft.discharge_meds} onChange={setKv('discharge_meds')} multiline />
              <Field label="Diet & lifestyle advice" value={draft.diet_advice} onChange={setKv('diet_advice')} multiline />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <Field label="Follow-up plan" value={draft.follow_up_plan} onChange={setKv('follow_up_plan')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...FONTS.label, color: COLORS.textSecondary, marginBottom: 4 }}>Follow-up date</Text>
                  <ISODateField
                    value={draft.follow_up_date || ''}
                    onChange={(v) => setKv('follow_up_date')(v)}
                    placeholder="DD-MM-YYYY"
                  />
                </View>
              </View>
              <Field label="General advice" value={draft.advice} onChange={setKv('advice')} multiline />
              <Field label="Danger signs (return immediately)" value={draft.danger_signs} onChange={setKv('danger_signs')} multiline />

              <TouchableOpacity
                onPress={save}
                disabled={busy}
                style={[styles.saveBtn, busy && { opacity: 0.6 }]}
                testID="dsch-edit-save"
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={16} color="#fff" />}
                <Text style={styles.saveBtnText}>{busy ? 'Saving…' : 'Save changes'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Field({
  label, value, onChange, multiline, placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        value={value || ''}
        onChangeText={onChange}
      />
    </>
  );
}


/* ── Styles ─────────────────────────────────────────── */

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  bannerStrip: { width: 4, height: 56, borderRadius: 2 },
  bannerTitle: { ...FONTS.bodyMedium, fontSize: 14, marginBottom: 2 },
  bannerBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },

  searchRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  searchInput: {
    flex: 1, padding: 10, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, backgroundColor: '#fff', fontSize: 13,
    color: COLORS.textPrimary,
  },
  searchBtn: {
    width: 44, height: 42, borderRadius: RADIUS.sm,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  dateInput: {
    padding: 10, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, backgroundColor: '#fff', fontSize: 12,
    color: COLORS.textPrimary,
  },

  empty: { padding: 28, alignItems: 'center', backgroundColor: '#fff', borderRadius: RADIUS.md, gap: 6 },
  emptyTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  emptyBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  rowStrip: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  rowBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '12',
  },

  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12, marginBottom: 6 },
  input: {
    padding: 10, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, backgroundColor: '#fff',
    color: COLORS.textPrimary, fontSize: 13,
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: RADIUS.pill,
    backgroundColor: DOC_THEME.discharge.accent, marginTop: 24,
  },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  // Phase 5.12 — AI generation CTA in the discharge editor
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: DOC_THEME.discharge.accent,
    marginTop: 8, marginBottom: 12,
  },
  aiBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },
});
