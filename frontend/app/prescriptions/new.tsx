/**
 * Prescription / Consultation composer (Urology-specific).
 *
 * Structured into 11 sections with subsections so staff and the doctor can
 * pre-fill the parts they own:
 *   1. Patient Details   (Name · Age/Sex · Phone · Address · Visit · Reg · Ref)
 *   2. Vitals            (Pulse · BP)
 *   3. Chief Complaints
 *   4. Recent IPSS
 *   5. Examination       (P/A · Ext Genitalia · EUM · Testis · DRE)
 *   6. Investigations    (Blood · PSA · USG · Uroflow · CT · MRI · PET)
 *   7. Findings & Diagnosis
 *   8. Medications
 *   9. Investigations Advised
 *  10. Advice
 *  11. Follow-up
 *
 * Workflow:
 *   - Reception / nursing / assistant tap "Save Draft" → status='draft'.
 *   - Doctor taps "Save & Generate Rx" → status='final', PDF is generated.
 *
 * Pre-fill from a confirmed booking via ?bookingId=bk_xxx so patient
 * identity / reason / reg_no / address all flow into the new Rx.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { PrimaryButton, SecondaryButton } from '../../src/components';
import { displayDate, todayUI, parseUIDate, parseBackendDate, formatIST } from '../../src/date';
import { goBackSafe } from '../../src/nav';
import { DateField } from '../../src/date-picker';
import {
  downloadPrescriptionPdf,
  loadClinicSettings,
  ClinicSettings,
} from '../../src/rx-pdf-lazy';
import { MedicineAutocomplete, CatalogMedicine } from '../../src/medicine-autocomplete';
import { haptics } from '../../src/haptics';
import { useAuth } from '../../src/auth';
import { clearRxDraft, loadRxDraft, scheduleSaveRxDraft } from '../../src/rx-draft';
import { useScreenBg } from '../../src/dark-mode';
import { getAllergies, listRxTemplates, RxTemplate } from '../../src/wave1/api';
import { useUnsavedFormGuard } from '../../src/use-unsaved-form-guard';
import { VoiceDictationSheetLazy as VoiceDictationSheet } from '../../src/voice-dictation-sheet-lazy';
import type { VoiceToRxResult } from '../../src/wave3/api';
import { aiSuggestRx, type RxSuggestion } from '../../src/wave4/api';
import { enqueueRxDraft, isNetworkError } from '../../src/offline-rx-queue';

type Med = {
  name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
  timing?: string;
};

const FREQ_PRESETS = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS', 'Q4H', 'Q6H', 'Q8H'];
const TIMING_PRESETS = ['Before food', 'After food', 'Empty stomach', 'With water'];

const EMPTY_MED: Med = { name: '', dosage: '', frequency: '', duration: '', instructions: '', timing: '' };

export default function NewPrescription() {
  const __darkBg = useScreenBg();
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ rxId?: string; view?: string; bookingId?: string; prefill?: string; encounterId?: string }>();
  const editId = (params.rxId || params.view || '') as string;
  const bookingId = (params.bookingId || '') as string;
  const encounterId = (params.encounterId || '') as string;
  const wantRxDraftPrefill = (params.prefill || '') === 'rx_draft';
  const isEdit = !!editId;
  const isFromBooking = !!bookingId && !isEdit;

  // Role / permission helpers — controls which sections render & save flow.
  // Hierarchy: Primary Owner & Partner = full access (all fields unlocked).
  // Other team members (Doctor / Nursing / Reception / Assistant / etc.)
  // get clinical-section access ONLY when the Primary Owner / Partner has
  // explicitly enabled their `can_prescribe` flag in the Permission
  // Manager → Team Roles & Access screen.
  const isOwnerOrPartner =
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner'; // legacy alias
  const isPrescriber = isOwnerOrPartner || !!user?.can_prescribe;

  // ---- Patient Details
  const [patientName, setPatientName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other' | ''>('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [regNo, setRegNo] = useState('');
  const [regNoAuto, setRegNoAuto] = useState(true);
  const [refDr, setRefDr] = useState('');
  const [visitDate, setVisitDate] = useState(todayUI());
  // ---- Vitals
  const [pulse, setPulse] = useState('');
  const [bp, setBp] = useState('');
  // ---- Clinical narrative
  const [complaints, setComplaints] = useState('');
  const [ipss, setIpss] = useState('');
  // ---- Examination subsections
  const [exPa, setExPa] = useState('');
  const [exGen, setExGen] = useState('');
  const [exEum, setExEum] = useState('');
  const [exTestis, setExTestis] = useState('');
  const [exDre, setExDre] = useState('');
  // ---- Investigations subsections
  const [invBlood, setInvBlood] = useState('');
  const [invPsa, setInvPsa] = useState('');
  const [invUsg, setInvUsg] = useState('');
  const [invUroflow, setInvUroflow] = useState('');
  const [invCt, setInvCt] = useState('');
  const [invMri, setInvMri] = useState('');
  const [invPet, setInvPet] = useState('');
  // ---- Diagnosis & plan
  const [diagnosis, setDiagnosis] = useState('');
  const [meds, setMeds] = useState<Med[]>([{ ...EMPTY_MED }]);
  const [investigationsAdvised, setInvestigationsAdvised] = useState('');
  const [advice, setAdvice] = useState('');
  const [followUp, setFollowUp] = useState('');
  // ---- Workflow / state
  const [status, setStatus] = useState<'draft' | 'final'>('final');
  const [createdByName, setCreatedByName] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [loadingRx, setLoadingRx] = useState(isEdit);
  const [settings, setSettings] = useState<ClinicSettings>({});

  // ── Wave 1 (D) — Allergies banner & (C) Rx templates ─────────────
  const [pxAllergies, setPxAllergies] = useState<string[]>([]);
  const [allergyNotes, setAllergyNotes] = useState<string>('');
  const [templates, setTemplates] = useState<RxTemplate[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Refresh allergies whenever the phone changes (incl. paste).
  useEffect(() => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 7) { setPxAllergies([]); setAllergyNotes(''); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await getAllergies(digits);
        if (!cancelled) {
          setPxAllergies(r.allergies || []);
          setAllergyNotes(r.notes || '');
        }
      } catch { /* no profile yet → no warning */ }
    })();
    return () => { cancelled = true; };
  }, [phone]);

  // Load templates once for the "Apply" picker.
  useEffect(() => {
    (async () => {
      try { setTemplates(await listRxTemplates()); } catch {}
    })();
  }, []);

  const applyTemplate = (t: RxTemplate) => {
    if (t.diagnosis) setDiagnosis(t.diagnosis);
    if (t.investigations) setInvestigationsAdvised(t.investigations);
    if (t.advice) setAdvice(t.advice);
    if (t.follow_up) setFollowUp(t.follow_up);
    if ((t.medicines || []).length > 0) {
      const mapped = t.medicines.map((m): Med => ({
        name: m.name || '',
        dosage: m.dose || '',
        frequency: m.frequency || '',
        duration: m.duration || '',
        instructions: m.instructions || '',
      }));
      setMeds(mapped);
    }
    setShowTemplatePicker(false);
    haptics?.success?.();
  };

  // ── Wave 2 (I) — Unsaved form guard ──────────────────────────────
  // Heuristic: treat the form as "dirty" if any meaningful field has been
  // edited away from its initial blank. We deliberately don't compute
  // a full diff against the loaded draft — the bar should be low so the
  // user is never surprised by an accidental discard.
  const isDirty = useMemo(() => {
    if (saving) return false;        // mid-save, navigation is intentional
    if (loadingRx) return false;     // initial load, ignore
    return Boolean(
      (patientName || '').trim() ||
      (phone || '').trim() ||
      (diagnosis || '').trim() ||
      (advice || '').trim() ||
      (followUp || '').trim() ||
      (investigationsAdvised || '').trim() ||
      (meds || []).some((m) => (m.name || '').trim()),
    );
  }, [
    saving, loadingRx,
    patientName, phone, diagnosis, advice, followUp, investigationsAdvised, meds,
  ]);
  const guard = useUnsavedFormGuard(isDirty, {
    title: 'Discard this Rx?',
    message: 'You have unsaved changes. Going back will discard them.',
    confirmText: 'Discard',
    cancelText: 'Keep editing',
  });

  // ── Wave 3 (M) — Voice-to-Rx dictation ───────────────────────────
  const [voiceOpen, setVoiceOpen] = useState(false);
  const applyVoiceResult = (r: VoiceToRxResult) => {
    const p = r.parsed || ({} as VoiceToRxResult['parsed']);
    if (p.diagnosis) setDiagnosis(p.diagnosis);
    if (p.investigations) setInvestigationsAdvised(p.investigations);
    if (p.advice) setAdvice(p.advice);
    if (p.follow_up) setFollowUp(p.follow_up);
    if ((p.medicines || []).length > 0) {
      const mapped: Med[] = p.medicines.map((m) => ({
        name: m.name || '',
        dosage: m.dose || '',
        frequency: m.frequency || '',
        duration: m.duration || '',
        instructions: m.instructions || '',
      }));
      // Replace blank starter row but append if there's already content.
      setMeds((prev) => {
        const onlyBlank = prev.length === 1 && !(prev[0]?.name || '').trim();
        return onlyBlank ? mapped : [...prev, ...mapped];
      });
    }
  };

  // ── Wave 4 (O) — AI Rx suggestion ────────────────────────────────
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<RxSuggestion | null>(null);
  const requestAiSuggestion = async () => {
    if (!(diagnosis || '').trim()) {
      haptics?.warning?.();
      return;
    }
    setAiSuggesting(true);
    try {
      const r = await aiSuggestRx({
        diagnosis,
        age: age ? Number(age) : null,
        sex: gender || null,
        allergies: pxAllergies,
        notes: '',
      });
      setAiSuggestion(r);
      haptics?.success?.();
    } catch (e: any) {
      haptics?.error?.();
    } finally {
      setAiSuggesting(false);
    }
  };
  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.investigations) setInvestigationsAdvised(aiSuggestion.investigations);
    if (aiSuggestion.advice) setAdvice(aiSuggestion.advice);
    if (aiSuggestion.follow_up) setFollowUp(aiSuggestion.follow_up);
    if ((aiSuggestion.medicines || []).length > 0) {
      const mapped: Med[] = aiSuggestion.medicines.map((m) => ({
        name: m.name || '',
        dosage: m.dose || '',
        frequency: m.frequency || '',
        duration: m.duration || '',
        instructions: m.instructions || '',
      }));
      setMeds((prev) => {
        const onlyBlank = prev.length === 1 && !(prev[0]?.name || '').trim();
        return onlyBlank ? mapped : [...prev, ...mapped];
      });
    }
    setAiSuggestion(null);
    haptics?.success?.();
  };

  useEffect(() => {
    loadClinicSettings().then(setSettings);
  }, []);

  // Pre-fill from a confirmed booking — "Start Consultation" flow.
  // Also resume any existing draft for that booking so we never duplicate.
  useEffect(() => {
    if (!isFromBooking) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/${bookingId}`);
        if (cancelled) return;
        if (data?.patient_name) setPatientName(data.patient_name);
        if (data?.patient_age != null) setAge(String(data.patient_age));
        if (data?.patient_gender) setGender(data.patient_gender as any);
        if (data?.patient_phone) setPhone(data.patient_phone);
        if (data?.patient_address) setAddress(data.patient_address);
        if (data?.registration_no) {
          setRegNo(data.registration_no);
          setRegNoAuto(false);
        }
        if (data?.reason && !complaints) setComplaints(data.reason);
        if (data?.booking_date) {
          setVisitDate(displayDate(data.booking_date) || todayUI());
        }
        // If a draft already exists for this booking, redirect to edit-mode
        // so we don't create duplicate consultation rows.
        if (data?.draft_rx_id) {
          router.replace(`/prescriptions/new?rxId=${data.draft_rx_id}` as any);
        }
      } catch {
        // Non-fatal — staff/doctor can still fill manually
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFromBooking, bookingId]);

  // Load existing Rx when in edit mode (works for both drafts and final)
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const { data } = await api.get(`/prescriptions/${editId}`);
        setPatientName(data.patient_name || '');
        setAge(data.patient_age != null ? String(data.patient_age) : '');
        setGender((data.patient_gender || '') as any);
        setPhone(data.patient_phone || '');
        setAddress(data.patient_address || '');
        setRegNo(data.registration_no || '');
        setRegNoAuto(false);
        setRefDr(data.ref_doctor || '');
        const vd = data.visit_date || '';
        setVisitDate(displayDate(vd) || vd || todayUI());
        // Vitals: if new fields missing fall back to legacy `vitals`
        setPulse(data.vitals_pulse || '');
        setBp(data.vitals_bp || '');
        // legacy single-line vitals → if no pulse/bp parsed, dump into pulse box
        if (!data.vitals_pulse && !data.vitals_bp && data.vitals) {
          const m = String(data.vitals).match(/BP[:\s]*([\d/]+)/i);
          if (m) setBp(m[1]); else setBp(data.vitals);
        }
        setComplaints(data.chief_complaints || '');
        setIpss(data.ipss_recent || '');
        setExPa(data.exam_pa || '');
        setExGen(data.exam_ext_genitalia || '');
        setExEum(data.exam_eum || '');
        setExTestis(data.exam_testis || '');
        setExDre(data.exam_dre || '');
        setInvBlood(data.inv_blood || '');
        setInvPsa(data.inv_psa || '');
        setInvUsg(data.inv_usg || '');
        setInvUroflow(data.inv_uroflowmetry || '');
        setInvCt(data.inv_ct || '');
        setInvMri(data.inv_mri || '');
        setInvPet(data.inv_pet || '');
        // legacy: investigation_findings fallback
        if (!data.inv_blood && !data.inv_psa && data.investigation_findings) {
          setInvBlood(data.investigation_findings);
        }
        setDiagnosis(data.diagnosis || '');
        setInvestigationsAdvised(data.investigations_advised || '');
        setAdvice(data.advice || '');
        setFollowUp(data.follow_up || '');
        const loadedMeds = (data.medicines || []).map((m: any) => ({
          name: m.name || '',
          dosage: m.dosage || '',
          frequency: m.frequency || '',
          duration: m.duration || '',
          instructions: m.instructions || '',
          timing: m.timing || '',
        }));
        setMeds(loadedMeds.length ? loadedMeds : [{ ...EMPTY_MED }]);
        setStatus(((data.status || 'final') as 'draft' | 'final'));
        setCreatedByName(data.created_by_name || '');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not load prescription';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Error', msg);
        goBackSafe(router, '/dashboard');
      } finally {
        setLoadingRx(false);
      }
    })();
    // eslint-disable-next-line
  }, [editId]);

  // Phone lookup auto-fills reg + name (only in create mode)
  useEffect(() => {
    if (isEdit) return;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) return;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/patients/lookup', { params: { phone: digits } });
        if (data?.found) {
          if (!regNo || regNoAuto) {
            setRegNo(data.reg_no || '');
            setRegNoAuto(true);
          }
          if (!patientName && data.name) setPatientName(data.name);
        }
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [phone]); // eslint-disable-line

  // ── Phase E — Encounter prefill ───────────────────────────────────
  // Navigated from an Encounter detail via ?encounterId=enc_xxx: pull
  // the encounter and prefill patient identity + complaint + diagnosis.
  useEffect(() => {
    if (!encounterId || isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/encounters/${encounterId}`);
        if (cancelled || !data) return;
        if (data.patient_name) setPatientName(data.patient_name);
        if (data.patient_phone) setPhone(data.patient_phone);
        if (data.patient_age) setAge(data.patient_age);
        if (data.patient_sex) setGender(data.patient_sex as any);
        if (data.chief_complaint) setComplaints(data.chief_complaint);
        if (Array.isArray(data.diagnoses) && data.diagnoses.length) {
          setDiagnosis(data.diagnoses.join(', '));
        } else if (data.assessment) {
          setDiagnosis(data.assessment);
        }
        if (data.plan) setAdvice((cur: string) => cur || data.plan);
      } catch { /* silent — encounter prefill is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [encounterId, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMed = () => setMeds([...meds, { ...EMPTY_MED }]);
  const removeMed = (i: number) => setMeds(meds.filter((_, idx) => idx !== i));
  const updateMed = (i: number, k: keyof Med, v: string) => {
    const copy = [...meds];
    copy[i] = { ...copy[i], [k]: v };
    setMeds(copy);
  };

  // ── Bundle E — Server-side Rx draft prefill ──────────────────────
  // When navigated here from the AutoSummaryCard with ?prefill=rx_draft,
  // fetch the booking's saved rx_draft (Gemini-generated) and overlay
  // it on whatever the booking-prefill effect already populated.
  useEffect(() => {
    if (!wantRxDraftPrefill || !bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get(`/video/bookings/${bookingId}/rx-draft`);
        const d = r.data?.rx_draft || {};
        if (cancelled || !d || !Object.keys(d).length) return;
        // Small delay so booking-prefill finishes first, then we
        // overlay the AI suggestions.
        setTimeout(() => {
          if (cancelled) return;
          if (d.complaints) setComplaints(d.complaints);
          if (d.diagnosis) setDiagnosis(d.diagnosis);
          if (d.investigationsAdvised) setInvestigationsAdvised(d.investigationsAdvised);
          if (d.advice) setAdvice(d.advice);
          if (d.followUp) setFollowUp(d.followUp);
          if (Array.isArray(d.meds) && d.meds.length) {
            // Map server med shape to local Med shape
            setMeds(d.meds.map((m: any) => ({
              name: m.name || '',
              strength: m.strength || '',
              frequency: m.frequency || '',
              duration: m.duration || '',
              instructions: m.instructions || '',
            })));
          }
        }, 250);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [wantRxDraftPrefill, bookingId]);

  // ── Offline draft persistence ─────────────────────────────────────
  // Saves the entire form snapshot to AsyncStorage (keyed per booking)
  // so a doctor on a flaky/offline connection doesn't lose work. Auto-
  // restores on next mount if a draft exists. Cleared once the rx is
  // successfully saved to the server.
  const [draftRestoredAt, setDraftRestoredAt] = useState<string | null>(null);
  // On mount — check for a local draft (only in create-from-booking
  // mode, not edit-mode which already has server state).
  useEffect(() => {
    if (!isFromBooking || !bookingId) return;
    let cancelled = false;
    (async () => {
      const d = await loadRxDraft(bookingId);
      if (cancelled || !d) return;
      // Small delay so the booking pre-fill effect finishes first; our
      // draft values override pre-fill where present.
      setTimeout(() => {
        if (cancelled) return;
        if (d.patientName) setPatientName(d.patientName);
        if (d.age) setAge(d.age);
        if (d.gender) setGender(d.gender);
        if (d.phone) setPhone(d.phone);
        if (d.address) setAddress(d.address);
        if (d.regNo) setRegNo(d.regNo);
        if (typeof d.regNoAuto === 'boolean') setRegNoAuto(d.regNoAuto);
        if (d.refDr) setRefDr(d.refDr);
        if (d.visitDate) setVisitDate(d.visitDate);
        if (d.pulse) setPulse(d.pulse);
        if (d.bp) setBp(d.bp);
        if (d.complaints) setComplaints(d.complaints);
        if (d.ipss) setIpss(d.ipss);
        if (d.exPa) setExPa(d.exPa);
        if (d.exGen) setExGen(d.exGen);
        if (d.exEum) setExEum(d.exEum);
        if (d.exTestis) setExTestis(d.exTestis);
        if (d.exDre) setExDre(d.exDre);
        if (d.invBlood) setInvBlood(d.invBlood);
        if (d.invPsa) setInvPsa(d.invPsa);
        if (d.invUsg) setInvUsg(d.invUsg);
        if (d.invUroflow) setInvUroflow(d.invUroflow);
        if (d.invCt) setInvCt(d.invCt);
        if (d.invMri) setInvMri(d.invMri);
        if (d.invPet) setInvPet(d.invPet);
        if (d.diagnosis) setDiagnosis(d.diagnosis);
        if (Array.isArray(d.meds) && d.meds.length > 0) setMeds(d.meds);
        if (d.investigationsAdvised) setInvestigationsAdvised(d.investigationsAdvised);
        if (d.advice) setAdvice(d.advice);
        if (d.followUp) setFollowUp(d.followUp);
        setDraftRestoredAt(d._savedAt || null);
      }, 350);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFromBooking, bookingId]);

  // Auto-save on EVERY meaningful change (debounced inside helper).
  // Note: we key the draft per booking — if there's no bookingId
  // (free-form Rx), we don't persist.
  useEffect(() => {
    if (!bookingId || isEdit) return;
    scheduleSaveRxDraft(bookingId, {
      patientName, age, gender, phone, address, regNo, regNoAuto, refDr, visitDate,
      pulse, bp, complaints, ipss,
      exPa, exGen, exEum, exTestis, exDre,
      invBlood, invPsa, invUsg, invUroflow, invCt, invMri, invPet,
      diagnosis, meds, investigationsAdvised, advice, followUp,
    });
  }, [
    bookingId, isEdit,
    patientName, age, gender, phone, address, regNo, regNoAuto, refDr, visitDate,
    pulse, bp, complaints, ipss,
    exPa, exGen, exEum, exTestis, exDre,
    invBlood, invPsa, invUsg, invUroflow, invCt, invMri, invPet,
    diagnosis, meds, investigationsAdvised, advice, followUp,
  ]);

  const applyCatalogMedicine = (i: number, m: CatalogMedicine) => {
    const cur = meds[i];
    const next: Med = {
      name: m.name,
      dosage: cur.dosage?.trim() || m.dosage || '',
      frequency: cur.frequency?.trim() || m.frequency || '',
      duration: cur.duration?.trim() || m.duration || '',
      timing: cur.timing?.trim() || m.timing || '',
      instructions: cur.instructions?.trim() || m.instructions || '',
    };
    const copy = [...meds];
    copy[i] = next;
    setMeds(copy);
  };

  const buildPayload = (intendedStatus: 'draft' | 'final') => {
    const isoVisit = parseUIDate(visitDate);
    return {
      patient_name: patientName,
      patient_age: age ? parseInt(age, 10) : undefined,
      patient_gender: gender || undefined,
      patient_phone: phone || undefined,
      patient_address: address || undefined,
      registration_no: regNo || undefined,
      ref_doctor: refDr || undefined,
      visit_date: isoVisit || visitDate,
      // Vitals: keep legacy `vitals` mirror for older readers
      vitals: [pulse && `Pulse: ${pulse}`, bp && `BP: ${bp}`].filter(Boolean).join(' · ') || undefined,
      vitals_pulse: pulse || undefined,
      vitals_bp: bp || undefined,
      chief_complaints: complaints || '',
      ipss_recent: ipss || undefined,
      // Examination
      exam_pa: exPa || undefined,
      exam_ext_genitalia: exGen || undefined,
      exam_eum: exEum || undefined,
      exam_testis: exTestis || undefined,
      exam_dre: exDre || undefined,
      // Investigations
      inv_blood: invBlood || undefined,
      inv_psa: invPsa || undefined,
      inv_usg: invUsg || undefined,
      inv_uroflowmetry: invUroflow || undefined,
      inv_ct: invCt || undefined,
      inv_mri: invMri || undefined,
      inv_pet: invPet || undefined,
      // legacy mirror for backward compat — concatenate the populated rows
      investigation_findings: [
        invBlood && `Blood: ${invBlood}`,
        invPsa && `PSA: ${invPsa}`,
        invUsg && `USG: ${invUsg}`,
        invUroflow && `Uroflowmetry: ${invUroflow}`,
        invCt && `CT: ${invCt}`,
        invMri && `MRI: ${invMri}`,
        invPet && `PET: ${invPet}`,
      ].filter(Boolean).join('\n') || undefined,
      diagnosis: diagnosis || '',
      medicines: meds.filter((m) => m.name),
      investigations_advised: investigationsAdvised || undefined,
      advice: advice || '',
      follow_up: followUp || '',
      status: intendedStatus,
      source_booking_id: bookingId || undefined,
    };
  };

  const validateForFinal = (): string | null => {
    if (!patientName.trim()) return 'Patient name is required.';
    if (!complaints.trim()) return 'Chief complaints are required.';
    // Medicines are now OPTIONAL: some prescriptions are purely
    // advisory (admission recommended, reassurance, lifestyle guidance,
    // investigation-only). Per Dr. Joshi's request — relax this check.
    return null;
  };

  const validateForDraft = (): string | null => {
    if (!patientName.trim()) return 'Patient name is required.';
    return null;
  };

  const saveRx = async (intendedStatus: 'draft' | 'final'): Promise<any | null> => {
    const v = intendedStatus === 'final' ? validateForFinal() : validateForDraft();
    if (v) {
      Alert.alert('Missing info', v);
      return null;
    }
    setSaving(true);
    try {
      const body = buildPayload(intendedStatus);
      const { data } = isEdit
        ? await api.put(`/prescriptions/${editId}`, body)
        : await api.post('/prescriptions', body);
      const savedRegNo = data?.registration_no || regNo;
      if (savedRegNo && savedRegNo !== regNo) setRegNo(savedRegNo);
      if (data?.status) setStatus(data.status);
      // Offline draft is now obsolete — the server has a copy.
      if (bookingId) clearRxDraft(bookingId).catch(() => {});
      // Phase E — two-way link back to the source encounter.
      if (encounterId && !isEdit && data?.prescription_id) {
        api.post(`/encounters/${encounterId}/link-rx`, { prescription_id: data.prescription_id }).catch(() => {});
      }
      // Tell the unsaved-form guard that the user is allowed to leave.
      guard.bypass();
      haptics.success();
      return data;
    } catch (e: any) {
      // Wave 6 (BB) — Offline Rx queue. If the failure is a pure
      // network error AND this is a new (not edit) Rx, stash it
      // locally so it auto-uploads when connectivity returns.
      if (!isEdit && isNetworkError(e)) {
        try {
          const body = buildPayload(intendedStatus);
          await enqueueRxDraft(body);
          guard.bypass();
          haptics.success();
          Alert.alert(
            'Saved offline',
            'No internet right now — this prescription is queued and will upload automatically when you\u2019re back online.',
          );
          return { __offline: true };
        } catch {
          // fall through to error UI
        }
      }
      haptics.error();
      Alert.alert('Error', e?.response?.data?.detail || 'Could not save');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    const data = await saveRx('draft');
    if (data && !data.__offline) {
      Alert.alert(
        'Draft saved',
        'Doctor can now resume and finalise this consultation from the Consults tab.',
        [{ text: 'OK', onPress: () => goBackSafe(router, '/dashboard') }]
      );
    } else if (data?.__offline) {
      goBackSafe(router, '/dashboard');
    }
  };

  const handleSaveAndPdf = async () => {
    const data = await saveRx('final');
    if (!data) return;
    if (data.__offline) {
      // Offline path — PDF needs the server; user will print after sync.
      goBackSafe(router, '/dashboard');
      return;
    }
    try {
      await downloadPrescriptionPdf(data, settings);
    } catch (e: any) {
      Alert.alert('PDF error', e?.message || 'Could not generate PDF');
    }
    goBackSafe(router, '/dashboard');
  };

  const handleSaveOnly = async () => {
    const data = await saveRx('final');
    if (data) goBackSafe(router, '/dashboard');
  };

  if (loadingRx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: __darkBg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 12 }}>Loading prescription…</Text>
      </SafeAreaView>
    );
  }

  const screenTitle = isEdit
    ? (status === 'draft' ? (isPrescriber ? 'Resume Consultation' : 'Edit Draft') : 'Edit Prescription')
    : (isFromBooking ? 'Start Consultation' : 'New Prescription');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: __darkBg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => goBackSafe(router, '/dashboard')} style={styles.backBtn} testID="rx-form-back">
          <Ionicons name="close" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{screenTitle}</Text>
          <Text style={styles.subTitle} numberOfLines={2}>
            {isPrescriber
              ? 'Sectioned form — fill what applies; empty fields are hidden in the PDF.'
              : 'Fill patient details, vitals, complaints & IPSS. Doctor finalises the rest.'}
          </Text>
        </View>
        {status === 'draft' && (
          <View style={styles.draftPill}>
            <Ionicons name="bookmark" size={12} color={COLORS.warning} />
            <Text style={styles.draftPillText}>DRAFT</Text>
          </View>
        )}
      </View>

      {!!createdByName && status === 'draft' && (
        <View style={styles.draftBanner}>
          <Ionicons name="information-circle" size={16} color={COLORS.primary} />
          <Text style={styles.draftBannerText}>
            Draft started by <Text style={{ fontWeight: '700' }}>{createdByName}</Text>
            {isPrescriber ? ' — review & complete to issue Rx.' : ' — you can keep editing.'}
          </Text>
        </View>
      )}

      {/* Offline draft restored banner — shown when the doctor resumes
          a consultation that was partially typed while offline or from
          a prior app session. */}
      {!!draftRestoredAt && (
        <View style={[styles.draftBanner, { borderColor: '#10B981', backgroundColor: '#10B98115' }]}>
          <Ionicons name="cloud-offline-outline" size={16} color="#10B981" />
          <Text style={[styles.draftBannerText, { color: '#0A7E5A' }]}>
            Offline draft restored (auto-saved {formatIST(parseBackendDate(draftRestoredAt))}). Save to finalize.
          </Text>
          <TouchableOpacity
            onPress={() => { if (bookingId) clearRxDraft(bookingId); setDraftRestoredAt(null); }}
            style={{ marginLeft: 8 }}
            accessibilityLabel="Dismiss draft notice"
          >
            <Ionicons name="close" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Wave 1 (D) — Allergies banner */}
          {pxAllergies.length > 0 && (
            <TouchableOpacity
              onPress={() =>
                router.push(`/patient-allergies?phone=${encodeURIComponent(phone || '')}&name=${encodeURIComponent(patientName || '')}` as any)
              }
              activeOpacity={0.85}
              style={styles.allergyBanner}
              testID="rx-allergy-banner"
            >
              <Ionicons name="warning" size={20} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.allergyBannerTitle}>
                  Allergies: {pxAllergies.join(', ')}
                </Text>
                {allergyNotes ? (
                  <Text style={styles.allergyBannerSub} numberOfLines={2}>{allergyNotes}</Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </TouchableOpacity>
          )}

          {/* Wave 1 (C) + Wave 3 (M) — Quick-action row: template apply + voice dictate */}
          <View style={styles.quickActionRow}>
            {templates.length > 0 ? (
              <TouchableOpacity
                onPress={() => setShowTemplatePicker(true)}
                style={styles.templateBtn}
                activeOpacity={0.8}
                testID="rx-apply-template"
              >
                <Ionicons name="flash" size={16} color={COLORS.primary} />
                <Text style={styles.templateBtnText}>
                  Apply template ({templates.length})
                </Text>
                <Ionicons name="chevron-down" size={14} color={COLORS.primary} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setVoiceOpen(true)}
              style={styles.voiceBtn}
              activeOpacity={0.8}
              testID="rx-voice-dictate"
            >
              <Ionicons name="mic" size={16} color="#fff" />
              <Text style={styles.voiceBtnText}>Voice → Rx</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={requestAiSuggestion}
              disabled={aiSuggesting || !(diagnosis || '').trim()}
              style={[styles.aiSuggestBtn, (aiSuggesting || !diagnosis) && { opacity: 0.5 }]}
              activeOpacity={0.8}
              testID="rx-ai-suggest"
            >
              {aiSuggesting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="sparkles" size={15} color="#fff" />}
              <Text style={styles.voiceBtnText}>AI suggest</Text>
            </TouchableOpacity>
          </View>

          {/* AI Suggestion preview card */}
          {aiSuggestion ? (
            <View style={styles.aiCard}>
              <View style={styles.aiCardHead}>
                <Ionicons name="sparkles" size={16} color="#7C3AED" />
                <Text style={styles.aiCardTitle}>AI suggestion</Text>
                <TouchableOpacity onPress={() => setAiSuggestion(null)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              {aiSuggestion.rationale ? <Text style={styles.aiRationale}>{aiSuggestion.rationale}</Text> : null}
              {(aiSuggestion.warnings || []).length > 0 ? (
                <View style={styles.aiWarn}>
                  <Ionicons name="warning" size={12} color="#92400E" />
                  <Text style={styles.aiWarnText}>{aiSuggestion.warnings.join(' · ')}</Text>
                </View>
              ) : null}
              {(aiSuggestion.medicines || []).map((m, i) => (
                <Text key={i} style={styles.aiMed} numberOfLines={1}>
                  • <Text style={{ fontWeight: '700' }}>{m.name}</Text>
                  {m.dose ? ` ${m.dose}` : ''}
                  {m.frequency ? ` · ${m.frequency}` : ''}
                  {m.duration ? ` × ${m.duration}` : ''}
                </Text>
              ))}
              {(aiSuggestion.medicines || []).length === 0 ? (
                <Text style={styles.muted}>No medicines suggested. See warnings above.</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={applyAiSuggestion} style={styles.aiApply} testID="rx-ai-apply">
                  <Ionicons name="checkmark" size={14} color="#fff" />
                  <Text style={styles.aiApplyText}>  Apply to form</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setAiSuggestion(null)} style={styles.aiDismiss}>
                  <Text style={styles.aiDismissText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Template picker overlay */}
          {showTemplatePicker && (
            <View style={styles.tplPickerCard}>
              <View style={styles.tplPickerHead}>
                <Text style={styles.tplPickerTitle}>Choose template</Text>
                <TouchableOpacity onPress={() => setShowTemplatePicker(false)} hitSlop={8}>
                  <Ionicons name="close" size={20} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>
              {templates.map((t) => (
                <TouchableOpacity
                  key={t.template_id}
                  onPress={() => applyTemplate(t)}
                  style={styles.tplPickerRow}
                  testID={`rx-apply-${t.template_id}`}
                >
                  <Ionicons name="medkit-outline" size={16} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tplPickerName}>{t.name}</Text>
                    {t.diagnosis ? <Text style={styles.tplPickerDx}>{t.diagnosis}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={COLORS.textSecondary} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => { setShowTemplatePicker(false); router.push('/admin/rx-templates' as any); }}
                style={styles.tplManageBtn}
              >
                <Ionicons name="settings-outline" size={14} color={COLORS.primary} />
                <Text style={styles.tplManageText}>Manage templates</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* 1. PATIENT DETAILS */}
          <Section title="Patient Details" icon="person" idx={1}>
            <Field label="Full name *" v={patientName} s={setPatientName} id="rx-patient-name" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Age" v={age} s={setAge} kb="number-pad" id="rx-age" />
              </View>
              <View style={{ flex: 1.4 }}>
                <Text style={styles.lbl}>Gender</Text>
                <View style={styles.chipRow}>
                  {(['Male', 'Female', 'Other'] as const).map((g) => (
                    <TouchableOpacity
                      key={g}
                      onPress={() => setGender(g)}
                      style={[styles.smChip, gender === g && styles.smChipActive]}
                    >
                      <Text style={[styles.smChipText, gender === g && { color: '#fff' }]}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <Field label="Phone" v={phone} s={setPhone} kb="phone-pad" id="rx-phone" />
            <Field label="Address" v={address} s={setAddress} ml id="rx-address" placeholder="Street, City, PIN" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lbl}>Reg. No.</Text>
                <View style={{ position: 'relative' }}>
                  <TextInput
                    value={regNo}
                    onChangeText={(v) => { setRegNo(v); setRegNoAuto(false); }}
                    placeholder="Auto when phone entered"
                    placeholderTextColor={COLORS.textDisabled}
                    style={[styles.input, regNoAuto && regNo ? { borderColor: COLORS.primary, borderWidth: 1.5 } : null]}
                    testID="rx-reg"
                  />
                  {regNoAuto && !!regNo && (
                    <View style={{ position: 'absolute', right: 10, top: 14 }}>
                      <Ionicons name="sparkles" size={14} color={COLORS.primary} />
                    </View>
                  )}
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <DateField label="Visit date *" value={visitDate} onChange={setVisitDate} testID="rx-date" />
              </View>
            </View>
            <Field label="Referred by" v={refDr} s={setRefDr} id="rx-ref" placeholder="Dr. Name (optional)" />
          </Section>

          {/* 2. VITALS */}
          <Section title="Vitals" icon="pulse" idx={2}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field label="Pulse" v={pulse} s={setPulse} id="rx-pulse" placeholder="e.g. 76 /min" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="BP" v={bp} s={setBp} id="rx-bp" placeholder="e.g. 120/80 mmHg" />
              </View>
            </View>
          </Section>

          {/* 3. CHIEF COMPLAINTS */}
          <Section title="Chief Complaints" icon="alert-circle" idx={3}>
            <Field label="Presenting symptoms *" v={complaints} s={setComplaints} ml id="rx-complaints" placeholder="e.g. Burning micturition × 5 days, suprapubic pain" />
          </Section>

          {/* 4. RECENT IPSS */}
          <Section title="IPSS (If applicable)" icon="bar-chart" idx={4}>
            <Field
              label="IPSS score / interpretation"
              v={ipss}
              s={setIpss}
              ml
              id="rx-ipss"
              placeholder="e.g. 12 / 35 (moderate); QoL 3 — leave blank if not applicable"
            />
          </Section>

          {/* 5. EXAMINATION (clinical, prescriber only) */}
          {(isPrescriber || isEdit) && (
            <Section title="Examination" icon="medkit" idx={5}>
              <Field label="P/A (Per Abdomen)" v={exPa} s={setExPa} ml id="rx-ex-pa" placeholder="Soft, non-tender, no organomegaly" />
              <Field label="External Genitalia" v={exGen} s={setExGen} ml id="rx-ex-gen" />
              <Field label="EUM (External Urinary Meatus)" v={exEum} s={setExEum} ml id="rx-ex-eum" />
              <Field label="Testis" v={exTestis} s={setExTestis} ml id="rx-ex-testis" />
              <Field label="DRE (Digital Rectal Exam)" v={exDre} s={setExDre} ml id="rx-ex-dre" />
            </Section>
          )}

          {/* 6. INVESTIGATIONS (findings — prescriber only) */}
          {(isPrescriber || isEdit) && (
            <Section title="Investigations (Findings)" icon="flask" idx={6}>
              <Field label="Blood Investigations" v={invBlood} s={setInvBlood} ml id="rx-inv-blood" placeholder="CBC, RFT, LFT, etc." />
              <Field label="PSA" v={invPsa} s={setInvPsa} id="rx-inv-psa" placeholder="e.g. 4.2 ng/mL" />
              <Field label="USG (KUB / Pelvis / Scrotum)" v={invUsg} s={setInvUsg} ml id="rx-inv-usg" />
              <Field label="Uroflowmetry" v={invUroflow} s={setInvUroflow} ml id="rx-inv-uroflow" placeholder="Qmax / volume voided / PVR" />
              <Field label="CT scan" v={invCt} s={setInvCt} ml id="rx-inv-ct" />
              <Field label="MRI" v={invMri} s={setInvMri} ml id="rx-inv-mri" />
              <Field label="PET scan" v={invPet} s={setInvPet} ml id="rx-inv-pet" />
            </Section>
          )}

          {/* 7. FINDINGS & DIAGNOSIS */}
          {(isPrescriber || isEdit) && (
            <Section title="Findings & Diagnosis" icon="document-text" idx={7}>
              <Field label="Diagnosis" v={diagnosis} s={setDiagnosis} ml id="rx-diagnosis" placeholder="Primary + secondary diagnoses" />
            </Section>
          )}

          {/* 8. MEDICATIONS — prescriber only */}
          {(isPrescriber || isEdit) && (
            <Section title="Medications" icon="medical" idx={8}>
              {meds.map((m, i) => (
                <View key={i} style={styles.medCard}>
                  <View style={styles.medHead}>
                    <View style={styles.medNumBadge}><Text style={styles.medNumBadgeText}>{i + 1}</Text></View>
                    <Text style={styles.medHeadText}>Medicine {i + 1}</Text>
                    {meds.length > 1 && (
                      <TouchableOpacity onPress={() => removeMed(i)} testID={`rx-med-remove-${i}`} style={{ marginLeft: 'auto' }}>
                        <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ marginTop: 6 }}>
                    <Text style={styles.lbl}>Medicine name *</Text>
                    <MedicineAutocomplete
                      value={m.name}
                      onChangeText={(v: string) => updateMed(i, 'name', v)}
                      onSelect={(sel) => applyCatalogMedicine(i, sel)}
                      testID={`rx-med-${i}-name`}
                      placeholder="e.g. Tamsulosin 0.4 mg"
                    />
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Field label="Dosage" v={m.dosage} s={(v: string) => updateMed(i, 'dosage', v)} id={`rx-med-${i}-dose`} placeholder="1 tab" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field label="Duration" v={m.duration} s={(v: string) => updateMed(i, 'duration', v)} id={`rx-med-${i}-dur`} placeholder="5 days" />
                    </View>
                  </View>
                  <Text style={[styles.lbl, { marginTop: 10 }]}>Frequency</Text>
                  <View style={styles.chipRow}>
                    {FREQ_PRESETS.map((f) => (
                      <TouchableOpacity
                        key={f}
                        onPress={() => updateMed(i, 'frequency', f)}
                        style={[styles.pill, m.frequency === f && styles.pillActive]}
                      >
                        <Text style={[styles.pillText, m.frequency === f && { color: '#fff' }]}>{f}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TextInput
                    value={m.frequency || ''}
                    onChangeText={(v) => updateMed(i, 'frequency', v)}
                    placeholder="or type custom (e.g. 1-0-1)"
                    placeholderTextColor={COLORS.textDisabled}
                    style={[styles.input, { marginTop: 6 }]}
                    testID={`rx-med-${i}-freq`}
                  />
                  <Text style={[styles.lbl, { marginTop: 10 }]}>Timing</Text>
                  <View style={styles.chipRow}>
                    {TIMING_PRESETS.map((t) => (
                      <TouchableOpacity
                        key={t}
                        onPress={() => updateMed(i, 'timing', m.timing === t ? '' : t)}
                        style={[styles.pill, m.timing === t && styles.pillActive]}
                      >
                        <Text style={[styles.pillText, m.timing === t && { color: '#fff' }]}>{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Field label="Instructions" v={m.instructions || ''} s={(v: string) => updateMed(i, 'instructions', v)} id={`rx-med-${i}-instr`} placeholder="Bedtime; avoid alcohol" />
                </View>
              ))}
              <SecondaryButton title="+ Add Medicine" onPress={addMed} style={{ marginTop: 4 }} testID="rx-add-med" />
            </Section>
          )}

          {/* 9. INVESTIGATIONS ADVISED */}
          {(isPrescriber || isEdit) && (
            <Section title="Investigations Advised" icon="git-branch" idx={9}>
              <Field
                label="Tests to be done"
                v={investigationsAdvised}
                s={setInvestigationsAdvised}
                ml
                id="rx-inv-adv"
                placeholder="e.g. PSA, USG KUB, Urine R/M + culture"
              />
            </Section>
          )}

          {/* 10. ADVICE */}
          {(isPrescriber || isEdit) && (
            <Section title="Advice" icon="bulb" idx={10}>
              <Field label="Lifestyle / patient instructions" v={advice} s={setAdvice} ml id="rx-advice" />
            </Section>
          )}

          {/* 11. FOLLOW-UP */}
          {(isPrescriber || isEdit) && (
            <Section title="Follow-up" icon="calendar" idx={11}>
              <Field label="Next visit" v={followUp} s={setFollowUp} id="rx-followup" placeholder="e.g. After 2 weeks with reports" />
            </Section>
          )}

          <View style={styles.trustBanner}>
            <MaterialCommunityIcons name="shield-check" size={18} color={COLORS.primary} />
            <Text style={styles.trustText}>
              Final PDF includes a QR verification link, digital stamp + signature. Empty subsections are hidden automatically.
            </Text>
          </View>

          {/* Action buttons — depend on role + status */}
          {!isPrescriber ? (
            // Staff: only the "Save Draft" CTA
            <PrimaryButton
              title={saving ? 'Saving…' : (isEdit ? 'Save Draft' : 'Save as Draft for Doctor')}
              onPress={handleSaveDraft}
              style={{ marginTop: 16 }}
              icon={<Ionicons name="bookmark" size={20} color="#fff" />}
              testID="rx-save-draft"
            />
          ) : (
            <>
              <PrimaryButton
                title={saving ? 'Generating…' : (status === 'draft' ? 'Finalise & Generate PDF' : 'Save & Generate PDF')}
                onPress={handleSaveAndPdf}
                style={{ marginTop: 16 }}
                icon={<Ionicons name="document" size={20} color="#fff" />}
                testID="rx-generate-pdf"
              />
              <SecondaryButton
                title={status === 'draft' ? 'Save & keep as draft' : 'Save Changes (no PDF)'}
                onPress={status === 'draft' ? handleSaveDraft : handleSaveOnly}
                style={{ marginTop: 10 }}
                testID="rx-save-only"
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Wave 3 (M) — Voice-to-Rx dictation sheet */}
      <VoiceDictationSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onResult={applyVoiceResult}
      />
    </SafeAreaView>
  );
}

/* ---------- helpers ------------------------------------------------------ */

function Section({ idx, title, icon, children }: { idx: number; title: string; icon: any; children: React.ReactNode }) {
  return (
    <View style={styles.section} testID={`rx-section-${idx}`}>
      <View style={styles.sectionHead}>
        <View style={styles.sectionIdx}><Text style={styles.sectionIdxText}>{idx}</Text></View>
        <Ionicons name={icon} size={16} color={COLORS.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, v, s, kb, ml, id, placeholder }: any) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.lbl}>{label}</Text>
      <TextInput
        value={v}
        onChangeText={s}
        keyboardType={kb || 'default'}
        multiline={!!ml}
        placeholder={placeholder}
        style={[styles.input, ml && { minHeight: 70, textAlignVertical: 'top' }]}
        placeholderTextColor={COLORS.textDisabled}
        testID={id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Wave 1 (D) — Allergies banner
  allergyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#B91C1C',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    marginBottom: 12,
  },
  allergyBannerTitle: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  allergyBannerSub: { ...FONTS.body, color: '#FECACA', fontSize: 11, marginTop: 1 },

  // Wave 1 (C) — Template apply button
  templateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1,
    borderColor: COLORS.primary + '55',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  templateBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12.5 },

  // Wave 3 (M) — Voice dictation button + quick-action row
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#7C3AED',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  voiceBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12.5 },

  aiSuggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0EA5E9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  aiCard: {
    backgroundColor: '#FAF5FF',
    borderColor: '#C4B5FD',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  aiCardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  aiCardTitle: { ...FONTS.bodyMedium, color: '#7C3AED', fontSize: 13, flex: 1 },
  aiRationale: { ...FONTS.body, color: '#581C87', fontSize: 12, fontStyle: 'italic', lineHeight: 17 },
  aiWarn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: '#FEF3C7', borderColor: '#FCD34D', borderWidth: 1,
    padding: 6, borderRadius: 6, marginVertical: 4,
  },
  aiWarnText: { ...FONTS.body, color: '#92400E', fontSize: 11.5, flex: 1 },
  aiMed: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12.5, marginVertical: 1 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5 },
  aiApply: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.pill,
  },
  aiApplyText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12.5 },
  aiDismiss: { paddingHorizontal: 10, paddingVertical: 7 },
  aiDismissText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12.5 },

  tplPickerCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 12,
  },
  tplPickerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  tplPickerTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  tplPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.border + '55',
  },
  tplPickerName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  tplPickerDx: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  tplManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  tplManageText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  subTitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  draftPill: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLORS.warning + '22',
    borderRadius: 8,
  },
  draftPillText: { ...FONTS.label, color: COLORS.warning, fontSize: 10 },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 10,
    backgroundColor: COLORS.primary + '0F',
    borderRadius: RADIUS.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  draftBannerText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1 },

  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.primary + '0E',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.primary + '22',
  },
  sectionIdx: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionIdxText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 11 },
  sectionTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  sectionBody: { padding: 12, paddingTop: 0 },

  lbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11 },
  input: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 10,
    marginTop: 4,
    ...FONTS.body,
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  smChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  smChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  smChipText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },

  medCard: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  medHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  medHeadText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  medNumBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  medNumBadgeText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 11 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 11 },

  trustBanner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: COLORS.primary + '0F',
    padding: 12,
    borderRadius: RADIUS.md,
    marginTop: 12,
  },
  trustText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1, lineHeight: 18 },
});
