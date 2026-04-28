import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { formatIST } from './date';
import { useResponsive } from './responsive';

type Dashboard = {
  totals: {
    bookings: number;
    confirmed_bookings: number;
    pending_bookings: number;
    cancelled_bookings: number;
    surgeries: number;
    prescriptions: number;
    patients: number;
  };
  monthly_bookings: { month: string; count: number }[];
  monthly_surgeries: { month: string; count: number }[];
  monthly_prescriptions: { month: string; count: number }[];
  daily_bookings: { date: string; count: number }[];
  mode_breakdown: { online: number; offline: number };
  status_breakdown: { requested: number; confirmed: number; cancelled: number };
  top_diagnoses: { label: string; count: number }[];
  top_surgeries: { label: string; count: number }[];
  top_referrers: { label: string; count: number }[];
  generated_at: string;
};

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(key: string) {
  // key: 'YYYY-MM'
  const parts = key.split('-');
  const m = parseInt(parts[1] || '0', 10);
  return MONTH_LABELS[m - 1] || key;
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  return String(d.getDate()).padStart(2, '0');
}

export function AnalyticsPanel() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<6 | 12>(12);
  const { isWebDesktop } = useResponsive();

  const load = useCallback(async (r: 6 | 12 = range) => {
    try {
      const { data } = await api.get(`/analytics/dashboard?months=${r}`);
      setData(data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    load(range);
  }, [load, range]);

  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;
  }
  if (!data) {
    return (
      <View style={styles.empty}>
        <Ionicons name="analytics-outline" size={28} color={COLORS.textDisabled} />
        <Text style={styles.emptyText}>Analytics unavailable. Pull to refresh.</Text>
      </View>
    );
  }

  const t = data.totals;
  const bookingsMax = Math.max(1, ...data.monthly_bookings.map((d) => d.count));
  const surgeriesMax = Math.max(1, ...data.monthly_surgeries.map((d) => d.count));
  const rxMax = Math.max(1, ...data.monthly_prescriptions.map((d) => d.count));
  const dailyMax = Math.max(1, ...data.daily_bookings.map((d) => d.count));

  const sb = data.status_breakdown;
  const statusTotal = Math.max(1, sb.requested + sb.confirmed + sb.cancelled);
  const modeTotal = Math.max(1, data.mode_breakdown.online + data.mode_breakdown.offline);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(range); }} tintColor={COLORS.primary} />}
    >
      {/* --- KPI cards --- */}
      {isWebDesktop ? (
        <View style={[styles.kpiRow, { flexWrap: 'wrap' }]}>
          <KpiCard icon="calendar" color={COLORS.primary} label="Bookings" value={t.bookings} sub={`${t.confirmed_bookings} confirmed`} />
          <KpiCard icon="medkit" color={COLORS.accent} label="Surgeries" value={t.surgeries} sub="Lifetime" />
          <KpiCard icon="document-text" color={COLORS.success} label="Prescriptions" value={t.prescriptions} sub="Issued" />
          <KpiCard icon="people" color="#8B5CF6" label="Patients" value={t.patients} sub="Registered" />
        </View>
      ) : (
        <>
          <View style={styles.kpiRow}>
            <KpiCard icon="calendar" color={COLORS.primary} label="Bookings" value={t.bookings} sub={`${t.confirmed_bookings} confirmed`} />
            <KpiCard icon="medkit" color={COLORS.accent} label="Surgeries" value={t.surgeries} sub="Lifetime" />
          </View>
          <View style={styles.kpiRow}>
            <KpiCard icon="document-text" color={COLORS.success} label="Prescriptions" value={t.prescriptions} sub="Issued" />
            <KpiCard icon="people" color="#8B5CF6" label="Patients" value={t.patients} sub="Registered" />
          </View>
        </>
      )}

      {/* --- Range toggle --- */}
      <View style={styles.rangeRow}>
        <Text style={styles.hdr}>Bookings trend</Text>
        <View style={styles.segment}>
          {[6, 12].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setRange(m as 6 | 12)}
              style={[styles.segmentBtn, range === m && styles.segmentBtnActive]}
              testID={`analytics-range-${m}`}
            >
              <Text style={[styles.segmentText, range === m && { color: '#fff' }]}>{m}M</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* On desktop the 4 trend charts tile into a 2x2 grid for better
          space efficiency; mobile keeps the stacked 1-col layout. */}
      <View style={isWebDesktop ? styles.chartGrid : undefined}>
        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <BarChart
            data={data.monthly_bookings}
            max={bookingsMax}
            color={COLORS.primary}
            labelFn={(d) => monthLabel(d.month)}
            testIdPrefix="bk-bar"
          />
        </View>

        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <Text style={styles.hdr}>Surgeries per month</Text>
          <BarChart
            data={data.monthly_surgeries}
            max={surgeriesMax}
            color={COLORS.accent}
            labelFn={(d) => monthLabel(d.month)}
            testIdPrefix="sx-bar"
          />
        </View>

        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <Text style={styles.hdr}>Prescriptions per month</Text>
          <BarChart
            data={data.monthly_prescriptions}
            max={rxMax}
            color={COLORS.success}
            labelFn={(d) => monthLabel(d.month)}
            testIdPrefix="rx-bar"
          />
        </View>

        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <Text style={styles.hdr}>Last 14 days — daily bookings</Text>
          <BarChart
            data={data.daily_bookings}
            max={dailyMax}
            color="#8B5CF6"
            labelFn={(d: any) => dayLabel(d.date)}
            testIdPrefix="day-bar"
          />
        </View>
      </View>

      {/* Booking status + Mode — 2-up grid on desktop */}
      <View style={isWebDesktop ? styles.chartGrid : undefined}>
        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <Text style={styles.hdr}>Booking status</Text>
          <View style={styles.stackBar}>
            <Seg flex={sb.requested / statusTotal} color={COLORS.warning} />
            <Seg flex={sb.confirmed / statusTotal} color={COLORS.success} />
            <Seg flex={sb.cancelled / statusTotal} color={COLORS.accent} />
          </View>
          <View style={styles.legend}>
            <Legend dot={COLORS.warning} label={`Pending · ${sb.requested}`} />
            <Legend dot={COLORS.success} label={`Confirmed · ${sb.confirmed}`} />
            <Legend dot={COLORS.accent} label={`Cancelled · ${sb.cancelled}`} />
          </View>
        </View>

        <View style={isWebDesktop ? styles.chartCell : undefined}>
          <Text style={styles.hdr}>Consultation mode</Text>
          <View style={styles.stackBar}>
            <Seg flex={data.mode_breakdown.online / modeTotal} color={COLORS.primary} />
            <Seg flex={data.mode_breakdown.offline / modeTotal} color="#0EA5E9" />
          </View>
          <View style={styles.legend}>
            <Legend dot={COLORS.primary} label={`Online · ${data.mode_breakdown.online}`} />
            <Legend dot="#0EA5E9" label={`In-person · ${data.mode_breakdown.offline}`} />
          </View>
        </View>
      </View>

      {/* Top lists — 3-up grid on desktop (wide screen), stacked on mobile */}
      <View style={isWebDesktop ? styles.topGrid : undefined}>
        <View style={isWebDesktop ? styles.topCell : undefined}>
          <Text style={styles.hdr}>Top diagnoses</Text>
          <TopList items={data.top_diagnoses} empty="No surgeries logged yet" color={COLORS.accent} />
        </View>

        <View style={isWebDesktop ? styles.topCell : undefined}>
          <Text style={styles.hdr}>Top procedures</Text>
          <TopList items={data.top_surgeries} empty="No surgeries logged yet" color={COLORS.primary} />
        </View>

        <View style={isWebDesktop ? styles.topCell : undefined}>
          <Text style={styles.hdr}>Top referrers</Text>
          <TopList items={data.top_referrers} empty="No referrer data yet" color={COLORS.success} />
        </View>
      </View>

      <Text style={styles.footer}>Updated {formatIST(data.generated_at)}</Text>
    </ScrollView>
  );
}

