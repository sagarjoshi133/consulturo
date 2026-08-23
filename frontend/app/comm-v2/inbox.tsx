/**
 * Comm V2 — Notification Centre screen.
 *
 * - Server-computed unread counts (never derived on the client).
 * - Cursor pagination.
 * - Explicit batch-read of DISPLAYED ids (never clears items the user
 *   hasn't seen). This is the mandate that keeps the Messages screen
 *   from ever wiping the notification bell.
 * - Category chips pulled from server counts.
 * - Deep-links via VALIDATED action_type + action_target from
 *   comm_inbox_items (never arbitrary URLs).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View, FlatList} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import { V2, categoryLabel, relTime, shared } from '../../src/comm-v2/ui-tokens';
import { useCommunicationsV2 } from '../../src/comm-v2/communications-provider';

type Item = {
  id: string;
  category: string;
  item_type: string;
  source_id: string | null;
  title: string;
  body: string;
  action_type: string;
  action_target: string | null;
  priority: 'low' | 'normal' | 'high';
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};

const CATEGORY_ORDER = ['appointments', 'care_updates', 'reminders',
  'announcements', 'system', 'security'];

export default function InboxScreen() {
  const router = useRouter();
  const { counts, refresh } = useCommunicationsV2();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const displayedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const params: any = { limit: 30 };
      if (selectedCat) params.category = selectedCat;
      if (!reset && cursor) params.cursor = cursor;
      const r = await api.get('/v2/communications/inbox', { params });
      const newItems: Item[] = r?.data?.items || [];
      setItems((prev) => (reset ? newItems : [...prev, ...newItems]));
      setCursor(r?.data?.next_cursor || null);
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [selectedCat, cursor]);

  useEffect(() => { load(true); refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedCat]);

  // As items scroll into view we tag them "displayed" — then on
  // "mark all displayed as read" we only touch those. This is the
  // spec's "Mark only explicitly supplied/displayed item IDs as read".
  const onViewable = useCallback(({ viewableItems }: any) => {
    for (const v of viewableItems) {
      if (v?.item?.id && !v.item.read_at) displayedRef.current.add(v.item.id);
    }
  }, []);

  const markDisplayedRead = useCallback(async () => {
    const ids = Array.from(displayedRef.current).filter((id) => {
      const it = items.find((x) => x.id === id);
      return it && !it.read_at;
    });
    if (!ids.length) return;
    try {
      await api.post('/v2/communications/inbox/read-batch', { item_ids: ids });
      setItems((cur) => cur.map((x) => (ids.includes(x.id) ? { ...x, read_at: new Date().toISOString() } : x)));
      displayedRef.current.clear();
      refresh();
    } catch {}
  }, [items, refresh]);

  const onPressItem = useCallback(async (it: Item) => {
    // Explicit mark-this-one read.
    if (!it.read_at) {
      try {
        await api.post(`/v2/communications/inbox/${encodeURIComponent(it.id)}/read`);
        setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, read_at: new Date().toISOString() } : x)));
        refresh();
      } catch {}
    }
    switch (it.action_type) {
      case 'open_booking':
        if (it.action_target) router.push(`/booking/${it.action_target}` as any);
        break;
      case 'open_prescription':
        if (it.action_target) router.push(`/prescriptions/${it.action_target}` as any);
        break;
      case 'open_conversation':
        if (it.action_target) router.push(`/comm-v2/conversations/${it.action_target}` as any);
        break;
      case 'open_broadcast':
        if (it.action_target) router.push(`/comm-v2/broadcasts/${it.action_target}` as any);
        break;
      case 'open_home':
        router.push('/(tabs)' as any);
        break;
      default:
        // no-op — action_type='none' is a valid choice.
        break;
    }
  }, [refresh, router]);

  const onArchive = useCallback(async (it: Item) => {
    try {
      await api.post(`/v2/communications/inbox/${encodeURIComponent(it.id)}/archive`);
      setItems((cur) => cur.filter((x) => x.id !== it.id));
      refresh();
    } catch {}
  }, [refresh]);

  const totalUnread = counts.total_unread;
  const catChips = useMemo(() => {
    return CATEGORY_ORDER.map((c) => ({
      key: c,
      label: categoryLabel[c] || c,
      unread: counts.by_category?.[c] || 0,
    }));
  }, [counts.by_category]);

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>Notifications</Text>
        <Pressable onPress={markDisplayedRead} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: V2.accent, fontSize: 13, fontWeight: '600' }}>Mark shown read</Text>
        </Pressable>
      </View>

      {/* Category chips */}
      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowInner}
        >
          <Chip
            selected={selectedCat === null}
            label={`All${totalUnread ? ` · ${totalUnread}` : ''}`}
            onPress={() => setSelectedCat(null)}
          />
          {catChips.map((c) => (
            <Chip
              key={c.key}
              selected={selectedCat === c.key}
              label={`${c.label}${c.unread ? ` · ${c.unread}` : ''}`}
              onPress={() => setSelectedCat(c.key)}
            />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      ) : items.length === 0 ? (
        <View style={shared.empty}>
          <Text style={shared.emptyTitle}>You&apos;re all caught up</Text>
          <Text style={shared.emptyBody}>No notifications in this view.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => (
            <InboxRow item={item} onPress={() => onPressItem(item)} onArchive={() => onArchive(item)} />
          )}
          
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (cursor && !loadingMore) load(false); }}
          ListFooterComponent={loadingMore ? (
            <View style={{ padding: 16 }}><ActivityIndicator color={V2.accent} /></View>
          ) : null}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                try { await load(true); await refresh(); } finally { setRefreshing(false); }
              }}
              tintColor={V2.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? V2.accent : V2.card, borderColor: selected ? V2.accent : V2.border }]}
    >
      <Text style={{ color: selected ? '#fff' : V2.fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function InboxRow({ item, onPress, onArchive }: { item: Item; onPress: () => void; onArchive: () => void }) {
  const unread = !item.read_at;
  return (
    <Pressable onPress={onPress} onLongPress={onArchive} style={[styles.rowCard, unread && styles.rowUnread]}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.rowCat}>{categoryLabel[item.category] || item.category}</Text>
          <Text style={styles.rowTime}>{relTime(item.created_at)}</Text>
        </View>
        <Text style={[styles.rowTitle, unread && { fontWeight: '700' }]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
      </View>
      {unread ? <View style={styles.unreadDot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    backgroundColor: V2.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.border,
    paddingVertical: 10,
  },
  chipRowInner: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: V2.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.divider,
  },
  rowUnread: { backgroundColor: '#F2FAFB' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  rowCat: { fontSize: 11, fontWeight: '700', color: V2.accent, letterSpacing: 0.4 },
  rowTime: { fontSize: 11, color: V2.fgHint },
  rowTitle: { fontSize: 14, color: V2.fg, marginBottom: 2 },
  rowBody: { fontSize: 12, color: V2.fgMuted, lineHeight: 16 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: V2.unread,
    marginTop: 6,
  },
});
