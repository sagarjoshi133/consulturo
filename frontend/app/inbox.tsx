// ConsultUro · Personal Messaging Inbox
//
// This screen is dedicated EXCLUSIVELY to personal in-app messages
// between authenticated users:
//   • Team ↔ Team   (intra-clinic communication)
//   • Team → Patient (any team member can message any patient)
//   • Patient → Team (only patients explicitly authorised by the
//                     owner — `can_send_personal_messages` flag)
//
// Broadcasts, push deliveries, booking updates and other system
// notifications now live on /notifications instead. This file only
// renders kind=personal items.
//
// Tabs:
//   • Inbox  (received personal messages)        — everyone
//   • Sent   (sent personal messages)            — only senders
//
// Optional secondary filter (staff only) inside each tab:
//   All / Team / Patients
//
// The Compose FAB is gated on can_send_personal_messages | owner.
// Non-authorised patients see an info banner explaining the policy.
//
// Endpoints used:
//   GET  /api/inbox/all   → received feed (filtered to source_type==personal)
//   GET  /api/messages/sent → sent feed
//   POST /api/inbox/all/read → mark received messages as read on view

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import api from '../src/api';
import { goBackSafe } from '../src/nav';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { displayDateLong } from '../src/date';
import MessageComposer from '../src/message-composer';

type InboxItem = {
  id: string;
  title: string;
  body: string;
  kind?: string;
  source_type: string;
  read: boolean;
  // Receipts (only meaningful on items in the Sent tab)
  delivered?: boolean;
  delivered_at?: string | null;
  recipient_read?: boolean;
  recipient_read_at?: string | null;
  created_at: string;
  image_url?: string | null;
  link?: string | null;
  data?: Record<string, any>;
  recipient_user_id?: string | null;
};

const STAFF_ROLES = new Set(['owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing']);

type MainTab = 'inbox' | 'sent';
type CounterpartyFilter = 'all' | 'team' | 'patients';

function formatDT(iso?: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, '0');
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    const ampm = hh < 12 ? 'AM' : 'PM';
    const dateStr = displayDateLong(d.toISOString().slice(0, 10));
    return `${dateStr} · ${h12}:${mm} ${ampm}`;
  } catch {
    return '';
  }
}

function counterpartyOf(item: InboxItem, tab: MainTab): {
  name: string;
  role: string;
  picture?: string | null;
  isStaff: boolean;
} {
  const data: any = item.data || {};
  if (tab === 'sent') {
    return {
      name: data.recipient_name || data.recipient_email || '—',
      role: (data.recipient_role || '').toLowerCase(),
      picture: data.recipient_picture,
      isStaff: STAFF_ROLES.has((data.recipient_role || '').toLowerCase()),
    };
  }
  return {
    name: data.sender_name || '—',
    role: (data.sender_role || '').toLowerCase(),
    picture: data.sender_picture,
    isStaff: STAFF_ROLES.has((data.sender_role || '').toLowerCase()),
  };
}

/** WhatsApp-style receipt ticks for messages in the Sent tab.
 * - ✓ (gray)         → sent (created_at)
 * - ✓✓ (gray)        → delivered (recipient device fetched the inbox)
 * - ✓✓ (primary)     → read (recipient opened the detail view)
 */
function ReceiptTicks({ item, size = 13 }: { item: InboxItem; size?: number }) {
  const read = !!item.recipient_read;
  const delivered = !!item.delivered;
  // Color: blue when read, gray otherwise
  const color = read ? COLORS.primary : COLORS.textSecondary;
  // Two stacked checks for delivered/read; one for sent only.
  if (delivered || read) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="checkmark-done" size={size} color={color} />
      </View>
    );
  }
  return <Ionicons name="checkmark" size={size} color={COLORS.textSecondary} />;
}

