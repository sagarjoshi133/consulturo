// Personal Message composer (modal).
// Used by owner + permitted team members (`can_send_personal_messages`).
//
// • Scope toggle:    Team  /  Patients   (owner→staff vs. staff→patient)
// • Recipient picker: search-as-you-type, hits /api/messages/recipients
// • Single OR multi-select (tap-and-hold to start multi; tap the
//   checkbox icon left of the search bar to enter/leave multi-select).
// • Title + Body fields
// • Sends via /api/messages/send (one POST per recipient when multi);
//   backend persists kind="personal" notification + fires push.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import api from './api';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';

type Attachment = {
  id: string;        // local-only id
  name: string;
  mime: string;
  size_bytes: number;
  data_url: string;
  kind: 'image' | 'video' | 'file';
  preview_uri?: string;  // for thumbnails (image/video first frame)
};

const MAX_ATTACH_COUNT = 6;
const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
function fmtBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Recipient = {
  user_id: string;
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  picture?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSent?: () => void;
  initialRecipient?: Recipient | null;
};

export default function MessageComposer({
  visible,
  onClose,
  onSent,
  initialRecipient = null,
}: Props) {
  const { user } = useAuth();
  const isStaff = !!user && ['owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'].includes((user.role as string) || '');
  const [scope, setScope] = useState<'team' | 'patients'>('team');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);

  // Selection — always-on multi-select. Every tap (or long-press) on a
  // row toggles its membership. The bulk-action toolbar at the bottom
  // appears the instant `selected.length > 0`. The user reaches the
  // compose screen by tapping "Compose" on that toolbar (or by passing
  // an `initialRecipient` for a single-direct flow).
  const [selected, setSelected] = useState<Recipient[]>([]);
  const [composing, setComposing] = useState(false);

  // Single-recipient flow stays for backwards compat (e.g. when launching
  // the composer with a pre-filled recipient from a chat).
  const [recipient, setRecipient] = useState<Recipient | null>(initialRecipient);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pickingAttach, setPickingAttach] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  // Reset state on visible toggle.
  useEffect(() => {
    if (!visible) return;
    setRecipient(initialRecipient);
    setSelected([]);
    setComposing(!!initialRecipient);
    setTitle(''); setBody('');
    setAttachments([]);
    setQuery(''); setResults([]); setErr('');
    setScope('team');
  }, [visible, initialRecipient]);

  // Patients can only message Team — force scope.
  useEffect(() => {
    if (!isStaff && scope !== 'team') setScope('team');
  }, [isStaff, scope]);

  // Debounced recipient search.
  useEffect(() => {
    if (!visible || composing) return;
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/messages/recipients', {
          params: { q: query, scope },
        });
        if (!cancelled) setResults(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, scope, visible, composing]);

  const isPicked = (uid: string) => selected.some((r) => r.user_id === uid);

  const togglePick = (r: Recipient) => {
    setSelected((cur) => {
      if (cur.some((x) => x.user_id === r.user_id)) return cur.filter((x) => x.user_id !== r.user_id);
      return [...cur, r];
    });
  };

  const proceedToCompose = () => {
    if (selected.length === 0 && !recipient) return;
    if (selected.length === 1) setRecipient(selected[0]);
    else if (selected.length > 1) setRecipient(null); // multi-recipient banner shown
    setComposing(true);
  };

  const backToPicker = () => {
    setComposing(false);
    setRecipient(null);
  };

  const canSend = useMemo(() => {
    const has = recipient || selected.length > 0;
    return !!has && title.trim().length > 0 && body.trim().length > 0 && !sending;
  }, [recipient, selected, title, body, sending]);

  const send = async () => {
    setSending(true); setErr('');
    try {
      const targets = selected.length > 0
        ? selected
        : (recipient ? [recipient] : []);
      const payloadAttachments = attachments.map((a) => ({
        name: a.name, mime: a.mime, size_bytes: a.size_bytes, data_url: a.data_url, kind: a.kind,
      }));
      // Fire all sends in parallel — one POST per recipient. Failures
      // are aggregated so the user sees how many delivered.
      const outcomes = await Promise.allSettled(
        targets.map((r) =>
          api.post('/messages/send', {
            recipient_user_id: r.user_id,
            title: title.trim(),
            body: body.trim(),
            attachments: payloadAttachments.length ? payloadAttachments : undefined,
          }),
        ),
      );
      const okCount = outcomes.filter((o) => o.status === 'fulfilled').length;
      const failCount = targets.length - okCount;
      onSent?.();
      onClose();
      if (failCount > 0) {
        Alert.alert(
          'Some messages did not send',
          `${okCount} delivered, ${failCount} failed.`,
        );
      } else if (okCount === 1) {
        const r = targets[0];
        Alert.alert('Sent', `Message delivered to ${r.name || r.email || 'the recipient'}.`);
      } else {
        Alert.alert('Sent', `Message delivered to ${okCount} recipients.`);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  const showCompose = composing && (recipient || selected.length > 0);

  // ── Attachment helpers ──
  const addAttachment = (a: Attachment) => {
    setAttachments((cur) => {
      if (cur.length >= MAX_ATTACH_COUNT) {
        Alert.alert('Limit reached', `You can attach up to ${MAX_ATTACH_COUNT} items per message.`);
        return cur;
      }
      if (a.size_bytes > MAX_ATTACH_BYTES) {
        Alert.alert('File too large', `"${a.name}" is over 8 MB.`);
        return cur;
      }
      return [...cur, a];
    });
  };
  const removeAttachment = (id: string) =>
    setAttachments((cur) => cur.filter((a) => a.id !== id));

  const pickImageOrVideo = async () => {
    try {
      setPickingAttach(true);
      // On web, we don't need media library permission — the browser
      // file picker handles this. On native, request photos / media.
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          alertCross('Permission needed', 'Please grant photo / media access.');
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.All || ('images' as any),
        quality: 0.7,
        base64: true,
        videoMaxDuration: 60,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const isVideo = (a.mimeType || '').startsWith('video/') || a.type === 'video';
      let dataUrl = '';
      if (a.base64) {
        dataUrl = `data:${a.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg')};base64,${a.base64}`;
      } else if (a.uri) {
        // Fallback for video — read via FileSystem on native; on web,
        // a.uri is already a blob/data URL we can use directly.
        if (Platform.OS === 'web') {
          dataUrl = a.uri;
        } else {
          try {
            const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
            dataUrl = `data:${a.mimeType || 'video/mp4'};base64,${b64}`;
          } catch {
            dataUrl = a.uri;
          }
        }
      }
      const sizeBytes = (a as any).fileSize || (a.base64 ? Math.round(a.base64.length * 3 / 4) : 0);
      addAttachment({
        id: `att_${Date.now().toString(36)}`,
        name: a.fileName || (isVideo ? 'video.mp4' : 'photo.jpg'),
        mime: a.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg'),
        size_bytes: sizeBytes,
        data_url: dataUrl,
        kind: isVideo ? 'video' : 'image',
        preview_uri: a.uri,
      });
    } catch (e) {
      alertCross('Could not attach', String((e as any)?.message || e));
    } finally {
      setPickingAttach(false);
    }
  };

  const pickFile = async () => {
    try {
      setPickingAttach(true);
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      let dataUrl = '';
      const mime = a.mimeType || 'application/octet-stream';
      if (Platform.OS === 'web') {
        // On web, expo-document-picker returns a blob URL or data URI
        // directly in `uri`. Convert blob URLs to base64 data URLs so
        // the backend can persist them.
        if (a.uri.startsWith('data:')) {
          dataUrl = a.uri;
        } else {
          try {
            const blob = await fetch(a.uri).then((r) => r.blob());
            dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result || ''));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch (e) {
            alertCross('Could not read file', String((e as any)?.message || e));
            return;
          }
        }
      } else {
        try {
          const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
          dataUrl = `data:${mime};base64,${b64}`;
        } catch (e) {
          alertCross('Could not read file', String((e as any)?.message || e));
          return;
        }
      }
      const kind: Attachment['kind'] = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file';
      // Estimate size from the data URL when not provided.
      const sizeBytes = a.size || (dataUrl.includes(',') ? Math.round(dataUrl.split(',')[1].length * 3 / 4) : 0);
      addAttachment({
        id: `att_${Date.now().toString(36)}`,
        name: a.name || 'file',
        mime,
        size_bytes: sizeBytes,
        data_url: dataUrl,
        kind,
        preview_uri: kind === 'image' ? (a.uri.startsWith('data:') ? a.uri : dataUrl) : undefined,
      });
    } catch (e) {
      alertCross('Could not attach', String((e as any)?.message || e));
    } finally {
      setPickingAttach(false);
    }
  };

  // Cross-platform alert (Alert.alert is a no-op for `confirm`-style
  // prompts on web, so fall back to window.alert / window.confirm).
  const alertCross = (title: string, message?: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // eslint-disable-next-line no-alert
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  };

  // Show a small inline source picker. Alert with multiple buttons is
  // unreliable on web (it shows only the message), so we render an
  // explicit pop-over using a Modal-like overlay below.
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const showAttachSheet = () => setAttachSheetOpen(true);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: COLORS.bg }}>
        {/* Header */}
        <View style={styles.head}>
          <TouchableOpacity
            onPress={() => { if (showCompose) backToPicker(); else onClose(); }}
            style={styles.iconBtn}
            testID="msgcomp-close"
          >
            <Ionicons name={showCompose ? 'arrow-back' : 'close'} size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.title}>
            {showCompose
              ? 'New message'
              : selected.length > 0
                ? `${selected.length} selected`
                : 'New message'}
          </Text>
          {/* Right action — Send when composing; otherwise a small clear/all action when picking */}
          {showCompose ? (
            <TouchableOpacity
              onPress={send}
              disabled={!canSend}
              style={[styles.sendBtn, !canSend && { opacity: 0.4 }]}
              testID="msgcomp-send"
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={14} color="#fff" />
                  <Text style={styles.sendText}>
                    Send{selected.length > 1 ? ` (${selected.length})` : ''}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : selected.length > 0 ? (
            <TouchableOpacity
              onPress={() => setSelected([])}
              style={styles.clearBtn}
              testID="msgcomp-clear"
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 56 }} />
          )}
        </View>

        {showCompose ? (
          // ── Compose mode ──
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {/* Recipient summary chip(s) */}
            {selected.length > 1 ? (
              <View style={styles.recipChip}>
                <View style={[styles.multiAvatar]}>
                  <Ionicons name="people" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.recipName} numberOfLines={1}>
                    {selected.length} recipients
                  </Text>
                  <Text style={styles.recipSub} numberOfLines={2}>
                    {selected.slice(0, 3).map((r) => r.name || r.email).join(', ')}
                    {selected.length > 3 ? ` and ${selected.length - 3} more` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={backToPicker} style={styles.iconBtn}>
                  <Ionicons name="create-outline" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            ) : recipient ? (
              <View style={styles.recipChip}>
                {recipient.picture ? (
                  <Image source={{ uri: recipient.picture }} style={styles.recipAvatar} />
                ) : (
                  <View style={[styles.recipAvatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                    <Text style={{ ...FONTS.bodyMedium, color: COLORS.primary }}>{(recipient.name || '?').charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.recipName} numberOfLines={1}>{recipient.name || recipient.email}</Text>
                  <Text style={styles.recipSub} numberOfLines={1}>
                    {(recipient.role || '').toUpperCase()}{recipient.email ? ` · ${recipient.email}` : ''}{recipient.phone ? ` · ${recipient.phone}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={backToPicker} style={styles.iconBtn}>
                  <Ionicons name="swap-horizontal" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            ) : null}

            <Text style={styles.label}>SUBJECT</Text>
            <TextInput
              value={title}
              onChangeText={(s) => setTitle(s.slice(0, 140))}
              placeholder="e.g. Reminder for tomorrow"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              maxLength={140}
              testID="msgcomp-title"
            />
            <Text style={styles.charCount}>{title.length}/140</Text>

            <Text style={styles.label}>MESSAGE</Text>
            <TextInput
              value={body}
              onChangeText={(s) => setBody(s.slice(0, 2000))}
              placeholder="Write your message…"
              placeholderTextColor={COLORS.textDisabled}
              multiline
              numberOfLines={8}
              style={[styles.input, styles.bodyInput]}
              textAlignVertical="top"
              maxLength={2000}
              testID="msgcomp-body"
            />
            <Text style={styles.charCount}>{body.length}/2000</Text>

            {/* Attachments — chips with thumbnails / icons */}
            <View style={styles.attachRow}>
              <TouchableOpacity
                onPress={showAttachSheet}
                disabled={pickingAttach || attachments.length >= MAX_ATTACH_COUNT}
                style={[styles.attachBtn, (pickingAttach || attachments.length >= MAX_ATTACH_COUNT) && { opacity: 0.5 }]}
                testID="msgcomp-attach"
              >
                {pickingAttach ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="attach" size={16} color={COLORS.primary} />
                )}
                <Text style={styles.attachBtnText}>Attach</Text>
              </TouchableOpacity>
              {attachments.length > 0 && (
                <Text style={styles.attachCount}>
                  {attachments.length} / {MAX_ATTACH_COUNT}
                </Text>
              )}
            </View>
            {attachments.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                {attachments.map((a) => (
                  <View key={a.id} style={styles.attachChip}>
                    {a.kind === 'image' && a.preview_uri ? (
                      <Image source={{ uri: a.preview_uri }} style={styles.attachThumb} />
                    ) : (
                      <View style={[styles.attachThumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '14' }]}>
                        <Ionicons
                          name={a.kind === 'video' ? 'videocam' : a.kind === 'image' ? 'image' : 'document'}
                          size={22}
                          color={COLORS.primary}
                        />
                      </View>
                    )}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.attachName} numberOfLines={1}>{a.name}</Text>
                      <Text style={styles.attachMeta}>{fmtBytes(a.size_bytes)}</Text>
                    </View>
                    <TouchableOpacity onPress={() => removeAttachment(a.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={styles.attachRemove}>
                      <Ionicons name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {err ? <Text style={styles.err}>{err}</Text> : null}

            <View style={styles.tipBox}>
              <Ionicons name="information-circle" size={14} color={COLORS.primary} />
              <Text style={styles.tipText}>
                A push notification is sent to {selected.length > 1 ? `each of the ${selected.length} recipients` : (recipient?.name?.split(' ')[0] || 'the recipient')}.
              </Text>
            </View>
          </ScrollView>
        ) : (
          // ── Recipient picker mode ──
          <View style={{ flex: 1 }}>
            {/* Scope toggle — staff only. Patients can only message Team. */}
            {isStaff && (
              <View style={styles.scopeRow}>
                {(['team', 'patients'] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => { setScope(s); setSelected([]); }}
                    style={[styles.scopeChip, scope === s && styles.scopeChipActive]}
                    testID={`msgcomp-scope-${s}`}
                  >
                    <Ionicons
                      name={s === 'team' ? 'people' : 'medical'}
                      size={14}
                      color={scope === s ? '#fff' : COLORS.primary}
                    />
                    <Text style={[styles.scopeText, scope === s && { color: '#fff' }]}>
                      {s === 'team' ? 'Team' : 'Patients'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Search bar — full width. Multi-select is implicit: every
                tap on a row toggles its membership. */}
            <View style={styles.searchRow}>
              <View style={[styles.searchBar, { flex: 1 }]}>
                <Ionicons name="search" size={16} color={COLORS.textSecondary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${scope === 'team' ? 'team members' : 'patients'}…`}
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  testID="msgcomp-search"
                />
                {!!query && (
                  <TouchableOpacity onPress={() => setQuery('')}>
                    <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {searching ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: 28 }} />
            ) : (
              <ScrollView
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: selected.length > 0 ? 110 : 40,
                }}
                keyboardShouldPersistTaps="handled"
              >
                {results.length === 0 ? (
                  <View style={styles.empty}>
                    <Ionicons name="search-outline" size={36} color={COLORS.textDisabled} />
                    <Text style={styles.emptyText}>
                      {query
                        ? `No ${scope} match "${query}"`
                        : `Type to search ${scope}.`}
                    </Text>
                  </View>
                ) : (
                  results.map((r) => {
                    const picked = isPicked(r.user_id);
                    return (
                      <TouchableOpacity
                        key={r.user_id}
                        style={[styles.row, picked && styles.rowPicked]}
                        onPress={() => togglePick(r)}
                        onLongPress={() => togglePick(r)}
                        delayLongPress={200}
                        activeOpacity={0.78}
                        testID={`msgcomp-pick-${r.user_id}`}
                      >
                        {/* Checkbox always visible — tapping the row or
                            its checkbox both toggle selection. */}
                        <View style={[styles.checkbox, picked && styles.checkboxOn]}>
                          {picked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        {r.picture ? (
                          <Image source={{ uri: r.picture }} style={styles.recipAvatar} />
                        ) : (
                          <View style={[styles.recipAvatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={{ ...FONTS.bodyMedium, color: COLORS.primary }}>
                              {(r.name || '?').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.recipName} numberOfLines={1}>{r.name || r.email}</Text>
                          <Text style={styles.recipSub} numberOfLines={1}>
                            {(r.role || '').toUpperCase()}{r.email ? ` · ${r.email}` : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}

            {/* Bulk action toolbar — appears on first selection. Shows
                count + chip preview + "Compose" button. */}
            {selected.length > 0 && !showCompose ? (
              <View style={styles.bulkBar} testID="msgcomp-bulkbar">
                <View style={{ flex: 1 }}>
                  <Text style={styles.bulkCount}>
                    {selected.length} {selected.length === 1 ? 'recipient' : 'recipients'} selected
                  </Text>
                  <Text style={styles.bulkPreview} numberOfLines={1}>
                    {selected.slice(0, 3).map((r) => r.name || r.email).join(', ')}
                    {selected.length > 3 ? ` +${selected.length - 3} more` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={proceedToCompose}
                  style={styles.bulkComposeBtn}
                  activeOpacity={0.85}
                  testID="msgcomp-bulk-compose"
                >
                  <Ionicons name="create" size={16} color="#fff" />
                  <Text style={styles.bulkComposeText}>Compose</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Attach source picker — shown when the user taps the Attach
          button. Renders inline (cross-platform) instead of using
          Alert.alert which doesn't reliably show buttons on web. */}
      {attachSheetOpen ? (
        <View style={styles.sheetOverlay}>
          <TouchableOpacity
            activeOpacity={1}
            style={styles.sheetBackdrop}
            onPress={() => setAttachSheetOpen(false)}
            testID="msgcomp-attach-sheet-backdrop"
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Attach</Text>
            <Text style={styles.sheetHint}>Choose where to pick from</Text>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setAttachSheetOpen(false); pickImageOrVideo(); }}
              testID="msgcomp-attach-photo"
            >
              <View style={[styles.sheetIconWrap, { backgroundColor: COLORS.primary + '18' }]}>
                <Ionicons name="image" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetItemTitle}>Photo / Video</Text>
                <Text style={styles.sheetItemSub}>Pick from gallery (up to 60s video)</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetItem}
              onPress={() => { setAttachSheetOpen(false); pickFile(); }}
              testID="msgcomp-attach-file"
            >
              <View style={[styles.sheetIconWrap, { backgroundColor: COLORS.warning + '18' }]}>
                <Ionicons name="document" size={20} color={COLORS.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetItemTitle}>File / Document</Text>
                <Text style={styles.sheetItemSub}>PDF, DOCX, audio, any file (≤ 8 MB)</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setAttachSheetOpen(false)}
              testID="msgcomp-attach-cancel"
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15, marginLeft: 4 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  sendText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 12 },

  // Clear (header right) — appears when at least one row is picked
  clearBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  clearText: { color: COLORS.accent, fontFamily: 'Manrope_700Bold', fontSize: 12 },

  // Bulk action toolbar — sticks to the bottom of the picker view as
  // soon as one row is selected.
  bulkBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: COLORS.border,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: -2 } },
      android: { elevation: 6 },
    }),
  },
  bulkCount: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  bulkPreview: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  bulkComposeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: RADIUS.pill,
  },
  bulkComposeText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },

  scopeRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
  scopeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.primary + '44',
    backgroundColor: '#fff',
  },
  scopeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scopeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  // Search row — multi-toggle (left) + search bar (right, flex 1)
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, marginTop: 4, marginBottom: 12,
    gap: 8,
  },
  multiToggle: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '44',
    alignItems: 'center', justifyContent: 'center',
  },
  multiToggleOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  searchBar: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  searchInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, fontSize: 14 },

  empty: { alignItems: 'center', padding: 40 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 10, fontSize: 13, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: 8,
  },
  rowPicked: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '08' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },

  recipChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary + '0E',
    borderWidth: 1, borderColor: COLORS.primary + '33',
    borderRadius: RADIUS.md,
    padding: 10,
  },
  recipAvatar: { width: 38, height: 38, borderRadius: 19 },
  multiAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  recipName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  recipSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },

  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 18, marginBottom: 6, letterSpacing: 0.6, fontSize: 10 },
  input: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15, color: COLORS.textPrimary,
  },
  bodyInput: { minHeight: 140, paddingTop: 12 },
  charCount: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 10, textAlign: 'right', marginTop: 4 },

  // Attachments
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1, borderColor: COLORS.primary + '55',
  },
  attachBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  attachCount: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  attachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    paddingRight: 10,
    paddingVertical: 6, paddingLeft: 6,
    borderWidth: 1, borderColor: COLORS.border,
    minWidth: 160, maxWidth: 220,
  },
  attachThumb: {
    width: 38, height: 38, borderRadius: 8,
    backgroundColor: COLORS.bg,
  },
  attachName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  attachMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 1 },
  attachRemove: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  err: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 10 },
  tipBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '0E',
    padding: 10, borderRadius: RADIUS.md,
    marginTop: 16,
  },
  tipText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1 },

  // Attach source picker (cross-platform bottom sheet)
  sheetOverlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.32)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: Platform.OS === 'ios' ? 32 : 22,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -4 } },
      android: { elevation: 12 },
    }),
  },
  sheetTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 16 },
  sheetHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 14 },
  sheetItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border + '88',
  },
  sheetIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetItemTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  sheetItemSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  sheetCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  sheetCancelText: { ...FONTS.bodyMedium, color: COLORS.accent, fontSize: 14 },
});
