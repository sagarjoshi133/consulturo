import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format, formatDistanceToNow } from 'date-fns';
import { parseBackendDate } from '../src/date';
import { formatISTDate, formatISTTime } from '../src/date';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { EmptyState } from '../src/empty-state';
import { useI18n } from '../src/i18n';

type Kind =
  | 'visit'
  | 'rx'
  | 'surgery'
  | 'ipss'
  | 'prostate'
  | 'booking_confirmed'
  | 'booking_cancelled';

type TimelineItem = {
  id: string;
  kind: Kind;
  at: string; // ISO
  title: string;
  subtitle?: string;
  meta?: string;
  accent?: string;
  icon?: string;
  iconLib?: 'ion' | 'mci';
  href?: string;
  raw?: any;
};

const FILTERS: { id: 'all' | 'visits' | 'rx' | 'surgeries' | 'scores'; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: 'albums' },
  { id: 'visits', label: 'Visits', icon: 'calendar' },
  { id: 'rx', label: 'Rx', icon: 'document-text' },
  { id: 'surgeries', label: 'Surgeries', icon: 'medkit' },
  { id: 'scores', label: 'Vitals', icon: 'pulse' },
];

function normaliseIso(raw: string | undefined): string {
  if (!raw) return '';
  // Accept YYYY-MM-DD (coerce to noon local), or full ISO strings.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`).toISOString();
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

function buildTimeline(data: any): TimelineItem[] {
  if (!data) return [];
  const items: TimelineItem[] = [];

  (data.appointments || []).forEach((b: any) => {
    const at = normaliseIso(`${b.booking_date || ''}${b.booking_time ? `T${b.booking_time}:00` : ''}`) || normaliseIso(b.created_at);
    if (!at) return;
    const status = (b.status || 'requested').toLowerCase();
    let accent = COLORS.primary;
    let kind: Kind = 'visit';
    let title = 'Consultation';
    if (status === 'confirmed') { accent = COLORS.success; kind = 'booking_confirmed'; title = 'Consultation confirmed'; }
    else if (status === 'cancelled') { accent = COLORS.textDisabled; kind = 'booking_cancelled'; title = 'Consultation cancelled'; }
    else if (status === 'rejected') { accent = COLORS.accent; title = 'Consultation rejected'; }
    else if (status === 'completed') { accent = COLORS.primaryDark; title = 'Visit complete'; }
    items.push({
      id: `visit-${b.booking_id}`,
      kind,
      at,
      title,
      subtitle: [b.mode === 'online' ? 'Online' : 'In-person', b.booking_time].filter(Boolean).join(' · '),
      meta: b.reason_for_visit || b.symptoms || undefined,
      accent,
      icon: 'calendar',
      iconLib: 'ion',
      href: `/bookings/${b.booking_id}`,
      raw: b,
    });
  });

  (data.prescriptions || []).forEach((r: any) => {
    const at = normaliseIso(r.visit_date) || normaliseIso(r.created_at);
    if (!at) return;
    const medCount = (r.medicines || []).length;
    items.push({
      id: `rx-${r.prescription_id}`,
      kind: 'rx',
      at,
      title: r.diagnosis ? `Prescription · ${r.diagnosis}` : 'Prescription',
      subtitle: [medCount ? `${medCount} medicine${medCount === 1 ? '' : 's'}` : null, r.follow_up ? `follow-up ${r.follow_up}` : null].filter(Boolean).join(' · '),
      meta: r.chief_complaints || r.advice || undefined,
      accent: COLORS.primaryDark,
      icon: 'document-text',
      iconLib: 'ion',
      href: `/prescriptions/${r.prescription_id}`,
      raw: r,
    });
  });

  (data.surgeries || []).forEach((s: any) => {
    const at = normaliseIso(s.date) || normaliseIso(s.created_at);
    if (!at) return;
    items.push({
      id: `sx-${s.surgery_id || s._id || s.created_at}`,
      kind: 'surgery',
      at,
      title: s.surgery_name || 'Surgery',
      subtitle: [s.hospital, s.department].filter(Boolean).join(' · '),
      meta: s.diagnosis || s.notes || undefined,
      accent: COLORS.accent,
      icon: 'medkit',
      iconLib: 'ion',
      raw: s,
    });
  });

  (data.ipss_history || []).forEach((ip: any) => {
    const at = normaliseIso(ip.created_at);
    if (!at) return;
    const score = ip.total_score ?? ip.score ?? 0;
    const sev = score <= 7 ? 'Mild' : score <= 19 ? 'Moderate' : 'Severe';
    const color = score <= 7 ? COLORS.success : score <= 19 ? COLORS.warning : COLORS.accent;
    items.push({
      id: `ipss-${ip._id || at}`,
      kind: 'ipss',
      at,
      title: `IPSS score · ${score}/35`,
      subtitle: `${sev}${ip.qol_score != null ? ` · QoL ${ip.qol_score}/6` : ''}`,
      accent: color,
      icon: 'pulse',
      iconLib: 'ion',
      raw: ip,
    });
  });

  (data.prostate_readings || []).forEach((pv: any) => {
    const at = normaliseIso(pv.measured_on) || normaliseIso(pv.created_at);
    if (!at) return;
    items.push({
      id: `pv-${pv.reading_id}`,
      kind: 'prostate',
      at,
      title: `Prostate volume · ${pv.volume_ml} mL`,
      subtitle: pv.source || 'USG',
      meta: pv.notes || undefined,
      accent: COLORS.primary,
      icon: 'human-male',
      iconLib: 'mci',
      href: '/prostate-volume',
      raw: pv,
    });
  });

  items.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return items;
}

function groupByMonth(items: TimelineItem[]): { key: string; label: string; items: TimelineItem[] }[] {
  const buckets = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const d = new Date(it.at);
    if (isNaN(d.getTime())) continue;
    const key = format(d, 'yyyy-MM');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(it);
  }
  const keys = Array.from(buckets.keys()).sort((a, b) => b.localeCompare(a));
  return keys.map((k) => ({
    key: k,
    label: format(new Date(`${k}-01`), 'MMMM yyyy'),
    items: buckets.get(k)!,
  }));
}

