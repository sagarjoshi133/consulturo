/**
 * Daily Collection — reception day-end summary.
 * Collected vs Pending dues vs Waived across the day's encounters, plus a
 * follow-up list of unpaid visits (today + carry-over) so nothing slips.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type Due = {
  encounter_id: string;
  patient_name?: string;
  patient_phone?: string;
  fee_amount?: number;
  booking_time?: string;
  booking_date?: string;
  stage?: string;
};
type Summary = {
  date: string;
  collected: number;
  pending_due: number;
  waived_total: number;
  counts: { paid: number; pending: number; waived: number; total: number };
  pending_list: Due[];
};

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export default function CollectionScreen() {
  const router = useRouter();
  const todayIso = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [day, setDay] = useState(todayIso);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [carry, setCarry] = useState<{ items: Due[]; total_due: number }>({ items: [], total_due: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        api.get('/encounters/collection-summary', { params: { date: day } }),
        api.get('/encounters/pending-dues', { params: { days: 7 } }),
      ]);
      setSummary(s.data);
      setCarry({ items: c.data?.items || [], total_due: c.data?.total_due || 0 });
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [day]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const recordPayment = useCallback((d: Due) => {
    router.push({
      pathname: '/billing/new',
      params: {
        encounter_id: d.encounter_id,
        patient_name: d.patient_name || '',
        patient_phone: d.patient_phone || '',
        amount: d.fee_amount ? String(d.fee_amount) : '',
        description: 'Consultation',
        service_type: 'consultation',
      },
    } as any);
  }, [router]);

  const money = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const isToday = day === todayIso;
  // Carry-over = unpaid from days OTHER than the one being viewed.
  const carryOthers = carry.items.filter((c) => c.booking_date !== day);

  const header = (
    <View>
      <View style={styles.dateBar}>
        <TouchableOpacity onPress={() => setDay(shiftDay(day, -1))} style={styles.dateArrow} testID="col-prev">
          <Ionicons name="chevron-back" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
        <View style={styles.dateCenter}>
          <Text style={styles.dateText}>{isToday ? 'Today' : day}</Text>
          <Text style={styles.dateSub}>{day}</Text>
        </View>
        <TouchableOpacity onPress={() => !isToday && setDay(shiftDay(day, 1))} style={[styles.dateArrow, isToday && { opacity: 0.3 }]} disabled={isToday} testID="col-next">
          <Ionicons name="chevron-forward" size={20} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      <View style={styles.cardsRow}>
        <View style={[styles.statCard, { backgroundColor: '#D1FAE5' }]}>
          <Text style={[styles.statValue, { color: '#047857' }]} numberOfLines={1} adjustsFontSizeToFit>{money(summary?.collected)}</Text>
          <Text style={[styles.statLabel, { color: '#047857' }]} numberOfLines={1}>Collected</Text>
          <Text style={styles.statMeta} numberOfLines={1}>{summary?.counts.paid || 0} paid</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#FEF3C7' }]}>
          <Text style={[styles.statValue, { color: '#B45309' }]} numberOfLines={1} adjustsFontSizeToFit>{money(summary?.pending_due)}</Text>
          <Text style={[styles.statLabel, { color: '#B45309' }]} numberOfLines={1}>Pending</Text>
          <Text style={styles.statMeta} numberOfLines={1}>{summary?.counts.pending || 0} pending</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#F1F5F9' }]}>
          <Text style={[styles.statValue, { color: '#475569' }]} numberOfLines={1} adjustsFontSizeToFit>{money(summary?.waived_total)}</Text>
          <Text style={[styles.statLabel, { color: '#475569' }]} numberOfLines={1}>Waived</Text>
          <Text style={styles.statMeta} numberOfLines={1}>{summary?.counts.waived || 0} waived</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        Follow up — unpaid {isToday ? 'today' : `on ${day}`} ({(summary?.pending_list || []).length})
      </Text>
    </View>
  );

  const renderDue = ({ item }: { item: Due }) => (
    <View style={styles.dueCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.dueName} numberOfLines={1}>{item.patient_name || '—'}</Text>
        <Text style={styles.dueMeta}>
          {item.patient_phone || 'no phone'}{item.booking_time ? ` · ${item.booking_time}` : ''}{item.booking_date && item.booking_date !== day ? ` · ${item.booking_date}` : ''}
        </Text>
      </View>
      <Text style={styles.dueAmt}>₹{Number(item.fee_amount || 0).toLocaleString('en-IN')}</Text>
      <TouchableOpacity style={styles.collectBtn} onPress={() => recordPayment(item)} testID={`col-collect-${item.encounter_id}`}>
        <Ionicons name="card-outline" size={15} color="#fff" />
        <Text style={styles.collectText}>Collect</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters')} style={styles.backBtn} testID="col-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Daily Collection</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={summary?.pending_list || []}
          keyExtractor={(it) => it.encounter_id}
          renderItem={renderDue}
          ListHeaderComponent={header}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No unpaid visits {isToday ? 'today' : 'on this day'}. 🎉</Text>}
          ListFooterComponent={carryOthers.length ? (
            <View style={{ marginTop: 18 }}>
              <Text style={styles.sectionTitle}>Carry-over dues (last 7 days) · {carryOthers.length}</Text>
              {carryOthers.map((it) => (
                <View key={it.encounter_id}>{renderDue({ item: it })}</View>
              ))}
            </View>
          ) : null}
        />
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
  dateBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 8, marginBottom: 14 },
  dateArrow: { padding: 8 },
  dateCenter: { alignItems: 'center' },
  dateText: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary },
  dateSub: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary },
  cardsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, minWidth: 0, borderRadius: RADIUS.md, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', gap: 2 },
  statValue: { ...FONTS.h2, fontSize: 16 },
  statLabel: { ...FONTS.bodyMedium, fontSize: 11.5 },
  statMeta: { ...FONTS.body, fontSize: 10, color: COLORS.textSecondary },
  sectionTitle: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary, marginTop: 18, marginBottom: 8 },
  emptyText: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', paddingVertical: 24 },
  dueCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8 },
  dueName: { ...FONTS.bodyMedium, fontSize: 14, color: COLORS.textPrimary },
  dueMeta: { ...FONTS.body, fontSize: 11.5, color: COLORS.textSecondary },
  dueAmt: { ...FONTS.bodyMedium, fontSize: 14, color: '#B45309' },
  collectBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 9, paddingHorizontal: 12 },
  collectText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
});
