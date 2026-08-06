/**
 * Audit Log Viewer — Phase 5.23 (Owner-tier).
 *
 * A browsable, filterable, paginated viewer for the `audit_log`
 * collection that ConsultUro has been silently populating across
 * every sensitive action (role changes, prescription writes,
 * discharge summaries, surgery edits, etc.).
 *
 * Visible to owner-tier users (primary_owner / partner / super_owner)
 * — same gate as `/api/admin/audit-log`.
 *
 * Features:
 *   • Free-text search across action / actor / target
 *   • Action prefix filter (dropdown built from `/audit-log/facets`)
 *   • Actor role filter
 *   • Date range filter (Today / 7d / 30d / All)
 *   • Offset pagination (Load more)
 *   • Per-row expand to surface `meta` JSON
 *   • CSV export of the current filtered set (web only; native gets
 *     a "Copy as JSON" share fallback).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  TextInput,
  Platform,
  Pressable,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useScreenBg, useIsDark, useDarkMode } from '../../src/dark-mode';
import { parseBackendDate, formatIST } from '../../src/date';

type AuditRow = {
  log_id?: string;
  _id?: string;
  ts: number | string;
  clinic_id?: string;
  actor_id?: string;
  actor_name?: string;
  actor_email?: string;
  actor_role?: string;
  // Schema is mixed — newer rows use `action` (e.g. `prescription.create`)
  // while legacy rows use `kind` (e.g. `blog_perm_change`). The UI
  // normalises both via `r.action || r.kind`.
  action?: string;
  kind?: string;
  target_id?: string;
  target_email?: string;
  target_user_id?: string;
  target_type?: string;
  new_value?: any;
  meta?: Record<string, any>;
};

type Facets = {
  actions: string[];
  actor_roles: string[];
  oldest_ts?: number;
  newest_ts?: number;
  total: number;
};

type DatePreset = 'all' | 'today' | '7d' | '30d';

const PAGE_SIZE = 50;

function fmtTs(ts: number | string | undefined): string {
  if (ts === undefined || ts === null) return '';
  try {
    let d: Date;
    if (typeof ts === 'number') d = new Date(ts);
    else d = parseBackendDate(ts);
    if (isNaN(d.getTime())) return String(ts);
    return formatIST(d);
  } catch {
    return String(ts);
  }
}

function relTs(ts: number | string | undefined): string {
  if (ts === undefined || ts === null) return '';
  try {
    const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
    const diff = Date.now() - t;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const dy = Math.round(hr / 24);
    if (dy < 7) return `${dy}d ago`;
    return fmtTs(ts);
  } catch {
    return '';
  }
}

const ACTION_ICONS: Record<string, { icon: any; color: string }> = {
  prescription: { icon: 'document-text', color: '#E11D48' },
  booking: { icon: 'calendar', color: '#F59E0B' },
  surgery: { icon: 'cut', color: '#7C3AED' },
  discharge: { icon: 'medkit', color: '#0EA5E9' },
  certificate: { icon: 'ribbon', color: '#16A34A' },
  role: { icon: 'star', color: '#0E7C8B' },
  promote: { icon: 'arrow-up-circle', color: '#0E7C8B' },
  demote: { icon: 'arrow-down-circle', color: '#6B7280' },
  demo: { icon: 'eye', color: '#6B7280' },
  delete: { icon: 'trash', color: '#DC2626' },
  user: { icon: 'person', color: '#0E7C8B' },
  clinic: { icon: 'business', color: '#7C3AED' },
  ipd: { icon: 'fitness', color: '#DB2777' },
  consent: { icon: 'shield-checkmark', color: '#16A34A' },
};

function iconFor(action: string): { icon: any; color: string } {
  for (const [key, val] of Object.entries(ACTION_ICONS)) {
    if (action.toLowerCase().includes(key)) return val;
  }
  return { icon: 'document', color: '#6B7280' };
}

function rowsToCSV(rows: AuditRow[]): string {
  const headers = ['Timestamp (IST)', 'Action', 'Actor', 'Role', 'Target', 'Target Type', 'Clinic', 'Meta'];
  const escape = (v: any): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const body = rows
    .map((r) =>
      [
        fmtTs(r.ts),
        r.action || r.kind || '',
        r.actor_name || r.actor_email || r.actor_id || '',
        r.actor_role || '',
        r.target_id || r.target_email || r.target_user_id || '',
        r.target_type || '',
        r.clinic_id || '',
        r.meta || (r.new_value !== undefined ? { new_value: r.new_value } : {}),
      ]
        .map(escape)
        .join(','),
    )
    .join('\n');
  return `${headers.join(',')}\n${body}`;
}

function rowKey(r: AuditRow, idx: number): string {
  return r.log_id || (r._id ? String(r._id) : `idx_${idx}_${r.ts}`);
}

function rowAction(r: AuditRow): string {
  return r.action || r.kind || '(unknown)';
}

function rowActor(r: AuditRow): string {
  return r.actor_name || r.actor_email || r.actor_id || 'system';
}

function rowTarget(r: AuditRow): string {
  return r.target_id || r.target_email || r.target_user_id || '';
}

function rowMeta(r: AuditRow): Record<string, any> {
  const m: Record<string, any> = { ...(r.meta || {}) };
  if (r.new_value !== undefined) m.new_value = r.new_value;
  return m;
}

export default function AuditLogViewer() {
  const router = useRouter();
  const { user } = useAuth();
  const screenBg = useScreenBg();
  const isDark = useIsDark();
  const { colors: dm } = useDarkMode();

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ─── Filters ────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [showActionPicker, setShowActionPicker] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);

  const debounceRef = useRef<any>(null);

  // Role gate — owner tier only.
  useEffect(() => {
    const role = (user as any)?.role;
    if (!user) return;
    if (!['super_owner', 'primary_owner', 'owner', 'partner'].includes(role)) {
      router.replace('/' as any);
    }
  }, [user, router]);

  const computeRange = useCallback((): { since_ms?: number; until_ms?: number } => {
    const now = Date.now();
    if (datePreset === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { since_ms: d.getTime() };
    }
    if (datePreset === '7d') return { since_ms: now - 7 * 24 * 3600 * 1000 };
    if (datePreset === '30d') return { since_ms: now - 30 * 24 * 3600 * 1000 };
    return {};
  }, [datePreset]);

  const load = useCallback(
    async (opts: { append?: boolean; offset?: number } = {}) => {
      const offset = opts.offset ?? 0;
      if (opts.append) setLoadingMore(true);
      else if (offset === 0 && !refreshing) setLoading(true);
      try {
        const params: any = { limit: PAGE_SIZE, offset };
        if (q.trim()) params.q = q.trim();
        if (actionFilter) params.action = actionFilter;
        if (roleFilter) params.actor_role = roleFilter;
        const range = computeRange();
        if (range.since_ms) params.since_ms = range.since_ms;
        if (range.until_ms) params.until_ms = range.until_ms;
        const { data } = await api.get('/admin/audit-log', { params });
        const incoming = (data?.items || []) as AuditRow[];
        setTotal(data?.total ?? incoming.length);
        if (opts.append) setRows((prev) => [...prev, ...incoming]);
        else setRows(incoming);
      } catch {
        if (!opts.append) setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [q, actionFilter, roleFilter, computeRange, refreshing],
  );

  const loadFacets = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/audit-log/facets');
      setFacets(data);
    } catch {
      // Facets are optional — the filters just stay empty.
    }
  }, []);

  useEffect(() => {
    loadFacets();
  }, [loadFacets]);

  // Debounce text search; immediate refresh on dropdown changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      load({ offset: 0 });
    }, q ? 350 : 0);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, actionFilter, roleFilter, datePreset]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadFacets();
    load({ offset: 0 });
  }, [load, loadFacets]);

  const onLoadMore = useCallback(() => {
    if (rows.length >= total) return;
    load({ append: true, offset: rows.length });
  }, [rows.length, total, load]);

  const exportCSV = useCallback(async () => {
    const csv = rowsToCSV(rows);
    if (Platform.OS === 'web') {
      try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    } else {
      try {
        await Share.share({ message: csv, title: 'Audit log CSV' });
      } catch {
        // ignore
      }
    }
  }, [rows]);

  const cardBg = isDark ? dm.surface : '#fff';
  const text = isDark ? dm.textPrimary : COLORS.textPrimary;
  const textMuted = isDark ? dm.textSecondary : COLORS.textSecondary;
  const border = isDark ? dm.border : COLORS.border;

  const headerLabel = useMemo(() => {
    if (loading) return '';
    const f = [actionFilter, roleFilter, datePreset !== 'all' ? datePreset : null, q && `"${q}"`]
      .filter(Boolean)
      .join(' · ');
    return f ? `${rows.length} of ${total} · ${f}` : `${rows.length} of ${total} entries`;
  }, [rows.length, total, q, actionFilter, roleFilter, datePreset, loading]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: screenBg }} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: border }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
          testID="audit-back"
        >
          <Ionicons name="arrow-back" size={22} color={text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: text }]}>Audit Log</Text>
          <Text style={[styles.subtitle, { color: textMuted }]} numberOfLines={1}>
            {headerLabel}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={exportCSV}
          disabled={!rows.length}
          testID="audit-export"
        >
          <Ionicons name="download-outline" size={20} color={rows.length ? COLORS.primary : textMuted} />
        </TouchableOpacity>
      </View>

      {/* Filter strip */}
      <View style={[styles.filterBar, { backgroundColor: cardBg, borderBottomColor: border }]}>
        <View style={[styles.searchWrap, { backgroundColor: isDark ? '#0F1416' : '#F3F7F8', borderColor: border }]}>
          <Ionicons name="search" size={16} color={textMuted} style={{ marginLeft: 10 }} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search action, actor, or target ID…"
            placeholderTextColor={textMuted}
            style={[styles.searchInput, { color: text }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="audit-search"
          />
          {q ? (
            <TouchableOpacity onPress={() => setQ('')} style={{ paddingHorizontal: 10 }}>
              <Ionicons name="close-circle" size={16} color={textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          <Chip
            label={`Action: ${actionFilter || 'All'}`}
            active={!!actionFilter}
            onPress={() => setShowActionPicker((v) => !v)}
            isDark={isDark}
          />
          <Chip
            label={`Role: ${roleFilter || 'All'}`}
            active={!!roleFilter}
            onPress={() => setShowRolePicker((v) => !v)}
            isDark={isDark}
          />
          {(['all', 'today', '7d', '30d'] as DatePreset[]).map((p) => (
            <Chip
              key={p}
              label={p === 'all' ? 'All time' : p === 'today' ? 'Today' : p === '7d' ? 'Last 7 days' : 'Last 30 days'}
              active={datePreset === p}
              onPress={() => setDatePreset(p)}
              isDark={isDark}
            />
          ))}
          {(actionFilter || roleFilter || datePreset !== 'all' || q) ? (
            <Chip
              label="Clear"
              active={false}
              onPress={() => {
                setActionFilter('');
                setRoleFilter('');
                setDatePreset('all');
                setQ('');
              }}
              isDark={isDark}
              danger
            />
          ) : null}
        </ScrollView>

        {/* Action picker dropdown */}
        {showActionPicker && (
          <View style={[styles.picker, { backgroundColor: cardBg, borderColor: border }]}>
            <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
              <PickerRow
                label="All actions"
                active={!actionFilter}
                onPress={() => {
                  setActionFilter('');
                  setShowActionPicker(false);
                }}
                textColor={text}
                border={border}
              />
              {(facets?.actions || []).map((a) => (
                <PickerRow
                  key={a}
                  label={a}
                  active={actionFilter === a}
                  onPress={() => {
                    setActionFilter(a);
                    setShowActionPicker(false);
                  }}
                  textColor={text}
                  border={border}
                />
              ))}
              {(!facets?.actions || facets.actions.length === 0) ? (
                <Text style={{ padding: 16, color: textMuted, fontSize: 13 }}>
                  No actions logged yet.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        )}

        {/* Role picker dropdown */}
        {showRolePicker && (
          <View style={[styles.picker, { backgroundColor: cardBg, borderColor: border }]}>
            <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
              <PickerRow
                label="All roles"
                active={!roleFilter}
                onPress={() => {
                  setRoleFilter('');
                  setShowRolePicker(false);
                }}
                textColor={text}
                border={border}
              />
              {(facets?.actor_roles || []).map((r) => (
                <PickerRow
                  key={r}
                  label={r}
                  active={roleFilter === r}
                  onPress={() => {
                    setRoleFilter(r);
                    setShowRolePicker(false);
                  }}
                  textColor={text}
                  border={border}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={[styles.muted, { color: textMuted, marginTop: 10 }]}>Loading audit trail…</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="archive-outline" size={48} color={textMuted} />
          <Text style={[styles.empty, { color: text }]}>No matching audit entries</Text>
          <Text style={[styles.muted, { color: textMuted, textAlign: 'center', paddingHorizontal: 24 }]}>
            Try widening your filters or refreshing — the audit log captures sensitive actions across the app
            (role changes, prescriptions, surgeries, discharge summaries, etc.).
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {rows.map((r, idx) => {
            const action = rowAction(r);
            const ic = iconFor(action);
            const key = rowKey(r, idx);
            const isOpen = !!expanded[key];
            const target = rowTarget(r);
            const meta = rowMeta(r);
            return (
              <Pressable
                key={key}
                onPress={() => setExpanded((e) => ({ ...e, [key]: !e[key] }))}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: cardBg, borderBottomColor: border, opacity: pressed ? 0.85 : 1 },
                ]}
                testID={`audit-row-${key}`}
              >
                <View style={[styles.iconBubble, { backgroundColor: ic.color + '20' }]}>
                  <Ionicons name={ic.icon} size={18} color={ic.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.action, { color: text }]} numberOfLines={1}>
                      {action}
                    </Text>
                    <Text style={[styles.ts, { color: textMuted }]}>· {relTs(r.ts)}</Text>
                  </View>
                  <Text style={[styles.actor, { color: textMuted }]} numberOfLines={1}>
                    {rowActor(r)}
                    {r.actor_role ? ` (${r.actor_role})` : ''}
                    {target ? ` → ${target}` : ''}
                  </Text>
                  {isOpen && (
                    <View style={[styles.metaBox, { backgroundColor: isDark ? '#0F1416' : '#F3F7F8', borderColor: border }]}>
                      <Text style={[styles.metaLbl, { color: textMuted }]}>Full timestamp</Text>
                      <Text style={[styles.metaVal, { color: text }]}>{fmtTs(r.ts)}</Text>
                      {r.clinic_id ? (
                        <>
                          <Text style={[styles.metaLbl, { color: textMuted }]}>Clinic ID</Text>
                          <Text style={[styles.metaVal, { color: text }]} selectable>
                            {r.clinic_id}
                          </Text>
                        </>
                      ) : null}
                      {r.target_type ? (
                        <>
                          <Text style={[styles.metaLbl, { color: textMuted }]}>Target type</Text>
                          <Text style={[styles.metaVal, { color: text }]}>{r.target_type}</Text>
                        </>
                      ) : null}
                      {meta && Object.keys(meta).length ? (
                        <>
                          <Text style={[styles.metaLbl, { color: textMuted }]}>Meta</Text>
                          <Text style={[styles.metaVal, styles.mono, { color: text }]} selectable>
                            {JSON.stringify(meta, null, 2)}
                          </Text>
                        </>
                      ) : null}
                      <Text style={[styles.metaLbl, { color: textMuted, marginTop: 8 }]}>Log ID</Text>
                      <Text style={[styles.metaVal, styles.mono, { color: text }]} selectable>
                        {key}
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons
                  name={isOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={textMuted}
                />
              </Pressable>
            );
          })}

          {rows.length < total && (
            <TouchableOpacity
              style={[styles.loadMore, { borderColor: border, backgroundColor: cardBg }]}
              onPress={onLoadMore}
              disabled={loadingMore}
              testID="audit-load-more"
            >
              {loadingMore ? (
                <ActivityIndicator color={COLORS.primary} size="small" />
              ) : (
                <>
                  <Ionicons name="arrow-down-circle-outline" size={18} color={COLORS.primary} />
                  <Text style={[styles.loadMoreText, { color: COLORS.primary }]}>
                    Load {Math.min(PAGE_SIZE, total - rows.length)} more
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
  isDark,
  danger,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  isDark: boolean;
  danger?: boolean;
}) {
  const bg = danger
    ? '#FEE2E2'
    : active
    ? COLORS.primary + '22'
    : isDark
    ? '#1A2426'
    : '#F3F7F8';
  const fg = danger ? '#DC2626' : active ? COLORS.primary : isDark ? '#E2ECEC' : COLORS.textPrimary;
  const border = active ? COLORS.primary : danger ? '#FCA5A5' : isDark ? '#243036' : '#D8E3E6';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, { backgroundColor: bg, borderColor: border }]}
      activeOpacity={0.85}
    >
      <Text style={[styles.chipText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PickerRow({
  label,
  active,
  onPress,
  textColor,
  border,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  textColor: string;
  border: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.pickerRow, { borderBottomColor: border }]}
    >
      <Text style={[styles.pickerText, { color: textColor, fontWeight: active ? '700' : '500' }]}>
        {label}
      </Text>
      {active ? <Ionicons name="checkmark" size={18} color={COLORS.primary} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  backBtn: { padding: 8 },
  iconBtn: { padding: 8 },
  title: { fontSize: 18, fontFamily: FONTS.bold, fontWeight: '700' },
  subtitle: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },
  filterBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    height: 40,
  },
  searchInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 10,
    fontFamily: FONTS.regular,
    fontSize: 14,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    marginRight: 8,
  },
  chipText: { fontSize: 12, fontFamily: FONTS.bold, fontWeight: '600' },
  picker: {
    marginTop: 8,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerText: { fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  empty: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  muted: { fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: { fontSize: 14, fontWeight: '700', fontFamily: FONTS.bold, flexShrink: 1 },
  ts: { fontSize: 11, fontFamily: FONTS.regular },
  actor: { fontSize: 12, fontFamily: FONTS.regular, marginTop: 2 },
  metaBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  metaLbl: { fontSize: 10, fontFamily: FONTS.bold, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  metaVal: { fontSize: 13, fontFamily: FONTS.regular, marginTop: 2 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 },
  loadMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  loadMoreText: { fontSize: 14, fontWeight: '700', fontFamily: FONTS.bold },
});
