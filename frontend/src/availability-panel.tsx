import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton } from './components';
import { TimeField } from './date-picker';
import { UnavailabilitySection } from './unavailability-section';
import { display12h } from './date';

const DAYS = [
  { key: 'mon', label: 'Mon', full: 'Monday' },
  { key: 'tue', label: 'Tue', full: 'Tuesday' },
  { key: 'wed', label: 'Wed', full: 'Wednesday' },
  { key: 'thu', label: 'Thu', full: 'Thursday' },
  { key: 'fri', label: 'Fri', full: 'Friday' },
  { key: 'sat', label: 'Sat', full: 'Saturday' },
  { key: 'sun', label: 'Sun', full: 'Sunday' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];
type Mode = 'in' | 'on';
type Slot = { start: string; end: string; location_id?: string };
type Availability = { off_days: DayKey[]; note?: string; [k: string]: any };
type Centre = { id: string; name: string; request_only?: boolean; active?: boolean };

export function AvailabilityPanel() {
  const [data, setData] = useState<Availability | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [mode, setMode] = useState<Mode>('in');
  const [centreId, setCentreId] = useState('');
  const [centreOpen, setCentreOpen] = useState(false);
  const [activeDay, setActiveDay] = useState<DayKey>('mon');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/availability/me');
      setData(data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
    try {
      const { data: cs } = await api.get('/clinic-settings');
      const locs: Centre[] = Array.isArray(cs?.locations) ? cs.locations : [];
      const active = locs.filter((l) => l.active !== false && !l.request_only && l.name);
      setCentres(active);
      setCentreId((prev) => prev || active[0]?.id || '');
    } catch {
      setCentres([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // ── window helpers scoped to current (mode, centre) ──────────────
  const winsFor = (day: DayKey): Slot[] => {
    if (!data) return [];
    if (mode === 'on') return data[`${day}_on`] || [];
    return (data[`${day}_in`] || []).filter((w: Slot) => (w.location_id || '') === centreId);
  };

  const setWins = (day: DayKey, wins: Slot[]) => {
    if (!data) return;
    if (mode === 'on') {
      setData({ ...data, [`${day}_on`]: wins.map((w) => ({ start: w.start, end: w.end })) });
      return;
    }
    const field = `${day}_in`;
    const others = (data[field] || []).filter((w: Slot) => (w.location_id || '') !== centreId);
    setData({
      ...data,
      [field]: [...others, ...wins.map((w) => ({ start: w.start, end: w.end, location_id: centreId }))],
    });
  };

  const isWorking = (day: DayKey) => winsFor(day).length > 0;

  const toggleWorking = (day: DayKey) => {
    if (isWorking(day)) setWins(day, []);
    else setWins(day, [{ start: '10:00', end: '13:00' }]);
  };

  const updateBlock = (day: DayKey, idx: number, key: 'start' | 'end', value: string) => {
    const wins = [...winsFor(day)];
    wins[idx] = { ...wins[idx], [key]: value };
    setWins(day, wins);
  };
  const addBlock = (day: DayKey) => setWins(day, [...winsFor(day), { start: '10:00', end: '13:00' }]);
  const removeBlock = (day: DayKey, idx: number) =>
    setWins(day, winsFor(day).filter((_, i) => i !== idx));

  const applyToAll = () => {
    const template = winsFor(activeDay).map((w) => ({ start: w.start, end: w.end }));
    if (!template.length) return;
    DAYS.forEach((d) => setWins(d.key, template.map((w) => ({ ...w }))));
    const where = mode === 'in' ? (centres.find((c) => c.id === centreId)?.name || 'this centre') : 'online';
    setMsg(`Applied ${DAYS.find((d) => d.key === activeDay)?.full}'s hours to all 7 days for ${where}. Tap Save to confirm.`);
    setTimeout(() => setMsg(''), 4000);
  };

  // Quick week presets — apply the selected day's hours to a common set
  // of days in one tap and close the rest. Falls back to a 10–1 block
  // when the selected day has no hours yet.
  const applyPreset = (label: string, openKeys: DayKey[]) => {
    let template = winsFor(activeDay).map((w) => ({ start: w.start, end: w.end }));
    if (!template.length) template = [{ start: '10:00', end: '13:00' }];
    DAYS.forEach((d) => setWins(d.key, openKeys.includes(d.key) ? template.map((w) => ({ ...w })) : []));
    setMsg(`Preset applied: ${label} (${template.map((w) => `${display12h(w.start)}–${display12h(w.end)}`).join(', ')}). Tap Save to confirm.`);
    setTimeout(() => setMsg(''), 4000);
  };
  const PRESETS: { label: string; keys: DayKey[] }[] = [
    { label: 'Mon–Sat', keys: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
    { label: 'Mon–Fri', keys: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    { label: 'All week', keys: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
  ];

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMsg('');
    try {
      // Working days are now driven purely by window presence; clear any
      // stale global off_days so they don't block a day that has slots.
      await api.put('/availability/me', { ...data, off_days: [] });
      setMsg('Saved! Patients see the updated slots immediately.');
      setTimeout(() => setMsg(''), 2500);
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'Could not save';
      Platform.OS === 'web'
        ? typeof window !== 'undefined' && window.alert(err)
        : Alert.alert('Error', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;
  if (!data) return <Text style={{ ...FONTS.body, color: COLORS.textSecondary }}>Could not load availability</Text>;

  const accent = mode === 'in' ? COLORS.primary : COLORS.whatsapp;
  const dayWins = winsFor(activeDay);
  const working = dayWins.length > 0;
  const selectedCentre = centres.find((c) => c.id === centreId);

  return (
    <>
      {/* ── Mode segmented control ─────────────────────────────────── */}
      <View style={styles.segment}>
        <TouchableOpacity
          onPress={() => { setMode('in'); setCentreOpen(false); }}
          style={[styles.segBtn, mode === 'in' && { backgroundColor: COLORS.primary }]}
          testID="avail-mode-in"
        >
          <Ionicons name="medical" size={15} color={mode === 'in' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.segTxt, mode === 'in' && { color: '#fff' }]}>In-person</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setMode('on'); setCentreOpen(false); }}
          style={[styles.segBtn, mode === 'on' && { backgroundColor: COLORS.whatsapp }]}
          testID="avail-mode-on"
        >
          <Ionicons name="logo-whatsapp" size={15} color={mode === 'on' ? '#fff' : COLORS.textSecondary} />
          <Text style={[styles.segTxt, mode === 'on' && { color: '#fff' }]}>Online</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.contextHint}>
        {mode === 'in'
          ? 'Set the hours you consult in person at each centre. Patients booking that centre see exactly these slots.'
          : 'Online consultation hours apply across all your centres.'}
      </Text>

      {/* ── Centre dropdown (in-person only) ───────────────────────── */}
      {mode === 'in' && (
        centres.length === 0 ? (
          <View style={styles.noCentre}>
            <Ionicons name="information-circle" size={16} color={COLORS.accent} />
            <Text style={styles.noCentreTxt}>Add a consultation centre first under Settings → Centres, then set its hours here.</Text>
          </View>
        ) : (
          <View style={{ zIndex: 10 }}>
            <Text style={styles.fieldLabel}>Centre</Text>
            <TouchableOpacity style={styles.dropdown} onPress={() => setCentreOpen((o) => !o)} testID="avail-centre-dropdown">
              <Ionicons name="location" size={16} color={COLORS.primary} />
              <Text style={styles.dropdownTxt} numberOfLines={1}>{selectedCentre?.name || 'Select centre'}</Text>
              <Ionicons name={centreOpen ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
            {centreOpen && (
              <View style={styles.dropdownList}>
                {centres.map((c) => {
                  const on = c.id === centreId;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.dropdownItem, on && { backgroundColor: COLORS.primary + '12' }]}
                      onPress={() => { setCentreId(c.id); setCentreOpen(false); }}
                      testID={`avail-centre-opt-${c.id}`}
                    >
                      <Text style={[styles.dropdownItemTxt, on && { color: COLORS.primary, fontFamily: 'DMSans_600SemiBold' }]} numberOfLines={1}>{c.name}</Text>
                      {on && <Ionicons name="checkmark" size={16} color={COLORS.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )
      )}

      {(mode === 'on' || centres.length > 0) && (
        <>
          {/* ── Quick week presets ───────────────────────────────────── */}
          <View style={styles.presetWrap}>
            <Text style={styles.presetLabel}>Quick set — uses {DAYS.find((d) => d.key === activeDay)?.full}'s hours:</Text>
            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => applyPreset(p.label, p.keys)}
                  style={[styles.presetChip, { borderColor: accent }]}
                  testID={`avail-preset-${p.label}`}
                >
                  <Ionicons name="flash" size={13} color={accent} />
                  <Text style={[styles.presetChipTxt, { color: accent }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Week overview chips ──────────────────────────────────── */}
          <View style={styles.weekRow}>
            {DAYS.map((d) => {
              const work = winsFor(d.key).length > 0;
              const sel = activeDay === d.key;
              return (
                <TouchableOpacity
                  key={d.key}
                  onPress={() => setActiveDay(d.key)}
                  style={[styles.dayChip, sel && { borderColor: accent, borderWidth: 2 }]}
                  testID={`avail-day-${d.key}`}
                >
                  <Text style={[styles.dayChipTxt, sel && { color: accent }]}>{d.label}</Text>
                  <View style={[styles.dayDot, { backgroundColor: work ? COLORS.success : COLORS.border }]} />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Selected day card ────────────────────────────────────── */}
          <View style={styles.dayCard}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{DAYS.find((d) => d.key === activeDay)?.full}</Text>
              <TouchableOpacity
                onPress={() => toggleWorking(activeDay)}
                style={[styles.toggleBtn, { backgroundColor: working ? COLORS.success : COLORS.textDisabled }]}
                testID="avail-day-toggle"
              >
                <Ionicons name={working ? 'checkmark-circle' : 'remove-circle'} size={15} color="#fff" />
                <Text style={styles.toggleTxt}>{working ? 'Open' : 'Closed'}</Text>
              </TouchableOpacity>
            </View>

            {!working ? (
              <Text style={styles.closedHint}>Closed on {DAYS.find((d) => d.key === activeDay)?.full}. Tap “Closed” above to add hours.</Text>
            ) : (
              <>
                {dayWins.map((s, i) => (
                  <View key={i} style={styles.blockRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.timeLbl}>From</Text>
                      <TimeField value={s.start} onChange={(v) => updateBlock(activeDay, i, 'start', v)} placeholder="HH:MM" style={{ marginTop: 0 }} />
                    </View>
                    <Text style={styles.arrow}>→</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.timeLbl}>To</Text>
                      <TimeField value={s.end} onChange={(v) => updateBlock(activeDay, i, 'end', v)} placeholder="HH:MM" style={{ marginTop: 0 }} />
                    </View>
                    {dayWins.length > 1 && (
                      <TouchableOpacity onPress={() => removeBlock(activeDay, i)} style={styles.removeBtn}>
                        <Ionicons name="close" size={16} color={COLORS.accent} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                <View style={styles.actionsRow}>
                  <TouchableOpacity onPress={() => addBlock(activeDay)} style={[styles.ghostBtn, { borderColor: accent }]}>
                    <Ionicons name="add" size={14} color={accent} />
                    <Text style={[styles.ghostTxt, { color: accent }]}>Add block</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={applyToAll} style={[styles.ghostBtn, { borderColor: accent }]} testID="avail-apply-all">
                    <Ionicons name="copy-outline" size={14} color={accent} />
                    <Text style={[styles.ghostTxt, { color: accent }]}>Apply to all days</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* ── Weekly summary ───────────────────────────────────────── */}
          <View style={styles.summary}>
            <Text style={styles.summaryHead}>{mode === 'in' ? (selectedCentre?.name || 'Centre') : 'Online'} · weekly hours</Text>
            {DAYS.map((d) => {
              const wins = winsFor(d.key);
              return (
                <View key={d.key} style={styles.summaryRow}>
                  <Text style={styles.summaryDay}>{d.full}</Text>
                  <Text style={[styles.summaryVal, !wins.length && { color: COLORS.textDisabled }]}>
                    {wins.length
                      ? wins.map((w) => `${display12h(w.start)} – ${display12h(w.end)}`).join(', ')
                      : 'Closed'}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      <Text style={styles.fieldLabel}>Note for patients (optional)</Text>
      <TextInput
        value={data.note || ''}
        onChangeText={(v) => setData({ ...data, note: v })}
        placeholder="e.g. Emergencies only on Sundays"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        multiline
      />

      {msg ? <Text style={styles.successMsg}>{msg}</Text> : null}

      <PrimaryButton
        title={saving ? 'Saving…' : 'Save Schedule'}
        onPress={save}
        disabled={saving}
        icon={<Ionicons name="save" size={18} color="#fff" />}
        style={{ marginTop: 20 }}
        testID="avail-save"
      />

      <View style={{ height: 1, backgroundColor: COLORS.border, marginTop: 28 }} />
      <UnavailabilitySection />
    </>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: COLORS.bg, borderRadius: RADIUS.pill, padding: 4, gap: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.pill },
  segTxt: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 13 },
  contextHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 12, lineHeight: 17 },

  presetWrap: { marginTop: 16 },
  presetLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, marginBottom: 8 },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1 },
  presetChipTxt: { ...FONTS.bodyMedium, fontSize: 12.5 },

  noCentre: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: COLORS.accent + '12', padding: 12, borderRadius: RADIUS.md, marginTop: 14 },
  noCentreTxt: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12.5, flex: 1, lineHeight: 18 },

  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 18, marginBottom: 6 },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 12 },
  dropdownTxt: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  dropdownList: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginTop: 6, overflow: 'hidden' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  dropdownItemTxt: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13.5, flex: 1 },

  weekRow: { flexDirection: 'row', gap: 6, marginTop: 16, justifyContent: 'space-between' },
  dayChip: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  dayChipTxt: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },

  dayCard: { marginTop: 14, backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 16 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill },
  toggleTxt: { color: '#fff', ...FONTS.bodyMedium, fontSize: 12 },
  closedHint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 12.5, marginTop: 12 },

  blockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 14 },
  timeLbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, marginBottom: 4 },
  arrow: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 16, marginBottom: 10 },
  removeBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginBottom: 2 },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 16, flexWrap: 'wrap' },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, borderWidth: 1, borderStyle: 'dashed' },
  ghostTxt: { ...FONTS.bodyMedium, fontSize: 12 },

  summary: { marginTop: 18, backgroundColor: COLORS.bg, borderRadius: RADIUS.md, padding: 14 },
  summaryHead: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  summaryDay: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12.5, width: 90 },
  summaryVal: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12.5, flex: 1, textAlign: 'right' },

  input: { marginTop: 0, backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, minHeight: 60, textAlignVertical: 'top' },
  successMsg: { ...FONTS.bodyMedium, color: COLORS.success, textAlign: 'center', marginTop: 14, fontSize: 13 },
});
