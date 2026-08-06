/**
 * Patient Timeline — Wave 1 · B
 *
 * Chronological feed of every event for one patient phone number:
 * bookings · prescriptions · surgeries · receipts · IPD admissions ·
 * medical certificates · lab results · IPSS scores.
 *
 * Backend: GET /api/patients/timeline?phone=...
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { format, parseISO, isValid } from 'date-fns';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useSafeBack } from '../src/use-safe-back';
import { fetchTimeline, TimelineEvent } from '../src/wave1/api';
import { SkeletonRow } from '../src/skeleton';
import { EmptyState } from '../src/empty-state';

const TYPE_META: Record<string, { icon: any; color: string; label: string }> = {
  booking:      { icon: 'calendar',          color: '#0284C7', label: 'Booking' },
  prescription: { icon: 'medkit',            color: '#7C3AED', label: 'Rx' },
  surgery:      { icon: 'cut',               color: '#DC2626', label: 'Surgery' },
  receipt:      { icon: 'cash',              color: '#059669', label: 'Receipt' },
  ipd:          { icon: 'bed',               color: '#D97706', label: 'IPD' },
  medcert:      { icon: 'document-text',     color: '#7C2D12', label: 'Med Cert' },
  lab:          { icon: 'flask',             color: '#9333EA', label: 'Lab' },
  ipss:         { icon: 'analytics',         color: '#0891B2', label: 'IPSS' },
};

const FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'booking',      label: 'Bookings' },
  { key: 'prescription', label: 'Rx' },
  { key: 'surgery',      label: 'Surgery' },
  { key: 'ipd',          label: 'IPD' },
  { key: 'lab',          label: 'Labs' },
  { key: 'receipt',      label: 'Billing' },
];

export default function PatientTimelineScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ phone?: string; name?: string }>();
  const phone = (params?.phone as string) || '';
  const name = (params?.name as string) || 'Patient';
  const safeBack = useSafeBack(`/patient-db/${encodeURIComponent(phone)}` as any);

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!phone) return;
    try {
      const ev = await fetchTimeline(phone);
      setEvents(ev);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [phone]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.type === filter);

  const counts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="tl-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>Timeline</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{name} · {phone}</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={{ padding: 16 }}>
          <SkeletonRow lines={2} />
          <View style={{ height: 14 }} />
          <SkeletonRow lines={2} />
          <View style={{ height: 14 }} />
          <SkeletonRow lines={2} />
          <View style={{ height: 14 }} />
          <SkeletonRow lines={2} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* Summary chips */}
          <View style={styles.summary}>
            <Text style={styles.summaryNum}>{events.length}</Text>
            <Text style={styles.summaryLbl}>Total events</Text>
            <View style={styles.summaryChips}>
              {Object.entries(counts).slice(0, 4).map(([k, n]) => {
                const m = TYPE_META[k] || TYPE_META.booking;
                return (
                  <View key={k} style={[styles.summaryChip, { borderColor: m.color + '44' }]}>
                    <Ionicons name={m.icon} size={11} color={m.color} />
                    <Text style={[styles.summaryChipText, { color: m.color }]}>{m.label} {n}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Filter pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                  testID={`tl-filter-${f.key}`}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Timeline */}
          <View style={{ marginTop: 14 }}>
            {filtered.length === 0 ? (
              <EmptyState
                icon="time-outline"
                title={filter === 'all' ? 'No events yet for this patient' : 'No events for this filter'}
                subtitle={filter === 'all'
                  ? 'Bookings, prescriptions, lab values and other records appear here as you create them.'
                  : 'Try a different filter or check back later.'}
              />
            ) : (
              filtered.map((ev, i) => (
                <TimelineRow
                  key={`${ev.type}-${ev.ref_id || i}`}
                  ev={ev}
                  isFirst={i === 0}
                  isLast={i === filtered.length - 1}
                  onOpen={() => ev.link && router.push(ev.link as any)}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TimelineRow({
  ev,
  isFirst,
  isLast,
  onOpen,
}: {
  ev: TimelineEvent;
  isFirst: boolean;
  isLast: boolean;
  onOpen: () => void;
}) {
  const meta = TYPE_META[ev.type] || TYPE_META.booking;
  const ts = fmtTs(ev.ts);
  return (
    <View style={styles.tlRow}>
      {/* Rail */}
      <View style={styles.tlRail}>
        {!isFirst ? <View style={styles.tlLineTop} /> : <View style={{ height: 18 }} />}
        <View style={[styles.tlDot, { backgroundColor: meta.color }]}>
          <Ionicons name={meta.icon} size={12} color="#fff" />
        </View>
        {!isLast ? <View style={styles.tlLine} /> : null}
      </View>

      {/* Card */}
      <TouchableOpacity
        onPress={onOpen}
        disabled={!ev.link}
        style={styles.tlCard}
        activeOpacity={ev.link ? 0.7 : 1}
      >
        <View style={styles.tlCardHead}>
          <Text style={[styles.tlBadge, { color: meta.color, borderColor: meta.color + '55' }]}>
            {meta.label}
          </Text>
          {ts ? <Text style={styles.tlTs}>{ts}</Text> : null}
        </View>
        <Text style={styles.tlTitle} numberOfLines={2}>{ev.title}</Text>
        {ev.subtitle ? (
          <Text style={styles.tlSub} numberOfLines={3}>{ev.subtitle}</Text>
        ) : null}
        {ev.link ? (
          <View style={styles.tlOpenChip}>
            <Text style={[styles.tlOpenText, { color: meta.color }]}>Open</Text>
            <Ionicons name="chevron-forward" size={12} color={meta.color} />
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

function fmtTs(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = parseISO(ts);
    if (isValid(d)) return format(d, 'dd MMM yyyy · HH:mm');
  } catch {}
  return String(ts);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  center: { padding: 40, alignItems: 'center', justifyContent: 'center' },

  summary: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  summaryNum: { ...FONTS.h2, fontSize: 26, color: COLORS.primary },
  summaryLbl: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: -2 },
  summaryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  summaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff',
    borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  summaryChipText: { ...FONTS.bodyMedium, fontSize: 11 },

  filterPill: {
    backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterPillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterPillText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  filterPillTextActive: { color: '#fff' },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 36, alignItems: 'center', gap: 6,
  },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },

  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 24, alignItems: 'center' },
  tlLineTop: { width: 2, flex: 0, height: 18, backgroundColor: COLORS.border },
  tlLine: { width: 2, flex: 1, backgroundColor: COLORS.border, minHeight: 14 },
  tlDot: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
  tlCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 11,
    marginBottom: 10,
    gap: 4,
  },
  tlCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tlBadge: {
    ...FONTS.bodyMedium,
    fontSize: 10,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, borderWidth: 1,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  tlTs: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11 },
  tlTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  tlSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  tlOpenChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    alignSelf: 'flex-end',
    marginTop: 2,
  },
  tlOpenText: { ...FONTS.bodyMedium, fontSize: 11 },
});
