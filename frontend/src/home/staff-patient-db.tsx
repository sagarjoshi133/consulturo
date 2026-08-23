/**
 * StaffPatientDb — Full patient database surface, rendered inside the
 * staff "Patients" bottom-tab slot ((tabs)/tools.tsx for staff).
 *
 * Replaces the earlier lightweight phone-only lookup with the
 * complete spec from Dr. Joshi 2026-05-21:
 *   • Multi-field search   — name / mobile / reg-no / email
 *   • Month filter pills   — This month, prev months scrollable
 *   • Paginated list       — last 50 rows by first_seen_at desc
 *   • Permission gate      — owner/partner always see; others gated by
 *                            tier.canAccessPatientDb (super_owner can
 *                            export)
 *   • Tap row → /patient-db/[phone] detail page
 *   • Export button (CSV)  — primary_owner / super_owner only
 *
 * Cleanly handles three permission-states:
 *   1. Owner / Partner  → full UI + export
 *   2. Staff w/ access  → full UI but Export hidden
 *   3. Staff w/o access → "Access not granted" empty state
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../api';
import { useAuth } from '../auth';
import { useTier } from '../tier';
import { COLORS, FONTS, RADIUS } from '../theme';

type PatientRow = {
  reg_no?: string;
  name?: string;
  phone?: string;
  email?: string;
  age?: number;
  gender?: string;
  address?: string;
  first_seen_at?: string;
  last_visit?: string;
  visit_count?: number;
};

type ListResponse = {
  items: PatientRow[];
  total: number;
  limit: number;
  skip: number;
  can_export: boolean;
};

const PAGE_SIZE = 50;

// Generate the last N months as YYYY-MM strings (newest first). Uses
// IST so the labels match what the backend filter expects.
function recentMonths(n: number): { key: string; label: string }[] {
  const months: { key: string; label: string }[] = [];
  const fmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' });
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${fmt.format(d)} ${String(d.getFullYear()).slice(2)}`;
    months.push({ key, label });
  }
  return months;
}

export default function StaffPatientDb() {
  const router = useRouter();
  const { user } = useAuth();
  const tier = useTier();

  const isOwner =
    user?.role === 'super_owner' ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner';
  const canAccess = isOwner || !!tier?.canAccessPatientDb;
  const canExport = !!tier?.canExportPatientDb;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [month, setMonth] = useState<string>('');
  const [items, setItems] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [permError, setPermError] = useState(false);
  const [summary, setSummary] = useState<{
    total: number; registered: number; unregistered: number;
  } | null>(null);
  const [analytics, setAnalytics] = useState<{
    total_invited: number; converted_total: number;
    conversion_rate_total: number;
    converted_within_7d: number; converted_within_30d: number;
  } | null>(null);

  const months = useMemo(() => recentMonths(6), []);

  // Load Unregistered summary + invite analytics from the same call
  // pattern as /app/patients — this way the Patients bottom tab
  // exposes the new directory tile and conversion insights inline.
  React.useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    (async () => {
      try {
        const [sumRes, anaRes] = await Promise.all([
          api.get('/registry/patients/summary').catch(() => ({ data: null })),
          api.get('/registry/invites/analytics').catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        if (sumRes?.data) setSummary(sumRes.data);
        if (anaRes?.data) setAnalytics(anaRes.data);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [canAccess]);

  // Debounce the search input by 280 ms so we don't fire a request
  // on every keystroke.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 280);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    try {
      const r = await api.get<ListResponse>('/patient-db/list', {
        params: {
          q: debouncedQuery || undefined,
          month: month || undefined,
          limit: PAGE_SIZE,
        },
      });
      setItems(r.data.items || []);
      setTotal(r.data.total || 0);
      setPermError(false);
    } catch (e: any) {
      if (e?.response?.status === 403) setPermError(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, month, canAccess]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  React.useEffect(() => { setLoading(true); load(); }, [debouncedQuery, month, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onExport = useCallback(async () => {
    if (!canExport || exporting) return;
    setExporting(true);
    try {
      // Hit the export endpoint with the same filters and trigger a
      // browser download (web) / share sheet (native).
      const params = new URLSearchParams();
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (month) params.set('month', month);
      const url = `${(api.defaults.baseURL || '').replace(/\/$/, '')}/patient-db/export?${params.toString()}`;
      if (Platform.OS === 'web') {
        // Use window.open to leverage the auth cookie / interceptor.
        // Fallback: use fetch + Blob to ensure auth header attaches.
        const r = await api.get('/patient-db/export', {
          params: { q: debouncedQuery || undefined, month: month || undefined },
          responseType: 'blob' as any,
        });
        const blob = r.data as any;
        const dataUrl = (window as any).URL.createObjectURL(blob);
        const a = (document as any).createElement('a');
        a.href = dataUrl;
        const ts = new Date().toISOString().slice(0, 10);
        a.download = `consulturo-patients-${ts}.csv`;
        a.click();
        setTimeout(() => (window as any).URL.revokeObjectURL(dataUrl), 1000);
      } else {
        await Linking.openURL(url);
      }
    } catch {
      /* swallow — the user will see no download */
    } finally {
      setExporting(false);
    }
  }, [canExport, exporting, debouncedQuery, month]);

  // ─── Permission gates ─────────────────────────────────────────
  if (!canAccess) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Patient Database — access required</Text>
          <Text style={styles.emptySub}>
            Ask the Primary Owner to enable Patient Database access for your account from Permission Manager.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permError) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.empty}>
          <Ionicons name="warning" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Access denied</Text>
          <Text style={styles.emptySub}>Server reported your token cannot read the patient database.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Patient Database</Text>
          <Text style={styles.subtitle}>
            {total} patient{total === 1 ? '' : 's'}
            {month ? ` · ${months.find((m) => m.key === month)?.label || month}` : ''}
          </Text>
        </View>
        {canExport && (
          <TouchableOpacity
            onPress={onExport}
            style={styles.exportBtn}
            disabled={exporting}
            activeOpacity={0.85}
            testID="patient-db-export"
          >
            {exporting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="download" size={14} color="#fff" />
                <Text style={styles.exportBtnText}>Export CSV</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ── Directory tile (Unregistered / Duplicates / Bulk invite) ── */}
      <TouchableOpacity
        onPress={() => router.push('/patients' as any)}
        activeOpacity={0.85}
        style={styles.dirTile}
        testID="patient-db-open-directory"
      >
        <View style={styles.dirIcon}>
          <Ionicons name="people-circle" size={26} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.dirTitle}>Patient directory</Text>
          <Text style={styles.dirSub}>
            {summary
              ? `Unregistered · ${summary.unregistered}   ·   Registered · ${summary.registered}`
              : 'Registered · Unregistered · Duplicates · Bulk invite'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>

      {/* ── Invite conversion insight (owner-only via /invites/analytics) ── */}
      {analytics && analytics.total_invited > 0 ? (
        <TouchableOpacity
          onPress={() => router.push('/patients' as any)}
          activeOpacity={0.85}
          style={styles.analyticsTile}
          testID="patient-db-invite-analytics"
        >
          <View style={styles.analyticsIcon}>
            <Ionicons name="trending-up" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.analyticsLbl}>Invite → sign-up conversion</Text>
            <Text style={styles.analyticsVal}>
              {analytics.converted_total} of {analytics.total_invited}{' '}
              walk-ins signed up ·{' '}
              <Text style={{ color: COLORS.success, fontWeight: '700' }}>
                {(analytics.conversion_rate_total * 100).toFixed(0)}%
              </Text>
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
        </TouchableOpacity>
      ) : null}

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, mobile, reg-no or email"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {!!query && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={6}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Month pills — wrapped in a fixed-height container so the
          horizontal ScrollView doesn't flex-grow vertically when its
          parent SafeAreaView still has remaining space (web bug). */}
      <View style={styles.pillsWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
        >
          <PillToggle
            label="All months"
            active={month === ''}
            onPress={() => setMonth('')}
          />
          {months.map((m) => (
            <PillToggle
              key={m.key}
              label={m.label}
              active={month === m.key}
              onPress={() => setMonth(m.key)}
            />
          ))}
        </ScrollView>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingVertical: 32, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people" size={36} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>
            {debouncedQuery || month ? 'No patients match' : 'No patients yet'}
          </Text>
          {(debouncedQuery || month) && (
            <Text style={styles.emptySub}>Try clearing the search or month filter.</Text>
          )}
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {items.map((p) => (
            <PatientRowCard
              key={(p.reg_no || '') + (p.phone || '') + (p.email || '')}
              row={p}
              onPress={() =>
                router.push(
                  `/patient-db/${encodeURIComponent(p.phone || '_email_' + (p.email || ''))}` as any
                )
              }
            />
          ))}
          {total > items.length && (
            <Text style={styles.moreNote}>
              Showing first {items.length} of {total}. Refine search to narrow down.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function PillToggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
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

function PatientRowCard({ row, onPress }: { row: PatientRow; onPress: () => void }) {
  const initials = (row.name || row.email || row.phone || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.cardName} numberOfLines={1}>
          {row.name || 'Unnamed'}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {row.reg_no ? `#${row.reg_no} · ` : ''}
          {row.phone || row.email || ''}
          {row.age ? ` · ${row.age}y` : ''}
          {row.gender ? ` · ${row.gender}` : ''}
        </Text>
        <View style={styles.metaRow}>
          {row.visit_count !== undefined && row.visit_count > 0 && (
            <View style={styles.metaPill}>
              <Ionicons name="repeat" size={10} color={COLORS.primary} />
              <Text style={styles.metaPillText}>
                {row.visit_count} visit{row.visit_count === 1 ? '' : 's'}
              </Text>
            </View>
          )}
          {row.last_visit && (
            <Text style={styles.lastVisit} numberOfLines={1}>
              Last: {row.last_visit}
            </Text>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  title: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  exportBtnText: { ...FONTS.body, fontSize: 12, fontWeight: '700', color: '#fff' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
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
  pillsWrap: {
    // Constrain the horizontal scroll bar to its intrinsic height so
    // it doesn't expand to fill remaining vertical space (a flex-row
    // parent quirk on web).
    height: 50,
    flexGrow: 0,
    flexShrink: 0,
  },
  pills: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
    height: 34,
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  pillTextActive: { color: '#fff' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: { ...FONTS.h2, fontSize: 14, color: COLORS.primary, fontWeight: '700' },
  cardName: { ...FONTS.body, fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  cardMeta: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.primary + '12',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  metaPillText: { ...FONTS.body, fontSize: 10, color: COLORS.primary, fontWeight: '700' },
  lastVisit: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary },
  moreNote: {
    ...FONTS.body,
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { ...FONTS.h2, fontSize: 16, color: COLORS.textPrimary, marginTop: 12, textAlign: 'center' },
  emptySub: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', maxWidth: 320, lineHeight: 18 },
  // ── Directory tile + invite conversion insight ──
  dirTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 10, padding: 12,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  dirIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  dirTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  dirSub: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  analyticsTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginTop: 8, padding: 12,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    borderLeftWidth: 3, borderLeftColor: COLORS.primary,
  },
  analyticsIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  analyticsLbl: {
    fontSize: 11, fontWeight: '700', color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2,
  },
  analyticsVal: { fontSize: 13, color: COLORS.textSecondary },

});
