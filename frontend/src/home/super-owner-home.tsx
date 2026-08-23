/**
 * SuperOwnerHome — Platform admin dashboard for ConsultUro super_owner.
 *
 * Hides clinical content entirely. Shows platform-wide KPIs and
 * operational shortcuts:
 *   • KPI strip: Primary Owners, Patients, Bookings (30d), Rx (30d)
 *   • Quick actions: Permission Manager, Backups, Broadcasts,
 *     Primary-Owner Analytics, Create Blog
 *   • System health card: app version, OTA + Sentry presence, FCM
 *
 * Data source: /api/admin/platform-stats (one-shot summary).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  Platform,
  Pressable,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
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

type PlatformStats = {
  primary_owners: number;
  partners: number;
  staff: number;
  patients: number;
  bookings_last_30d: number;
  prescriptions_last_30d: number;
  demo_accounts: number;
};

export default function SuperOwnerHome({
  onLangPress,
  langBadge,
}: {
  onLangPress?: () => void;
  langBadge?: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bubbleBottom = Platform.OS === 'web' ? 24 : 64 + insets.bottom + 20;
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [inviteAnalytics, setInviteAnalytics] = useState<{
    total_invited: number; converted_total: number;
    conversion_rate_total: number;
    converted_within_7d: number; converted_within_30d: number;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [statsRes, invRes] = await Promise.all([
        api.get('/admin/platform-stats'),
        api.get('/registry/invites/analytics').catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      if (invRes?.data) setInviteAnalytics(invRes.data);
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

  const version =
    Constants?.expoConfig?.version ||
    (Constants as any)?.manifest?.version ||
    '—';
  const sentryConfigured = !!process.env.EXPO_PUBLIC_SENTRY_DSN;

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

        {/* Floating quick-actions card — power-user shortcuts. */}
        <QuickActionsRow
          items={[
            {
              key: 'su-qa-perm',
              label: 'Permissions',
              icon: 'key',
              color: '#0E7C8B',
              onPress: () => router.push('/permission-manager' as any),
            },
            {
              key: 'su-qa-blog',
              label: 'Create Blog',
              icon: 'newspaper',
              color: '#F59E0B',
              onPress: () => router.push('/admin/blog' as any),
            },
            {
              key: 'su-qa-analytics',
              label: 'Analytics',
              icon: 'analytics',
              color: '#16A34A',
              onPress: () => router.push('/admin/primary-owner-analytics' as any),
            },
            {
              key: 'su-qa-backups',
              label: 'Backups',
              icon: 'cloud-upload',
              color: '#0EA5E9',
              onPress: () => router.push('/admin/backups' as any),
            },
          ]}
        />

        <View style={styles.contentPad}>
          <SectionHeader title="ConsultUro platform" />

          {/* KPI strip */}
          <View style={styles.kpiRow}>
          <KPITile
            label="Owners"
            value={stats ? stats.primary_owners : '—'}
            icon="business"
            color="#0E7C8B"
            onPress={() => router.push('/permission-manager' as any)}
            loading={!stats}
            testID="su-kpi-owners"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Patients"
            value={stats ? stats.patients : '—'}
            icon="people"
            color="#16A34A"
            loading={!stats}
            testID="su-kpi-patients"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Books 30d"
            value={stats ? stats.bookings_last_30d : '—'}
            icon="calendar"
            color="#0EA5E9"
            onPress={() => router.push('/admin/primary-owner-analytics' as any)}
            loading={!stats}
            testID="su-kpi-bookings"
          />
          <View style={{ width: 8 }} />
          <KPITile
            label="Rx 30d"
            value={stats ? stats.prescriptions_last_30d : '—'}
            icon="document-text"
            color="#8B5CF6"
            loading={!stats}
            testID="su-kpi-rx"
          />
        </View>

        {/* Quick actions */}
        <SectionHeader title="Quick actions" />
        <View style={styles.actionsGrid}>
          <ActionTile
            label="Permissions"
            icon="key"
            color="#0E7C8B"
            onPress={() => router.push('/permission-manager' as any)}
            testID="su-act-perm"
          />
          <ActionTile
            label="Backups"
            icon="cloud-upload"
            color="#0EA5E9"
            onPress={() => router.push('/admin/backups' as any)}
            testID="su-act-backups"
          />
          <ActionTile
            label="Analytics"
            icon="analytics"
            color="#16A34A"
            onPress={() => router.push('/admin/primary-owner-analytics' as any)}
            testID="su-act-analytics"
          />
          <ActionTile
            label="Create Blog"
            icon="newspaper"
            color="#F59E0B"
            onPress={() => router.push('/admin/blog' as any)}
            testID="su-act-blog"
          />
          <ActionTile
            label="Broadcasts"
            icon="megaphone"
            color="#EF4444"
            onPress={() => router.push('/dashboard?tab=broadcasts' as any)}
            testID="su-act-broadcasts"
          />
          <ActionTile
            label="Audit Log"
            icon="time"
            color="#8B5CF6"
            onPress={() => router.push('/admin/audit-log' as any)}
            testID="su-act-audit"
          />
        </View>

        {/* System health */}
        <SectionHeader title="System health" />
        <Card style={{ padding: 0 }}>
          <HealthRow icon="cube" label="App version" value={String(version)} />
          <HealthRow
            icon="cloud-download"
            label="OTA updates"
            value="Enabled"
            ok
          />
          <HealthRow
            icon="bug"
            label="Sentry"
            value={sentryConfigured ? 'Connected' : 'Not configured'}
            ok={sentryConfigured}
          />
          <HealthRow
            icon="paper-plane"
            label="FCM Push (V1)"
            value="Active"
            ok
            last
          />
        </Card>

        {inviteAnalytics && inviteAnalytics.total_invited > 0 && (
          <>
            <SectionHeader title="Invite → sign-up" />
            <Card>
              <Pressable
                onPress={() => router.push('/patients' as any)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: COLORS.primary + '18',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name="trending-up" size={22} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.textPrimary }}>
                    {inviteAnalytics.converted_total} of {inviteAnalytics.total_invited} walk-ins signed up
                  </Text>
                  <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
                    {(inviteAnalytics.conversion_rate_total * 100).toFixed(0)}% conversion ·
                    {' '}Last 7d: {inviteAnalytics.converted_within_7d} ·
                    {' '}30d: {inviteAnalytics.converted_within_30d}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </Pressable>
            </Card>
          </>
        )}

        {stats && stats.demo_accounts > 0 && (
          <>
            <SectionHeader title="Demo accounts" />
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="flask" size={20} color="#0EA5E9" />
                <Text style={styles.demoText}>
                  {stats.demo_accounts} demo account{stats.demo_accounts === 1 ? '' : 's'} in the system
                </Text>
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

function HealthRow({
  icon,
  label,
  value,
  ok,
  last,
}: {
  icon: string;
  label: string;
  value: string;
  ok?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.healthRow, !last && styles.healthRowDivider]}>
      <View style={styles.healthIcon}>
        <Ionicons name={icon as any} size={16} color={COLORS.primary} />
      </View>
      <Text style={styles.healthLabel}>{label}</Text>
      <View style={[styles.healthPill, { backgroundColor: ok ? '#16A34A22' : COLORS.border }]}>
        <Text style={[styles.healthValue, { color: ok ? '#16A34A' : COLORS.textSecondary }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingBottom: 16 },
  contentPad: { paddingHorizontal: 14, paddingTop: 16 },
  logoFrame: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandName: {
    ...FONTS.h3,
    fontSize: 17,
    color: COLORS.textPrimary,
  },
  brandSub: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  kpiRow: { flexDirection: 'row', marginBottom: 12 },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  healthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  healthRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  healthIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  healthLabel: {
    flex: 1,
    ...FONTS.body,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  healthPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  healthValue: {
    ...FONTS.body,
    fontSize: 11,
    fontWeight: '700',
  },
  demoText: {
    flex: 1,
    ...FONTS.body,
    fontSize: 13,
    color: COLORS.textPrimary,
  },
});
