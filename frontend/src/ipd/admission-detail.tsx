/**
 * AdmissionDetail — the drawer-style modal contents for a single
 * admission. Renders:
 *   • Hero with patient chips (Age · Sex, Ward · Bed, Day N, Status)
 *   • Quick Actions menu (Consent, Surgery, Med Cert, Transfer)
 *   • Tab bar (Overview, Rounds, Vitals, Meds, Consents, Discharge)
 *   • Active tab content (delegated to per-tab components)
 *   • Bed Transfer modal
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import api from '../api';
import { COLORS } from '../theme';
import { useToast } from '../toast';
import { ipdStyles as styles } from './styles';
import { ActionRow } from './components';
import TransferModal from './transfer-modal';
import OverviewTab from './tabs/overview-tab';
import RoundsTab from './tabs/rounds-tab';
import VitalsTab from './tabs/vitals-tab';
import MedsTab from './tabs/meds-tab';
import ConsentsTab from './tabs/consents-tab';
import DischargeTab from './tabs/discharge-tab';
import type { TabKey } from './types';

const TABS: Array<{ key: TabKey; icon: any; label: string }> = [
  { key: 'overview', icon: 'person-circle-outline', label: 'Overview' },
  { key: 'rounds', icon: 'document-text-outline', label: 'Rounds' },
  { key: 'vitals', icon: 'pulse-outline', label: 'Vitals' },
  { key: 'meds', icon: 'medkit-outline', label: 'Meds' },
  { key: 'consents', icon: 'shield-checkmark-outline', label: 'Consents' },
  { key: 'discharge', icon: 'log-out-outline', label: 'Discharge' },
];

export default function AdmissionDetail({
  admissionId, onClose,
}: {
  admissionId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  // Safe-area insets — this component renders inside a full-screen
  // <Modal>, which draws edge-to-edge under the status bar AND the
  // Android navigation buttons. Pad the hero + scroll content so no
  // UI ever hides behind system chrome (recurring user complaint).
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [consents, setConsents] = useState<any[]>([]);
  const [meds, setMeds] = useState<any[]>([]);
  const [bedTransfers, setBedTransfers] = useState<any[]>([]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/ipd/admissions/${admissionId}`);
      setData(r.data);
      try {
        const cr = await api.get('/surgical-consents', { params: { admission_id: admissionId, limit: 50 } });
        setConsents((cr.data?.items || []) as any[]);
      } catch { setConsents([]); }
      try {
        const mr = await api.get(`/ipd/admissions/${admissionId}/drugs`);
        setMeds((mr.data?.items || []) as any[]);
      } catch { setMeds([]); }
      try {
        const tr = await api.get(`/ipd/admissions/${admissionId}/bed-transfers`);
        setBedTransfers((tr.data?.items || []) as any[]);
      } catch { setBedTransfers([]); }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load admission.');
    } finally {
      setLoading(false);
    }
  }, [admissionId, toast]);

  useEffect(() => { void load(); }, [load]);

  if (loading || !data?.admission) {
    return (
      <View style={[styles.center, { flex: 1 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const a = data.admission;
  const isDischarged = a.status === 'discharged';

  // Length of stay in days. For active patients, count from admitted_at
  // to today. For discharged, count up to the discharge timestamp.
  let losDays = 0;
  try {
    const start = a.admitted_at ? new Date(a.admitted_at) : null;
    const end = isDischarged && a.discharged_at ? new Date(a.discharged_at) : new Date();
    if (start && !isNaN(start.getTime())) {
      losDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
    }
  } catch { losDays = 0; }

  const navigateWithCtx = (path: string) => {
    const p = new URLSearchParams();
    p.set('admission_id', admissionId);
    if (a.patient_name) p.set('patient_name', a.patient_name);
    if (a.patient_phone) p.set('patient_phone', a.patient_phone);
    if (a.patient_age) p.set('patient_age', String(a.patient_age));
    if (a.patient_sex) p.set('patient_sex', a.patient_sex);
    if (a.patient_email) p.set('patient_email', a.patient_email);
    if (a.diagnosis) p.set('diagnosis', a.diagnosis);
    if (a.planned_procedure) p.set('procedure', a.planned_procedure);
    onClose();
    // 60ms gap lets the modal dismissal animation finish before
    // expo-router pushes the new route.
    setTimeout(() => router.push(`${path}?${p.toString()}` as any), 60);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={[styles.detailHero, { paddingTop: insets.top }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalClose}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={[styles.modalTitle, { color: '#fff' }]}>{a.ipd_no}</Text>
          {!isDischarged ? (
            <TouchableOpacity
              onPress={() => setActionsOpen((v) => !v)}
              style={styles.modalClose}
              accessibilityLabel="Actions"
              testID="ipd-detail-actions"
            >
              <Ionicons name="add-circle" size={26} color="#fff" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 36 }} />
          )}
        </View>
        <Text style={styles.detailHeroTitle}>{a.patient_name}</Text>
        <View style={styles.detailHeroMetaRow}>
          {a.patient_age ? (
            <View style={styles.detailHeroChip}>
              <Ionicons name="person-outline" size={11} color="#fff" />
              <Text style={styles.detailHeroChipText}>{a.patient_age} y{a.patient_sex ? ` · ${a.patient_sex}` : ''}</Text>
            </View>
          ) : null}
          <View style={styles.detailHeroChip}>
            <MaterialCommunityIcons name="bed" size={12} color="#fff" />
            <Text style={styles.detailHeroChipText}>
              {a.ward || 'General'}{a.bed_id ? ` · ${a.bed_id}` : ''}
            </Text>
          </View>
          {losDays > 0 ? (
            <View style={styles.detailHeroChip}>
              <Ionicons name="time-outline" size={12} color="#fff" />
              <Text style={styles.detailHeroChipText}>Day {losDays}</Text>
            </View>
          ) : null}
          <View style={[styles.detailHeroChip, isDischarged ? styles.detailHeroChipDischarged : styles.detailHeroChipActive]}>
            <Ionicons name={isDischarged ? 'checkmark-done-circle' : 'pulse'} size={12} color="#fff" />
            <Text style={[styles.detailHeroChipText, { fontWeight: '800' }]}>{a.status.toUpperCase()}</Text>
          </View>
        </View>
        {a.diagnosis ? (
          <Text style={styles.detailHeroDx} numberOfLines={2}>
            <Text style={{ opacity: 0.85 }}>Dx:</Text> {a.diagnosis}
          </Text>
        ) : null}
      </LinearGradient>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, alignItems: 'center' }}
        style={styles.tabBar}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          let badge = 0;
          if (t.key === 'consents') badge = consents.length;
          if (t.key === 'meds') badge = meds.filter((m: any) => m.status !== 'stopped').length;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
              testID={`ipd-detail-tab-${t.key}`}
              activeOpacity={0.85}
            >
              <Ionicons name={t.icon} size={15} color={active ? '#fff' : COLORS.primary} />
              <Text style={[styles.tabBtnText, active && { color: '#fff' }]}>{t.label}</Text>
              {badge > 0 ? (
                <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, active && { color: COLORS.primary }]}>{badge}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Active tab content */}
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
      >
        {tab === 'overview' ? (
          <OverviewTab
            admission={a}
            admissionId={admissionId}
            isDischarged={isDischarged}
            bedTransfers={bedTransfers}
          />
        ) : null}
        {tab === 'rounds' ? (
          <RoundsTab
            admissionId={admissionId}
            isDischarged={isDischarged}
            data={data}
            busy={busy}
            setBusy={setBusy}
            load={load}
          />
        ) : null}
        {tab === 'vitals' ? (
          <VitalsTab
            admissionId={admissionId}
            isDischarged={isDischarged}
            data={data}
            busy={busy}
            setBusy={setBusy}
            load={load}
          />
        ) : null}
        {tab === 'meds' ? (
          <MedsTab
            admissionId={admissionId}
            isDischarged={isDischarged}
            meds={meds}
            busy={busy}
            setBusy={setBusy}
            load={load}
          />
        ) : null}
        {tab === 'consents' ? (
          <ConsentsTab
            admission={a}
            admissionId={admissionId}
            isDischarged={isDischarged}
            consents={consents}
            setConsents={setConsents}
            onClose={onClose}
          />
        ) : null}
        {tab === 'discharge' ? (
          <DischargeTab
            admission={a}
            admissionId={admissionId}
            isDischarged={isDischarged}
            busy={busy}
            setBusy={setBusy}
            onClose={onClose}
          />
        ) : null}
      </KeyboardAwareScrollView>

      {/* Floating action menu overlay (rendered last so it sits on top) */}
      {actionsOpen && !isDischarged ? (
        <>
          <TouchableOpacity
            style={styles.actionsBackdrop}
            activeOpacity={1}
            onPress={() => setActionsOpen(false)}
            testID="ipd-actions-backdrop"
          />
          <View style={[styles.actionsMenuFloat, { top: 52 + insets.top }]}>
            <ActionRow
              icon="document-text"
              color="#0E7C8B"
              label="Take Consent"
              sub="Sign procedure consent for this admission"
              onPress={() => { setActionsOpen(false); navigateWithCtx('/consents/new'); }}
              testID="ipd-action-consent"
            />
            <ActionRow
              icon="medkit"
              color="#7C3AED"
              label="Schedule Surgery"
              sub="Book an OT slot for this admission"
              onPress={() => { setActionsOpen(false); navigateWithCtx('/ot-calendar/schedule'); }}
              testID="ipd-action-surgery"
            />
            <ActionRow
              icon="ribbon"
              color="#16A34A"
              label="Issue Medical Certificate"
              sub="Generate fitness / sick / surgery certificate"
              onPress={() => { setActionsOpen(false); navigateWithCtx('/medical-certificates'); }}
              testID="ipd-action-medcert"
            />
            <ActionRow
              icon="swap-horizontal"
              color="#F59E0B"
              label="Transfer Bed / Ward"
              sub={`Currently ${a.ward || 'General'}${a.bed_id ? ' · ' + a.bed_id : ''}`}
              onPress={() => { setActionsOpen(false); setTransferOpen(true); }}
              testID="ipd-action-transfer"
            />
          </View>
        </>
      ) : null}

      <TransferModal
        visible={transferOpen}
        admission={a}
        admissionId={admissionId}
        onClose={() => setTransferOpen(false)}
        onTransferred={load}
      />
    </View>
  );
}
