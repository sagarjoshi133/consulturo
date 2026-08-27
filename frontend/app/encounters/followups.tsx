/**
 * Encounter Follow-ups — Clinical Core (Phase E).
 * Staff view of upcoming follow-up visits scheduled on encounters, with
 * a "Today" filter. Tapping a row opens the encounter.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type Row = {
  encounter_id: string;
  patient_name: string;
  patient_phone?: string;
  chief_complaint?: string;
  diagnoses?: string[];
  follow_up_date?: string;
};

function fmtDate(v?: string): string {
  if (!v) return '';
  try {
    return new Date(v + 'T00:00:00').toLocaleDateString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return String(v); }
}

export default function FollowupsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Row[]>([]);
  const [today, setToday] = useState('');
  const [scope, setScope] = useState<'upcoming' | 'today'>('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async (sc: 'upcoming' | 'today') => {
    try {
      const { data } = await api.get('/encounters/followups', { params: { scope: sc } });
      setItems(data?.items || []);
      setToday(data?.today || '');
      setErr('');
    } catch (e: any) {
      setErr(e?.response?.status === 403 ? 'Staff access required.' : 'Could not load follow-ups.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  const onRefresh = useCallback(() => { setRefreshing(true); load(scope); }, [scope, load]);

  const renderItem = ({ item }: { item: Row }) => {
    const isToday = item.follow_up_date === today;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => router.push(`/encounters/${item.encounter_id}` as any)}
        testID={`fu-row-${item.encounter_id}`}
      >
        <View style={styles.cardTop}>
          <Text style={styles.name} numberOfLines={1}>{item.patient_name}</Text>
          <View style={[styles.dateBadge, isToday && styles.dateBadgeToday]}>
            <Text style={[styles.dateBadgeText, isToday && styles.dateBadgeTextToday]}>
              {isToday ? 'Today' : fmtDate(item.follow_up_date)}
            </Text>
          </View>
        </View>
        {!!item.patient_phone && <Text style={styles.meta}>{item.patient_phone}</Text>}
        {!!item.chief_complaint && <Text style={styles.complaint} numberOfLines={2}>{item.chief_complaint}</Text>}
        <View style={styles.chipsRow}>
          {(item.diagnoses || []).slice(0, 3).map((d) => (
            <View key={d} style={styles.dxChip}><Text style={styles.dxChipText}>{d}</Text></View>
          ))}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/encounters')} style={styles.backBtn} testID="fu-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Follow-ups</Text>
      </View>

      <View style={styles.tabs}>
        {(['today', 'upcoming'] as const).map((sc) => (
          <TouchableOpacity
            key={sc}
            style={[styles.tab, scope === sc && styles.tabActive]}
            onPress={() => setScope(sc)}
            testID={`fu-tab-${sc}`}
          >
            <Text style={[styles.tabText, scope === sc && styles.tabTextActive]}>
              {sc === 'today' ? 'Today' : 'Upcoming'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : err ? (
        <View style={styles.center}><Text style={styles.errText}>{err}</Text></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.encounter_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ListEmptyComponent={(
            <View style={styles.center}>
              <Ionicons name="calendar-outline" size={40} color={COLORS.textDisabled} />
              <Text style={styles.emptyText}>
                {scope === 'today' ? 'No follow-ups scheduled for today.' : 'No upcoming follow-ups.'}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textSecondary },
  tabTextActive: { color: '#fff' },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 14 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border, gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary, flex: 1 },
  meta: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary },
  complaint: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  dateBadge: {
    backgroundColor: COLORS.bg, borderColor: COLORS.border, borderWidth: 1,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  dateBadgeToday: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  dateBadgeText: { ...FONTS.bodyMedium, fontSize: 11.5, color: COLORS.textSecondary },
  dateBadgeTextToday: { color: '#92400E' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dxChip: { backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  dxChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.primaryDark },
});
