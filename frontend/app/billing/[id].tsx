/**
 * Receipt detail — Phase 3.8.
 *
 * Read-only display of a single receipt with print / share / PDF
 * actions, and an owner-only delete.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { Receipt, shareReceiptPdf, downloadReceiptPdf, ReceiptSize } from '../../src/receipt-pdf';
import { displayDate } from '../../src/date';

function fmtINR(n: any) {
  return '₹ ' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SIZE_STORAGE_KEY = 'receipt_size_pref';

export default function ReceiptDetail() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const isOwner = !!user && ['super_owner', 'primary_owner', 'partner', 'owner'].includes(user.role as string);

  const [r, setR] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [size, setSize] = useState<ReceiptSize>('A4');

  // Persist last-used size across sessions so the user's preference sticks.
  React.useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(SIZE_STORAGE_KEY);
        if (stored === 'A4' || stored === 'A5') setSize(stored);
      } catch {}
    })();
  }, []);

  const updateSize = useCallback((s: ReceiptSize) => {
    setSize(s);
    AsyncStorage.setItem(SIZE_STORAGE_KEY, s).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/receipts/${id}`);
      setR(res.data);
    } catch {
      setR(null);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onPdf = async () => {
    if (!r) return; setBusy('pdf');
    try { await downloadReceiptPdf(r, size); } catch (e: any) { toast.error('PDF failed'); }
    setBusy('');
  };
  const onShare = async () => {
    if (!r) return; setBusy('share');
    try { await shareReceiptPdf(r, size); } catch (e: any) { toast.error('Share failed'); }
    setBusy('');
  };
  const onDelete = () => {
    if (!r) return;
    const doDelete = async () => {
      setBusy('delete');
      try {
        await api.delete(`/receipts/${r.receipt_id}`);
        toast.success('Receipt deleted');
        (router.canGoBack() ? router.back() : router.replace('/' as any));
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Could not delete');
      } finally {
        setBusy('');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this receipt permanently?')) doDelete();
    } else {
      Alert.alert('Delete receipt?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }
  if (!r) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Receipt</Text>
        </View>
        <View style={{ padding: 40, alignItems: 'center' }}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textDisabled} />
          <Text style={[styles.title, { marginTop: 14 }]}>Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="rc-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>Receipt</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 110 }}>
        {/* Header card */}
        <View style={styles.headCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.rcBadge}>
              <Ionicons name="receipt" size={20} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rcNo}>{r.receipt_no}</Text>
              <Text style={styles.rcMeta}>{displayDate(r.receipt_date || '')}</Text>
            </View>
            <View style={[styles.modePill, { backgroundColor: COLORS.primary + '15' }]}>
              <Text style={[styles.modePillText, { color: COLORS.primary }]}>{r.mode}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <Text style={styles.patientName}>{r.patient_name || 'Walk-in patient'}</Text>
          <Text style={styles.patientMeta}>
            {r.patient_phone ? r.patient_phone : ''}
            {r.registration_no ? ` · Reg. ${r.registration_no}` : ''}
          </Text>
        </View>

        {/* Items */}
        <Text style={styles.sectionHdr}>Items</Text>
        <View style={styles.itemsCard}>
          {(r.items || []).map((it, i) => (
            <View key={i} style={[styles.itemRow, i > 0 && { borderTopWidth: 1, borderTopColor: COLORS.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemDesc}>{it.description}</Text>
                <Text style={styles.itemMeta}>
                  {it.service_type ? `${it.service_type} · ` : ''}
                  {Number(it.qty || 1)} × {fmtINR(it.amount)}
                </Text>
              </View>
              <Text style={styles.itemAmt}>{fmtINR(it.line_total)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsCard}>
          <Row k="Subtotal" v={fmtINR(r.subtotal)} />
          {(r.discount || 0) > 0 ? <Row k="Discount" v={`− ${fmtINR(r.discount)}`} /> : null}
          {r.gst_enabled && (r.gst_amount || 0) > 0 ? <Row k={`GST ${r.gst_pct}%`} v={fmtINR(r.gst_amount)} /> : null}
          <View style={styles.divider} />
          <Row k="Total" v={fmtINR(r.total)} big />
          <Row k={`Paid (${r.mode})`} v={fmtINR(r.paid)} ok />
          {(r.balance || 0) > 0 ? <Row k="Balance" v={fmtINR(r.balance)} bad /> : null}
        </View>

        {r.payment_ref ? (
          <View style={styles.refCard}>
            <Ionicons name="key-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.refText}>Reference: {r.payment_ref}</Text>
          </View>
        ) : null}

        {r.notes ? (
          <View style={styles.notesCard}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={COLORS.primary} />
            <Text style={styles.notesText}>{r.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.audit}>Created by {r.created_by_name || 'staff'}</Text>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 8) + 6 }]}>
        {/* Size toggle pill (A4 / A5) */}
        <View style={styles.sizeToggle}>
          <TouchableOpacity
            onPress={() => updateSize('A4')}
            style={[styles.sizePill, size === 'A4' && styles.sizePillActive]}
            testID="rc-size-a4"
          >
            <Text style={[styles.sizePillText, size === 'A4' && { color: '#fff' }]}>A4</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => updateSize('A5')}
            style={[styles.sizePill, size === 'A5' && styles.sizePillActive]}
            testID="rc-size-a5"
          >
            <Text style={[styles.sizePillText, size === 'A5' && { color: '#fff' }]}>A5</Text>
          </TouchableOpacity>
        </View>

        <ActionBtn icon="download-outline" label="Download PDF" onPress={onPdf} loading={busy === 'pdf'} testID="rc-pdf" />
        <ActionBtn icon="share-social-outline" label="Share PDF" onPress={onShare} loading={busy === 'share'} testID="rc-share" />
        {isOwner && (
          <ActionBtn icon="trash-outline" label="Delete" color={COLORS.accent} onPress={onDelete} loading={busy === 'delete'} testID="rc-delete" />
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ k, v, big, ok, bad }: { k: string; v: string; big?: boolean; ok?: boolean; bad?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowK, big && { fontSize: 14, color: COLORS.textPrimary }]}>{k}</Text>
      <Text style={[styles.rowV, big && { fontSize: 18, color: COLORS.primary, fontWeight: '700' }, ok && { color: COLORS.success }, bad && { color: COLORS.accent }]}>{v}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, loading, color, testID }: any) {
  const c = color || COLORS.primary;
  return (
    <TouchableOpacity onPress={onPress} style={styles.actionBtn} disabled={loading} testID={testID}>
      {loading ? <ActivityIndicator color={c} /> : <Ionicons name={icon} size={20} color={c} />}
      <Text style={[styles.actionBtnText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },

  headCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  rcBadge: { width: 42, height: 42, borderRadius: 12, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center' },
  rcNo: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  rcMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  modePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  modePillText: { ...FONTS.label, fontSize: 11 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  patientName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  patientMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 3 },

  sectionHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginBottom: 8, fontSize: 11 },
  itemsCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  itemDesc: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  itemMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  itemAmt: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },

  totalsCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14, borderWidth: 1, borderColor: COLORS.primary, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowK: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  rowV: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },

  refCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  refText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  notesCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, backgroundColor: COLORS.primary + '0A', borderRadius: RADIUS.md, marginBottom: 10 },
  notesText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1, lineHeight: 17 },
  audit: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 10, textAlign: 'center', marginTop: 20 },

  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 10, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: '#fff' },
  actionBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 2 },
  actionBtnText: { ...FONTS.bodyMedium, fontSize: 11 },

  sizeToggle: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 6,
    gap: 2,
  },
  sizePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 30,
  },
  sizePillActive: { backgroundColor: COLORS.primary },
  sizePillText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 10, letterSpacing: 0.4 },
});
