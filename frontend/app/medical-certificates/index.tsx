/**
 * Medical Certificates — list + composer screen.
 *
 * Practice → Medical Certificate. Lets the doctor / prescriber issue
 * one of four certificate kinds and stream a premium PDF (gold-accent
 * theme — distinct from the teal prescription and green receipt).
 *
 * Kinds:
 *   - sick_leave      — "patient unfit for duty for N days"
 *   - fitness         — "patient fit to resume duty / travel / sports"
 *   - unfit_for_duty  — long-term incapacity
 *   - medical_summary — free-text summary (insurance / school / court)
 *
 * Owner-tier and any team member with `can_prescribe` may issue.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DOC_THEME } from '../../src/doc-theme';
import { useResponsive } from '../../src/responsive';
import { PrimaryButton, SecondaryButton } from '../../src/components';
import { generateCertificatePdfHtml } from '../../src/medical-cert-pdf';
import { sharePdfFromHtml } from '../../src/pdf-share';
import { sharePdfThenWhatsApp } from '../../src/whatsapp-pdf';
import { fetchClinicSettings } from '../../src/clinic-settings';
import { ISODateField } from '../../src/date-picker';

type Kind = 'sick_leave' | 'fitness' | 'unfit_for_duty' | 'medical_summary';

type Certificate = {
  cert_id: string;
  kind: Kind;
  patient_name: string;
  patient_phone?: string;
  patient_email?: string;
  patient_age?: number;
  patient_gender?: string;
  patient_address?: string;
  registration_no?: string;
  diagnosis?: string;
  advice?: string;
  start_date?: string;
  end_date?: string;
  resume_date?: string;
  days?: number;
  // Phase 5.12 — extended clinical timeline fields
  consultation_date?: string;
  admission_date?: string;
  surgery_date?: string;
  surgery_name?: string;
  discharge_date?: string;
  addressed_to?: string;
  summary?: string;
  doctor_name?: string;
  doctor_reg_no?: string;
  issued_by_name?: string;
  created_at?: string;
  status?: string;
};

const KIND_OPTIONS: { value: Kind; label: string; icon: any; sub: string }[] = [
  { value: 'sick_leave', label: 'Sick Leave', icon: 'thermometer', sub: 'Unfit for duty (short-term)' },
  { value: 'fitness', label: 'Fitness Certificate', icon: 'fitness', sub: 'Fit to resume duty / sports' },
  { value: 'unfit_for_duty', label: 'Unfit for Duty', icon: 'sad-outline', sub: 'Long-term incapacity' },
  { value: 'medical_summary', label: 'Medical Summary', icon: 'document-text', sub: 'Insurance / school / court' },
];

export default function MedicalCertificatesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    admission_id?: string;
    patient_name?: string;
    patient_phone?: string;
    patient_age?: string;
    patient_sex?: string;
    patient_email?: string;
    diagnosis?: string;
    procedure?: string;
  }>();
  const { user } = useAuth() as any;
  const insets = useSafeAreaInsets();
  const { isWebDesktop } = useResponsive();
  const [items, setItems] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<Certificate | null>(null);
  const [previewing, setPreviewing] = useState<Certificate | null>(null);
  // Prefill for composer when arriving from IPD '+' action.
  const [prefill, setPrefill] = useState<Partial<Certificate> | null>(null);
  const autoOpenedRef = useRef(false);

  const isStaff = !!user && !['patient'].includes((user.role || '').toLowerCase());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/medical-certificates');
      setItems(r.data?.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Auto-open composer when navigated from IPD with a patient context.
  // Use `autoOpenedRef` so we only open once per mount; the user may
  // close the composer and we shouldn't keep reopening it.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!isStaff) return;
    const hasCtx = !!(params.patient_name || params.patient_phone || params.admission_id);
    if (!hasCtx) return;
    autoOpenedRef.current = true;
    const ageNum = params.patient_age ? Number(params.patient_age) : undefined;
    setPrefill({
      patient_name: params.patient_name || '',
      patient_phone: params.patient_phone || '',
      patient_email: params.patient_email || '',
      patient_age: typeof ageNum === 'number' && !Number.isNaN(ageNum) ? ageNum : undefined,
      patient_gender: params.patient_sex || '',
      diagnosis: params.diagnosis || '',
    } as Partial<Certificate>);
    setEditing(null);
    setComposerOpen(true);
  }, [params.patient_name, params.patient_phone, params.admission_id, params.patient_age, params.patient_sex, params.patient_email, params.diagnosis, isStaff]);

  const openComposer = (existing?: Certificate) => {
    setEditing(existing || null);
    setPrefill(null);
    setComposerOpen(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="medcert-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Medical Certificates</Text>
          <Text style={styles.sub}>Branded, premium PDFs · sick leave / fitness / unfit / summary</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
        {/* Premium banner — gold theme strip identifies the doc type */}
        <View style={styles.banner}>
          <View style={[styles.bannerStrip, { backgroundColor: DOC_THEME.medical_certificate.accent }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.bannerTitle, { color: DOC_THEME.medical_certificate.accent }]}>
              Medical Certificate
            </Text>
            <Text style={styles.bannerBody}>
              Issued on clinic letterhead with your registration number, official seal, and digital signature.
            </Text>
          </View>
          <Ionicons name="ribbon" size={32} color={DOC_THEME.medical_certificate.accent} />
        </View>

        {isStaff && (
          <PrimaryButton
            title="New certificate"
            icon={<Ionicons name="add" size={18} color="#fff" />}
            onPress={() => openComposer()}
            style={{ marginTop: 14 }}
            testID="medcert-new"
          />
        )}

        <View style={{ marginTop: 18 }}>
          {loading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator color={COLORS.primary} />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="ribbon-outline" size={32} color={COLORS.textDisabled} />
              <Text style={styles.emptyTitle}>No certificates issued yet</Text>
              <Text style={styles.emptyBody}>
                Tap “New certificate” to issue a sick leave, fitness or medical summary.
              </Text>
            </View>
          ) : (
            <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } : undefined}>
              {items.map((c) => (
                <View
                  key={c.cert_id}
                  style={[styles.row, isWebDesktop && { width: '49%' }]}
                  testID={`medcert-row-${c.cert_id}`}
                >
                  <View style={[styles.rowStrip, { backgroundColor: DOC_THEME.medical_certificate.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.patient_name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {kindLabel(c.kind)} · {c.created_at ? format(new Date(c.created_at), 'd MMM yyyy') : ''}
                      {c.days ? ` · ${c.days} day${c.days === 1 ? '' : 's'}` : ''}
                    </Text>
                    {c.diagnosis ? (
                      <Text style={styles.rowMeta} numberOfLines={1}>{c.diagnosis}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => setPreviewing(c)} style={styles.rowBtn} testID={`medcert-view-${c.cert_id}`}>
                    <Ionicons name="eye-outline" size={18} color={COLORS.primary} />
                  </TouchableOpacity>
                  {isStaff && (
                    <TouchableOpacity onPress={() => openComposer(c)} style={styles.rowBtn} testID={`medcert-edit-${c.cert_id}`}>
                      <Ionicons name="pencil" size={16} color={COLORS.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Composer */}
      <CertificateComposer
        visible={composerOpen}
        editing={editing}
        prefill={prefill}
        onClose={() => { setComposerOpen(false); setPrefill(null); }}
        onSaved={() => { setComposerOpen(false); setPrefill(null); void load(); }}
      />

      {/* PDF preview */}
      <CertificatePreview
        cert={previewing}
        onClose={() => setPreviewing(null)}
      />
    </SafeAreaView>
  );
}

function kindLabel(k: Kind | undefined): string {
  switch (k) {
    case 'sick_leave': return 'Sick Leave';
    case 'fitness': return 'Fitness';
    case 'unfit_for_duty': return 'Unfit for Duty';
    case 'medical_summary': return 'Medical Summary';
    default: return 'Certificate';
  }
}


/* ── Composer ──────────────────────────────────────────────── */

function CertificateComposer({
  visible, editing, prefill, onClose, onSaved,
}: {
  visible: boolean;
  editing: Certificate | null;
  prefill?: Partial<Certificate> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<Kind>('sick_leave');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [patientAddress, setPatientAddress] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [days, setDays] = useState('3');
  const [resumeDate, setResumeDate] = useState('');
  const [addressedTo, setAddressedTo] = useState('TO WHOM IT MAY CONCERN');
  const [summary, setSummary] = useState('');
  // Phase 5.12 — extended clinical timeline (consultation / admission
  // / surgery / discharge) printed on the redesigned certificate.
  const [consultationDate, setConsultationDate] = useState('');
  const [admissionDate, setAdmissionDate] = useState('');
  const [surgeryDate, setSurgeryDate] = useState('');
  const [surgeryName, setSurgeryName] = useState('');
  const [dischargeDate, setDischargeDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  const [lookedMsg, setLookedMsg] = useState<string | null>(null);

  // Auto-fetch helper — called when the user blurs the phone or
  // registration-no field. Hits /api/patients/lookup and prefills
  // identification fields ONLY. Clinical fields (diagnosis, advice,
  // days, etc.) remain whatever the doctor entered.
  const tryLookup = useCallback(async (params: { phone?: string; registration_no?: string }) => {
    const phone = (params.phone || '').trim();
    const regNo = (params.registration_no || '').trim();
    if (!phone && !regNo) return;
    setLooking(true);
    setLookedMsg(null);
    try {
      const r = await api.get('/patients/lookup', { params: { phone: phone || undefined, registration_no: regNo || undefined } });
      const d = r.data;
      if (d?.found) {
        if (d.name) setPatientName(d.name);
        if (d.phone && !patientPhone) setPatientPhone(d.phone);
        if (d.registration_no && !registrationNo) setRegistrationNo(d.registration_no);
        if (typeof d.age === 'number' || (typeof d.age === 'string' && d.age)) setPatientAge(String(d.age));
        if (d.gender) setPatientGender(d.gender);
        if (d.email) setPatientEmail(d.email);
        if (d.address) setPatientAddress(d.address);
        setLookedMsg(`Auto-filled from existing record · ${d.name || phone || regNo}`);
      } else {
        setLookedMsg('No matching patient record. Clinical fields stay editable.');
      }
    } catch {
      // Silent — auto-lookup is opportunistic, never blocks the form.
    } finally {
      setLooking(false);
    }
  }, [patientPhone, registrationNo]);

  useEffect(() => {
    if (!visible) return;
    setLookedMsg(null);
    if (editing) {
      setKind((editing.kind as Kind) || 'sick_leave');
      setPatientName(editing.patient_name || '');
      setPatientPhone(editing.patient_phone || '');
      setRegistrationNo((editing as any).registration_no || '');
      setPatientEmail((editing as any).patient_email || '');
      setPatientAddress((editing as any).patient_address || '');
      setPatientAge(editing.patient_age ? String(editing.patient_age) : '');
      setPatientGender(editing.patient_gender || '');
      setDiagnosis(editing.diagnosis || '');
      setAdvice(editing.advice || '');
      setStartDate(editing.start_date || format(new Date(), 'yyyy-MM-dd'));
      setDays(editing.days ? String(editing.days) : '3');
      setResumeDate(editing.resume_date || '');
      setAddressedTo(editing.addressed_to || 'TO WHOM IT MAY CONCERN');
      setSummary(editing.summary || '');
      setConsultationDate((editing as any).consultation_date || '');
      setAdmissionDate((editing as any).admission_date || '');
      setSurgeryDate((editing as any).surgery_date || '');
      setSurgeryName((editing as any).surgery_name || '');
      setDischargeDate((editing as any).discharge_date || '');
    } else {
      setKind('sick_leave');
      setPatientName(prefill?.patient_name || '');
      setPatientPhone(prefill?.patient_phone || '');
      setRegistrationNo((prefill as any)?.registration_no || '');
      setPatientEmail((prefill as any)?.patient_email || '');
      setPatientAddress((prefill as any)?.patient_address || '');
      setPatientAge(prefill?.patient_age ? String(prefill.patient_age) : '');
      setPatientGender(prefill?.patient_gender || '');
      setDiagnosis(prefill?.diagnosis || '');
      setAdvice('');
      setStartDate(format(new Date(), 'yyyy-MM-dd'));
      setDays('3');
      setResumeDate('');
      setAddressedTo('TO WHOM IT MAY CONCERN');
      setSummary('');
      setConsultationDate(format(new Date(), 'yyyy-MM-dd'));
      setAdmissionDate('');
      setSurgeryDate('');
      setSurgeryName('');
      setDischargeDate('');
    }
  }, [visible, editing, prefill]);

  const computedEnd = useMemo(() => {
    const d = parseInt(days, 10);
    if (!startDate || !d || isNaN(d)) return '';
    try {
      const sd = new Date(startDate);
      sd.setDate(sd.getDate() + Math.max(0, d - 1));
      return format(sd, 'yyyy-MM-dd');
    } catch { return ''; }
  }, [startDate, days]);

  const save = async () => {
    if (!patientName.trim()) {
      Alert.alert('Patient name required');
      return;
    }
    setBusy(true);
    const payload: any = {
      kind,
      patient_name: patientName.trim(),
      patient_phone: patientPhone.trim() || undefined,
      registration_no: registrationNo.trim() || undefined,
      patient_email: patientEmail.trim() || undefined,
      patient_address: patientAddress.trim() || undefined,
      patient_age: patientAge ? parseInt(patientAge, 10) : undefined,
      patient_gender: patientGender || undefined,
      diagnosis: diagnosis.trim(),
      advice: advice.trim(),
      addressed_to: addressedTo.trim(),
      consultation_date: consultationDate || undefined,
      admission_date: admissionDate || undefined,
      surgery_date: surgeryDate || undefined,
      surgery_name: surgeryName.trim() || undefined,
      discharge_date: dischargeDate || undefined,
      status: 'published',
    };
    if (kind === 'sick_leave' || kind === 'unfit_for_duty') {
      payload.start_date = startDate;
      payload.days = parseInt(days, 10) || 0;
      payload.end_date = computedEnd || undefined;
      payload.resume_date = resumeDate || undefined;
    }
    if (kind === 'medical_summary') {
      payload.summary = summary.trim();
    }
    try {
      if (editing?.cert_id) {
        await api.put(`/medical-certificates/${editing.cert_id}`, payload);
      } else {
        await api.post('/medical-certificates', payload);
      }
      onSaved();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || e?.message || 'Could not save certificate.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} testID="medcert-cancel">
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{editing ? 'Edit Certificate' : 'New Certificate'}</Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            {/* Kind picker */}
            <Text style={styles.label}>Certificate type</Text>
            <View style={styles.kindGrid}>
              {KIND_OPTIONS.map((k) => {
                const active = kind === k.value;
                return (
                  <TouchableOpacity
                    key={k.value}
                    style={[styles.kindCard, active && styles.kindCardActive]}
                    onPress={() => setKind(k.value)}
                    testID={`medcert-kind-${k.value}`}
                  >
                    <Ionicons name={k.icon} size={20} color={active ? DOC_THEME.medical_certificate.accent : COLORS.textSecondary} />
                    <Text style={[styles.kindLabel, active && { color: DOC_THEME.medical_certificate.accent }]}>{k.label}</Text>
                    <Text style={styles.kindSub} numberOfLines={2}>{k.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: 18 }]}>Patient identification</Text>
            <Text style={[styles.helper, { marginBottom: 8 }]}>
              Enter phone or registration number — we auto-fetch the rest from your patient database. Clinical fields remain editable below.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 2 }]}
                placeholder="Phone (10 digits)"
                placeholderTextColor={COLORS.textDisabled}
                value={patientPhone}
                onChangeText={setPatientPhone}
                onBlur={() => {
                  if (patientPhone.replace(/\D/g, '').length >= 10) {
                    void tryLookup({ phone: patientPhone });
                  }
                }}
                keyboardType="phone-pad"
                testID="medcert-phone"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Reg. No."
                placeholderTextColor={COLORS.textDisabled}
                value={registrationNo}
                onChangeText={setRegistrationNo}
                onBlur={() => { if (registrationNo.trim().length >= 2) void tryLookup({ registration_no: registrationNo }); }}
                autoCapitalize="characters"
                testID="medcert-regno"
              />
            </View>
            {(looking || lookedMsg) ? (
              <View style={[styles.helper, looking ? { color: COLORS.primary } : null] as any}>
                <Text style={[styles.helper, looking ? { color: COLORS.primary } : null] as any}>
                  {looking ? 'Looking up patient…' : lookedMsg}
                </Text>
              </View>
            ) : null}
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="Full name"
              placeholderTextColor={COLORS.textDisabled}
              value={patientName}
              onChangeText={setPatientName}
              testID="medcert-name"
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Age" placeholderTextColor={COLORS.textDisabled} value={patientAge} onChangeText={setPatientAge} keyboardType="numeric" testID="medcert-age" />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Gender (M/F/O)" placeholderTextColor={COLORS.textDisabled} value={patientGender} onChangeText={setPatientGender} testID="medcert-gender" />
            </View>
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              placeholder="Email (optional)"
              placeholderTextColor={COLORS.textDisabled}
              value={patientEmail}
              onChangeText={setPatientEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              testID="medcert-email"
            />
            <TextInput
              style={[styles.input, { marginTop: 8, minHeight: 50, textAlignVertical: 'top' }]}
              multiline
              placeholder="Address (optional — printed on the certificate)"
              placeholderTextColor={COLORS.textDisabled}
              value={patientAddress}
              onChangeText={setPatientAddress}
              testID="medcert-address"
            />

            <Text style={[styles.label, { marginTop: 18 }]}>Addressed to</Text>
            <TextInput style={styles.input} placeholder="Employer / school / TO WHOM IT MAY CONCERN" placeholderTextColor={COLORS.textDisabled} value={addressedTo} onChangeText={setAddressedTo} testID="medcert-addressee" />

            <Text style={[styles.label, { marginTop: 18 }]}>Diagnosis</Text>
            <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline placeholder="e.g. Acute viral fever with myalgia" placeholderTextColor={COLORS.textDisabled} value={diagnosis} onChangeText={setDiagnosis} testID="medcert-diagnosis" />

            {/* Phase 5.12 — Clinical timeline (optional). All rows
                are independent and only the filled ones appear on
                the printed certificate. */}
            <View style={styles.timelineCard}>
              <Text style={styles.timelineHeader}>Clinical timeline · optional</Text>
              <Text style={styles.timelineSub}>Filled rows appear on the certificate.</Text>

              <Text style={[styles.label, { marginTop: 6 }]}>Date of Consultation</Text>
              <ISODateField
                value={consultationDate}
                onChange={setConsultationDate}
                placeholder="DD-MM-YYYY"
                testID="medcert-consult-date"
              />

              <Text style={[styles.label, { marginTop: 12 }]}>Date of Admission</Text>
              <ISODateField
                value={admissionDate}
                onChange={setAdmissionDate}
                placeholder="DD-MM-YYYY (if admitted)"
                testID="medcert-adm-date"
              />

              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Date of Surgery</Text>
                  <ISODateField
                    value={surgeryDate}
                    onChange={setSurgeryDate}
                    placeholder="DD-MM-YYYY"
                    testID="medcert-surg-date"
                  />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>Name of Surgery</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. TURP, URSL + DJ stenting"
                    placeholderTextColor={COLORS.textDisabled}
                    value={surgeryName}
                    onChangeText={setSurgeryName}
                    testID="medcert-surg-name"
                  />
                </View>
              </View>

              <Text style={[styles.label, { marginTop: 12 }]}>Date of Discharge</Text>
              <ISODateField
                value={dischargeDate}
                onChange={setDischargeDate}
                placeholder="DD-MM-YYYY (if applicable)"
                testID="medcert-disc-date"
              />
            </View>

            {(kind === 'sick_leave' || kind === 'unfit_for_duty') && (
              <>
                <Text style={[styles.label, { marginTop: 18 }]}>Leave period</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                  <View style={{ flex: 2 }}>
                    <ISODateField
                      value={startDate}
                      onChange={setStartDate}
                      placeholder="Start DD-MM-YYYY"
                      testID="medcert-start"
                    />
                  </View>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Days" placeholderTextColor={COLORS.textDisabled} value={days} onChangeText={setDays} keyboardType="numeric" testID="medcert-days" />
                </View>
                <Text style={styles.helper}>End date: <Text style={styles.code}>{computedEnd || '—'}</Text></Text>

                <Text style={[styles.label, { marginTop: 14 }]}>Resume duty on (optional)</Text>
                <ISODateField
                  value={resumeDate}
                  onChange={setResumeDate}
                  placeholder="DD-MM-YYYY"
                  testID="medcert-resume"
                />
              </>
            )}

            {kind === 'medical_summary' && (
              <>
                <Text style={[styles.label, { marginTop: 18 }]}>Summary</Text>
                <TextInput style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]} multiline placeholder="Patient was under my care from … Diagnosed with … Treatment plan …" placeholderTextColor={COLORS.textDisabled} value={summary} onChangeText={setSummary} testID="medcert-summary" />
              </>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18, marginBottom: 6 }}>
              <Text style={styles.label}>Advice (optional)</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                onPress={async () => {
                  if (busy) return;
                  setBusy(true);
                  try {
                    const r = await api.post('/ai/medical-certificate/draft', {
                      kind,
                      diagnosis: diagnosis.trim(),
                      patient_age: patientAge ? parseInt(patientAge, 10) : undefined,
                      patient_gender: patientGender || undefined,
                      days: parseInt(days, 10) || undefined,
                      addressed_to: addressedTo.trim() || undefined,
                    });
                    const draft = (r.data?.advice || '').trim();
                    if (draft) setAdvice(draft);
                  } catch (e: any) {
                    Alert.alert('AI draft failed', e?.response?.data?.detail || 'Please try again.');
                  } finally {
                    setBusy(false);
                  }
                }}
                style={styles.aiBtn}
                testID="medcert-ai-advice"
              >
                <Ionicons name="sparkles" size={12} color="#fff" />
                <Text style={styles.aiBtnText}>Suggest with AI</Text>
              </TouchableOpacity>
            </View>
            <TextInput style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]} multiline placeholder="Bed rest, avoid heavy work, follow-up after 5 days…" placeholderTextColor={COLORS.textDisabled} value={advice} onChangeText={setAdvice} testID="medcert-advice" />

            <View style={{ height: 30 }} />
            <PrimaryButton
              title={busy ? 'Saving…' : editing ? 'Save changes' : 'Issue certificate'}
              icon={<Ionicons name={editing ? 'save' : 'ribbon'} size={18} color="#fff" />}
              onPress={save}
              disabled={busy}
              testID="medcert-save"
            />
            <SecondaryButton title="Cancel" onPress={onClose} style={{ marginTop: 8 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}


/* ── PDF preview ──────────────────────────────────────────────── */

function CertificatePreview({ cert, onClose }: { cert: Certificate | null; onClose: () => void }) {
  if (!cert) return null;

  const openPdf = async () => {
    // Generate a real PDF via the backend WeasyPrint pipeline and
    // hand it to the user (download on web, OS share sheet on
    // native). This deliberately avoids expo-print's printAsync,
    // which opens the system "Print preview" UI that users
    // frequently mistake for a preview-only step and close
    // without saving — they want the PDF file directly.
    // Pull clinic settings so the certificate renders with the
    // doctor's letterhead / signature image / clinic-line that
    // matches the Rx PDF branding.
    let clinic: any = undefined;
    try {
      const cs: any = await fetchClinicSettings();
      clinic = {
        name: cs.clinic_name,
        address: cs.clinic_address || cs.address,
        phone: cs.clinic_phone || cs.phone,
        doctor_name: cs.doctor_name,
        doctor_degrees: cs.doctor_degrees,
        doctor_reg_no: cs.doctor_reg_no,
        letterhead_image_b64: cs.letterhead_image_b64,
        use_letterhead: cs.use_letterhead,
        signature_image_b64: cs.signature_image_b64,
        // Phase 5.20 — for the WhatsApp follow-up prompt.
        country_code: cs.country_code || '+91',
        whatsapp_auto_prompt_enabled: cs.whatsapp_auto_prompt_enabled !== false,
      };
    } catch {
      // Non-fatal — falls back to defaults inside the template.
    }
    const html = generateCertificatePdfHtml(cert, clinic);
    const safeName = (cert.patient_name || 'Patient').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    const filename = `MedicalCertificate-${safeName}-${(cert.cert_id || '').slice(-6) || 'NEW'}.pdf`;
    await sharePdfThenWhatsApp(html, filename, 'Share medical certificate', {
      patientName: cert.patient_name || null,
      patientPhone: (cert as any).patient_phone || null,
      countryCode: clinic?.country_code || '+91',
      docKind: 'medcert',
      followUpDate: (cert as any).resume_date || null,
      doctorName: clinic?.doctor_name || null,
      enabled: clinic?.whatsapp_auto_prompt_enabled !== false,
    });
  };

  return (
    <Modal visible={!!cert} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn} testID="medcert-preview-close">
            <Ionicons name="close" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Preview · {kindLabel(cert.kind)}</Text>
          </View>
          <TouchableOpacity onPress={openPdf} style={styles.previewPrintBtn} testID="medcert-preview-print">
            <Ionicons name="share" size={16} color="#fff" />
            <Text style={{ ...FONTS.bodyMedium, color: '#fff', fontSize: 12 }}>Share PDF</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View style={styles.previewCard}>
            <View style={[styles.previewStrip, { backgroundColor: DOC_THEME.medical_certificate.accent }]} />
            <Text style={[styles.previewKind, { color: DOC_THEME.medical_certificate.accent }]}>
              {kindLabel(cert.kind).toUpperCase()}
            </Text>
            <View style={styles.previewPatientBox}>
              <Text style={styles.previewPatientLine}>
                <Text style={styles.previewPatientKey}>Patient: </Text>{cert.patient_name || '—'}
                {cert.registration_no ? `   ·   Reg. No. ${cert.registration_no}` : ''}
              </Text>
              <Text style={styles.previewPatientLine}>
                <Text style={styles.previewPatientKey}>Age/Gender: </Text>
                {cert.patient_age ? `${cert.patient_age} y` : '—'}{cert.patient_gender ? ` / ${cert.patient_gender}` : ''}
                {cert.patient_phone ? `   ·   Phone ${cert.patient_phone}` : ''}
              </Text>
              {(cert as any).patient_address ? (
                <Text style={styles.previewPatientLine}>
                  <Text style={styles.previewPatientKey}>Address: </Text>{(cert as any).patient_address}
                </Text>
              ) : null}
            </View>
            <Text style={styles.previewAddressee}>{cert.addressed_to || 'TO WHOM IT MAY CONCERN'}</Text>
            <Text style={styles.previewBody}>
              This is to certify that <Text style={styles.bold}>{cert.patient_name}</Text>
              {cert.patient_age ? `, ${cert.patient_age} years` : ''}
              {cert.patient_gender ? ` (${cert.patient_gender})` : ''}
              {cert.kind === 'sick_leave'
                ? ` was examined by me and is advised rest from ${cert.start_date} for ${cert.days} day${(cert.days || 0) === 1 ? '' : 's'} due to ${cert.diagnosis || 'medical reasons'}.`
                : cert.kind === 'unfit_for_duty'
                  ? ` is currently unfit for duty due to ${cert.diagnosis || 'medical reasons'} for ${cert.days} day${(cert.days || 0) === 1 ? '' : 's'} from ${cert.start_date}.`
                  : cert.kind === 'fitness'
                    ? ` has been examined and is fit to resume normal activities.`
                    : ` was under my medical care. ${cert.summary || ''}`}
            </Text>
            {cert.advice ? (
              <Text style={styles.previewAdvice}>Advice: {cert.advice}</Text>
            ) : null}
            <View style={{ height: 18 }} />
            <Text style={styles.previewDoctor}>{cert.doctor_name || cert.issued_by_name}</Text>
            {cert.doctor_reg_no ? (
              <Text style={styles.previewRegNo}>Reg. No. {cert.doctor_reg_no}</Text>
            ) : null}
            <Text style={styles.previewDate}>{cert.created_at ? format(new Date(cert.created_at), 'd MMM yyyy') : ''}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}


/* ── Styles ──────────────────────────────────────────────── */

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  bannerStrip: { width: 4, height: 56, borderRadius: 2 },
  bannerTitle: { ...FONTS.bodyMedium, fontSize: 14, marginBottom: 2 },
  bannerBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },

  empty: { padding: 28, alignItems: 'center', backgroundColor: '#fff', borderRadius: RADIUS.md, gap: 6 },
  emptyTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  emptyBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md,
    marginBottom: 10, borderWidth: 1, borderColor: COLORS.border,
  },
  rowStrip: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rowMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  rowBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary + '12' },

  label: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 6 },
  input: {
    padding: 10, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, backgroundColor: '#fff',
    color: COLORS.textPrimary, fontSize: 13,
  },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  code: { fontFamily: 'monospace' as any, color: COLORS.primary, fontSize: 12 },

  // Phase 5.12 — Clinical timeline card on the composer
  timelineCard: {
    marginTop: 18,
    padding: 12,
    backgroundColor: DOC_THEME.medical_certificate.accent + '0A',
    borderWidth: 1,
    borderColor: DOC_THEME.medical_certificate.accent + '33',
    borderRadius: RADIUS.md,
  },
  timelineHeader: {
    ...FONTS.label,
    color: DOC_THEME.medical_certificate.accent,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  timelineSub: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 2,
    marginBottom: 8,
  },

  // Phase 5.12 — AI assist button
  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: DOC_THEME.medical_certificate.accent,
  },
  aiBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11 },

  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindCard: {
    flexBasis: '48%', flexGrow: 1,
    padding: 10, borderRadius: RADIUS.md, borderWidth: 1,
    borderColor: COLORS.border, backgroundColor: '#fff', gap: 4,
  },
  kindCardActive: {
    borderColor: DOC_THEME.medical_certificate.accent,
    backgroundColor: DOC_THEME.medical_certificate.accent + '10',
  },
  kindLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginTop: 2 },
  kindSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, lineHeight: 15 },

  previewPrintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: DOC_THEME.medical_certificate.accent, borderRadius: RADIUS.pill,
  },

  previewCard: {
    padding: 24, backgroundColor: '#fff',
    borderRadius: RADIUS.md, borderTopWidth: 4,
    borderTopColor: DOC_THEME.medical_certificate.accent,
    minHeight: 480,
  },
  previewStrip: { display: 'none' as any },  // strip moved to borderTopColor
  previewKind: { ...FONTS.h3, fontSize: 14, letterSpacing: 1.5, marginBottom: 14 },
  previewAddressee: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 16 },
  previewPatientBox: {
    padding: 10,
    backgroundColor: DOC_THEME.medical_certificate.accent + '0A',
    borderWidth: 1,
    borderColor: DOC_THEME.medical_certificate.accent + '33',
    borderRadius: 6,
    marginBottom: 14,
    gap: 4,
  },
  previewPatientLine: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },
  previewPatientKey: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 11 },
  previewBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, lineHeight: 21 },
  previewAdvice: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, marginTop: 14, fontStyle: 'italic' },
  previewDoctor: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginTop: 30 },
  previewRegNo: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  previewDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  bold: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
});
