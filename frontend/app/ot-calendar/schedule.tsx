/**
 * Schedule Surgery Wizard — Phase 3.1.
 *
 * Modes:
 *   • New          → /ot-calendar/schedule
 *   • New + booking→ /ot-calendar/schedule?booking_id=…  (prefills patient)
 *   • Edit         → /ot-calendar/schedule?id=…
 *
 * 3-step flow:
 *   1. Patient (auto-prefilled if booking_id, else manual)
 *   2. Procedure picker (50 trilingual + duration auto-fill)
 *   3. Date / Time / OT-room + conflict check + save
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DateField, TimeField } from '../../src/date-picker';
import { parseUIDate, displayDate } from '../../src/date';

type Procedure = {
  key: string;
  category: string;
  name: { en: string; hi: string; gu: string };
  anesthesia: string;
  duration_min: number;
};

type Surgery = {
  surgery_id?: string;
  patient_name?: string;
  patient_phone?: string;
  patient_age?: number;
  patient_sex?: string;
  registration_no?: string;
  address?: string;
  patient_email?: string;
  surgery_name?: string;
  procedure_key?: string;
  procedure_keys?: string[];
  scheduled_date?: string;
  scheduled_time?: string;
  ot_room?: string;
  estimated_duration_min?: number;
  surgery_status?: string;
  diagnosis?: string;
  booking_id?: string;
  date?: string;
};

export default function ScheduleSurgery() {
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{
    id?: string;
    booking_id?: string;
    patient_phone?: string;
    patient_name?: string;
    patient_email?: string;
    patient_age?: string;
    patient_sex?: string;
    diagnosis?: string;
    procedure?: string;
    admission_id?: string;
    prescription_id?: string;
  }>();
  const editingId = params.id;
  const sourceBookingId = params.booking_id;
  const seedPhone = params.patient_phone;
  const seedName = params.patient_name;
  const seedAge = params.patient_age;
  const seedSex = (() => {
    const v = (params.patient_sex || '').trim().toLowerCase();
    if (v === 'm' || v.startsWith('male')) return 'Male';
    if (v === 'f' || v.startsWith('female')) return 'Female';
    if (v === 'o' || v.startsWith('other')) return 'Other';
    return params.patient_sex || undefined;
  })();
  const seedEmail = params.patient_email;
  const seedDx = params.diagnosis;
  const seedProcedure = params.procedure;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [rooms, setRooms] = useState<string[]>(['OT-1']);
  const [procSearch, setProcSearch] = useState('');

  // Form state
  const [form, setForm] = useState<Surgery>({
    ot_room: 'OT-1',
    estimated_duration_min: 60,
    surgery_status: 'scheduled',
  });

  const [conflicts, setConflicts] = useState<any[]>([]);
  const [checkingConflict, setCheckingConflict] = useState(false);

  // Patient auto-lookup state (Phase 3.8.2 — sync surgery log with
  // Consent / IPD / Medical-cert workflows). Entering a phone OR a
  // registration number auto-fetches name, age, sex, email and
  // address from the patient database. Clinical fields (diagnosis,
  // procedure, schedule slot) are NEVER touched.
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
        setForm((f) => ({
          ...f,
          patient_name: f.patient_name || d.name || '',
          patient_phone: f.patient_phone || d.phone || '',
          registration_no: f.registration_no || d.registration_no || '',
          patient_age: f.patient_age || (d.age ? Number(d.age) || undefined : undefined),
          patient_sex: f.patient_sex || d.gender || '',
          patient_email: f.patient_email || d.email || '',
          address: f.address || d.address || '',
        }));
        setLookedMsg(`Auto-filled from patient database · ${d.name || phone || regNo}`);
      } else {
        setLookedMsg('No matching record found. Enter details manually below.');
      }
    } catch {
      // Silent — auto-lookup is opportunistic, never blocks the form.
    } finally {
      setLooking(false);
    }
  }, []);

  // ── Load procedures + rooms (independently) ──
  // These are fetched separately on purpose: a transient failure on one
  // endpoint (e.g. a 429 on the OT-rooms call) must NOT wipe out the
  // procedures list. Previously a single Promise.all meant either
  // failure left step 2 empty, so the clinician could never pick a
  // procedure and thus never reach / complete step 3.
  useEffect(() => {
    (async () => {
      try {
        const p = await api.get('/surgeries/procedures');
        setProcedures(p.data?.procedures || []);
      } catch {
        // best-effort — leave existing list
      }
    })();
    (async () => {
      try {
        const r = await api.get('/surgeries/ot-rooms');
        const roomList = (r.data?.rooms && Array.isArray(r.data.rooms) && r.data.rooms.length > 0)
          ? r.data.rooms
          : ['OT-1'];
        setRooms(roomList);
        setForm((f) => (f.ot_room ? f : { ...f, ot_room: roomList[0] }));
      } catch {
        // Fall back to the default single room so a room can always be
        // selected and the Confirm button never gets stuck disabled.
        setRooms(['OT-1']);
        setForm((f) => (f.ot_room ? f : { ...f, ot_room: 'OT-1' }));
      }
    })();
  }, []);

  // Auto-select procedure(s) when arriving from IPD with a `procedure`
  // query param. The IPD planned-procedure text is freeform (e.g.
  // "RIGHT RIRS + RIGHT DJ STENTING") so we split on '+' / '/' and
  // match each token against the 50 keyed surgeries. Matching keys
  // are pre-selected; durations are summed; surgery_name is built
  // from the matched names joined by " + ".
  const autoProcRef = React.useRef(false);
  useEffect(() => {
    if (autoProcRef.current) return;
    if (!seedProcedure || procedures.length === 0) return;
    const tokens = seedProcedure
      .split(/[+/]|,|\band\b/i)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const matched: Procedure[] = [];
    for (const tok of tokens) {
      const stripped = tok.replace(/^(right|left|bilateral|b\/l)\s+/i, '').trim();
      const candidates = [tok, stripped];
      for (const cand of candidates) {
        const m = procedures.find((p) =>
          p.name.en.toLowerCase() === cand ||
          p.key.toLowerCase() === cand ||
          p.name.en.toLowerCase().replace(/\s+/g, '') === cand.replace(/\s+/g, '') ||
          (p.name.en.toLowerCase().includes(cand) && cand.length >= 4),
        );
        if (m && !matched.find((x) => x.key === m.key)) {
          matched.push(m);
          break;
        }
      }
    }
    if (matched.length > 0) {
      autoProcRef.current = true;
      const keys = matched.map((p) => p.key);
      const totalDur = matched.reduce((s, p) => s + (p.duration_min || 0), 0);
      const combinedName = matched.map((p) => p.name.en).join(' + ');
      setForm((f) => ({
        ...f,
        procedure_key: keys[0],
        procedure_keys: keys,
        surgery_name: combinedName,
        // When auto-prefilling from IPD, prefer the procedure-derived
        // sum so multi-procedure surgeries get the correct duration.
        estimated_duration_min: totalDur || f.estimated_duration_min || 60,
      }));
      // Clear the seeded search text so the doctor sees the full
      // procedure list (in case they want to add more / change).
      setProcSearch('');
    }
  }, [seedProcedure, procedures]);

  // ── Prefill: edit existing or copy from booking or from generic patient seed ──
  useEffect(() => {
    (async () => {
      if (editingId) {
        try {
          // We list all then pick — simplest given there is no GET /surgeries/{id}
          const r = await api.get('/surgeries');
          const s = (r.data || []).find((x: any) => x.surgery_id === editingId);
          if (s) {
            setForm({
              surgery_id: s.surgery_id,
              patient_name: s.patient_name,
              patient_phone: s.patient_phone,
              patient_age: s.patient_age,
              patient_sex: s.patient_sex,
              registration_no: s.registration_no || '',
              address: s.address || '',
              patient_email: s.patient_email || '',
              surgery_name: s.surgery_name,
              procedure_key: s.procedure_key,
              scheduled_date: s.scheduled_date,
              scheduled_time: s.scheduled_time,
              ot_room: s.ot_room || 'OT-1',
              estimated_duration_min: s.estimated_duration_min || 60,
              surgery_status: s.surgery_status || 'scheduled',
              diagnosis: s.diagnosis,
              date: s.date,
            });
          }
        } catch (e: any) {
          toast.error('Could not load surgery');
        }
      } else if (sourceBookingId) {
        try {
          const r = await api.get(`/bookings/${sourceBookingId}`);
          const b = r.data || {};
          setForm((f) => ({
            ...f,
            patient_name: b.patient_name,
            patient_phone: b.patient_phone,
            patient_age: b.patient_age,
            patient_sex: b.patient_gender,
            registration_no: b.registration_no || f.registration_no || '',
            address: b.patient_address || b.address || f.address || '',
            patient_email: b.patient_email || f.patient_email || '',
            diagnosis: b.reason,
            booking_id: b.booking_id,
            scheduled_date: f.scheduled_date || b.booking_date,
          }));
          // Fire-and-forget lookup to enrich missing fields from
          // patient DB (registration no, address, email).
          if (b.patient_phone) {
            void tryLookup({ phone: b.patient_phone });
          }
        } catch {
          // ignore
        }
      } else if (seedPhone || seedName) {
        // Generic prefill from Patient profile / Prescription header
        // icon / IPD admitted patient '+' action.
        setForm((f) => ({
          ...f,
          patient_name: seedName || f.patient_name,
          patient_phone: seedPhone || f.patient_phone,
          patient_age: seedAge ? Number(seedAge) || undefined : f.patient_age,
          patient_sex: seedSex || f.patient_sex,
          patient_email: seedEmail || f.patient_email,
          diagnosis: seedDx || f.diagnosis,
          surgery_name: seedProcedure || f.surgery_name,
        }));
        if (seedProcedure) setProcSearch(seedProcedure);
        if (seedPhone) {
          void tryLookup({ phone: seedPhone });
        }
      }
    })();
  }, [editingId, sourceBookingId, seedPhone, seedName, seedAge, seedSex, seedEmail, seedDx, seedProcedure]);

  // ── Conflict re-check whenever step-3 inputs change ──
  useEffect(() => {
    if (step !== 3) return;
    if (!form.scheduled_date || !form.scheduled_time) return;
    const id = setTimeout(async () => {
      setCheckingConflict(true);
      try {
        const r = await api.get('/surgeries/conflicts', {
          params: {
            scheduled_date: form.scheduled_date,
            scheduled_time: form.scheduled_time,
            duration_min: form.estimated_duration_min || 60,
            ot_room: form.ot_room || 'OT-1',
            exclude_surgery_id: form.surgery_id,
          },
        });
        setConflicts(r.data?.conflicts || []);
      } catch {
        setConflicts([]);
      } finally {
        setCheckingConflict(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [step, form.scheduled_date, form.scheduled_time, form.estimated_duration_min, form.ot_room, form.surgery_id]);

  const procByCategory = useMemo(() => {
    const q = procSearch.trim().toLowerCase();
    const filtered = q
      ? procedures.filter((p) =>
          p.name.en.toLowerCase().includes(q) ||
          p.name.hi.includes(q) ||
          p.name.gu.includes(q) ||
          p.key.includes(q) ||
          p.category.toLowerCase().includes(q),
        )
      : procedures;
    const groups: Record<string, Procedure[]> = {};
    filtered.forEach((p) => {
      const k = p.category || 'Other';
      if (!groups[k]) groups[k] = [];
      groups[k].push(p);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [procedures, procSearch]);

  // Phase 6.2 — multi-procedure surgery selection state.
  const procByKey = useMemo(() => {
    const m: Record<string, Procedure> = {};
    procedures.forEach((p) => { m[p.key] = p; });
    return m;
  }, [procedures]);

  const selectedKeys: string[] = useMemo(() => {
    if (form.procedure_keys && form.procedure_keys.length > 0) return form.procedure_keys;
    return form.procedure_key ? [form.procedure_key] : [];
  }, [form.procedure_keys, form.procedure_key]);

  const selectedProcs: Procedure[] = useMemo(
    () => selectedKeys.map((k) => procByKey[k]).filter(Boolean),
    [selectedKeys, procByKey],
  );

  const toggleProc = (p: Procedure) => {
    setForm((f) => {
      const cur = f.procedure_keys && f.procedure_keys.length > 0
        ? f.procedure_keys
        : (f.procedure_key ? [f.procedure_key] : []);
      const has = cur.includes(p.key);
      const next = has ? cur.filter((k) => k !== p.key) : [...cur, p.key];
      const nextProcs = next.map((k) => procByKey[k]).filter(Boolean);
      const totalDur = nextProcs.reduce((s, x) => s + (x.duration_min || 0), 0);
      const combinedName = nextProcs.map((x) => x.name.en).join(' + ');
      return {
        ...f,
        procedure_key: next[0],
        procedure_keys: next.length > 0 ? next : undefined,
        surgery_name: combinedName || undefined,
        // Only auto-update duration if user hasn't manually picked one,
        // OR they're still on the auto-sum number. We always reset to
        // the new sum on each toggle so it stays predictable.
        estimated_duration_min: totalDur || f.estimated_duration_min || 60,
      };
    });
  };

  const clearProcs = () => {
    setForm((f) => ({ ...f, procedure_key: undefined, procedure_keys: undefined, surgery_name: undefined }));
  };

  const canGoStep2 = !!(form.patient_name && form.patient_phone);
  const canGoStep3 = selectedKeys.length > 0 && !!form.surgery_name;
  const canSave = !!(form.scheduled_date && form.scheduled_time && form.ot_room);

  const save = async () => {
    setBusy(true);
    try {
      const payload: any = {
        patient_phone: form.patient_phone,
        patient_name: form.patient_name,
        patient_age: form.patient_age,
        patient_sex: form.patient_sex,
        registration_no: (form.registration_no || '').trim() || undefined,
        address: (form.address || '').trim() || undefined,
        patient_email: (form.patient_email || '').trim() || undefined,
        surgery_name: form.surgery_name,
        procedure_key: form.procedure_key,
        procedure_keys: form.procedure_keys,
        diagnosis: form.diagnosis,
        scheduled_date: form.scheduled_date,
        scheduled_time: form.scheduled_time,
        ot_room: form.ot_room,
        estimated_duration_min: form.estimated_duration_min,
        surgery_status: 'scheduled',
        booking_id: form.booking_id,
        date: form.date || '', // Required by SurgeryBody (legacy)
      };
      if (editingId) {
        await api.patch(`/surgeries/${editingId}`, payload);
        toast.success('Surgery updated');
      } else {
        await api.post('/surgeries', payload);
        toast.success('Surgery scheduled');
      }
      router.replace('/ot-calendar' as any);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn} testID="sched-back">
            <Ionicons name="chevron-back" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{editingId ? 'Edit Surgery' : 'Schedule Surgery'}</Text>
            <Text style={styles.subtitle}>Step {step} of 3</Text>
          </View>
          <View style={styles.progressDots}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.dot, n <= step && styles.dotActive]} />
            ))}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {step === 1 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Patient details</Text>
              <Text style={styles.helperTop}>
                Enter phone or registration number — we auto-fetch the rest from your patient database.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 2 }}>
                  <Label>Phone *</Label>
                  <TextInput
                    style={styles.input}
                    value={form.patient_phone || ''}
                    onChangeText={(v) => setForm({ ...form, patient_phone: v })}
                    onBlur={() => {
                      const digits = (form.patient_phone || '').replace(/\D/g, '');
                      if (digits.length >= 10) void tryLookup({ phone: form.patient_phone });
                    }}
                    placeholder="10-digit phone"
                    placeholderTextColor={COLORS.textDisabled}
                    keyboardType="phone-pad"
                    maxLength={15}
                    testID="sched-pphone"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Label>Reg. No.</Label>
                  <TextInput
                    style={styles.input}
                    value={form.registration_no || ''}
                    onChangeText={(v) => setForm({ ...form, registration_no: v })}
                    onBlur={() => {
                      const r = (form.registration_no || '').trim();
                      if (r.length >= 2) void tryLookup({ registration_no: r });
                    }}
                    placeholder="—"
                    placeholderTextColor={COLORS.textDisabled}
                    autoCapitalize="characters"
                    testID="sched-pregno"
                  />
                </View>
              </View>
              {(looking || lookedMsg) ? (
                <Text style={[styles.hint, looking ? { color: COLORS.primary } : null]}>
                  {looking ? 'Looking up patient…' : lookedMsg}
                </Text>
              ) : null}

              <Label>Full name *</Label>
              <TextInput style={styles.input} value={form.patient_name || ''} onChangeText={(v) => setForm({ ...form, patient_name: v })} placeholder="Patient full name" placeholderTextColor={COLORS.textDisabled} testID="sched-pname" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Label>Age</Label>
                  <TextInput style={styles.input} value={form.patient_age ? String(form.patient_age) : ''} onChangeText={(v) => setForm({ ...form, patient_age: Number(v) || undefined })} placeholder="—" placeholderTextColor={COLORS.textDisabled} keyboardType="number-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Label>Sex</Label>
                  <View style={styles.segRow}>
                    {['Male', 'Female', 'Other'].map((s) => (
                      <TouchableOpacity key={s} onPress={() => setForm({ ...form, patient_sex: s })} style={[styles.segBtn, form.patient_sex === s && styles.segBtnActive]}>
                        <Text style={[styles.segText, form.patient_sex === s && styles.segTextActive]}>{s[0]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
              <Label>Address</Label>
              <TextInput
                style={[styles.input, { minHeight: 50 }]}
                multiline
                value={form.address || ''}
                onChangeText={(v) => setForm({ ...form, address: v })}
                placeholder="Patient address (optional)"
                placeholderTextColor={COLORS.textDisabled}
                testID="sched-paddr"
              />
              <Label>Email</Label>
              <TextInput
                style={styles.input}
                value={form.patient_email || ''}
                onChangeText={(v) => setForm({ ...form, patient_email: v })}
                placeholder="patient@email.com (optional)"
                placeholderTextColor={COLORS.textDisabled}
                autoCapitalize="none"
                keyboardType="email-address"
                testID="sched-pemail"
              />
              <Label>Working diagnosis</Label>
              <TextInput style={[styles.input, { minHeight: 60 }]} multiline value={form.diagnosis || ''} onChangeText={(v) => setForm({ ...form, diagnosis: v })} placeholder="e.g. BPH with retention" placeholderTextColor={COLORS.textDisabled} />
              {sourceBookingId ? <Text style={styles.hint}>↪ Pre-filled from booking #{sourceBookingId.slice(-6)}</Text>
                : (seedPhone || seedName) ? <Text style={styles.hint}>↪ Pre-filled from patient record</Text>
                : null}
            </View>
          )}

          {step === 2 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pick procedure(s)</Text>
              <Text style={styles.helperTop}>
                Tap to select. Pick more than one for combined procedures (e.g. RIRS + DJ Stent). Durations auto-sum.
              </Text>
              {selectedProcs.length > 0 && (
                <View style={styles.selectedProc}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedProcText} numberOfLines={2}>
                      {selectedProcs.map((p) => p.name.en).join(' + ')}
                    </Text>
                    <Text style={styles.selectedProcMeta}>
                      {selectedProcs.length} procedure{selectedProcs.length > 1 ? 's' : ''} · {selectedProcs.reduce((s, p) => s + (p.duration_min || 0), 0)} min total
                    </Text>
                  </View>
                  <TouchableOpacity onPress={clearProcs} testID="sched-clear-procs">
                    <Text style={styles.changeLink}>Clear</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={styles.searchBox}>
                <Ionicons name="search" size={16} color={COLORS.textSecondary} />
                <TextInput
                  value={procSearch}
                  onChangeText={setProcSearch}
                  placeholder="Search 50 procedures…"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.searchInput}
                  testID="sched-proc-search"
                />
              </View>
              {procByCategory.length === 0 ? (
                <Text style={styles.emptyHint}>No matches.</Text>
              ) : procByCategory.map(([cat, list]) => (
                <View key={cat} style={{ marginTop: 12 }}>
                  <Text style={styles.catLabel}>{cat}</Text>
                  {list.map((p) => {
                    const active = selectedKeys.includes(p.key);
                    return (
                      <TouchableOpacity
                        key={p.key}
                        style={[styles.procRow, active && styles.procRowActive]}
                        onPress={() => toggleProc(p)}
                        testID={`sched-proc-${p.key}`}
                      >
                        <View style={[styles.checkbox, active && styles.checkboxOn]}>
                          {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.procName, active && { color: COLORS.primary }]}>{p.name.en}</Text>
                          <Text style={styles.procMeta}>{p.duration_min} min · {p.anesthesia || 'Anaesthesia per case'}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

          {step === 3 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Schedule slot</Text>
              <Label>Surgery date *</Label>
              <DateField
                value={form.scheduled_date ? displayDate(form.scheduled_date) : ''}
                onChange={(v) => setForm({ ...form, scheduled_date: parseUIDate(v) || '' })}
              />
              <Label>Start time *</Label>
              <TimeField
                value={form.scheduled_time || ''}
                onChange={(v) => setForm({ ...form, scheduled_time: v })}
                style={{ marginTop: 6 }}
              />
              <Label>Estimated duration (min)</Label>
              {selectedProcs.length > 1 ? (
                <Text style={styles.hint}>
                  Auto-summed: {selectedProcs.map((p) => `${p.name.en} ${p.duration_min}m`).join(' + ')} = {selectedProcs.reduce((s, p) => s + (p.duration_min || 0), 0)} min. You can adjust below.
                </Text>
              ) : null}
              <View style={styles.segRow}>
                {[30, 45, 60, 90, 120, 150, 180, 240, 300].map((d) => (
                  <TouchableOpacity key={d} onPress={() => setForm({ ...form, estimated_duration_min: d })} style={[styles.segBtn, form.estimated_duration_min === d && styles.segBtnActive]}>
                    <Text style={[styles.segText, form.estimated_duration_min === d && styles.segTextActive]}>{d}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput
                  style={[styles.input, { width: 88, marginTop: 0, paddingVertical: 9 }]}
                  value={form.estimated_duration_min ? String(form.estimated_duration_min) : ''}
                  onChangeText={(v) => {
                    const n = Number(v.replace(/[^0-9]/g, ''));
                    setForm({ ...form, estimated_duration_min: Number.isFinite(n) && n > 0 ? n : undefined });
                  }}
                  placeholder="Custom"
                  placeholderTextColor={COLORS.textDisabled}
                  keyboardType="number-pad"
                  testID="sched-duration-custom"
                />
              </View>
              <Label>OT room *</Label>
              <View style={styles.segRow}>
                {rooms.map((r) => (
                  <TouchableOpacity key={r} onPress={() => setForm({ ...form, ot_room: r })} style={[styles.segBtn, form.ot_room === r && styles.segBtnActive]}>
                    <Text style={[styles.segText, form.ot_room === r && styles.segTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Conflict banner */}
              {checkingConflict ? (
                <View style={styles.conflictHint}><ActivityIndicator size="small" color={COLORS.textSecondary} /><Text style={styles.conflictHintText}>Checking OT availability…</Text></View>
              ) : conflicts.length > 0 ? (
                <View style={styles.conflictBox}>
                  <Ionicons name="warning" size={18} color={COLORS.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.conflictTitle}>Slot conflict ({conflicts.length})</Text>
                    {conflicts.slice(0, 3).map((c, i) => (
                      <Text key={i} style={styles.conflictItem}>
                        • {c.patient_name} — {c.surgery_name} @ {c.scheduled_time} ({c.estimated_duration_min}m)
                      </Text>
                    ))}
                    <Text style={styles.conflictHelp}>Pick a different time or change OT room.</Text>
                  </View>
                </View>
              ) : (form.scheduled_date && form.scheduled_time) ? (
                <View style={styles.okBox}>
                  <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  <Text style={styles.okText}>Slot available</Text>
                </View>
              ) : null}
            </View>
          )}
        </ScrollView>

        {/* Footer actions */}
        <View style={styles.footer}>
          {step > 1 && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep((step - 1) as any)} testID="sched-prev">
              <Text style={styles.secondaryText}>Back</Text>
            </TouchableOpacity>
          )}
          {step < 3 ? (
            <TouchableOpacity
              style={[styles.primaryBtn, !(step === 1 ? canGoStep2 : canGoStep3) && styles.btnDisabled]}
              disabled={!(step === 1 ? canGoStep2 : canGoStep3)}
              onPress={() => setStep((step + 1) as any)}
              testID="sched-next"
            >
              <Text style={styles.primaryText}>Continue</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, (!canSave || busy) && styles.btnDisabled]}
              disabled={!canSave || busy}
              onPress={save}
              testID="sched-save"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
              <Text style={styles.primaryText}>{editingId ? 'Update surgery' : 'Confirm schedule'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  progressDots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.border },
  dotActive: { backgroundColor: COLORS.primary },
  scroll: { padding: 16, paddingTop: 4 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginBottom: 12 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12, marginBottom: 4, fontSize: 11 },
  input: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, ...FONTS.body, color: COLORS.textPrimary },
  hint: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 12, fontSize: 11, fontStyle: 'italic' },
  helperTop: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginBottom: 8, lineHeight: 15 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.bg, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, marginTop: 4 },
  searchInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, paddingVertical: 10 },
  catLabel: { ...FONTS.label, color: COLORS.primary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  procRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6, backgroundColor: '#fff' },
  procRowActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '0F' },
  procName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  procMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  selectedProc: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.success + '15', padding: 10, borderRadius: RADIUS.md, marginBottom: 12 },
  selectedProcText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  selectedProcMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  changeLink: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  emptyHint: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', padding: 16, fontSize: 12 },
  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  segBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  segTextActive: { color: '#fff' },
  conflictBox: { flexDirection: 'row', gap: 10, backgroundColor: COLORS.warning + '12', borderColor: COLORS.warning + '60', borderWidth: 1, padding: 12, borderRadius: RADIUS.md, marginTop: 14 },
  conflictTitle: { ...FONTS.bodyMedium, color: COLORS.warning, fontSize: 13, marginBottom: 4 },
  conflictItem: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },
  conflictHelp: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  conflictHint: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14 },
  conflictHintText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  okBox: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 14, padding: 10, backgroundColor: COLORS.success + '12', borderRadius: RADIUS.md },
  okText: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 13 },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: COLORS.border, backgroundColor: '#fff' },
  primaryBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  primaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  secondaryBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  secondaryText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
});
