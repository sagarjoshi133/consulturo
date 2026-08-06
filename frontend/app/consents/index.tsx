/**
 * /consents — list of saved surgical consents.
 *
 * Shows the most recent consents with patient name, procedure, date,
 * language, and "View" button. Filterable by patient phone (entered
 * via search box). Tapping a row routes to /consents/[id].
 *
 * Created during Phase 2 — Consent Forms.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  TextInput, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { EmptyState } from '../../src/empty-state';

type ConsentRow = {
  consent_id: string;
  procedure_key: string;
  procedure_snapshot?: any;
  patient_name: string;
  patient_phone?: string;
  language: 'en' | 'hi' | 'gu';
  created_at: string;
  patient_signature_b64?: string | null;
  doctor_signature_b64?: string | null;
};

export default function ConsentsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ConsentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 100 };
      if (search.trim().match(/^[\d+\s-]+$/)) {
        params.patient_phone = search.trim();
      }
      const r = await api.get('/surgical-consents', { params });
      setItems(r.data?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = search
    ? items.filter((i) => {
        const q = search.toLowerCase();
        return (
          i.patient_name?.toLowerCase().includes(q) ||
          i.patient_phone?.includes(q) ||
          i.procedure_key?.includes(q)
        );
      })
    : items;

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Please sign in to view consents.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Surgical Consents</Text>
        <TouchableOpacity onPress={() => router.push('/consents/new')} style={styles.newBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by patient name, phone, or procedure"
          placeholderTextColor={COLORS.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={COLORS.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.consent_id}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 80 }}
          ListEmptyComponent={
            <View style={{ paddingTop: 40 }}>
              <EmptyState
                icon="document-text-outline"
                title={search ? 'No consents match' : 'No consents yet'}
                message={
                  search
                    ? 'Try a different search term.'
                    : 'Tap "New" to create your first surgical consent. 50 procedures available with EN/HI/GU.'
                }
              />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          renderItem={({ item }) => {
            const procName = item.procedure_snapshot?.name?.[item.language] || item.procedure_snapshot?.name?.en || item.procedure_key;
            const dateLabel = (() => {
              try { return format(new Date(item.created_at), 'd MMM yyyy, h:mm a'); }
              catch { return ''; }
            })();
            const isSigned = !!(item.patient_signature_b64 && item.doctor_signature_b64);
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push(`/consents/${item.consent_id}` as any)}
                testID={`consent-row-${item.consent_id}`}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.patientName} numberOfLines={1}>{item.patient_name}</Text>
                  <View style={[styles.langPill, { backgroundColor: COLORS.primary + '18' }]}>
                    <Text style={styles.langText}>{item.language.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={styles.procName} numberOfLines={2}>{procName}</Text>
                <View style={styles.cardFoot}>
                  <View style={styles.metaRow}>
                    <Ionicons name="time-outline" size={12} color={COLORS.textSecondary} />
                    <Text style={styles.meta}>{dateLabel}</Text>
                  </View>
                  {isSigned ? (
                    <View style={styles.signedPill}>
                      <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
                      <Text style={styles.signedText}>Signed</Text>
                    </View>
                  ) : (
                    <View style={styles.pendingPill}>
                      <Ionicons name="alert-circle-outline" size={12} color="#F59E0B" />
                      <Text style={styles.pendingText}>Awaiting signature</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  headerBtn: { padding: 4 },
  headerTitle: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  newBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 14 },
  card: {
    backgroundColor: '#fff',
    padding: 12, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  patientName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15, flex: 1 },
  langPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  langText: { ...FONTS.label, color: COLORS.primary, fontSize: 10, fontWeight: '700' },
  procName: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  cardFoot: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  signedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, backgroundColor: COLORS.success + '18',
  },
  signedText: { ...FONTS.label, color: COLORS.success, fontSize: 10, fontWeight: '700' },
  pendingPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, backgroundColor: '#FEF3C7',
  },
  pendingText: { ...FONTS.label, color: '#92400E', fontSize: 10, fontWeight: '700' },
});
