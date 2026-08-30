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
  Modal,
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<PatientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [permError, setPermError] = useState(false);
  const [summary, setSummary] = useState<{
    total: number; registered: number; unregistered: number;
  } | null>(null);

  const months = useMemo(() => recentMonths(6), []);

  // Load the Unregistered/Registered summary for the compact Directory
  // button subtitle. (Invite → sign-up conversion analytics live only on
  // the Directory page /patients now, so we no longer fetch them here.)
  React.useEffect(() => {
    if (!canAccess) return;
    let cancelled = false;
    (async () => {
      try {
        const sumRes = await api.get('/registry/patients/summary').catch(() => ({ data: null }));
        if (cancelled) return;
        if (sumRes?.data) setSummary(sumRes.data);
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
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => router.push('/patients' as any)}
            activeOpacity={0.85}
            style={styles.dirPill}
            testID="patient-db-open-directory"
          >
            <Ionicons name="people-circle" size={16} color={COLORS.primary} />
            <Text style={styles.dirPillTxt}>Directory</Text>
            {summary && summary.unregistered > 0 ? (
              <View style={styles.dirBadge}>
                <Text style={styles.dirBadgeTxt}>{summary.unregistered}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
          {canExport && (
            <TouchableOpacity
              onPress={onExport}
              style={styles.exportIconBtn}
              disabled={exporting}
              activeOpacity={0.85}
              testID="patient-db-export"
            >
              {exporting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="download" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Search (¾) + Filters dropdown (¼) on one line ── */}
      <View style={styles.controlsRow}>
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
        <TouchableOpacity
          style={[styles.filterBtn, month ? styles.filterBtnActive : null]}
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.85}
          testID="patient-db-filter"
        >
          <Ionicons name="options-outline" size={15} color={month ? COLORS.primary : COLORS.textSecondary} />
          <Text style={[styles.filterBtnTxt, month ? { color: COLORS.primary } : null]} numberOfLines={1}>
            {month ? (months.find((m) => m.key === month)?.label || 'Filter') : 'All'}
          </Text>
          <Ionicons name="chevron-down" size={13} color={month ? COLORS.primary : COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Filters dropdown — month picker */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Filter by month</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              <FilterOption
                label="All months"
                active={month === ''}
                onPress={() => { setMonth(''); setFilterOpen(false); }}
              />
              {months.map((m) => (
                <FilterOption
                  key={m.key}
                  label={m.label}
                  active={month === m.key}
                  onPress={() => { setMonth(m.key); setFilterOpen(false); }}
                />
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

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

function FilterOption({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.filterOption, active && styles.filterOptionActive]}
      testID={`patient-db-filter-opt-${label}`}
    >
      <Text style={[styles.filterOptionTxt, active && styles.filterOptionTxtActive]}>{label}</Text>
      {active ? <Ionicons name="checkmark" size={16} color={COLORS.primary} /> : null}
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dirPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1, borderColor: COLORS.primary + '40',
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill,
  },
  dirPillTxt: { ...FONTS.body, fontSize: 12.5, fontWeight: '700', color: COLORS.primary },
  dirBadge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  dirBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  exportIconBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  controlsRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 8,
    marginHorizontal: 14, marginBottom: 2,
  },
  searchRow: {
    flex: 3,
    flexDirection: 'row',
    alignItems: 'center',
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
  filterBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '0D' },
  filterBtnTxt: { ...FONTS.body, fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, flexShrink: 1 },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center', paddingHorizontal: 28,
  },
  modalSheet: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 8, paddingTop: 14,
    maxHeight: '70%',
  },
  modalTitle: {
    ...FONTS.h4, fontSize: 13, color: COLORS.textSecondary, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, paddingHorizontal: 10,
  },
  filterOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: RADIUS.md,
  },
  filterOptionActive: { backgroundColor: COLORS.primary + '10' },
  filterOptionTxt: { ...FONTS.body, fontSize: 14, color: COLORS.textPrimary },
  filterOptionTxtActive: { color: COLORS.primary, fontWeight: '700' },
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
});