function KpiCard({ icon, color, label, value, sub }: { icon: any; color: string; label: string; value: number; sub: string }) {
  return (
    <View style={styles.kpi}>
      <View style={[styles.kpiIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiSub}>{sub}</Text>
    </View>
  );
}

function BarChart({ data, max, color, labelFn, testIdPrefix }: { data: any[]; max: number; color: string; labelFn: (d: any) => string; testIdPrefix: string }) {
  if (!data.length) {
    return <View style={styles.chartEmpty}><Text style={styles.emptyText}>No data in range</Text></View>;
  }
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartBars}>
        {data.map((d, i) => {
          const h = (d.count / max) * 110;
          return (
            <View key={i} style={styles.barCol} testID={`${testIdPrefix}-${i}`}>
              <View style={{ height: 110, justifyContent: 'flex-end', alignItems: 'center' }}>
                {d.count > 0 && <Text style={styles.barCountLabel}>{d.count}</Text>}
                <View style={[styles.bar, { height: Math.max(d.count > 0 ? 4 : 0, h), backgroundColor: color }]} />
              </View>
              <Text style={styles.barAxis}>{labelFn(d)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Seg({ flex, color }: { flex: number; color: string }) {
  if (flex <= 0) return null;
  return <View style={{ flex, backgroundColor: color, height: 18 }} />;
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: dot }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function TopList({ items, empty, color }: { items: { label: string; count: number }[]; empty: string; color: string }) {
  if (!items || items.length === 0) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.emptyText}>{empty}</Text>
      </View>
    );
  }
  const max = Math.max(...items.map((i) => i.count));
  return (
    <View style={{ gap: 8 }}>
      {items.map((it, idx) => (
        <View key={idx} style={styles.topRow}>
          <Text style={styles.topLabel} numberOfLines={1}>{it.label}</Text>
          <View style={styles.topBarWrap}>
            <View style={[styles.topBarFill, { width: `${(it.count / max) * 100}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.topCount}>{it.count}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 20, alignItems: 'center', gap: 8 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: COLORS.border },
  kpiIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiValue: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  kpiLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 11, marginTop: 1 },
  kpiSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 1 },

  hdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 14, marginBottom: 8, fontSize: 11 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  segment: { flexDirection: 'row', backgroundColor: '#EEF2F3', borderRadius: RADIUS.pill, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill },
  segmentBtnActive: { backgroundColor: COLORS.primary },
  segmentText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 10 },

  chartCard: { backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
  barCol: { flex: 1, alignItems: 'center' },
  bar: { width: '70%', borderTopLeftRadius: 4, borderTopRightRadius: 4, minWidth: 6 },
  barAxis: { ...FONTS.body, fontSize: 9, color: COLORS.textSecondary, marginTop: 3 },
  barCountLabel: { ...FONTS.bodyMedium, fontSize: 9, color: COLORS.textPrimary, marginBottom: 2 },
  chartEmpty: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed', alignItems: 'center' },

  stackBar: { flexDirection: 'row', borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: '#EEF2F3' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 4.5 },
  legendText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', padding: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  topLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 11, width: 110 },
  topBarWrap: { flex: 1, height: 7, borderRadius: 4, backgroundColor: '#EEF2F3', overflow: 'hidden' },
  topBarFill: { height: 7, borderRadius: 4 },
  topCount: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12, minWidth: 22, textAlign: 'right' },

  footer: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 10, textAlign: 'center', marginTop: 24 },

  // Desktop grids — 2x2 charts and 3-up top lists. Each cell gets
  // `flex` + min-width so narrow desktops wrap gracefully.
  chartGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  chartCell: { flexGrow: 1, flexBasis: 360, minWidth: 320 },
  topGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  topCell: { flexGrow: 1, flexBasis: 280, minWidth: 240 },
});
