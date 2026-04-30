/**
 * Dashboard hero widgets:
 *  - <TodayGlance>  — compact stat strip ("5 bookings · 2 awaiting · 1 unavailability today")
 *  - <SmartAlerts>  — issues that need attention (drafts, conflicts, etc.)
 *
 * Both fetch their own data so they can drop into the dashboard without
 * wiring through the (already large) Dashboard component's state.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

// ──────────────────────────────────────────────────────────────────────
// TodayGlance
// ──────────────────────────────────────────────────────────────────────

type GlanceProps = {
  /** Optional onPress for each tile — omit to make non-tappable. */
  onTapBookings?: () => void;
  onTapPending?: () => void;
  /**
   * Layout variant:
   *   • `row`      — classic horizontal strip (4 tiles in a row)
   *   • `grid2x2`  — 2×2 grid (compact, mobile-friendly, saves vertical space)
   *   • `rail`     — vertical rail for desktop hero side-space
   */
  layout?: 'row' | 'grid2x2' | 'rail';
  /** DEPRECATED — kept for compatibility. `true` == `grid2x2`. */
  compact?: boolean;
};

export function TodayGlance({ onTapBookings, onTapPending, layout, compact }: GlanceProps) {
  const effective = layout || (compact ? 'grid2x2' : 'row');
  const [today, setToday] = useState<{ total: number; confirmed: number; nextLabel: string }>({
    total: 0, confirmed: 0, nextLabel: '',
  });
  // `pendingTotal` is global pending (matches the "Pending approvals"
  // tile on the Today tab), so the hero glance stays in sync with the
  // dashboard panel below it.
  const [pendingTotal, setPendingTotal] = useState<number>(0);
  const [unavailToday, setUnavailToday] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const todayIso = format(new Date(), 'yyyy-MM-dd');
      const weekday = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1; // Mon=0
      const [bookingsResp, unavailResp, analyticsResp] = await Promise.all([
        api.get('/bookings', { params: { date: todayIso } }).catch(() => ({ data: [] })),
        api.get('/unavailabilities').catch(() => ({ data: [] })),
        // Pull the dashboard analytics so we can read GLOBAL pending —
        // identical figure to what the Today panel shows.
        api.get('/analytics/dashboard', { params: { months: 3 } }).catch(() => ({ data: null })),
      ]);
      const bks = (bookingsResp.data || []).filter((b: any) =>
        b.status !== 'cancelled' && b.booking_date === todayIso
      );
      const confirmed = bks.filter((b: any) => b.status === 'confirmed').length;
      const nowH = new Date().getHours() * 60 + new Date().getMinutes();
      const next = bks
        .filter((b: any) => b.status === 'confirmed')
        .map((b: any) => {
          const [hh, mm] = (b.booking_time || '00:00').split(':').map(Number);
          return { mins: hh * 60 + mm, b };
        })
        .filter((x: any) => x.mins >= nowH)
        .sort((a: any, b: any) => a.mins - b.mins)[0];
      const nextLabel = next
        ? `Next: ${(next.b.patient_name || '').split(' ')[0]} · ${next.b.booking_time}`
        : '';
      const todayUnavail = (unavailResp.data || []).filter((u: any) =>
        u.date === todayIso || (u.recurring_weekly && u.day_of_week === weekday)
      ).length;
      const globalPending = Number((analyticsResp as any)?.data?.totals?.pending_bookings) || 0;
      setToday({ total: bks.length, confirmed, nextLabel });
      setPendingTotal(globalPending);
      setUnavailToday(todayUnavail);
    } catch {
      // ignore — hero remains empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View
        style={effective === 'row' ? styles.glanceWrap : effective === 'rail' ? styles.glanceRailWrap : styles.glanceGridWrap}
        testID="today-glance-loading"
      >
        <ActivityIndicator color="#fff" size="small" />
      </View>
    );
  }

  const tiles = [
    { key: 'total', label: 'Bookings', short: 'Today', value: today.total, icon: 'calendar' as const, onPress: onTapBookings },
    { key: 'pending', label: 'Pending', short: 'Pending', value: pendingTotal, icon: 'time' as const, onPress: onTapPending },
    { key: 'confirmed', label: 'Confirmed', short: 'Conf', value: today.confirmed, icon: 'checkmark-circle' as const, onPress: onTapBookings },
    { key: 'unavail', label: 'Off-blocks', short: 'Off', value: unavailToday, icon: 'close-circle-outline' as const },
  ];

  // ── Desktop right-side vertical rail ─────────────────────────────
  if (effective === 'rail') {
    return (
      <View testID="today-glance" style={styles.glanceRailWrap}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.key}
            disabled={!t.onPress}
            onPress={t.onPress}
            style={styles.glanceRailTile}
            activeOpacity={t.onPress ? 0.75 : 1}
            testID={`glance-${t.key}`}
          >
            <View style={styles.glanceRailIconWrap}>
              <Ionicons name={t.icon} size={16} color="#fff" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.glanceRailLabel} numberOfLines={1}>{t.label}</Text>
              <Text style={styles.glanceRailValue}>{t.value}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // ── Mobile 2×2 grid (saves vertical space vs the old 4-wide row) ─
  if (effective === 'grid2x2') {
    return (
      <View testID="today-glance" style={styles.glanceGridWrap}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.key}
            disabled={!t.onPress}
            onPress={t.onPress}
            style={styles.glanceGridTile}
            activeOpacity={t.onPress ? 0.75 : 1}
            testID={`glance-${t.key}`}
          >
            <Ionicons name={t.icon} size={14} color="#fff" style={{ opacity: 0.95 }} />
            <Text style={styles.glanceGridValue}>{t.value}</Text>
            <Text style={styles.glanceGridLabel} numberOfLines={1}>{t.short}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View testID="today-glance" style={styles.glanceWrap}>
      <View style={styles.glanceRow}>
        {tiles.map((t) => (
          <TouchableOpacity
            key={t.key}
            disabled={!t.onPress}
            onPress={t.onPress}
            style={styles.glanceTile}
            activeOpacity={t.onPress ? 0.75 : 1}
            testID={`glance-${t.key}`}
          >
            <Ionicons name={t.icon} size={14} color="#fff" />
            <Text style={styles.glanceValue}>{t.value}</Text>
            <Text style={styles.glanceLabel} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {today.nextLabel ? (
        <Text style={styles.glanceNext} numberOfLines={1}>{today.nextLabel}</Text>
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SmartAlerts
// ──────────────────────────────────────────────────────────────────────

type Alert = {
  key: string;
  level: 'red' | 'amber' | 'green';
  text: string;
  /** Optional CTA — typically a router.push */
  onPress?: () => void;
};

export function SmartAlerts({ onTapBookings, onTapRx, onTapAvailability }: {
  onTapBookings?: () => void;
  onTapRx?: () => void;
  onTapAvailability?: () => void;
}) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  const compute = useCallback(async () => {
    const items: Alert[] = [];
    try {
      // Pull just enough data — keep this lightweight.
      const [bookingsResp, rxResp, unavailResp] = await Promise.all([
        api.get('/bookings').catch(() => ({ data: [] })),
        api.get('/prescriptions').catch(() => ({ data: [] })),
        api.get('/unavailabilities').catch(() => ({ data: [] })),
      ]);
      const todayIso = format(new Date(), 'yyyy-MM-dd');
      const yest = new Date(); yest.setDate(yest.getDate() - 1);
      const yIso = format(yest, 'yyyy-MM-dd');

      // 🔴 Confirmed bookings on a now-unavailable date → patients need rebooking
      const unavailDates = new Set(
        (unavailResp.data || []).filter((u: any) => u.date && u.all_day).map((u: any) => u.date)
      );
      const conflictCount = (bookingsResp.data || []).filter((b: any) =>
        b.status === 'confirmed' && unavailDates.has(b.booking_date)
      ).length;
      if (conflictCount > 0) {
        items.push({
          key: 'conflict',
          level: 'red',
          text: `${conflictCount} confirmed booking${conflictCount > 1 ? 's' : ''} on now-unavailable date${conflictCount > 1 ? 's' : ''}`,
          onPress: onTapBookings,
        });
      }

      // 🟡 Yesterday's draft prescriptions
      const draftYest = (rxResp.data || []).filter((r: any) =>
        r.status === 'draft' && (r.created_at || '').slice(0, 10) === yIso
      ).length;
      if (draftYest > 0) {
        items.push({
          key: 'draftrx',
          level: 'amber',
          text: `${draftYest} prescription${draftYest > 1 ? 's' : ''} still in draft from yesterday`,
          onPress: onTapRx,
        });
      }

      // 🟡 Today still has many unconfirmed bookings
      const pendingToday = (bookingsResp.data || []).filter((b: any) =>
        b.booking_date === todayIso && b.status === 'requested'
      ).length;
      if (pendingToday >= 3) {
        items.push({
          key: 'pendtoday',
          level: 'amber',
          text: `${pendingToday} requests awaiting confirmation for today`,
          onPress: onTapBookings,
        });
      }

      // 🟢 No alerts → silence is golden
      setAlerts(items);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [onTapBookings, onTapRx, onTapAvailability, router]);

  useEffect(() => { compute(); }, [compute]);

  if (loading || alerts.length === 0) return null;

  return (
    <View style={styles.alertsWrap} testID="smart-alerts">
      <Text style={styles.alertsTitle}>Smart Alerts</Text>
      {alerts.map((a) => {
        const accent = a.level === 'red' ? COLORS.accent : a.level === 'amber' ? COLORS.warning : COLORS.success;
        return (
          <TouchableOpacity
            key={a.key}
            onPress={a.onPress}
            disabled={!a.onPress}
            activeOpacity={a.onPress ? 0.75 : 1}
            style={[styles.alertRow, { borderLeftColor: accent }]}
            testID={`alert-${a.key}`}
          >
            <Ionicons
              name={a.level === 'red' ? 'alert-circle' : a.level === 'amber' ? 'warning' : 'checkmark-circle'}
              size={18}
              color={accent}
            />
            <Text style={styles.alertText} numberOfLines={2}>{a.text}</Text>
            {a.onPress ? <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Glance — sits inside the white-on-teal hero card; tiles use translucent fills
  glanceWrap: { marginTop: 14 },
  glanceRow: { flexDirection: 'row', gap: 8 },
  glanceTile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: RADIUS.sm,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 2,
  },
  glanceValue: { ...FONTS.h3, color: '#fff', fontSize: 18 },
  glanceLabel: { ...FONTS.body, color: '#fff', fontSize: 10, opacity: 0.9 },
  glanceNext: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12, marginTop: 8, opacity: 0.95 },

  // Horizontal compact rail — sits BELOW the userCard inside the
  // dashboard hero. Four chip-tiles flex evenly, no overlap with bell.
  glanceCompactWrap: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  glanceCompactRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  glanceCompactValue: { ...FONTS.h3, color: '#fff', fontSize: 15, marginLeft: 1 },
  glanceCompactLabel: { ...FONTS.body, color: '#fff', fontSize: 10, opacity: 0.9 },

  // ── NEW: 2×2 grid for mobile (compact but bigger touch targets than
  //        the old 4-wide compact row). Saves vertical space vs the
  //        original .glanceWrap layout.
  glanceGridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  glanceGridTile: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  glanceGridValue: { ...FONTS.h3, color: '#fff', fontSize: 17, marginLeft: 2 },
  glanceGridLabel: { ...FONTS.body, color: '#fff', fontSize: 11, opacity: 0.9, flex: 1 },

  // ── NEW: Vertical rail for desktop hero (appears on the right of
  //        the user card so the tab bar can pull up and save vertical
  //        space). Four tiles stacked, compact side-rail look.
  glanceRailWrap: {
    gap: 6,
    minWidth: 200,
    maxWidth: 240,
  },
  glanceRailTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  glanceRailIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glanceRailLabel: { ...FONTS.body, color: '#fff', fontSize: 11, opacity: 0.85 },
  glanceRailValue: { ...FONTS.h3, color: '#fff', fontSize: 18, lineHeight: 22 },

  // Alerts — sits at top of Bookings panel
  alertsWrap: { marginBottom: 14, gap: 6 },
  alertsTitle: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 6 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderLeftWidth: 3,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: COLORS.border,
    borderRightColor: COLORS.border,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  alertText: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, lineHeight: 17 },
});

export default TodayGlance;
