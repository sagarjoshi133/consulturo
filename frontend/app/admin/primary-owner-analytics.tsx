// Super-owner-only analytics page.
// Aggregates per-Primary-Owner usage stats (last active, bookings,
// Rx, surgeries, team size, language, growth series) so a platform
// admin can audit which clinics are actively using ConsultUro and
// which need outreach. Strictly separated from Platform
// Administration (which CRUDs the Primary Owners themselves) — see
// /app/permission-manager.tsx for that.
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useResponsive } from '../../src/responsive';

type OwnerRow = {
  user_id: string;
  email: string;
  name: string;
  language?: string;
  suspended?: boolean;
  created_at?: string;
  last_active?: string | null;
  login_days_last_30?: number;
  bookings?: { today: number; week: number; month: number; total: number };
  rx_total?: number;
  surgeries_total?: number;
  team_size?: number;
  subscription_tier?: string;
  growth_90d?: { date: string; bookings: number; rx: number }[];
};

const langLabel = (l?: string) => (l === 'hi' ? 'हिं · Hindi' : l === 'gu' ? 'ગુ · Gujarati' : 'EN · English');

function relativeTime(iso?: string | null): string {
  if (!iso) return 'Never';
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    const sec = Math.round(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const dy = Math.round(hr / 24);
    if (dy < 30) return `${dy}d ago`;
    const mo = Math.round(dy / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.round(mo / 12)}y ago`;
  } catch {
    return iso;
  }
}

/** Tiny inline 90-day growth chart — bars for bookings + line dots
 *  for Rx. Pure RN Views so no chart lib dep. */
function GrowthSparkline({ data }: { data: { date: string; bookings: number; rx: number }[] }) {
  const sliced = data.slice(-30); // last 30 days for compact card
  const maxV = Math.max(1, ...sliced.map((d) => Math.max(d.bookings, d.rx)));
  return (
    <View style={styles.spark}>
      {sliced.map((d, idx) => {
        const bH = (d.bookings / maxV) * 36;
        const rH = (d.rx / maxV) * 36;
        return (
          <View key={d.date + idx} style={styles.sparkCol}>
            {bH > 0 ? (
              <View style={[styles.sparkBar, { height: bH, backgroundColor: COLORS.primary + 'AA' }]} />
            ) : <View style={{ height: 0 }} />}
            {rH > 0 ? (
              <View
                style={[
                  styles.sparkBar,
                  { height: rH, backgroundColor: COLORS.accent || '#7C3AED', marginTop: -1 },
                ]}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export default function PrimaryOwnerAnalytics() {
  const router = useRouter();
  const { user } = useAuth();
  const { isWebDesktop } = useResponsive();
  const [items, setItems] = React.useState<OwnerRow[] | null>(null);
  const [err, setErr] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    setErr('');
    try {
      const { data } = await api.get('/admin/primary-owner-analytics');
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load');
      setItems([]);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Hard guard — only super_owner may view this page.
  if (user && user.role !== 'super_owner') {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.guard}>
          <Ionicons name="lock-closed" size={32} color={COLORS.textSecondary} />
          <Text style={styles.guardText}>This analytics view is reserved for the platform owner.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Primary-Owner Analytics</Text>
          <Text style={styles.subtitle}>How each clinic is using ConsultUro</Text>
        </View>
      </View>

      {!items ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.list,
            isWebDesktop && {
              maxWidth: 1180,
              alignSelf: 'center',
              width: '100%',
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 14,
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={COLORS.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {err ? <Text style={styles.error}>{err}</Text> : null}
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="analytics" size={28} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>No Primary Owners onboarded yet.</Text>
            </View>
          ) : (
            items.map((o) => (
              <View
                key={o.user_id || o.email}
                style={[styles.card, isWebDesktop && { width: 'calc(50% - 7px)' as any, marginBottom: 0 }]}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{o.name || o.email}</Text>
                    <Text style={styles.cardEmail}>{o.email}</Text>
                  </View>
                  {o.suspended && (
                    <View style={styles.pill}>
                      <Text style={styles.pillText}>Suspended</Text>
                    </View>
                  )}
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="time" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{relativeTime(o.last_active)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="log-in" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{o.login_days_last_30 || 0} login-days/30</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="globe" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{langLabel(o.language)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="card" size={11} color={COLORS.textSecondary} />
                    <Text style={styles.metaText}>{o.subscription_tier || 'free'}</Text>
                  </View>
                </View>

                <View style={styles.kpiRow}>
                  <KpiCell label="Bookings · Today" value={o.bookings?.today ?? 0} />
                  <KpiCell label="Bookings · Week" value={o.bookings?.week ?? 0} />
                  <KpiCell label="Bookings · Month" value={o.bookings?.month ?? 0} />
                  <KpiCell label="Bookings · Total" value={o.bookings?.total ?? 0} highlight />
                </View>
                <View style={styles.kpiRow}>
                  <KpiCell label="Rx Written" value={o.rx_total ?? 0} icon="document-text" />
                  <KpiCell label="Surgeries" value={o.surgeries_total ?? 0} icon="medical-outline" />
                  <KpiCell label="Team Members" value={o.team_size ?? 0} icon="people" />
                </View>

                {Array.isArray(o.growth_90d) && o.growth_90d.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.sparkCaption}>30-day activity (bars: bookings · purple: Rx)</Text>
                    <GrowthSparkline data={o.growth_90d} />
                  </View>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function KpiCell({ label, value, icon, highlight }: { label: string; value: number; icon?: any; highlight?: boolean }) {
  return (
    <View style={[styles.kpi, highlight && styles.kpiHighlight]}>
      {icon ? <Ionicons name={icon} size={11} color={COLORS.primary} /> : null}
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  headerIcon: { padding: 6 },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.caption, color: COLORS.textSecondary, marginTop: 2 },
  list: { padding: 16, gap: 14, paddingBottom: 60 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 40, gap: 10 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
  error: { ...FONTS.body, color: COLORS.danger, padding: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardName: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  cardEmail: { ...FONTS.caption, color: COLORS.textSecondary, marginTop: 2 },
  pill: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { ...FONTS.label, fontSize: 10, color: '#B91C1C', fontWeight: '700' as any },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { ...FONTS.caption, fontSize: 11, color: COLORS.textSecondary },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kpi: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.bg,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 2,
  },
  kpiHighlight: {
    backgroundColor: COLORS.primary + '14',
    borderColor: COLORS.primary + '55',
  },
  kpiValue: { ...FONTS.h3, fontSize: 18, color: COLORS.textPrimary, fontWeight: '700' as any },
  kpiLabel: { ...FONTS.label, fontSize: 9, color: COLORS.textSecondary, textAlign: 'center' },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    gap: 2,
  },
  sparkCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  sparkBar: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  sparkCaption: { ...FONTS.label, fontSize: 10, color: COLORS.textSecondary, marginBottom: 4 },
  guard: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  guardText: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
});
