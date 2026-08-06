/**
 * /consents/[id] — detail + printable view of a saved surgical consent.
 *
 * Renders the consent in the original signing language with all
 * signatures inline and offers two actions:
 *   - Print (uses expo-print on native, window.print() on web)
 *   - Download PDF (POSTs the rendered HTML to /api/render/pdf and
 *     opens the resulting blob in a new tab/share sheet).
 *
 * The HTML for printing is built from the same data shape used in the
 * wizard step-3 preview, so visual parity is guaranteed.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { downloadConsentPdf, loadConsentSettings, printConsentPdf } from '../../src/consent-pdf';
import type { ClinicSettings } from '../../src/rx-pdf';

type Lang = 'en' | 'hi' | 'gu';

const COMMON_RISKS: Record<Lang, string[]> = {
  en: [
    'Risks related to anaesthesia.',
    'Bleeding requiring blood transfusion.',
    'Infection requiring antibiotics or further treatment.',
    'Deep vein thrombosis (DVT) and pulmonary embolism.',
    'Prolonged hospital stay or readmission.',
    'Need for additional procedures or open conversion.',
    'Allergic reaction to medications, dressings, antiseptics or contrast.',
  ],
  hi: [
    'एनेस्थीसिया से संबंधित जोखिम।',
    'रक्त आधान आवश्यक रक्तस्राव।',
    'एंटीबायोटिक/आगे के उपचार आवश्यक संक्रमण।',
    'गहरी शिरा थ्रोम्बोसिस (DVT) एवं पल्मोनरी एम्बोलिज़्म।',
    'लंबा अस्पताल प्रवास या पुनः भर्ती।',
    'अतिरिक्त प्रक्रिया/ओपन रूपांतरण आवश्यक।',
    'दवा/ड्रेसिंग/एंटीसेप्टिक/कंट्रास्ट से एलर्जी।',
  ],
  gu: [
    'એનેસ્થેસિયા સંબંધિત જોખમો.',
    'રક્ત આધાન જરૂરી રક્તસ્રાવ.',
    'એન્ટિબાયોટિક/આગળની સારવાર જરૂરી ચેપ.',
    'ડીપ વેન થ્રોમ્બોસિસ (DVT) અને પલ્મોનરી એમ્બોલિઝમ.',
    'લાંબું હોસ્પિટલ રોકાણ અથવા પુનઃ દાખલ.',
    'વધારાની પ્રક્રિયા/ઓપન રૂપાંતર જરૂરી.',
    'દવા/ડ્રેસિંગ/એન્ટિસેપ્ટિક/કોન્ટ્રાસ્ટથી એલર્જી.',
  ],
};

const DECLARATION: Record<Lang, string> = {
  en: 'I have read and understood the above information about the procedure, its benefits, alternatives, and possible risks. All my questions have been answered to my satisfaction. I voluntarily consent to undergo the above procedure.',
  hi: 'मैंने ऊपर दी गई प्रक्रिया, उसके लाभ, विकल्प एवं संभावित जोखिमों की जानकारी पढ़ी और समझी है। मेरे सभी प्रश्नों के संतोषजनक उत्तर दिए गए हैं। मैं अपनी स्वेच्छा से उक्त प्रक्रिया हेतु सहमति देता/देती हूँ।',
  gu: 'મેં ઉપર આપેલી પ્રક્રિયા, તેના લાભો, વિકલ્પો અને સંભવિત જોખમો વિશેની માહિતી વાંચી અને સમજી છે. મારા તમામ પ્રશ્નોના સંતોષકારક જવાબ આપવામાં આવ્યા છે. હું મારી સ્વેચ્છાથી ઉપરની પ્રક્રિયા માટે સંમતિ આપું છું.',
};

const LABELS: Record<Lang, Record<string, string>> = {
  en: { procedure: 'Procedure', commonRisks: 'Common surgical risks', specRisks: 'Procedure-specific risks', alts: 'Alternatives', decl: 'Declaration', sigPatient: 'Patient signature', sigWitness: 'Witness signature', sigDoctor: 'Doctor signature', date: 'Date', name: 'Name', not_provided: 'Not provided' },
  hi: { procedure: 'प्रक्रिया', commonRisks: 'सामान्य सर्जिकल जोखिम', specRisks: 'प्रक्रिया-विशिष्ट जोखिम', alts: 'विकल्प', decl: 'घोषणा', sigPatient: 'रोगी हस्ताक्षर', sigWitness: 'गवाह हस्ताक्षर', sigDoctor: 'डॉक्टर हस्ताक्षर', date: 'दिनांक', name: 'नाम', not_provided: 'प्रदान नहीं किया' },
  gu: { procedure: 'પ્રક્રિયા', commonRisks: 'સામાન્ય સર્જિકલ જોખમો', specRisks: 'પ્રક્રિયા-વિશિષ્ટ જોખમો', alts: 'વિકલ્પો', decl: 'ઘોષણા', sigPatient: 'દર્દી હસ્તાક્ષર', sigWitness: 'સાક્ષી હસ્તાક્ષર', sigDoctor: 'ડોક્ટર હસ્તાક્ષર', date: 'તારીખ', name: 'નામ', not_provided: 'આપેલ નથી' },
};

// (Premium A4 / trilingual / branded print HTML is built by
//  src/consent-pdf.ts → buildConsentHtml. The in-app on-screen
//  preview below still uses RN components for native rendering.)

export default function ConsentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [clinic, setClinic] = useState<ClinicSettings>({});
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get(`/surgical-consents/${id}`)
      .then((r) => setDoc(r.data))
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch clinic / doctor branding once; used in the premium PDF header.
  useEffect(() => {
    loadConsentSettings().then(setClinic).catch(() => setClinic({}));
  }, []);

  const handlePrint = async () => {
    if (!doc || busy) return;
    setBusy('print');
    try { await printConsentPdf(doc, clinic); }
    finally { setBusy(null); }
  };

  const handleDownloadPdf = async () => {
    if (!doc || busy) return;
    setBusy('pdf');
    try { await downloadConsentPdf(doc, clinic); }
    finally { setBusy(null); }
  };

  if (loading) {
    return (
      <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
        <ActivityIndicator style={{ marginTop: 32 }} color={COLORS.primary} />
      </View>
    );
  }
  if (!doc) {
    return (
      <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
        <View style={styles.center}>
          <Ionicons name="document-outline" size={48} color={COLORS.textSecondary} />
          <Text style={styles.muted}>Consent not found.</Text>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  const lang: Lang = doc.language || 'en';
  // Phase 6.2 — multi-procedure consents. Fall back to the legacy
  // single-procedure snapshot when an older doc is opened.
  const procSnapshots: any[] = (
    Array.isArray(doc.procedure_snapshots) && doc.procedure_snapshots.length > 0
      ? doc.procedure_snapshots
      : (doc.procedure_snapshot ? [doc.procedure_snapshot] : [])
  );
  const proc = procSnapshots[0] || {};
  const combinedTitle = procSnapshots.length > 0
    ? procSnapshots.map((p) => p?.name?.[lang] || p?.name?.en).filter(Boolean).join(' + ')
    : (doc.procedure_key || '—');
  const L = LABELS[lang];
  const formatTs = doc.created_at ? format(new Date(doc.created_at), 'd MMM yyyy, h:mm a') : '';

  return (
    <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Surgical Consent</Text>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 100 }}>
        <Text style={styles.title}>{combinedTitle}</Text>
        <Text style={styles.metaLine}>
          {L.name}: <Text style={{ fontWeight: '600' }}>{doc.patient_name}</Text>
          {doc.patient_age ? ` · ${doc.patient_age}y` : ''}
          {doc.patient_sex ? ` · ${doc.patient_sex}` : ''}
        </Text>
        <Text style={styles.metaLine}>{L.date}: {formatTs}</Text>

        {procSnapshots.map((sp, idx) => (
          <View key={idx} style={idx > 0 ? { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border } : null}>
            {procSnapshots.length > 1 ? (
              <Text style={styles.procBlockHeading}>
                {idx + 1}. {sp?.name?.[lang] || sp?.name?.en}
              </Text>
            ) : null}
            <Text style={styles.h3}>{L.procedure}</Text>
            <Text style={styles.p}>{sp?.procedure?.[lang]}</Text>

            <Text style={styles.h3}>{L.specRisks}</Text>
            {sp?.specific_risks?.map((r: any, i: number) => (
              <Text key={i} style={styles.bullet}>• {r?.[lang] || r?.en}</Text>
            ))}

            <Text style={styles.h3}>{L.alts}</Text>
            <Text style={styles.p}>{sp?.alternatives?.[lang]}</Text>
          </View>
        ))}

        <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border }}>
          <Text style={styles.h3}>{L.commonRisks}</Text>
          {COMMON_RISKS[lang].map((r, i) => <Text key={i} style={styles.bullet}>• {r}</Text>)}

          <Text style={styles.h3}>{L.decl}</Text>
          <Text style={styles.p}>{DECLARATION[lang]}</Text>
        </View>

        <View style={styles.sigGrid}>
          <View style={styles.sigBlock}>
            {doc.patient_signature_b64 ? (
              <Image source={{ uri: doc.patient_signature_b64 }} style={styles.sigImg} resizeMode="contain" />
            ) : <View style={styles.sigBlank} />}
            <Text style={styles.sigLabel}>{L.sigPatient}</Text>
            <Text style={styles.sigWho}>{doc.patient_name}</Text>
          </View>
          <View style={styles.sigBlock}>
            {doc.witness_signature_b64 ? (
              <Image source={{ uri: doc.witness_signature_b64 }} style={styles.sigImg} resizeMode="contain" />
            ) : <View style={styles.sigBlank} />}
            <Text style={styles.sigLabel}>{L.sigWitness}</Text>
            <Text style={styles.sigWho}>{doc.witness_name || L.not_provided}</Text>
          </View>
          <View style={styles.sigBlock}>
            {doc.doctor_signature_b64 ? (
              <Image source={{ uri: doc.doctor_signature_b64 }} style={styles.sigImg} resizeMode="contain" />
            ) : <View style={styles.sigBlank} />}
            <Text style={styles.sigLabel}>{L.sigDoctor}</Text>
            <Text style={styles.sigWho}>Dr. Sagar Joshi</Text>
          </View>
        </View>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity onPress={handlePrint} style={styles.actionBtnGhost} disabled={!!busy}>
          {busy === 'print' ? (
            <ActivityIndicator color={COLORS.primary} size="small" />
          ) : (
            <>
              <Ionicons name="print-outline" size={18} color={COLORS.primary} />
              <Text style={styles.actionBtnGhostText}>Print</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDownloadPdf} style={styles.actionBtn} disabled={!!busy}>
          {busy === 'pdf' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color="#fff" />
              <Text style={styles.actionBtnText}>Download PDF</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  backBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  headerBtn: { padding: 4 },
  headerTitle: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1 },
  title: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 6 },
  procBlockHeading: {
    ...FONTS.bodyMedium, color: COLORS.primary,
    fontSize: 14, marginTop: 6, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  metaLine: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 },
  h3: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15, marginTop: 14, marginBottom: 6 },
  p: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14, lineHeight: 21 },
  bullet: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, lineHeight: 20, marginLeft: 4 },
  sigGrid: { flexDirection: 'row', gap: 8, marginTop: 24, flexWrap: 'wrap' },
  sigBlock: { flex: 1, minWidth: 110, alignItems: 'center' },
  sigImg: { width: '100%', height: 70, marginBottom: 4 },
  sigBlank: { width: '100%', height: 70, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: COLORS.textSecondary },
  sigLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, textAlign: 'center', textTransform: 'uppercase' },
  sigWho: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12, textAlign: 'center' },
  footer: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 10 },
  actionBtnGhost: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary },
  actionBtnGhostText: { color: COLORS.primary, ...FONTS.bodyMedium, fontSize: 14 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  actionBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
});
