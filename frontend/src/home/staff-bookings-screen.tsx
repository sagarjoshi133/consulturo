/**
 * StaffBookingsScreen — Lightweight "Bookings" tab rendered for staff
 * roles inside the (tabs)/diseases.tsx slot. Provides:
 *   • Today's queue (top 12)
 *   • Status pills (Today / Upcoming)
 *   • Inline "Start Consultation" / "Join Video" CTA on confirmed
 *     bookings that are within ±15 min of slot time (Item 7).
 *   • Tap-through to the booking detail page.
 *
 * Fix 2026-05-29: was previously calling `/api/bookings` (which is a
 * POST-only endpoint and returned 405), so the list was silently
 * empty for staff. Now calls `/api/bookings/all` and maps the real
 * field names (`booking_id`, `booking_date`, `booking_time`,
 * `registration_no`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';
import { CockpitHeader, Card } from './cockpit-ui';
import { display12h, displayDate } from '../date';
import {
  shouldShowStartCta,
  isVideoBooking,
  getConsultationWindow,
} from '../consultation-window';

type Booking = {
  booking_id: string;
  patient_name?: string;
  patient_phone?: string;
  registration_no?: string;
  booking_date?: string;
  booking_time?: string;
  status?: string;
  mode?: string;
};

type Filter = 'today' | 'upcoming';
type ModeFilter = 'all' | 'in_person' | 'video';

export default function StaffBookingsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Filter>('today');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Tick every 30 s so the "Start Consultation" window stays live.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/bookings/all');
      const arr: Booking[] = Array.isArray(r.data) ? r.data : [];
      arr.sort((a, b) => {
        const dA = (a.booking_date || '') + (a.booking_time || '');
        const dB = (b.booking_date || '') + (b.booking_time || '');
        return dA.localeCompare(dB);
      });
      setItems(arr);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const visible = items
    .filter((x) => x.status !== 'cancelled' && x.status !== 'rejected')
    .filter((x) =>
      filter === 'today'
        ? (x.booking_date || '') === today
        : (x.booking_date || '') > today
    )
    .filter((x) =>
      modeFilter === 'all'
        ? true
        : modeFilter === 'video'
          ? isVideoBooking(x)
          : !isVideoBooking(x)
    );
  const view = visible.slice(0, 12);

  // Counts of *all* time-filtered bookings, then sliced by mode so
  // the mode-filter chips can show "Video (3)" / "In-person (5)"
  // without re-counting per-render.
  const timeWindow = items
    .filter((x) => x.status !== 'cancelled' && x.status !== 'rejected')
    .filter((x) =>
      filter === 'today'
        ? (x.booking_date || '') === today
        : (x.booking_date || '') > today
    );
  const videoCount = timeWindow.filter(isVideoBooking).length;
  const inPersonCount = timeWindow.length - videoCount;

  const todayCount = items.filter(
    (x) => (x.booking_date || '') === today && x.status !== 'cancelled' && x.status !== 'rejected',
  ).length;
  const upcomingCount = items.filter(
    (x) => (x.booking_date || '') > today && x.status !== 'cancelled' && x.status !== 'rejected',
  ).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <CockpitHeader subtitle="Bookings — today & upcoming" />

        {/* Filter pills — time window */}
        <View style={styles.pillRow}>
          <FilterPill
            label={`Today (${todayCount})`}
            active={filter === 'today'}
            onPress={() => setFilter('today')}
          />
          <View style={{ width: 8 }} />
          <FilterPill
            label={`Upcoming (${upcomingCount})`}
            active={filter === 'upcoming'}
            onPress={() => setFilter('upcoming')}
          />
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={styles.fullBtn}
            onPress={() => router.push('/dashboard?tab=bookings' as any)}
            activeOpacity={0.85}
            testID="staff-bookings-open-full"
          >
            <Ionicons name="open-outline" size={14} color="#fff" />
            <Text style={styles.fullBtnText}>Full view</Text>
          </TouchableOpacity>
        </View>

        {/* Filter pills — mode (Phase 5.14 segregation) */}
        <View style={[styles.pillRow, { marginTop: 8 }]}>
          <ModePill
            icon="apps"
            label={`All (${timeWindow.length})`}
            active={modeFilter === 'all'}
            onPress={() => setModeFilter('all')}
          />
          <View style={{ width: 6 }} />
          <ModePill
            icon="walk"
            label={`In-person (${inPersonCount})`}
            active={modeFilter === 'in_person'}
            onPress={() => setModeFilter('in_person')}
            tint="#2563EB"
          />
          <View style={{ width: 6 }} />
          <ModePill
            icon="videocam"
            label={`Video (${videoCount})`}
            active={modeFilter === 'video'}
            onPress={() => setModeFilter('video')}
            tint="#7C3AED"
          />
        </View>

        <Card style={{ padding: 0, marginTop: 12 }}>
          {loading ? (
            <View style={styles.emptyRow}>
              <ActivityIndicator color={COLORS.primary} />
              <Text style={styles.emptyText}>Loading…</Text>
            </View>
          ) : view.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>
                {filter === 'today' ? 'No bookings today' : 'No upcoming bookings'}
              </Text>
            </View>
          ) : (
            view.map((b, idx) => {
              const showStart = shouldShowStartCta(b);
              const isVideo = isVideoBooking(b);
              const win = getConsultationWindow(b.booking_date, b.booking_time);
              return (
                <View key={b.booking_id || idx} style={[styles.rowWrap, idx > 0 && styles.rowDivider]}>
                  <TouchableOpacity
                    onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: b.booking_id } } as any)}
                    activeOpacity={0.85}
                    style={styles.row}
                    testID={`staff-bk-row-${b.booking_id}`}
                  >
                    <View style={styles.timeBubble}>
                      <Text style={styles.timeText}>
                        {filter === 'today'
                          ? display12h(b.booking_time || '') || '--:--'
                          : displayDate(b.booking_date || '').slice(0, 5)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.name} numberOfLines={1}>
                        {b.patient_name || 'Patient'}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {b.registration_no ? `#${b.registration_no} · ` : ''}
                        {b.patient_phone || ''}
                        {b.mode ? ` · ${b.mode === 'online' || b.mode === 'video' ? 'video' : 'in-person'}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, statusStyle(b.status)]}>
                      <Text style={[styles.statusText, statusTextColor(b.status)]}>
                        {(b.status || '').toUpperCase() || '—'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  {showStart && (
                    <TouchableOpacity
                      style={styles.startBtn}
                      activeOpacity={0.85}
                      onPress={() =>
                        router.push({
                          pathname: '/bookings/[id]',
                          params: { id: b.booking_id, action: 'start' },
                        } as any)
                      }
                      testID={`staff-bk-start-${b.booking_id}`}
                    >
                      <Ionicons
                        name={isVideo ? 'videocam' : 'play-circle'}
                        size={14}
                        color="#FFFFFF"
                      />
                      <Text style={styles.startBtnText}>
                        {isVideo ? 'Join video' : 'Start consultation'}
                      </Text>
                      {!!win.label && (
                        <View style={styles.startBadge}>
                          <Text style={styles.startBadgeText}>{win.label}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </Card>

        {!loading && visible.length > 12 && (
          <TouchableOpacity
            style={styles.viewAllBtn}
            onPress={() => router.push('/dashboard?tab=bookings' as any)}
            activeOpacity={0.85}
          >
            <Text style={styles.viewAllText}>View all {visible.length} bookings</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * ModePill — secondary filter row showing mode (In-person / Video).
 * Uses a tinted background when active so the doctor's eye lands on
 * the active mode immediately. Phase 5.14 segregation work.
 */
function ModePill({
  icon, label, active, onPress, tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
  tint?: string;
}) {
  const accent = tint || COLORS.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.modePill,
        active && { backgroundColor: accent + '22', borderColor: accent },
      ]}
    >
      <Ionicons name={icon} size={12} color={active ? accent : COLORS.textSecondary} />
      <Text style={[
        styles.modePillText,
        active && { color: accent, fontWeight: '700' as any },
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

function statusStyle(status?: string) {
  if (status === 'confirmed') return { backgroundColor: '#0E7C8B22' };
  if (status === 'requested') return { backgroundColor: '#F59E0B22' };
  if (status === 'completed') return { backgroundColor: '#16A34A22' };
  if (status === 'rescheduled') return { backgroundColor: '#A855F722' };
  return { backgroundColor: COLORS.border };
}
function statusTextColor(status?: string) {
  if (status === 'confirmed') return { color: '#0E7C8B' };
  if (status === 'requested') return { color: '#F59E0B' };
  if (status === 'completed') return { color: '#16A34A' };
  if (status === 'rescheduled') return { color: '#A855F7' };
  return { color: COLORS.textSecondary };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 },
  pillRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillActive: {
    backgroundColor: COLORS.primary + '15',
    borderColor: COLORS.primary,
  },
  pillText: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  pillTextActive: {
    color: COLORS.primary,
  },

  // Phase 5.14 — mode segregation chips (In-person / Video)
  modePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  modePillText: {
    ...FONTS.body,
    fontSize: 11.5,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  fullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
  },
  fullBtnText: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  rowWrap: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  timeBubble: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    minWidth: 76,
    alignItems: 'center',
  },
  timeText: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  name: {
    ...FONTS.body,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  meta: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusText: {
    ...FONTS.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    justifyContent: 'center',
  },
  emptyText: {
    ...FONTS.body,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.success,
    marginHorizontal: 14,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    minHeight: 40,
  },
  startBtnText: {
    ...FONTS.bodyMedium,
    color: '#FFFFFF',
    fontSize: 13,
  },
  startBadge: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 2,
  },
  startBadgeText: {
    ...FONTS.label,
    color: '#FFFFFF',
    fontSize: 10,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 12,
  },
  viewAllText: {
    ...FONTS.bodyMedium,
    color: COLORS.primary,
    fontSize: 13,
  },
});
