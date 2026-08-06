/**
 * Billing & Receipts hub — Phase 5.9 revamp.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Billing & Receipts                                  [+]    │
 *   │   • Quick range chips  Today · Yesterday · 7 days · Pick    │
 *   │   • Hero collection card (paid + balance + count)           │
 *   │   • Mode mini-grid                                          │
 *   │   • Filter row                                              │
 *   │   • Grouped receipts                                        │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Constraint: receipt_date can NEVER be a future date (blocked at the
 * <DateField max=today> level on /billing/index and /billing/new).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DateField } from '../../src/date-picker';
import { parseUIDate, displayDate } from '../../src/date';

type DailyCollection = {
  date: string;
  count: number;
  total: number;
  paid: number;
  balance: number;
  by_mode: Record<string, number>;
  by_service: Record<string, number>;
};

type Receipt = {
  receipt_id: string;
  receipt_no: string;
  patient_name?: string;
  patient_phone?: string;
  total?: number;
  paid?: number;
  balance?: number;
  mode?: string;
  receipt_date?: string;
  created_at?: string;
};

type PendingBooking = {
  booking_id: string;
  patient_name?: string;
  patient_phone?: string;
  registration_no?: string;
  booking_date?: string;
  booking_time?: string;
  reason?: string;
  service_type?: string;
  amount_inr?: number;
  payment_status?: string;
};

const MODES = ['Cash', 'UPI', 'Card', 'Cheque', 'Other'];

function fmtINR(n: any) {
  const v = Number(n ?? 0);
  return '₹ ' + v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function todayIST(): string {
  const now = new Date();
  // IST = UTC + 5h30m
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso: string): string {
  // 2026-05-31 → "31 May" if same year else "31 May 2025"
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  const now = new Date(todayIST() + 'T00:00:00Z');
  const sameY = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', ...(sameY ? {} : { year: 'numeric' }),
  });
}

const MODE_META: Record<string, { icon: any; color: string }> = {
  Cash: { icon: 'cash-outline', color: '#16A34A' },
  UPI: { icon: 'phone-portrait-outline', color: '#7C3AED' },
  'UPI (Direct)': { icon: 'qr-code-outline', color: '#7C3AED' },
  'UPI (Razorpay)': { icon: 'phone-portrait', color: '#5B21B6' },
  Card: { icon: 'card-outline', color: '#2563EB' },
  'Card (Razorpay)': { icon: 'card', color: '#1D4ED8' },
  Wallet: { icon: 'wallet-outline', color: '#0EA5E9' },
  'Wallet (Razorpay)': { icon: 'wallet', color: '#0369A1' },
  Cheque: { icon: 'document-text-outline', color: '#F59E0B' },
  Other: { icon: 'ellipsis-horizontal-outline', color: '#6B7280' },
  'Pending Razorpay': { icon: 'time-outline', color: '#F59E0B' },
};

export default function BillingHub() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState<string>(todayIST());
  const [summary, setSummary] = useState<DailyCollection | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [pending, setPending] = useState<PendingBooking[]>([]);
  const [pendingOpen, setPendingOpen] = useState<boolean>(true);
  const [modeFilter, setModeFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quickRange, setQuickRange] = useState<'today' | 'yest' | 'pick'>('today');

  // ───────────── Top-level view toggle ─────────────
  // Two top-tabs requested by Dr Joshi (Jun-16):
  //   "Today"       → existing day-based collection + summary view
  //   "All Receipts" → flat reverse-chrono list of EVERY receipt ever
  //                   recorded by this clinic; tap → /billing/{id}
  // We keep both UIs in this file so the user doesn't lose the
  // surrounding context (hero card / quick chips / record button)
  // when bouncing between the two views.
  const [view, setView] = useState<'daily' | 'all'>('daily');
  const [allReceipts, setAllReceipts] = useState<Receipt[]>([]);
  const [allLoading, setAllLoading] = useState(false);

  // ───────────── Permission gating ─────────────
  const role = (user?.role || '') as string;
  const isOwnerTier = ['super_owner', 'primary_owner', 'partner', 'owner'].includes(role);
  // Reception / assistant only get in when explicitly granted via Team
  // panel — owner tier is implicit.
  const hasBillingPerm = isOwnerTier
    || !!(user as any)?.can_manage_billing
    || !!(user as any)?.dashboard_full_access;

  const today = useMemo(() => todayIST(), []);
  const [apiUnavailable, setApiUnavailable] = useState(false);

  const load = useCallback(async () => {
    if (!hasBillingPerm) { setLoading(false); return; }
    setLoading(true);
    try {
      const [s, r, p] = await Promise.all([
        api.get('/receipts/daily-collection', { params: { date } }),
        api.get('/receipts', { params: { date, ...(modeFilter ? { mode: modeFilter } : {}) } }),
        api.get('/bookings/pending-payments').catch(() => ({ data: [] })),
      ]);
      setSummary(s.data || null);
      setReceipts(Array.isArray(r.data) ? r.data : []);
      setPending(Array.isArray(p.data) ? p.data : []);
      setApiUnavailable(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        setApiUnavailable(true);
        setSummary(null);
        setReceipts([]);
        setPending([]);
      } else {
        toast.error(e?.response?.data?.detail || 'Could not load receipts');
      }
    } finally {
      setLoading(false);
    }
  }, [date, modeFilter, hasBillingPerm, toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ─── All-receipts loader (latest first, up to 500) ──────────────
  // Backend already supports filterless list + sorts by
  // (receipt_date desc, created_at desc) so latest-first is free.
  // 500 cap matches the server limit; if a clinic exceeds that, we
  // can later add cursor-based pagination here.
  const loadAll = useCallback(async () => {
    if (!hasBillingPerm) { setAllLoading(false); return; }
    setAllLoading(true);
    try {
      const r = await api.get('/receipts', { params: { limit: 500 } });
      setAllReceipts(Array.isArray(r.data) ? r.data : []);
      setApiUnavailable(false);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) {
        setApiUnavailable(true);
        setAllReceipts([]);
      } else {
        toast.error(e?.response?.data?.detail || 'Could not load receipts');
      }
    } finally {
      setAllLoading(false);
    }
  }, [hasBillingPerm, toast]);

  // Lazy-load the "all" list only when the user actually switches
  // to that tab — keeps the default Today view fast on cold start.
  React.useEffect(() => {
    if (view === 'all' && allReceipts.length === 0 && !allLoading) {
      void loadAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (view === 'all') {
      await loadAll();
    } else {
      await load();
    }
    setRefreshing(false);
  }, [load, loadAll, view]);

  // Compute mode breakdown for the mini-grid. Empty modes are
  // intentionally INCLUDED (with ₹0) so the grid is always 4-wide and
  // the user sees what's possible at a glance.
  const modeBreakdownGrid = useMemo(() => {
    const by = summary?.by_mode || {};
    return ['Cash', 'UPI', 'Card', 'Cheque'].map((m) => ({
      mode: m,
      value: Number(by[m] || 0),
    }));
  }, [summary]);

  const serviceBreakdown = useMemo(() => {
    if (!summary) return [];
    return Object.entries(summary.by_service || {}).sort((a, b) => b[1] - a[1]);
  }, [summary]);

  const avgTicket = useMemo(() => {
    const c = summary?.count || 0;
    if (!c) return 0;
    return (summary?.paid || 0) / c;
  }, [summary]);

  // ───────────── Date helpers ─────────────
  const setToday = () => { setDate(today); setQuickRange('today'); };
  const setYesterday = () => { setDate(addDays(today, -1)); setQuickRange('yest'); };
  const dateLabel = (() => {
    if (date === today) return 'Today';
    if (date === addDays(today, -1)) return 'Yesterday';
    return prettyDate(date);
  })();

  if (!hasBillingPerm) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} title="Billing & Receipts" />
        <View style={styles.permGate} testID="bill-perm-denied">
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.permTitle}>Permission required</Text>
          <Text style={styles.permSub}>
            Ask the owner to enable "Can manage Billing & Receipts" for your account in
            Team → Edit member.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
        title="Billing & Receipts"
        rightIcon="add"
        onRightPress={() => router.push('/billing/new' as any)}
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* ──── Unified range row — Today · Yesterday · All · Pick a date ────
            Single row (per Dr Joshi Jun-16 — two stacked rows were
            confusing). The first three pills are "data-source"
            choices; "Pick a date" reveals the date picker below. */}
        <View style={styles.rangeRow}>
          <RangeChip
            label="Today"
            active={view === 'daily' && date === today}
            onPress={() => { setView('daily'); setToday(); }}
            testID="bill-range-today"
          />
          <RangeChip
            label="Yesterday"
            active={view === 'daily' && date === addDays(today, -1)}
            onPress={() => { setView('daily'); setYesterday(); }}
            testID="bill-range-yest"
          />
          <RangeChip
            label="All"
            active={view === 'all'}
            onPress={() => setView('all')}
            icon="albums-outline"
            testID="bill-view-tab-all"
          />
          <RangeChip
            label="Pick a date"
            active={view === 'daily' && (quickRange === 'pick' || (date !== today && date !== addDays(today, -1)))}
            onPress={() => { setView('daily'); setQuickRange('pick'); }}
            icon="calendar-outline"
            testID="bill-range-pick"
          />
        </View>

        {view === 'all' ? (
          /* ───────────── All Receipts tab ─────────────
             Backend already sorts (receipt_date desc, created_at desc)
             so just render the rows. Tap → /billing/{id}. */
          allLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : apiUnavailable ? (
            <View style={styles.apiDownCard} testID="bill-api-unavailable-all">
              <Ionicons name="cloud-offline" size={42} color={COLORS.warning} />
              <Text style={styles.apiDownTitle}>Backend update needed</Text>
              <Text style={styles.apiDownText}>
                The Billing & Receipts API isn&apos;t available on this server yet.
              </Text>
              <TouchableOpacity onPress={loadAll} style={styles.apiDownRetry}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.apiDownRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : allReceipts.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIcon}>
                <Ionicons name="receipt-outline" size={28} color={COLORS.textDisabled} />
              </View>
              <Text style={styles.emptyTitle}>No receipts yet</Text>
              <Text style={styles.emptySub}>
                Recorded payments will appear here in reverse-chronological order.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/billing/new' as any)}
                style={styles.createCta}
                testID="bill-record-payment-empty-all"
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.createCtaText}>Record a payment</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.listHdr}>
                {allReceipts.length === 500
                  ? 'Showing 500 most recent · pull to refresh'
                  : `Latest first · ${allReceipts.length} receipt${allReceipts.length === 1 ? '' : 's'}`}
              </Text>
              <View style={styles.receiptList}>
                {allReceipts.map((r) => {
                  const meta = MODE_META[r.mode || 'Other'] || MODE_META['Other'];
                  return (
                    <TouchableOpacity
                      key={r.receipt_id}
                      onPress={() => router.push(`/billing/${r.receipt_id}` as any)}
                      activeOpacity={0.85}
                      style={styles.row}
                      testID={`bill-all-row-${r.receipt_id}`}
                    >
                      <View style={[styles.rowBadge, { backgroundColor: meta.color + '1a' }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.color} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {r.patient_name || r.patient_phone || 'Walk-in patient'}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {r.receipt_no}
                          {r.receipt_date ? ` · ${prettyDate(r.receipt_date)}` : ''}
                          {' · '}{r.mode || 'Other'}
                          {(r.balance || 0) > 0 ? ` · Bal ${fmtINR(r.balance)}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.rowAmount, (r.balance || 0) > 0 && { color: COLORS.warning }]}>
                          {fmtINR(r.paid ?? r.total)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )
        ) : (
        <>
        {/* (The unified range row above already shows Today /
            Yesterday / Pick a date — we don't repeat them here.) */}

        {/* Date picker — only shows when "Pick" is active OR current
            date isn't today/yesterday. Calendar max is locked to TODAY
            so a future receipt can never be created. */}
        {(quickRange === 'pick' || (date !== today && date !== addDays(today, -1))) && (
          <View style={styles.datePickerCard}>
            <Text style={styles.smallLabel}>SHOWING COLLECTION FOR</Text>
            <View style={styles.datePickerInner}>
              <View style={{ flex: 1 }}>
                <DateField
                  value={displayDate(date)}
                  onChange={(v) => {
                    const iso = parseUIDate(v);
                    if (iso && iso > today) {
                      toast.error('Future dates are not allowed');
                      return;
                    }
                    if (iso) setDate(iso);
                  }}
                  maximumDate={new Date(today + 'T00:00:00Z')}
                  testID="bill-date-picker"
                />
              </View>
              <TouchableOpacity onPress={setToday} style={styles.todayPill} testID="bill-today">
                <Ionicons name="today-outline" size={13} color={COLORS.primary} />
                <Text style={styles.todayPillText}>Today</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Loading / api-down / content */}
        {loading ? (
          <View style={{ padding: 40, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : apiUnavailable ? (
          <View style={styles.apiDownCard} testID="bill-api-unavailable">
            <Ionicons name="cloud-offline" size={42} color={COLORS.warning} />
            <Text style={styles.apiDownTitle}>Backend update needed</Text>
            <Text style={styles.apiDownText}>
              The Billing & Receipts API isn't available on this server yet.
              Ask the admin to redeploy the production backend.
            </Text>
            <TouchableOpacity onPress={load} style={styles.apiDownRetry} testID="bill-api-retry">
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={styles.apiDownRetryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ────── Pending payments (collapsible) ────── */}
            {pending.length > 0 && (
              <View style={styles.pendingCard} testID="bill-pending-card">
                <TouchableOpacity
                  onPress={() => setPendingOpen((v) => !v)}
                  style={styles.pendingHeader}
                  activeOpacity={0.8}
                  testID="bill-pending-toggle"
                >
                  <View style={styles.pendingHeaderIcon}>
                    <Ionicons name="time-outline" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pendingHeaderTitle}>
                      Pending payments · {pending.length}
                    </Text>
                    <Text style={styles.pendingHeaderSub}>
                      Confirmed bookings awaiting settlement
                    </Text>
                  </View>
                  <Ionicons
                    name={pendingOpen ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={COLORS.warning}
                  />
                </TouchableOpacity>
                {pendingOpen && (
                  <View style={styles.pendingBody}>
                    {pending.map((b) => (
                      <View key={b.booking_id} style={styles.pendingRow}>
                        <View style={styles.pendingRowBadge}>
                          <Ionicons name="alert-circle" size={16} color={COLORS.warning} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.pendingPatient} numberOfLines={1}>
                            {b.patient_name || b.patient_phone || 'Patient'}
                          </Text>
                          <Text style={styles.pendingMeta} numberOfLines={1}>
                            {prettyDate(b.booking_date || '')}
                            {b.booking_time ? ` · ${b.booking_time}` : ''}
                            {b.reason ? ` · ${b.reason}` : ''}
                          </Text>
                          {b.registration_no ? (
                            <Text style={styles.pendingRegNo}>Reg. {b.registration_no}</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.pendingAmount}>{fmtINR(b.amount_inr)}</Text>
                          <TouchableOpacity
                            onPress={() =>
                              router.push({
                                pathname: '/billing/new',
                                params: {
                                  patient_phone: b.patient_phone || '',
                                  patient_name: b.patient_name || '',
                                  booking_id: b.booking_id,
                                  amount: String(b.amount_inr || ''),
                                  description: b.reason || 'Consultation',
                                  service_type: 'Consultation',
                                },
                              } as any)
                            }
                            style={styles.settleBtn}
                            testID={`bill-settle-${b.booking_id}`}
                          >
                            <Ionicons name="checkmark-circle" size={13} color="#fff" />
                            <Text style={styles.settleBtnText}>Settle now</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ────── Hero summary card ────── */}
            <View style={styles.heroCard} testID="bill-hero">
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}>
                  <MaterialCommunityIcons name="cash-multiple" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLabel}>{dateLabel} · collection</Text>
                  <Text style={styles.heroSub}>
                    {(summary?.count || 0)} receipt{(summary?.count || 0) === 1 ? '' : 's'}
                    {avgTicket ? ` · avg ${fmtINR(avgTicket)}` : ''}
                  </Text>
                </View>
              </View>
              <Text style={styles.heroTotal}>{fmtINR(summary?.paid)}</Text>
              {(summary?.balance || 0) > 0 ? (
                <View style={styles.balanceChip}>
                  <Ionicons name="alert-circle" size={13} color="#fff" />
                  <Text style={styles.balanceText}>Balance pending {fmtINR(summary?.balance)}</Text>
                </View>
              ) : null}
            </View>

            {/* ────── Mode mini-grid (always shows 4 tiles) ────── */}
            <View style={styles.modeGrid}>
              {modeBreakdownGrid.map(({ mode, value }) => {
                const meta = MODE_META[mode];
                const empty = !value;
                return (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setModeFilter(modeFilter === mode ? '' : mode)}
                    style={[
                      styles.modeTile,
                      modeFilter === mode && styles.modeTileActive,
                      empty && { opacity: 0.55 },
                    ]}
                    testID={`bill-mode-tile-${mode}`}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.modeIconWrap, { backgroundColor: meta.color + '1a' }]}>
                      <Ionicons name={meta.icon} size={15} color={meta.color} />
                    </View>
                    <Text style={styles.modeLabel}>{mode}</Text>
                    <Text style={styles.modeValue} numberOfLines={1}>{fmtINR(value)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ────── Service breakdown (compact) ────── */}
            {serviceBreakdown.length > 0 && (
              <View style={styles.serviceCard}>
                <Text style={styles.serviceHdr}>By service</Text>
                {serviceBreakdown.map(([s, v]) => (
                  <View key={s} style={styles.serviceRow}>
                    <Ionicons name="briefcase-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.serviceLabel}>{s}</Text>
                    <Text style={styles.serviceValue}>{fmtINR(v)}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ────── Filter row (only render Other / Clear; tap-tiles
                       above already handle the 4 main modes). ────── */}
            {modeFilter ? (
              <View style={styles.activeFilterRow}>
                <Text style={styles.activeFilterLabel}>Filter:</Text>
                <View style={styles.activeFilterChip}>
                  <Text style={styles.activeFilterText}>{modeFilter}</Text>
                  <TouchableOpacity onPress={() => setModeFilter('')} hitSlop={8} testID="bill-filter-clear">
                    <Ionicons name="close" size={14} color={COLORS.primary} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => setModeFilter('Other')}
                  style={[styles.otherChip, modeFilter === 'Other' && styles.otherChipActive]}
                  testID="bill-filter-other"
                >
                  <Text style={[styles.otherChipText, modeFilter === 'Other' && { color: '#fff' }]}>Other</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.activeFilterRow}>
                <TouchableOpacity
                  onPress={() => setModeFilter('Other')}
                  style={styles.otherChip}
                  testID="bill-filter-other"
                >
                  <Ionicons name="ellipsis-horizontal" size={12} color={COLORS.primary} />
                  <Text style={styles.otherChipText}>Other modes</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ────── Receipts list ────── */}
            <Text style={styles.listHdr}>Receipts · {receipts.length}</Text>
            {receipts.length === 0 ? (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="receipt-outline" size={28} color={COLORS.textDisabled} />
                </View>
                <Text style={styles.emptyTitle}>No receipts on this day</Text>
                <Text style={styles.emptySub}>
                  Recorded payments will appear here.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/billing/new' as any)}
                  style={styles.createCta}
                  testID="bill-record-payment"
                >
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.createCtaText}>Record a payment</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.receiptList}>
                {receipts.map((r) => {
                  const meta = MODE_META[r.mode || 'Other'] || MODE_META['Other'];
                  return (
                    <TouchableOpacity
                      key={r.receipt_id}
                      onPress={() => router.push(`/billing/${r.receipt_id}` as any)}
                      activeOpacity={0.85}
                      style={styles.row}
                      testID={`bill-row-${r.receipt_id}`}
                    >
                      <View style={[styles.rowBadge, { backgroundColor: meta.color + '1a' }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.color} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {r.patient_name || r.patient_phone || 'Walk-in patient'}
                        </Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {r.receipt_no} · {r.mode || 'Other'}
                          {(r.balance || 0) > 0 ? ` · Bal ${fmtINR(r.balance)}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.rowAmount, (r.balance || 0) > 0 && { color: COLORS.warning }]}>
                          {fmtINR(r.paid ?? r.total)}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
        </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ───────────────── Sub-components ─────────────────

function TopBar({ onBack, title, rightIcon, onRightPress }: {
  onBack: () => void;
  title: string;
  rightIcon?: any;
  onRightPress?: () => void;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={10}>
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {rightIcon && onRightPress ? (
        <TouchableOpacity onPress={onRightPress} style={styles.headerActionBtn} hitSlop={10} testID="bill-header-new">
          <Ionicons name={rightIcon} size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function RangeChip({ label, active, onPress, icon, testID }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: any;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.rangeChip, active && styles.rangeChipActive]}
      testID={testID}
      activeOpacity={0.7}
    >
      {icon ? (
        <Ionicons name={icon} size={13} color={active ? '#fff' : COLORS.primary} />
      ) : null}
      <Text style={[styles.rangeText, active && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  headerActionBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },

  // View tabs — "Today" vs "All Receipts" (Jun-16 spec).
  viewTabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  viewTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
  },
  viewTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  viewTabText: {
    ...FONTS.bodyMedium,
    fontSize: 13,
    color: COLORS.primary,
  },
  viewTabBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 11,
    backgroundColor: COLORS.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewTabBadgeText: {
    ...FONTS.bodyMedium,
    fontSize: 11,
    color: COLORS.primary,
  },

  // Range chips
  rangeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  rangeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  rangeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rangeText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  // Date picker card
  datePickerCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 12,
  },
  smallLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, marginBottom: 6 },
  datePickerInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: COLORS.primary + '14',
    borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  todayPillText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  // Hero summary
  heroCard: {
    backgroundColor: COLORS.primary,
    padding: 18, borderRadius: RADIUS.lg,
    marginBottom: 12,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroLabel: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 2 },
  heroTotal: { ...FONTS.h1, color: '#fff', fontSize: 38, marginTop: 12, letterSpacing: -0.5 },
  balanceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, marginTop: 10,
  },
  balanceText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },

  // Pending payments collapsible
  pendingCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: RADIUS.lg,
    marginBottom: 14,
    overflow: 'hidden',
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
  },
  pendingHeaderIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingHeaderTitle: { ...FONTS.bodyMedium, color: '#92400E', fontSize: 14 },
  pendingHeaderSub: { ...FONTS.body, color: '#A16207', fontSize: 11, marginTop: 1 },
  pendingBody: {
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
    backgroundColor: '#fff',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pendingRowBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.warning + '1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingPatient: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  pendingMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  pendingRegNo: { ...FONTS.body, color: COLORS.primary, fontSize: 10, marginTop: 1 },
  pendingAmount: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  settleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginTop: 4,
  },
  settleBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11 },

  // Mode mini-grid
  modeGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginHorizontal: -4, marginBottom: 12,
  },
  modeTile: {
    width: '50%', padding: 4,
  },
  modeTileActive: {},
  modeIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  modeLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, textTransform: 'uppercase' },
  modeValue: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginTop: 2 },

  // Service breakdown
  serviceCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 12,
  },
  serviceHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', fontSize: 10, marginBottom: 6 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  serviceLabel: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1 },
  serviceValue: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  // Mode filter active state
  activeFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  activeFilterLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10 },
  activeFilterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: COLORS.primary + '14',
    borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  activeFilterText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  otherChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#fff',
    borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
  },
  otherChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  otherChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  // Receipts
  listHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 4, marginBottom: 10, fontSize: 10 },
  receiptList: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  rowBadge: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  rowMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  rowAmount: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 15 },

  // Empty
  emptyCard: {
    alignItems: 'center', padding: 28,
    backgroundColor: '#fff', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.bg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  emptyTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 14, textAlign: 'center' },
  createCta: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18, paddingVertical: 11,
    borderRadius: RADIUS.pill,
  },
  createCtaText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  // Permission gate
  permGate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
  permTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  permSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', maxWidth: 320 },

  // API down
  apiDownCard: {
    alignItems: 'center', padding: 28,
    backgroundColor: COLORS.warning + '10',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.warning + '40',
    borderStyle: 'dashed', marginTop: 8,
  },
  apiDownTitle: { ...FONTS.h3, color: COLORS.warning, marginTop: 12, fontSize: 16, textAlign: 'center' },
  apiDownText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center', lineHeight: 18 },
  apiDownRetry: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    backgroundColor: COLORS.warning,
    borderRadius: RADIUS.pill,
    marginTop: 16,
  },
  apiDownRetryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
});