export default function HealthTimeline() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [raw, setRaw] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'visits' | 'rx' | 'surgeries' | 'scores'>('all');

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data } = await api.get('/records/me');
      setRaw(data);
    } catch {
      setRaw(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const allItems = useMemo(() => buildTimeline(raw), [raw]);
  const filtered = useMemo(() => {
    if (filter === 'all') return allItems;
    if (filter === 'visits') return allItems.filter((i) => i.kind.startsWith('visit') || i.kind.startsWith('booking'));
    if (filter === 'rx') return allItems.filter((i) => i.kind === 'rx');
    if (filter === 'surgeries') return allItems.filter((i) => i.kind === 'surgery');
    if (filter === 'scores') return allItems.filter((i) => i.kind === 'ipss' || i.kind === 'prostate');
    return allItems;
  }, [allItems, filter]);

  const groups = useMemo(() => groupByMonth(filtered), [filtered]);
  const counts = useMemo(() => ({
    all: allItems.length,
    visits: allItems.filter((i) => i.kind.startsWith('visit') || i.kind.startsWith('booking')).length,
    rx: allItems.filter((i) => i.kind === 'rx').length,
    surgeries: allItems.filter((i) => i.kind === 'surgery').length,
    scores: allItems.filter((i) => i.kind === 'ipss' || i.kind === 'prostate').length,
  }), [allItems]);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <TopBar router={router} />
        <View style={styles.emptyFlex}>
          <EmptyState
            icon="lock-closed-outline"
            title={t('timeline.signInTitle')}
            subtitle={t('timeline.signInSub')}
            ctaLabel={t('common.signIn')}
            onCta={() => router.push('/(tabs)/more')}
            testID="timeline-signin-empty"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar router={router} />

      {/* Filter tabs — uniform equal-width 2-line cells (label on top,
          count pill below). Same width, same height across all five
          regardless of label length. No more ellipsized "V..." / "S..." */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const c = counts[f.id];
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.filterChip, active && styles.filterChipOn]}
              testID={`timeline-filter-${f.id}`}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.filterChipText, active && styles.filterChipTextOn]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {f.label}
              </Text>
              <View style={[styles.chipCount, active && styles.chipCountOn]}>
                <Text
                  style={[styles.chipCountText, active && styles.chipCountTextOn]}
                  allowFontScaling={false}
                >
                  {c}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {groups.length === 0 ? (
          <View style={{ paddingTop: 20 }}>
            <EmptyState
              icon="git-commit"
              title={t('timeline.emptyTitle')}
              subtitle={filter === 'all' ? t('timeline.emptySub') : t('timeline.emptyFilteredSub')}
              ctaLabel={filter === 'all' ? t('timeline.bookFirstVisit') : undefined}
              onCta={filter === 'all' ? () => router.push('/(tabs)/book') : undefined}
              testID="timeline-empty"
            />
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.key} style={{ marginTop: 18 }}>
              <View style={styles.monthPill}>
                <Text style={styles.monthPillText}>{g.label.toUpperCase()}</Text>
                <View style={styles.monthDot} />
                <Text style={styles.monthCountText}>{g.items.length}</Text>
              </View>
              <View style={styles.monthTrack}>
                {g.items.map((it, idx) => (
                  <TimelineRow
                    key={it.id}
                    item={it}
                    isFirst={idx === 0}
                    isLast={idx === g.items.length - 1}
                    onPress={() => {
                      if (it.href) router.push(it.href as any);
                    }}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TimelineRow({
  item,
  isFirst,
  isLast,
  onPress,
}: {
  item: TimelineItem;
  isFirst: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  const d = new Date(item.at);
  const pressable = !!item.href;
  // Timeline is medically important — always render in IST (clinic timezone)
  // regardless of the user's device timezone.
  const dateStr = isNaN(d.getTime()) ? '' : formatISTDate(d);
  const timeStr = isNaN(d.getTime()) ? '' : formatISTTime(d);
  const ago = isNaN(d.getTime()) ? '' : formatDistanceToNow(parseBackendDate(d), { addSuffix: true });
  const IconComp = item.iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;

  const body = (
    <View style={styles.row}>
      <View style={styles.railCol}>
        {!isFirst ? <View style={[styles.rail, { top: 0, height: 18 }]} /> : null}
        <View style={[styles.dot, { backgroundColor: item.accent || COLORS.primary }]}>
          <IconComp name={(item.icon as any) || 'ellipse'} size={14} color="#fff" />
        </View>
        {!isLast ? <View style={[styles.rail, { top: 36 }]} /> : null}
      </View>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardDate}>{dateStr}</Text>
          {timeStr && <Text style={styles.cardTime}> · {timeStr}</Text>}
          <Text style={styles.cardAgo} numberOfLines={1}>{ago}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
        {item.subtitle ? <Text style={styles.cardSub} numberOfLines={2}>{item.subtitle}</Text> : null}
        {item.meta ? <Text style={styles.cardMeta} numberOfLines={3}>{item.meta}</Text> : null}
        {pressable ? (
          <View style={styles.openHint}>
            <Text style={styles.openHintText}>Open details</Text>
            <Ionicons name="chevron-forward" size={12} color={COLORS.primary} />
          </View>
        ) : null}
      </View>
    </View>
  );

  if (pressable) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} testID={`timeline-row-${item.id}`}>
        {body}
      </TouchableOpacity>
    );
  }
  return <View testID={`timeline-row-${item.id}`}>{body}</View>;
}

function TopBar({ router }: { router: any }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="timeline-back">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle}>Health Timeline</Text>
        <Text style={styles.topSub}>Everything, in order</Text>
      </View>
      <TouchableOpacity
        onPress={() => router.push('/my-records')}
        style={styles.iconBtn}
        testID="timeline-records"
      >
        <Ionicons name="albums-outline" size={20} color={COLORS.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  topTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 20 },
  topSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },

  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  filterChip: {
    // Every chip gets equal width; stacked 2-line layout keeps short
    // and long labels ("All", "Surgeries") at identical cell size.
    flex: 1,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2, paddingVertical: 8,
    minHeight: 52,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  filterChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: {
    ...FONTS.bodyMedium, color: COLORS.primary,
    fontSize: 11, lineHeight: 14,
    includeFontPadding: false,
    textAlign: 'center',
  },
  filterChipTextOn: { color: '#fff' },
  chipCount: {
    minWidth: 22, paddingHorizontal: 6, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '18',
  },
  chipCountOn: { backgroundColor: 'rgba(255,255,255,0.28)' },
  chipCountText: {
    ...FONTS.bodyMedium, color: COLORS.primary,
    fontSize: 10, lineHeight: 12, includeFontPadding: false,
  },
  chipCountTextOn: { color: '#fff' },

  monthPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '14',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    marginBottom: 10,
  },
  monthPillText: { ...FONTS.label, color: COLORS.primaryDark, fontSize: 11, letterSpacing: 0.8 },
  monthDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.primary },
  monthCountText: { ...FONTS.bodyMedium, color: COLORS.primaryDark, fontSize: 11 },

  monthTrack: {},

  row: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 12 },
  railCol: { width: 36, alignItems: 'center' },
  rail: { position: 'absolute', left: '50%', marginLeft: -1, width: 2, height: '100%', backgroundColor: COLORS.border },
  dot: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 3,
    elevation: 3,
    zIndex: 2,
  },

  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  cardDate: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  cardTime: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  cardAgo: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginLeft: 'auto' },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  cardSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  cardMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  openHint: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 8, alignSelf: 'flex-start' },
  openHintText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 40 },
  emptyFlex: { flex: 1, justifyContent: 'center' },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14, textAlign: 'center' },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center', fontSize: 13, lineHeight: 19 },
});
