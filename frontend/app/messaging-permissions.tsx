// Owner-only Messaging Permissions panel.
//
// Lists every signed-up user — staff and patients — and lets the
// owner authorise / revoke their ability to send personal messages
// inside the app. Backed by:
//   • GET  /api/admin/messaging-permissions  (listing)
//   • POST /api/admin/users/{id}/messaging-permission  (toggle)
//
// Notes:
//   • Team members default-allowed; toggling OFF sets explicit False.
//   • Patients default-denied; toggling ON sets explicit True.
//   • Owner row can't be revoked (always shown locked).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../src/api';
import { goBackSafe } from '../src/nav';
import { useAuth } from '../src/auth';
import { useTier } from '../src/tier';
import { COLORS, FONTS, RADIUS } from '../src/theme';

type Row = {
  user_id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  picture?: string;
  allowed: boolean;
  default_allowed: boolean;
  explicit: boolean | null;
};

type Tab = 'staff' | 'patients' | 'all';

const ROLE_COLOR: Record<string, string> = {
  super_owner: '#7C3AED',
  primary_owner: '#0E7C8B',
  partner: '#0EA5E9',
  owner: '#0E7C8B', // legacy alias — should not appear post-migration
  doctor: '#10B981',
  nursing: '#7C3AED',
  reception: '#F59E0B',
  assistant: '#EC4899',
  patient: '#5E7C81',
};

