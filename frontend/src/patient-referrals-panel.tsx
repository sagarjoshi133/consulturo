/**
 * Patient Referrals dashboard tab.
 *
 * Shows totals, top-referrer leaderboard, and the recent attribution
 * feed. Lets the owner manually mark a referral as "visited" if they
 * didn't go through the standard booking-complete path.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { formatISTShort } from './date';
import { useToast } from './toast';

type Attribution = {
  id: string;
  code: string;
  referrer_user_id?: string;
  referrer_name?: string;
  referrer_type?: 'patient' | 'staff' | 'doctor';
  referee_phone?: string | null;
  referee_name?: string | null;
  booking_id?: string | null;
  source?: string;
  status: 'pending' | 'booked' | 'visited';
  created_at?: string;
  booked_at?: string | null;
  visited_at?: string | null;
};

type Leader = {
  user_id?: string;
  name: string;
  referrer_type?: string;
  total: number;
  booked: number;
  visited: number;
};

type StatusFilter = 'all' | 'pending' | 'booked' | 'visited';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  booked: 'Booked',
  visited: 'Visited',
};

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#FEF3C7', color: '#B45309', label: 'Pending' },
  booked: { bg: '#DBEAFE', color: '#1E40AF', label: 'Booked' },
  visited: { bg: '#DCFCE7', color: '#166534', label: 'Visited' },
};

const SOURCE_ICON: Record<string, any> = {
  whatsapp: 'logo-whatsapp',
  qr: 'qr-code',
  copy: 'copy-outline',
  native_share: 'share-social',
  link: 'link',
};

export default function PatientReferralsPanel() {
  const toast = useToast();
  const [items, setItems] = useState<Attribution[]>([]);
  const [counts, setCounts] = useState<{ total: number; pending: number; booked: number; visited: number }>({
    total: 0, pending: 0, booked: 0, visited: 0,
  });
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, lb] = await Promise.all([
        api.get('/admin/referrals', { params: filter === 'all' ? {} : { status: filter } }),
        api.get('/admin/referrals/leaderboard'),
      ]);
      setItems((r.data?.items || []) as Attribution[]);
      setCounts(r.data?.counts || { total: 0, pending: 0, booked: 0, visited: 0 });
      setLeaders((lb.data?.items || []) as Leader[]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load referrals');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { void load(); }, [load]);

  const markVisited = useCallback(async (a: Attribution) => {
    try {
      await api.post(`/referrals/${a.id}/mark-visited`);
      toast.success('Marked as visited');
      await load();
    } catch (e: any) {
      Alert.alert('Update failed', e?.response?.data?.detail || 'Unknown');
    }
  }, [load, toast]);

  if (loading) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
      {/* KPI strip */}
      <View style={styles.kpiRow}>
        <Kpi color="#0EA5E9" icon="person-add" label="Invited" value={counts.total} />
        <Kpi color="#F59E0B" icon="time-outline" label="Pending" value={counts.pending} />
        <Kpi color="#1D4ED8" icon="calendar-outline" label="Booked" value={counts.booked} />
        <Kpi color="#16A34A" icon="checkmark-done-circle" label="Visited" value={counts.visited} />
      </View>

      {/* Leaderboard */}
      <Text style={styles.sectionTitle}>Top Referrers</Text>
      {leaders.length === 0 ? (
        <Text style={styles.empty}>No referrers yet. Patients and staff who share their link will appear here.</Text>
      ) : (
        <View style={styles.leaderCard}>
          {leaders.map((l, i) => (
            <View key={l.user_id || i} style={[styles.leaderRow, i === leaders.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={[styles.rank, i === 0 ? { backgroundColor: '#FBBF24' } : i === 1 ? { backgroundColor: '#9CA3AF' } : i === 2 ? { backgroundColor: '#D97706' } : { backgroundColor: '#E5E7EB' }]}>
                <Text style={[styles.rankText, i > 2 && { color: '#1F2937' }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.leaderName} numberOfLines={1}>{l.name}</Text>
                <Text style={styles.leaderType}>{l.referrer_type || 'patient'}</Text>
              </View>
              <View style={styles.leaderCounts}>
                <Text style={styles.leaderCountVisited}>{l.visited} ✓</Text>
                <Text style={styles.leaderCountSub}>{l.booked} booked · {l.total} invited</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Filter chips */}
      <View style={[styles.sectionRow, { marginTop: 18 }]}>
        <Text style={[styles.sectionTitle, { flex: 1, marginBottom: 0 }]}>Recent Referrals</Text>
        <View style={styles.filterRow}>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipOn]}
              testID={`ref-filter-${f}`}
            >
              <Text style={[styles.filterChipText, filter === f && { color: '#fff' }]}>{FILTER_LABELS[f]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>No referrals to show.</Text>
      ) : (
        items.map((a) => {
          const pill = STATUS_PILL[a.status] || STATUS_PILL.pending;
          const srcIcon = SOURCE_ICON[a.source || 'link'] || 'link';
          return (
            <View key={a.id} style={styles.attrCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <View style={[styles.sourceBubble]}>
                  <Ionicons name={srcIcon as any} size={14} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.attrTitle} numberOfLines={1}>
                    {a.referee_name || a.referee_phone || 'Anonymous visitor'}
                  </Text>
                  <Text style={styles.attrSub} numberOfLines={1}>
                    Code <Text style={{ fontWeight: '700' }}>{a.code}</Text>
                    {' · '}from {a.referrer_name || '—'}
                  </Text>
                </View>
                <View style={[styles.pill, { backgroundColor: pill.bg }]}>
                  <Text style={[styles.pillText, { color: pill.color }]}>{pill.label}</Text>
                </View>
              </View>
              <View style={styles.metaRow}>
                {a.created_at ? <Text style={styles.metaText}>Invited {formatISTShort(a.created_at)}</Text> : null}
                {a.booked_at ? <Text style={styles.metaText}>Booked {formatISTShort(a.booked_at)}</Text> : null}
                {a.visited_at ? <Text style={styles.metaText}>Visited {formatISTShort(a.visited_at)}</Text> : null}
              </View>
              {a.status !== 'visited' ? (
                <View style={{ marginTop: 8, flexDirection: 'row' }}>
                  <TouchableOpacity
                    style={styles.markBtn}
                    onPress={() => markVisited(a)}
                    testID={`ref-mark-${a.id}`}
                  >
                    <Ionicons name="checkmark-circle" size={14} color="#fff" />
                    <Text style={styles.markBtnText}>Mark visited</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Kpi({ color, icon, label, value }: { color: string; icon: any; label: string; value: number }) {
  return (
    <View style={[styles.kpi, { borderLeftColor: color }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.kpiVal}>{value}</Text>
      <Text style={styles.kpiLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  kpi: {
    flexGrow: 1, minWidth: '22%',
    backgroundColor: '#fff', padding: 12,
    borderRadius: RADIUS.card,
    borderLeftWidth: 4, borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  kpiVal: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18, marginTop: 4 },
  kpiLbl: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  sectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 14, marginTop: 18, marginBottom: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  empty: { color: COLORS.textTertiary, padding: 16, fontSize: 12.5, textAlign: 'center' },
  leaderCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  leaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  rank: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  rankText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  leaderName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  leaderType: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1, textTransform: 'capitalize' },
  leaderCounts: { alignItems: 'flex-end' },
  leaderCountVisited: { color: '#16A34A', fontWeight: '800', fontSize: 14 },
  leaderCountSub: { color: COLORS.textSecondary, fontSize: 10.5, marginTop: 2 },

  filterRow: { flexDirection: 'row', gap: 4 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  filterChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterChipText: { fontSize: 11, color: COLORS.textPrimary, fontWeight: '600' },

  attrCard: {
    backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border, marginTop: 8,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  sourceBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  attrTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  attrSub: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 10.5, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  metaText: { color: COLORS.textSecondary, fontSize: 11 },
  markBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, backgroundColor: COLORS.primary,
  },
  markBtnText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
});
