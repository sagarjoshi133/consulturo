/**
 * Patient Database Permissions screen — owner-tier UI for flipping
 * the `can_access_patient_db` flag on each team member (doctor,
 * assistant, reception, nursing). Owners + partners are always
 * permitted and surface here as informational rows.
 *
 * Mirrors the existing /messaging-permissions screen pattern so the
 * UX feels consistent across permission management surfaces.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Switch,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { goBackSafe } from '../src/nav';

type StaffRow = {
  user_id: string;
  name?: string;
  email?: string;
  role?: string;
  picture?: string;
  can_access_patient_db?: boolean;
  registered?: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  partner: 'Partner',
  doctor: 'Doctor',
  assistant: 'Assistant',
  reception: 'Reception',
  nursing: 'Nursing',
};

const ROLE_COLORS: Record<string, string> = {
  owner: '#0E7C8B',
  partner: '#0E7C8B',
  doctor: '#0EA5E9',
  assistant: '#7C3AED',
  reception: '#F59E0B',
  nursing: '#EC4899',
};

// Owner-tier roles always have access — switch is disabled for them.
const ALWAYS_ALLOWED = new Set(['owner', 'partner', 'super_owner', 'primary_owner']);

export default function PatientDbPermissions() {
  const router = useRouter();
  const { user } = useAuth();
  const isOwner =
    user?.role === 'super_owner' ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner';

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/admin/patient-db-permissions');
      setRows(r.data?.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const toggle = useCallback(async (row: StaffRow, next: boolean) => {
    setPendingId(row.user_id);
    // Optimistic UI — flip locally first.
    setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, can_access_patient_db: next } : r)));
    try {
      await api.post(`/admin/users/${row.user_id}/patient-db-permission`, { allowed: next });
    } catch {
      // Roll back on failure.
      setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, can_access_patient_db: !next } : r)));
    } finally {
      setPendingId(null);
    }
  }, []);

  if (!isOwner) {
    return (
      <View style={styles.empty}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
        <Text style={styles.emptyTitle}>Restricted</Text>
        <Text style={styles.emptySub}>This panel is for the Primary Owner.</Text>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const visible = filter
    ? rows.filter((r) => {
        const q = filter.toLowerCase();
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.email || '').toLowerCase().includes(q) ||
          (r.role || '').toLowerCase().includes(q)
        );
      })
    : rows;

  const allowed = rows.filter((r) => ALWAYS_ALLOWED.has(r.role || '') || r.can_access_patient_db).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backIcon} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>Patient Database Access</Text>
          <Text style={styles.subtitle}>
            {allowed} of {rows.length} team member{rows.length === 1 ? '' : 's'} allowed
          </Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter by name, email or role"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.searchInput}
        />
        {!!filter && (
          <TouchableOpacity onPress={() => setFilter('')} hitSlop={6}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Info banner */}
      <View style={styles.banner}>
        <Ionicons name="information-circle" size={16} color={COLORS.primary} />
        <Text style={styles.bannerText}>
          Owners &amp; Partners always have access. Toggling here only affects Doctor / Assistant / Reception / Nursing roles. Export remains primary-owner-only.
        </Text>
      </View>

      {loading ? (
        <View style={{ padding: 32, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>
            {filter ? 'No matches' : 'No staff members yet'}
          </Text>
          <Text style={styles.emptySub}>
            {filter ? 'Try a different filter.' : 'Invite a team member from Team & Roles.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {visible.map((r) => {
            const role = r.role || '';
            const isAlwaysAllowed = ALWAYS_ALLOWED.has(role);
            const allowed = isAlwaysAllowed || !!r.can_access_patient_db;
            const isPending = !r.registered;
            const roleColor = ROLE_COLORS[role] || COLORS.primary;
            return (
              <View key={r.user_id} style={styles.row}>
                {r.picture ? (
                  <Image source={{ uri: r.picture }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: roleColor + '22', justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={[styles.avatarLetter, { color: roleColor }]}>
                      {(r.name || r.email || '?').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {r.name || r.email || 'Unnamed'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                    <View style={[styles.rolePill, { backgroundColor: roleColor + '18' }]}>
                      <Text style={[styles.rolePillText, { color: roleColor }]}>
                        {ROLE_LABELS[role] || role.toUpperCase() || '—'}
                      </Text>
                    </View>
                    {isPending && (
                      <View style={[styles.rolePill, { backgroundColor: '#F59E0B22' }]}>
                        <Text style={[styles.rolePillText, { color: '#F59E0B' }]}>PENDING INVITE</Text>
                      </View>
                    )}
                    {r.email && !isPending && (
                      <Text style={styles.rowEmail} numberOfLines={1}>{r.email}</Text>
                    )}
                  </View>
                </View>
                {pendingId === r.user_id ? (
                  <ActivityIndicator size="small" color={COLORS.primary} style={{ marginRight: 8 }} />
                ) : isAlwaysAllowed ? (
                  <View style={styles.alwaysPill}>
                    <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
                    <Text style={styles.alwaysPillText}>Always</Text>
                  </View>
                ) : (
                  <Switch
                    value={allowed}
                    onValueChange={(v) => toggle(r, v)}
                    trackColor={{ false: COLORS.border, true: COLORS.primary }}
                    thumbColor={allowed ? '#fff' : '#f4f3f4'}
                    disabled={isPending}
                  />
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  backIcon: { padding: 6 },
  title: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    ...FONTS.body,
    color: COLORS.textPrimary,
    fontSize: 14,
    padding: 0,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    margin: 14,
    padding: 12,
    backgroundColor: COLORS.primary + '10',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  bannerText: {
    flex: 1,
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textPrimary,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarLetter: { ...FONTS.h2, fontSize: 18 },
  rowName: { ...FONTS.body, fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  rowEmail: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary, flexShrink: 1 },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  rolePillText: { ...FONTS.body, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  alwaysPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#16A34A18',
    borderRadius: 10,
  },
  alwaysPillText: {
    ...FONTS.body,
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
    letterSpacing: 0.3,
  },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { ...FONTS.h2, fontSize: 17, color: COLORS.textPrimary, marginTop: 12 },
  emptySub: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', maxWidth: 280 },
  backBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 12 },
  backBtnText: { ...FONTS.body, fontWeight: '700', color: '#fff' },
});
