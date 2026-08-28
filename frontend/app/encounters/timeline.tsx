/**
 * Patient Timeline — a patient's full visit + billing history on one screen.
 * Reception opens this from any encounter to trace past visits and payments.
 */
import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';

type Visit = {
  encounter_id: string;
  patient_name?: string;
  chief_complaint?: string;
  stage?: string;
  payment_status?: string;
  fee_amount?: number;
  prescription_id?: string;
  booking_date?: string;
  booking_time?: string;
  created_at?: string;
};
type Receipt = {
  receipt_id?: string;
  receipt_no?: string;
  total?: number;
  paid?: number;
  balance?: number;
  mode?: string;
  receipt_date?: string;
  encounter_id?: string;
};

const PAY: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: '#B45309', bg: '#FEF3C7' },
  paid: { label: 'Paid', color: '#047857', bg: '#D1FAE5' },
  waived: { label: 'Waived', color: '#64748B', bg: '#F1F5F9' },
};
const STAGE: Record<string, string> = { open: 'Open', in_consultation: 'In consult', completed: 'Completed', to_start: 'To start' };

function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PatientTimelineScreen() {
  const router = useRouter();
  const { phone, name } = useLocalSearchParams<{ phone?: string; name?: string }>();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/encounters/patient-timeline', { params: { phone: phone || '' } });
      setVisits(data?.visits || []);
      setReceipts(data?.receipts || []);
    } catch {
      setVisits([]); setReceipts([]);
    } finally { setLoading(false); setRefreshing(false); }
  }, [phone]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const money = (n?: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const totalPaid = receipts.reduce((s, r) => s + Number(r.paid || 0), 0);
  const totalDue = receipts.reduce((s, r) => s + Number(r.balance || 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn} testID="tl-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{name || 'Patient'}</Text>
          {!!phone && <Text style={styles.sub}>{phone}</Text>}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
        >
          <View style={styles.summaryRow}>
            <View style={styles.sumCard}><Text style={styles.sumVal}>{visits.length}</Text><Text style={styles.sumLabel}>Visits</Text></View>
            <View style={styles.sumCard}><Text style={[styles.sumVal, { color: '#047857' }]}>{money(totalPaid)}</Text><Text style={styles.sumLabel}>Paid</Text></View>
            <View style={styles.sumCard}><Text style={[styles.sumVal, { color: '#B45309' }]}>{money(totalDue)}</Text><Text style={styles.sumLabel}>Due</Text></View>
          </View>

          <Text style={styles.sectionTitle}>Visits ({visits.length})</Text>
          {visits.length === 0 ? (
            <Text style={styles.emptyText}>No visits recorded.</Text>
          ) : visits.map((v) => {
            const pm = v.payment_status ? PAY[v.payment_status] : null;
            return (
              <TouchableOpacity key={v.encounter_id} style={styles.card} onPress={() => router.push(`/encounters/${v.encounter_id}` as any)} testID={`tl-visit-${v.encounter_id}`}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardDate}>{fmtDate(v.booking_date || v.created_at)}{v.booking_time ? ` · ${v.booking_time}` : ''}</Text>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                </View>
                {!!v.chief_complaint && <Text style={styles.cardComplaint} numberOfLines={2}>{v.chief_complaint}</Text>}
                <View style={styles.chipRow}>
                  {!!STAGE[v.stage || ''] && <View style={styles.stageChip}><Text style={styles.stageChipText}>{STAGE[v.stage || '']}</Text></View>}
                  {!!pm && <View style={[styles.payChip, { backgroundColor: pm.bg }]}><Text style={[styles.payChipText, { color: pm.color }]}>{pm.label}{v.fee_amount ? ` ₹${v.fee_amount}` : ''}</Text></View>}
                  {!!v.prescription_id && <View style={styles.rxChip}><Ionicons name="document-text" size={11} color={COLORS.success} /><Text style={styles.rxChipText}>Rx</Text></View>}
                </View>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.sectionTitle}>Receipts ({receipts.length})</Text>
          {receipts.length === 0 ? (
            <Text style={styles.emptyText}>No receipts yet.</Text>
          ) : receipts.map((r) => (
            <TouchableOpacity key={r.receipt_id} style={styles.rcpt} onPress={() => r.receipt_id && router.push(`/billing/${r.receipt_id}` as any)} testID={`tl-rcpt-${r.receipt_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rcptNo}>{r.receipt_no || r.receipt_id}</Text>
                <Text style={styles.rcptMeta}>{fmtDate(r.receipt_date)}{r.mode ? ` · ${r.mode}` : ''}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rcptPaid}>{money(r.paid)}</Text>
                {Number(r.balance || 0) > 0 && <Text style={styles.rcptBal}>Due {money(r.balance)}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  title: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  sub: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  sumCard: { flex: 1, minWidth: 0, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 12, alignItems: 'center', gap: 2 },
  sumVal: { ...FONTS.h2, fontSize: 16, color: COLORS.textPrimary },
  sumLabel: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary },
  sectionTitle: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary, marginTop: 20, marginBottom: 8 },
  emptyText: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, paddingVertical: 12 },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardDate: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary },
  cardComplaint: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stageChip: { backgroundColor: COLORS.bg, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: COLORS.border },
  stageChipText: { ...FONTS.bodyMedium, fontSize: 10.5, color: COLORS.textSecondary },
  payChip: { borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 3 },
  payChipText: { ...FONTS.bodyMedium, fontSize: 10.5 },
  rxChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: COLORS.success + '14', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 },
  rxChipText: { ...FONTS.bodyMedium, fontSize: 10.5, color: COLORS.success },
  rcpt: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginBottom: 8 },
  rcptNo: { ...FONTS.bodyMedium, fontSize: 13, color: COLORS.textPrimary },
  rcptMeta: { ...FONTS.body, fontSize: 11.5, color: COLORS.textSecondary },
  rcptPaid: { ...FONTS.bodyMedium, fontSize: 14, color: '#047857' },
  rcptBal: { ...FONTS.body, fontSize: 11, color: '#B45309' },
});
