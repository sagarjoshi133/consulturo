/**
 * Analytics Dashboard — Wave 4 (R · S · T)
 *
 * Single owner-only screen with three widget sections:
 *   • Month-to-date clinic widgets (OPDs, surgeries, revenue, etc.)
 *   • Top referring doctors (last 6 months)
 *   • Surgical outcome roll-up (last 12 months)
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useSafeBack } from '../../src/use-safe-back';
import { useDarkOverrides } from '../../src/dark-mode';
import { SkeletonCard } from '../../src/skeleton';
import { EmptyState } from '../../src/empty-state';
import {
  fetchDashboardWidgets,
  fetchReferrers,
  fetchOutcomes,
  type DashboardWidgets,
  type ReferrerStats,
  type OutcomeStats,
} from '../../src/wave4/api';

const INR = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function AnalyticsDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const safeBack = useSafeBack('/admin' as any);
  const d = useDarkOverrides();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [widgets, setWidgets] = useState<DashboardWidgets | null>(null);
  const [refs, setRefs] = useState<ReferrerStats | null>(null);
  const [out, setOut] = useState<OutcomeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, r, o] = await Promise.all([
        fetchDashboardWidgets().catch(() => null),
        fetchReferrers(6).catch(() => null),
        fetchOutcomes(12).catch(() => null),
      ]);
      setWidgets(w);
      setRefs(r);
      setOut(o);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  return (
    <SafeAreaView style={[styles.screen, d.screen]} edges={['top', 'bottom']}>
      <View style={[styles.header, d.surface]}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="analytics-back">
          <Ionicons name="arrow-back" size={22} color={d.colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, d.textP]}>Clinic Analytics</Text>
          <Text style={[styles.headerSub, d.textS]}>{widgets?.month || 'this month'}</Text>
        </View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error ? (
          <EmptyState icon="alert-circle" title="Couldn't load analytics" subtitle={error} tone="warn" />
        ) : null}

        {/* Section 1 — widgets */}
        <SectionHead title="This month" icon="stats-chart" />
        {loading ? (
          <View style={{ gap: 10 }}>
            <SkeletonCard height={70} />
            <SkeletonCard height={70} />
          </View>
        ) : widgets ? (
          <View style={styles.widgetGrid}>
            <Widget icon="people"     label="OPDs"           value={String(widgets.widgets.opd_count)} tone="#0284C7" />
            <Widget icon="cut"        label="Surgeries"      value={String(widgets.widgets.surgery_count)} tone="#DC2626" />
            <Widget icon="bed"        label="IPDs"           value={String(widgets.widgets.ipd_count)} tone="#059669" />
            <Widget icon="person-add" label="New patients"   value={String(widgets.widgets.new_patients)} tone="#7C3AED" />
            <Widget icon="cash"       label="Collected"      value={INR(widgets.widgets.revenue)} tone="#16A34A" wide />
            <Widget icon="hourglass"  label="Pending bills"  value={String(widgets.widgets.pending_receivables)} tone="#D97706" />
          </View>
        ) : null}

        {widgets?.widgets?.top_procedure?.name ? (
          <View style={styles.topProcCard}>
            <View style={styles.topProcIcon}><Ionicons name="trophy" size={18} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topProcLabel}>Top procedure this month</Text>
              <Text style={styles.topProcName}>{widgets.widgets.top_procedure.name}</Text>
            </View>
            <View style={styles.topProcBadge}>
              <Text style={styles.topProcCount}>{widgets.widgets.top_procedure.count}</Text>
            </View>
          </View>
        ) : null}

        <View style={{ height: 20 }} />

        {/* Section 2 — Referrers */}
        <SectionHead title="Top referrers" icon="git-network" subtitle={refs ? `last ${refs.window_months} months · ${refs.total_referred} patients` : ''} />
        {loading ? <SkeletonCard height={120} /> : refs && refs.top.length > 0 ? (
          <View style={[styles.card, d.surface]}>
            {refs.top.slice(0, 8).map((r, i) => {
              const max = refs.top[0]?.count || 1;
              const pct = Math.round((r.count / max) * 100);
              return (
                <View key={r.name + i} style={styles.refRow}>
                  <Text style={styles.refRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.refName} numberOfLines={1}>{r.name}</Text>
                    <View style={styles.refBarTrack}>
                      <View style={[styles.refBarFill, { width: `${pct}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.refCount}>{r.count}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState icon="git-network-outline" title="No referral data yet" subtitle='Bookings & Rx with a "Referred by" field will appear here.' />
        )}

        <View style={{ height: 20 }} />

        {/* Section 3 — Outcomes */}
        <SectionHead title="Surgical outcomes" icon="medical" subtitle={out ? `last ${out.window_months} months · ${out.total_surgeries} surgeries` : ''} />
        {loading ? <SkeletonCard height={140} /> : out && out.procedures.length > 0 ? (
          <View style={[styles.card, d.surface]}>
            {out.procedures.slice(0, 10).map((p) => (
              <View key={p.procedure} style={styles.outRow}>
                <Text style={styles.outProc} numberOfLines={1}>{p.procedure}</Text>
                <Text style={styles.outTotal}>{p.total}</Text>
                <View style={styles.outBars}>
                  <View style={[styles.outBar, { backgroundColor: '#10B981', flex: Math.max(p.success, 0.001) }]} />
                  <View style={[styles.outBar, { backgroundColor: '#EF4444', flex: Math.max(p.complications, 0.001) }]} />
                  <View style={[styles.outBar, { backgroundColor: '#E5E7EB', flex: Math.max(p.unknown, 0.001) }]} />
                </View>
                <Text style={styles.outRate}>{p.success_rate}%</Text>
              </View>
            ))}
            <View style={styles.legendRow}>
              <Legend dot="#10B981" label="Success" />
              <Legend dot="#EF4444" label="Complication" />
              <Legend dot="#E5E7EB" label="Unknown" />
            </View>
            <Text style={styles.muted}>Outcome is auto-classified from each surgery&apos;s `outcome` / `surgery_status` field. Set these explicitly on the OR note for accurate stats.</Text>
          </View>
        ) : (
          <EmptyState icon="medical-outline" title="No surgical outcomes recorded" subtitle="Track outcomes on the OR note (Success / Complication / Discharged) to populate this view." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHead({ title, subtitle, icon }: { title: string; subtitle?: string; icon: any }) {
  return (
    <View style={styles.sectionHead}>
      <Ionicons name={icon} size={16} color={COLORS.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>· {subtitle}</Text> : null}
    </View>
  );
}

function Widget({ icon, label, value, tone, wide }: { icon: any; label: string; value: string; tone: string; wide?: boolean }) {
  const d = useDarkOverrides();
  return (
    <View style={[styles.widget, { borderColor: tone + '33' }, wide ? { width: '100%' } : null, d.surface]}>
      <View style={[styles.widgetIcon, { backgroundColor: tone + '18' }]}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text style={[styles.widgetVal, { color: tone }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.widgetLbl, d.textS]}>{label}</Text>
    </View>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, flexShrink: 1 },

  widgetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  widget: {
    width: '48%',
    backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1,
    padding: 12, gap: 4,
  },
  widgetIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  widgetVal: { ...FONTS.h2, fontSize: 22 },
  widgetLbl: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  topProcCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.md,
    padding: 12, marginTop: 10,
  },
  topProcIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  topProcLabel: { ...FONTS.body, color: '#E0F2F5', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  topProcName: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15 },
  topProcBadge: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  topProcCount: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12 },

  refRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  refRank: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13, width: 18 },
  refName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  refBarTrack: { height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', marginTop: 4 },
  refBarFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  refCount: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },

  outRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  outProc: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12.5, flex: 1.5 },
  outTotal: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, width: 24 },
  outBars: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', flex: 1.5 },
  outBar: { height: 8 },
  outRate: { ...FONTS.bodyMedium, color: '#059669', fontSize: 12, width: 40, textAlign: 'right' },
  legendRow: { flexDirection: 'row', gap: 12, marginTop: 8, justifyContent: 'center' },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 8, lineHeight: 16 },
});
