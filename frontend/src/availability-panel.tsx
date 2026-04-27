import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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

const DAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
] as const;

type DayKey = (typeof DAYS)[number]['key'];

type Slot = { start: string; end: string };

type Availability = {
  off_days: DayKey[];
  note?: string;
  [k: string]: any; // mon_in / mon_on etc.
};

export function AvailabilityPanel() {
  const [data, setData] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleOff = (day: DayKey) => {
    if (!data) return;
    const off = new Set(data.off_days || []);
    if (off.has(day)) off.delete(day);
    else off.add(day);
    setData({ ...data, off_days: Array.from(off) as DayKey[] });
  };

  const updateSlot = (day: DayKey, kind: 'in' | 'on', idx: number, key: 'start' | 'end', value: string) => {
    if (!data) return;
    const field = `${day}_${kind}`;
    const slots: Slot[] = [...(data[field] || [])];
    slots[idx] = { ...slots[idx], [key]: value };
    setData({ ...data, [field]: slots });
  };

  const addSlot = (day: DayKey, kind: 'in' | 'on') => {
    if (!data) return;
    const field = `${day}_${kind}`;
    const slots: Slot[] = [...(data[field] || []), { start: '10:00', end: '13:00' }];
    setData({ ...data, [field]: slots });
  };

  const removeSlot = (day: DayKey, kind: 'in' | 'on', idx: number) => {
    if (!data) return;
    const field = `${day}_${kind}`;
    const slots: Slot[] = (data[field] || []).filter((_: Slot, i: number) => i !== idx);
    setData({ ...data, [field]: slots });
  };

  const applyToAll = (day: DayKey, kind: 'in' | 'on') => {
    if (!data) return;
    const source: Slot[] = data[`${day}_${kind}`] || [];
    // Deep-copy slots so subsequent edits on one day don't mutate all others
    const snapshot = source.map((s) => ({ start: s.start, end: s.end }));
    const next: any = { ...data };
    DAYS.forEach((d) => {
      // Skip days marked as fully off to honour the user's off-day preference
      if ((data.off_days || []).includes(d.key)) return;
      next[`${d.key}_${kind}`] = snapshot.map((s) => ({ ...s }));
    });
    setData(next);
    setMsg(`${kind === 'in' ? 'In-person' : 'Online'} schedule copied to all working days. Tap "Save" to confirm.`);
    setTimeout(() => setMsg(''), 3500);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMsg('');
    try {
      await api.put('/availability/me', data);
      setMsg('Saved! Patients will see updated slots immediately.');
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

  const isOff = (data.off_days || []).includes(activeDay);
  const inSlots: Slot[] = data[`${activeDay}_in`] || [];
  const onSlots: Slot[] = data[`${activeDay}_on`] || [];

  return (
    <>
      <Text style={styles.hint}>Pick days you work (green), tap to mark off (red). Clinic working hours are 08:00–21:00.</Text>

      <View style={styles.daysRow}>
        {DAYS.map((d) => {
          const off = (data.off_days || []).includes(d.key);
          const selected = activeDay === d.key;
          return (
            <TouchableOpacity
              key={d.key}
              onPress={() => setActiveDay(d.key)}
              onLongPress={() => toggleOff(d.key)}
              delayLongPress={300}
              style={[
                styles.dayChip,
                off ? styles.dayOff : styles.dayOn,
                selected && styles.daySelected,
              ]}
              testID={`avail-day-${d.key}`}
            >
              <Text style={[styles.dayText, off && { color: '#fff' }, selected && { color: '#fff' }]}>{d.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.longPressHint}>Long-press a day to toggle full-day off (red) ↔ working (green).</Text>

      <View style={styles.dayCard}>
        <View style={styles.dayHeader}>
          <Text style={styles.dayTitle}>{DAYS.find((d) => d.key === activeDay)?.label}day schedule</Text>
          <TouchableOpacity onPress={() => toggleOff(activeDay)} style={[styles.toggleBtn, isOff ? styles.offBtn : styles.onBtn]}>
            <Ionicons name={isOff ? 'close-circle' : 'checkmark-circle'} size={16} color="#fff" />
            <Text style={styles.toggleText}>{isOff ? 'Off day' : 'Working'}</Text>
          </TouchableOpacity>
        </View>

        {!isOff && (
          <>
            <SlotGroup
              title="In-person (Clinic)"
              color={COLORS.primary}
              icon="medical"
              slots={inSlots}
              onChange={(i, k, v) => updateSlot(activeDay, 'in', i, k, v)}
              onAdd={() => addSlot(activeDay, 'in')}
              onRemove={(i) => removeSlot(activeDay, 'in', i)}
              onApplyAll={() => applyToAll(activeDay, 'in')}
            />
            <SlotGroup
              title="Online (WhatsApp)"
              color={COLORS.whatsapp}
              icon="logo-whatsapp"
              slots={onSlots}
              onChange={(i, k, v) => updateSlot(activeDay, 'on', i, k, v)}
              onAdd={() => addSlot(activeDay, 'on')}
              onRemove={(i) => removeSlot(activeDay, 'on', i)}
              onApplyAll={() => applyToAll(activeDay, 'on')}
            />
          </>
        )}
      </View>

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

      {/* ── Unavailability (per-date / recurring overrides) ─────────── */}
      <View style={{ height: 1, backgroundColor: COLORS.border, marginTop: 28 }} />
      <UnavailabilitySection />
    </>
  );
}

function SlotGroup({
  title,
  color,
  icon,
  slots,
  onChange,
  onAdd,
  onRemove,
  onApplyAll,
}: {
  title: string;
  color: string;
  icon: any;
  slots: Slot[];
  onChange: (i: number, k: 'start' | 'end', v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onApplyAll?: () => void;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon} size={14} color={color} />
        <Text style={[styles.groupTitle, { color }]}>{title}</Text>
        <Text style={styles.slotCount}>· {slots.length} slot{slots.length === 1 ? '' : 's'}</Text>
        {onApplyAll && slots.length > 0 && (
          <TouchableOpacity
            onPress={onApplyAll}
            style={[styles.applyAllBtn, { borderColor: color }]}
            testID={`avail-apply-all-${title.includes('Online') ? 'on' : 'in'}`}
          >
            <Ionicons name="copy-outline" size={12} color={color} />
            <Text style={[styles.applyAllText, { color }]}>Apply to all days</Text>
          </TouchableOpacity>
        )}
      </View>
      {slots.length === 0 ? (
        <Text style={styles.emptySlot}>No time blocks. Tap + to add.</Text>
      ) : (
        slots.map((s, i) => (
          <View key={i} style={styles.slotRow}>
            <TimeInput
              label="From"
              value={s.start}
              onChangeText={(v) => onChange(i, 'start', v)}
            />
            <Text style={styles.arrow}>→</Text>
            <TimeInput
              label="To"
              value={s.end}
              onChangeText={(v) => onChange(i, 'end', v)}
            />
            <TouchableOpacity onPress={() => onRemove(i)} style={styles.removeBtn}>
              <Ionicons name="close" size={16} color={COLORS.accent} />
            </TouchableOpacity>
          </View>
        ))
      )}
      <TouchableOpacity onPress={onAdd} style={[styles.addSlot, { borderColor: color }]}>
        <Ionicons name="add" size={14} color={color} />
        <Text style={[styles.addSlotText, { color }]}>Add time block</Text>
      </TouchableOpacity>
    </View>
  );
}

function TimeInput({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.timeLabel}>{label}</Text>
      <TimeField
        value={value}
        onChange={onChangeText}
        placeholder="HH:MM"
        style={{ marginTop: 0 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 12 },
  daysRow: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  dayChip: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  dayOn: { backgroundColor: COLORS.success + '18', borderColor: COLORS.success + '66' },
  dayOff: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  daySelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dayText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  longPressHint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginTop: 6, textAlign: 'center' },
  dayCard: { marginTop: 14, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  onBtn: { backgroundColor: COLORS.success },
  offBtn: { backgroundColor: COLORS.accent },
  toggleText: { color: '#fff', ...FONTS.label, fontSize: 10 },
  groupTitle: { ...FONTS.bodyMedium, fontSize: 13 },
  slotCount: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  emptySlot: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 12, marginTop: 6 },
  slotRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  arrow: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 16, marginBottom: 10 },
  removeBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginBottom: 2 },
  timeLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10 },
  timeInput: { marginTop: 4, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: 8, backgroundColor: COLORS.bg, ...FONTS.body, color: COLORS.textPrimary, textAlign: 'center' },
  addSlot: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderStyle: 'dashed' },
  addSlotText: { ...FONTS.bodyMedium, fontSize: 12 },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 20 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, minHeight: 60, textAlignVertical: 'top' },
  successMsg: { ...FONTS.bodyMedium, color: COLORS.success, textAlign: 'center', marginTop: 14, fontSize: 13 },
  applyAllBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1 },
  applyAllText: { ...FONTS.bodyMedium, fontSize: 10 },
});
