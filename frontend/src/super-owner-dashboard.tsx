/**
 * SuperOwnerDashboard — platform-level dashboard rendered when the
 * authenticated user has tier.isSuperOwner === true.
 *
 * Replaces the clinical-workflow dashboard (Bookings / Rx / Surgery /
 * Patients / Consults) with platform-management surfaces:
 *
 *   1. Platform stats cards    — /api/admin/platform-stats
 *   2. Owners & Partners panel — reused (manages primary_owners, partners,
 *                                demo accounts)
 *   3. Audit Trail             — /api/admin/audit-log
 *
 * Kept in /src instead of /app so it does not become an addressable
 * route — it is rendered by `dashboard.tsx` only.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import { useAuth } from './auth';
import { COLORS, RADIUS } from './theme';
import OwnersPanel from './owners-panel';
import { roleLabel } from './tier';

type Stats = {
  primary_owners?: number;
  partners?: number;
  staff?: number;
  patients?: number;
  bookings_last_30d?: number;
  prescriptions_last_30d?: number;
  demo_accounts?: number;
};

type AuditRow = {
  ts?: string;
  kind?: string;
  actor_email?: string;
  target_email?: string;
  [k: string]: any;
};

const KIND_LABELS: Record<string, string> = {
  demo_created: 'Demo created',
  demo_revoked: 'Demo revoked',
  promote_primary_owner: 'Promoted to Primary Owner',
  demote_primary_owner: 'Demoted from Primary Owner',
  promote_partner: 'Promoted to Partner',
  demote_partner: 'Demoted from Partner',
  role_change: 'Role change',
};

function fmtTs(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function SuperOwnerDashboard() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [stats, setStats] = useState<Stats>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.allSettled([
        api.get('/admin/platform-stats'),
        api.get('/admin/audit-log?limit=30'),
      ]);
      if (s.status === 'fulfilled') setStats(s.value.data || {});
      if (a.status === 'fulfilled') setAudit(a.value.data?.items || []);
    } catch {
      // fail silently — empty cards / audit list still render
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const cards: { key: keyof Stats; label: string; icon: any; color: string }[] = [
    { key: 'primary_owners', label: 'Primary Owners', icon: 'star', color: '#7C3AED' },
    { key: 'partners', label: 'Partners', icon: 'people', color: '#0E7C8B' },
    { key: 'staff', label: 'Staff', icon: 'medkit', color: '#0EA5E9' },
    { key: 'patients', label: 'Patients', icon: 'person', color: '#16A34A' },
    { key: 'bookings_last_30d', label: 'Bookings · 30d', icon: 'calendar', color: '#F59E0B' },
    { key: 'prescriptions_last_30d', label: 'Rx · 30d', icon: 'document-text', color: '#E11D48' },
    { key: 'demo_accounts', label: 'Demo Accounts', icon: 'eye', color: '#6B7280' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconBtn}
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Super Owner</Text>
          <Text style={styles.headerSub}>Platform administration</Text>
        </View>
        <TouchableOpacity
          onPress={() => signOut?.()}
          style={styles.iconBtn}
          accessibilityLabel="Sign out"
        >
          <Ionicons name="log-out-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Identity card */}
        <View style={styles.identityCard}>
          {user?.picture ? (
            <Image source={{ uri: user.picture }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '22' }]}>
              <Ionicons name="shield-checkmark" size={26} color={COLORS.primary} />
            </View>
          )}
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.identityName} numberOfLines={1}>{user?.name || 'Super Owner'}</Text>
            <Text style={styles.identityEmail} numberOfLines={1}>{user?.email}</Text>
            <View style={styles.tierBadge}>
              <Ionicons name="shield" size={11} color="#fff" />
              <Text style={styles.tierBadgeText}>{roleLabel('super_owner')}</Text>
            </View>
          </View>
        </View>

        {/* Stats cards */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Platform stats</Text>
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 16 }} />
          ) : (
            <View style={styles.cardsGrid}>
              {cards.map((c) => {
                const val = stats?.[c.key];
                return (
                  <View key={c.key as string} style={styles.statCard}>
                    <View style={[styles.statIcon, { backgroundColor: c.color + '18' }]}>
                      <Ionicons name={c.icon} size={18} color={c.color} />
                    </View>
                    <Text style={styles.statValue}>{typeof val === 'number' ? val : '—'}</Text>
                    <Text style={styles.statLabel}>{c.label}</Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Owners management — reused panel, includes primary owners, partners, and demo accounts */}
        <View style={styles.section}>
          <OwnersPanel />
        </View>

        {/* Audit log */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          <Text style={styles.sectionSub}>Last 30 admin events</Text>
          <View style={styles.auditList}>
            {audit.length === 0 ? (
              <View style={styles.auditEmpty}>
                <Ionicons name="time-outline" size={22} color={COLORS.textSecondary} />
                <Text style={styles.auditEmptyText}>No recorded events yet.</Text>
              </View>
            ) : (
              audit.map((row, idx) => (
                <View key={`${row.ts}-${idx}`} style={styles.auditRow}>
                  <View style={styles.auditDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.auditKind}>
                      {KIND_LABELS[row.kind || ''] || (row.kind || 'event')}
                    </Text>
                    {!!row.target_email && (
                      <Text style={styles.auditDetail}>
                        Target: <Text style={{ fontWeight: '600' }}>{row.target_email}</Text>
                      </Text>
                    )}
                    {!!row.actor_email && (
                      <Text style={styles.auditDetail}>By: {row.actor_email}</Text>
                    )}
                    <Text style={styles.auditTs}>{fmtTs(row.ts)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  headerSub: { color: '#FFFFFFCC', fontSize: 12, marginTop: 2 },
  scroll: { padding: 16, paddingBottom: 40 },

  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: 14,
    borderRadius: RADIUS.lg,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 2 },
      default: {},
    }),
  },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  identityName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  identityEmail: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  tierBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7C3AED',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    marginTop: 6,
  },
  tierBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  section: { marginTop: 20 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2, marginBottom: 12 },

  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    marginHorizontal: -6,
  },
  statCard: {
    width: '50%',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  statIcon: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  statLabel: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  auditList: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 12,
  },
  auditRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    gap: 10,
  },
  auditDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginTop: 6,
  },
  auditKind: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  auditDetail: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  auditTs: { fontSize: 11, color: COLORS.textDisabled, marginTop: 4 },
  auditEmpty: { padding: 18, alignItems: 'center', gap: 6 },
  auditEmptyText: { fontSize: 13, color: COLORS.textSecondary },
});

// Wrap all StatCard widths so the grid styling is also styled here
// (the styles above already apply via `statCard`).
// (Keeping a no-op named export below for any future extension.)
export const SUPER_OWNER_DASHBOARD = 'SuperOwnerDashboard';
