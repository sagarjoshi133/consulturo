/**
 * IPDDashboard — main panel for the In-Patient Department.
 *
 * Sections:
 *   • KPI strip (Active, In today, Out today, Free beds)
 *   • Action row (Admit patient, Manage beds)
 *   • Bed grid (configured beds + their occupancy status)
 *   • Admissions list (filter + search)
 *   • Admit modal (with patient auto-lookup)
 *   • Beds editor modal (owner-only configure)
 *   • Admission detail modal (drawer with internal tabs)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Modal, Alert,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import api from '../api';
import { COLORS } from '../theme';
import { useToast } from '../toast';
import { formatISTShort } from '../date';
import { ipdStyles as styles } from './styles';
import { Field, KpiTile } from './components';
import AdmissionDetail from './admission-detail';
import type { Bed, Admission, Stats } from './types';

const EMPTY_ADMIT = {
  patient_name: '', patient_phone: '', patient_age: '',
  patient_gender: '', registration_no: '', address: '', patient_email: '',
  bed_id: '', diagnosis: '', planned_procedure: '',
  consulting_doctor: '', presenting_complaints: '',
};

export default function IPDDashboard() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'discharged' | 'all'>('active');
  const [q, setQ] = useState('');
  const [admitModal, setAdmitModal] = useState(false);
  const [admitForm, setAdmitForm] = useState<any>(EMPTY_ADMIT);
  const [bedsModal, setBedsModal] = useState(false);
  const [bedsDraft, setBedsDraft] = useState<Bed[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Patient auto-lookup on admit. Entering phone or registration
  // number auto-fills name/age/gender/address/email from the patient DB.
  const [looking, setLooking] = useState(false);
  const [lookedMsg, setLookedMsg] = useState<string | null>(null);
  const tryLookup = useCallback(async (params: { phone?: string; registration_no?: string }) => {
    const phone = (params.phone || '').trim();
    const regNo = (params.registration_no || '').trim();
    if (!phone && !regNo) return;
    setLooking(true);
    setLookedMsg(null);
    try {
      const r = await api.get('/patients/lookup', {
        params: { phone: phone || undefined, registration_no: regNo || undefined },
      });
      const d = r.data || {};
      if (d.found) {
        setAdmitForm((f: any) => ({
          ...f,
          patient_name: f.patient_name || d.name || '',
          patient_phone: f.patient_phone || d.phone || '',
          registration_no: f.registration_no || d.registration_no || '',
          patient_age: f.patient_age || (d.age ? String(d.age) : ''),
          patient_gender: f.patient_gender || d.gender || '',
          patient_email: f.patient_email || d.email || '',
          address: f.address || d.address || '',
        }));
        setLookedMsg(`Auto-filled from patient database · ${d.name || phone || regNo}`);
      } else {
        setLookedMsg('No matching record found. Enter details manually below.');
      }
    } catch {
      // Silent — opportunistic lookup, never blocks the form.
    } finally {
      setLooking(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, a] = await Promise.all([
        api.get('/ipd/stats'),
        api.get('/ipd/beds'),
        api.get('/ipd/admissions', { params: filter !== 'all' ? { status: filter } : {} }),
      ]);
      setStats(s.data);
      setBeds(b.data?.items || []);
      setAdmissions(a.data?.items || []);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load IPD.');
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { void load(); }, [load]);

  // Deep-link admit: `/ipd?admit=1&...` pre-fills the admit modal.
  const navParams = useLocalSearchParams<{
    admit?: string;
    patient_name?: string;
    patient_phone?: string;
    patient_age?: string;
    patient_gender?: string;
    registration_no?: string;
    address?: string;
    patient_email?: string;
    diagnosis?: string;
    presenting_complaints?: string;
    investigations_summary?: string;
    planned_procedure?: string;
    from_rx?: string;
  }>();
  const [prefillApplied, setPrefillApplied] = useState(false);
  useEffect(() => {
    if (prefillApplied) return;
    if (navParams?.admit !== '1' && navParams?.admit !== 'true') return;
    setAdmitForm((f: any) => ({
      ...f,
      patient_name: navParams.patient_name || f.patient_name || '',
      patient_phone: navParams.patient_phone || f.patient_phone || '',
      patient_age: navParams.patient_age || f.patient_age || '',
      patient_gender: navParams.patient_gender || f.patient_gender || '',
      registration_no: navParams.registration_no || f.registration_no || '',
      address: navParams.address || f.address || '',
      patient_email: navParams.patient_email || f.patient_email || '',
      diagnosis: navParams.diagnosis || f.diagnosis || '',
      planned_procedure: navParams.planned_procedure || f.planned_procedure || '',
      presenting_complaints: navParams.presenting_complaints || f.presenting_complaints || '',
      investigations_summary: navParams.investigations_summary || f.investigations_summary || '',
      from_prescription_id: navParams.from_rx || null,
    }));
    setAdmitModal(true);
    setPrefillApplied(true);
    if (navParams.patient_phone || navParams.registration_no) {
      void tryLookup({
        phone: navParams.patient_phone,
        registration_no: navParams.registration_no,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navParams?.admit, navParams?.patient_phone, navParams?.registration_no, prefillApplied]);

  const filteredAdmissions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return admissions;
    return admissions.filter((a) =>
      [a.patient_name, a.ipd_no, a.diagnosis, a.planned_procedure]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
    );
  }, [admissions, q]);

  const admit = useCallback(async () => {
    if (!admitForm.patient_name.trim()) {
      Alert.alert('Required', 'Patient name is required.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/ipd/admissions', {
        ...admitForm,
        patient_age: admitForm.patient_age ? Number(admitForm.patient_age) : null,
      });
      toast.success('Patient admitted.');
      setAdmitModal(false);
      setAdmitForm(EMPTY_ADMIT);
      await load();
    } catch (e: any) {
      Alert.alert('Admit failed', e?.response?.data?.detail || 'Unknown error');
    } finally {
      setBusy(false);
    }
  }, [admitForm, toast, load]);

  const openBedsEditor = useCallback(() => {
    setBedsDraft([...beds]);
    setBedsModal(true);
  }, [beds]);

  const saveBeds = useCallback(async () => {
    setBusy(true);
    try {
      await api.post('/ipd/beds', { beds: bedsDraft });
      toast.success('Beds saved.');
      setBedsModal(false);
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Unknown');
    } finally {
      setBusy(false);
    }
  }, [bedsDraft, toast, load]);

  if (loading) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
      {/* KPI strip */}
      <View style={styles.kpiRow}>
        <KpiTile label="Active" value={stats?.active_admissions ?? 0} color="#0EA5E9" icon="bed" />
        <KpiTile label="In today" value={stats?.today_admitted ?? 0} color="#16A34A" icon="enter" />
        <KpiTile label="Out today" value={stats?.today_discharged ?? 0} color="#9333EA" icon="exit" />
        <KpiTile label="Free" value={`${stats?.free_beds ?? 0}/${stats?.total_beds ?? 0}`} color="#F59E0B" icon="bed-outline" />
      </View>

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 14 }}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => setAdmitModal(true)} testID="ipd-admit-btn">
          <Ionicons name="add-circle" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Admit patient</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={openBedsEditor} testID="ipd-manage-beds">
          <MaterialCommunityIcons name="bed-king" size={16} color={COLORS.primary} />
          <Text style={styles.secondaryBtnText}>Manage beds</Text>
        </TouchableOpacity>
      </View>

      {/* Bed grid */}
      <Text style={styles.sectionTitle}>Beds ({beds.length})</Text>
      {beds.length === 0 ? (
        <Text style={styles.empty}>No beds configured. Tap "Manage beds" above to add some.</Text>
      ) : (
        <View style={styles.bedGrid}>
          {beds.map((b) => {
            const occ = b.status === 'occupied';
            return (
              <TouchableOpacity
                key={b.id}
                style={[styles.bedTile, occ && styles.bedTileOcc]}
                onPress={() => occ && b.current_admission?.id ? setDetailId(b.current_admission.id) : null}
                testID={`ipd-bed-${b.id}`}
              >
                <MaterialCommunityIcons name={occ ? 'bed' : 'bed-outline'} size={20} color={occ ? '#fff' : COLORS.primary} />
                <Text style={[styles.bedNo, occ && { color: '#fff' }]}>{b.bed_no}</Text>
                <Text style={[styles.bedWard, occ && { color: '#fff', opacity: 0.85 }]}>{b.ward}</Text>
                {occ && b.current_admission ? (
                  <Text style={styles.bedOccName} numberOfLines={1}>
                    {b.current_admission.patient_name}
                  </Text>
                ) : (
                  <Text style={styles.bedFree}>Free</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Admissions list */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, gap: 8 }}>
        <Text style={[styles.sectionTitle, { flex: 1 }]}>Admissions</Text>
        <View style={styles.filterRow}>
          {(['active', 'discharged', 'all'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, filter === f && styles.filterChipOn]}
              onPress={() => setFilter(f)}
            >
              <Text style={[styles.filterChipText, filter === f && { color: '#fff' }]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <TextInput
        style={styles.searchInput}
        placeholder="Search patient / IPD no / diagnosis"
        placeholderTextColor={COLORS.textTertiary}
        value={q}
        onChangeText={setQ}
      />
      {filteredAdmissions.length === 0 ? (
        <Text style={styles.empty}>No admissions match.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {filteredAdmissions.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.admCard}
              onPress={() => setDetailId(a.id)}
              testID={`ipd-adm-${a.id}`}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.admIpdNo}>{a.ipd_no}</Text>
                  <View style={[styles.statusPill, a.status === 'active' ? styles.statusActive : styles.statusDischarged]}>
                    <Text style={[styles.statusText, a.status === 'active' ? { color: '#166534' } : { color: '#1e40af' }]}>
                      {a.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.admName}>{a.patient_name}{a.patient_age ? ` · ${a.patient_age}y` : ''}</Text>
                {a.diagnosis ? <Text style={styles.admDiag} numberOfLines={1}>{a.diagnosis}</Text> : null}
                <Text style={styles.admMeta}>
                  {a.ward || 'General'} · admitted {formatISTShort(a.admitted_at)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Admit modal */}
      <Modal visible={admitModal} animationType="slide" onRequestClose={() => setAdmitModal(false)}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#f8fafc' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setAdmitModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>New Admission</Text>
            <View style={{ width: 36 }} />
          </View>
          <KeyboardAwareScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
            keyboardShouldPersistTaps="handled"
            bottomOffset={80}
          >
            <Text style={styles.helperTop}>
              Enter phone or registration number — we auto-fetch the rest from your patient database.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 2 }}>
                <Field
                  label="Phone (10 digits)"
                  value={admitForm.patient_phone}
                  onChange={(v: string) => setAdmitForm({ ...admitForm, patient_phone: v })}
                  onBlur={() => {
                    const digits = (admitForm.patient_phone || '').replace(/\D/g, '');
                    if (digits.length >= 10) void tryLookup({ phone: admitForm.patient_phone });
                  }}
                  keyboard="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Reg. No."
                  value={admitForm.registration_no}
                  onChange={(v: string) => setAdmitForm({ ...admitForm, registration_no: v })}
                  onBlur={() => {
                    const r = (admitForm.registration_no || '').trim();
                    if (r.length >= 2) void tryLookup({ registration_no: r });
                  }}
                />
              </View>
            </View>
            {(looking || lookedMsg) ? (
              <Text style={[styles.lookupHint, looking ? { color: COLORS.primary } : null]}>
                {looking ? 'Looking up patient…' : lookedMsg}
              </Text>
            ) : null}

            <Field label="Patient name *" value={admitForm.patient_name} onChange={(v: string) => setAdmitForm({ ...admitForm, patient_name: v })} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Field label="Age" value={admitForm.patient_age} onChange={(v: string) => setAdmitForm({ ...admitForm, patient_age: v })} keyboard="number-pad" />
              </View>
              <View style={{ flex: 2 }}>
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {['Male', 'Female', 'Other'].map((g) => (
                    <TouchableOpacity
                      key={g}
                      onPress={() => setAdmitForm({ ...admitForm, patient_gender: g })}
                      style={[styles.bedChip, admitForm.patient_gender === g && styles.bedChipOn]}
                    >
                      <Text style={[styles.bedChipText, admitForm.patient_gender === g && { color: '#fff' }]}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <Field label="Address" value={admitForm.address} onChange={(v: string) => setAdmitForm({ ...admitForm, address: v })} multiline />
            <Field label="Email (optional)" value={admitForm.patient_email} onChange={(v: string) => setAdmitForm({ ...admitForm, patient_email: v })} />

            <Text style={styles.fieldLabel}>Bed</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {beds.filter((b) => b.status !== 'occupied').map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.bedChip, admitForm.bed_id === b.id && styles.bedChipOn]}
                  onPress={() => setAdmitForm({ ...admitForm, bed_id: b.id, ward: b.ward })}
                >
                  <Text style={[styles.bedChipText, admitForm.bed_id === b.id && { color: '#fff' }]}>
                    {b.ward} · {b.bed_no}
                  </Text>
                </TouchableOpacity>
              ))}
              {beds.filter((b) => b.status !== 'occupied').length === 0 ? (
                <Text style={styles.empty}>No free beds available.</Text>
              ) : null}
            </View>
            <Field label="Diagnosis" value={admitForm.diagnosis} onChange={(v: string) => setAdmitForm({ ...admitForm, diagnosis: v })} multiline />
            <Field label="Planned procedure" value={admitForm.planned_procedure} onChange={(v: string) => setAdmitForm({ ...admitForm, planned_procedure: v })} />
            <Field label="Consulting doctor" value={admitForm.consulting_doctor} onChange={(v: string) => setAdmitForm({ ...admitForm, consulting_doctor: v })} />
            <Field label="Presenting complaints" value={admitForm.presenting_complaints} onChange={(v: string) => setAdmitForm({ ...admitForm, presenting_complaints: v })} multiline />
            <TouchableOpacity style={[styles.primaryBtn, busy && { opacity: 0.6 }, { marginTop: 16 }]} onPress={admit} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
              <Text style={styles.primaryBtnText}>Admit</Text>
            </TouchableOpacity>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </Modal>

      {/* Beds editor modal */}
      <Modal visible={bedsModal} animationType="slide" onRequestClose={() => setBedsModal(false)}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: '#f8fafc' }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setBedsModal(false)} style={styles.modalClose}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Manage Beds</Text>
            <TouchableOpacity onPress={saveBeds} style={styles.modalClose} disabled={busy}>
              <Ionicons name="checkmark" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          <KeyboardAwareScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
            keyboardShouldPersistTaps="handled"
            bottomOffset={60}
          >
            {bedsDraft.map((b, i) => (
              <View key={i} style={styles.bedEditRow}>
                <TextInput
                  style={[styles.input, { flex: 1, marginRight: 6 }]}
                  value={b.ward}
                  placeholder="Ward"
                  placeholderTextColor={COLORS.textTertiary}
                  onChangeText={(t) => {
                    const draft = [...bedsDraft];
                    draft[i] = { ...draft[i], ward: t };
                    setBedsDraft(draft);
                  }}
                />
                <TextInput
                  style={[styles.input, { flex: 1, marginRight: 6 }]}
                  value={b.bed_no}
                  placeholder="Bed no"
                  placeholderTextColor={COLORS.textTertiary}
                  onChangeText={(t) => {
                    const draft = [...bedsDraft];
                    draft[i] = { ...draft[i], bed_no: t };
                    setBedsDraft(draft);
                  }}
                />
                <TouchableOpacity onPress={() => setBedsDraft(bedsDraft.filter((_, j) => j !== i))} style={styles.delIcon}>
                  <Ionicons name="trash" size={16} color="#dc2626" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addBedBtn}
              onPress={() => setBedsDraft([...bedsDraft, { id: '', ward: 'General', bed_no: '' }])}
            >
              <Ionicons name="add-circle" size={16} color={COLORS.primary} />
              <Text style={styles.addBedText}>Add bed</Text>
            </TouchableOpacity>
          </KeyboardAwareScrollView>
        </SafeAreaView>
      </Modal>

      {/* Admission detail */}
      <Modal visible={!!detailId} animationType="slide" onRequestClose={() => setDetailId(null)}>
        {detailId ? (
          <AdmissionDetail admissionId={detailId} onClose={() => { setDetailId(null); load(); }} />
        ) : null}
      </Modal>
    </ScrollView>
  );
}
