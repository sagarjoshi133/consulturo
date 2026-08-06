/**
 * OwnerHome — Operational cockpit for primary_owner / partner roles.
 *
 * Shows a glanceable "running the clinic today" overview:
 *   • KPI strip: Today's bookings, Pending consults, Rx today, Patients
 *   • Quick actions: New Booking · New Rx · New Note · Broadcast
 *   • Next appointments (today, from /api/bookings)
 *   • Alerts: duplicate users count, app version
 *
 * Data sources:
 *   /api/profile/quick-stats        → today + pending counts
 *   /api/analytics/dashboard        → lifetime totals + month context
 *   /api/bookings                   → upcoming list (today only)
 *   /api/admin/users/duplicates     → owner-tier dedup alert (optional)
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../api';
import { useI18n } from '../i18n';
import { COLORS, FONTS, RADIUS } from '../theme';
import {
  KPITile,
  ActionTile,
  SectionHeader,
  Card,
  QuickActionsRow,
  type QuickAction,
} from './cockpit-ui';
import PatientHero from './patient-hero';
import AssistantBubble from '../assistant-bubble';
import { parseBackendDate, formatISTTime } from '../date';

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
  consultation_done?: boolean;
};

type Analytics = {
  totals?: {
    total_bookings?: number;
    total_surgeries?: number;
    total_prescriptions?: number;
    total_patients?: number;
  };
  // The endpoint actually flattens these — keep flexible.
  [key: string]: any;
};

export default function OwnerHome({
  onLangPress,
  langBadge,
  onNewPress,
}: {
  onLangPress?: () => void;
  langBadge?: string;
  onNewPress?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bubbleBottom = Platform.OS === 'web' ? 24 : 64 + insets.bottom + 20;
  const { t } = useI18n();
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [todayList, setTodayList] = useState<Booking[]>([]);
  const [dupCount, setDupCount] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a, b, d] = await Promise.allSettled([
        api.get('/profile/quick-stats'),
        api.get('/analytics/dashboard?months=1'),
        api.get('/bookings/all'),
        api.get('/admin/users/duplicates').catch(() => ({ data: { items: [] } })),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (a.status === 'fulfilled') setAnalytics(a.value.data);
      if (b.status === 'fulfilled') {
        // Backend returns { items: [...] } or a plain array — handle both.
        const raw = b.value.data;
        const arr: Booking[] = Array.isArray(raw) ? raw : raw?.items || [];
        // Filter to today's IST date, sort by start_time.
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
      if (d.status === 'fulfilled') {
        const items = d.value?.data?.items || [];
        setDupCount(Array.isArray(items) ? items.length : 0);
      }
    } catch {
      /* swallow — non-critical */
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
  const totalRx = analytics?.total_rx ?? analytics?.totals?.total_prescriptions ?? '—';
  const totalPatients = analytics?.total_patients ?? analytics?.totals?.total_patients ?? '—';

  // Web parallax — capture scroll offset so PatientHero can drift its
  // doctor photo. Native: scrollY stays at 0, no transform applied.
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

        {/* Floating quick-actions card — visually identical to the
            patient home's quick-actions row but with role-targeted
            shortcuts. */}
        <QuickActionsRow
          items={[
            {
              key: 'qa-booking',
              label: 'New Booking',
              icon: 'calendar-plus',
              iconLib: 'mci',
              color: '#0E7C8B',
              onPress: () => router.push('/(tabs)/book' as any),
              testID: 'owner-qa-booking',
            },
            {
              key: 'qa-consult',
              label: 'Consult',
              icon: 'medkit',
              color: '#16A34A',
              onPress: () => router.push('/dashboard?tab=consultations' as any),
              testID: 'owner-qa-consult',
            },
            {
              key: 'qa-rx',
              label: 'New Rx',
              icon: 'document-text',
              color: '#0EA5E9',
              onPress: () => router.push('/dashboard?tab=prescriptions' as any),
              testID: 'owner-qa-rx',
            },
            {
              key: 'qa-schedule',
              label: 'Schedule Surgery',
              icon: 'calendar-clock',
              iconLib: 'mci',
              color: '#DC2626',
              onPress: () => router.push('/ot-calendar/schedule' as any),
              testID: 'owner-qa-schedule-sx',
            },
            {
              key: 'qa-ot',
              label: 'OT Schedule',
              icon: 'medical-bag',
              iconLib: 'mci',
              color: '#A855F7',
              onPress: () => router.push('/ot-calendar' as any),
              testID: 'owner-qa-ot',
            },
            {
              key: 'qa-patients',
              label: 'Patients',
              icon: 'people',
              color: '#7C3AED',
              onPress: () => router.push('/(tabs)/tools' as any),
              testID: 'owner-qa-patients',
            },
          ]}
        />

        <View style={styles.contentPad}>
          <SectionHeader title="Clinic today" />
          {/* KPI strip */}
          <View style={styles.kpiRow}>
          <KPITile
            label="Today"
            value={todayCount}
            icon="calendar"
            color="#0E7C8B"
            onPress={() => router.push('/dashboard?tab=bookings' as any)}
            loading={!stats}
            testID="owner-kpi-today"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Pending"
            value={pendingCount}
            icon="hourglass"
            color="#F59E0B"
            onPress={() => router.push('/dashboard?tab=consultations' as any)}
            loading={!stats}
            testID="owner-kpi-pending"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Rx total"
            value={totalRx}
            icon="document-text"
            color="#0EA5E9"
            onPress={() => router.push('/dashboard?tab=prescriptions' as any)}
            loading={!analytics}
            testID="owner-kpi-rx"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Patients"
            value={totalPatients}
            icon="people"
            color="#16A34A"
            onPress={() => router.push('/dashboard?tab=consultations' as any)}
            loading={!analytics}
            testID="owner-kpi-patients"
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
            testID="owner-act-booking"
          />
          <ActionTile
            label="New Rx"
            icon="document-text"
            color="#0EA5E9"
            onPress={() => router.push('/dashboard?tab=prescriptions' as any)}
            testID="owner-act-rx"
          />
          <ActionTile
            label="New Note"
            icon="create"
            color="#8B5CF6"
            onPress={() => router.push('/notes' as any)}
            testID="owner-act-note"
          />
          <ActionTile
            label="Broadcast"
            icon="megaphone"
            color="#F59E0B"
            onPress={() => router.push('/dashboard?tab=broadcasts' as any)}
            testID="owner-act-broadcast"
          />
        </View>

        {/* Next appointments */}
        <SectionHeader
          title="Next appointments"
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

        {/* Alerts */}
        {dupCount > 0 && (
          <>
            <SectionHeader title="Alerts" />
            <Card>
              <View style={styles.alertRow}>
                <View style={[styles.alertIcon, { backgroundColor: '#F59E0B22' }]}>
                  <Ionicons name="warning" size={18} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertTitle}>
                    {dupCount} duplicate user account{dupCount === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.alertSub}>
                    Tap to review and merge in Permission Manager.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/permission-manager' as any)}
                  style={styles.alertBtn}
                >
                  <Text style={styles.alertBtnText}>Review</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </>
        )}

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
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertTitle: {
    ...FONTS.body,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  alertSub: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  alertBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  alertBtnText: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
});