export default function MessagingPermissions() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const tier = useTier();

  const [tab, setTab] = useState<Tab>('staff');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({}); // user_id → toggling

  // Owner-tier gate: Primary Owner, Partner, Super Owner. The legacy
  // 'owner' alias is retained for backward-compat (already migrated to
  // primary_owner on backend startup, but keep here to be safe).
  const isOwnerTier =
    tier.isOwnerTier ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'super_owner' ||
    user?.role === 'owner';

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (tab === 'staff') {
        // Listing endpoint accepts a single role filter; we fetch all
        // and filter client-side so we can include the full staff
        // family (doctor/partner/assistant/reception/nursing).
      } else if (tab === 'patients') {
        params.role = 'patient';
      }
      if (q.trim()) params.q = q.trim();
      const { data } = await api.get('/admin/messaging-permissions', { params });
      let items: Row[] = data?.items || [];
      if (tab === 'staff') items = items.filter((r) => r.role && r.role !== 'patient');
      setRows(items);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        Alert.alert('Restricted', 'This panel is for the Primary Owner / Partner only.');
        goBackSafe(router);
        return;
      }
      Alert.alert('Error', e?.response?.data?.detail || 'Could not load permissions');
    } finally {
      setLoading(false);
    }
  }, [tab, q, router]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const toggle = async (row: Row, next: boolean) => {
    // Don't allow revoking owner-tier rows — they always have messaging.
    if (row.role === 'super_owner' || row.role === 'primary_owner' || row.role === 'partner' || row.role === 'owner') return;
    setPending((p) => ({ ...p, [row.user_id]: true }));
    // Optimistic update.
    setRows((cur) => cur.map((r) =>
      r.user_id === row.user_id ? { ...r, allowed: next, explicit: next } : r
    ));
    try {
      await api.post(`/admin/users/${row.user_id}/messaging-permission`, { allowed: next });
    } catch (e: any) {
      // Roll back on failure.
      setRows((cur) => cur.map((r) =>
        r.user_id === row.user_id ? row : r
      ));
      Alert.alert('Could not update', e?.response?.data?.detail || 'Try again later.');
    } finally {
      setPending((p) => { const n = { ...p }; delete n[row.user_id]; return n; });
    }
  };

  const counts = useMemo(() => {
    const allowed = rows.filter((r) => r.allowed).length;
    return { total: rows.length, allowed, revoked: rows.length - allowed };
  }, [rows]);

  if (!isOwnerTier) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Restricted</Text>
          <Text style={styles.emptySub}>This panel is for the Primary Owner and Partners.</Text>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.iconBtn} testID="msg-perms-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={styles.kicker}>PRIMARY OWNER · ADMIN</Text>
            <Text style={styles.title}>Messaging permissions</Text>
            <Text style={styles.sub}>
              {counts.allowed} allowed · {counts.revoked} revoked · {counts.total} total
            </Text>
          </View>
          <Ionicons name="paper-plane" size={22} color="#fff" />
        </View>
      </LinearGradient>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {(['staff', 'patients', 'all'] as Tab[]).map((k) => (
          <TouchableOpacity
            key={k}
            onPress={() => setTab(k)}
            style={[styles.tabPill, tab === k && styles.tabPillOn]}
            testID={`msg-perms-tab-${k}`}
          >
            <Ionicons
              name={k === 'staff' ? 'people' : k === 'patients' ? 'medical' : 'list'}
              size={13}
              color={tab === k ? '#fff' : COLORS.primary}
            />
            <Text style={[styles.tabPillText, tab === k && { color: '#fff' }]}>
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search name, email, phone…"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.searchInput}
          autoCapitalize="none"
          testID="msg-perms-search"
        />
        {!!q && (
          <TouchableOpacity onPress={() => setQ('')}>
            <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={48} color={COLORS.textDisabled} />
              <Text style={styles.emptySub}>
                {q ? `No ${tab} match "${q}"` : `No ${tab} found.`}
              </Text>
            </View>
          ) : (
            rows.map((r) => {
              const roleColor = ROLE_COLOR[r.role || ''] || COLORS.textSecondary;
              // Owner-tier rows can never be revoked — always-allowed
              // by hierarchy. Cover legacy 'owner' alias too.
              const isOwnerRow = r.role === 'super_owner' || r.role === 'primary_owner' || r.role === 'partner' || r.role === 'owner';
              const roleLabelStr = (() => {
                switch (r.role) {
                  case 'super_owner': return 'SUPER OWNER';
                  case 'primary_owner': return 'PRIMARY OWNER';
                  case 'partner': return 'PARTNER';
                  case 'owner': return 'PRIMARY OWNER'; // legacy alias
                  default: return (r.role || '').toUpperCase();
                }
              })();
              const explicitBadge = r.explicit === null
                ? r.default_allowed ? 'Default · allowed' : 'Default · revoked'
                : r.allowed ? 'Authorised' : 'Revoked';
              return (
                <View key={r.user_id} style={styles.row}>
                  {r.picture ? (
                    <Image source={{ uri: r.picture }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, { backgroundColor: roleColor + '22', alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ ...FONTS.bodyMedium, color: roleColor, fontSize: 18 }}>
                        {(r.name || r.email || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.name || r.email || '—'}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      <Text style={{ color: roleColor, fontFamily: 'Manrope_700Bold' }}>{roleLabelStr}</Text>
                      {r.email ? ` · ${r.email}` : r.phone ? ` · ${r.phone}` : ''}
                    </Text>
                    <View style={[
                      styles.statusChip,
                      r.allowed ? { backgroundColor: COLORS.success + '14' } : { backgroundColor: COLORS.accent + '14' },
                    ]}>
                      <View style={[styles.statusDot, { backgroundColor: r.allowed ? COLORS.success : COLORS.accent }]} />
                      <Text style={[styles.statusText, { color: r.allowed ? COLORS.success : COLORS.accent }]}>{explicitBadge}</Text>
                    </View>
                  </View>
                  {isOwnerRow ? (
                    <View style={styles.lockBadge}>
                      <Ionicons name="lock-closed" size={14} color={COLORS.primary} />
                    </View>
                  ) : (
                    <View>
                      {pending[r.user_id] ? (
                        <ActivityIndicator color={COLORS.primary} size="small" />
                      ) : (
                        <Switch
                          value={r.allowed}
                          onValueChange={(v) => toggle(r, v)}
                          trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
                          thumbColor={r.allowed ? COLORS.primary : '#fff'}
                          testID={`msg-perms-switch-${r.user_id}`}
                        />
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )}

          <View style={styles.footnote}>
            <Ionicons name="information-circle" size={14} color={COLORS.textSecondary} />
            <Text style={styles.footnoteText}>
              Team members are allowed to message by default. Patients are denied by default — flip the switch to authorise.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 14, paddingBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  kicker: { ...FONTS.label, color: 'rgba(255,255,255,0.85)', fontSize: 10, letterSpacing: 0.6 },
  title: { ...FONTS.h3, color: '#fff', fontSize: 18, marginTop: 1 },
  sub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },

  tabsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  tabPill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabPillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabPillText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff',
    marginHorizontal: 16, marginTop: 4,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, padding: 0 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.bg },
  name: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14 },
  meta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { ...FONTS.bodyMedium, fontSize: 10.5, letterSpacing: 0.3 },
  lockBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary + '14', alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', fontSize: 12 },
  primaryBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: RADIUS.pill, marginTop: 10 },
  primaryBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },

  footnote: {
    marginTop: 14, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: COLORS.primary + '0E',
    borderRadius: RADIUS.md,
  },
  footnoteText: { flex: 1, ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
});
