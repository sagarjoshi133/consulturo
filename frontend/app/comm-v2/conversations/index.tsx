/**
 * Comm V2 — Conversation list.
 *
 * Staff/owner view: all conversations, unread-first, cursor paginated,
 * filterable by state + searchable.
 * Patient view: their own conversation (auto-created on GET).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, View, FlatList} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import api from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { V2, relTime, shared, stateLabel, stateTint } from '../../../src/comm-v2/ui-tokens';

type Conv = {
  id: string;
  patient_user_id: string;
  patient_display_name?: string;
  state: string;
  assigned_to_user_id?: string | null;
  last_activity_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_role: string | null;
  unread_for_patient: number;
  unread_for_clinic: number;
  message_count: number;
};

const STATE_FILTERS: (string | null)[] = [
  null, 'awaiting_clinic', 'awaiting_patient', 'escalated_to_doctor', 'resolved',
];

export default function ConversationsList() {
  const router = useRouter();
  const { user } = useAuth();
  const isStaff = user?.role !== 'patient';
  const [items, setItems] = useState<Conv[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const load = useCallback(async (reset = true) => {
    if (reset) setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (stateFilter) params.state = stateFilter;
      if (search.trim()) params.search = search.trim();
      if (!reset && cursor) params.cursor = cursor;
      const r = await api.get('/v2/communications/conversations', { params });
      const rows: Conv[] = r?.data?.items || [];
      setItems((prev) => (reset ? rows : [...prev, ...rows]));
      setCursor(r?.data?.next_cursor || null);
    } finally {
      if (reset) setLoading(false);
    }
  }, [stateFilter, search, cursor]);

  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [stateFilter]);
  useFocusEffect(useCallback(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []));

  // Patient with no conversation yet: ensure one exists.
  useEffect(() => {
    if (isStaff) return;
    if (!loading && items.length === 0) {
      api.post('/v2/communications/conversations/get-or-create', {}).then(() => load(true)).catch(() => {});
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [loading, isStaff]);

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>{isStaff ? 'Clinic messages' : 'ConsultUro Clinic'}</Text>
        {isStaff ? (
          <Pressable onPress={() => setShowSearch((v) => !v)} style={shared.headerBtn} hitSlop={12}>
            <Ionicons name="search" size={20} color={V2.fg} />
          </Pressable>
        ) : null}
      </View>

      {showSearch && isStaff ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: V2.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.border }}>
          <TextInput
            placeholder="Search last message…"
            placeholderTextColor={V2.fgHint}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => load(true)}
            returnKeyType="search"
            style={styles.search}
          />
        </View>
      ) : null}

      {isStaff ? (
        <View style={styles.stateRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
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
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      ) : items.length === 0 ? (
        <View style={shared.empty}>
          <Text style={shared.emptyTitle}>{isStaff ? 'No conversations' : 'Message the clinic'}</Text>
          <Text style={shared.emptyBody}>
            {isStaff ? 'When a patient writes in, their conversation appears here.'
              : 'Tap to start a conversation with the ConsultUro Clinic.'}
          </Text>
          {!isStaff ? (
            <Pressable
              style={styles.emptyBtn}
              onPress={async () => {
                const r = await api.post('/v2/communications/conversations/get-or-create', {});
                const conv = r?.data?.conversation;
                if (conv?.id) router.push(`/comm-v2/conversations/${conv.id}` as any);
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Start conversation</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/comm-v2/conversations/${item.id}` as any)}
              style={[styles.rowCard, item.unread_for_clinic > 0 && isStaff && styles.rowUnread]}
            >
              <View style={styles.avatar}>
                <Ionicons name="person-circle" size={40} color={V2.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={[styles.name, (item.unread_for_clinic > 0 && isStaff) && { fontWeight: '700' }]} numberOfLines={1}>
                    {isStaff ? (item.patient_display_name || 'Patient') : 'ConsultUro Clinic'}
                  </Text>
                  <Text style={styles.time}>{relTime(item.last_activity_at)}</Text>
                </View>
                <View style={[styles.rowTop, { marginTop: 2 }]}>
                  <Text style={styles.preview} numberOfLines={1}>
                    {(item.last_sender_role && item.last_sender_role !== 'patient') ? '→ ' : ''}
                    {item.last_message_preview || '—'}
                  </Text>
                  {isStaff ? (
                    <View style={[shared.chip, { backgroundColor: (stateTint[item.state] || {}).bg }]}>
                      <Text style={[shared.chipTxt, { color: (stateTint[item.state] || {}).fg }]}>
                        {stateLabel[item.state] || item.state}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {((isStaff && item.unread_for_clinic > 0) || (!isStaff && item.unread_for_patient > 0)) ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeTxt}>
                    {isStaff ? item.unread_for_clinic : item.unread_for_patient}
                  </Text>
                </View>
              ) : null}
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

const styles = StyleSheet.create({
  search: {
    backgroundColor: V2.divider, borderRadius: 8, paddingHorizontal: 12,
    paddingVertical: 8, color: V2.fg, fontSize: 14,
  },
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
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: V2.card,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.divider,
  },
  rowUnread: { backgroundColor: '#F2FAFB' },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 14, color: V2.fg, flex: 1 },
  time: { fontSize: 11, color: V2.fgHint, marginLeft: 6 },
  preview: { fontSize: 12, color: V2.fgMuted, flex: 1, marginRight: 8 },
  unreadBadge: {
    minWidth: 20, height: 20, paddingHorizontal: 6,
    backgroundColor: V2.accent, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  unreadBadgeTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyBtn: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: V2.accent, borderRadius: 10,
  },
});
