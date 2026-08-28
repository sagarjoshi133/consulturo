/**
 * Monthly Revenue Report (owner) — collected vs waived vs outstanding
 * across the month's encounters, with a per-day breakdown.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type DayRow = { day: string; collected: number; waived: number; outstanding: number };
type Report = {
  month: string;
  collected: number;
  waived_total: number;
  outstanding: number;
  counts: { total: number; paid: number; pending: number; waived: number };
  series: DayRow[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shiftMonth(mon: string, delta: number): string {
  const [y, m] = mon.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function RevenueReportScreen() {
  const router = useRouter();
  const nowIso = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
  const [mon, setMon] = useState(nowIso);
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/encounters/revenue-report', { params: { month: mon } });
      setRep(data); setErr('');
    } catch (e: any) {
      setErr(e?.response?.status === 403 ? 'Owner access required.' : 'Could not load the report.');
      setRep(null);
    } finally { setLoading(false); setRefreshing(false); }
  }, [mon]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const money = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const isThisMonth = mon === nowIso;
  const label = (() => { const [y, m] = mon.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; })();
  const maxBar = Math.max(1, ...(rep?.series || []).map((d) => d.collected + d.outstanding + d.waived));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters/collection')} style={styles.backBtn} testID="rev-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Revenue Report</Text>
      </View>

      <View style={styles.monthBar}>
        <TouchableOpacity onPress={() => setMon(shiftMonth(mon, -1))} style={styles.arrow} testID="rev-prev">
          <Ionicons name="chevron-back" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{label}</Text>
        <TouchableOpacity onPress={() => !isThisMonth && setMon(shiftMonth(mon, 1))} style={[styles.arrow, isThisMonth && { opacity: 0.3 }]} disabled={isThisMonth} testID="rev-next">
          <Ionicons name="chevron-forward" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : err ? (
        <View style={styles.center}><Text style={styles.errText}>{err}</Text></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
        >
          <View style={styles.cardsRow}>
            <View style={[styles.statCard, { backgroundColor: '#D1FAE5' }]}>
              <Text style={[styles.statValue, { color: '#047857' }]} numberOfLines={1} adjustsFontSizeToFit>{money(rep?.collected)}</Text>
              <Text style={[styles.statLabel, { color: '#047857' }]}>Collected</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.statValue, { color: '#B45309' }]} numberOfLines={1} adjustsFontSizeToFit>{money(rep?.outstanding)}</Text>
              <Text style={[styles.statLabel, { color: '#B45309' }]}>Outstanding</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#F1F5F9' }]}>
              <Text style={[styles.statValue, { color: '#475569' }]} numberOfLines={1} adjustsFontSizeToFit>{money(rep?.waived_total)}</Text>
              <Text style={[styles.statLabel, { color: '#475569' }]}>Waived</Text>
            </View>
          </View>

          <Text style={styles.countsLine}>
            {rep?.counts.total || 0} encounters · {rep?.counts.paid || 0} paid · {rep?.counts.pending || 0} pending · {rep?.counts.waived || 0} waived
          </Text>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: '#10B981' }]} /><Text style={styles.legendText}>Collected</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: '#F59E0B' }]} /><Text style={styles.legendText}>Outstanding</Text></View>
            <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: '#94A3B8' }]} /><Text style={styles.legendText}>Waived</Text></View>
          </View>

          <Text style={styles.sectionTitle}>Daily breakdown</Text>
          {(rep?.series || []).length === 0 ? (
            <Text style={styles.emptyText}>No encounters this month.</Text>
          ) : (
            (rep?.series || []).map((d) => {
              const total = d.collected + d.outstanding + d.waived;
              return (
                <View key={d.day} style={styles.dayRow}>
                  <Text style={styles.dayLabel}>{d.day.slice(8)}</Text>
                  <View style={styles.barTrack}>
                    {d.collected > 0 && <View style={[styles.barSeg, { backgroundColor: '#10B981', flex: d.collected }]} />}
                    {d.outstanding > 0 && <View style={[styles.barSeg, { backgroundColor: '#F59E0B', flex: d.outstanding }]} />}
                    {d.waived > 0 && <View style={[styles.barSeg, { backgroundColor: '#94A3B8', flex: d.waived }]} />}
                    <View style={{ flex: Math.max(0, maxBar - total) }} />
                  </View>
                  <Text style={styles.dayAmt}>{money(d.collected)}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  title: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 14 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 8 },
  arrow: { padding: 8 },
  monthLabel: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary },
  cardsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, minWidth: 0, borderRadius: RADIUS.md, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 3 },
  statValue: { ...FONTS.h2, fontSize: 16 },
  statLabel: { ...FONTS.bodyMedium, fontSize: 11.5 },
  countsLine: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 12 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...FONTS.body, fontSize: 11.5, color: COLORS.textSecondary },
  sectionTitle: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary, marginTop: 20, marginBottom: 8 },
  emptyText: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dayLabel: { ...FONTS.bodyMedium, fontSize: 12, color: COLORS.textSecondary, width: 24 },
  barTrack: { flex: 1, flexDirection: 'row', height: 14, borderRadius: 7, backgroundColor: COLORS.border + '55', overflow: 'hidden' },
  barSeg: { height: 14 },
  dayAmt: { ...FONTS.body, fontSize: 11.5, color: COLORS.textPrimary, width: 64, textAlign: 'right' },
});
