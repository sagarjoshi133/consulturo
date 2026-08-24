/**
 * Duplicate-account merge tool — Super-Owner / Primary-Owner only.
 *
 * Calls:
 *   · GET  /api/admin/users/find-duplicates   (read-only scan)
 *   · POST /api/admin/users/merge-by-email    (merge canonical + siblings)
 *
 * Surface:
 *   1. "Scan now" — list every email with >1 user doc.
 *   2. Each card shows the email, sibling count, names from each
 *      sibling, and a "Merge" button.
 *   3. After merge, a per-collection report is shown (push_tokens,
 *      bookings, prescriptions, notes, …) so the admin can verify the
 *      merge actually re-stamped the right rows.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';

type DupRow = {
  email: string;
  count: number;
  user_ids: string[];
  names: string[];
};

type MergeReport = {
  email: string;
  canonical_user_id: string;
  sibling_user_ids: string[];
  sibling_count: number;
  collections_updated: Record<string, number | string>;
  users_deleted: number | string;
  noop?: boolean;
  message?: string;
  ok?: boolean;
};

type QuarantineRow = {
  quarantined_user_id: string;
  quarantined_name?: string;
  quarantined_role?: string;
  quarantined_created_at?: string;
  field: 'email' | 'phone';
  value: string;
  activity: Record<string, number>;
  canonical: { user_id: string; name?: string; email?: string; phone?: string; role?: string } | null;
  canonical_exists: boolean;
};

export default function DupMerge() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const toast = useToast();

  const isSuperOwner = user?.role === 'super_owner';
  const isPrimaryOwner = user?.role === 'primary_owner';
  const canMerge = isSuperOwner || isPrimaryOwner;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DupRow[]>([]);
  const [mergingEmail, setMergingEmail] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [reports, setReports] = useState<Record<string, MergeReport>>({});
  const [qrows, setQrows] = useState<QuarantineRow[]>([]);
  const [qBusyId, setQBusyId] = useState<string>('');

  const load = useCallback(async () => {
    if (!canMerge) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [dupRes, qRes] = await Promise.all([
        api.get('/admin/users/find-duplicates'),
        api.get('/admin/users/quarantined-duplicates').catch(() => ({ data: { quarantined: [] } })),
      ]);
      setRows(Array.isArray(dupRes.data?.duplicates) ? dupRes.data.duplicates : []);
      setQrows(Array.isArray(qRes.data?.quarantined) ? qRes.data.quarantined : []);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not scan for duplicates');
      setRows([]);
      setQrows([]);
    } finally {
      setLoading(false);
    }
  }, [canMerge, toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const doMerge = useCallback(async (email: string) => {
    setMergingEmail(email);
    try {
      const r = await api.post('/admin/users/merge-by-email', { email });
      const report = r.data as MergeReport;
      setReports((prev) => ({ ...prev, [email]: report }));
      toast.success(report.noop ? 'Already canonical — no-op' : `Merged ${report.sibling_count} sibling${report.sibling_count === 1 ? '' : 's'}`);
      // Re-scan so the row disappears
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Merge failed');
    } finally {
      setMergingEmail('');
    }
  }, [toast, load]);

  const resolveQuarantine = useCallback(async (row: QuarantineRow, action: 'merge' | 'restore') => {
    setQBusyId(row.quarantined_user_id);
    try {
      await api.post('/admin/users/resolve-quarantine', {
        quarantined_user_id: row.quarantined_user_id,
        action,
      });
      toast.success(action === 'merge' ? 'Merged into the live account' : 'Value restored to this account');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not resolve');
    } finally {
      setQBusyId('');
    }
  }, [toast, load]);

  const confirmResolve = (row: QuarantineRow, action: 'merge' | 'restore') => {
    const msg =
      action === 'merge'
        ? `Merge this quarantined account's data into the live account holding "${row.value}"?\n\n· Bookings, prescriptions, push tokens and notes are re-stamped onto the live account.\n· This quarantined account is then deleted.\n\nLogged in the audit trail. Cannot be undone.`
        : `Restore "${row.value}" onto this account?\n\nNo live account currently holds this value, so it can be safely given back. Logged in the audit trail.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) resolveQuarantine(row, action);
    } else {
      Alert.alert(action === 'merge' ? 'Merge quarantined account?' : 'Restore value?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: action === 'merge' ? 'Merge' : 'Restore', style: 'destructive', onPress: () => resolveQuarantine(row, action) },
      ]);
    }
  };


  const confirmMerge = (row: DupRow) => {
    const msg =
      `This will merge ${row.count} accounts sharing "${row.email}" into ONE canonical account.\n\n` +
      `· The OLDEST account becomes the canonical winner.\n` +
      `· Bookings, prescriptions, push tokens, notes, broadcasts and all related rows from the other ${row.count - 1} sibling${row.count > 2 ? 's' : ''} will be re-stamped onto the winner.\n` +
      `· The sibling user documents are deleted.\n\n` +
      `This action is logged and cannot be undone. Continue?`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doMerge(row.email);
    } else {
      Alert.alert('Merge accounts?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Merge', style: 'destructive', onPress: () => doMerge(row.email) },
      ]);
    }
  };

  const doBulkMerge = useCallback(async () => {
    setBulkBusy(true);
    setBulkProgress({ done: 0, total: rows.length });
    let okCount = 0;
    let errCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const r = await api.post('/admin/users/merge-by-email', { email: row.email });
        setReports((prev) => ({ ...prev, [row.email]: r.data as MergeReport }));
        okCount++;
      } catch {
        errCount++;
      }
      setBulkProgress({ done: i + 1, total: rows.length });
    }
    toast.success(`Bulk merge complete · ${okCount} ok · ${errCount} error${errCount === 1 ? '' : 's'}`);
    setBulkBusy(false);
    setBulkProgress(null);
    // Re-scan to show clean list
    load();
  }, [rows, toast, load]);

  const confirmBulkMerge = () => {
    if (rows.length === 0) return;
    const msg =
      `BULK MERGE — this will run merge on ALL ${rows.length} duplicate email${rows.length === 1 ? '' : 's'} sequentially.\n\n` +
      `Each merge:\n` +
      `· keeps the OLDEST account\n` +
      `· re-stamps related rows onto it\n` +
      `· deletes the sibling user docs\n\n` +
      `Every merge is logged in the audit trail. This cannot be undone. Continue?`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doBulkMerge();
    } else {
      Alert.alert('Bulk merge all duplicates?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: `Merge ${rows.length}`, style: 'destructive', onPress: doBulkMerge },
      ]);
    }
  };

  if (!canMerge) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
        <Header onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} />
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Restricted</Text>
          <Text style={styles.emptySub}>Super-Owner / Primary-Owner only.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.iconBtn} testID="dup-merge-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={styles.kicker}>SUPER OWNER · DIAGNOSTICS</Text>
            <Text style={styles.title}>Duplicate Account Merge</Text>
            <Text style={styles.sub}>Find & consolidate users sharing an email.</Text>
          </View>
          <MaterialCommunityIcons name="account-multiple-remove" size={22} color="#fff" />
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={[{ padding: 16, paddingBottom: 40 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Explainer */}
        <View style={styles.explainer}>
          <Ionicons name="information-circle" size={18} color={COLORS.primary} />
          <Text style={styles.explainerText}>
            Duplicate users happen when the same person signs in via OAuth twice (once with the dot
            in their email, once without) or when seed scripts create overlapping accounts.
            Merging re-stamps all bookings, prescriptions, push tokens and notes from the
            duplicate accounts onto the OLDEST account, then deletes the duplicates. The action
            is logged in the audit trail.
          </Text>
        </View>

        {/* Scan button + Bulk merge */}
        <View style={styles.scanRow}>
          <TouchableOpacity
            onPress={load}
            style={[styles.scanBtn, { flex: 1 }]}
            disabled={loading || refreshing || bulkBusy}
            testID="dup-merge-scan"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
            <Text style={styles.scanBtnText}>{loading ? 'Scanning…' : 'Re-scan'}</Text>
          </TouchableOpacity>
          {rows.length > 0 && (
            <TouchableOpacity
              onPress={confirmBulkMerge}
              style={[styles.bulkBtn, bulkBusy && { opacity: 0.6 }]}
              disabled={bulkBusy || loading}
              testID="dup-bulk-merge"
            >
              {bulkBusy ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="account-multiple-remove" size={16} color="#fff" />}
              <Text style={styles.bulkBtnText}>
                {bulkBusy
                  ? `Merging ${bulkProgress?.done || 0}/${bulkProgress?.total || 0}…`
                  : `Bulk merge ${rows.length}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {loading && rows.length === 0 ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
        ) : rows.length === 0 ? (
          <View style={styles.emptyCard} testID="dup-merge-empty">
            <Ionicons name="checkmark-circle" size={42} color={COLORS.success} />
            <Text style={styles.emptyCardTitle}>No duplicates found</Text>
            <Text style={styles.emptyCardSub}>Every email maps to exactly one user account. The directory is clean.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.listHdr}>
              {rows.length} email{rows.length === 1 ? '' : 's'} with duplicate accounts
            </Text>
            {rows.map((row) => {
              const report = reports[row.email];
              return (
                <View key={row.email} style={styles.card} testID={`dup-row-${row.email}`}>
                  <View style={styles.cardHead}>
                    <Ionicons name="warning" size={18} color={COLORS.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardEmail} numberOfLines={1}>{row.email}</Text>
                      <Text style={styles.cardMeta}>{row.count} accounts share this email</Text>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>×{row.count}</Text>
                    </View>
                  </View>

                  <View style={styles.namesBox}>
                    {(row.names || []).map((n, i) => (
                      <View key={i} style={styles.nameRow}>
                        <Ionicons name="person-circle" size={14} color={COLORS.textSecondary} />
                        <Text style={styles.nameText} numberOfLines={1}>{n || '(no name)'}</Text>
                        <Text style={styles.uidText} numberOfLines={1}>{(row.user_ids[i] || '').slice(0, 14)}…</Text>
                      </View>
                    ))}
                  </View>

                  {report ? (
                    <View style={styles.reportBox} testID={`dup-report-${row.email}`}>
                      <Text style={styles.reportHdr}>
                        {report.noop ? 'Already canonical' : `Merged ${report.sibling_count} sibling${report.sibling_count === 1 ? '' : 's'}`}
                      </Text>
                      {!report.noop && (
                        <>
                          <Text style={styles.reportSub}>
                            Canonical → {String(report.canonical_user_id).slice(0, 18)}…
                          </Text>
                          <View style={styles.collGrid}>
                            {Object.entries(report.collections_updated)
                              .filter(([, n]) => typeof n === 'number' && (n as number) > 0)
                              .map(([k, n]) => (
                                <View key={k} style={styles.collChip}>
                                  <Text style={styles.collChipText}>{k}: {String(n)}</Text>
                                </View>
                              ))}
                          </View>
                          <Text style={styles.reportSub}>
                            Users deleted: {String(report.users_deleted)}
                          </Text>
                        </>
                      )}
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => confirmMerge(row)}
                      style={[styles.mergeBtn, mergingEmail === row.email && styles.mergeBtnBusy]}
                      disabled={mergingEmail === row.email}
                      testID={`dup-merge-btn-${row.email}`}
                    >
                      {mergingEmail === row.email ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <MaterialCommunityIcons name="account-multiple-remove" size={16} color="#fff" />
                      )}
                      <Text style={styles.mergeBtnText}>
                        {mergingEmail === row.email ? 'Merging…' : 'Merge into oldest account'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* ── Quarantined duplicates ── */}
        <View style={styles.qSectionHead}>
          <MaterialCommunityIcons name="shield-alert-outline" size={16} color={COLORS.warning} />
          <Text style={styles.qSectionTitle}>Quarantined email / phone</Text>
        </View>
        <Text style={styles.qExplainer}>
          When two accounts shared an email or phone, the newer one&apos;s value was
          auto-quarantined so the unique index could build (no data was deleted).
          Merge it into the live account, or restore the value if the live account
          no longer uses it.
        </Text>

        {qrows.length === 0 ? (
          <View style={styles.qEmpty} testID="quarantine-empty">
            <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            <Text style={styles.qEmptyText}>No quarantined values — nothing to review.</Text>
          </View>
        ) : (
          qrows.map((q) => {
            const busy = qBusyId === q.quarantined_user_id;
            const act = q.activity || {};
            return (
              <View key={q.quarantined_user_id} style={styles.qCard} testID={`quarantine-row-${q.quarantined_user_id}`}>
                <View style={styles.cardHead}>
                  <MaterialCommunityIcons name={q.field === 'email' ? 'email-alert-outline' : 'phone-alert-outline'} size={18} color={COLORS.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardEmail} numberOfLines={1}>{q.value}</Text>
                    <Text style={styles.cardMeta}>
                      Quarantined {q.field} · {q.quarantined_name || '(no name)'} · {(q.quarantined_role || 'patient')}
                    </Text>
                  </View>
                  <View style={styles.qBadge}>
                    <Text style={styles.qBadgeText}>{q.field.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.namesBox}>
                  <View style={styles.nameRow}>
                    <Ionicons name="person-remove" size={14} color={COLORS.warning} />
                    <Text style={styles.nameText} numberOfLines={1}>Quarantined acct</Text>
                    <Text style={styles.uidText} numberOfLines={1}>{(q.quarantined_user_id || '').slice(0, 14)}…</Text>
                  </View>
                  <View style={styles.nameRow}>
                    <Ionicons name="stats-chart" size={13} color={COLORS.textSecondary} />
                    <Text style={styles.nameText} numberOfLines={1}>
                      {`bookings ${act.bookings || 0} · rx ${act.prescriptions || 0} · tokens ${act.push_tokens || 0} · notes ${act.notes || 0}`}
                    </Text>
                  </View>
                  {q.canonical ? (
                    <View style={styles.nameRow}>
                      <Ionicons name="person-circle" size={14} color={COLORS.success} />
                      <Text style={styles.nameText} numberOfLines={1}>Live: {q.canonical.name || '(no name)'}</Text>
                      <Text style={styles.uidText} numberOfLines={1}>{(q.canonical.user_id || '').slice(0, 14)}…</Text>
                    </View>
                  ) : (
                    <View style={styles.nameRow}>
                      <Ionicons name="alert-circle" size={14} color={COLORS.textDisabled} />
                      <Text style={styles.nameText} numberOfLines={1}>No live account holds this value</Text>
                    </View>
                  )}
                </View>

                {q.canonical_exists ? (
                  <TouchableOpacity
                    onPress={() => confirmResolve(q, 'merge')}
                    style={[styles.mergeBtn, busy && styles.mergeBtnBusy]}
                    disabled={busy}
                    testID={`quarantine-merge-${q.quarantined_user_id}`}
                  >
                    {busy ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="account-multiple-check" size={16} color="#fff" />}
                    <Text style={styles.mergeBtnText}>{busy ? 'Working…' : 'Merge into live account'}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={() => confirmResolve(q, 'restore')}
                    style={[styles.restoreBtn, busy && styles.mergeBtnBusy]}
                    disabled={busy}
                    testID={`quarantine-restore-${q.quarantined_user_id}`}
                  >
                    {busy ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="restore" size={16} color="#fff" />}
                    <Text style={styles.mergeBtnText}>{busy ? 'Working…' : 'Restore value to this account'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }]}>
      <View style={styles.headRow}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Duplicate Account Merge</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  kicker: { ...FONTS.label, color: 'rgba(255,255,255,0.8)', letterSpacing: 1, fontSize: 10 },
  title: { ...FONTS.h2, color: '#fff', marginTop: 2 },
  sub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', marginTop: 2, fontSize: 12 },

  explainer: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: COLORS.primary + '0E', padding: 12, borderRadius: RADIUS.md, marginBottom: 14 },
  explainerText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17, flex: 1 },

  scanRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  scanBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  bulkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.accent, borderRadius: RADIUS.pill },
  bulkBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },

  emptyCard: { alignItems: 'center', padding: 30, backgroundColor: COLORS.success + '08', borderColor: COLORS.success + '30', borderWidth: 1, borderRadius: RADIUS.lg, marginTop: 8 },
  emptyCardTitle: { ...FONTS.h3, color: COLORS.success, marginTop: 12 },
  emptyCardSub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, fontSize: 12, textAlign: 'center' },

  listHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginBottom: 10, fontSize: 11 },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardEmail: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  cardMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  countBadge: { backgroundColor: COLORS.warning + '14', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  countBadgeText: { ...FONTS.label, color: COLORS.warning, fontSize: 11 },

  namesBox: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, padding: 8, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  nameText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1 },
  uidText: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 10, fontFamily: 'monospace' },

  mergeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, backgroundColor: COLORS.accent, borderRadius: RADIUS.pill },
  mergeBtnBusy: { opacity: 0.65 },
  mergeBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  reportBox: { padding: 10, backgroundColor: COLORS.success + '08', borderColor: COLORS.success + '30', borderWidth: 1, borderRadius: RADIUS.md },
  reportHdr: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 13, marginBottom: 4 },
  reportSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  collGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  collChip: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  collChipText: { ...FONTS.label, color: COLORS.textPrimary, fontSize: 10 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h2, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6 },

  qSectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 6 },
  qSectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 15 },
  qExplainer: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  qEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, backgroundColor: COLORS.success + '08', borderColor: COLORS.success + '30', borderWidth: 1, borderRadius: RADIUS.md },
  qEmptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, flex: 1 },
  qCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.warning + '40', marginBottom: 12 },
  qBadge: { backgroundColor: COLORS.warning + '14', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  qBadgeText: { ...FONTS.label, color: COLORS.warning, fontSize: 10 },
  restoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
});
