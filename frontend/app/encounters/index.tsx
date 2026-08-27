/**
 * Encounters — Clinical Core (Phase E).
 * Staff list of patient encounters (clinical notes) with server-side
 * search + pagination, SWR-cached first page, and a New Encounter FAB.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { getCached, setCached, hasCached } from '../../src/data-cache';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type EncounterRow = {
  encounter_id: string;
  patient_name: string;
  patient_phone?: string;
  patient_age?: string;
  patient_sex?: string;
  chief_complaint?: string;
  diagnoses?: string[];
  prescription_id?: string | null;
  created_by_name?: string;
  created_at?: string;
};

const PAGE = 50;

function fmtDate(v?: string): string {
  if (!v) return '';
  try {
    const d = new Date(v);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return String(v).slice(0, 10); }
}

export default function EncountersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<EncounterRow[]>(() => getCached<EncounterRow[]>('encounters:first') ?? []);
  const [loading, setLoading] = useState(() => !hasCached('encounters:first'));
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [dueToday, setDueToday] = useState(0);

  const load = useCallback(async (query: string, skip = 0, append = false) => {
    try {
      const { data } = await api.get('/encounters', { params: { limit: PAGE, skip, q: query } });
      const rows: EncounterRow[] = data?.items || [];
      setTotal(data?.total || 0);
      setItems((prev) => (append ? [...prev, ...rows] : rows));
      if (!query && skip === 0) setCached('encounters:first', rows);
      setErr('');
    } catch (e: any) {
      const status = e?.response?.status;
      setErr(status === 403 ? 'Staff access required.' : 'Could not load encounters.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(q); }, [load])); // eslint-disable-line react-hooks/exhaustive-deps

  // How many follow-ups are due today (for the header badge).
  useFocusEffect(useCallback(() => {
    let alive = true;
    api.get('/encounters/followups', { params: { scope: 'today' } })
      .then((r) => { if (alive) setDueToday(r.data?.count || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, []));

  // Debounced server-side search
  useEffect(() => {
    const t = setTimeout(() => load(q), 350);
    return () => clearTimeout(t);
  }, [q, load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(q); }, [q, load]);

  const loadMore = useCallback(() => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    load(q, items.length, true);
  }, [loadingMore, items.length, total, q, load]);

  const renderItem = ({ item }: { item: EncounterRow }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => router.push(`/encounters/${item.encounter_id}` as any)}
      testID={`enc-row-${item.encounter_id}`}
    >
      <View style={styles.cardTop}>
        <Text style={styles.name} numberOfLines={1}>
          {item.patient_name}
          {!!(item.patient_age || item.patient_sex) && (
            <Text style={styles.meta}>  {item.patient_age}{item.patient_sex ? `/${item.patient_sex[0]}` : ''}</Text>
          )}
        </Text>
        <Text style={styles.date}>{fmtDate(item.created_at)}</Text>
      </View>
      {!!item.chief_complaint && <Text style={styles.complaint} numberOfLines={2}>{item.chief_complaint}</Text>}
      <View style={styles.chipsRow}>
        {(item.diagnoses || []).slice(0, 3).map((d) => (
          <View key={d} style={styles.dxChip}><Text style={styles.dxChipText}>{d}</Text></View>
        ))}
        {!!item.prescription_id && (
          <View style={styles.rxChip}>
            <Ionicons name="document-text" size={11} color={COLORS.success} />
            <Text style={styles.rxChipText}>Rx linked</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn} testID="enc-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Encounters</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => router.push('/encounters/followups' as any)}
          style={styles.fuHeaderBtn}
          testID="enc-followups"
        >
          <Ionicons name="calendar" size={15} color="#B45309" />
          <Text style={styles.fuHeaderText}>Follow-ups</Text>
          {dueToday > 0 && (
            <View style={styles.fuBadge} testID="enc-fu-badge">
              <Text style={styles.fuBadgeText}>{dueToday}</Text>
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.count}>{total ? `${total}` : ''}</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, phone, complaint, diagnosis…"
          placeholderTextColor={COLORS.textDisabled}
          value={q}
          onChangeText={setQ}
          testID="enc-search"
        />
        {!!q && (
          <TouchableOpacity onPress={() => setQ('')}>
            <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>
        )}
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
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} /> : null}
          ListEmptyComponent={(
            <View style={styles.center}>
              <Ionicons name="clipboard-outline" size={40} color={COLORS.textDisabled} />
              <Text style={styles.emptyText}>No encounters yet.{'\n'}Tap + to record the first clinical note.</Text>
            </View>
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/encounters/new' as any)}
        activeOpacity={0.85}
        testID="enc-new"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary },
  count: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  fuHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  fuHeaderText: { ...FONTS.bodyMedium, fontSize: 12, color: '#92400E' },
  fuBadge: {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    backgroundColor: '#B45309', alignItems: 'center', justifyContent: 'center',
  },
  fuBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Manrope_700Bold' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, marginHorizontal: 16, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, ...FONTS.body, fontSize: 14, color: COLORS.textPrimary, padding: 0 },
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
  date: { ...FONTS.body, fontSize: 11.5, color: COLORS.textDisabled },
  complaint: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dxChip: { backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  dxChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.primaryDark },
  rxChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.success + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  rxChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.success },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
});
