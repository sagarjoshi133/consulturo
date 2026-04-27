import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

type Entry = {
  entry_id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  volume_ml?: number | null;
  fluid_intake_ml?: number | null;
  urgency?: number | null;
  leak?: boolean;
  note?: string | null;
};

type DailySummary = {
  date: string;
  voids: number;
  total_volume: number;
  intake: number;
  leaks: number;
  max_urgency: number;
};

const URGENCY_LABELS = ['None', 'Mild', 'Moderate', 'Severe', 'Incont.'];
const URGENCY_COLORS = ['#16A34A', '#65A30D', '#D97706', '#EA580C', '#DC2626'];

function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function fmtDDMMYY(iso?: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y.slice(-2)}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10) || 0);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function BladderDiary() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, tRaw } = useI18n();
  const URGENCY_LABELS: string[] = tRaw('calc.bd.urgencyLabels') || ['None','Mild','Moderate','Severe','Incont.'];
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(toISODate(new Date()));
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Add-entry form
  const [entryDate, setEntryDate] = useState(toISODate(new Date()));
  const [entryTime, setEntryTime] = useState(nowHHMM());
  const [volume, setVolume] = useState('');
  const [intake, setIntake] = useState('');
  const [urgency, setUrgency] = useState<number | null>(null);
  const [leak, setLeak] = useState(false);
  const [note, setNote] = useState('');

  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toISODate(d);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/tools/bladder-diary', { params: { from_date: fromDate } });
      setEntries(data?.entries || []);
      setDaily(data?.daily || []);
    } catch {
      setEntries([]);
      setDaily([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate]);

  useFocusEffect(
    useCallback(() => {
      if (user) load();
      else setLoading(false);
    }, [load, user])
  );

  const resetForm = () => {
    const now = new Date();
    setEntryDate(toISODate(now));
    setEntryTime(nowHHMM());
    setVolume('');
    setIntake('');
    setUrgency(null);
    setLeak(false);
    setNote('');
    setErr('');
  };

  const addEntry = async () => {
    setErr('');
    if (!entryDate || !entryTime) {
      setErr(t('calc.bd.errRequired'));
      return;
    }
    const vol = volume ? parseInt(volume, 10) : null;
    const intk = intake ? parseInt(intake, 10) : null;
    if (!vol && !intk && !leak) {
      setErr(t('calc.bd.errAtLeast'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/tools/bladder-diary', {
        date: entryDate,
        time: entryTime,
        volume_ml: vol,
        fluid_intake_ml: intk,
        urgency,
        leak,
        note: note.trim() || undefined,
      });
      setShowAdd(false);
      resetForm();
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = (id: string) => {
    const doDel = async () => {
      try {
        await api.delete(`/tools/bladder-diary/${id}`);
        load();
      } catch {}
    };
    if (Platform.OS === 'web') {
      if (window.confirm(t('calc.bd.deleteConfirm'))) doDel();
    } else {
      Alert.alert(t('common.delete'), t('calc.bd.deleteConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: doDel },
      ]);
    }
  };

  const selectedEntries = useMemo(
    () => entries.filter((e) => e.date === selectedDate).sort((a, b) => (a.time < b.time ? -1 : 1)),
    [entries, selectedDate]
  );

  const selectedSummary = useMemo(
    () => daily.find((d) => d.date === selectedDate) || null,
    [daily, selectedDate]
  );

  const calendarCells = useMemo(() => {
    // 30-day back-looking grid (oldest first so scrolling up takes you into past)
    const cells: { date: string; summary: DailySummary | null }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = toISODate(d);
      const s = daily.find((x) => x.date === iso) || null;
      cells.push({ date: iso, summary: s });
    }
    return cells;
  }, [daily]);

  // Heatmap: voids count → colour intensity (0..≥8)
  const cellColor = (n: number) => {
    if (n === 0) return '#F1F5F5';
    if (n <= 3) return '#D1E9EE';
    if (n <= 6) return '#7FC7CF';
    if (n <= 9) return '#2F9AA8';
    return '#0A5E6B';
  };

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header router={router} t={t} />
        <View style={styles.gate}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.gateText}>{t('calc.bd.signInPrompt')}</Text>
          <TouchableOpacity onPress={() => router.push('/login' as any)} style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>{t('calc.signIn')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header router={router} t={t} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 90 }}>
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} />
        ) : (
          <>
            {/* 30-day heatmap */}
            <Text style={styles.sectionHdr}>{t('calc.bd.last30Days')}</Text>
            <Text style={styles.sectionSub}>{t('calc.bd.darkerMore')}</Text>
            <View style={styles.calendarWrap}>
              <View style={styles.weekHeader}>
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <Text key={i} style={styles.weekHeaderText}>{d}</Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarCells.map(({ date, summary }) => {
                  const day = new Date(date).getDate();
                  const voids = summary?.voids || 0;
                  const isSelected = date === selectedDate;
                  return (
                    <TouchableOpacity
                      key={date}
                      onPress={() => setSelectedDate(date)}
                      style={[
                        styles.calCell,
                        { backgroundColor: cellColor(voids) },
                        isSelected && styles.calCellSelected,
                      ]}
                      testID={`bd-cell-${date}`}
                    >
                      <Text style={[styles.calDay, voids > 6 && { color: '#fff' }, isSelected && { color: '#fff' }]}>{day}</Text>
                      {voids > 0 && (
                        <Text style={[styles.calVoids, voids > 6 && { color: 'rgba(255,255,255,0.9)' }, isSelected && { color: 'rgba(255,255,255,0.9)' }]}>{voids}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.legend}>
                {[0, 1, 4, 7, 10].map((n) => (
                  <View key={n} style={styles.legendItem}>
                    <View style={[styles.legendSquare, { backgroundColor: cellColor(n) }]} />
                    <Text style={styles.legendText}>{n === 0 ? '0' : n === 1 ? '1-3' : n === 4 ? '4-6' : n === 7 ? '7-9' : '10+'}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Selected day summary */}
            <View style={styles.selBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.selTitle}>{fmtDDMMYY(selectedDate)}</Text>
                {selectedSummary ? (
                  <Text style={styles.selSub}>
                    {selectedSummary.voids} {t('calc.bd.voids')} · {selectedSummary.total_volume} {t('calc.bd.mlOut')} · {selectedSummary.intake} {t('calc.bd.mlIn')} · {selectedSummary.leaks} {selectedSummary.leaks === 1 ? t('calc.bd.leak') : t('calc.bd.leaks')}
                  </Text>
                ) : (
                  <Text style={styles.selSub}>{t('calc.bd.emptyDay')}</Text>
                )}
              </View>
              <TouchableOpacity
                onPress={() => {
                  resetForm();
                  setEntryDate(selectedDate);
                  setShowAdd(true);
                }}
                style={styles.addBtn}
                testID="bd-add-entry"
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>{t('calc.bd.log')}</Text>
              </TouchableOpacity>
            </View>

            {selectedEntries.length === 0 ? (
              <View style={styles.empty}>
                <MaterialCommunityIcons name="notebook-outline" size={36} color={COLORS.textDisabled} />
                <Text style={styles.emptyText}>{t('calc.bd.tapToLog')}</Text>
              </View>
            ) : (
              selectedEntries.map((e) => (
                <View key={e.entry_id} style={styles.entryCard}>
                  <View style={styles.entryLeft}>
                    <Text style={styles.entryTime}>{to12h(e.time)}</Text>
                    {e.leak && (
                      <View style={styles.leakTag}>
                        <Text style={styles.leakTagText}>{t('calc.bd.leakTag')}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    {e.volume_ml != null && (
                      <Text style={styles.entryVolume}>
                        <Text style={{ fontWeight: '700' }}>{e.volume_ml} ml</Text> {t('calc.bd.dayVoided')}
                      </Text>
                    )}
                    {e.fluid_intake_ml != null && (
                      <Text style={styles.entryIntake}>+{e.fluid_intake_ml} ml {t('calc.bd.dayIntake')}</Text>
                    )}
                    {e.urgency != null && (
                      <Text style={[styles.entryUrgency, { color: URGENCY_COLORS[e.urgency] }]}>
                        {t('calc.bd.dayUrgencyLbl')}: {URGENCY_LABELS[e.urgency]}
                      </Text>
                    )}
                    {e.note && <Text style={styles.entryNote}>{e.note}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => removeEntry(e.entry_id)} style={styles.delBtn} testID={`bd-del-${e.entry_id}`}>
                    <Ionicons name="trash-outline" size={14} color={COLORS.accent} />
                  </TouchableOpacity>
                </View>
              ))
            )}

            <View style={styles.tip}>
              <Ionicons name="bulb-outline" size={14} color={COLORS.primary} />
              <Text style={styles.tipText}>{t('calc.bd.tip')}</Text>
            </View>
          </>
        )}
      </ScrollView>

      {/* Add-entry modal */}
      <Modal visible={showAdd} animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: COLORS.bg }}
        >
          <View style={styles.modalHead}>
            <TouchableOpacity onPress={() => setShowAdd(false)} testID="bd-close">
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('calc.bd.logEntry')}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>{t('calc.bd.date')}</Text>
                <TextInput
                  value={entryDate}
                  onChangeText={setEntryDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.input}
                  testID="bd-date"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>{t('calc.bd.time')}</Text>
                <TextInput
                  value={entryTime}
                  onChangeText={setEntryTime}
                  placeholder="e.g. 9:30 AM"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.input}
                  testID="bd-time"
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>{t('calc.bd.volumeVoided')}</Text>
                <TextInput
                  value={volume}
                  onChangeText={setVolume}
                  placeholder="250"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="number-pad"
                  style={styles.input}
                  testID="bd-volume"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>{t('calc.bd.fluidIntake')}</Text>
                <TextInput
                  value={intake}
                  onChangeText={setIntake}
                  placeholder="300"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="number-pad"
                  style={styles.input}
                  testID="bd-intake"
                />
              </View>
            </View>

            <Text style={[styles.lbl, { marginTop: 12 }]}>{t('calc.bd.urgency')}</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
              {URGENCY_LABELS.map((lbl, i) => (
                <TouchableOpacity
                  key={lbl}
                  onPress={() => setUrgency(urgency === i ? null : i)}
                  style={[styles.urgChip, urgency === i && { backgroundColor: URGENCY_COLORS[i], borderColor: URGENCY_COLORS[i] }]}
                  testID={`bd-urg-${i}`}
                >
                  <Text style={[styles.urgChipText, urgency === i && { color: '#fff' }]}>{lbl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.leakToggle, leak && { backgroundColor: COLORS.accent + '18', borderColor: COLORS.accent }]}
              onPress={() => setLeak((v) => !v)}
              testID="bd-leak"
            >
              <Ionicons name={leak ? 'checkbox' : 'square-outline'} size={20} color={leak ? COLORS.accent : COLORS.textSecondary} />
              <Text style={[styles.leakLabel, leak && { color: COLORS.accent, fontWeight: '600' }]}>{t('calc.bd.leakOccurred')}</Text>
            </TouchableOpacity>

            <Text style={[styles.lbl, { marginTop: 12 }]}>{t('calc.bd.note')}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. After morning coffee"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              testID="bd-note"
            />

            {err ? <Text style={{ color: COLORS.accent, ...FONTS.body, marginTop: 10 }}>{err}</Text> : null}

            <TouchableOpacity onPress={addEntry} disabled={saving} style={[styles.saveBig, saving && { opacity: 0.5 }]} testID="bd-save">
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={18} color="#fff" />}
              <Text style={styles.saveBigText}>{saving ? t('calc.bd.saving') : t('calc.bd.save')}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Header({ router, t }: { router: any; t: (k: string) => string }) {
  return (
    <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
      <SafeAreaView edges={['top']}>
        <View style={styles.heroRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>{t('calc.bd.title')}</Text>
            <Text style={styles.heroSub}>{t('calc.bd.subtitle')}</Text>
          </View>
          <LanguageDropdown testID="bd-lang" />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: 20, paddingHorizontal: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: Platform.OS === 'ios' ? 0 : 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  heroTitle: { ...FONTS.h2, color: '#fff', fontSize: 20 },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },

  gate: { alignItems: 'center', padding: 40 },
  gateText: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 14, textAlign: 'center', lineHeight: 20 },
  gateBtn: { marginTop: 20, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: RADIUS.pill },
  gateBtnText: { color: '#fff', ...FONTS.bodyMedium },

  sectionHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase' },
  sectionSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  calendarWrap: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: 10 },
  weekHeader: { flexDirection: 'row', marginBottom: 6 },
  weekHeaderText: { flex: 1, textAlign: 'center', ...FONTS.body, color: COLORS.textSecondary, fontSize: 10 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  calCell: { width: `${100 / 7 - 0.6}%`, aspectRatio: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  calCellSelected: { borderWidth: 2, borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  calDay: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.textPrimary },
  calVoids: { ...FONTS.body, fontSize: 9, color: COLORS.textPrimary, marginTop: 1 },
  legend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSquare: { width: 12, height: 12, borderRadius: 3 },
  legendText: { ...FONTS.body, fontSize: 10, color: COLORS.textSecondary },

  selBar: { flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 10, gap: 12 },
  selTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  selSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill },
  addBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },

  empty: { alignItems: 'center', padding: 30, gap: 8 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', fontSize: 12 },
  entryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  entryLeft: { alignItems: 'center', gap: 4, minWidth: 70 },
  entryTime: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  entryVolume: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  entryIntake: { ...FONTS.body, color: '#2563EB', fontSize: 11, marginTop: 2 },
  entryUrgency: { ...FONTS.bodyMedium, fontSize: 11, marginTop: 2 },
  entryNote: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4, fontStyle: 'italic' },
  leakTag: { backgroundColor: COLORS.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  leakTagText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 9 },
  delBtn: { padding: 6 },

  tip: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 20, padding: 10, backgroundColor: COLORS.primary + '0D', borderRadius: RADIUS.md },
  tipText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1, lineHeight: 17 },

  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: Platform.OS === 'ios' ? 50 : 16 },
  modalTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  lbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11 },
  input: { marginTop: 4, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, ...FONTS.body, color: COLORS.textPrimary },
  urgChip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  urgChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.textPrimary },
  leakToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  leakLabel: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  saveBig: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, padding: 14, borderRadius: RADIUS.md, marginTop: 22 },
  saveBigText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
});
