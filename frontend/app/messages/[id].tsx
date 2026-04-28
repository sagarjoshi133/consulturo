// Message / Notification detail screen.
//
// Reachable from the unified inbox by tapping any notification row
// (personal message, broadcast, system update, etc.). Loads the full
// row from `GET /api/notifications/{id}` and renders title, body,
// optional image, optional link and sender attribution (for personal
// messages). Fetching the row implicitly marks it as read.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { goBackSafe } from '../../src/nav';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { displayDateLong } from '../../src/date';
import MessageComposer from '../../src/message-composer';
import {
  openAttachment,
  saveAttachment,
  shareAttachment,
} from '../../src/attachments';

type NotificationDetail = {
  id: string;
  title: string;
  body: string;
  kind?: string;
  source?: string;
  read?: boolean;
  // Receipts (always present on personal messages)
  delivered?: boolean;
  delivered_at?: string | null;
  recipient_read?: boolean;
  recipient_read_at?: string | null;
  is_sender_view?: boolean;
  created_at?: string;
  data?: {
    image_url?: string | null;
    link?: string | null;
    sender_user_id?: string;
    sender_name?: string;
    sender_role?: string;
    sender?: {
      user_id?: string;
      name?: string;
      email?: string;
      role?: string;
      picture?: string;
    };
    recipient?: {
      user_id?: string;
      name?: string;
      email?: string;
      role?: string;
      picture?: string;
      phone?: string;
    };
    booking_id?: string;
    [k: string]: any;
  };
};

const KIND_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }> = {
  personal:  { icon: 'chatbubble',         label: 'Personal message', color: '#10B981' },
  broadcast: { icon: 'megaphone',          label: 'Broadcast',        color: '#7C3AED' },
  booking:   { icon: 'calendar',           label: 'Booking update',   color: '#0E7C8B' },
  rx:        { icon: 'document-text',      label: 'Prescription',     color: '#0E7C8B' },
  push:      { icon: 'notifications',      label: 'Push notification', color: '#F59E0B' },
  role_change: { icon: 'shield-checkmark', label: 'Role update',      color: '#0EA5E9' },
  system:    { icon: 'information-circle', label: 'System',           color: '#5E7C81' },
  info:      { icon: 'information-circle', label: 'Update',           color: '#5E7C81' },
};

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

