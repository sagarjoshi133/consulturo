/**
 * Patient detail page — opens when a row is tapped from the
 * Patients tab. Shows the full patient profile + consultation
 * history (bookings, prescriptions, surgeries) and offers Call /
 * WhatsApp / Book Appointment action buttons (Dr. Joshi spec
 * 2026-05-21 item 5).
 *
 * Data: GET /api/patient-db/by-phone/{phone}
 *
 * Permission: same gate as the list — owner / partner always; staff
 * needs `tier.canAccessPatientDb`.
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
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useTier } from '../../src/tier';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { goBackSafe } from '../../src/nav';
import { PatientGistBanner } from '../../src/patient-gist-banner';

type Profile = {
  reg_no?: string;
  name?: string;
  phone?: string;
  email?: string;
  age?: number;
  gender?: string;
  address?: string;
  first_seen_at?: string;
};

type Booking = {
  id?: string;
  booking_date?: string;
  start_time?: string;
  slot?: string;
  status?: string;
  reason?: string;
  mode?: string;
};

type Rx = {
  prescription_id?: string;
  created_at?: string;
  finalised_at?: string;
  diagnosis?: string;
  status?: string;
};

type Surgery = {
  id?: string;
  date?: string;
  procedure?: string;
  notes?: string;
};

type DetailResponse = {
  profile: Profile;
  bookings: Booking[];
  prescriptions: Rx[];
  surgeries: Surgery[];
  counts: { bookings: number; prescriptions: number; surgeries: number };
};

export default function PatientDetail() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { user } = useAuth();
  const tier = useTier();

  const isOwner =
    user?.role === 'super_owner' ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner';
  const canAccess = isOwner || !!tier?.canAccessPatientDb;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [calcScores, setCalcScores] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [discharges, setDischarges] = useState<any[]>([]);
  const [medCerts, setMedCerts] = useState<any[]>([]);
  const [encounters, setEncounters] = useState<any[]>([]);
  // Per-section collapse state — patient detail pages can get long;
  // collapsing sections lets the doctor jump to the one they need.
  // Defaults: Consultations + Prescriptions open, everything else
  // collapsed (matches the most-used drill-down path).
  const [open, setOpen] = useState<Record<string, boolean>>({
    consultations: true,
    prescriptions: true,
    encounters: true,
    surgeries: false,
    discharges: false,
    certs: false,
    receipts: false,
    scores: false,
  });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    if (!phone) {
      setError('Missing phone parameter');
      setLoading(false);
      return;
    }
    try {
      const r = await api.get<DetailResponse>(`/patient-db/by-phone/${encodeURIComponent(String(phone))}`);
      setData(r.data);
      setError('');
      // Calculator scores tied to this patient (best-effort, non-blocking)
      try {
        const s = await api.get(`/tools/scores/by-patient/${encodeURIComponent(String(phone))}`);
        setCalcScores(Array.isArray(s.data) ? s.data : []);
      } catch {
        setCalcScores([]);
      }
      // Receipts tied to this patient (best-effort, non-blocking)
      try {
        const rcRes = await api.get(`/receipts/by-patient/${encodeURIComponent(String(phone))}`);
        setReceipts(Array.isArray(rcRes.data) ? rcRes.data : []);
      } catch {
        setReceipts([]);
      }
      // Discharge summaries tied to this patient (best-effort)
      try {
        const dsRes = await api.get('/discharge-summaries', {
          params: { patient_phone: String(phone) },
        });
        setDischarges(Array.isArray(dsRes.data?.items) ? dsRes.data.items : []);
      } catch {
        setDischarges([]);
      }
      // Medical certificates tied to this patient (best-effort)
      try {
        const mcRes = await api.get('/medical-certificates', {
          params: { patient_phone: String(phone) },
        });
        setMedCerts(Array.isArray(mcRes.data?.items) ? mcRes.data.items : []);
      } catch {
        setMedCerts([]);
      }
      // Clinical encounters (visit notes) for this patient — staff-only.
      try {
        const encRes = await api.get('/encounters', { params: { patient_phone: String(phone), limit: 50 } });
        setEncounters(Array.isArray(encRes.data?.items) ? encRes.data.items : []);
      } catch {
        setEncounters([]);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load patient');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [phone, canAccess]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const profile = data?.profile;
  const phoneNumber = profile?.phone || (phone || '').toString();

  const onCall = useCallback(() => {
    if (!phoneNumber) return;
    const e164 = phoneNumber.length === 10 ? `+91${phoneNumber}` : phoneNumber;
    Linking.openURL(`tel:${e164}`).catch(() =>
      Alert.alert('Unable to start call', 'Phone dialer not available on this device.')
    );
  }, [phoneNumber]);

  const onWhatsApp = useCallback(() => {
    if (!phoneNumber) return;
    const digits = phoneNumber.replace(/\D/g, '');
    const e164digits = digits.length === 10 ? `91${digits}` : digits;
    const url = `https://wa.me/${e164digits}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('WhatsApp unavailable', 'Install WhatsApp to message this patient.')
    );
  }, [phoneNumber]);

  const onBook = useCallback(() => {
    const params = new URLSearchParams();
    if (profile?.phone) params.set('phone', profile.phone);
    if (profile?.name) params.set('name', profile.name);
    if (profile?.email) params.set('email', profile.email);
    router.push(`/(tabs)/book?${params.toString()}` as any);
  }, [profile, router]);

  const onScheduleOT = useCallback(() => {
    const p = new URLSearchParams();
    if (profile?.phone) p.set('patient_phone', profile.phone);
    if (profile?.name) p.set('patient_name', profile.name);
    if (profile?.age) p.set('patient_age', String(profile.age));
    if (profile?.gender) p.set('patient_sex', profile.gender);
    router.push(`/ot-calendar/schedule?${p.toString()}` as any);
  }, [profile, router]);

  const onRunCalculator = useCallback(() => {
    const p = new URLSearchParams();
    if (profile?.phone) p.set('patient_phone', profile.phone);
    if (profile?.name) p.set('patient_name', profile.name);
    router.push(`/(tabs)/tools?${p.toString()}` as any);
  }, [profile, router]);

  const onRecordPayment = useCallback(() => {
    const p = new URLSearchParams();
    if (profile?.phone) p.set('patient_phone', profile.phone);
    if (profile?.name) p.set('patient_name', profile.name);
    router.push(`/billing/new?${p.toString()}` as any);
  }, [profile, router]);

  // Only owner-tier and prescribers can schedule OT
  const canScheduleOT = !!user && (
    user.role === 'super_owner' ||
    user.role === 'primary_owner' ||
    user.role === 'partner' ||
    user.role === 'owner' ||
    user.role === 'doctor'
  );

  // ─── Permission gate ──────────────────────────────────────────
  if (!canAccess) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => goBackSafe(router)} title="Patient details" />
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Access required</Text>
          <Text style={styles.emptySub}>Ask the Primary Owner to enable Patient Database access.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => goBackSafe(router)} title="Patient details" />
        <View style={{ padding: 32, alignItems: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => goBackSafe(router)} title="Patient details" />
        <View style={styles.empty}>
          <Ionicons name="alert-circle" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Could not load</Text>
          <Text style={styles.emptySub}>{error || 'Patient not found'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        onBack={() => goBackSafe(router)}
        title="Patient details"
        actions={[
          ...(canScheduleOT
            ? [{
                icon: 'calculator' as any,
                onPress: onRunCalculator,
                label: 'Run calculator',
                testID: 'patient-header-calculator',
              }]
            : []),
          ...(canScheduleOT
            ? [{
                icon: 'cash-outline' as any,
                onPress: onRecordPayment,
                label: 'Record payment',
                testID: 'patient-header-billing',
              }]
            : []),
          ...(canScheduleOT
            ? [{
                icon: 'medkit' as any,
                onPress: onScheduleOT,
                label: 'Schedule OT',
                testID: 'patient-header-schedule-ot',
              }]
            : []),
        ]}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileInitials}>
                {(profile.name || profile.email || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile.name || 'Unnamed'}
              </Text>
              {!!profile.reg_no && (
                <View style={styles.regPill}>
                  <Ionicons name="id-card" size={11} color="#fff" />
                  <Text style={styles.regPillText}>#{profile.reg_no}</Text>
                </View>
              )}
              <Text style={styles.profileMeta} numberOfLines={1}>
                {profile.age ? `${profile.age}y` : ''}
                {profile.gender ? ` · ${profile.gender}` : ''}
              </Text>
            </View>
          </View>

          {/* Detail rows */}
          {!!profile.phone && <DetailRow icon="call" label="Mobile" value={profile.phone} />}
          {!!profile.email && <DetailRow icon="mail" label="Email" value={profile.email} />}
          {!!profile.address && <DetailRow icon="location" label="Address" value={profile.address} />}
          {!!profile.first_seen_at && (
            <DetailRow
              icon="time"
              label="First seen"
              value={String(profile.first_seen_at).slice(0, 10)}
            />
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actionRow}>
          <ActionButton icon="call" label="Call" color="#16A34A" onPress={onCall} testID="patient-action-call" />
          <ActionButton
            icon="logo-whatsapp"
            label="WhatsApp"
            color="#25D366"
            onPress={onWhatsApp}
            testID="patient-action-whatsapp"
          />
          <ActionButton
            icon="calendar"
            label="Book"
            color={COLORS.primary}
            onPress={onBook}
            testID="patient-action-book"
          />
        </View>

        {/* AI Patient Gist banner (Wave 3 · N) */}
        <PatientGistBanner phone={profile.phone || ''} />

        {/* Wave 1 quick-links */}
        <View style={styles.wave1Row}>
          <Wave1Link
            icon="time"
            label="Timeline"
            onPress={() =>
              router.push(`/patient-timeline?phone=${encodeURIComponent(profile.phone || '')}&name=${encodeURIComponent(profile.name || '')}` as any)
            }
            testID="patient-wave1-timeline"
          />
          <Wave1Link
            icon="warning"
            label="Allergies"
            tone="#B91C1C"
            onPress={() =>
              router.push(`/patient-allergies?phone=${encodeURIComponent(profile.phone || '')}&name=${encodeURIComponent(profile.name || '')}` as any)
            }
            testID="patient-wave1-allergies"
          />
          <Wave1Link
            icon="flask"
            label="Labs"
            tone="#9333EA"
            onPress={() =>
              router.push(`/patient-labs?phone=${encodeURIComponent(profile.phone || '')}&name=${encodeURIComponent(profile.name || '')}` as any)
            }
            testID="patient-wave1-labs"
          />
        </View>

        {/* Stats strip */}
        <View style={styles.statsRow}>
          <Stat label="Bookings" value={data.counts.bookings} icon="calendar-outline" />
          <Stat label="Rx" value={data.counts.prescriptions} icon="document-text-outline" />
          <Stat label="Surgeries" value={data.counts.surgeries} icon="medkit-outline" />
        </View>

        {/* Bookings */}
        <CollapseHeader
          title={`Consultations (${data.counts.bookings})`}
          icon="calendar"
          color={COLORS.primary}
          open={open.consultations}
          onToggle={() => toggle('consultations')}
        />
        {open.consultations && (data.bookings.length === 0 ? (
          <EmptyMini icon="calendar-outline" text="No bookings yet" />
        ) : (
          data.bookings.slice(0, 10).map((b) => (
            <TouchableOpacity
              key={b.id}
              onPress={() => router.push('/dashboard?tab=bookings' as any)}
              activeOpacity={0.85}
              style={styles.histRow}
            >
              <View style={styles.histDate}>
                <Text style={styles.histDateText}>
                  {(b.booking_date || '').slice(5) || '—'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.histTitle} numberOfLines={1}>
                  {b.reason || 'Consultation'}
                </Text>
                <Text style={styles.histMeta} numberOfLines={1}>
                  {(b.start_time || b.slot || '')}{' '}
                  {b.mode ? `· ${b.mode}` : ''}{' '}
                  {b.status ? `· ${b.status}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))
        ))}

        {/* Prescriptions — tap-through to individual Rx */}
        <CollapseHeader
          title={`Prescriptions (${data.counts.prescriptions})`}
          icon="document-text"
          color="#0EA5E9"
          open={open.prescriptions}
          onToggle={() => toggle('prescriptions')}
        />
        {open.prescriptions && (data.prescriptions.length === 0 ? (
          <EmptyMini icon="document-text-outline" text="No prescriptions yet" />
        ) : (
          data.prescriptions.slice(0, 10).map((rx) => (
            <TouchableOpacity
              key={rx.prescription_id}
              onPress={() =>
                router.push(`/prescriptions/${encodeURIComponent(rx.prescription_id || '')}` as any)
              }
              activeOpacity={0.85}
              style={styles.histRow}
            >
              <View style={[styles.histDate, { backgroundColor: '#0EA5E915' }]}>
                <Text style={[styles.histDateText, { color: '#0EA5E9' }]}>
                  {(rx.created_at || '').slice(5, 10) || 'Rx'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.histTitle} numberOfLines={1}>
                  {rx.diagnosis || 'Prescription'}
                </Text>
                <Text style={styles.histMeta} numberOfLines={1}>
                  #{rx.prescription_id?.slice(-6) || ''} · {rx.status || ''}
                </Text>
              </View>
              <MaterialCommunityIcons name="prescription" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))
        ))}

        {/* Encounters — clinical visit notes (staff-only) */}
        <CollapseHeader
          title={`Encounters (${encounters.length})`}
          icon="clipboard"
          color="#7C3AED"
          open={open.encounters}
          onToggle={() => toggle('encounters')}
        />
        {open.encounters && (encounters.length === 0 ? (
          <EmptyMini icon="clipboard-outline" text="No encounters yet" />
        ) : (
          encounters.slice(0, 10).map((e) => (
            <TouchableOpacity
              key={e.encounter_id}
              onPress={() => router.push(`/encounters/${encodeURIComponent(e.encounter_id || '')}` as any)}
              activeOpacity={0.85}
              style={styles.histRow}
            >
              <View style={[styles.histDate, { backgroundColor: '#7C3AED15' }]}>
                <Text style={[styles.histDateText, { color: '#7C3AED' }]}>
                  {(e.created_at || '').slice(5, 10) || 'Enc'}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.histTitle} numberOfLines={1}>
                  {e.chief_complaint || (e.diagnoses || [])[0] || 'Clinical encounter'}
                </Text>
                <Text style={styles.histMeta} numberOfLines={1}>
                  {(e.diagnoses || []).slice(0, 2).join(', ') || 'Visit notes'}
                  {e.follow_up_date ? ` · F/U ${e.follow_up_date}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          ))
        ))}

        {/* Surgeries */}
        {data.counts.surgeries > 0 && (
          <>
            <CollapseHeader
              title={`Surgeries (${data.counts.surgeries})`}
              icon="medkit"
              color="#16A34A"
              open={open.surgeries}
              onToggle={() => toggle('surgeries')}
            />
            {open.surgeries && data.surgeries.slice(0, 10).map((s) => (
              <View key={s.id} style={styles.histRow}>
                <View style={[styles.histDate, { backgroundColor: '#16A34A15' }]}>
                  <Text style={[styles.histDateText, { color: '#16A34A' }]}>
                    {(s.date || '').slice(5, 10) || 'Sx'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {s.procedure || 'Surgery'}
                  </Text>
                  {!!s.notes && (
                    <Text style={styles.histMeta} numberOfLines={2}>{s.notes}</Text>
                  )}
                </View>
              </View>
            ))}
          </>
        )}

        {/* Discharge Summaries — IPD history projection (DOC_THEME.discharge → purple) */}
        {discharges.length > 0 && (
          <>
            <CollapseHeader
              title={`Discharge Summaries (${discharges.length})`}
              icon="exit"
              color="#7C3AED"
              open={open.discharges}
              onToggle={() => toggle('discharges')}
            />
            {open.discharges && discharges.slice(0, 10).map((d: any) => (
              <TouchableOpacity
                key={d.id}
                onPress={() => router.push('/discharge-summaries' as any)}
                activeOpacity={0.85}
                style={styles.histRow}
              >
                <View style={[styles.histDate, { backgroundColor: '#7C3AED15' }]}>
                  <Text style={[styles.histDateText, { color: '#7C3AED' }]}>
                    {(d.discharged_at || '').slice(5, 10) || 'DS'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {d.final_diagnosis || d.diagnosis || 'Discharge summary'}
                  </Text>
                  <Text style={styles.histMeta} numberOfLines={1}>
                    IPD {d.ipd_no || '—'}{d.condition_at_discharge ? ' · ' + d.condition_at_discharge : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Medical Certificates — DOC_THEME.medical_certificate → gold */}
        {medCerts.length > 0 && (
          <>
            <CollapseHeader
              title={`Medical Certificates (${medCerts.length})`}
              icon="ribbon"
              color="#CA8A04"
              open={open.certs}
              onToggle={() => toggle('certs')}
            />
            {open.certs && medCerts.slice(0, 10).map((c: any) => (
              <TouchableOpacity
                key={c.cert_id}
                onPress={() => router.push('/medical-certificates' as any)}
                activeOpacity={0.85}
                style={styles.histRow}
              >
                <View style={[styles.histDate, { backgroundColor: '#CA8A0415' }]}>
                  <Text style={[styles.histDateText, { color: '#CA8A04' }]}>
                    {(c.created_at || '').slice(5, 10) || 'MC'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {kindLabel(c.kind)}{c.diagnosis ? ' — ' + c.diagnosis : ''}
                  </Text>
                  <Text style={styles.histMeta} numberOfLines={1}>
                    {c.cert_id ? '#' + String(c.cert_id).slice(-6) : ''}{c.days ? ` · ${c.days} day${c.days === 1 ? '' : 's'}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Calculator scores tied to this patient */}
        {calcScores.length > 0 && (
          <>
            <CollapseHeader
              title={`Calculator scores (${calcScores.length})`}
              icon="calculator"
              color="#9333EA"
              open={open.scores}
              onToggle={() => toggle('scores')}
            />
            {open.scores && calcScores.slice(0, 10).map((cs) => (
              <View key={cs.score_id} style={styles.histRow}>
                <View style={[styles.histDate, { backgroundColor: '#9333EA15' }]}>
                  <Text style={[styles.histDateText, { color: '#9333EA', textTransform: 'uppercase' }]} numberOfLines={1}>
                    {String(cs.tool_id || '').slice(0, 4)}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {cs.label || (cs.score != null ? String(cs.score) : '—')}
                  </Text>
                  <Text style={styles.histMeta} numberOfLines={1}>
                    {String(cs.tool_id || '').replace('_', ' ')} · {String(cs.created_at || '').slice(0, 10)}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Receipts tied to this patient (DOC_THEME.receipt → green) */}
        {receipts.length > 0 && (
          <>
            <CollapseHeader
              title={`Receipts (${receipts.length})`}
              icon="cash"
              color="#16A34A"
              open={open.receipts}
              onToggle={() => toggle('receipts')}
            />
            {open.receipts && receipts.slice(0, 10).map((rc: any) => (
              <TouchableOpacity
                key={rc.receipt_id}
                onPress={() => router.push(`/billing/${rc.receipt_id}` as any)}
                activeOpacity={0.85}
                style={styles.histRow}
              >
                <View style={[styles.histDate, { backgroundColor: '#16A34A15' }]}>
                  <Text style={[styles.histDateText, { color: '#16A34A' }]}>
                    {(rc.receipt_date || '').slice(5, 10) || 'Rs'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.histTitle} numberOfLines={1}>
                    {rc.receipt_no} · Rs {Number(rc.paid || rc.total || 0).toLocaleString('en-IN')}
                  </Text>
                  <Text style={styles.histMeta} numberOfLines={1}>
                    {rc.mode} {(rc.balance || 0) > 0 ? `· Bal Rs ${Number(rc.balance).toLocaleString('en-IN')}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function kindLabel(k: string | undefined): string {
  switch (k) {
    case 'sick_leave': return 'Sick Leave';
    case 'fitness': return 'Fitness';
    case 'unfit_for_duty': return 'Unfit for Duty';
    case 'medical_summary': return 'Medical Summary';
    default: return 'Certificate';
  }
}

function CollapseHeader({
  title, icon, color, open, onToggle,
}: {
  title: string;
  icon: any;
  color: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.7}
      style={styles.collapseHeader}
      testID={`collapse-${title.toLowerCase().replace(/[^a-z]/g, '-')}`}
    >
      <View style={[styles.collapseIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.collapseTitle}>{title}</Text>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={18}
        color={COLORS.textSecondary}
      />
    </TouchableOpacity>
  );
}

function Header({ title, onBack, actions }: {
  title: string;
  onBack: () => void;
  actions?: Array<{
    icon: any;
    onPress: () => void;
    label?: string;
    testID?: string;
    color?: string;
  }>;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backIcon} hitSlop={10}>
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {(actions || []).map((a, i) => (
        <TouchableOpacity
          key={i}
          onPress={a.onPress}
          style={styles.headerRightBtn}
          hitSlop={10}
          accessibilityLabel={a.label}
          testID={a.testID}
        >
          <Ionicons name={a.icon} size={20} color={a.color || COLORS.primary} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function DetailRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon as any} size={14} color={COLORS.textSecondary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onPress,
  testID,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.actionBtn}
      testID={testID}
    >
      <View style={[styles.actionIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={22} color={color} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon as any} size={18} color={COLORS.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function EmptyMini({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.miniEmpty}>
      <Ionicons name={icon as any} size={20} color={COLORS.textSecondary} />
      <Text style={styles.miniEmptyText}>{text}</Text>
    </View>
  );
}

function Wave1Link({
  icon,
  label,
  tone = COLORS.primary,
  onPress,
  testID,
}: {
  icon: any;
  label: string;
  tone?: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.wave1Btn}
      testID={testID}
    >
      <View style={[styles.wave1Icon, { backgroundColor: tone + '18' }]}>
        <Ionicons name={icon} size={16} color={tone} />
      </View>
      <Text style={[styles.wave1Label, { color: tone }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  backIcon: { padding: 6 },
  headerRightBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  headerTitle: { ...FONTS.h2, fontSize: 17, color: COLORS.textPrimary, flex: 1 },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 14,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center' },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInitials: { ...FONTS.h2, fontSize: 18, color: COLORS.primary },
  profileName: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  profileMeta: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 4 },
  regPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 4,
  },
  regPillText: { ...FONTS.body, fontSize: 11, color: '#fff', fontWeight: '700' },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  detailLabel: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, width: 70, marginTop: 1 },
  detailValue: { flex: 1, ...FONTS.body, fontSize: 13, color: COLORS.textPrimary },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: { ...FONTS.body, fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },
  wave1Row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  wave1Btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingVertical: 8,
  },
  wave1Icon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  wave1Label: { ...FONTS.bodyMedium, fontSize: 12.5 },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  stat: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: { ...FONTS.h2, fontSize: 18, color: COLORS.textPrimary },
  statLabel: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary },
  collapseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 14,
    marginBottom: 4,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  collapseIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapseTitle: {
    flex: 1,
    fontWeight: '600' as any,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  sectionTitle: {
    ...FONTS.h2,
    fontSize: 14,
    color: COLORS.textPrimary,
    marginTop: 8,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: RADIUS.md,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  histDate: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  histDateText: { ...FONTS.body, fontSize: 11, fontWeight: '700', color: COLORS.primary },
  histTitle: { ...FONTS.body, fontSize: 13, fontWeight: '600', color: COLORS.textPrimary },
  histMeta: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  miniEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 6,
  },
  miniEmptyText: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { ...FONTS.h2, fontSize: 17, color: COLORS.textPrimary, marginTop: 12 },
  emptySub: { ...FONTS.body, fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', maxWidth: 280, lineHeight: 18 },
});
