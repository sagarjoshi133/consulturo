/*
 * AutoSummaryCard — Staff button + display for the Gemini-generated
 * post-call SOAP summary (Bundle H).
 *
 * UX:
 *   • Initial state: form with "Doctor's call notes" textarea +
 *     optional "Diagnosis hint" + "Generate summary" button.
 *   • Loading: spinner with explainer "Reading intake + your notes…".
 *   • Result: SOAP cards (S/O/A/P), red-flags strip, and a copy-able
 *     WhatsApp follow-up message with one-tap "Send via WhatsApp"
 *     (opens wa.me deep link).
 *   • Re-generate: button re-calls the LLM with new notes.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';

type Summary = {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  red_flags?: string;
  whatsapp_followup?: string;
  generated_at?: string;
  _raw?: string;
};

type Props = {
  bookingId: string;
  patientPhone?: string;
  visible: boolean;
};

export default function AutoSummaryCard({ bookingId, patientPhone, visible }: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState('');
  const [hint, setHint] = useState('');
  const [loading, setLoading] = useState(false);
  const [rxBusy, setRxBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  /* Load any prior summary on mount */
  useEffect(() => {
    if (!visible) return;
    api.get(`/video/bookings/${bookingId}/summary`)
      .then((r) => {
        const s = r.data?.summary || {};
        if (s.subjective || s.plan || s._raw) setSummary(s);
      })
      .catch(() => {});
  }, [bookingId, visible]);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post(`/video/bookings/${bookingId}/summary`, {
        doctor_notes: notes.trim() || null,
        diagnosis_hint: hint.trim() || null,
      });
      setSummary(r.data?.summary || null);
    } catch (e: any) {
      Alert.alert('Summary', e?.response?.data?.detail || 'LLM failed. Try again in a moment.');
    } finally { setLoading(false); }
  }, [bookingId, notes, hint]);

  const copy = useCallback(async (text: string, label = 'Text') => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', `${label} copied to clipboard.`);
  }, []);

  const sendWhatsApp = useCallback((text: string) => {
    if (!text) return;
    const digits = (patientPhone || '').replace(/\D/g, '');
    const wa = digits.length > 10 ? digits : `91${digits}`;
    if (!wa) {
      copy(text, 'Follow-up message');
      return;
    }
    const url = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => copy(text, 'Follow-up message'));
  }, [patientPhone, copy]);

  /* ── Bundle E — Generate Rx draft + open the Rx form ───────── */
  const generateRxDraft = useCallback(async () => {
    setRxBusy(true);
    try {
      await api.post(`/video/bookings/${bookingId}/rx-draft`, {
        doctor_notes: notes.trim() || null,
        diagnosis_hint: hint.trim() || null,
      });
      // Server has stored the draft on the booking — new.tsx will
      // pull it via the existing fetch-and-prefill flow.
      router.push({
        pathname: '/prescriptions/new',
        params: { bookingId, prefill: 'rx_draft' },
      } as any);
    } catch (e: any) {
      Alert.alert('Rx draft', e?.response?.data?.detail || 'LLM failed. Try again in a moment.');
    } finally { setRxBusy(false); }
  }, [bookingId, notes, hint, router]);

  if (!visible) return null;

  return (
    <View style={styles.card} testID="auto-summary-card">
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="sparkles" size={13} color="#fff" />
        </View>
        <Text style={styles.title}>Post-call summary (AI)</Text>
      </View>

      {/* Form */}
      <TextInput
        style={styles.input}
        placeholder="Your call notes — what was discussed, exam findings, plan in your own words…"
        placeholderTextColor="#9AAFB3"
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={4000}
        testID="summary-notes"
      />
      <TextInput
        style={[styles.input, { minHeight: 38 }]}
        placeholder="Likely diagnosis (optional, helps the AI)…"
        placeholderTextColor="#9AAFB3"
        value={hint}
        onChangeText={setHint}
        maxLength={300}
        testID="summary-hint"
      />
      <TouchableOpacity
        style={[styles.genBtn, loading && styles.genBtnLoading]}
        onPress={generate}
        disabled={loading}
        testID="summary-generate"
      >
        {loading ? (
          <>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.genBtnText}>Reading intake + your notes…</Text>
          </>
        ) : (
          <>
            <Ionicons name="sparkles" size={14} color="#fff" />
            <Text style={styles.genBtnText}>
              {summary ? 'Re-generate summary' : 'Generate summary'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Result */}
      {summary ? (
        <View style={styles.result}>
          <SoapBlock label="Subjective" text={summary.subjective} />
          <SoapBlock label="Objective"  text={summary.objective}  />
          <SoapBlock label="Assessment" text={summary.assessment} />
          <SoapBlock label="Plan"       text={summary.plan}       />

          {/* Bundle E — Generate Rx draft button */}
          <TouchableOpacity
            style={[styles.rxBtn, rxBusy && styles.rxBtnLoading]}
            onPress={generateRxDraft}
            disabled={rxBusy}
            testID="summary-rx-draft"
          >
            {rxBusy ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.rxBtnText}>Drafting Rx…</Text>
              </>
            ) : (
              <>
                <Ionicons name="medical" size={14} color="#fff" />
                <Text style={styles.rxBtnText}>Generate Rx draft & open form</Text>
              </>
            )}
          </TouchableOpacity>

          {summary.red_flags && summary.red_flags.trim() && !/^not documented$/i.test(summary.red_flags) ? (
            <View style={styles.redFlags}>
              <Ionicons name="warning" size={13} color="#9A2F2F" />
              <Text style={styles.redFlagsText}>{summary.red_flags}</Text>
            </View>
          ) : null}

          {summary.whatsapp_followup ? (
            <View style={styles.waBlock}>
              <View style={styles.waHeader}>
                <Ionicons name="logo-whatsapp" size={14} color="#25D366" />
                <Text style={styles.waTitle}>Patient follow-up message</Text>
              </View>
              <Text style={styles.waText}>{summary.whatsapp_followup}</Text>
              <View style={styles.waBtnRow}>
                <TouchableOpacity
                  style={[styles.waBtn, styles.waBtnSecondary]}
                  onPress={() => copy(summary.whatsapp_followup!, 'Message')}
                  testID="summary-copy"
                >
                  <Ionicons name="copy-outline" size={13} color={COLORS.primary} />
                  <Text style={styles.waBtnSecondaryText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.waBtn, styles.waBtnPrimary]}
                  onPress={() => sendWhatsApp(summary.whatsapp_followup!)}
                  testID="summary-send-wa"
                >
                  <Ionicons name="logo-whatsapp" size={13} color="#fff" />
                  <Text style={styles.waBtnPrimaryText}>Send via WhatsApp</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {summary._raw ? (
            <Text style={styles.rawWarn}>
              ⚠ The LLM returned unstructured text — shown raw below.{'\n\n'}{summary._raw}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SoapBlock({ label, text }: { label: string; text?: string }) {
  if (!text || /^not documented$/i.test(text.trim())) {
    return (
      <View style={styles.soap}>
        <Text style={styles.soapLabel}>{label}</Text>
        <Text style={styles.soapTextEmpty}>Not documented</Text>
      </View>
    );
  }
  return (
    <View style={styles.soap}>
      <Text style={styles.soapLabel}>{label}</Text>
      <Text style={styles.soapText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12, padding: 14,
    borderRadius: RADIUS.md,
    backgroundColor: '#F4FBFE',
    borderWidth: 1, borderColor: COLORS.primary + '33',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  headerIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 12.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDEAEE',
    borderRadius: RADIUS.md, paddingHorizontal: 11,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    fontSize: 13, color: COLORS.textPrimary, minHeight: 64, textAlignVertical: 'top',
    marginBottom: 8,
  },
  genBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  genBtnLoading: { backgroundColor: '#5095A0' },
  genBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  result: { marginTop: 14, gap: 8 },
  soap: { backgroundColor: '#fff', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#DDEAEE' },
  soapLabel: { color: COLORS.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  soapText: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18 },
  soapTextEmpty: { color: '#9AAFB3', fontSize: 12, fontStyle: 'italic' },

  redFlags: { flexDirection: 'row', gap: 6, backgroundColor: '#FFF0F0', padding: 9, borderRadius: 10, borderWidth: 1, borderColor: '#F4C4C4' },
  redFlagsText: { color: '#9A2F2F', fontSize: 12, lineHeight: 17, flex: 1 },

  waBlock: { backgroundColor: '#fff', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#25D366' + '44', marginTop: 4 },
  waHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  waTitle: { color: COLORS.primaryDark, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  waText: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  waBtnRow: { flexDirection: 'row', gap: 8 },
  waBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: RADIUS.pill },
  waBtnPrimary: { backgroundColor: '#25D366' },
  waBtnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  waBtnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary + '55' },
  waBtnSecondaryText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },

  rawWarn: { color: '#7A5A1F', fontSize: 11, lineHeight: 16, padding: 8, backgroundColor: '#FFFBEF', borderRadius: 8 },

  /* Bundle E — Rx draft button */
  rxBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: RADIUS.pill,
    backgroundColor: '#7C4DFF', marginTop: 4,
  },
  rxBtnLoading: { backgroundColor: '#9F86E0' },
  rxBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
