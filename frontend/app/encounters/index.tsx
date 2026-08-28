/**
 * Encounters — Clinic Worklist (reception-facing).
 * A single day-view that MERGES confirmed bookings (not yet started) with
 * live encounters across every stage, so reception can drive the whole
 * flow from one screen:
 *   To Start (booking) → Open (intake) → In Consultation → Completed.
 * Each row shows a stage chip + a payment badge and a one-tap action.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, RefreshControl, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { getCached, setCached, hasCached, invalidateCached } from '../../src/data-cache';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';
import { haptics } from '../../src/haptics';

type Row = {
  kind: 'booking' | 'encounter';
  stage: 'to_start' | 'open' | 'in_consultation' | 'completed';
  encounter_id?: string | null;
  booking_id?: string | null;
  patient_name: string;
  patient_phone?: string;
  patient_age?: string;
  patient_sex?: string;
  chief_complaint?: string;
  payment_status?: 'pending' | 'paid' | 'waived' | null;
  fee_amount?: number | null;
  prescription_id?: string | null;
  booking_date?: string;
  booking_time?: string;
  patient_user_id?: string;
};

type Counts = { to_start: number; open: number; in_consultation: number; completed: number };

const STAGES: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'to_start', label: 'To Start' },
  { key: 'open', label: 'Open' },
  { key: 'in_consultation', label: 'In Consult' },
  { key: 'completed', label: 'Completed' },
];

const STAGE_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  to_start: { label: 'To Start', color: '#1D4ED8', bg: '#DBEAFE', icon: 'play-circle-outline' },
  open: { label: 'Open', color: '#B45309', bg: '#FEF3C7', icon: 'create-outline' },
  in_consultation: { label: 'In Consultation', color: '#6D28D9', bg: '#EDE9FE', icon: 'medkit-outline' },
  completed: { label: 'Completed', color: '#047857', bg: '#D1FAE5', icon: 'checkmark-done' },
};

const PAY_META: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  pending: { label: 'Payment pending', color: '#B45309', bg: '#FEF3C7', icon: 'time-outline' },
  paid: { label: 'Paid', color: '#047857', bg: '#D1FAE5', icon: 'checkmark-circle' },
  waived: { label: 'Waived off', color: '#64748B', bg: '#F1F5F9', icon: 'remove-circle-outline' },
};

export default function EncountersWorklistScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Row[]>(() => getCached<Row[]>('worklist:first') ?? []);
  const [counts, setCounts] = useState<Counts>({ to_start: 0, open: 0, in_consultation: 0, completed: 0 });
  const [loading, setLoading] = useState(() => !hasCached('worklist:first'));
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [dueToday, setDueToday] = useState(0);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/encounters/worklist');
      const rows: Row[] = data?.items || [];
      setItems(rows);
      setCounts(data?.counts || { to_start: 0, open: 0, in_consultation: 0, completed: 0 });
      setCached('worklist:first', rows);
      setErr('');
    } catch (e: any) {
      setErr(e?.response?.status === 403 ? 'Staff access required.' : 'Could not load worklist.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    let alive = true;
    api.get('/encounters/followups', { params: { scope: 'today' } })
      .then((r) => { if (alive) setDueToday(r.data?.count || 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, []));

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const startEncounter = useCallback((row: Row) => {
    router.push({
      pathname: '/encounters/new',
      params: {
        booking_id: row.booking_id || '',
        patient_user_id: row.patient_user_id || '',
        patient_name: row.patient_name || '',
        patient_phone: row.patient_phone || '',
        patient_age: row.patient_age || '',
        patient_sex: row.patient_sex || '',
        chief_complaint: row.chief_complaint || '',
      },
    } as any);
  }, [router]);

  const startConsultation = useCallback(async (row: Row) => {
    if (!row.encounter_id) return;
    setBusyId(row.encounter_id);
    try {
      await api.post(`/encounters/${row.encounter_id}/start-consultation`);
      invalidateCached('worklist:');
      router.push({ pathname: '/prescriptions/new', params: { encounterId: row.encounter_id } } as any);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not start consultation';
      if (Platform.OS === 'web') window.alert(String(msg)); else Alert.alert('Error', String(msg));
    } finally {
      setBusyId('');
    }
  }, [router]);

  const dueTotal = counts.to_start + counts.open + counts.in_consultation;

  const filtered = items.filter((r) => {
    if (scope !== 'all' && r.stage !== scope) return false;
    if (!q.trim()) return true;
    const s = q.trim().toLowerCase();
    return (
      (r.patient_name || '').toLowerCase().includes(s) ||
      (r.patient_phone || '').includes(s) ||
      (r.chief_complaint || '').toLowerCase().includes(s)
    );
  });

  const renderItem = ({ item }: { item: Row }) => {
    const sm = STAGE_META[item.stage];
    const pm = item.payment_status ? PAY_META[item.payment_status] : null;
    const openDetail = () => item.encounter_id && router.push(`/encounters/${item.encounter_id}` as any);
    const busy = busyId && busyId === item.encounter_id;
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={item.kind === 'encounter' ? 0.8 : 1}
        onPress={item.kind === 'encounter' ? openDetail : undefined}
        testID={`wl-row-${item.encounter_id || item.booking_id}`}
      >
        <View style={styles.cardTop}>
          <Text style={styles.name} numberOfLines={1}>
            {item.patient_name}
            {!!(item.patient_age || item.patient_sex) && (
              <Text style={styles.meta}>  {item.patient_age}{item.patient_sex ? `/${item.patient_sex[0]}` : ''}</Text>
            )}
          </Text>
          {!!item.booking_time && <Text style={styles.time}>{item.booking_time}</Text>}
        </View>

        <View style={styles.badgeRow}>
          <View style={[styles.stageChip, { backgroundColor: sm.bg }]}>
            <Ionicons name={sm.icon} size={11} color={sm.color} />
            <Text style={[styles.stageChipText, { color: sm.color }]}>{sm.label}</Text>
          </View>
          {!!pm && (
            <View style={[styles.payChip, { backgroundColor: pm.bg }]}>
              <Ionicons name={pm.icon} size={11} color={pm.color} />
              <Text style={[styles.payChipText, { color: pm.color }]}>{pm.label}</Text>
            </View>
          )}
          {!!item.prescription_id && (
            <View style={styles.rxChip}>
              <Ionicons name="document-text" size={11} color={COLORS.success} />
              <Text style={styles.rxChipText}>Rx</Text>
            </View>
          )}
        </View>

        {!!item.chief_complaint && <Text style={styles.complaint} numberOfLines={1}>{item.chief_complaint}</Text>}

        <View style={styles.actionRow}>
          {item.stage === 'to_start' && (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => startEncounter(item)} testID={`wl-start-enc-${item.booking_id}`}>
              <Ionicons name="play" size={15} color="#fff" />
              <Text style={styles.primaryBtnText}>Start Encounter</Text>
            </TouchableOpacity>
          )}
          {item.stage === 'open' && (
            <>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push({ pathname: '/encounters/new', params: { editId: item.encounter_id } } as any)}>
                <Ionicons name="create-outline" size={15} color={COLORS.primaryDark} />
                <Text style={styles.secondaryBtnText}>Edit intake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => startConsultation(item)} disabled={!!busy} testID={`wl-start-consult-${item.encounter_id}`}>
                {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="medkit" size={15} color="#fff" />}
                <Text style={styles.primaryBtnText}>Start Consultation</Text>
              </TouchableOpacity>
            </>
          )}
          {item.stage === 'in_consultation' && (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push({ pathname: '/prescriptions/new', params: { encounterId: item.encounter_id } } as any)} testID={`wl-resume-${item.encounter_id}`}>
              <Ionicons name="play-forward" size={15} color="#fff" />
              <Text style={styles.primaryBtnText}>Resume Consultation</Text>
            </TouchableOpacity>
          )}
          {item.stage === 'completed' && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={openDetail}>
              <Ionicons name="eye-outline" size={15} color={COLORS.primaryDark} />
              <Text style={styles.secondaryBtnText}>View encounter</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn} testID="wl-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Encounters</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => router.push('/encounters/followups' as any)} style={styles.fuHeaderBtn} testID="wl-followups">
          <Ionicons name="calendar" size={15} color="#B45309" />
          {dueToday > 0 && <View style={styles.fuBadge}><Text style={styles.fuBadgeText}>{dueToday}</Text></View>}
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textDisabled} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, phone, complaint…"
          placeholderTextColor={COLORS.textDisabled}
          value={q}
          onChangeText={setQ}
          testID="wl-search"
        />
        {!!q && (
          <TouchableOpacity onPress={() => setQ('')}>
            <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chipsBar}>
        {STAGES.map((s) => {
          const active = scope === s.key;
          const n = s.key === 'all' ? items.length : (counts as any)[s.key] ?? 0;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => { setScope(s.key); haptics.light(); }}
              testID={`wl-filter-${s.key}`}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{s.label}{n ? ` ${n}` : ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {dueTotal > 0 && (
        <Text style={styles.pendingLine} testID="wl-pending">
          {dueTotal} pending action{dueTotal > 1 ? 's' : ''} today
        </Text>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : err ? (
        <View style={styles.center}><Text style={styles.errText}>{err}</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.encounter_id || `bk_${it.booking_id}`}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ListEmptyComponent={(
            <View style={styles.center}>
              <Ionicons name="clipboard-outline" size={40} color={COLORS.textDisabled} />
              <Text style={styles.emptyText}>Nothing here.{'\n'}Confirmed bookings and encounters will appear on this worklist.</Text>
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.fab} onPress={() => router.push('/encounters/new' as any)} activeOpacity={0.85} testID="wl-new">
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
  fuHeaderBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1,
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  fuBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: '#B45309', alignItems: 'center', justifyContent: 'center' },
  fuBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Manrope_700Bold' },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: COLORS.surface, marginHorizontal: 16, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, ...FONTS.body, fontSize: 14, color: COLORS.textPrimary, padding: 0 },
  chipsBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { ...FONTS.bodyMedium, fontSize: 12.5, color: COLORS.textSecondary },
  filterChipTextActive: { color: '#fff' },
  pendingLine: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, paddingHorizontal: 18, paddingTop: 8 },
  center: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 14 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { ...FONTS.bodyMedium, fontSize: 15, color: COLORS.textPrimary, flex: 1 },
  meta: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary },
  time: { ...FONTS.bodyMedium, fontSize: 12, color: COLORS.primaryDark },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  stageChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  stageChipText: { ...FONTS.bodyMedium, fontSize: 11 },
  payChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  payChipText: { ...FONTS.bodyMedium, fontSize: 11 },
  rxChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.success + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 4 },
  rxChipText: { ...FONTS.bodyMedium, fontSize: 11, color: COLORS.success },
  complaint: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 12, minWidth: 140 },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13.5 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '30', borderRadius: RADIUS.md, paddingVertical: 11, paddingHorizontal: 14 },
  secondaryBtnText: { ...FONTS.bodyMedium, color: COLORS.primaryDark, fontSize: 13.5 },
  fab: {
    position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
});
