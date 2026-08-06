/**
 * UnavailabilitySection — embedded inside AvailabilityPanel.
 *
 * Lets owner / doctor / Full-Access users mark specific dates or recurring
 * weekdays as unavailable. The booking screen automatically hides slots on
 * those days/time-windows because GET /api/availability/slots filters them
 * out — no extra wiring needed elsewhere.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, isValid } from 'date-fns';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { Skeleton } from './skeleton';
import { DateField, TimeField } from './date-picker';
import { display12h } from './date';
import { PrimaryButton, SecondaryButton } from './components';

type Rule = {
  id: string;
  date: string | null;
  all_day: boolean;
  start_time: string | null;
  end_time: string | null;
  recurring_weekly: boolean;
  day_of_week: number | null;
  reason: string | null;
  created_by_name?: string | null;
};

const WEEKDAY_LABEL: Record<number, string> = {
  0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun',
};

function describeRule(r: Rule): string {
  const when = r.recurring_weekly && r.day_of_week !== null
    ? `Every ${WEEKDAY_LABEL[r.day_of_week] ?? '?'}`
    : r.date
    ? (() => {
        try { return format(parseISO(r.date as string), 'EEE, d MMM yyyy'); }
        catch { return r.date as string; }
      })()
    : 'Unknown';
  const window = r.all_day
    ? 'All day'
    : `${display12h(r.start_time || '')} – ${display12h(r.end_time || '')}`;
  return `${when} · ${window}`;
}

export function UnavailabilitySection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState('');           // DD-MM-YYYY (DateField format)
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('13:00');
  const [recurring, setRecurring] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get('/unavailabilities');
      setRules(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Could not load unavailability rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setDate(''); setAllDay(true); setStartTime('10:00'); setEndTime('13:00');
    setRecurring(false); setReason(''); setShowForm(false);
  };

  const submit = async () => {
    if (!date) {
      Alert.alert('Pick a date', 'Please choose a date for the unavailability.');
      return;
    }
    let isoDate = '';
    try {
      const [dd, mm, yyyy] = date.split('-');
      isoDate = `${yyyy}-${mm}-${dd}`;
      const d = parseISO(isoDate);
      if (!isValid(d)) throw new Error('bad date');
    } catch {
      Alert.alert('Invalid date', 'Please pick a valid date.');
      return;
    }
    if (!allDay && (!startTime || !endTime)) {
      Alert.alert('Pick a time range', 'Please set both start and end times.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/unavailabilities', {
        date: isoDate,
        all_day: allDay,
        start_time: allDay ? null : startTime,
        end_time: allDay ? null : endTime,
        recurring_weekly: recurring,
        reason: reason.trim() || null,
      });
      resetForm();
      load();
    } catch (e: any) {
      Alert.alert('Could not save', e?.response?.data?.detail || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = (rule: Rule) => {
    Alert.alert(
      'Remove unavailability?',
      `${describeRule(rule)}\n\nPatients will be able to book this slot again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/unavailabilities/${rule.id}`);
              setRules((prev) => prev.filter((r) => r.id !== rule.id));
            } catch (e: any) {
              Alert.alert('Failed', e?.response?.data?.detail || 'Please try again.');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={{ marginTop: 24 }}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Unavailability</Text>
          <Text style={styles.sub}>
            Block specific dates or time-ranges. Booking screens hide these automatically.
          </Text>
        </View>
        {!showForm && (
          <TouchableOpacity
            onPress={() => setShowForm(true)}
            style={styles.addBtn}
            testID="unavail-add-btn"
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {showForm && (
        <View style={styles.formCard} testID="unavail-form">
          <DateField
            label="Date"
            value={date}
            onChange={setDate}
            min={new Date()}
            max={(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return d; })()}
            testID="unavail-date"
          />

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>All day</Text>
              <Text style={styles.toggleHint}>Block the entire day</Text>
            </View>
            <Switch
              value={allDay}
              onValueChange={setAllDay}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor="#fff"
              testID="unavail-allday"
            />
          </View>

          {!allDay && (
            <View style={styles.timeRow}>
              <View style={{ flex: 1 }}>
                <TimeField label="Start" value={startTime} onChange={setStartTime} testID="unavail-start" />
              </View>
              <View style={{ flex: 1 }}>
                <TimeField label="End" value={endTime} onChange={setEndTime} testID="unavail-end" />
              </View>
            </View>
          )}

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Repeat every week</Text>
              <Text style={styles.toggleHint}>
                {date ? (() => {
                  try {
                    const [dd, mm, yyyy] = date.split('-');
                    const d = parseISO(`${yyyy}-${mm}-${dd}`);
                    return isValid(d) ? `e.g. every ${format(d, 'EEEE')}` : 'Pick a date first';
                  } catch { return ''; }
                })() : 'Pick a date first'}
              </Text>
            </View>
            <Switch
              value={recurring}
              onValueChange={setRecurring}
              trackColor={{ false: COLORS.border, true: COLORS.primary }}
              thumbColor="#fff"
              testID="unavail-recurring"
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Reason (optional)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. Conference, surgery day, personal leave"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            testID="unavail-reason"
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Cancel" onPress={resetForm} testID="unavail-cancel" />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={submitting ? 'Saving…' : 'Save'}
                onPress={submit}
                disabled={submitting}
                testID="unavail-save"
              />
            </View>
          </View>
        </View>
      )}

      <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Active rules</Text>

      {loading && rules.length === 0 ? (
        <View style={{ marginTop: 8, gap: 10 }}>
          {[0, 1, 2].map((i) => (<Skeleton key={i} w="100%" h={62} br={12} />))}
        </View>
      ) : error ? (
        <View style={[styles.row, { borderColor: COLORS.accent + '66' }]}>
          <Ionicons name="alert-circle" size={18} color={COLORS.accent} />
          <Text style={[styles.rowText, { color: COLORS.accent }]}>{error}</Text>
        </View>
      ) : rules.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={28} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>No upcoming unavailability</Text>
          <Text style={styles.emptyHint}>Doctor is available on every working day.</Text>
        </View>
      ) : (
        rules.map((rule) => (
          <View key={rule.id} style={styles.row} testID={`unavail-row-${rule.id}`}>
            <Ionicons
              name={rule.recurring_weekly ? 'repeat' : 'calendar'}
              size={18}
              color={COLORS.primary}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.rowTitle}>{describeRule(rule)}</Text>
              {rule.reason ? <Text style={styles.rowSub}>{rule.reason}</Text> : null}
              {rule.created_by_name ? (
                <Text style={styles.rowMuted}>by {rule.created_by_name}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={() => remove(rule)} style={styles.delBtn} testID={`unavail-del-${rule.id}`}>
              <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center' },
  heading: { ...FONTS.h3, color: COLORS.textPrimary },
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12, lineHeight: 16 },
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 8 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  formCard: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 12, marginBottom: 6 },
  input: {
    ...FONTS.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 10,
  },
  toggleLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  toggleHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  timeRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  rowText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, marginLeft: 8 },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowMuted: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginTop: 2 },
  delBtn: { padding: 8 },
  empty: {
    alignItems: 'center',
    paddingVertical: 28,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 8,
  },
  emptyText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, marginTop: 6 },
  emptyHint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 12, marginTop: 2 },
});

export default UnavailabilitySection;
