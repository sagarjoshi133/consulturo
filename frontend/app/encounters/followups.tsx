/**
 * Encounter Follow-ups — Clinical Core (Phase E).
 * Staff view of upcoming follow-up visits scheduled on encounters, with
 * a "Today" filter. Tapping a row opens the encounter.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, RefreshControl, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type Row = {
  encounter_id: string;
  patient_name: string;
  patient_phone?: string;
  chief_complaint?: string;
  diagnoses?: string[];
  follow_up_date?: string;
  follow_up_done_at?: string;
};

type Scope = 'upcoming' | 'today' | 'done' | 'overdue';

function fmtDate(v?: string): string {
  if (!v) return '';
  try {
    return new Date(v + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(v); }
}

function fmtDoneAt(v?: string): string {
  if (!v) return '';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

export default function FollowupsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string }>();
  const initialScope: Scope =
    params.scope === 'overdue' || params.scope === 'today' || params.scope === 'done'
      ? (params.scope as Scope)
      : 'upcoming';
  const [items, setItems] = useState<Row[]>([]);
  const [today, setToday] = useState('');
  const [scope, setScope] = useState<Scope>(initialScope);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [rescheduling, setRescheduling] = useState<Row | null>(null);
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (sc: Scope) => {
    try {
      const { data } = await api.get('/encounters/followups', { params: { scope: sc } });
      setItems(data?.items || []);
      setToday(data?.today || '');
      setErr('');
    } catch (e: any) {
      setErr(e?.response?.status === 403 ? 'Staff access required.' : 'Could not load follow-ups.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(scope); }, [scope, load]);

  const openReschedule = useCallback((row: Row) => {
    setNewDate(row.follow_up_date || '');
    setRescheduling(row);
  }, []);

  const saveReschedule = useCallback(async (dateStr: string | null) => {
    if (!rescheduling) return;
    setSaving(true);
    try {
      await api.patch(`/encounters/${rescheduling.encounter_id}`, { follow_up_date: dateStr || null });
      setRescheduling(null);
      setNewDate('');
      await load(scope);
    } catch {
      const msg = 'Could not update the follow-up. Please try again.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); }
      else Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  }, [rescheduling, scope, load]);

  const markDone = useCallback(async (row: Row) => {
    // optimistic: drop from the list immediately
    setItems((prev) => prev.filter((r) => r.encounter_id !== row.encounter_id));
    try {
      await api.post(`/encounters/${row.encounter_id}/followup/done`);
    } catch {
      await load(scope); // restore on failure
      const msg = 'Could not mark it done. Please try again.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); }
      else Alert.alert('Error', msg);
    }
  }, [scope, load]);

  const reopen = useCallback(async (row: Row) => {
    setItems((prev) => prev.filter((r) => r.encounter_id !== row.encounter_id));
    try {
      await api.post(`/encounters/${row.encounter_id}/followup/reopen`);
    } catch {
      await load(scope);
      const msg = 'Could not reopen it. Please try again.';
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert(msg); }
      else Alert.alert('Error', msg);
    }
  }, [scope, load]);

  const renderItem = ({ item }: { item: Row }) => {
    const isToday = item.follow_up_date === today;
    const isDone = scope === 'done';
    const isOverdue = scope === 'overdue';
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/encounters/${item.encounter_id}` as any)}
        testID={`fu-row-${item.encounter_id}`}
      >
        <View style={styles.cardTop}>
          <Text style={styles.name} numberOfLines={1}>{item.patient_name}</Text>
          {isDone ? (
            <View style={[styles.dateBadge, styles.dateBadgeDone]}>
              <Ionicons name="checkmark" size={12} color="#15803D" />
              <Text style={[styles.dateBadgeText, { color: '#15803D' }]}>
                {fmtDoneAt(item.follow_up_done_at) || 'Done'}
              </Text>
            </View>
          ) : isOverdue ? (
            <View style={[styles.dateBadge, styles.dateBadgeOverdue]}>
              <Ionicons name="alert-circle" size={12} color="#B91C1C" />
              <Text style={[styles.dateBadgeText, { color: '#B91C1C' }]}>
                {fmtDate(item.follow_up_date)}
              </Text>
            </View>
          ) : (
            <View style={[styles.dateBadge, isToday && styles.dateBadgeToday]}>
              <Text style={[styles.dateBadgeText, isToday && styles.dateBadgeTextToday]}>
                {isToday ? 'Today' : fmtDate(item.follow_up_date)}
              </Text>
            </View>
          )}
        </View>
        {!!item.patient_phone && <Text style={styles.meta}>{item.patient_phone}</Text>}
        {!!item.chief_complaint && <Text style={styles.complaint} numberOfLines={2}>{item.chief_complaint}</Text>}
        <View style={styles.chipsRow}>
          {(item.diagnoses || []).slice(0, 3).map((d) => (
            <View key={d} style={styles.dxChip}><Text style={styles.dxChipText}>{d}</Text></View>
          ))}
        </View>
        {isDone ? (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.rescheduleBtn}
              onPress={() => reopen(item)}
              testID={`fu-reopen-${item.encounter_id}`}
            >
              <Ionicons name="refresh" size={14} color={COLORS.primary} />
              <Text style={styles.rescheduleText}>Reopen</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.rescheduleBtn}
              onPress={() => openReschedule(item)}
              testID={`fu-reschedule-${item.encounter_id}`}
            >
              <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
              <Text style={styles.rescheduleText}>Reschedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => markDone(item)}
              testID={`fu-done-${item.encounter_id}`}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color="#15803D" />
              <Text style={styles.doneText}>Mark done</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters')} style={styles.backBtn} testID="fu-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Follow-ups</Text>
      </View>

      <View style={styles.tabsWrap}>
        {(['overdue', 'today', 'upcoming', 'done'] as const).map((sc) => (
          <TouchableOpacity
            key={sc}
            style={[styles.tab, scope === sc && styles.tabActive, sc === 'overdue' && scope === sc && styles.tabActiveOverdue]}
            onPress={() => setScope(sc)}
            testID={`fu-tab-${sc}`}
          >
            <Text style={[styles.tabText, scope === sc && styles.tabTextActive]}>
              {sc === 'today' ? 'Today' : sc === 'upcoming' ? 'Upcoming' : sc === 'done' ? 'Done' : 'Overdue'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : err ? (
        <View style={styles.center}><Text style={styles.errText}>{err}</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.encounter_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ListEmptyComponent={(
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={40} color={COLORS.textDisabled} />
              <Text style={styles.emptyText}>
                {scope === 'today' ? 'No follow-ups scheduled for today.'
                  : scope === 'done' ? 'No completed follow-ups yet.'
                  : scope === 'overdue' ? 'No overdue follow-ups — you\'re all caught up.'
                  : 'No upcoming follow-ups.'}
              </Text>
            </View>
          )}
        />
      )}

      <Modal
        visible={!!rescheduling}
        transparent
        animationType="slide"
        onRequestClose={() => setRescheduling(null)}
      >
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Reschedule follow-up</Text>
            {!!rescheduling && <Text style={styles.sheetSub}>{rescheduling.patient_name}</Text>}

            <View style={styles.chipsWrap}>
              {[
                { label: '1 week', days: 7 },
                { label: '2 weeks', days: 14 },
                { label: '1 month', days: 30 },
                { label: '3 months', days: 90 },
              ].map((opt) => {
                const val = (() => { const d = new Date(); d.setDate(d.getDate() + opt.days); return d.toISOString().slice(0, 10); })();
                const active = newDate === val;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.qChip, active && styles.qChipActive]}
                    onPress={() => setNewDate(val)}
                    testID={`fu-reschedule-chip-${opt.days}`}
                  >
                    <Text style={[styles.qChipText, active && styles.qChipTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.dateInput}
              placeholder="Follow-up date (YYYY-MM-DD)"
              placeholderTextColor={COLORS.textDisabled}
              value={newDate}
              onChangeText={setNewDate}
              autoCapitalize="none"
              testID="fu-reschedule-input"
            />

            <TouchableOpacity
              style={[styles.saveBtn, (!newDate || saving) && { opacity: 0.5 }]}
              disabled={!newDate || saving}
              onPress={() => saveReschedule(newDate)}
              testID="fu-reschedule-save"
            >
              {saving ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.saveBtnText}>Save new date</Text>}
            </TouchableOpacity>

            <View style={styles.sheetActions}>
              <TouchableOpacity onPress={() => saveReschedule(null)} disabled={saving} testID="fu-reschedule-clear">
                <Text style={styles.clearText}>Remove follow-up</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setRescheduling(null)} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary },
  tabsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabActiveOverdue: { backgroundColor: '#B91C1C', borderColor: '#B91C1C' },
  tabText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textSecondary },
  tabTextActive: { color: '#fff' },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 14 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border, gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary, flex: 1 },
  meta: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary },
  complaint: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  dateBadge: {
    backgroundColor: COLORS.bg, borderColor: COLORS.border, borderWidth: 1,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  dateBadgeToday: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  dateBadgeDone: { backgroundColor: '#DCFCE7', borderColor: '#86EFAC', flexDirection: 'row', alignItems: 'center', gap: 3 },
  dateBadgeOverdue: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', flexDirection: 'row', alignItems: 'center', gap: 3 },
  dateBadgeText: { ...FONTS.bodyMedium, fontSize: 11.5, color: COLORS.textSecondary },
  dateBadgeTextToday: { color: '#92400E' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dxChip: { backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  dxChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.primaryDark },
  rescheduleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    marginTop: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '12',
  },
  rescheduleText: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.primary },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  doneBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill,
    backgroundColor: '#DCFCE7',
  },
  doneText: { ...FONTS.bodyMedium, fontSize: 12.5, color: '#15803D' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 4 },
  sheetTitle: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  sheetSub: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, marginTop: -6 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border,
  },
  qChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  qChipText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textSecondary },
  qChipTextActive: { color: '#fff' },
  dateInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: COLORS.textPrimary,
    backgroundColor: COLORS.bg,
  },
  saveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 14, alignItems: 'center' },
  saveBtnText: { ...FONTS.bodyMedium, fontSize: 15, color: '#fff' },
  sheetActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  clearText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.accent || '#D64545' },
  cancelText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textSecondary },
});