export default function MessageDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [item, setItem] = useState<NotificationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const isStaff = !!user && ['owner', 'primary_owner', 'super_owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'].includes((user.role as string) || '');
  const isOwnerTier = !!user && ['owner', 'primary_owner', 'super_owner', 'partner'].includes((user.role as string) || '');
  const canSendMsg = !!user && (!!(user as any).can_send_personal_messages || isOwnerTier);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) return;
      try {
        const { data } = await api.get(`/notifications/${id}`);
        if (!cancelled) setItem(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.response?.data?.detail || 'Could not load message.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  const meta = KIND_META[item?.kind || 'info'] || KIND_META.info;
  const data = item?.data || {};
  const sender = data.sender;
  const recipient = data.recipient;
  const senderName = sender?.name || data.sender_name;
  const senderRole = sender?.role || data.sender_role;
  const isSenderView = !!item?.is_sender_view;
  const recipientName = recipient?.name || (data as any).recipient_name;
  const recipientRole = recipient?.role || (data as any).recipient_role;

  const openLink = async () => {
    if (!data.link) return;
    try {
      const supported = await Linking.canOpenURL(data.link);
      if (supported) Linking.openURL(data.link);
      else Alert.alert('Cannot open link', data.link);
    } catch {
      Alert.alert('Cannot open link', data.link || '');
    }
  };

  const openBooking = () => {
    if (!data.booking_id) return;
    if (isStaff) router.push({ pathname: '/bookings/[id]', params: { id: data.booking_id } } as any);
    else router.push('/my-bookings' as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['bottom']}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => goBackSafe(router, '/inbox')} style={styles.backBtn} testID="msg-detail-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={styles.headerKicker}>{meta.label}</Text>
            <Text style={styles.headerTitle} numberOfLines={2}>{item?.title || (loading ? 'Loading…' : 'Message')}</Text>
          </View>
          <View style={styles.kindIcon}>
            <Ionicons name={meta.icon} size={20} color="#fff" />
          </View>
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : err ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle" size={48} color={COLORS.accent} />
          <Text style={styles.emptyText}>{err}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => goBackSafe(router, '/inbox')}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 + insets.bottom }}>
          {/* Counterparty card — personal messages only.
              When the viewer is the SENDER, show the recipient (TO).
              When the viewer is the RECIPIENT, show the sender (FROM). */}
          {item?.kind === 'personal' && (isSenderView ? (recipientName || recipient?.email) : (senderName || sender?.email)) ? (
            <View style={styles.senderCard}>
              {isSenderView ? (
                recipient?.picture ? (
                  <Image source={{ uri: recipient.picture }} style={styles.senderAvatar} />
                ) : (
                  <View style={[styles.senderAvatar, { backgroundColor: meta.color + '24', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ color: meta.color, fontFamily: 'Manrope_800ExtraBold', fontSize: 18 }}>
                      {(recipientName || 'U').trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )
              ) : sender?.picture ? (
                <Image source={{ uri: sender.picture }} style={styles.senderAvatar} />
              ) : (
                <View style={[styles.senderAvatar, { backgroundColor: meta.color + '24', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: meta.color, fontFamily: 'Manrope_800ExtraBold', fontSize: 18 }}>
                    {(senderName || 'U').trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.senderLabel}>{isSenderView ? 'TO' : 'FROM'}</Text>
                <Text style={styles.senderName} numberOfLines={1}>
                  {isSenderView
                    ? (recipientName || recipient?.email)
                    : (senderName || sender?.email)}
                </Text>
                {!!(isSenderView ? recipientRole : senderRole) && (
                  <Text style={styles.senderRole} numberOfLines={1}>
                    {String(isSenderView ? recipientRole : senderRole).toUpperCase()}
                  </Text>
                )}
              </View>
            </View>
          ) : null}

          {/* Meta line: time + receipt status. For SENT messages, show
              ✓ / ✓✓ / ✓✓ blue with a label (Sent / Delivered / Read).
              For RECEIVED messages, just confirm "Read" once we've
              opened the detail view (the GET marks it read). */}
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color={COLORS.textSecondary} />
            <Text style={styles.metaText}>{formatDT(item?.created_at)}</Text>
            {item?.kind === 'personal' && isSenderView ? (
              <View style={styles.receiptBadge}>
                <Ionicons
                  name={item.recipient_read || item.delivered ? 'checkmark-done' : 'checkmark'}
                  size={12}
                  color={item.recipient_read ? COLORS.primary : COLORS.textSecondary}
                />
                <Text style={[
                  styles.receiptBadgeText,
                  item.recipient_read && { color: COLORS.primary },
                ]}>
                  {item.recipient_read
                    ? `Read · ${formatDT(item.recipient_read_at || undefined)}`
                    : item.delivered
                      ? `Delivered · ${formatDT(item.delivered_at || undefined)}`
                      : 'Sent'}
                </Text>
              </View>
            ) : (
              <View style={styles.readDot}><Ionicons name="checkmark-done" size={11} color={COLORS.success} /></View>
            )}
            {!isSenderView && (
              <Text style={[styles.metaText, { color: COLORS.success }]}>Read</Text>
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>{item?.title}</Text>

          {/* Body — selectable so users can copy */}
          {!!item?.body && (
            <Text style={styles.body} selectable>
              {item.body}
            </Text>
          )}

          {/* Optional image */}
          {data.image_url ? (
            <Image source={{ uri: data.image_url }} style={styles.image} resizeMode="cover" />
          ) : null}

          {/* Personal-message attachments — images render as previews
              with a tap-to-open. Videos and files render as a row
              with a download/open action. */}
          {Array.isArray(data.attachments) && data.attachments.length > 0 ? (
            <View style={styles.attachList}>
              <Text style={styles.attachListLabel}>ATTACHMENTS · {data.attachments.length}</Text>
              {data.attachments.map((a: any, i: number) => (
                <AttachmentRow key={i} att={a} />
              ))}
            </View>
          ) : null}

          {/* Optional link / booking shortcut */}
          {data.link ? (
            <TouchableOpacity style={styles.actionRow} onPress={openLink} activeOpacity={0.78}>
              <Ionicons name="link" size={18} color={COLORS.primary} />
              <Text style={styles.actionText} numberOfLines={1}>{data.link}</Text>
              <Ionicons name="open-outline" size={16} color={COLORS.primary} />
            </TouchableOpacity>
          ) : null}

          {data.booking_id ? (
            <TouchableOpacity style={[styles.actionRow, { borderColor: COLORS.success + '55', backgroundColor: COLORS.success + '12' }]} onPress={openBooking} activeOpacity={0.78}>
              <Ionicons name="calendar" size={18} color={COLORS.success} />
              <Text style={[styles.actionText, { color: COLORS.success }]}>{isStaff ? 'Open booking entry' : 'View my bookings'}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.success} />
            </TouchableOpacity>
          ) : null}

          {/* Reply — visible only on personal messages WHEN the user is
              authorised to send messages. Patients see this only after
              the owner has granted them messaging permission. */}
          {item?.kind === 'personal' && sender && canSendMsg && sender.user_id !== user?.user_id ? (
            <TouchableOpacity
              style={styles.replyBtn}
              onPress={() => setComposerOpen(true)}
              activeOpacity={0.85}
              testID="msg-detail-reply"
            >
              <Ionicons name="arrow-undo" size={16} color="#fff" />
              <Text style={styles.replyBtnText}>Reply to {(senderName || 'sender').split(' ')[0]}</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}

      {/* Reply composer */}
      {item?.kind === 'personal' && sender && canSendMsg ? (
        <MessageComposer
          visible={composerOpen}
          onClose={() => setComposerOpen(false)}
          initialRecipient={{
            user_id: sender.user_id || '',
            name: sender.name,
            email: sender.email,
            role: sender.role,
            picture: sender.picture,
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Attachment renderer — images preview inline (tap to open full-size
// in the system photo viewer), videos & files show as a row with
// kind icon + name + size and an "Open" action.
// ──────────────────────────────────────────────────────────────────────
function AttachmentRow({ att }: { att: any }) {
  const { kind = 'file', name = 'file', size_bytes = 0, mime = '', data_url } = att || {};
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'open' | 'save' | 'share'>(null);

  const sizeFmt = (() => {
    const n = Number(size_bytes) || 0;
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  })();

  const run = async (
    label: 'open' | 'save' | 'share',
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) => {
    if (!data_url) {
      toast.error('Attachment has no data');
      return;
    }
    setBusy(label);
    try {
      const r = await fn();
      if (!r.ok) toast.error(r.error || `Could not ${label}`);
      else if (label === 'save' && Platform.OS === 'web') toast.success('Downloaded');
    } finally {
      setBusy(null);
    }
  };

  const onOpen = () => run('open', () => openAttachment(att));
  const onSave = () => run('save', () => saveAttachment(att));
  const onShare = () => run('share', () => shareAttachment(att));

  if (kind === 'image' && data_url) {
    return (
      <View style={styles.attachImageWrap}>
        <TouchableOpacity onPress={onOpen} activeOpacity={0.85} style={styles.attachImageBtn}>
          <Image source={{ uri: data_url }} style={styles.attachImage} resizeMode="cover" />
          <View style={styles.attachImageMeta}>
            <Text style={styles.attachImageMetaName} numberOfLines={1}>{name}</Text>
            {!!sizeFmt && <Text style={styles.attachImageMetaSize}>{sizeFmt}</Text>}
          </View>
        </TouchableOpacity>
        <View style={styles.attachActions}>
          <AttachActionBtn icon="download-outline" label={Platform.OS === 'web' ? 'Save' : 'Download'} onPress={onSave} busy={busy === 'save'} />
          <AttachActionBtn icon="share-outline" label="Share" onPress={onShare} busy={busy === 'share'} />
          <AttachActionBtn icon="open-outline" label="Open" onPress={onOpen} busy={busy === 'open'} primary />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.attachFileWrap}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.78} style={styles.attachFileRow}>
        <View style={[styles.attachFileIcon, { backgroundColor: kind === 'video' ? '#7C3AED14' : COLORS.primary + '14' }]}>
          <Ionicons name={kind === 'video' ? 'videocam' : kind === 'audio' ? 'musical-notes' : 'document'} size={18} color={kind === 'video' ? '#7C3AED' : COLORS.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.attachFileName} numberOfLines={1}>{name}</Text>
          <Text style={styles.attachFileSub}>{mime || kind}{sizeFmt ? ` · ${sizeFmt}` : ''}</Text>
        </View>
        {busy === 'open' ? (
          <ActivityIndicator size="small" color={COLORS.primary} />
        ) : (
          <Ionicons name="open-outline" size={16} color={COLORS.primary} />
        )}
      </TouchableOpacity>
      <View style={styles.attachActions}>
        <AttachActionBtn icon="download-outline" label={Platform.OS === 'web' ? 'Save' : 'Download'} onPress={onSave} busy={busy === 'save'} />
        <AttachActionBtn icon="share-outline" label="Share" onPress={onShare} busy={busy === 'share'} />
        <AttachActionBtn icon="open-outline" label="Open" onPress={onOpen} busy={busy === 'open'} primary />
      </View>
    </View>
  );
}

function AttachActionBtn({
  icon, label, onPress, busy, primary,
}: { icon: any; label: string; onPress: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.attachActionBtn,
        primary && { backgroundColor: COLORS.primary + '14', borderColor: COLORS.primary },
      ]}
      activeOpacity={0.78}
      disabled={busy}
      testID={`att-${label.toLowerCase()}`}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? COLORS.primary : COLORS.textSecondary} />
      ) : (
        <Ionicons
          name={icon}
          size={14}
          color={primary ? COLORS.primary : COLORS.textSecondary}
        />
      )}
      <Text style={[
        styles.attachActionLabel,
        primary && { color: COLORS.primary },
      ]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hero: { paddingBottom: 14, paddingHorizontal: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4, gap: 6 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerKicker: { ...FONTS.label, color: 'rgba(255,255,255,0.85)', fontSize: 10.5, letterSpacing: 0.6 },
  headerTitle: { ...FONTS.h3, color: '#fff', fontSize: 16, marginTop: 1 },
  kindIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },

  empty: { alignItems: 'center', padding: 40, gap: 12 },
  emptyText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, textAlign: 'center' },

  senderCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12,
    marginBottom: 14,
  },
  senderAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.bg },
  senderLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 9.5, letterSpacing: 0.7 },
  senderName: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15, marginTop: 1 },
  senderRole: { ...FONTS.label, color: '#10B981', fontSize: 10, marginTop: 1, letterSpacing: 0.5 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10, flexWrap: 'wrap' },

  receiptBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  receiptBadgeText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 11 },
  metaText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  readDot: { marginLeft: 6 },

  title: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 20, lineHeight: 28, marginBottom: 8 },
  body: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 15, lineHeight: 24 },

  image: {
    width: '100%',
    height: 220,
    borderRadius: RADIUS.lg,
    marginTop: 14,
    backgroundColor: COLORS.border,
  },

  // Personal message attachments
  attachList: { marginTop: 16, gap: 10 },
  attachListLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, letterSpacing: 0.6 },
  attachImageBtn: {
    backgroundColor: '#fff',
  },
  attachImage: { width: '100%', height: 220, backgroundColor: COLORS.bg },
  attachImageMeta: { padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachImageMetaName: { flex: 1, ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  attachImageMetaSize: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  attachFileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff',
    padding: 12,
  },
  attachFileIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  attachFileName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  attachFileSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },

  // Container that wraps each attachment + its action row so the
  // border + actions stay visually grouped.
  attachImageWrap: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  attachFileWrap: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.border,
  },
  // Action row sits below the preview/file row with a thin separator.
  attachActions: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 8, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: COLORS.border + '88',
    backgroundColor: COLORS.bg,
  },
  attachActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 4,
    paddingVertical: 8, paddingHorizontal: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  attachActionLabel: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 11.5 },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.primary + '0E',
    borderColor: COLORS.primary + '55',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 14,
  },
  actionText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13.5, flex: 1 },

  replyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 18,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingVertical: 13, paddingHorizontal: 18,
  },
  replyBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: RADIUS.pill,
    marginTop: 12,
  },
  primaryBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
});
