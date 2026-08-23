/**
 * Unregistered Patients — dedicated browse/list screen.
 *
 * A patient is "unregistered" when they exist in the canonical patient
 * registry (from a walk-in / phone-in / guest booking) but never
 * signed up for an account. Their contact details are captured on
 * booking so staff can convert them later.
 *
 * Backend:
 *   GET /api/registry/patients?registration_status=unregistered
 *   GET /api/registry/patients/summary
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Platform, Pressable, RefreshControl,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS } from '../../src/theme';

type Patient = {
  patient_id: string;
  name?: string;
  phone?: string;
  phone_digits?: string;
  email?: string | null;
  age?: string;
  gender?: string;
  reg_no?: string | null;
  first_seen_at?: string;
  updated_at?: string;
};

type Tab = 'unregistered' | 'registered' | 'all';

const TAB_ORDER: Tab[] = ['unregistered', 'registered', 'all'];
const TAB_LABEL: Record<Tab, string> = {
  unregistered: 'Unregistered',
  registered:   'Registered',
  all:          'All patients',
};

export default function UnregisteredPatientsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unregistered');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<{
    total: number; registered: number; unregistered: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setErr(null);
    try {
      const [listRes, summaryRes] = await Promise.all([
        api.get('/registry/patients', {
          params: { q: q.trim(), limit: 100, registration_status: tab },
        }),
        api.get('/registry/patients/summary').catch(() => ({ data: null })),
      ]);
      setItems(Array.isArray(listRes?.data?.items) ? listRes.data.items : []);
      if (summaryRes?.data) setSummary(summaryRes.data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (typeof d === 'object' ? d?.detail || d?.message : null)
          || e?.message || 'Load failed';
      setErr(msg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => {
    // Debounce search-query changes.
    const t = setTimeout(() => { load(); }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q]);

  const badge = (t: Tab): number | null => {
    if (!summary) return null;
    if (t === 'unregistered') return summary.unregistered;
    if (t === 'registered')   return summary.registered;
    return summary.total;
  };

  const bookFor = (p: Patient) => {
    const p10 = String(p.phone_digits || p.phone || '').replace(/\D/g, '');
    router.push(
      `/(tabs)/book?phone=${encodeURIComponent(p10)}&name=${encodeURIComponent(p.name || '')}` as any,
    );
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Patients</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Tab pills */}
      <View style={styles.tabRow}>
        {TAB_ORDER.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {TAB_LABEL[t]}
              {badge(t) != null ? ` · ${badge(t)}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search box */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Name, phone, email, reg no…"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.searchInput}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Contextual hint for the Unregistered tab */}
      {tab === 'unregistered' && !q && !loading ? (
        <View style={styles.hintBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.primary} />
          <Text style={styles.hintTxt}>
            These patients booked without signing up. Their contact
            details are saved so you can invite them later.
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : err ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle" size={28} color={COLORS.textSecondary} />
          <Text style={styles.emptyTxt}>{err}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={32} color={COLORS.textSecondary} />
          <Text style={styles.emptyTxt}>
            {q ? 'No matches.' : tab === 'unregistered'
              ? 'No unregistered patients yet.'
              : 'No patients found.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.patient_id}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.primary}
              onRefresh={async () => {
                setRefreshing(true);
                try { await load({ silent: true }); }
                finally { setRefreshing(false); }
              }}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push(`/dashboard?tab=consultations` as any)}
            >
              <View style={styles.avatar}>
                <Ionicons
                  name={tab === 'unregistered' ? 'person-add' : 'person'}
                  size={20}
                  color={COLORS.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.name || 'Unnamed'}
                  </Text>
                  {item.reg_no ? (
                    <View style={styles.regNoChip}>
                      <Text style={styles.regNoTxt}>#{item.reg_no}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {(item.phone || item.phone_digits) ? `📞 ${item.phone || item.phone_digits}` : ''}
                  {item.email ? ` · ✉️ ${item.email}` : ''}
                  {item.age ? ` · ${item.age}y` : ''}
                  {item.gender ? ` · ${item.gender}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => bookFor(item)} style={styles.bookBtn} hitSlop={8}>
                <Ionicons name="calendar" size={14} color="#fff" />
                <Text style={styles.bookTxt}>Book</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: COLORS.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabTxt: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  tabTxtActive: { color: '#fff' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginTop: 10,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textPrimary, padding: 0 },
  hintBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 12, marginTop: 10, padding: 10,
    backgroundColor: '#E6F4F7', borderRadius: 10,
  },
  hintTxt: { flex: 1, fontSize: 12, color: COLORS.textPrimary, lineHeight: 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 12, marginTop: 8, padding: 12,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#E6F4F7',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  meta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 3 },
  regNoChip: { backgroundColor: '#E6F4F7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  regNoTxt: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  bookTxt: { fontSize: 12, color: '#fff', fontWeight: '700' },
  empty: {
    marginTop: 40, alignItems: 'center', paddingHorizontal: 24, gap: 8,
  },
  emptyTxt: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },
});
