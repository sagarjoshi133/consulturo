/**
 * Unregistered Patients — dedicated browse/list screen.
 *
 * A patient is "unregistered" when they exist in the canonical patient
 * registry (from a walk-in / phone-in / guest booking) but never
 * signed up for an account. Their contact details are captured on
 * booking so staff can convert them later.
 *
 * Backend:
 *   GET /api/registry/patients?registration_status=unregistered
 *   GET /api/registry/patients/summary
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Linking, Modal, Platform, Pressable,
  RefreshControl, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import api from '../../src/api';
import { COLORS } from '../../src/theme';
import { getCached, setCached, hasCached } from '../../src/data-cache';
import { UpdatedHint } from '../../src/updated-hint';

type Patient = {
  patient_id: string;
  name?: string;
  phone?: string;
  phone_digits?: string;
  email?: string | null;
  age?: string;
  gender?: string;
  reg_no?: string | null;
  first_seen_at?: string;
  updated_at?: string;
  invited_at?: string | null;
  invite_count?: number;
  needs_reinvite?: boolean;
};

type InvitePayload = {
  ok: boolean;
  join_url: string;
  share_message: string;
  wa_url: string | null;
  sms_uri: string | null;
  mailto_uri: string | null;
  invited_at: string;
};

type DuplicateCandidate = Patient & {
  confidence: 'strong' | 'weak';
  reasons: string[];
};

type Tab = 'unregistered' | 'reinvite' | 'registered' | 'all';

const TAB_ORDER: Tab[] = ['unregistered', 'reinvite', 'registered', 'all'];
const TAB_LABEL: Record<Tab, string> = {
  unregistered: 'Unregistered',
  reinvite:     'Re-invite',
  registered:   'Registered',
  all:          'All patients',
};

// Map a UI tab → the backend registration_status query value.
const TAB_STATUS: Record<Tab, string> = {
  unregistered: 'unregistered',
  reinvite:     'stale_invite',
  registered:   'registered',
  all:          'all',
};

export default function UnregisteredPatientsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unregistered');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Patient[]>(() => getCached<Patient[]>('patients:items:unregistered') ?? []);
  const [loading, setLoading] = useState(() => !hasCached('patients:items:unregistered'));
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<{
    total: number; registered: number; unregistered: number; stale_invite?: number;
  } | null>(() => getCached('patients:summary') ?? null);
  const [analytics, setAnalytics] = useState<{
    total_invited: number; converted_total: number;
    conversion_rate_total: number;
    converted_within_7d: number; converted_within_30d: number;
  } | null>(() => getCached('patients:analytics') ?? null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);
  // ── Multi-select mode ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = (pid: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  };
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const cacheKey = `patients:items:${tab}`;
    if (!opts?.silent && !hasCached(cacheKey)) setLoading(true);
    setErr(null);
    try {
      const [listRes, summaryRes, analyticsRes] = await Promise.all([
        api.get('/registry/patients', {
          params: { q: q.trim(), limit: 100, registration_status: TAB_STATUS[tab] },
        }),
        api.get('/registry/patients/summary').catch(() => ({ data: null })),
        api.get('/registry/invites/analytics').catch(() => ({ data: null })),
      ]);
      const list = Array.isArray(listRes?.data?.items) ? listRes.data.items : [];
      setItems(list);
      // Only cache the unfiltered list per tab (searches are transient).
      if (!q.trim()) setCached(cacheKey, list);
      if (summaryRes?.data) { setSummary(summaryRes.data); setCached('patients:summary', summaryRes.data); }
      if (analyticsRes?.data) { setAnalytics(analyticsRes.data); setCached('patients:analytics', analyticsRes.data); }
      setUpdatedAt(Date.now());
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (typeof d === 'object' ? d?.detail || d?.message : null)
          || e?.message || 'Load failed';
      setErr(msg);
      if (!items.length) setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q, items.length]);

  useEffect(() => {
    // On tab switch, show any cached list for that tab INSTANTLY, then
    // refresh quietly in the background (no full-screen spinner).
    const cacheKey = `patients:items:${tab}`;
    const hasTabCache = !q.trim() && hasCached(cacheKey);
    if (hasTabCache) {
      setItems(getCached<Patient[]>(cacheKey) ?? []);
      setLoading(false);
    }
    // Debounce search-query changes.
    const t = setTimeout(() => { load({ silent: hasTabCache }); }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q]);

  const badge = (t: Tab): number | null => {
    if (!summary) return null;
    if (t === 'unregistered') return summary.unregistered;
    if (t === 'reinvite')     return summary.stale_invite ?? 0;
    if (t === 'registered')   return summary.registered;
    return summary.total;
  };

  const bookFor = (p: Patient) => {
    const p10 = String(p.phone_digits || p.phone || '').replace(/\D/g, '');
    router.push(
      `/(tabs)/book?phone=${encodeURIComponent(p10)}&name=${encodeURIComponent(p.name || '')}` as any,
    );
  };

  // ── Invite ──
  const [inviteFor, setInviteFor] = useState<Patient | null>(null);
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const openInvite = useCallback(async (p: Patient) => {
    setInviteFor(p);
    setInvite(null);
    setInviteLoading(true);
    try {
      const r = await api.post(`/registry/patients/${encodeURIComponent(p.patient_id)}/invite`);
      setInvite(r.data as InvitePayload);
      // Optimistically bump the local invite_count so the badge reflects immediately.
      setItems((cur) => cur.map((x) =>
        x.patient_id === p.patient_id
          ? { ...x, invited_at: r.data.invited_at, invite_count: (x.invite_count || 0) + 1, needs_reinvite: false }
          : x,
      ));
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (typeof d === 'object' ? d?.message : null) || e?.message || 'Invite failed';
      Alert.alert('Invite failed', msg);
      setInviteFor(null);
    } finally {
      setInviteLoading(false);
    }
  }, []);

  const openLink = async (url: string | null | undefined) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch (e: any) {
      Alert.alert('Could not open link', e?.message || 'Try another channel.');
    }
  };
  const copyLink = async () => {
    if (!invite) return;
    try {
      await Clipboard.setStringAsync(invite.join_url);
      Alert.alert('Copied', 'Sign-in link copied to clipboard.');
    } catch {
      Alert.alert('Could not copy', 'Try selecting the link manually.');
    }
  };
  const shareInvite = async () => {
    if (!invite) return;
    try {
      await Share.share({ message: invite.share_message, url: invite.join_url });
    } catch {}
  };

  // ── Duplicates ──
  const [dupFor, setDupFor] = useState<Patient | null>(null);
  const [dupList, setDupList] = useState<DuplicateCandidate[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);

  const openDuplicates = useCallback(async (p: Patient) => {
    setDupFor(p);
    setDupList([]);
    setDupLoading(true);
    try {
      const r = await api.get(`/registry/patients/${encodeURIComponent(p.patient_id)}/duplicates`);
      setDupList(Array.isArray(r?.data?.candidates) ? r.data.candidates : []);
    } catch (e: any) {
      Alert.alert('Could not load duplicates', e?.response?.data?.detail || e?.message);
      setDupFor(null);
    } finally {
      setDupLoading(false);
    }
  }, []);

  const doMerge = async (dup: DuplicateCandidate) => {
    if (!dupFor) return;
    const target = dupFor;
    const confirmed = await new Promise<boolean>((resolve) => {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        resolve(window.confirm(
          `Merge "${dup.name || 'Unnamed'}" INTO "${target.name || 'Unnamed'}"?\n\n`
          + `Historical bookings, prescriptions, surgeries, and receipts of the duplicate `
          + `will be re-pointed to this patient. This cannot be undone via the app.`));
      } else {
        Alert.alert(
          'Confirm merge',
          `Merge "${dup.name || 'Unnamed'}" into "${target.name || 'Unnamed'}"?\n\n`
          + 'This re-points every history row from the duplicate onto this patient.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Merge', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      }
    });
    if (!confirmed) return;
    setMerging(dup.patient_id);
    try {
      await api.post(`/registry/patients/${encodeURIComponent(target.patient_id)}/merge`,
        { duplicate_patient_id: dup.patient_id });
      // Refresh the duplicates modal + main list.
      setDupList((cur) => cur.filter((x) => x.patient_id !== dup.patient_id));
      setItems((cur) => cur.filter((x) => x.patient_id !== dup.patient_id));
      Alert.alert('Merged', 'Duplicate merged successfully.');
      // Also refetch summary to reflect the reduced walk-in count.
      load({ silent: true });
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      Alert.alert('Merge failed', typeof d === 'string' ? d : e?.message || 'unknown');
    } finally {
      setMerging(null);
    }
  };

  // ── Bulk invite flow ──
  const [bulkModal, setBulkModal] = useState<'template_picker' | 'queue' | null>(null);
  const [bulkTemplates, setBulkTemplates] = useState<any[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<any | null>(null);

  const openBulkPicker = async () => {
    if (selectedIds.size === 0) return;
    setBulkModal('template_picker');
    try {
      const r = await api.get('/v2/communications/broadcast-templates',
        { params: { limit: 50 } });
      setBulkTemplates(Array.isArray(r?.data?.items) ? r.data.items : []);
    } catch {
      setBulkTemplates([]);
    }
  };

  const sendBulk = async (templateId: string | null) => {
    setBulkLoading(true);
    try {
      const r = await api.post('/registry/invites/bulk', {
        patient_ids: Array.from(selectedIds),
        template_id: templateId,
      });
      setBulkResult(r.data);
      setBulkModal('queue');
      // Optimistically flag the invited rows with the "invited" chip.
      const okIds = new Set<string>(
        (r.data?.results || [])
          .filter((x: any) => !x.error)
          .map((x: any) => x.patient_id),
      );
      setItems((cur) => cur.map((x) =>
        okIds.has(x.patient_id)
          ? { ...x, invite_count: (x.invite_count || 0) + 1,
              invited_at: new Date().toISOString(), needs_reinvite: false }
          : x,
      ));
      // Refresh analytics.
      load({ silent: true });
    } catch (e: any) {
      Alert.alert('Bulk invite failed',
        e?.response?.data?.detail || e?.message || 'unknown');
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Patients</Text>
        {tab === 'unregistered' && !selectMode ? (
          <Pressable onPress={() => setSelectMode(true)} hitSlop={10}
            style={{ paddingHorizontal: 10 }}>
            <Text style={{ color: COLORS.primary, fontSize: 13, fontWeight: '700' }}>
              Select
            </Text>
          </Pressable>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {updatedAt > 0 && !selectMode ? (
        <UpdatedHint at={updatedAt} style={styles.updatedHint} />
      ) : null}

      {/* Analytics tile (owner-only insight; hidden when empty) */}
      {analytics && analytics.total_invited > 0 && !selectMode ? (
        <View style={styles.analyticsTile}>
          <View style={styles.analyticsIcon}>
            <Ionicons name="trending-up" size={22} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.analyticsTitle}>Invite → sign-up conversion</Text>
            <Text style={styles.analyticsSub}>
              <Text style={{ fontWeight: '700', color: COLORS.textPrimary }}>
                {analytics.converted_total}
              </Text>
              {' of '}
              <Text style={{ fontWeight: '700', color: COLORS.textPrimary }}>
                {analytics.total_invited}
              </Text>
              {' invited walk-ins signed up'}
              {' · '}
              <Text style={{ fontWeight: '700', color: COLORS.success }}>
                {(analytics.conversion_rate_total * 100).toFixed(0)}%
              </Text>
            </Text>
            {analytics.converted_within_7d || analytics.converted_within_30d ? (
              <Text style={styles.analyticsMeta}>
                Last 7d: {analytics.converted_within_7d} ·
                Last 30d: {analytics.converted_within_30d}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Tab pills */}
      <View style={styles.tabRow}>
        {TAB_ORDER.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabActive]}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtActive]}>
              {TAB_LABEL[t]}
              {badge(t) != null ? ` · ${badge(t)}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search box */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Name, phone, email, reg no…"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.searchInput}
        />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Contextual hint for the Unregistered tab */}
      {tab === 'unregistered' && !q && !loading ? (
        <View style={styles.hintBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.primary} />
          <Text style={styles.hintTxt}>
            These patients booked without signing up. Their contact
            details are saved so you can invite them later.
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : err ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle" size={28} color={COLORS.textSecondary} />
          <Text style={styles.emptyTxt}>{err}</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={32} color={COLORS.textSecondary} />
          <Text style={styles.emptyTxt}>
            {q ? 'No matches.' : tab === 'unregistered'
              ? 'No unregistered patients yet.'
              : 'No patients found.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.patient_id}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={COLORS.primary}
              onRefresh={async () => {
                setRefreshing(true);
                try { await load({ silent: true }); }
                finally { setRefreshing(false); }
              }}
            />
          }
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.patient_id);
            return (
            <View style={[styles.card, isSelected && styles.cardSelected]}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
                onPress={() => selectMode
                  ? toggleSelected(item.patient_id)
                  : router.push(`/dashboard?tab=consultations` as any)}
                onLongPress={() => {
                  if (tab === 'unregistered') {
                    if (!selectMode) setSelectMode(true);
                    toggleSelected(item.patient_id);
                  }
                }}
              >
                {selectMode ? (
                  <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                    {isSelected
                      ? <Ionicons name="checkmark" size={16} color="#fff" />
                      : null}
                  </View>
                ) : (
                  <View style={styles.avatar}>
                    <Ionicons
                      name={tab === 'unregistered' ? 'person-add' : 'person'}
                      size={20}
                      color={COLORS.primary}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name || 'Unnamed'}
                    </Text>
                    {item.reg_no ? (
                      <View style={styles.regNoChip}>
                        <Text style={styles.regNoTxt}>#{item.reg_no}</Text>
                      </View>
                    ) : null}
                    {item.needs_reinvite ? (
                      <View style={styles.reinviteChip}>
                        <Ionicons name="alarm" size={10} color={COLORS.warning} />
                        <Text style={styles.reinviteTxt}>re-invite</Text>
                      </View>
                    ) : (item.invite_count || 0) > 0 ? (
                      <View style={styles.invitedChip}>
                        <Ionicons name="paper-plane" size={10} color={COLORS.success} />
                        <Text style={styles.invitedTxt}>invited</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta} numberOfLines={1}>
                    {(item.phone || item.phone_digits) ? `📞 ${item.phone || item.phone_digits}` : ''}
                    {item.email ? ` · ✉️ ${item.email}` : ''}
                    {item.age ? ` · ${item.age}y` : ''}
                    {item.gender ? ` · ${item.gender}` : ''}
                  </Text>
                </View>
              </Pressable>
              {selectMode ? null : (
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, marginLeft: 52 }}>
                  {tab === 'unregistered' || tab === 'reinvite' ? (
                    <Pressable
                      onPress={() => openInvite(item)}
                      style={styles.actionBtn}
                      hitSlop={4}
                    >
                      <Ionicons name="paper-plane-outline" size={13} color={COLORS.primary} />
                      <Text style={styles.actionBtnTxt}>{tab === 'reinvite' ? 'Re-invite' : 'Invite'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => openDuplicates(item)}
                    style={styles.actionBtn}
                    hitSlop={4}
                  >
                    <Ionicons name="git-merge-outline" size={13} color={COLORS.primary} />
                    <Text style={styles.actionBtnTxt}>Duplicates</Text>
                  </Pressable>
                  <Pressable onPress={() => bookFor(item)} style={styles.bookBtn} hitSlop={4}>
                    <Ionicons name="calendar" size={13} color="#fff" />
                    <Text style={styles.bookTxt}>Book</Text>
                  </Pressable>
                </View>
              )}
            </View>
            );
          }}
        />
      )}

      {/* ── Sticky bulk-action bar ── */}
      {selectMode ? (
        <View style={styles.bulkBar}>
          <Pressable onPress={exitSelectMode} hitSlop={10}>
            <Text style={styles.bulkCancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.bulkCount}>
            {selectedIds.size} selected
          </Text>
          <Pressable
            onPress={openBulkPicker}
            disabled={selectedIds.size === 0}
            style={[styles.bulkBtn, selectedIds.size === 0 && { opacity: 0.5 }]}
          >
            <Ionicons name="paper-plane" size={14} color="#fff" />
            <Text style={styles.bulkBtnTxt}>Bulk Invite</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Template picker modal ── */}
      <Modal
        visible={bulkModal === 'template_picker'}
        animationType="slide"
        transparent
        onRequestClose={() => setBulkModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setBulkModal(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Send bulk invite</Text>
          <Text style={styles.sheetSub}>
            {selectedIds.size} walk-in patient{selectedIds.size === 1 ? '' : 's'} selected.
            Pick a Broadcast Studio template to use as the invite message,
            or skip and use the default text.
          </Text>
          <FlatList
            data={bulkTemplates}
            keyExtractor={(t) => t.id}
            style={{ maxHeight: 300 }}
            ListHeaderComponent={
              <Pressable
                onPress={() => sendBulk(null)}
                style={[styles.tplRow, { backgroundColor: COLORS.primary + '10' }]}
              >
                <Ionicons name="text" size={20} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplTitle}>Default invite text</Text>
                  <Text style={styles.tplBody} numberOfLines={2}>
                    Uses the standard “Hi [name], the clinic has saved your details…” message.
                  </Text>
                </View>
                {bulkLoading ? <ActivityIndicator color={COLORS.primary} size="small" /> : null}
              </Pressable>
            }
            ListEmptyComponent={
              <View style={{ paddingVertical: 16, paddingHorizontal: 4 }}>
                <Text style={styles.tplBody}>
                  No broadcast templates yet. Owner can create one in
                  Broadcast Studio → 🔖 Templates.
                </Text>
              </View>
            }
            renderItem={({ item: t }) => (
              <Pressable
                onPress={() => sendBulk(t.id)}
                style={styles.tplRow}
              >
                <Ionicons name="bookmarks" size={20} color={COLORS.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tplTitle}>{t.name}</Text>
                  <Text style={styles.tplBody} numberOfLines={2}>{t.title}</Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      </Modal>

      {/* ── Bulk queue result modal ── */}
      <Modal
        visible={bulkModal === 'queue'}
        animationType="slide"
        transparent
        onRequestClose={() => { setBulkModal(null); exitSelectMode(); }}
      >
        <Pressable style={styles.backdrop}
          onPress={() => { setBulkModal(null); exitSelectMode(); }} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Invite queue ready</Text>
          <Text style={styles.sheetSub}>
            {bulkResult?.ok_count || 0} ready to send · {bulkResult?.error_count || 0} skipped.
            Tap each to open WhatsApp / SMS with the message prefilled.
          </Text>
          <FlatList
            data={bulkResult?.results || []}
            keyExtractor={(r: any) => r.patient_id}
            style={{ maxHeight: 380 }}
            renderItem={({ item: r }: { item: any }) => (
              <View style={styles.queueRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.name || 'Unnamed'}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {r.phone ? `📞 ${r.phone}` : ''}{r.email ? ` · ✉️ ${r.email}` : ''}
                  </Text>
                  {r.error ? (
                    <Text style={{ fontSize: 11, color: COLORS.danger, marginTop: 3 }}>
                      {r.error === 'no_contact' ? 'no phone/email on file'
                        : r.error === 'not_found' ? 'patient not found' : r.error}
                    </Text>
                  ) : null}
                </View>
                {r.wa_url ? (
                  <Pressable onPress={() => openLink(r.wa_url)} style={styles.queueBtn}>
                    <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                  </Pressable>
                ) : r.sms_uri ? (
                  <Pressable onPress={() => openLink(r.sms_uri)} style={styles.queueBtn}>
                    <Ionicons name="chatbubble" size={14} color="#fff" />
                  </Pressable>
                ) : r.mailto_uri ? (
                  <Pressable onPress={() => openLink(r.mailto_uri)} style={styles.queueBtn}>
                    <Ionicons name="mail" size={14} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            )}
          />
          <Pressable
            onPress={() => { setBulkModal(null); exitSelectMode(); }}
            style={styles.closeBtn}
          >
            <Text style={styles.closeBtnTxt}>Done</Text>
          </Pressable>
        </View>
      </Modal>

      {/* ── Invite modal ── */}
      <Modal
        visible={!!inviteFor}
        animationType="slide"
        transparent
        onRequestClose={() => { setInviteFor(null); setInvite(null); }}
      >
        <Pressable style={styles.backdrop} onPress={() => { setInviteFor(null); setInvite(null); }} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Invite {inviteFor?.name?.split(' ')[0] || 'this patient'}</Text>
          <Text style={styles.sheetSub}>
            Pick a channel to send the sign-in link. The patient will be
            able to see their prescriptions, upcoming appointments, and
            message the clinic from the app.
          </Text>
          {inviteLoading || !invite ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
          ) : (
            <>
              <View style={styles.channelGrid}>
                {invite.wa_url ? (
                  <ChannelBtn icon="logo-whatsapp" label="WhatsApp"
                    color="#25D366"
                    onPress={() => openLink(invite.wa_url)} />
                ) : null}
                {invite.sms_uri ? (
                  <ChannelBtn icon="chatbubble-ellipses" label="SMS"
                    color={COLORS.primary}
                    onPress={() => openLink(invite.sms_uri)} />
                ) : null}
                {invite.mailto_uri ? (
                  <ChannelBtn icon="mail" label="Email"
                    color={COLORS.primary}
                    onPress={() => openLink(invite.mailto_uri)} />
                ) : null}
                <ChannelBtn icon="share-social" label="Share…"
                  color={COLORS.primary}
                  onPress={shareInvite} />
                <ChannelBtn icon="copy" label="Copy link"
                  color={COLORS.primary}
                  onPress={copyLink} />
              </View>
              <View style={styles.linkBox}>
                <Text selectable style={styles.linkTxt}>{invite.join_url}</Text>
              </View>
              <Pressable onPress={() => { setInviteFor(null); setInvite(null); }}
                style={styles.closeBtn}>
                <Text style={styles.closeBtnTxt}>Done</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>

      {/* ── Duplicates modal ── */}
      <Modal
        visible={!!dupFor}
        animationType="slide"
        transparent
        onRequestClose={() => { setDupFor(null); setDupList([]); }}
      >
        <Pressable style={styles.backdrop} onPress={() => { setDupFor(null); setDupList([]); }} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            Possible duplicates
          </Text>
          <Text style={styles.sheetSub} numberOfLines={2}>
            Candidates that look like the same person as{' '}
            <Text style={{ fontWeight: '700' }}>{dupFor?.name || 'this patient'}</Text>.
            Tap “Merge into this” to absorb their history into this row.
          </Text>
          {dupLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
          ) : dupList.length === 0 ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={32} color={COLORS.success} />
              <Text style={[styles.emptyTxt, { marginTop: 8 }]}>No duplicates detected.</Text>
            </View>
          ) : (
            <FlatList
              data={dupList}
              keyExtractor={(d) => d.patient_id}
              style={{ maxHeight: 380 }}
              renderItem={({ item: d }) => (
                <View style={styles.dupCard}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name} numberOfLines={1}>{d.name || 'Unnamed'}</Text>
                      <View style={[
                        styles.confidenceChip,
                        d.confidence === 'strong' ? styles.confStrong : styles.confWeak,
                      ]}>
                        <Text style={[
                          styles.confidenceTxt,
                          d.confidence === 'strong' ? { color: COLORS.danger } : { color: COLORS.warning },
                        ]}>
                          {d.confidence.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {(d.phone || d.phone_digits) ? `📞 ${d.phone || d.phone_digits}` : ''}
                      {d.email ? ` · ✉️ ${d.email}` : ''}
                    </Text>
                    <Text style={styles.dupReasons}>{d.reasons.join(', ')}</Text>
                  </View>
                  <Pressable
                    onPress={() => doMerge(d)}
                    disabled={merging === d.patient_id}
                    style={[styles.mergeBtn, merging === d.patient_id && { opacity: 0.5 }]}
                  >
                    {merging === d.patient_id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.mergeBtnTxt}>Merge into this</Text>}
                  </Pressable>
                </View>
              )}
            />
          )}
          <Pressable onPress={() => { setDupFor(null); setDupList([]); }}
            style={styles.closeBtn}>
            <Text style={styles.closeBtnTxt}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ChannelBtn({ icon, label, color, onPress }:
  { icon: any; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.channelBtn}>
      <View style={[styles.channelIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.channelLbl}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  updatedHint: { textAlign: 'center', paddingTop: 6, paddingBottom: 2 },
  headerTitle: {
    flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabRow: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  tab: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: COLORS.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabTxt: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary },
  tabTxtActive: { color: '#fff' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginTop: 10,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    backgroundColor: COLORS.surface, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: COLORS.textPrimary, padding: 0 },
  hintBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: 12, marginTop: 10, padding: 10,
    backgroundColor: '#E6F4F7', borderRadius: 10,
  },
  hintTxt: { flex: 1, fontSize: 12, color: COLORS.textPrimary, lineHeight: 16 },
  card: {
    flexDirection: 'column',
    marginHorizontal: 12, marginTop: 8, padding: 12,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  cardSelected: {
    borderColor: COLORS.primary, borderWidth: 1.5,
    backgroundColor: COLORS.primary + '08',
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface,
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  analyticsTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 12, marginTop: 10, padding: 12,
    backgroundColor: COLORS.surface, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    borderLeftWidth: 3, borderLeftColor: COLORS.primary,
  },
  analyticsIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  analyticsTitle: {
    fontSize: 12, fontWeight: '700', color: COLORS.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3,
  },
  analyticsSub: { fontSize: 13, color: COLORS.textSecondary },
  analyticsMeta: { fontSize: 11, color: COLORS.textDisabled, marginTop: 2 },
  bulkBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border,
  },
  bulkCancel: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '700' },
  bulkCount: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  bulkBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tplRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, marginBottom: 6, borderRadius: 10,
    backgroundColor: COLORS.bg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
  },
  tplTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  tplBody: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  queueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  queueBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#E6F4F7',
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  meta: { fontSize: 12, color: COLORS.textSecondary, marginTop: 3 },
  regNoChip: { backgroundColor: '#E6F4F7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  regNoTxt: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  invitedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },
  invitedTxt: { fontSize: 10, fontWeight: '700', color: COLORS.success },
  reinviteChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: COLORS.warning + '18',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
  },
  reinviteTxt: { fontSize: 10, fontWeight: '700', color: COLORS.warning },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: COLORS.primary + '12',
  },
  actionBtnTxt: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    marginLeft: 'auto',
  },
  bookTxt: { fontSize: 12, color: '#fff', fontWeight: '700' },
  empty: {
    marginTop: 40, alignItems: 'center', paddingHorizontal: 24, gap: 8,
  },
  emptyTxt: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center' },

  // ── modals ──
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, paddingHorizontal: 16, paddingBottom: 24,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary,
                  marginBottom: 6 },
  sheetSub: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 14 },
  channelGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16,
  },
  channelBtn: {
    alignItems: 'center', width: '18%', minWidth: 60,
  },
  channelIcon: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  channelLbl: { fontSize: 11, color: COLORS.textPrimary, textAlign: 'center' },
  linkBox: {
    backgroundColor: COLORS.bg, padding: 10, borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border,
    marginBottom: 16,
  },
  linkTxt: { fontSize: 11, color: COLORS.textSecondary, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  closeBtn: {
    marginTop: 6, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
    backgroundColor: COLORS.primary,
  },
  closeBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ── duplicates ──
  dupCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  confidenceChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  confStrong: { backgroundColor: COLORS.danger + '18' },
  confWeak:   { backgroundColor: COLORS.warning + '20' },
  confidenceTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  dupReasons: { fontSize: 11, color: COLORS.textDisabled, marginTop: 3, fontStyle: 'italic' },
  mergeBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, minWidth: 110, alignItems: 'center',
  },
  mergeBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
