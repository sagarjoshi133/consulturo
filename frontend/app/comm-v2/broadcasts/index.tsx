/**
 * Comm V2 — Broadcast Studio (list).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View, FlatList} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../../src/api';
import { V2, relTime, shared, stateLabel, stateTint } from '../../../src/comm-v2/ui-tokens';

type Broadcast = {
  id: string;
  state: string;
  title: string;
  body: string;
  category: string;
  audience_mode: string;
  scheduled_at: string | null;
  recipient_count_frozen: number;
  created_at: string;
};

const STATE_FILTERS: (string | null)[] = [
  null, 'draft', 'pending_approval', 'approved', 'scheduled',
  'completed', 'partially_failed', 'rejected', 'cancelled',
];

export default function BroadcastList() {
  const router = useRouter();
  const [items, setItems] = useState<Broadcast[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stateFilter, setStateFilter] = useState<string | null>(null);

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (stateFilter) params.state = stateFilter;
      if (!reset && cursor) params.cursor = cursor;
      const r = await api.get('/v2/communications/broadcasts', { params });
      const rows: Broadcast[] = r?.data?.items || [];
      setItems((prev) => (reset ? rows : [...prev, ...rows]));
      setCursor(r?.data?.next_cursor || null);
    } finally {
      if (reset) setLoading(false);
    }
  }, [stateFilter, cursor]);

  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stateFilter]);
  useFocusEffect(useCallback(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []));

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>Broadcast Studio</Text>
        <Pressable
          onPress={() => router.push('/comm-v2/broadcasts/templates' as any)}
          hitSlop={10}
          style={{ paddingHorizontal: 8, paddingVertical: 6 }}
        >
          <Ionicons name="bookmarks-outline" size={20} color={V2.accent} />
        </Pressable>
        <Pressable
          onPress={() => router.push('/comm-v2/broadcasts/compose' as any)}
          style={{ backgroundColor: V2.accent, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
        >
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>New</Text>
        </Pressable>
      </View>

      <View style={styles.stateRow}>
        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stateRowInner}
        >
          {STATE_FILTERS.map((s) => (
            <Pressable
              key={s || 'all'}
              onPress={() => setStateFilter(s)}
              style={[styles.chip, { backgroundColor: stateFilter === s ? V2.accent : V2.card, borderColor: stateFilter === s ? V2.accent : V2.border }]}
            >
              <Text style={{ color: stateFilter === s ? '#fff' : V2.fg, fontSize: 12, fontWeight: '700' }}>
                {s ? stateLabel[s] : 'All'}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      ) : items.length === 0 ? (
        <View style={shared.empty}>
          <Text style={shared.emptyTitle}>No broadcasts yet</Text>
          <Text style={shared.emptyBody}>Tap &quot;New&quot; to compose your first announcement.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/comm-v2/broadcasts/${item.id}` as any)}
              style={styles.row}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4 }}>
                  <View style={[shared.chip, { backgroundColor: (stateTint[item.state] || {}).bg }]}>
                    <Text style={[shared.chipTxt, { color: (stateTint[item.state] || {}).fg }]}>
                      {stateLabel[item.state] || item.state}
                    </Text>
                  </View>
                  <Text style={styles.audienceLabel}>· {audienceLabel(item.audience_mode)}</Text>
                </View>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                  <Text style={styles.meta}>{relTime(item.created_at)}</Text>
                  {item.recipient_count_frozen ? (
                    <Text style={styles.meta}>· {item.recipient_count_frozen} recipients</Text>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={V2.fgHint} />
            </Pressable>
          )}
          
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (cursor) load(false); }}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={V2.accent}
            onRefresh={async () => { setRefreshing(true); try { await load(true); } finally { setRefreshing(false); } }} />}
        />
      )}
    </SafeAreaView>
  );
}

function audienceLabel(a: string): string {
  return {
    patients: 'All patients',
    staff: 'Staff',
    both: 'Patients + staff',
    selected_patients: 'Selected patients',
    patients_with_future_appointments: 'Upcoming appts',
  }[a] || a;
}

const styles = StyleSheet.create({
  stateRow: {
    backgroundColor: V2.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.border,
    paddingVertical: 10,
  },
  stateRowInner: {
    paddingHorizontal: 12, gap: 8, alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34, justifyContent: 'center', alignItems: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: V2.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.divider,
  },
  title: { fontSize: 14, color: V2.fg, fontWeight: '700', marginBottom: 2 },
  body: { fontSize: 12, color: V2.fgMuted, lineHeight: 16 },
  meta: { fontSize: 11, color: V2.fgHint },
  audienceLabel: { fontSize: 11, color: V2.fgMuted, alignSelf: 'center' },
});
