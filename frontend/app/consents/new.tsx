/**
 * /consents/new — surgical consent wizard (4 steps).
 *
 * Step 1 — Procedure picker: 50 procedures grouped by category, with
 *           search filter. User taps to select.
 * Step 2 — Patient + booking link: name, phone, email, age, sex,
 *           optional booking_id (auto-filled if arriving from a
 *           booking row via ?booking_id=...).
 * Step 3 — Read & language toggle: shows the full consent text in
 *           selected language (EN / HI / GU). Patient can scroll the
 *           full disclosure. Common-risks boilerplate is composed
 *           inline.
 * Step 4 — Sign: 3 signature pads (patient, witness optional, doctor).
 *           Save button POSTs to /api/surgical-consents and redirects
 *           to detail screen.
 *
 * Once saved, the detail screen (/consents/[id]) renders a printable
 * version with a "Generate PDF" button that POSTs to /api/render/pdf.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Platform, KeyboardAvoidingView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import SignaturePad, { SignaturePadHandle } from '../../src/signature-pad';

type Lang = 'en' | 'hi' | 'gu';
type Procedure = {
  key: string;
  category: string;
  anesthesia: string;
  name: { en: string; hi: string; gu: string };
  procedure: { en: string; hi: string; gu: string };
  specific_risks: { en: string; hi: string; gu: string }[];
  alternatives: { en: string; hi: string; gu: string };
};

// Common-risks boilerplate, hard-coded trilingual since it's shared
// across all 50 procedures. Translated by Dr. Joshi-vetted prose.
const COMMON_RISKS: Record<Lang, string[]> = {
  en: [
    'Risks related to anaesthesia (allergic reactions, breathing difficulty, rare cardiac events).',
    'Bleeding requiring blood transfusion (rare in most procedures, more likely in major surgery).',
    'Infection at surgical / catheter / wound site requiring antibiotics or further treatment.',
    'Deep vein thrombosis (DVT) and pulmonary embolism — preventable with early ambulation and stockings.',
    'Prolonged hospital stay or readmission if recovery is slower than expected.',
    'Need for additional procedures or open conversion if minimally-invasive approach fails.',
    'Allergic reaction to medications, dressings, antiseptics or contrast (if used).',
  ],
  hi: [
    'एनेस्थीसिया से संबंधित जोखिम (एलर्जी, सांस लेने में कठिनाई, दुर्लभ हृदय घटनाएं)।',
    'रक्त आधान आवश्यक रक्तस्राव (अधिकांश प्रक्रियाओं में दुर्लभ, बड़ी सर्जरी में अधिक संभावित)।',
    'सर्जिकल/कैथेटर/घाव स्थल पर संक्रमण; एंटीबायोटिक या आगे के उपचार की आवश्यकता।',
    'गहरी शिरा थ्रोम्बोसिस (DVT) एवं पल्मोनरी एम्बोलिज़्म — प्रारंभिक चलने एवं मोजों से रोकथाम।',
    'अपेक्षा से धीमी रिकवरी होने पर लंबा अस्पताल प्रवास या पुनः भर्ती।',
    'न्यूनतम-आक्रामक दृष्टिकोण विफल होने पर अतिरिक्त प्रक्रिया/ओपन रूपांतरण आवश्यक।',
    'दवाओं, ड्रेसिंग, एंटीसेप्टिक या कंट्रास्ट (यदि उपयोग) से एलर्जी।',
  ],
  gu: [
    'એનેસ્થેસિયા સંબંધિત જોખમો (એલર્જી, શ્વાસ લેવામાં મુશ્કેલી, દુર્લભ હૃદય ઘટનાઓ).',
    'રક્ત આધાન જરૂરી રક્તસ્રાવ (મોટાભાગની પ્રક્રિયાઓમાં દુર્લભ, મોટી સર્જરીમાં વધુ સંભવ).',
    'સર્જિકલ/કેથેટર/ઘા સ્થળે ચેપ; એન્ટિબાયોટિક અથવા આગળની સારવાર જરૂરી.',
    'ડીપ વેન થ્રોમ્બોસિસ (DVT) અને પલ્મોનરી એમ્બોલિઝમ — વહેલા ચાલવાથી અને મોજાંથી અટકાવી શકાય.',
    'અપેક્ષા કરતાં ધીમી રિકવરી હોય તો લાંબું હોસ્પિટલ રોકાણ અથવા પુનઃ દાખલ.',
    'ન્યૂનતમ-આક્રમક અભિગમ નિષ્ફળ જાય તો વધારાની પ્રક્રિયા/ઓપન રૂપાંતરની જરૂર.',
    'દવાઓ, ડ્રેસિંગ, એન્ટિસેપ્ટિક અથવા કોન્ટ્રાસ્ટ (વપરાય તો)થી એલર્જી.',
  ],
};

const DECLARATION: Record<Lang, string> = {
  en: 'I have read and understood the above information about the procedure, its benefits, alternatives, and possible risks. All my questions have been answered to my satisfaction. I voluntarily consent to undergo the above procedure under the care of the operating team and authorise additional procedures that may be deemed necessary during the operation in my best interest.',
  hi: 'मैंने ऊपर दी गई प्रक्रिया, उसके लाभ, विकल्प एवं संभावित जोखिमों की जानकारी पढ़ी और समझी है। मेरे सभी प्रश्नों के संतोषजनक उत्तर दिए गए हैं। मैं अपनी स्वेच्छा से उक्त प्रक्रिया हेतु सहमति देता/देती हूँ तथा ऑपरेशन के दौरान मेरे हित में आवश्यक समझी जाने वाली अतिरिक्त प्रक्रियाओं हेतु भी अनुमति देता/देती हूँ।',
  gu: 'મેં ઉપર આપેલી પ્રક્રિયા, તેના લાભો, વિકલ્પો અને સંભવિત જોખમો વિશેની માહિતી વાંચી અને સમજી છે. મારા તમામ પ્રશ્નોના સંતોષકારક જવાબ આપવામાં આવ્યા છે. હું મારી સ્વેચ્છાથી ઉપરની પ્રક્રિયા માટે સંમતિ આપું છું તથા ઓપરેશન દરમિયાન મારા હિતમાં જરૂરી માનેલી વધારાની પ્રક્રિયાઓ માટે પણ અધિકાર આપું છું.',
};

export default function NewConsentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    booking_id?: string;
    admission_id?: string;
    patient_name?: string; patient_phone?: string;
    patient_email?: string; patient_age?: string; patient_sex?: string;
    procedure?: string;
  }>();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [search, setSearch] = useState(params.procedure || '');
  // Phase 6.2 — multi-procedure consents. Array of selected procedure
  // keys preserves selection order so PDFs read top-to-bottom in the
  // order the doctor picked them. Single-pick still works (length=1).
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [language, setLanguage] = useState<Lang>('en');
  // Patient details (Step 2)
  const [patientName, setPatientName] = useState(params.patient_name || '');
  const [patientPhone, setPatientPhone] = useState(params.patient_phone || '');
  const [patientEmail, setPatientEmail] = useState(params.patient_email || '');
  const [patientAge, setPatientAge] = useState(params.patient_age || '');
  // Normalize sex to the consent's M/F/O button values. IPD/surgery
  // may send "male"/"female"/"other" — accept any common casing.
  const normSex = (() => {
    const v = (params.patient_sex || '').trim().toLowerCase();
    if (v === 'm' || v.startsWith('male')) return 'M';
    if (v === 'f' || v.startsWith('female')) return 'F';
    if (v === 'o' || v.startsWith('other')) return 'O';
    return '';
  })();
  const [patientSex, setPatientSex] = useState(normSex);
  const [witnessName, setWitnessName] = useState('');
  // Signatures (Step 4)
  const patSig = useRef<SignaturePadHandle>(null);
  const witSig = useRef<SignaturePadHandle>(null);
  const docSig = useRef<SignaturePadHandle>(null);
  const [patSigData, setPatSigData] = useState<string | null>(null);
  const [witSigData, setWitSigData] = useState<string | null>(null);
  const [docSigData, setDocSigData] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load procedures once
  useEffect(() => {
    api.get('/surgical-consents/procedures')
      .then((r) => setProcedures(r.data?.items || []))
      .catch(() => setProcedures([]));
  }, []);

  // Auto-select procedure(s) when arriving from IPD with a `procedure`
  // query param. IPD's planned procedure text is freeform (e.g.
  // "RIGHT RIRS + RIGHT DJ STENTING") so we split on '+' / '/' and
  // try to match each token against the 50 keyed procedures.
  // Any matching tokens get pre-selected. If no token matches, the
  // search box keeps the original text so the doctor can refine.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!params.procedure || procedures.length === 0) return;
    const tokens = params.procedure
      .split(/[+/]|,|\band\b/i)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const matched: string[] = [];
    for (const tok of tokens) {
      const stripped = tok.replace(/^(right|left|bilateral|b\/l)\s+/i, '').trim();
      const candidates = [tok, stripped];
      for (const cand of candidates) {
        const m = procedures.find((p) =>
          p.name.en.toLowerCase() === cand ||
          p.key.toLowerCase() === cand ||
          p.name.en.toLowerCase().replace(/\s+/g, '') === cand.replace(/\s+/g, '') ||
          p.name.en.toLowerCase().includes(cand) && cand.length >= 4,
        );
        if (m && !matched.includes(m.key)) {
          matched.push(m.key);
          break;
        }
      }
    }
    if (matched.length > 0) {
      autoSelectedRef.current = true;
      setSelectedKeys(matched);
      setSearch('');
      setStep(2);
    }
  }, [params.procedure, procedures]);

  const grouped = useMemo(() => {
    const filtered = procedures.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.name.en.toLowerCase().includes(q) ||
        p.name.hi.includes(search) ||
        p.name.gu.includes(search) ||
        p.key.includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    });
    const map: Record<string, Procedure[]> = {};
    for (const p of filtered) {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    }
    return map;
  }, [procedures, search]);

  // Derived: ordered list of selected procedure objects.
  const selectedProcs = useMemo(() => {
    const byKey: Record<string, Procedure> = {};
    procedures.forEach((p) => { byKey[p.key] = p; });
    return selectedKeys.map((k) => byKey[k]).filter(Boolean);
  }, [procedures, selectedKeys]);

  const toggleProc = (key: string) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
  };

  const canAdvance = (() => {
    if (step === 1) return selectedKeys.length > 0;
    if (step === 2) return patientName.trim().length > 0 && patientPhone.trim().length > 0;
    if (step === 3) return true;
    if (step === 4) return !!patSigData && !!docSigData;
    return false;
  })();

  // Patient + procedure selection is sufficient to save a record for
  // print-on-paper workflows. Signatures are entirely optional.
  const canSave = selectedKeys.length > 0 && patientName.trim().length > 0 && patientPhone.trim().length > 0;

  const save = async (skipSignatures: boolean = false) => {
    if (selectedKeys.length === 0) return;
    if (!skipSignatures && (!patSigData || !docSigData)) return;
    setSaving(true);
    try {
      const r = await api.post('/surgical-consents', {
        procedure_key: selectedKeys[0],
        procedure_keys: selectedKeys,
        language,
        patient_name: patientName.trim(),
        patient_phone: patientPhone.trim(),
        patient_email: patientEmail.trim() || undefined,
        patient_age: patientAge ? parseInt(patientAge, 10) : undefined,
        patient_sex: patientSex || undefined,
        booking_id: params.booking_id || undefined,
        admission_id: params.admission_id || undefined,
        patient_signature_b64: skipSignatures ? undefined : patSigData,
        witness_name: witnessName.trim() || undefined,
        witness_signature_b64: skipSignatures ? undefined : (witSigData || undefined),
        doctor_signature_b64: skipSignatures ? undefined : docSigData,
      });
      const cid = r.data?.consent_id;
      if (cid) router.replace(`/consents/${cid}` as any);
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || e?.message || 'Could not save consent.');
    } finally {
      setSaving(false);
    }
  };

  // "Save & print on paper" — confirms with the user that signatures
  // will be left blank for manual signing, then saves an unsigned
  // record and routes to the detail screen (which already renders
  // empty signature lines in the printable PDF).
  const saveUnsigned = () => {
    if (!canSave || saving) return;
    const proceed = () => save(true);
    if (Platform.OS === 'web') {
      const w: any = typeof window !== 'undefined' ? window : null;
      const ok = w?.confirm?.(
        'Save consent without signatures?\n\nThe printed PDF will leave the patient, witness and doctor signature lines blank so they can be signed manually on paper.',
      );
      if (ok) proceed();
      return;
    }
    Alert.alert(
      'Save without signing?',
      'The printed PDF will leave the patient, witness and doctor signature lines blank so they can be signed manually on paper.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save & continue', onPress: proceed },
      ],
    );
  };

  return (
    <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (step > 1 ? setStep((step - 1) as any) : (router.canGoBack() ? router.back() : router.replace('/' as any)))} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>New Consent</Text>
          <Text style={styles.headerSub}>Step {step} of 4</Text>
        </View>
      </View>
      {/* progress strip */}
      <View style={styles.progressRow}>
        {[1, 2, 3, 4].map((s) => (
          <View key={s} style={[styles.progressDot, step >= s && styles.progressDotActive]} />
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Step 1 — Procedure picker (multi-select) */}
        {step === 1 && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 96 }}>
            <Text style={styles.sectionTitle}>Choose procedure(s)</Text>
            <Text style={styles.helper}>
              Tap to select. Pick more than one for combined procedures (e.g. RIRS + DJ Stent).
            </Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search 50 procedures..."
                placeholderTextColor={COLORS.textSecondary}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            {selectedProcs.length > 0 ? (
              <View style={styles.selectedBar}>
                <Text style={styles.selectedBarLabel}>Selected ({selectedProcs.length})</Text>
                <View style={styles.selectedChipsWrap}>
                  {selectedProcs.map((p) => (
                    <TouchableOpacity
                      key={p.key}
                      style={styles.selectedChip}
                      onPress={() => toggleProc(p.key)}
                      testID={`consent-selected-chip-${p.key}`}
                    >
                      <Text style={styles.selectedChipText} numberOfLines={1}>{p.name.en}</Text>
                      <Ionicons name="close-circle" size={16} color="#fff" />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}
            {Object.keys(grouped).length === 0 ? (
              <Text style={styles.empty}>No procedures match your search.</Text>
            ) : (
              Object.entries(grouped).map(([cat, items]) => (
                <View key={cat} style={{ marginTop: 16 }}>
                  <Text style={styles.catTitle}>{cat}</Text>
                  <View style={{ gap: 6, marginTop: 6 }}>
                    {items.map((p) => {
                      const isOn = selectedKeys.includes(p.key);
                      return (
                        <TouchableOpacity
                          key={p.key}
                          style={[styles.procRow, isOn && styles.procRowActive]}
                          onPress={() => toggleProc(p.key)}
                          testID={`consent-proc-${p.key}`}
                        >
                          <View style={[styles.checkbox, isOn && styles.checkboxOn]}>
                            {isOn ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                          </View>
                          <Text style={[styles.procName, isOn && styles.procNameActive]} numberOfLines={2}>{p.name.en}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
        {/* Step 2 — Patient details */}
        {step === 2 && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Patient details</Text>
            <Text style={styles.label}>Patient name *</Text>
            <TextInput style={styles.input} value={patientName} onChangeText={setPatientName} placeholder="Full name" placeholderTextColor={COLORS.textSecondary} />
            <Text style={styles.label}>Phone *</Text>
            <TextInput style={styles.input} value={patientPhone} onChangeText={setPatientPhone} placeholder="+91 9876543210" placeholderTextColor={COLORS.textSecondary} keyboardType="phone-pad" />
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={patientEmail} onChangeText={setPatientEmail} placeholder="patient@example.com" placeholderTextColor={COLORS.textSecondary} keyboardType="email-address" autoCapitalize="none" />
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Age</Text>
                <TextInput style={styles.input} value={patientAge} onChangeText={setPatientAge} placeholder="65" placeholderTextColor={COLORS.textSecondary} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Sex</Text>
                <View style={styles.sexRow}>
                  {['M', 'F', 'O'].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setPatientSex(s)} style={[styles.sexBtn, patientSex === s && styles.sexBtnActive]}>
                      <Text style={[styles.sexText, patientSex === s && { color: '#fff' }]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
            <Text style={styles.label}>Witness name (optional)</Text>
            <TextInput style={styles.input} value={witnessName} onChangeText={setWitnessName} placeholder="Relative / friend who is present" placeholderTextColor={COLORS.textSecondary} />
          </ScrollView>
        )}
        {/* Step 3 — Read consent (renders each selected procedure) */}
        {step === 3 && selectedProcs.length > 0 && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 96 }}>
            <View style={styles.langToggleRow}>
              {(['en', 'hi', 'gu'] as Lang[]).map((l) => (
                <TouchableOpacity key={l} style={[styles.langBtn, language === l && styles.langBtnActive]} onPress={() => setLanguage(l)}>
                  <Text style={[styles.langBtnText, language === l && { color: '#fff' }]}>
                    {l === 'en' ? 'English' : l === 'hi' ? 'हिंदी' : 'ગુજરાતી'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.docTitle}>
              {selectedProcs.map((p) => p.name[language]).join(' + ')}
            </Text>
            <Text style={styles.docSub}>
              {language === 'en' ? 'For patient: ' : language === 'hi' ? 'रोगी हेतु: ' : 'દર્દી માટે: '}
              {patientName} {patientAge ? `· ${patientAge}y` : ''} {patientSex ? `· ${patientSex}` : ''}
            </Text>

            {selectedProcs.map((sp, idx) => (
              <View key={sp.key} style={idx > 0 ? { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border } : null}>
                {selectedProcs.length > 1 ? (
                  <Text style={styles.procBlockHeading}>
                    {idx + 1}. {sp.name[language]}
                  </Text>
                ) : null}
                <Text style={styles.h3}>{language === 'en' ? 'Procedure' : language === 'hi' ? 'प्रक्रिया' : 'પ્રક્રિયા'}</Text>
                <Text style={styles.p}>{sp.procedure[language]}</Text>

                <Text style={styles.h3}>{language === 'en' ? 'Procedure-specific risks' : language === 'hi' ? 'प्रक्रिया-विशिष्ट जोखिम' : 'પ્રક્રિયા-વિશિષ્ટ જોખમો'}</Text>
                {sp.specific_risks.map((r, i) => (
                  <Text key={i} style={styles.bullet}>• {r[language]}</Text>
                ))}

                <Text style={styles.h3}>{language === 'en' ? 'Alternatives' : language === 'hi' ? 'विकल्प' : 'વિકલ્પો'}</Text>
                <Text style={styles.p}>{sp.alternatives[language]}</Text>
              </View>
            ))}

            <View style={{ marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border }}>
              <Text style={styles.h3}>{language === 'en' ? 'Common surgical risks' : language === 'hi' ? 'सामान्य सर्जिकल जोखिम' : 'સામાન્ય સર્જિકલ જોખમો'}</Text>
              {COMMON_RISKS[language].map((r, i) => (
                <Text key={i} style={styles.bullet}>• {r}</Text>
              ))}

              <Text style={styles.h3}>{language === 'en' ? 'Declaration' : language === 'hi' ? 'घोषणा' : 'ઘોષણા'}</Text>
              <Text style={styles.p}>{DECLARATION[language]}</Text>
            </View>
          </ScrollView>
        )}
        {/* Step 4 — Sign */}
        {step === 4 && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionTitle}>Signatures</Text>
            <Text style={styles.helper}>Optional. Patient + Doctor signatures are needed to mark this consent as fully signed in the app. To sign on paper, tap "Skip — sign on paper" below to print the PDF with blank signature lines.</Text>
            <View style={{ marginTop: 12 }}>
              <SignaturePad
                ref={patSig}
                label={`Patient — ${patientName}`}
                value={patSigData}
                onChange={setPatSigData}
              />
            </View>
            <View style={{ marginTop: 16 }}>
              <SignaturePad
                ref={witSig}
                label={`Witness — ${witnessName || '(not specified)'}`}
                value={witSigData}
                onChange={setWitSigData}
              />
            </View>
            <View style={{ marginTop: 16 }}>
              <SignaturePad
                ref={docSig}
                label={`Doctor — ${user?.full_name || user?.email || 'Doctor'}`}
                value={docSigData}
                onChange={setDocSigData}
              />
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      {/* Footer nav */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        {step < 4 ? (
          <View style={styles.footerRow}>
            {step === 3 ? (
              <TouchableOpacity
                style={[styles.skipBtn, (!canSave || saving) && styles.nextBtnDisabled]}
                disabled={!canSave || saving}
                onPress={saveUnsigned}
                testID="consent-skip-sign"
              >
                {saving ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <>
                    <Ionicons name="print-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.skipBtnText}>Save without signing</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.nextBtn, !canAdvance && styles.nextBtnDisabled, step === 3 && { flex: 1 }]}
              disabled={!canAdvance}
              onPress={() => setStep((step + 1) as any)}
              testID="consent-next"
            >
              <Text style={styles.nextBtnText}>{step === 3 ? 'Sign on app' : 'Continue'}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.skipBtn, (!canSave || saving) && styles.nextBtnDisabled]}
              disabled={!canSave || saving}
              onPress={saveUnsigned}
              testID="consent-skip-sign-step4"
            >
              <Ionicons name="print-outline" size={16} color={COLORS.primary} />
              <Text style={styles.skipBtnText}>Skip — sign on paper</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.nextBtn, (!canAdvance || saving) && styles.nextBtnDisabled, { flex: 1 }]}
              disabled={!canAdvance || saving}
              onPress={() => save(false)}
              testID="consent-save"
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                  <Text style={styles.nextBtnText}>Save consent</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: COLORS.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { padding: 4 },
  headerTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  progressRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  progressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.border },
  progressDotActive: { backgroundColor: COLORS.primary },
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  searchInput: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 14 },
  catTitle: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  procRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  procRowActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '0F' },
  procName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  procNameActive: { color: COLORS.primary },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  procBlockHeading: {
    ...FONTS.bodyMedium, color: COLORS.primary,
    fontSize: 14, marginTop: 8, marginBottom: 6,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  selectedBar: {
    marginTop: 12, padding: 10, borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  selectedBarLabel: {
    ...FONTS.label, color: COLORS.primary, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  selectedChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  selectedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, backgroundColor: COLORS.primary,
    maxWidth: '100%',
  },
  selectedChipText: { color: '#fff', fontSize: 12, fontWeight: '600', maxWidth: 220 },
  empty: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 24 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12, fontSize: 11, textTransform: 'uppercase' },
  input: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
  sexRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  sexBtn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center' },
  sexBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  sexText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  langToggleRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  langBtn: { flex: 1, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', alignItems: 'center' },
  langBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  langBtnText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  docTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 4 },
  docSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 12 },
  h3: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15, marginTop: 14, marginBottom: 6 },
  p: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, lineHeight: 21 },
  bullet: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, lineHeight: 20, marginLeft: 4 },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 6 },
  footer: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 12, backgroundColor: '#fff' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 18, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary, flex: 1 },
  nextBtnDisabled: { opacity: 0.45 },
  nextBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 15 },
  skipBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary, flex: 1 },
  skipBtnText: { color: COLORS.primary, ...FONTS.bodyMedium, fontSize: 13 },
});
