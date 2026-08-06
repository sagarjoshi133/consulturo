/**
 * OT Calendar — Phase 3.1.
 *
 * Lists scheduled surgeries for "Today" / "This Week" / "Custom range"
 * with status pills and tap-through to the schedule editor.
 *
 * Routes:
 *   /ot-calendar          → this screen (list)
 *   /ot-calendar/schedule → schedule wizard (new or edit)
 */
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  addDays,
  format,
  startOfWeek,
  endOfWeek,
  parseISO,
  isSameDay,
} from 'date-fns';
import api from '../../src/api';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { displayDateLong, display12h } from '../../src/date';
import { EmptyState } from '../../src/empty-state';

type Surgery = {
  surgery_id: string;
  patient_name?: string;
  patient_phone?: string;
  surgery_name?: string;
  procedure_key?: string;
  scheduled_date?: string;
  scheduled_time?: string;
  ot_room?: string;
  estimated_duration_min?: number;
  surgery_status?: string;
};

type Tab = 'today' | 'week' | 'custom';

const statusColorFor = (s?: string) =>
  s === 'in_progress' ? COLORS.warning :
  s === 'scheduled'   ? COLORS.primary :
  s === 'completed'   ? COLORS.success :
  COLORS.accent;

export default function OTCalendar() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('today');
  const [items, setItems] = useState<Surgery[]>([]);
  const [rooms, setRooms] = useState<string[]>(['OT-1']);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 30 s tick — keeps "in-progress" pill colour and any time-based
  // info on the list fresh without manual refresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setNowTick((x) => x + 1), 30000);
    return () => clearInterval(i);
  }, []);

  const range = useMemo(() => {
    const today = new Date();
    if (tab === 'today') {
      const d = format(today, 'yyyy-MM-dd');
      return { from: d, to: d };
    }
    if (tab === 'week') {
      return {
        from: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        to: format(endOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    }
    // Custom: ±14 days for now (we can wire up a real date-picker later)
    return {
      from: format(addDays(today, -14), 'yyyy-MM-dd'),
      to: format(addDays(today, 90), 'yyyy-MM-dd'),
    };
  }, [tab]);

  const load = useCallback(async () => {
    try {
      const [sched, roomsR] = await Promise.all([
        api.get('/surgeries/scheduled', { params: { from_date: range.from, to_date: range.to } }),
        api.get('/surgeries/ot-rooms'),
      ]);
      setItems(Array.isArray(sched.data) ? sched.data : []);
      const r = (roomsR.data && Array.isArray(roomsR.data.rooms)) ? roomsR.data.rooms : ['OT-1'];
      setRooms(r);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load OT calendar');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Group surgeries by date, preserving room ordering within each day.
  const grouped = useMemo(() => {
    const map = new Map<string, Surgery[]>();
    items.forEach((s) => {
      const k = s.scheduled_date || 'no-date';
      const arr = map.get(k) || [];
      arr.push(s);
      map.set(k, arr);
    });
    map.forEach((arr) =>
      arr.sort((a, b) =>
        (a.scheduled_time || '').localeCompare(b.scheduled_time || '') ||
        (a.ot_room || '').localeCompare(b.ot_room || ''),
      ),
    );
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const todayCount = items.filter((s) =>
    s.scheduled_date === format(new Date(), 'yyyy-MM-dd'),
  ).length;
  const inProgressCount = items.filter((s) => s.surgery_status === 'in_progress').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="ot-back">
          <Ionicons name="chevron-back" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>OT Schedule</Text>
          <Text style={styles.subtitle}>
            {items.length} surgeries · {todayCount} today · {inProgressCount} in progress
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/ot-calendar/schedule' as any)}
          style={styles.fab}
          testID="ot-schedule-new"
        >
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.fabText}>Schedule</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TabPill label="Today" active={tab === 'today'} onPress={() => setTab('today')} />
        <TabPill label="This Week" active={tab === 'week'} onPress={() => setTab('week')} />
        <TabPill label="Upcoming" active={tab === 'custom'} onPress={() => setTab('custom')} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={COLORS.primary} /></View>
        ) : grouped.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No surgeries scheduled"
            subtitle={
              tab === 'today' ? 'No procedures lined up for today.' :
              tab === 'week'  ? 'This week is open — schedule new procedures from booking detail or via the + Schedule button.' :
                                'Upcoming queue is empty.'
            }
            ctaLabel="Schedule a surgery"
            onCta={() => router.push('/ot-calendar/schedule' as any)}
            testID="ot-empty"
          />
        ) : (
          grouped.map(([dateKey, list]) => (
            <View key={dateKey} style={styles.dayBlock}>
              <View style={styles.dayHead}>
                <Ionicons name="calendar" size={14} color={COLORS.primary} />
                <Text style={styles.dayHeadText}>{displayDateLong(dateKey)}</Text>
                <View style={styles.dayCount}><Text style={styles.dayCountText}>{list.length}</Text></View>
              </View>
              {list.map((s) => {
                const sColor = statusColorFor(s.surgery_status);
                return (
                  <TouchableOpacity
                    key={s.surgery_id}
                    style={styles.row}
                    onPress={() => router.push({ pathname: '/surgeries/[id]', params: { id: s.surgery_id } } as any)}
                    activeOpacity={0.85}
                    testID={`ot-row-${s.surgery_id}`}
                  >
                    <View style={styles.timeCol}>
                      <Text style={styles.timeText}>{display12h(s.scheduled_time || '') || '—'}</Text>
                      <Text style={styles.durText}>{s.estimated_duration_min || 60}m</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.patient} numberOfLines={1}>
                        {s.patient_name || 'Unnamed patient'}
                      </Text>
                      <Text style={styles.proc} numberOfLines={1}>
                        {s.surgery_name || s.procedure_key || 'Procedure'}
                      </Text>
                      <View style={styles.metaRow}>
                        <View style={styles.roomBadge}>
                          <Ionicons name="business" size={10} color={COLORS.textSecondary} />
                          <Text style={styles.roomBadgeText}>{s.ot_room || 'OT-1'}</Text>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: sColor + '22' }]}>
                          <Text style={[styles.statusText, { color: sColor }]}>
                            {(s.surgery_status || 'scheduled').replace('_', ' ')}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
        <View style={{ height: 80 }} />
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 2, fontSize: 12 },
  fab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.pill,
  },
  fabText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff',
  },
  tabActive: { backgroundColor: COLORS.primary + '15', borderColor: COLORS.primary },
  tabText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: COLORS.primary },
  scroll: { padding: 16, paddingTop: 4 },
  loading: { padding: 60, alignItems: 'center' },
  dayBlock: { marginBottom: 18 },
  dayHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '0A', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.md,
  },
  dayHeadText: { ...FONTS.bodyMedium, color: COLORS.primary, flex: 1, fontSize: 13 },
  dayCount: {
    backgroundColor: COLORS.primary, paddingHorizontal: 8, paddingVertical: 1,
    borderRadius: 10,
  },
  dayCountText: { ...FONTS.label, color: '#fff', fontSize: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, marginTop: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  timeCol: {
    alignItems: 'center', backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, minWidth: 64,
  },
  timeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  durText: { ...FONTS.label, color: COLORS.primary + 'AA', fontSize: 10, marginTop: 2 },
  patient: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  proc: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 2, fontSize: 12 },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  roomBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.border + '88', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
  },
  roomBadgeText: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  statusText: { ...FONTS.label, fontSize: 10, textTransform: 'capitalize' },
});
