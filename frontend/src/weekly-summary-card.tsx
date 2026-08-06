/**
 * Weekly Summary widget — dashboard card that lets the owner peek
 * at the Monday-morning briefing on demand and (optionally) fire it
 * to their inbox in a single tap.
 *
 * Shape:
 *  ┌────────────────────────────────────────────────────────┐
 *  │ 📊 Weekly Summary               [Last week ▼] [↗ Email]│
 *  │ ─────────────────────────────────────────────────────  │
 *  │  KPI · KPI · KPI                                       │
 *  │  KPI · KPI · KPI                                       │
 *  │  ─                                                     │
 *  │  AI narrative (4 short paragraphs, italic accent bar)  │
 *  │  ─                                                     │
 *  │  Top complaints · diagnoses · meds (collapsible)       │
 *  └────────────────────────────────────────────────────────┘
 *
 * State machine:
 *  idle → loading → loaded | error
 *  email button on loaded → emailing → email_sent | email_failed
 *
 * The endpoint runs every aggregation + LLM call SYNCHRONOUSLY in a
 * single request → keep the spinner visible until response. Claude
 * typically returns in ~3-5 seconds for this payload size.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
  Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { useToast } from './toast';

type Stats = {
  bookings_total: number;
  bookings_inperson: number;
  bookings_video: number;
  bookings_completed: number;
  bookings_cancelled: number;
  patients_new: number;
  patients_returning: number;
  surgeries_done: number;
  ipd_admits: number;
  ipd_discharged: number;
  rx_finalised: number;
  revenue_inr: number;
  revenue_pending_inr: number;
  receipts_count: number;
  reviews_new: number;
  reviews_avg_rating: number | null;
  google_rating: number | null;
  google_total_ratings: number | null;
  top_complaints: Array<[string, number]>;
  top_diagnoses: Array<[string, number]>;
  top_medicines: Array<[string, number]>;
};

type Resp = {
  window: { label: string; start: string; end: string };
  clinic_name: string;
  stats: Stats;
  narrative: string;
  html: string;
  email_sent?: boolean | null;
  email_to?: string | null;
};

const WEEK_OPTIONS = [
  { label: 'This week', offset: 0 },
  { label: 'Last week', offset: 1 },
  { label: '2 weeks ago', offset: 2 },
  { label: '3 weeks ago', offset: 3 },
];

export default function WeeklySummaryCard() {
  const toast = useToast();
  const [offset, setOffset] = useState<number>(1); // default to LAST week (full data)
  const [showPicker, setShowPicker] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [expandedTop, setExpandedTop] = useState(false);

  const load = useCallback(async (newOffset: number) => {
    setLoading(true);
    try {
      const r = await api.get(`/admin/weekly-summary?week_offset=${newOffset}`);
      setData(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Failed to generate';
      Alert.alert('Weekly summary failed', msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(offset); }, [load, offset]);

  const emailNow = useCallback(async () => {
    setEmailing(true);
    try {
      const r = await api.get(`/admin/weekly-summary?week_offset=${offset}&email=true`);
      setData(r.data);
      if (r.data?.email_sent) {
        toast.success(`Sent to ${r.data.email_to || 'your inbox'}`);
      } else {
        Alert.alert(
          'Email queued, but Resend reported no success',
          'Check Settings → OWNER_EMAIL and that the Resend domain is verified.',
        );
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Email send failed';
      Alert.alert('Email failed', msg);
    } finally {
      setEmailing(false);
    }
  }, [offset, toast]);

  return (
    <View style={styles.card} testID="weekly-summary-card">
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.iconCircle}>
            <Ionicons name="stats-chart" size={16} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Weekly Summary</Text>
            <Text style={styles.headerSub}>{data?.window?.label || 'Loading…'}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => setShowPicker((v) => !v)}
            testID="weekly-summary-picker"
          >
            <Text style={styles.pickerBtnText}>{WEEK_OPTIONS.find((w) => w.offset === offset)?.label || 'Last week'}</Text>
            <Ionicons name="chevron-down" size={12} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Picker dropdown */}
      {showPicker ? (
        <View style={styles.pickerDropdown}>
          {WEEK_OPTIONS.map((w) => (
            <TouchableOpacity
              key={w.offset}
              style={[styles.pickerRow, w.offset === offset && styles.pickerRowActive]}
              onPress={() => { setOffset(w.offset); setShowPicker(false); }}
            >
              {w.offset === offset ? <Ionicons name="checkmark" size={14} color={COLORS.primary} /> : <View style={{ width: 14 }} />}
              <Text style={[styles.pickerRowText, w.offset === offset && { color: COLORS.primary }]}>{w.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Body */}
      {loading || !data ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Crunching numbers + asking Claude…</Text>
        </View>
      ) : (
        <>
          {/* KPI grid (3×2) */}
          <View style={styles.kpiGrid}>
            <Kpi label="Bookings" value={data.stats.bookings_total} sub={`${data.stats.bookings_inperson} in-person · ${data.stats.bookings_video} video`} />
            <Kpi label="New patients" value={data.stats.patients_new} sub="registered" />
            <Kpi label="Surgeries" value={data.stats.surgeries_done} sub={`IPD: ${data.stats.ipd_admits}`} />
            <Kpi label="Revenue" value={`₹${formatINR(data.stats.revenue_inr)}`} sub={`${data.stats.receipts_count} receipts`} />
            <Kpi label="Pending" value={`₹${formatINR(data.stats.revenue_pending_inr)}`} sub="to collect" />
            <Kpi label="Rating" value={(data.stats.reviews_avg_rating ?? data.stats.google_rating ?? '—') + '★'} sub={`${data.stats.reviews_new} new`} />
          </View>

          {/* Claude narrative */}
          <View style={styles.narrativeBox}>
            <View style={styles.narrativeLeftBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.narrativeLabel}>OWNER BRIEFING</Text>
              <Text style={styles.narrativeText}>{data.narrative}</Text>
            </View>
          </View>

          {/* Top-N (collapsible) */}
          {(data.stats.top_complaints.length + data.stats.top_diagnoses.length + data.stats.top_medicines.length > 0) ? (
            <TouchableOpacity
              onPress={() => setExpandedTop((v) => !v)}
              style={styles.topToggle}
            >
              <Text style={styles.topToggleText}>{expandedTop ? 'Hide' : 'Show'} top complaints / diagnoses / meds</Text>
              <Ionicons name={expandedTop ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.primary} />
            </TouchableOpacity>
          ) : null}
          {expandedTop ? (
            <View style={styles.topGrid}>
              <TopBlock title="Top chief complaints" rows={data.stats.top_complaints} />
              <TopBlock title="Top diagnoses" rows={data.stats.top_diagnoses} />
              <TopBlock title="Top prescribed meds" rows={data.stats.top_medicines} />
            </View>
          ) : null}

          {/* Email CTA */}
          <TouchableOpacity
            style={[styles.emailBtn, emailing && { opacity: 0.6 }]}
            onPress={emailNow}
            disabled={emailing}
            testID="weekly-summary-email-btn"
          >
            {emailing ? <ActivityIndicator color="#fff" /> : <Ionicons name="mail" size={15} color="#fff" />}
            <Text style={styles.emailBtnText}>
              {emailing ? 'Sending…' : 'Email me this briefing'}
            </Text>
          </TouchableOpacity>
          {data.email_sent === true ? (
            <Text style={styles.emailHint}>✓ Sent to {data.email_to}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={styles.kpiCell}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{String(value)}</Text>
      {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function TopBlock({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  if (!rows || rows.length === 0) return null;
  return (
    <View style={styles.topBlock}>
      <Text style={styles.topBlockTitle}>{title}</Text>
      {rows.slice(0, 5).map((r, i) => (
        <View key={`${title}-${i}`} style={styles.topBlockRow}>
          <Text style={styles.topBlockName} numberOfLines={1}>{r[0]}</Text>
          <Text style={styles.topBlockCount}>{r[1]}×</Text>
        </View>
      ))}
    </View>
  );
}

function formatINR(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff', borderRadius: RADIUS.card,
    padding: 16, marginTop: 14, marginBottom: 6,
    borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0E7C8B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12 },
      android: { elevation: 2 },
      web: { boxShadow: '0 6px 16px rgba(14,124,139,0.12)' as any },
    }),
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...FONTS.bodyMedium, fontSize: 14, color: COLORS.textPrimary, fontWeight: '700' },
  headerSub: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#f0f9ff', borderRadius: 999,
    borderWidth: 1, borderColor: '#bae6fd',
  },
  pickerBtnText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  pickerDropdown: {
    marginTop: 6, marginBottom: 4,
    backgroundColor: '#f8fafc', borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border, paddingVertical: 4,
  },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  pickerRowActive: { backgroundColor: '#eff6ff' },
  pickerRowText: { ...FONTS.body, fontSize: 12.5, color: COLORS.textPrimary },

  loadingBox: { paddingVertical: 28, alignItems: 'center', gap: 8 },
  loadingText: { ...FONTS.body, fontSize: 11.5, color: COLORS.textSecondary },

  kpiGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    marginTop: 14, marginHorizontal: -3,
  },
  kpiCell: {
    width: '33.333%', paddingHorizontal: 3, paddingVertical: 3,
  },
  kpiLabel: { fontSize: 9.5, fontWeight: '700', color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase' },
  kpiValue: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary, marginTop: 2 },
  kpiSub: { fontSize: 9.5, color: '#94a3b8', marginTop: 1 },

  narrativeBox: {
    flexDirection: 'row',
    marginTop: 18, padding: 12, paddingLeft: 14,
    backgroundColor: '#fff7ed', borderRadius: 10,
    gap: 10,
  },
  narrativeLeftBar: { width: 3, backgroundColor: '#f59e0b', borderRadius: 2 },
  narrativeLabel: { fontSize: 9.5, fontWeight: '700', color: '#92400e', letterSpacing: 1, textTransform: 'uppercase' },
  narrativeText: { ...FONTS.body, fontSize: 12.5, color: '#0f172a', marginTop: 4, lineHeight: 18 },

  topToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, alignSelf: 'flex-start' },
  topToggleText: { ...FONTS.bodyMedium, fontSize: 11.5, color: COLORS.primary },
  topGrid: { marginTop: 10, gap: 10 },
  topBlock: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  topBlockTitle: { fontSize: 10, fontWeight: '700', color: '#64748b', letterSpacing: 0.5, textTransform: 'uppercase' },
  topBlockRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  topBlockName: { ...FONTS.body, fontSize: 12, color: '#334155', flex: 1 },
  topBlockCount: { ...FONTS.bodyMedium, fontSize: 11, color: '#94a3b8', marginLeft: 8 },

  emailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, paddingVertical: 11, borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  emailBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  emailHint: { textAlign: 'center', marginTop: 6, fontSize: 11, color: '#16a34a', fontWeight: '600' },
});
