/**
 * StaffHome — Lean cockpit for non-owner team members (partner /
 * doctor / assistant / reception / nursing).
 *
 * Focused on the daily workflow without owner administration features:
 *   • KPI strip: Today's bookings + Pending consults
 *   • Quick actions: New Booking · New Rx · New Note · My Consults
 *   • Today's appointments list (top 3)
 *
 * Reuses /api/profile/quick-stats and /api/bookings — same as the
 * owner cockpit but skips analytics, alerts and broadcast.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';
import {
  KPITile,
  ActionTile,
  SectionHeader,
  Card,
  QuickActionsRow,
} from './cockpit-ui';
import PatientHero from './patient-hero';
import AssistantBubble from '../assistant-bubble';

type QuickStats = {
  role: string;
  tiles: { label: string; value: number; icon: string; color: string }[];
};

type Booking = {
  id: string;
  patient_name?: string;
  patient_phone?: string;
  booking_date?: string;
  slot?: string;
  start_time?: string;
  status?: string;
};

export default function StaffHome({
  onLangPress,
  langBadge,
}: {
  onLangPress?: () => void;
  langBadge?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bubbleBottom = Platform.OS === 'web' ? 24 : 64 + insets.bottom + 20; // tab bar (64) + safe area + padding
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [todayList, setTodayList] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.allSettled([
        api.get('/profile/quick-stats'),
        api.get('/bookings/all'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (b.status === 'fulfilled') {
        const raw = b.value.data;
        const arr: Booking[] = Array.isArray(raw) ? raw : raw?.items || [];
        const today = new Date().toLocaleDateString('en-CA', {
          timeZone: 'Asia/Kolkata',
        });
        const filtered = arr
          .filter((x) => (x.booking_date || '').startsWith(today))
          .filter((x) => x.status !== 'cancelled' && x.status !== 'rejected')
          .sort((x, y) => (x.start_time || x.slot || '').localeCompare(y.start_time || y.slot || ''))
          .slice(0, 3);
        setTodayList(filtered);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const todayCount = stats?.tiles?.find((x) => x.label === 'Today')?.value ?? '—';
  const pendingCount = stats?.tiles?.find((x) => x.label === 'Pending')?.value ?? '—';

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const SV: any = Animated.ScrollView;

  return (
    <View style={styles.safe}>
      <SV
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <PatientHero scrollY={scrollY} />

        {/* Floating quick-actions card — staff shortcuts. */}
        <QuickActionsRow
          items={[
            {
              key: 'st-qa-booking',
              label: 'New Booking',
              icon: 'calendar-plus',
              iconLib: 'mci',
              color: '#0E7C8B',
              onPress: () => router.push('/(tabs)/book' as any),
            },
            {
              key: 'st-qa-consult',
              label: 'Consult',
              icon: 'medkit',
              color: '#16A34A',
              onPress: () => router.push('/dashboard?tab=consultations' as any),
            },
            {
              key: 'st-qa-rx',
              label: 'New Rx',
              icon: 'document-text',
              color: '#0EA5E9',
              onPress: () => router.push('/dashboard?tab=prescriptions' as any),
            },
            {
              key: 'st-qa-schedule',
              label: 'Schedule Surgery',
              icon: 'calendar-clock',
              iconLib: 'mci',
              color: '#DC2626',
              onPress: () => router.push('/ot-calendar/schedule' as any),
            },
            {
              key: 'st-qa-ot',
              label: 'OT Schedule',
              icon: 'medical-bag',
              iconLib: 'mci',
              color: '#A855F7',
              onPress: () => router.push('/ot-calendar' as any),
            },
            {
              key: 'st-qa-patients',
              label: 'Patients',
              icon: 'people',
              color: '#7C3AED',
              onPress: () => router.push('/(tabs)/tools' as any),
            },
          ]}
        />

        <View style={styles.contentPad}>
          <SectionHeader title="Your day" />

          {/* KPI strip (2 tiles wide each) */}
          <View style={styles.kpiRow}>
          <KPITile
            label="Today"
            value={todayCount}
            icon="calendar"
            color="#0E7C8B"
            onPress={() => router.push('/dashboard?tab=bookings' as any)}
            loading={!stats}
            testID="staff-kpi-today"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Pending"
            value={pendingCount}
            icon="hourglass"
            color="#F59E0B"
            onPress={() => router.push('/dashboard?tab=consultations' as any)}
            loading={!stats}
            testID="staff-kpi-pending"
          />
        </View>

        {/* Quick actions */}
        <SectionHeader title="Quick actions" />
        <View style={styles.actionsGrid}>
          <ActionTile
            label="New Booking"
            icon="calendar-plus"
            iconLib="mci"
            color="#0E7C8B"
            onPress={() => router.push('/(tabs)/book' as any)}
            testID="staff-act-booking"
          />
          <ActionTile
            label="New Rx"
            icon="document-text"
            color="#0EA5E9"
            onPress={() => router.push('/dashboard?tab=prescriptions' as any)}
            testID="staff-act-rx"
          />
          <ActionTile
            label="New Note"
            icon="create"
            color="#8B5CF6"
            onPress={() => router.push('/notes' as any)}
            testID="staff-act-note"
          />
          <ActionTile
            label="My Consults"
            icon="medkit"
            color="#16A34A"
            onPress={() => router.push('/dashboard?tab=consultations' as any)}
            testID="staff-act-consult"
          />
        </View>

        {/* Today's appointments */}
        <SectionHeader
          title="Today's appointments"
          rightLabel="See all"
          onRightPress={() => router.push('/dashboard?tab=bookings' as any)}
        />
        <Card style={{ padding: 0 }}>
          {todayList.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>No more appointments today</Text>
            </View>
          ) : (
            todayList.map((b, idx) => (
              <TouchableOpacity
                key={b.id || idx}
                style={[styles.bookingRow, idx > 0 && styles.rowDivider]}
                onPress={() => router.push('/dashboard?tab=bookings' as any)}
                activeOpacity={0.85}
              >
                <View style={styles.timeBubble}>
                  <Text style={styles.timeText}>
                    {b.start_time || b.slot || '--:--'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.bookingName} numberOfLines={1}>
                    {b.patient_name || 'Patient'}
                  </Text>
                  <Text style={styles.bookingMeta} numberOfLines={1}>
                    {b.patient_phone || ''} {b.status ? `· ${b.status}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))
          )}
        </Card>

        <View style={{ height: 24 }} />
        </View>
      </SV>
      <AssistantBubble bottom={bubbleBottom} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: 16 },
  contentPad: { paddingHorizontal: 14, paddingTop: 16 },
  kpiRow: { flexDirection: 'row', marginBottom: 12 },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
  },
  emptyText: {
    ...FONTS.body,
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  bookingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
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
    minWidth: 56,
    alignItems: 'center',
  },
  timeText: {
    ...FONTS.body,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  bookingName: {
    ...FONTS.body,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  bookingMeta: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
});
