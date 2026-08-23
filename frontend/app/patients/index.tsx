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

type Tab = 'unregistered' | 'registered' | 'all';

const TAB_ORDER: Tab[] = ['unregistered', 'registered', 'all'];
const TAB_LABEL: Record<Tab, string> = {
  unregistered: 'Unregistered',
  registered:   'Registered',
  all:          'All patients',
};

export default function UnregisteredPatientsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('unregistered');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<{
    total: number; registered: number; unregistered: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setErr(null);
    try {
      const [listRes, summaryRes] = await Promise.all([
        api.get('/registry/patients', {
          params: { q: q.trim(), limit: 100, registration_status: tab },
        }),
        api.get('/registry/patients/summary').catch(() => ({ data: null })),
      ]);
      setItems(Array.isArray(listRes?.data?.items) ? listRes.data.items : []);
      if (summaryRes?.data) setSummary(summaryRes.data);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (typeof d === 'object' ? d?.detail || d?.message : null)
          || e?.message || 'Load failed';
      setErr(msg);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => {
    // Debounce search-query changes.
    const t = setTimeout(() => { load(); }, q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q]);

  const badge = (t: Tab): number | null => {
    if (!summary) return null;
    if (t === 'unregistered') return summary.unregistered;
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
          ? { ...x, invited_at: r.data.invited_at, invite_count: (x.invite_count || 0) + 1 }
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

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Patients</Text>
        <View style={{ width: 32 }} />
      </View>

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
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
                onPress={() => router.push(`/dashboard?tab=consultations` as any)}
              >
                <View style={styles.avatar}>
                  <Ionicons
                    name={tab === 'unregistered' ? 'person-add' : 'person'}
                    size={20}
                    color={COLORS.primary}
                  />
                </View>
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
                    {(item.invite_count || 0) > 0 ? (
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
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, marginLeft: 52 }}>
                {tab === 'unregistered' ? (
                  <Pressable
                    onPress={() => openInvite(item)}
                    style={styles.actionBtn}
                    hitSlop={4}
                  >
                    <Ionicons name="paper-plane-outline" size={13} color={COLORS.primary} />
                    <Text style={styles.actionBtnTxt}>Invite</Text>
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
            </View>
          )}
        />
      )}

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
