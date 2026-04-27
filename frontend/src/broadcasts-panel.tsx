import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  Modal,
  Image,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import api from './api';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton, SecondaryButton } from './components';
import { EmptyState } from './empty-state';
import { displayDateLong, display12h } from './date';

type BroadcastStatus = 'pending_approval' | 'approved' | 'sent' | 'rejected';
type Broadcast = {
  broadcast_id: string;
  title: string;
  body: string;
  image_url?: string | null;
  link?: string | null;
  target: 'all' | 'patients' | 'staff';
  author_id: string;
  author_name?: string;
  status: BroadcastStatus;
  created_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  reject_reason?: string | null;
  sent_at?: string | null;
  sent_count?: number;
};

const FILTERS: { id: 'all' | BroadcastStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_approval', label: 'Pending' },
  { id: 'sent', label: 'Sent' },
  { id: 'rejected', label: 'Rejected' },
];

const TARGETS: { id: 'all' | 'patients' | 'staff'; label: string; icon: any }[] = [
  { id: 'all', label: 'Everyone', icon: 'people' },
  { id: 'patients', label: 'Patients', icon: 'medical' },
  { id: 'staff', label: 'Staff', icon: 'briefcase' },
];

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

export function BroadcastsPanel({ autoOpen = 0 }: { autoOpen?: number } = {}) {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [items, setItems] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | BroadcastStatus>('all');
  const [showCompose, setShowCompose] = useState(false);

  // Auto-open compose sheet when dashboard asks us to (e.g. via FAB "+ Broadcast").
  // autoOpen is a counter — every tap increments it so the effect re-fires.
  useEffect(() => {
    if (autoOpen > 0) setShowCompose(true);
  }, [autoOpen]);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [link, setLink] = useState('');
  const [target, setTarget] = useState<'all' | 'patients' | 'staff'>('all');
  const [composing, setComposing] = useState(false);
  const [err, setErr] = useState('');

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/broadcasts');
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((b) => b.status === filter);
  }, [items, filter]);

  const pendingCount = useMemo(() => items.filter((b) => b.status === 'pending_approval').length, [items]);

  const resetCompose = () => {
    setTitle('');
    setBody('');
    setImageUrl('');
    setLink('');
    setTarget('all');
    setErr('');
  };

  const submit = async () => {
    setErr('');
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setErr('Title and message are required.');
      return;
    }
    if (t.length > 240) {
      setErr('Title is too long (max 240 chars).');
      return;
    }
    if (b.length > 2000) {
      setErr('Message is too long (max 2000 chars).');
      return;
    }
    setComposing(true);
    try {
      await api.post('/broadcasts', {
        title: t,
        body: b,
        image_url: imageUrl.trim() || undefined,
        link: link.trim() || undefined,
        target,
      });
      setShowCompose(false);
      resetCompose();
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not submit broadcast.');
    } finally {
      setComposing(false);
    }
  };

  const approve = (bid: string) => {
    const doApprove = async () => {
      try {
        await api.patch(`/broadcasts/${bid}`, { action: 'approve' });
        load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not approve.';
        Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Approve this broadcast and send it to target audience?')) doApprove();
    } else {
      Alert.alert('Approve & Send', 'This will push to the target audience immediately.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: doApprove },
      ]);
    }
  };

  const openReject = (bid: string) => {
    setRejectingId(bid);
    setRejectReason('');
  };

  const submitReject = async () => {
    if (!rejectingId) return;
    try {
      await api.patch(`/broadcasts/${rejectingId}`, {
        action: 'reject',
        reject_reason: rejectReason.trim() || undefined,
      });
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not reject.';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    }
  };

  const remove = (bid: string) => {
    const doDelete = async () => {
      try {
        await api.delete(`/broadcasts/${bid}`);
        load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete.';
        Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this broadcast?')) doDelete();
    } else {
      Alert.alert('Delete', 'Delete this broadcast?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;

  return (
    <>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Push Broadcasts</Text>
          <Text style={styles.sub}>
            {isOwner ? 'Review & send announcements to all app users.' : 'Compose announcements — owner approves before sending.'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => load()}
          testID="bc-refresh"
          activeOpacity={0.75}
        >
          <Ionicons name="refresh" size={18} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.composeBtn}
          onPress={() => {
            resetCompose();
            setShowCompose(true);
          }}
          testID="bc-compose"
        >
          <Ionicons name="create" size={18} color="#fff" />
          <Text style={styles.composeBtnText}>Compose</Text>
        </TouchableOpacity>
      </View>

      {isOwner && pendingCount > 0 && (
        <View style={styles.banner}>
          <Ionicons name="alert-circle" size={18} color={COLORS.warning || '#E67E22'} />
          <Text style={styles.bannerText}>
            {pendingCount} broadcast{pendingCount === 1 ? '' : 's'} waiting for your approval
          </Text>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingVertical: 10 }}
      >
        {FILTERS.map((f) => {
          const n = f.id === 'all' ? items.length : items.filter((b) => b.status === f.id).length;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => setFilter(f.id)}
              style={[styles.chip, filter === f.id && styles.chipActive]}
              testID={`bc-filter-${f.id}`}
            >
              <Text style={[styles.chipText, filter === f.id && { color: '#fff' }]}>
                {f.label} ({n})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {filtered.length === 0 ? (
        <EmptyState
          icon={items.length === 0 ? 'megaphone-outline' : 'filter-outline'}
          title={items.length === 0 ? 'No broadcasts yet' : 'Nothing in this filter'}
          subtitle={
            items.length === 0
              ? 'Tap "Compose" to send your first announcement to patients, referrers or staff.'
              : 'Try a different filter to see more broadcasts.'
          }
          ctaLabel={items.length === 0 ? 'Compose' : undefined}
          onCta={items.length === 0 ? () => setShowCompose(true) : undefined}
          compact
          testID="bc-empty"
        />
      ) : (
        filtered.map((b) => (
          <View key={b.broadcast_id} style={styles.card}>
            <View style={styles.cardTop}>
              <StatusPill status={b.status} />
              <Text style={styles.cardMeta}>
                {TARGETS.find((t) => t.id === b.target)?.label || b.target}
              </Text>
            </View>
            <Text style={styles.title}>{b.title}</Text>
            <Text style={styles.body}>{b.body}</Text>
            {b.image_url ? (
              <Image source={{ uri: b.image_url }} style={styles.thumb} resizeMode="cover" />
            ) : null}
            {b.link ? (
              <View style={styles.linkRow}>
                <Ionicons name="link" size={12} color={COLORS.primary} />
                <Text style={styles.linkText} numberOfLines={1}>{b.link}</Text>
              </View>
            ) : null}

            <Text style={styles.footLine}>
              By {b.author_name || '—'} · {formatDT(b.created_at)}
            </Text>
            {b.status === 'sent' && (
              <Text style={styles.footLine}>
                ✅ Sent to {b.sent_count || 0} devices · {formatDT(b.sent_at)}
              </Text>
            )}
            {b.status === 'rejected' && b.reject_reason ? (
              <Text style={[styles.footLine, { color: COLORS.accent }]}>Reason: {b.reject_reason}</Text>
            ) : null}

            <View style={styles.actionRow}>
              {/* Owner can approve-and-send pending requests from staff AND send their own
                  auto-approved drafts. Staff without approver permission can still review
                  their own pending requests (delete etc.) but not approve them. */}
              {(isOwner || user?.can_approve_broadcasts) &&
                (b.status === 'pending_approval' || b.status === 'approved') && (
                  <>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.approveBtn]}
                      onPress={() => approve(b.broadcast_id)}
                      testID={`bc-approve-${b.broadcast_id}`}
                    >
                      <Ionicons
                        name={b.status === 'approved' ? 'paper-plane' : 'checkmark-circle'}
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.actionBtnText}>
                        {b.status === 'approved' ? 'Send now' : 'Approve & Send'}
                      </Text>
                    </TouchableOpacity>
                    {b.status === 'pending_approval' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => openReject(b.broadcast_id)}
                        testID={`bc-reject-${b.broadcast_id}`}
                      >
                        <Ionicons name="close-circle" size={16} color={COLORS.accent} />
                        <Text style={[styles.actionBtnText, { color: COLORS.accent }]}>Reject</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              {b.status !== 'sent' && (isOwner || b.author_id === user?.user_id) && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.deleteBtn]}
                  onPress={() => remove(b.broadcast_id)}
                  testID={`bc-delete-${b.broadcast_id}`}
                >
                  <Ionicons name="trash" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))
      )}

      {/* Compose modal */}
      <Modal visible={showCompose} animationType="slide" onRequestClose={() => setShowCompose(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: COLORS.bg }}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCompose(false)} testID="bc-close">
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Compose Broadcast</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Clinic closed on 15 Aug"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              maxLength={240}
              testID="bc-title"
            />
            <Text style={styles.counter}>{title.length}/240</Text>

            <Text style={styles.fieldLabel}>Message *</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Write a clear, concise message for patients or staff…"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, { height: 140, textAlignVertical: 'top' }]}
              multiline
              maxLength={2000}
              testID="bc-body"
            />
            <Text style={styles.counter}>{body.length}/2000</Text>

            <Text style={styles.fieldLabel}>Image URL (optional)</Text>
            <TextInput
              value={imageUrl}
              onChangeText={setImageUrl}
              placeholder="https://…jpg/png"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="url"
              testID="bc-image"
            />
            {!!imageUrl && (
              <Image source={{ uri: imageUrl }} style={styles.previewImg} resizeMode="cover" />
            )}

            <Text style={styles.fieldLabel}>Link (optional)</Text>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="https://www.drsagarjoshi.com/blog/…"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="url"
              testID="bc-link"
            />

            <Text style={styles.fieldLabel}>Send to</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              {TARGETS.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setTarget(t.id)}
                  style={[styles.targetChip, target === t.id && styles.targetChipActive]}
                  testID={`bc-target-${t.id}`}
                >
                  <Ionicons
                    name={t.icon}
                    size={14}
                    color={target === t.id ? '#fff' : COLORS.primary}
                  />
                  <Text style={[styles.targetChipText, target === t.id && { color: '#fff' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!isOwner && (
              <View style={styles.infoRow}>
                <Ionicons name="information-circle" size={14} color={COLORS.primary} />
                <Text style={styles.infoText}>Your broadcast will wait for Dr. Joshi's approval before it's delivered.</Text>
              </View>
            )}
            {isOwner && (
              <View style={styles.infoRow}>
                <Ionicons name="flash" size={14} color={COLORS.primary} />
                <Text style={styles.infoText}>
                  You can approve & send immediately from the list after saving.
                </Text>
              </View>
            )}

            {err ? <Text style={styles.errText}>{err}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <PrimaryButton
                title={composing ? 'Submitting…' : isOwner ? 'Save' : 'Submit for approval'}
                onPress={submit}
                disabled={composing}
                icon={<Ionicons name="send" size={16} color="#fff" />}
                style={{ flex: 1 }}
                testID="bc-submit"
              />
              <SecondaryButton title="Cancel" onPress={() => setShowCompose(false)} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reject modal */}
      <Modal visible={!!rejectingId} animationType="fade" transparent onRequestClose={() => setRejectingId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject broadcast</Text>
            <Text style={styles.rejectSub}>Tell the author why (optional):</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="e.g. Please simplify the language"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
              multiline
              testID="bc-reject-reason"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <SecondaryButton title="Cancel" onPress={() => setRejectingId(null)} style={{ flex: 1 }} />
              <PrimaryButton
                title="Reject"
                onPress={submitReject}
                icon={<Ionicons name="close" size={16} color="#fff" />}
                style={{ flex: 1, backgroundColor: COLORS.accent }}
                testID="bc-reject-submit"
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function StatusPill({ status }: { status: BroadcastStatus }) {
  const map: Record<BroadcastStatus, { label: string; bg: string; fg: string; icon: any }> = {
    pending_approval: { label: 'PENDING', bg: '#FFF5E6', fg: '#C97B2A', icon: 'time-outline' },
    approved: { label: 'APPROVED', bg: '#E6F7F1', fg: '#2AA37A', icon: 'checkmark-done' },
    sent: { label: 'SENT', bg: '#E8F3F7', fg: COLORS.primary, icon: 'send' },
    rejected: { label: 'REJECTED', bg: '#FCEBEB', fg: '#C24C4C', icon: 'close-circle' },
  };
  const s = map[status] || map.pending_approval;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <Ionicons name={s.icon} size={10} color={s.fg} />
      <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  h1: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  composeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  composeBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
  refreshBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
    backgroundColor: COLORS.primary + '0F',
    marginRight: 8,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF5E6', padding: 10, borderRadius: RADIUS.md, marginTop: 8, borderWidth: 1, borderColor: '#FFD9A6' },
  bannerText: { ...FONTS.bodyMedium, color: '#8A4C10', fontSize: 12, flex: 1 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 11 },

  empty: { alignItems: 'center', padding: 30 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10 },

  card: { backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  pillText: { ...FONTS.label, fontSize: 10 },

  title: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14, marginBottom: 3 },
  body: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },
  thumb: { width: '100%', height: 140, borderRadius: RADIUS.md, marginTop: 10, backgroundColor: COLORS.border },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  linkText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1 },
  footLine: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  approveBtn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  rejectBtn: { borderColor: COLORS.accent },
  deleteBtn: { marginLeft: 'auto' },
  actionBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11 },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: Platform.OS === 'ios' ? 50 : 16 },
  modalTitle: { ...FONTS.h4, color: COLORS.textPrimary },

  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginTop: 14 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  counter: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, textAlign: 'right', marginTop: 2 },
  previewImg: { width: '100%', height: 140, borderRadius: RADIUS.md, marginTop: 8, backgroundColor: COLORS.border },

  targetChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  targetChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  targetChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  infoRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 14, backgroundColor: COLORS.primary + '0D', padding: 10, borderRadius: RADIUS.md },
  infoText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1, lineHeight: 18 },
  errText: { color: COLORS.accent, ...FONTS.body, marginTop: 10 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  rejectCard: { backgroundColor: '#fff', padding: 20, borderRadius: RADIUS.md },
  rejectTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginBottom: 4 },
  rejectSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 8 },
});
