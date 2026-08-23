/**
 * Comm V2 — Conversation detail (thread view).
 *
 * - Reverse-chrono list (newest at bottom, chat convention).
 * - Idempotency-Key generated per compose+send.
 * - Reply-to bubble on tap-hold.
 * - Read-mark on scroll into view for the recipient side.
 * - Staff action bar (assign / escalate / resolve / reopen).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, Alert, FlatList} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { V2, relTime, shared, stateLabel, stateTint } from '../../../src/comm-v2/ui-tokens';
import { useCommunicationsV2 } from '../../../src/comm-v2/communications-provider';

type Msg = {
  id: string;
  sequence_number: number;
  sender_user_id: string;
  sender_role: string;
  sender_display: string;
  body: string;
  reply_to_message_id: string | null;
  delivery_state: string;
  created_at: string;
};

type Conv = {
  id: string;
  patient_user_id: string;
  patient_display_name?: string;
  state: string;
};

function newIdempotencyKey(): string {
  // Short random per compose.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ConversationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { refresh } = useCommunicationsV2();
  const isStaff = user?.role !== 'patient';
  const [conv, setConv] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const listRef = useRef<any>(null);
  const idempotencyRef = useRef<string>(newIdempotencyKey());

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await api.get(`/v2/communications/conversations/${encodeURIComponent(String(id))}/messages`,
        { params: { limit: 40 } });
      setMsgs(r?.data?.items || []);
      setConv(r?.data?.conversation || null);
      setCursor(r?.data?.next_cursor || null);
    } finally {
      setLoading(false);
      refresh();
    }
  }, [id, refresh]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor || !id) return;
    const r = await api.get(`/v2/communications/conversations/${encodeURIComponent(String(id))}/messages`,
      { params: { limit: 40, cursor } });
    const older: Msg[] = r?.data?.items || [];
    setMsgs((prev) => [...older, ...prev]);
    setCursor(r?.data?.next_cursor || null);
  }, [cursor, id]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending || !id) return;
    setSending(true);
    const key = idempotencyRef.current;
    try {
      const r = await api.post(
        `/v2/communications/conversations/${encodeURIComponent(String(id))}/messages`,
        {
          body,
          reply_to_message_id: replyTo?.id || null,
          idempotency_key: key,
        },
        { headers: { 'Idempotency-Key': key } },
      );
      const newMsg: Msg | undefined = r?.data?.message;
      if (newMsg) {
        setMsgs((cur) => [...cur, newMsg]);
        setDraft('');
        setReplyTo(null);
        idempotencyRef.current = newIdempotencyKey();
        setConv(r?.data?.conversation || conv);
        setTimeout(() => listRef.current?.scrollToEnd?.({ animated: true }), 100);
        refresh();
      }
    } catch (e: any) {
      Alert.alert('Message not sent', e?.response?.data?.detail || e?.message || 'unknown');
    } finally {
      setSending(false);
    }
  }, [draft, sending, id, replyTo, conv, refresh]);

  const markRead = useCallback(async (msg: Msg) => {
    if (msg.sender_user_id === user?.user_id) return;
    try {
      await api.post(`/v2/communications/messages/${encodeURIComponent(msg.id)}/read`);
      refresh();
    } catch {}
  }, [user, refresh]);

  const onViewable = useCallback(({ viewableItems }: any) => {
    for (const v of viewableItems) {
      if (v?.item?.id) markRead(v.item as Msg);
    }
  }, [markRead]);

  // Staff actions
  const doStaffAction = useCallback(async (kind: 'escalate' | 'resolve' | 'reopen') => {
    try {
      const r = await api.post(`/v2/communications/conversations/${encodeURIComponent(String(id))}/${kind}`);
      setConv(r?.data?.conversation || conv);
    } catch (e: any) {
      Alert.alert('Action failed', e?.response?.data?.detail || e?.message || 'unknown');
    }
  }, [id, conv]);

  const replyToMap = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={shared.headerTitle}>
            {isStaff ? (conv?.patient_display_name || 'Patient') : 'ConsultUro Clinic'}
          </Text>
          {conv?.state ? (
            <View style={[shared.chip, { alignSelf: 'flex-start', backgroundColor: (stateTint[conv.state] || {}).bg, marginTop: 2 }]}>
              <Text style={[shared.chipTxt, { color: (stateTint[conv.state] || {}).fg }]}>
                {stateLabel[conv.state] || conv.state}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* Staff action bar */}
      {isStaff && conv ? (
        <View style={styles.actionBar}>
          {conv.state !== 'escalated_to_doctor' ? (
            <Pressable style={styles.actionBtn} onPress={() => doStaffAction('escalate')}>
              <Ionicons name="alert-circle-outline" size={14} color={V2.danger} />
              <Text style={[styles.actionTxt, { color: V2.danger }]}>Escalate</Text>
            </Pressable>
          ) : null}
          {conv.state !== 'resolved' ? (
            <Pressable style={styles.actionBtn} onPress={() => doStaffAction('resolve')}>
              <Ionicons name="checkmark-done" size={14} color={V2.success} />
              <Text style={[styles.actionTxt, { color: V2.success }]}>Resolve</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.actionBtn} onPress={() => doStaffAction('reopen')}>
              <Ionicons name="refresh" size={14} color={V2.accent} />
              <Text style={[styles.actionTxt, { color: V2.accent }]}>Reopen</Text>
            </Pressable>
          )}
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(x) => x.id}
          renderItem={({ item }) => (
            <MessageBubble
              msg={item}
              isMine={item.sender_user_id === user?.user_id}
              replyParent={item.reply_to_message_id ? replyToMap.get(item.reply_to_message_id) : undefined}
              onSetReply={() => setReplyTo(item)}
            />
          )}
          
          contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 12 }}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.2}
        />
      )}

      {replyTo ? (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyLabel}>Replying to {replyTo.sender_display}</Text>
            <Text numberOfLines={1} style={styles.replyBody}>{replyTo.body}</Text>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={10}>
            <Ionicons name="close" size={18} color={V2.fgMuted} />
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type a message…"
            placeholderTextColor={V2.fgHint}
            multiline
            style={styles.composerInput}
          />
          <Pressable
            onPress={send}
            disabled={sending || !draft.trim()}
            style={[styles.sendBtn, { opacity: !draft.trim() || sending ? 0.4 : 1 }]}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ msg, isMine, replyParent, onSetReply }: {
  msg: Msg; isMine: boolean; replyParent?: Msg; onSetReply: () => void;
}) {
  const stateHint = ({
    saved: 'saving…',
    recipient_inbox_created: 'sent',
    push_queued: 'sent',
    provider_accepted: 'delivered',
    recipient_app_synced: 'delivered',
    read: 'read',
  } as any)[msg.delivery_state] || '';
  return (
    <Pressable onLongPress={onSetReply}>
      <View style={[styles.bubbleWrap, { alignItems: isMine ? 'flex-end' : 'flex-start' }]}>
        {!isMine ? <Text style={styles.sender}>{msg.sender_display}</Text> : null}
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {replyParent ? (
            <View style={styles.replyInBubble}>
              <Text style={styles.replyInBubbleName}>{replyParent.sender_display}</Text>
              <Text numberOfLines={2} style={styles.replyInBubbleBody}>{replyParent.body}</Text>
            </View>
          ) : null}
          <Text style={[styles.bubbleText, isMine && { color: '#fff' }]}>{msg.body}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
          <Text style={styles.metaTxt}>{relTime(msg.created_at)}</Text>
          {isMine && stateHint ? <Text style={styles.metaTxt}>· {stateHint}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionBar: {
    flexDirection: 'row', gap: 12, backgroundColor: V2.card,
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: V2.divider,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionTxt: { fontSize: 12, fontWeight: '700' },
  bubbleWrap: { marginVertical: 4, maxWidth: '85%', alignSelf: 'flex-start' },
  sender: { fontSize: 11, color: V2.fgMuted, marginBottom: 2, marginLeft: 6 },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: V2.card, borderWidth: StyleSheet.hairlineWidth, borderColor: V2.border },
  bubbleMine: { backgroundColor: V2.accent, alignSelf: 'flex-end' },
  bubbleText: { fontSize: 14, color: V2.fg, lineHeight: 19 },
  metaTxt: { fontSize: 10, color: V2.fgHint },
  replyInBubble: {
    borderLeftWidth: 3, borderLeftColor: V2.accentSoft,
    paddingLeft: 8, marginBottom: 6, opacity: 0.85,
  },
  replyInBubbleName: { fontSize: 11, fontWeight: '700', color: V2.accentSoft },
  replyInBubbleBody: { fontSize: 12, color: V2.card + 'CC' },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: V2.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: V2.border,
  },
  replyLabel: { fontSize: 11, color: V2.accent, fontWeight: '700', marginBottom: 2 },
  replyBody: { fontSize: 12, color: V2.fgMuted },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: V2.card,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: V2.border,
  },
  composerInput: {
    flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: V2.divider,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: V2.fg,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: V2.accent,
    justifyContent: 'center', alignItems: 'center',
  },
});
