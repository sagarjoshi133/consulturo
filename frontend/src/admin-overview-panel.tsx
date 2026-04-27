import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, isToday, parseISO } from 'date-fns';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { usePanelRefresh } from './panel-refresh';

type Stat = {
  key: string;
  label: string;
  value: number | string;
  icon: any;
  color: string;
  testID: string;
  onPress?: () => void;
};

export function AdminOverviewPanel({
  onJumpTab,
  onNewSurgery,
  onNewBroadcast,
  onMessagePatient,
}: {
  onJumpTab: (id: string) => void;
  onNewSurgery?: () => void;
  onNewBroadcast?: () => void;
  onMessagePatient?: (recipient: { user_id: string; name?: string; phone?: string; email?: string; role?: string }) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [todayBookings, setTodayBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [overview, bookings] = await Promise.all([
        api.get('/analytics/dashboard', { params: { months: 3 } }).then((r) => r.data).catch(() => null),
        api.get('/bookings/all').then((r) => r.data).catch(() => []),
      ]);
      setData(overview);
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      setTodayBookings(bookings.filter((b: any) => b.booking_date === todayStr));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Register pull-to-refresh for Today tab
  usePanelRefresh('today', async () => { await load(); });

  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />;
  }

  const pendingBookings = data?.totals?.pending_bookings ?? 0;
  const confirmedToday = todayBookings.filter((b) => b.status === 'confirmed').length;
  const totalRx = data?.totals?.total_prescriptions ?? 0;
  const totalSx = data?.totals?.total_surgeries ?? 0;

  const stats: Stat[] = [
    {
      key: 'today-bookings',
      label: "Today's bookings",
      value: todayBookings.length,
      icon: 'calendar-today',
      color: COLORS.primary,
      testID: 'overview-today-bookings',
      onPress: () => onJumpTab('bookings'),
    },
    {
      key: 'pending',
      label: 'Pending approvals',
      value: pendingBookings,
      icon: 'clock-alert-outline',
      color: pendingBookings > 0 ? COLORS.warning : COLORS.success,
      testID: 'overview-pending',
      onPress: () => onJumpTab('bookings'),
    },
    {
      key: 'confirmed-today',
      label: 'Confirmed today',
      value: confirmedToday,
      icon: 'check-circle-outline',
      color: COLORS.success,
      testID: 'overview-confirmed',
      onPress: () => onJumpTab('bookings'),
    },
    {
      key: 'total-rx',
      label: 'Total prescriptions',
      value: totalRx,
      icon: 'file-document-outline',
      color: '#6D28D9',
      testID: 'overview-rx',
      onPress: () => onJumpTab('prescriptions'),
    },
    {
      key: 'total-sx',
      label: 'Surgeries logged',
      value: totalSx,
      icon: 'medical-bag',
      color: '#0A7C8A',
      testID: 'overview-sx',
      onPress: () => onJumpTab('surgeries'),
    },
    {
      key: 'patients',
      label: 'Patient records',
      value: data?.totals?.total_patients ?? 0,
      icon: 'account-group-outline',
      color: '#E53935',
      testID: 'overview-patients',
      onPress: () => onJumpTab('bookings'),
    },
  ];

  return (
    <View>
      {/* Header row — section title on the left, refresh on the right.
          alignSelf: 'center' on the button keeps it vertically centred
          with the title text irrespective of marginBottom. */}
      <View style={styles.todayHeader}>
        <Text style={[styles.sectionTitle, styles.todayTitle]}>Today · {format(new Date(), 'EEEE, dd-MM-yyyy')}</Text>
        <TouchableOpacity
          onPress={load}
          style={styles.todayRefresh}
          activeOpacity={0.75}
          testID="overview-refresh"
        >
          <Ionicons name="refresh" size={16} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
      <View style={styles.statsGrid}>
        {stats.map((s) => (
          <TouchableOpacity
            key={s.key}
            onPress={s.onPress}
            activeOpacity={0.8}
            style={[styles.statCard, { borderLeftColor: s.color }]}
            testID={s.testID}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name={s.icon} size={16} color={s.color} />
              <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
            </View>
            <Text style={styles.statLabel} numberOfLines={2}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.quickRow}>
        <QuickAction
          iconLib="mci"
          icon="calendar-plus"
          label="Book Visit"
          color="#0E7C8B"
          onPress={() => router.push('/(tabs)/book' as any)}
          testID="overview-action-book"
        />
        <QuickAction
          iconLib="ion"
          icon="document-text"
          label={`New\nprescription`}
          color="#6D28D9"
          onPress={() => router.push('/prescriptions/new' as any)}
          testID="overview-action-rx"
        />
        <QuickAction
          iconLib="ion"
          icon="medkit"
          label={`New\nSurgery`}
          color="#0A7C8A"
          onPress={() => {
            if (onNewSurgery) onNewSurgery();
            else onJumpTab('surgeries');
          }}
          testID="overview-action-sx"
        />
        <QuickAction
          iconLib="ion"
          icon="megaphone"
          label={`New\nBroadcast`}
          color="#F59E0B"
          onPress={() => {
            if (onNewBroadcast) onNewBroadcast();
            else onJumpTab('broadcasts');
          }}
          testID="overview-action-bc"
        />
      </View>

      <Text style={styles.sectionTitle}>Today's schedule</Text>
      {todayBookings.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={22} color={COLORS.textSecondary} />
          <Text style={styles.emptyText}>No bookings scheduled for today.</Text>
        </View>
      ) : (
        todayBookings.slice(0, 8).map((b) => {
          const hasNote = !!(b.doctor_note && String(b.doctor_note).trim().length);
          const hasDraft = !!b.draft_rx_id;
          return (
            <TouchableOpacity
              key={b.booking_id}
              style={styles.bookingRow}
              onPress={() => router.push(`/bookings/${b.booking_id}` as any)}
              activeOpacity={0.7}
              testID={`overview-today-row-${b.booking_id}`}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: b.status === 'confirmed' ? COLORS.success : b.status === 'requested' ? COLORS.warning : COLORS.accent },
                ]}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.bookingName} numberOfLines={1}>{b.patient_name}</Text>
                  {hasNote && (
                    <Ionicons
                      name="bookmark"
                      size={11}
                      color={COLORS.primary}
                      testID={`overview-today-note-${b.booking_id}`}
                    />
                  )}
                  {hasDraft && (
                    <View style={styles.todayDraftChip} testID={`overview-today-draft-${b.booking_id}`}>
                      <Text style={styles.todayDraftChipText}>DRAFT</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.bookingMeta}>{b.booking_time} · {b.status}</Text>
              </View>
              {/* Send-message shortcut — visible only when this
                  booking is linked to a registered patient user.
                  Tapping opens the personal-message composer
                  pre-targeted at the patient. */}
              {b.patient_user_id ? (
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onMessagePatient?.({
                      user_id: b.patient_user_id,
                      name: b.patient_name,
                      phone: b.patient_phone,
                      email: b.patient_email,
                      role: 'patient',
                    });
                  }}
                  style={styles.msgPatientBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID={`overview-today-msg-${b.booking_id}`}
                >
                  <Ionicons name="paper-plane" size={14} color={COLORS.primary} />
                </TouchableOpacity>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
            </TouchableOpacity>
          );
        })
      )}

      {Array.isArray(data?.daily_bookings) && data.daily_bookings.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Last 14 days · bookings</Text>
          <View style={styles.chartCard}>
            <View style={styles.chartBars}>
              {data.daily_bookings.slice(-14).map((row: any, i: number) => {
                const max = Math.max(1, ...data.daily_bookings.map((r: any) => Number(r.count) || 0));
                const heightPct = Math.max(4, (Number(row.count) / max) * 100);
                const parts = String(row.date).split('-');
                const dayNum = parts[2] || '';
                const isToday = format(new Date(), 'yyyy-MM-dd') === row.date;
                return (
                  <View key={i} style={styles.chartCol}>
                    <Text style={styles.chartVal}>{row.count || ''}</Text>
                    <View style={styles.chartTrack}>
                      <View style={[styles.chartFill, { height: `${heightPct}%`, backgroundColor: isToday ? COLORS.accent : COLORS.primary }]} />
                    </View>
                    <Text style={[styles.chartLbl, isToday && { color: COLORS.accent, fontWeight: '700' }]}>{parseInt(dayNum, 10)}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.chartHint}>Tap the Bookings tab for full list.</Text>
          </View>
        </>
      )}

      {data?.top_diagnoses?.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Top diagnoses (last 3 months)</Text>
          {data.top_diagnoses.slice(0, 5).map((d: any, i: number) => {
            const max = Math.max(1, ...data.top_diagnoses.map((x: any) => Number(x.count) || 0));
            const pct = Math.min(100, ((Number(d.count) || 0) / max) * 100);
            return (
              <View key={i} style={styles.topRow}>
                <Text style={styles.topName} numberOfLines={1}>{d.label || d.name || '—'}</Text>
                <View style={styles.bar}>
                  <View style={[styles.barFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.topCount}>{d.count || 0}</Text>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

function QuickAction({ icon, iconLib, label, color, onPress, testID }: any) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.actionCard} testID={testID} activeOpacity={0.8}>
      <View style={[styles.actionIcon, { backgroundColor: color + '18' }]}>
        {iconLib === 'mci' ? (
          <MaterialCommunityIcons name={icon} size={22} color={color} />
        ) : (
          <Ionicons name={icon} size={22} color={color} />
        )}
      </View>
      <Text style={styles.actionLabel} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...FONTS.label, color: COLORS.primary, marginTop: 8, marginBottom: 10, textTransform: 'uppercase', fontSize: 12 },
  // ── Today header row layout ──
  todayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    marginBottom: 10,
  },
  todayTitle: { marginTop: 0, marginBottom: 0, flex: 1 },
  todayRefresh: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
    backgroundColor: COLORS.primary + '0F',
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  statCard: {
    width: '32%',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 64,
  },
  statValue: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 20 },
  statLabel: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, lineHeight: 14, marginTop: 4 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12, alignItems: 'stretch' },
  actionCard: {
    width: '23.5%',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'flex-start',
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 92,
  },
  actionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  actionLabel: {
    ...FONTS.bodyMedium,
    color: COLORS.textPrimary,
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 14,
  },
  bookingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  bookingName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15, flexShrink: 1 },
  bookingMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  todayDraftChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: COLORS.warning + '22',
  },
  todayDraftChipText: { ...FONTS.label, color: COLORS.warning, fontSize: 8 },
  msgPatientBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 6,
  },
  empty: { alignItems: 'center', padding: 24, gap: 8, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  topName: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, width: 100 },
  bar: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: COLORS.primary, borderRadius: 4 },
  topCount: { ...FONTS.label, color: COLORS.primary, fontSize: 12, width: 36, textAlign: 'right' },
  chartCard: { backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 120 },
  chartCol: { flex: 1, alignItems: 'center', gap: 3 },
  chartVal: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, height: 13 },
  chartTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: COLORS.bg, borderRadius: 4, overflow: 'hidden' },
  chartFill: { width: '100%', backgroundColor: COLORS.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartLbl: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  chartHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 8, textAlign: 'center' },
});
