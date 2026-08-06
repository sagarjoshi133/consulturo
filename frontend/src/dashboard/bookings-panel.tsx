/**
 * BookingsPanel — extracted from app/dashboard.tsx during the
 * 2026-05-25 monolith-shrink (Phase 1). NO BEHAVIORAL CHANGES — the
 * function body is byte-identical to its previous in-place form.
 *
 * What's here:
 *   - BookingsPanel: the full bookings tab (list / day / week / month
 *     views, filters, bulk actions, edit, approve, reject, etc.).
 *   - MonthGrid: small companion calendar used only by BookingsPanel.
 *
 * Everything still uses the shared dashboard styles
 * (src/dashboard/dashboard-styles.ts) so visuals stay identical to
 * the old in-file version.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  Linking,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  format,
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  addMonths,
  startOfMonth,
  endOfMonth,
  isSameDay,
  isSameMonth,
  parseISO,
} from 'date-fns';
import api from '../api';
import { useAuth } from '../auth';
import { COLORS, FONTS, RADIUS } from '../theme';
import { Skeleton } from '../skeleton';
import { whatsappLink, telLink } from '../phone';
import { useResponsive, useTwoPaneLayout } from '../responsive';
import { useToast } from '../toast';
import { resolvePatientRecipient } from '../message-recipient';
import { EmptyState } from '../empty-state';
import { DateField, TimeField } from '../date-picker';
import { displayDate, displayDateLong, display12h, parseUIDate } from '../date';
import { usePanelRefresh } from '../panel-refresh';
import { SmartAlerts } from '../dashboard-widgets';
import { shouldShowStartCta, isVideoBooking, getConsultationWindow } from '../consultation-window';
import { styles } from './dashboard-styles';

export default function BookingsPanel({ onMessagePatient }: { onMessagePatient?: (r: { user_id: string; name?: string; phone?: string; email?: string; role?: string }) => void } = {}) {
  const { isWebDesktop } = useResponsive();
  // Phase 5.24 — Tablet two-pane (iPad landscape & web desktop). When
  // active, tapping a booking sets `selectedBookingId` instead of
  // pushing a new route, and a right pane renders the detail inline.
  const tp = useTwoPaneLayout();
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'requested' | 'all' | 'confirmed' | 'rescheduled' | 'completed' | 'cancelled' | 'missed' | 'rejected'>('requested');
  // Phase 5.14 — segregate In-person vs Video bookings via a
  // secondary filter chip row. 'all' shows both.
  const [modeFilter, setModeFilter] = useState<'all' | 'in_person' | 'video'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [ed, setEd] = useState<{ date: string; time: string; note: string }>({ date: '', time: '', note: '' });
  const [viewMode, setViewMode] = useState<'list' | 'day' | 'week' | 'month'>('list');
  const [cursor, setCursor] = useState<Date>(new Date());
  // P1: smart filters
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [onlyRescheduled, setOnlyRescheduled] = useState(false);
  // P1: bulk selection mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // P2: icon-popup toolbar — filter & sort menus are shown on demand instead
  // of consuming permanent vertical space.
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [sortBy, setSortBy] = useState<'date_asc' | 'date_desc' | 'name' | 'created_desc'>('date_asc');
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const toast = useToast();
  const router = useRouter();

  // Item 7 — re-render every 30 s so the "Start Consultation" CTA window
  // (±15 min around appointment time) stays accurate without
  // requiring a manual refresh.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/bookings/all');
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Register pull-to-refresh for this tab
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try { await load(); } finally { setManualRefreshing(false); }
  }, [load]);
  usePanelRefresh('bookings', manualRefresh);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const patch = async (id: string, body: any) => {
    try {
      await api.patch(`/bookings/${id}`, body);
      load();
      setEditing(null);
      const label =
        body.status === 'confirmed' ? 'Booking confirmed' :
        body.status === 'completed' ? 'Marked as done' :
        body.status === 'cancelled' ? 'Booking cancelled' :
        body.status === 'rejected' ? 'Booking rejected' :
        'Booking updated';
      toast.success(label);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not update';
      toast.error(msg);
    }
  };

  // --- P1: Bulk operations ---
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const exitBulkMode = () => {
    setBulkMode(false);
    clearSelection();
  };

  const bulkPatch = async (status: 'confirmed' | 'cancelled' | 'rejected') => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const doRun = async () => {
      setBulkBusy(true);
      let ok = 0;
      let fail = 0;
      // Sequential to avoid race on slot conflicts
      for (const id of ids) {
        try {
          await api.patch(`/bookings/${id}`, { status });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setBulkBusy(false);
      await load();
      exitBulkMode();
      if (fail === 0) {
        toast.success(`${ok} booking${ok === 1 ? '' : 's'} ${status === 'confirmed' ? 'confirmed' : status === 'cancelled' ? 'cancelled' : 'rejected'}`);
      } else if (ok === 0) {
        toast.error('None could be updated');
      } else {
        toast.info(`${ok} updated, ${fail} failed`);
      }
    };
    const label = status === 'confirmed' ? `Confirm ${ids.length} booking${ids.length === 1 ? '' : 's'}?` :
                  status === 'cancelled' ? `Cancel ${ids.length} booking${ids.length === 1 ? '' : 's'}?` :
                  `Reject ${ids.length} booking${ids.length === 1 ? '' : 's'}?`;
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(label)) doRun();
    } else {
      Alert.alert('Bulk action', label, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', onPress: doRun, style: status === 'confirmed' ? 'default' : 'destructive' },
      ]);
    }
  };

  // --- P1: Copy patient info ---
  const copyPatientInfo = async (b: any) => {
    const lines = [
      b.patient_name,
      b.patient_phone,
      b.registration_no ? `Reg ${b.registration_no}` : '',
      `${displayDate(b.booking_date)} ${display12h(b.booking_time)} (${b.mode || 'in-person'})`,
      b.reason,
    ].filter(Boolean).join('\n');
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(lines);
      } else {
        const Clipboard = require('expo-clipboard');
        await Clipboard.setStringAsync(lines);
      }
      toast.success('Patient info copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  // --- P1: Reject with reason (cross-platform prompt) ---
  const promptRejectReason = async (booking_id: string) => {
    const ask = (): Promise<string | null> => new Promise((resolve) => {
      if (Platform.OS === 'web') {
        const r = typeof window !== 'undefined' ? window.prompt('Why are you rejecting this booking? (shown to patient)') : null;
        resolve(r == null ? null : r.trim());
      } else {
        // @ts-ignore — Alert.prompt only exists on iOS, fall back to accept-any on Android
        if (typeof Alert.prompt === 'function') {
          // @ts-ignore
          Alert.prompt(
            'Reject appointment',
            'Provide a reason — patient will be notified.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Reject', style: 'destructive', onPress: (v?: string) => resolve((v || '').trim() || null) },
            ],
            'plain-text'
          );
        } else {
          Alert.alert('Reject appointment', 'On Android, please open the booking detail to add a rejection reason.', [
            { text: 'OK', onPress: () => resolve(null) },
          ]);
        }
      }
    });
    const reason = await ask();
    if (!reason) { toast.info('Rejection cancelled — reason required'); return; }
    await patch(booking_id, { status: 'rejected', reason });
  };

  // ── Primary-owner delete ─────────────────────────────────────────
  // Hard-delete a booking with NO patient notification. Used to remove
  // test / duplicate / accidental entries. Gated to primary_owner /
  // owner / super_owner on both frontend (shown conditionally) and
  // backend (DELETE /api/bookings/{id} enforces the role).
  const canDelete = user?.role === 'super_owner' || user?.role === 'primary_owner' || user?.role === 'owner';
  const onDelete = async (booking_id: string, patient_name: string) => {
    const msg = `Permanently delete this booking for ${patient_name}? The patient will NOT be notified.`;
    const go = await new Promise<boolean>((resolve) => {
      if (Platform.OS === 'web') {
        resolve(typeof window !== 'undefined' && window.confirm(msg));
      } else {
        Alert.alert('Delete booking', msg, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ]);
      }
    });
    if (!go) return;
    try {
      await api.delete(`/bookings/${booking_id}`);
      setItems((prev) => prev.filter((b) => b.booking_id !== booking_id));
      toast.success('Booking deleted');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not delete booking');
    }
  };

  const isRescheduled = (b: any) =>
    (b.original_date && b.original_date !== b.booking_date) ||
    (b.original_time && b.original_time !== b.booking_time);
  const statusFiltered =
    filter === 'all'
      ? items
      : filter === 'rescheduled'
        ? items.filter((b) => isRescheduled(b) && b.status !== 'cancelled' && b.status !== 'rejected')
        : items.filter((b) => b.status === filter);

  // Phase 5.14 — apply mode segregation on top of status filter so
  // In-person and Video bookings can be reviewed separately. The
  // chips show live counts of the currently-status-filtered set.
  const modeFilteredStatus = modeFilter === 'all'
    ? statusFiltered
    : statusFiltered.filter((b) =>
        modeFilter === 'video' ? isVideoBooking(b) : !isVideoBooking(b),
      );
  const videoCountInStatus = statusFiltered.filter(isVideoBooking).length;
  const inPersonCountInStatus = statusFiltered.length - videoCountInStatus;

  // Smart filters removed — all status categories now live in the top
  // status pill row.
  const smartFiltered = modeFilteredStatus;

  // Full-text search across name/phone/reason/reg
  const searchFiltered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return smartFiltered;
    return smartFiltered.filter((b) => {
      return (
        (b.patient_name || '').toLowerCase().includes(q) ||
        (b.patient_phone || '').includes(q) ||
        (b.reason || '').toLowerCase().includes(q) ||
        (b.registration_no || '').toLowerCase().includes(q)
      );
    });
  }, [smartFiltered, search]);

  // Apply view-mode date filter on top of status + search filters
  const viewFiltered = (() => {
    if (viewMode === 'list') return searchFiltered;
    if (viewMode === 'day') {
      const iso = format(cursor, 'yyyy-MM-dd');
      return searchFiltered.filter((b) => b.booking_date === iso);
    }
    if (viewMode === 'week') {
      const start = startOfWeek(cursor, { weekStartsOn: 1 });
      const end = endOfWeek(cursor, { weekStartsOn: 1 });
      return searchFiltered.filter((b) => {
        try {
          const d = parseISO(b.booking_date);
          return d >= start && d <= end;
        } catch {
          return false;
        }
      });
    }
    // month
    return searchFiltered.filter((b) => {
      try {
        return isSameMonth(parseISO(b.booking_date), cursor);
      } catch {
        return false;
      }
    });
  })();
  const sortedFiltered = React.useMemo(() => {
    const arr = [...viewFiltered];
    switch (sortBy) {
      case 'date_asc':
        arr.sort((a, b) => (a.booking_date || '').localeCompare(b.booking_date || '') || (a.booking_time || '').localeCompare(b.booking_time || ''));
        break;
      case 'date_desc':
        arr.sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || '') || (b.booking_time || '').localeCompare(a.booking_time || ''));
        break;
      case 'name':
        arr.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
        break;
      case 'created_desc':
        arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        break;
    }
    return arr;
  }, [viewFiltered, sortBy]);
  const filtered = sortedFiltered;
  const stats = {
    pending: items.filter((b) => b.status === 'requested').length,
    upcoming: items.filter((b) => b.status === 'confirmed').length,
    completed: items.filter((b) => b.status === 'completed').length,
    cancelled: items.filter((b) => b.status === 'cancelled' || b.status === 'rejected').length,
  };

  // Auto-select the first booking in two-pane mode so the right pane
  // isn't blank on first render. MUST come before the early `loading`
  // return guard otherwise React errors with "Rendered more hooks
  // than during the previous render."
  // We use useMemo (rather than useEffect → setState) to compute the
  // effective selected ID synchronously each render, avoiding a
  // re-render that briefly leaves the right pane empty.
  const effectiveSelectedId = React.useMemo(() => {
    if (!tp.twoPane) return selectedBookingId;
    if (selectedBookingId && (items || []).some((b: any) => b.booking_id === selectedBookingId)) {
      return selectedBookingId;
    }
    const first = (items || [])[0];
    return first ? first.booking_id : null;
  }, [tp.twoPane, selectedBookingId, items]);

  if (loading) {
    // Skeletons mimic the layout: 4 stat tiles, view-mode toggle, then 3 booking cards
    return (
      <View style={{ paddingTop: 8 }} testID="dashboard-bookings-skel">
        <View style={styles.statsRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              <Skeleton w={36} h={28} br={8} />
              <Skeleton w={56} h={12} />
            </View>
          ))}
        </View>
        <View style={[styles.viewToggle, { gap: 8 }]}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} w={70} h={32} br={16} />
          ))}
        </View>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ marginTop: 12, padding: 14, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, gap: 10 }}>
            <Skeleton w="60%" h={16} />
            <Skeleton w="40%" h={12} />
            <Skeleton w="80%" h={12} />
          </View>
        ))}
      </View>
    );
  }

  // Auto-select the first booking in two-pane mode so the right pane
  // isn't blank on first render.
  const innerContent = (
    <>
      <SmartAlerts />

      {/* ── Status filter — compact dropdown button (mobile-friendly).
           Replaces the previous 6-chip row. Shows the currently-active
           status + count; tap opens a full-width popover listing every
           status including Missed + Rejected with per-status counts. ── */}
      {(() => {
        const FILTERS = [
          { key: 'requested',   label: 'Pending',      color: '#F59E0B' },
          { key: 'confirmed',   label: 'Confirmed',    color: '#10B981' },
          { key: 'rescheduled', label: 'Rescheduled',  color: '#3B82F6' },
          { key: 'completed',   label: 'Completed',    color: '#0E7C8B' },
          { key: 'missed',      label: 'Missed',       color: '#C0392B' },
          { key: 'cancelled',   label: 'Cancelled',    color: '#EF4444' },
          { key: 'rejected',    label: 'Rejected',     color: '#7F1D1D' },
          { key: 'all',         label: 'All',          color: COLORS.primary },
        ] as const;
        const countFor = (key: string) =>
          key === 'all' ? items.length :
          key === 'rescheduled' ? items.filter(isRescheduled).length :
          items.filter((b) => b.status === key).length;
        const active = FILTERS.find((f) => f.key === filter) || FILTERS[FILTERS.length - 1];
        return (
          <>
            <TouchableOpacity
              onPress={() => setShowFilterMenu(true)}
              activeOpacity={0.85}
              style={[styles.filterDropdown, { borderColor: active.color + '88', backgroundColor: active.color + '10' }]}
              testID="bk-filter-dropdown"
            >
              <View style={[styles.filterDot, { backgroundColor: active.color }]} />
              <Text style={[styles.filterDropdownLabel, { color: active.color }]} numberOfLines={1}>
                {active.label}
              </Text>
              <View style={[styles.statusPillCount, { backgroundColor: active.color + '26' }]}>
                <Text style={[styles.statusPillCountText, { color: active.color }]}>
                  {countFor(active.key)}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={active.color} />
            </TouchableOpacity>

            {showFilterMenu && (
              <Modal transparent animationType="fade" onRequestClose={() => setShowFilterMenu(false)}>
                <Pressable style={styles.filterBackdrop} onPress={() => setShowFilterMenu(false)}>
                  <Pressable style={styles.filterSheet} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.filterSheetTitle}>Filter by status</Text>
                    {FILTERS.map((f) => {
                      const isActive = f.key === filter;
                      const count = countFor(f.key);
                      return (
                        <TouchableOpacity
                          key={f.key}
                          onPress={() => { setFilter(f.key as any); setShowFilterMenu(false); }}
                          style={[
                            styles.filterRow,
                            isActive && { backgroundColor: f.color + '14' },
                          ]}
                          testID={`bk-filter-${f.key}`}
                        >
                          <View style={[styles.filterDot, { backgroundColor: f.color }]} />
                          <Text style={[styles.filterRowLabel, { color: f.color, fontFamily: isActive ? 'Manrope_700Bold' : 'Manrope_600SemiBold' }]}>
                            {f.label}
                          </Text>
                          <View style={[styles.statusPillCount, { backgroundColor: f.color + '22' }]}>
                            <Text style={[styles.statusPillCountText, { color: f.color }]}>{count}</Text>
                          </View>
                          {isActive && (
                            <Ionicons name="checkmark" size={18} color={f.color} style={{ marginLeft: 6 }} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </Pressable>
                </Pressable>
              </Modal>
            )}
          </>
        );
      })()}

      {/* ── Phase 5.14 — Mode segregation chips ─────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {([
          { key: 'all', label: 'All', count: statusFiltered.length, icon: 'apps' as const, tint: COLORS.primary },
          { key: 'in_person', label: 'In-person', count: inPersonCountInStatus, icon: 'walk' as const, tint: '#2563EB' },
          { key: 'video', label: 'Video', count: videoCountInStatus, icon: 'videocam' as const, tint: '#7C3AED' },
        ] as const).map((m) => {
          const on = modeFilter === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => setModeFilter(m.key)}
              activeOpacity={0.85}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingHorizontal: 10, paddingVertical: 6,
                borderRadius: 16, borderWidth: 1,
                backgroundColor: on ? m.tint + '22' : '#fff',
                borderColor: on ? m.tint : COLORS.border,
              }}
              testID={`bk-mode-${m.key}`}
            >
              <Ionicons name={m.icon} size={12} color={on ? m.tint : COLORS.textSecondary} />
              <Text style={{
                ...FONTS.body, fontSize: 11.5,
                fontWeight: on ? '700' : '600' as any,
                color: on ? m.tint : COLORS.textSecondary,
              }}>{m.label} ({m.count})</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Toolbar — single row: search + view + sort + refresh ─────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 10, height: 38 }}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search…"
            placeholderTextColor={COLORS.textDisabled}
            style={{ flex: 1, marginLeft: 6, ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, outlineWidth: 0 as any }}
            testID="bk-search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} testID="bk-search-clear">
              <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => { setShowViewMenu((v) => !v); setShowSortMenu(false); }}
          style={[styles.iconSquareBtn, viewMode !== 'list' && { backgroundColor: COLORS.primary + '18', borderColor: COLORS.primary }]}
          testID="bk-view-toggle"
        >
          <Ionicons
            name={viewMode === 'list' ? 'list' : viewMode === 'day' ? 'today' : viewMode === 'week' ? 'calendar' : 'calendar-outline'}
            size={16}
            color={COLORS.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setShowSortMenu((v) => !v); setShowViewMenu(false); }}
          style={styles.iconSquareBtn}
          testID="bk-sort-toggle"
        >
          <Ionicons name="swap-vertical" size={16} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={manualRefresh}
          disabled={manualRefreshing}
          style={styles.iconSquareBtn}
          activeOpacity={0.75}
          testID="bk-refresh"
        >
          {manualRefreshing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={16} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── View popup ─────────────────────────────────────────────────── */}
      {showViewMenu && (
        <View style={styles.popupPanel} testID="bk-view-menu">
          <Text style={styles.popupTitle}>View as</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(['list', 'day', 'week', 'month'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => { setViewMode(v); setShowViewMenu(false); }}
                style={[styles.smartChip, viewMode === v && styles.smartChipActive]}
                testID={`bk-view-${v}`}
              >
                <Ionicons
                  name={v === 'list' ? 'list' : v === 'day' ? 'today' : v === 'week' ? 'calendar' : 'calendar-outline'}
                  size={13}
                  color={viewMode === v ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.smartChipText, viewMode === v && { color: '#fff' }]}>
                  {v === 'list' ? 'List' : v.charAt(0).toUpperCase() + v.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Sort popup ─────────────────────────────────────────────────── */}
      {showSortMenu && (
        <View style={styles.popupPanel} testID="bk-sort-menu">
          <Text style={styles.popupTitle}>Sort by</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { key: 'date_asc', label: 'Date · earliest', icon: 'arrow-up' as const },
              { key: 'date_desc', label: 'Date · latest', icon: 'arrow-down' as const },
              { key: 'name', label: 'Patient name', icon: 'text' as const },
              { key: 'created_desc', label: 'Newest first', icon: 'time' as const },
            ].map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => { setSortBy(s.key as any); setShowSortMenu(false); }}
                style={[styles.smartChip, sortBy === s.key && styles.smartChipActive]}
                testID={`bk-sort-${s.key}`}
              >
                <Ionicons name={s.icon} size={13} color={sortBy === s.key ? '#fff' : COLORS.primary} />
                <Text style={[styles.smartChipText, sortBy === s.key && { color: '#fff' }]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Bulk bar — visible whenever bulk mode is on. Long-press a card
          to enter bulk mode; "Select all" lets you tick every booking in
          the current filtered view in one tap. Compact icon-style actions
          to avoid horizontal overlap on narrow screens. ─────────────── */}
      {bulkMode && (() => {
        const allSelected = filtered.length > 0 && filtered.every((b: any) => selectedIds.has(b.booking_id));
        return (
          <View style={styles.bulkBar}>
            <TouchableOpacity
              onPress={() => {
                if (allSelected) setSelectedIds(new Set());
                else setSelectedIds(new Set(filtered.map((b: any) => b.booking_id)));
              }}
              style={styles.bulkSelectAllBtn}
              testID="bk-bulk-select-all"
            >
              <Ionicons
                name={allSelected ? 'checkbox' : 'square-outline'}
                size={16}
                color={COLORS.primary}
              />
              <Text style={styles.bulkSelectAllText} numberOfLines={1}>
                {selectedIds.size > 0 ? `${selectedIds.size}` : 'All'}
              </Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            {selectedIds.size > 0 && (
              <>
                <TouchableOpacity
                  onPress={() => bulkPatch('confirmed')}
                  disabled={bulkBusy}
                  style={[styles.bulkIconBtn, { backgroundColor: COLORS.success }]}
                  testID="bk-bulk-confirm"
                >
                  {bulkBusy ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => bulkPatch('cancelled')}
                  disabled={bulkBusy}
                  style={[styles.bulkIconBtn, { backgroundColor: COLORS.accent }]}
                  testID="bk-bulk-cancel"
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              onPress={() => { setBulkMode(false); clearSelection(); }}
              style={[styles.bulkIconBtn, { backgroundColor: COLORS.textSecondary }]}
              testID="bk-bulk-exit"
            >
              <Ionicons name="exit-outline" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Date navigator (for Day / Week / Month) */}
      {viewMode !== 'list' && (
        <View style={styles.dateNav}>
          <TouchableOpacity
            onPress={() => setCursor(viewMode === 'day' ? addDays(cursor, -1) : viewMode === 'week' ? addWeeks(cursor, -1) : addMonths(cursor, -1))}
            style={styles.navArrow}
            testID="bk-nav-prev"
          >
            <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.dateNavText}>
            {viewMode === 'day'
              ? format(cursor, 'EEE, dd-MM-yyyy')
              : viewMode === 'week'
              ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'dd MMM')} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), 'dd MMM yyyy')}`
              : format(cursor, 'MMMM yyyy')}
          </Text>
          <TouchableOpacity onPress={() => setCursor(new Date())} style={styles.todayBtn} testID="bk-nav-today">
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCursor(viewMode === 'day' ? addDays(cursor, 1) : viewMode === 'week' ? addWeeks(cursor, 1) : addMonths(cursor, 1))}
            style={styles.navArrow}
            testID="bk-nav-next"
          >
            <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Week strip */}
      {viewMode === 'week' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const day = addDays(startOfWeek(cursor, { weekStartsOn: 1 }), i);
            const iso = format(day, 'yyyy-MM-dd');
            const count = statusFiltered.filter((b) => b.booking_date === iso).length;
            const isToday = isSameDay(day, new Date());
            return (
              <TouchableOpacity
                key={iso}
                onPress={() => {
                  setCursor(day);
                  setViewMode('day');
                }}
                style={[styles.weekDay, isToday && { borderColor: COLORS.primary, borderWidth: 2 }]}
              >
                <Text style={styles.weekDow}>{format(day, 'EEE')}</Text>
                <Text style={styles.weekDate}>{format(day, 'dd')}</Text>
                {count > 0 && (
                  <View style={styles.weekDot}>
                    <Text style={styles.weekDotText}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Month grid */}
      {viewMode === 'month' && (
        <MonthGrid
          cursor={cursor}
          items={statusFiltered}
          onPickDay={(d) => {
            setCursor(d);
            setViewMode('day');
          }}
        />
      )}

      {/* Bulk action bar — appears on the LEFT of any selected card row */}

      {filtered.length === 0 && (
        <EmptyState
          icon={search ? 'search' : 'calendar-outline'}
          title={search ? 'No matching bookings' : items.length === 0 ? 'No bookings yet' : 'Nothing in this view'}
          subtitle={
            search
              ? 'Try a different name, phone or keyword.'
              : items.length === 0
              ? 'Your upcoming bookings will appear here. Share your booking link with patients.'
              : 'Change filters or switch to the List view to see all bookings.'
          }
          ctaLabel={!search && items.length === 0 ? 'View public booking page' : undefined}
          onCta={!search && items.length === 0 ? () => Linking.openURL('/book' as any) : undefined}
          testID="bk-empty"
        />
      )}

      {/* Desktop web — booking cards flex into a 2-up grid. Each row
          has identical-height columns and the existing per-card
          interactions (open / select / edit / actions) work
          unchanged. Mobile keeps the single-column stack which is
          best for thumb scrolling. */}
      <View style={isWebDesktop ? styles.bkGrid : undefined}>
      {filtered.map((b) => {
        const statusColor =
          b.status === 'requested' ? COLORS.warning :
          b.status === 'confirmed' ? COLORS.success :
          b.status === 'completed' ? COLORS.primaryDark :
          COLORS.accent;
        const isEditing = editing === b.booking_id;
        const wasRescheduled =
          (b.original_date && b.original_date !== b.booking_date) ||
          (b.original_time && b.original_time !== b.booking_time);
        const selected = selectedIds.has(b.booking_id);
        return (
          <View key={b.booking_id} style={[styles.bkCard, selected && styles.bkCardSelected, isWebDesktop && styles.bkCardDesktop]} testID={`bk-card-${b.booking_id}`}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => {
                if (bulkMode) {
                  toggleSelect(b.booking_id);
                } else if (tp.twoPane) {
                  // Two-pane mode — select the card and render its
                  // detail in the right pane instead of pushing route.
                  setSelectedBookingId(b.booking_id);
                } else {
                  router.push({ pathname: '/bookings/[id]', params: { id: b.booking_id } } as any);
                }
              }}
              onLongPress={() => {
                // Long-press enters bulk mode and selects this card —
                // standard mobile pattern; replaces the dedicated
                // "Bulk select" button which the user found redundant.
                if (!bulkMode) setBulkMode(true);
                toggleSelect(b.booking_id);
              }}
              testID={`bk-open-${b.booking_id}`}
            >
              <View style={styles.bkHead}>
                {bulkMode && (
                  <View style={styles.bulkCheckbox} testID={`bk-select-${b.booking_id}`}>
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={selected ? COLORS.primary : COLORS.textDisabled}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.bkName}>
                    {b.patient_name}
                    {b.patient_age ? ` · ${b.patient_age}y` : ''}
                    {b.patient_gender ? ` · ${b.patient_gender}` : ''}
                  </Text>
                  <Text style={styles.bkMeta}>
                    {displayDateLong(b.booking_date)} · {display12h(b.booking_time)}
                  </Text>
                  {wasRescheduled && b.status !== 'requested' && (
                    <Text style={[styles.bkMeta, { color: COLORS.accent }]}>
                      (Rescheduled from {displayDate(b.original_date)} {display12h(b.original_time)})
                    </Text>
                  )}
                </View>
                <View style={[styles.statusPill, { backgroundColor: statusColor + '22' }]}>
                  <Text style={[styles.statusText, { color: statusColor }]}>{b.status}</Text>
                </View>
              </View>
              {b.status === 'confirmed' && (b.confirmed_by_name || b.confirmed_by) && (
                <View style={styles.approverBadge}>
                  <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
                  <Text style={styles.approverBadgeText} numberOfLines={1}>
                    Confirmed by {b.confirmed_by_name || 'staff'}
                    {b.approver_note ? ' · note attached' : ''}
                  </Text>
                </View>
              )}
              {b.reason ? <Text style={styles.bkReason}>{b.reason}</Text> : null}
            </TouchableOpacity>
            {!bulkMode && (
              <View style={styles.bkFoot}>
                <TouchableOpacity onPress={() => Linking.openURL(telLink((b as any).country_code, b.patient_phone))} style={styles.bkAction}>
                  <Ionicons name="call" size={14} color={COLORS.primary} />
                  <Text style={styles.bkActionText} numberOfLines={1}>{b.patient_phone}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const msg = b.status === 'confirmed'
                      ? `Dear ${b.patient_name}, your appointment on ${displayDate(b.booking_date)} at ${display12h(b.booking_time)} is CONFIRMED with Dr. Sagar Joshi. — ConsultUro`
                      : `Hello ${b.patient_name}, regarding your appointment request on ${displayDate(b.booking_date)}…`;
                    Linking.openURL(whatsappLink((b as any).country_code, b.patient_phone, msg));
                  }}
                  style={styles.bkAction}
                >
                  <Ionicons name="logo-whatsapp" size={14} color={COLORS.whatsapp} />
                  <Text style={[styles.bkActionText, { color: COLORS.whatsapp }]} numberOfLines={1}>WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => copyPatientInfo(b)}
                  style={styles.bkAction}
                  testID={`bk-copy-${b.booking_id}`}
                >
                  <Ionicons name="copy-outline" size={14} color={COLORS.textSecondary} />
                  <Text style={[styles.bkActionText, { color: COLORS.textSecondary }]} numberOfLines={1}>Copy</Text>
                </TouchableOpacity>
                {!!b.patient_phone && onMessagePatient && (
                  <TouchableOpacity
                    onPress={async () => {
                      const r = await resolvePatientRecipient({
                        patient_user_id: b.patient_user_id,
                        patient_name: b.patient_name,
                        patient_phone: b.patient_phone,
                        country_code: (b as any).country_code,
                        patient_email: b.patient_email,
                      });
                      if (r.ok) {
                        onMessagePatient(r.recipient);
                      } else if (r.reason === 'not_registered') {
                        toast.error(`${b.patient_name || 'Patient'} hasn't installed the app yet — try WhatsApp.`);
                      } else if (r.reason === 'no_phone') {
                        toast.error('No phone on file for this patient');
                      } else {
                        toast.error('Could not look up patient');
                      }
                    }}
                    style={styles.bkAction}
                    testID={`bk-msg-${b.booking_id}`}
                  >
                    <Ionicons name="paper-plane" size={14} color={COLORS.primary} />
                    <Text style={[styles.bkActionText, { color: COLORS.primary }]} numberOfLines={1}>Message</Text>
                  </TouchableOpacity>
                )}
                {canDelete && (
                  <TouchableOpacity
                    onPress={() => onDelete(b.booking_id, b.patient_name || 'this patient')}
                    style={[styles.bkAction, { borderColor: '#EF4444' + '55' }]}
                    testID={`bk-delete-${b.booking_id}`}
                  >
                    <Ionicons name="trash" size={14} color="#EF4444" />
                    <Text style={[styles.bkActionText, { color: '#EF4444' }]} numberOfLines={1}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {!bulkMode && isEditing ? (
              <View style={styles.editBox}>
                <DateField
                  label="New date"
                  value={ed.date}
                  onChange={(v) => setEd((s) => ({ ...s, date: v }))}
                />
                <TimeField
                  label="New time"
                  value={ed.time}
                  onChange={(v) => setEd((s) => ({ ...s, time: v }))}
                  style={{ marginTop: 10 }}
                />
                <Text style={styles.smallLabel}>Reason for reschedule (shown to patient) *</Text>
                <TextInput
                  value={ed.note}
                  onChangeText={(v) => setEd((s) => ({ ...s, note: v }))}
                  placeholder="e.g. Doctor unavailable; moving to next available slot."
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, { minHeight: 54, textAlignVertical: 'top' }]}
                  multiline
                  testID={`bk-note-${b.booking_id}`}
                />
                <View style={styles.bkButtons}>
                  <TouchableOpacity
                    style={[styles.bkSmallBtn, { borderColor: COLORS.success }]}
                    onPress={() => {
                      const iso = parseUIDate(ed.date) || b.booking_date;
                      const time24 = ed.time ? (() => { try { const { to24h } = require('../src/date'); return to24h(ed.time); } catch { return ed.time; } })() : b.booking_time;
                      const changed = iso !== b.booking_date || time24 !== b.booking_time;
                      const reason = (ed.note || '').trim();
                      if (changed && !reason) {
                        toast.error('Please enter a reason for rescheduling');
                        return;
                      }
                      const body: any = { booking_date: iso, booking_time: time24 };
                      // Only transition to confirmed if currently requested
                      if (b.status === 'requested') body.status = 'confirmed';
                      if (reason) { body.note = reason; body.reason = reason; }
                      patch(b.booking_id, body);
                    }}
                    testID={`dash-save-${b.booking_id}`}
                  >
                    <Ionicons name="checkmark" size={14} color={COLORS.success} />
                    <Text style={[styles.bkSmallText, { color: COLORS.success }]}>
                      {b.status === 'confirmed' ? 'Reschedule' : 'Reschedule & Confirm'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.bkSmallBtn, { borderColor: COLORS.textDisabled }]} onPress={() => setEditing(null)}>
                    <Text style={[styles.bkSmallText, { color: COLORS.textSecondary }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : b.status === 'requested' ? (
              <View style={styles.bkButtons}>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.success }]}
                  onPress={() => patch(b.booking_id, { status: 'confirmed' })}
                  testID={`dash-confirm-${b.booking_id}`}
                >
                  <Ionicons name="checkmark" size={14} color={COLORS.success} />
                  <Text style={[styles.bkSmallText, { color: COLORS.success }]}>Confirm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.primary }]}
                  onPress={() => {
                    setEditing(b.booking_id);
                    // date: UI format (DD-MM-YYYY), time: 24h (HH:mm) for the new picker.
                    setEd({ date: displayDate(b.booking_date), time: (b.booking_time || '').slice(0, 5), note: b.approver_note || '' });
                  }}
                  testID={`dash-reschedule-${b.booking_id}`}
                >
                  <Ionicons name="create" size={14} color={COLORS.primary} />
                  <Text style={[styles.bkSmallText, { color: COLORS.primary }]}>Reschedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.accent }]}
                  onPress={() => promptRejectReason(b.booking_id)}
                  testID={`dash-reject-${b.booking_id}`}
                >
                  <Ionicons name="close" size={14} color={COLORS.accent} />
                  <Text style={[styles.bkSmallText, { color: COLORS.accent }]}>Reject</Text>
                </TouchableOpacity>
              </View>
            ) : b.status === 'confirmed' ? (
              <>
                {/* Item 7 — Start Consultation / Join Video CTA. Only renders
                    when the current time is within ±15 min of the booking
                    slot. Solid green pill so staff can spot it instantly. */}
                {shouldShowStartCta(b) && (
                  <TouchableOpacity
                    style={styles.startConsultBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      router.push({
                        pathname: '/bookings/[id]',
                        params: { id: b.booking_id, action: 'start' },
                      } as any);
                    }}
                    testID={`dash-start-${b.booking_id}`}
                  >
                    <Ionicons
                      name={isVideoBooking(b) ? 'videocam' : 'play-circle'}
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={styles.startConsultText}>
                      {isVideoBooking(b) ? 'Join Video' : 'Start Consultation'}
                    </Text>
                    <View style={styles.startConsultBadge}>
                      <Text style={styles.startConsultBadgeText}>
                        {getConsultationWindow(b.booking_date, b.booking_time).label || 'Now'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                <View style={styles.bkButtons}>
                  <TouchableOpacity
                    style={[styles.bkSmallBtn, { borderColor: COLORS.primary }]}
                    onPress={() => {
                      setEditing(b.booking_id);
                      setEd({ date: displayDate(b.booking_date), time: (b.booking_time || '').slice(0, 5), note: '' });
                    }}
                    testID={`dash-reschedule-${b.booking_id}`}
                  >
                    <Ionicons name="create" size={14} color={COLORS.primary} />
                    <Text style={[styles.bkSmallText, { color: COLORS.primary }]}>Reschedule</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.bkSmallBtn, { borderColor: COLORS.accent }]}
                    onPress={() => patch(b.booking_id, { status: 'cancelled' })}
                    testID={`dash-cancel-${b.booking_id}`}
                  >
                    <Ionicons name="close" size={14} color={COLORS.accent} />
                    <Text style={[styles.bkSmallText, { color: COLORS.accent }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        );
      })}
      </View>
    </>
  );

  if (tp.twoPane) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 600 }}>
        <View
          style={{
            width: tp.listWidth,
            borderRightWidth: 1,
            borderRightColor: COLORS.border,
            backgroundColor: '#fff',
          }}
        >
          <ScrollView
            contentContainerStyle={{ paddingBottom: 80 }}
            showsVerticalScrollIndicator={false}
            testID="bk-two-pane-list"
          >
            {innerContent}
          </ScrollView>
        </View>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          {effectiveSelectedId ? (
            // Render the booking detail in an iframe (web only) so the
            // detail screen's hooks live in their own React tree —
            // avoids cross-tree "hooks order" instabilities and lets
            // us reuse the existing /bookings/[id] route 1:1.
            Platform.OS === 'web' ? (
              <View
                // eslint-disable-next-line react-native/no-inline-styles
                style={{ flex: 1, overflow: 'hidden' as any }}
              >
                {React.createElement('iframe' as any, {
                  src: `/bookings/${effectiveSelectedId}?embedded=1`,
                  key: effectiveSelectedId,
                  style: {
                    border: 0,
                    width: '100%',
                    height: '100%',
                    minHeight: 600,
                    background: COLORS.bg,
                  },
                  title: 'Booking detail',
                  testID: 'bk-two-pane-detail',
                })}
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
                <Text style={{ color: COLORS.textSecondary, fontFamily: FONTS.regular, textAlign: 'center' }}>
                  Two-pane layout is web-only. Tap a booking to open it on mobile.
                </Text>
              </View>
            )
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <Ionicons name="calendar-outline" size={48} color={COLORS.textDisabled} />
              <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontFamily: FONTS.regular, textAlign: 'center' }}>
                Select a booking from the left to view its details.
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }
  return innerContent;
}
/** Compact month calendar for the Dashboard Bookings panel. */
export function MonthGrid({
  cursor,
  items,
  onPickDay,
}: {
  cursor: Date;
  items: any[];
  onPickDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const cells: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    cells.push(d);
    d = addDays(d, 1);
  }
  const countFor = (day: Date) => {
    const iso = format(day, 'yyyy-MM-dd');
    return items.filter((b) => b.booking_date === iso).length;
  };
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View style={styles.monthGrid}>
      <View style={styles.monthRow}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <Text key={d} style={styles.monthDow}>{d}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.monthRow}>
          {row.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, new Date());
            const n = countFor(day);
            return (
              <TouchableOpacity
                key={day.toISOString()}
                onPress={() => onPickDay(day)}
                style={[styles.monthCell, !inMonth && styles.monthCellOther, isToday && styles.monthCellToday]}
                testID={`bk-month-${format(day, 'yyyy-MM-dd')}`}
              >
                <Text style={styles.monthCellText}>{format(day, 'd')}</Text>
                {n > 0 && (
                  <View style={styles.monthCellDot}>
                    <Text style={styles.monthCellDotText}>{n}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}