export default function Inbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ tab?: string; filter?: string }>();

  const isStaff = !!user && STAFF_ROLES.has((user.role as string) || '');
  const isOwner = user?.role === 'owner';
  const canSendMsg = !!(user && ((user as any).can_send_personal_messages || isOwner));

  // ── Tab state ──
  const initialTab: MainTab = params.tab === 'sent' && canSendMsg ? 'sent' : 'inbox';
  const [tab, setTab] = useState<MainTab>(initialTab);
  // Secondary filter — only meaningful for staff. For patients we always
  // show ALL items because their counterparty is the clinic team.
  const [cpFilter, setCpFilter] = useState<CounterpartyFilter>('all');

  // ── Data state ──
  const [received, setReceived] = useState<InboxItem[]>([]);
  const [sent, setSent] = useState<InboxItem[]>([]);
  const [firstLoad, setFirstLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sentLoading, setSentLoading] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  // ── Loaders ──
  const loadReceived = useCallback(async () => {
    try {
      const { data } = await api.get('/inbox/all');
      const items: InboxItem[] = Array.isArray(data?.items) ? data.items : [];
      setReceived(items.filter((i) => i.source_type === 'personal'));
    } catch {
      setReceived((cur) => cur);
    } finally {
      setFirstLoad(false);
      setRefreshing(false);
    }
  }, []);

  const loadSent = useCallback(async () => {
    if (!canSendMsg) return;
    setSentLoading(true);
    try {
      const { data } = await api.get('/messages/sent');
      setSent(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSent([]);
    } finally {
      setSentLoading(false);
    }
  }, [canSendMsg]);

  useFocusEffect(useCallback(() => { loadReceived(); }, [loadReceived]));

  useEffect(() => {
    if (tab === 'sent') loadSent();
  }, [tab, loadSent]);

  // Mark received personal messages as read once seen.
  useEffect(() => {
    if (firstLoad) return;
    if (received.some((i) => !i.read)) {
      api.post('/inbox/all/read').catch(() => {});
    }
  }, [firstLoad, received]);

  // ── Filters / counts ──
  const visible = useMemo(() => {
    const list = tab === 'sent' ? sent : received;
    if (!isStaff || cpFilter === 'all') return list;
    return list.filter((i) => {
      const cp = counterpartyOf(i, tab);
      return cpFilter === 'team' ? cp.isStaff : !cp.isStaff;
    });
  }, [tab, cpFilter, sent, received, isStaff]);

  const counts = useMemo(() => {
    const list = tab === 'sent' ? sent : received;
    let team = 0, pat = 0;
    list.forEach((i) => {
      const cp = counterpartyOf(i, tab);
      if (cp.isStaff) team += 1; else pat += 1;
    });
    return { all: list.length, team, patients: pat };
  }, [tab, sent, received]);

  const inboxUnread = useMemo(() => received.filter((i) => !i.read).length, [received]);

  // ── Open detail ──
  const openItem = (n: InboxItem) => {
    router.push({ pathname: '/messages/[id]', params: { id: n.id } } as any);
  };

  // ── Empty / non-signed-in ──
  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <Header onBack={() => goBackSafe(router)} insetsTop={insets.top} />
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>Please sign in to see your messages.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Header
        onBack={() => goBackSafe(router)}
        insetsTop={insets.top}
        unread={inboxUnread}
      />

      {/* Patient policy banner — non-authorised patients can only
          receive. We surface this once near the top so they understand
          why there's no Compose button. */}
      {!isStaff && !canSendMsg && (
        <View style={styles.policyBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.primary} />
          <Text style={styles.policyText}>
            You can <Text style={{ fontWeight: '700' }}>receive</Text> personal messages from the clinic team.
            Replying is enabled only after the clinic enables messaging on your account.
          </Text>
        </View>
      )}

      {/* Main tabs — Inbox / Sent. "Sent" only shown to senders. */}
      <View style={styles.mainTabsRow}>
        <TouchableOpacity
          style={[styles.mainTab, tab === 'inbox' && styles.mainTabActive]}
          onPress={() => setTab('inbox')}
          activeOpacity={0.78}
          testID="inbox-tab-inbox"
        >
          <Ionicons
            name="chatbubbles"
            size={15}
            color={tab === 'inbox' ? '#fff' : COLORS.primary}
          />
          <Text style={[styles.mainTabText, tab === 'inbox' && { color: '#fff' }]}>
            Inbox{received.length ? ` · ${received.length}` : ''}
          </Text>
          {inboxUnread > 0 && tab !== 'inbox' && (
            <View style={styles.unreadDot}>
              <Text style={styles.unreadDotText}>{inboxUnread > 9 ? '9+' : inboxUnread}</Text>
            </View>
          )}
        </TouchableOpacity>
        {canSendMsg && (
          <TouchableOpacity
            style={[styles.mainTab, tab === 'sent' && styles.mainTabActive]}
            onPress={() => setTab('sent')}
            activeOpacity={0.78}
            testID="inbox-tab-sent"
          >
            <Ionicons
              name="paper-plane"
              size={14}
              color={tab === 'sent' ? '#fff' : COLORS.primary}
            />
            <Text style={[styles.mainTabText, tab === 'sent' && { color: '#fff' }]}>
              Sent{sent.length ? ` · ${sent.length}` : ''}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Secondary chips — visible only for staff. Lets owner / team
          filter their inbox/sent view by counterparty (Team vs Patients).
          Patients see only their own thread with the team so this
          row would be redundant. */}
      {isStaff && (
        <View style={styles.subFilterRow}>
          {(['all', 'team', 'patients'] as CounterpartyFilter[]).map((k) => {
            const active = cpFilter === k;
            const cnt = k === 'all' ? counts.all : k === 'team' ? counts.team : counts.patients;
            return (
              <TouchableOpacity
                key={k}
                onPress={() => setCpFilter(k)}
                style={[styles.subChip, active && styles.subChipActive]}
                activeOpacity={0.78}
                testID={`inbox-cp-${k}`}
              >
                <Ionicons
                  name={k === 'all' ? 'grid' : k === 'team' ? 'people' : 'medical'}
                  size={11}
                  color={active ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.subChipText, active && { color: '#fff' }]}>
                  {k === 'all' ? 'All' : k === 'team' ? 'Team' : 'Patients'}
                  {cnt ? ` · ${cnt}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Body */}
      {firstLoad || (tab === 'sent' && sentLoading && sent.length === 0) ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                if (tab === 'sent') loadSent().finally(() => setRefreshing(false));
                else loadReceived();
              }}
              tintColor={COLORS.primary}
            />
          }
        >
          {visible.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons
                name={tab === 'sent' ? 'send-outline' : 'chat-outline'}
                size={56}
                color={COLORS.textDisabled}
              />
              <Text style={styles.emptyText}>
                {tab === 'sent'
                  ? 'No sent messages yet'
                  : isStaff && cpFilter !== 'all'
                    ? `No messages from ${cpFilter}`
                    : 'No personal messages yet'}
              </Text>
              <Text style={styles.emptySub}>
                {tab === 'sent'
                  ? 'Messages you send will appear here so you can review the conversation history.'
                  : isStaff
                    ? 'Personal messages from team members or patients will land here.'
                    : 'When the clinic team writes to you, the message will land here.'}
              </Text>
            </View>
          ) : (
            visible.map((n) => {
              const cp = counterpartyOf(n, tab);
              const cpColor = cp.isStaff ? COLORS.primary : COLORS.success;
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[styles.card, !n.read && tab === 'inbox' && styles.unreadCard]}
                  activeOpacity={0.78}
                  onPress={() => openItem(n)}
                  testID={`inbox-${n.id}`}
                >
                  <View style={styles.cardRow}>
                    {/* Avatar / chip */}
                    {cp.picture ? (
                      <Image source={{ uri: cp.picture }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, { backgroundColor: cpColor + '22', alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={[styles.avatarLetter, { color: cpColor }]}>
                          {(cp.name || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.metaRow}>
                        {!n.read && tab === 'inbox' && <View style={styles.dot} />}
                        <Text style={styles.cpName} numberOfLines={1}>
                          {tab === 'sent' ? 'To · ' : 'From · '}
                          {cp.name}
                        </Text>
                        {!!cp.role && (
                          <View style={[styles.roleChip, { backgroundColor: cpColor + '14' }]}>
                            <Text style={[styles.roleChipText, { color: cpColor }]}>
                              {cp.role.toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.title} numberOfLines={2}>{n.title}</Text>
                      {!!n.body && <Text style={styles.body} numberOfLines={2}>{n.body}</Text>}
                      {/* Attachment hint */}
                      {Array.isArray((n.data as any)?.attachments) && (n.data as any).attachments.length > 0 && (
                        <View style={styles.attachHint}>
                          <Ionicons name="attach" size={12} color={COLORS.textSecondary} />
                          <Text style={styles.attachHintText}>
                            {(n.data as any).attachments.length} attachment
                            {(n.data as any).attachments.length === 1 ? '' : 's'}
                          </Text>
                        </View>
                      )}
                      <View style={styles.bottomRow}>
                        <Text style={styles.when}>{formatDT(n.created_at)}</Text>
                        {tab === 'sent' && (
                          <View style={styles.receiptWrap}>
                            <ReceiptTicks item={n} />
                            <Text style={[styles.receiptLabel, n.recipient_read && { color: COLORS.primary }]}>
                              {n.recipient_read ? 'Read' : n.delivered ? 'Delivered' : 'Sent'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Trailing icon */}
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={COLORS.textDisabled}
                    />
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Compose FAB — only for permitted users (owner + grantees). */}
      {canSendMsg && (
        <TouchableOpacity
          onPress={() => setShowComposer(true)}
          style={[styles.fab, { bottom: 24 + insets.bottom }]}
          activeOpacity={0.85}
          testID="inbox-fab-compose"
        >
          <Ionicons name="create" size={20} color="#fff" />
          <Text style={styles.fabText}>New message</Text>
        </TouchableOpacity>
      )}

      <MessageComposer
        visible={showComposer}
        onClose={() => setShowComposer(false)}
        onSent={() => {
          loadReceived();
          loadSent();
          setTab('sent');
        }}
      />
    </View>
  );
}

function Header({
  onBack, insetsTop, unread,
}: { onBack: () => void; insetsTop: number; unread?: number }) {
  return (
    <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insetsTop + 6 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} testID="inbox-back">
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 6 }}>
          <Text style={styles.headerTitle}>Inbox</Text>
          <Text style={styles.headerSub}>
            Personal messages
            {unread != null && unread > 0 ? ` · ${unread} unread` : ''}
          </Text>
        </View>
        <Ionicons name="chatbubbles" size={22} color="#fff" />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: 14, paddingHorizontal: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h3, color: '#fff', fontSize: 18 },
  headerSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },

  // Patient policy banner
  policyBanner: {
    marginHorizontal: 14, marginTop: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1, borderColor: COLORS.primary + '33',
    borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  policyText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1, lineHeight: 17 },

  // Main tabs (Inbox / Sent) — full-width pill row.
  mainTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 14, paddingTop: 12, gap: 8,
  },
  mainTab: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '44',
  },
  mainTabActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  mainTabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  unreadDot: {
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadDotText: { color: '#fff', fontSize: 10, fontFamily: 'Manrope_700Bold' },

  // Secondary filter (staff only)
  subFilterRow: {
    flexDirection: 'row',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4,
    gap: 6,
  },
  subChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  subChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  subChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 11 },

  empty: { alignItems: 'center', padding: 40 },
  emptyText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 6, fontSize: 12, lineHeight: 18 },

  // Card
  card: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10,
  },
  unreadCard: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary + '22',
  },
  avatarLetter: { ...FONTS.bodyMedium, fontSize: 16 },

  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  cpName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12, flexShrink: 1 },
  roleChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  roleChipText: { ...FONTS.label, fontSize: 9, letterSpacing: 0.4 },
  title: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14.5, marginTop: 2 },
  body: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  when: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  bottomRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  receiptWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: COLORS.bg,
  },
  receiptLabel: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 10 },

  attachHint: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6,
  },
  attachHintText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  // Compose FAB
  fab: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 28,
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 6 },
    }),
  },
  fabText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 13 },
});

void SafeAreaView; void Platform;
