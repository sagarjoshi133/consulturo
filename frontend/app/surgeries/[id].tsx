/**
 * Surgery detail page — combines:
 *   • Phase 3.2 Pre-op checklist (12 trilingual items)
 *   • Phase 3.3 Op-note editor with template prefill
 *   • Phase 3.4 Post-op progress notes (daily)
 *
 * Route: /surgeries/[id]
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import { display12h, displayDateLong } from '../../src/date';

type Lang = 'en' | 'hi' | 'gu';

type ChecklistItem = {
  key: string;
  critical: boolean;
  label: Record<Lang, string>;
  hint: Record<Lang, string>;
};
type Surgery = {
  surgery_id: string;
  patient_name?: string;
  patient_phone?: string;
  patient_age?: number;
  patient_sex?: string;
  surgery_name?: string;
  procedure_key?: string;
  diagnosis?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  ot_room?: string;
  estimated_duration_min?: number;
  surgery_status?: string;
  operative_findings?: string;
  notes?: string;
  follow_up?: string;
  preop_checklist?: Record<string, boolean>;
  preop_all_critical_done?: boolean;
  postop_notes?: PostopNote[];
};
type PostopNote = {
  note_id: string;
  date: string;
  vitals?: string;
  drug_chart?: string;
  progress?: string;
  complications?: string;
  plan?: string;
  author_name?: string;
  created_at: string;
};

type TabKey = 'preop' | 'op' | 'postop';

export default function SurgeryDetail() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { lang } = useI18n();
  const L: Lang = (lang === 'hi' || lang === 'gu') ? lang : 'en';

  const [tab, setTab] = useState<TabKey>('preop');
  const [sx, setSx] = useState<Surgery | null>(null);
  const [tpl, setTpl] = useState<ChecklistItem[]>([]);
  const [criticalKeys, setCriticalKeys] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [opNoteDraft, setOpNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // post-op composer
  const [popDraft, setPopDraft] = useState<{ vitals: string; drug_chart: string; progress: string; complications: string; plan: string }>({
    vitals: '', drug_chart: '', progress: '', complications: '', plan: '',
  });
  const [savingPop, setSavingPop] = useState(false);

  const load = useCallback(async () => {
    try {
      // Fetch surgeries list & filter (we don't have GET /surgeries/{id})
      const all = await api.get('/surgeries');
      const found = (all.data || []).find((s: any) => s.surgery_id === id);
      if (!found) {
        toast.error('Surgery not found');
        (router.canGoBack() ? router.back() : router.replace('/' as any));
        return;
      }
      setSx(found);
      setChecklist(found.preop_checklist || {});
      setOpNoteDraft(found.operative_findings || '');
      // Pre-op template
      const t = await api.get('/surgeries/preop/template');
      setTpl(t.data?.items || []);
      setCriticalKeys(t.data?.critical_keys || []);
    } catch {
      toast.error('Could not load surgery');
    } finally {
      setLoading(false);
    }
  }, [id, router, toast]);

  useEffect(() => { load(); }, [load]);

  const criticalDone = useMemo(
    () => criticalKeys.length > 0 && criticalKeys.every((k) => checklist[k]),
    [criticalKeys, checklist],
  );
  const totalChecked = Object.values(checklist).filter(Boolean).length;
  const totalCritical = criticalKeys.length;
  const criticalChecked = criticalKeys.filter((k) => checklist[k]).length;

  const saveChecklist = async () => {
    if (!sx) return;
    setBusy(true);
    try {
      const r = await api.patch(`/surgeries/${sx.surgery_id}/preop`, { checklist });
      setSx({ ...sx, ...r.data });
      toast.success('Checklist saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally { setBusy(false); }
  };

  const loadOpNoteTemplate = async () => {
    try {
      const r = await api.get('/surgeries/op-note-template', {
        params: { procedure_key: sx?.procedure_key },
      });
      // Append rather than overwrite if there's existing content
      const tplText = r.data?.template || '';
      if (opNoteDraft && opNoteDraft.trim().length > 0) {
        Alert.alert(
          'Replace existing note?',
          'Loading the template will overwrite the current op-note draft. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Replace', style: 'destructive', onPress: () => setOpNoteDraft(tplText) },
          ],
        );
      } else {
        setOpNoteDraft(tplText);
      }
    } catch {
      toast.error('Could not load template');
    }
  };

  const saveOpNote = async () => {
    if (!sx) return;
    setBusy(true);
    try {
      await api.patch(`/surgeries/${sx.surgery_id}/status`, {
        status: sx.surgery_status || 'in_progress',
        operative_findings: opNoteDraft,
      });
      setSx({ ...sx, operative_findings: opNoteDraft });
      toast.success('Op-note saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally { setBusy(false); }
  };

  const transition = async (newStatus: 'in_progress' | 'completed' | 'cancelled') => {
    if (!sx) return;
    if (newStatus === 'in_progress' && !criticalDone) {
      Alert.alert(
        'Pre-op not complete',
        `Only ${criticalChecked} of ${totalCritical} critical items checked. Surgery cannot start.`,
        [{ text: 'OK' }],
      );
      return;
    }
    setBusy(true);
    try {
      const payload: any = { status: newStatus };
      if (newStatus === 'completed') {
        payload.operative_findings = opNoteDraft;
        payload.date = new Date().toISOString().slice(0, 10);
      }
      const r = await api.patch(`/surgeries/${sx.surgery_id}/status`, payload);
      setSx({ ...sx, ...r.data });
      toast.success(newStatus === 'in_progress' ? 'Surgery started' :
                    newStatus === 'completed' ? 'Surgery completed' :
                    'Surgery cancelled');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally { setBusy(false); }
  };

  const addPostopNote = async () => {
    if (!sx) return;
    const hasAny = Object.values(popDraft).some((v) => v.trim().length > 0);
    if (!hasAny) { toast.error('Fill at least one field'); return; }
    setSavingPop(true);
    try {
      const r = await api.post(`/surgeries/${sx.surgery_id}/postop-notes`, popDraft);
      const newNote: PostopNote = r.data;
      setSx({ ...sx, postop_notes: [newNote, ...(sx.postop_notes || [])] });
      setPopDraft({ vitals: '', drug_chart: '', progress: '', complications: '', plan: '' });
      toast.success('Post-op note added');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally { setSavingPop(false); }
  };

  const [sendingReminder, setSendingReminder] = useState(false);

  const sendWhatsAppReminder = async () => {
    if (!sx) return;
    if (!sx.patient_phone) {
      toast.error('Patient phone not on file');
      return;
    }
    setSendingReminder(true);
    try {
      const r = await api.post(`/surgeries/${sx.surgery_id}/send-reminder`, { force: false });
      const link: string | null = r.data?.wa_link || null;
      if (link) {
        try {
          await Linking.openURL(link);
          toast.success(r.data?.push_sent ? 'Push sent · opening WhatsApp' : 'Opening WhatsApp');
        } catch {
          toast.error('Could not open WhatsApp');
        }
      } else {
        toast.success(r.data?.push_sent ? 'Reminder push sent' : 'Reminder queued');
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Send failed');
    } finally {
      setSendingReminder(false);
    }
  };

  const removePostopNote = async (noteId: string) => {
    if (!sx) return;
    Alert.alert('Delete note?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/surgeries/${sx.surgery_id}/postop-notes/${noteId}`);
            setSx({ ...sx, postop_notes: (sx.postop_notes || []).filter((n) => n.note_id !== noteId) });
            toast.success('Note removed');
          } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Delete failed');
          }
        },
      },
    ]);
  };

  if (loading || !sx) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  const statusColor =
    sx.surgery_status === 'in_progress' ? COLORS.warning :
    sx.surgery_status === 'completed'   ? COLORS.success :
    sx.surgery_status === 'cancelled'   ? COLORS.accent  :
    COLORS.primary;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="sx-back">
          <Ionicons name="chevron-back" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {sx.patient_name || 'Patient'} · {sx.surgery_name || sx.procedure_key}
          </Text>
          <Text style={styles.subtitle}>
            {displayDateLong(sx.scheduled_date || '')} · {display12h(sx.scheduled_time || '') || '—'}
            {sx.ot_room ? ` · ${sx.ot_room}` : ''}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{(sx.surgery_status || 'scheduled').replace('_', ' ')}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TabPill label={`Pre-op (${totalChecked}/${tpl.length})`} active={tab === 'preop'} onPress={() => setTab('preop')} />
        <TabPill label="Op-note" active={tab === 'op'} onPress={() => setTab('op')} />
        <TabPill label={`Post-op (${sx.postop_notes?.length || 0})`} active={tab === 'postop'} onPress={() => setTab('postop')} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {tab === 'preop' && (
          <View style={styles.card}>
            <View style={styles.preopHead}>
              <Ionicons name={criticalDone ? 'checkmark-circle' : 'alert-circle'} size={18} color={criticalDone ? COLORS.success : COLORS.warning} />
              <Text style={styles.preopHeadText}>
                {criticalChecked}/{totalCritical} critical items {criticalDone ? '· ready to start' : '· still pending'}
              </Text>
            </View>
            {tpl.map((item) => {
              const on = !!checklist[item.key];
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.cklRow, on && styles.cklRowOn]}
                  onPress={() => setChecklist({ ...checklist, [item.key]: !on })}
                  activeOpacity={0.85}
                  testID={`preop-${item.key}`}
                >
                  <View style={[styles.cklBox, on && styles.cklBoxOn]}>
                    {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cklLabel, on && { color: COLORS.success }]}>{item.label[L] || item.label.en}</Text>
                    {item.hint?.[L] || item.hint?.en ? (
                      <Text style={styles.cklHint}>{item.hint[L] || item.hint.en}</Text>
                    ) : null}
                  </View>
                  {item.critical && (
                    <View style={styles.critTag}><Text style={styles.critText}>CRIT</Text></View>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={[styles.saveBtn, busy && styles.btnDisabled]} disabled={busy} onPress={saveChecklist} testID="preop-save">
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={16} color="#fff" />}
              <Text style={styles.saveBtnText}>Save checklist</Text>
            </TouchableOpacity>

            {sx.surgery_status === 'scheduled' && (
              <TouchableOpacity
                style={[styles.startBtn, !criticalDone && styles.btnDisabled]}
                disabled={!criticalDone || busy}
                onPress={() => transition('in_progress')}
                testID="preop-start"
              >
                <Ionicons name="play-circle" size={18} color="#fff" />
                <Text style={styles.startBtnText}>
                  {criticalDone ? 'Start surgery (mark in progress)' : 'Tick all critical items to start'}
                </Text>
              </TouchableOpacity>
            )}

            {sx.surgery_status === 'scheduled' && !!sx.scheduled_date && !!sx.patient_phone && (
              <TouchableOpacity
                style={[styles.waBtn, sendingReminder && styles.btnDisabled]}
                disabled={sendingReminder}
                onPress={sendWhatsAppReminder}
                testID="send-wa-reminder"
              >
                {sendingReminder ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                )}
                <Text style={styles.waBtnText}>Send WhatsApp reminder</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {tab === 'op' && (
          <View style={styles.card}>
            <View style={styles.preopHead}>
              <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
              <Text style={styles.preopHeadText}>Operative note</Text>
              <TouchableOpacity onPress={loadOpNoteTemplate} style={styles.tplBtn} testID="op-load-tpl">
                <Ionicons name="sparkles-outline" size={14} color={COLORS.primary} />
                <Text style={styles.tplBtnText}>Load template</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.opNoteInput}
              multiline
              value={opNoteDraft}
              onChangeText={setOpNoteDraft}
              placeholder="Write the operative note here. Use Load template to start from the curated skeleton."
              placeholderTextColor={COLORS.textDisabled}
              textAlignVertical="top"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.saveBtn, busy && styles.btnDisabled, { flex: 1 }]} disabled={busy} onPress={saveOpNote} testID="op-save">
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={16} color="#fff" />}
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              {sx.surgery_status === 'in_progress' && (
                <TouchableOpacity style={[styles.completeBtn, busy && styles.btnDisabled, { flex: 1 }]} disabled={busy} onPress={() => transition('completed')} testID="op-complete">
                  <Ionicons name="checkmark-circle" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>Mark completed</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {tab === 'postop' && (
          <View style={{ gap: 12 }}>
            <View style={styles.card}>
              <Text style={styles.preopHeadText}>New post-op note</Text>
              <PopField label="Vitals" value={popDraft.vitals} onChange={(v) => setPopDraft({ ...popDraft, vitals: v })} placeholder="BP 130/80, HR 78, RR 16, T 98.6°F, SpO2 99%" />
              <PopField label="Drug chart" value={popDraft.drug_chart} onChange={(v) => setPopDraft({ ...popDraft, drug_chart: v })} placeholder="Inj. Cefuroxime 1.5g 12h, Tab. Paracetamol 650mg 8h" />
              <PopField label="Progress" value={popDraft.progress} onChange={(v) => setPopDraft({ ...popDraft, progress: v })} placeholder="Pt. stable, urine clear, no clots" multiline />
              <PopField label="Complications" value={popDraft.complications} onChange={(v) => setPopDraft({ ...popDraft, complications: v })} placeholder="Nil" />
              <PopField label="Plan" value={popDraft.plan} onChange={(v) => setPopDraft({ ...popDraft, plan: v })} placeholder="Continue irrigation, remove catheter D2" />
              <TouchableOpacity style={[styles.saveBtn, savingPop && styles.btnDisabled, { marginTop: 12 }]} disabled={savingPop} onPress={addPostopNote} testID="pop-add">
                {savingPop ? <ActivityIndicator color="#fff" /> : <Ionicons name="add-circle" size={16} color="#fff" />}
                <Text style={styles.saveBtnText}>Add note</Text>
              </TouchableOpacity>
            </View>

            {(sx.postop_notes || []).map((n) => (
              <View key={n.note_id} style={styles.card}>
                <View style={styles.popHead}>
                  <Ionicons name="time" size={14} color={COLORS.textSecondary} />
                  <Text style={styles.popDate}>{n.date}</Text>
                  <Text style={styles.popAuthor}>{n.author_name || ''}</Text>
                  <TouchableOpacity onPress={() => removePostopNote(n.note_id)} testID={`pop-del-${n.note_id}`}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                  </TouchableOpacity>
                </View>
                {n.vitals ? <PopRow label="Vitals" value={n.vitals} /> : null}
                {n.drug_chart ? <PopRow label="Drugs" value={n.drug_chart} /> : null}
                {n.progress ? <PopRow label="Progress" value={n.progress} /> : null}
                {n.complications ? <PopRow label="Complications" value={n.complications} /> : null}
                {n.plan ? <PopRow label="Plan" value={n.plan} /> : null}
              </View>
            ))}
            {(!sx.postop_notes || sx.postop_notes.length === 0) && (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
                <Ionicons name="document-text-outline" size={28} color={COLORS.textDisabled} />
                <Text style={styles.empty}>No post-op notes yet. Add the first one above.</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TabPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tab, active && styles.tabActive]} activeOpacity={0.85}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PopField({ label, value, onChange, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <>
      <Text style={styles.popLabel}>{label}</Text>
      <TextInput
        style={[styles.popInput, multiline && { minHeight: 60 }]}
        multiline={multiline}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
      />
    </>
  );
}

function PopRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
      <Text style={styles.popRowLabel}>{label}:</Text>
      <Text style={styles.popRowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { ...FONTS.label, fontSize: 11, textTransform: 'capitalize' },
  tabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 6 },
  tab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', flex: 1, alignItems: 'center' },
  tabActive: { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary },
  tabText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, fontWeight: '600' },
  tabTextActive: { color: COLORS.primary },
  scroll: { padding: 16, paddingTop: 6 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  preopHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  preopHeadText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  cklRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: RADIUS.md, marginBottom: 6, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  cklRowOn: { backgroundColor: COLORS.success + '08', borderColor: COLORS.success + '50' },
  cklBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cklBoxOn: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  cklLabel: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, fontWeight: '500' },
  cklHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  critTag: { backgroundColor: COLORS.warning + '22', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginTop: 2 },
  critText: { ...FONTS.label, color: COLORS.warning, fontSize: 9, letterSpacing: 0.5 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill, marginTop: 12, minHeight: 44 },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: COLORS.success, borderRadius: RADIUS.pill, marginTop: 10, minHeight: 48 },
  startBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  waBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, backgroundColor: '#25D366', borderRadius: RADIUS.pill, marginTop: 8, minHeight: 44 },
  waBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: COLORS.success, borderRadius: RADIUS.pill, minHeight: 44 },
  btnDisabled: { opacity: 0.5 },
  opNoteInput: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, ...FONTS.body, color: COLORS.textPrimary, minHeight: 220, fontSize: 13, lineHeight: 19 },
  tplBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary + '15', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  tplBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  popLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 10, marginBottom: 4, fontSize: 11 },
  popInput: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 10, ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  popHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  popDate: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  popAuthor: { flex: 1, ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  popRowLabel: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12, minWidth: 90 },
  popRowValue: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 18 },
  empty: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 10, textAlign: 'center' },
});
