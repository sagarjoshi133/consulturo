/*
 * RecordingConsentBanner — patient-facing banner shown on the
 * pre-call screen when `enable_recording_consent` is on. Patient
 * must explicitly grant consent before recording can start; the
 * staff console refuses to start without it.
 */
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, RADIUS } from '../theme';

type Props = {
  bookingId: string;
  lang?: 'en' | 'hi' | 'gu';
  onDecision?: (granted: boolean) => void;
};

export default function RecordingConsentBanner({ bookingId, lang = 'en', onDecision }: Props) {
  const [state, setState] = useState<'pending' | 'granted' | 'declined' | 'saving'>('pending');

  const submit = async (granted: boolean) => {
    setState('saving');
    try {
      await api.post(`/video/bookings/${bookingId}/recording/consent`, { granted });
      setState(granted ? 'granted' : 'declined');
      onDecision?.(granted);
    } catch {
      setState('pending');
    }
  };

  if (state === 'granted' || state === 'declined') {
    return (
      <View style={[styles.wrap, state === 'granted' ? styles.wrapGranted : styles.wrapDeclined]}>
        <Ionicons
          name={state === 'granted' ? 'checkmark-circle' : 'close-circle'}
          size={18}
          color={state === 'granted' ? COLORS.success : COLORS.textSecondary}
        />
        <Text style={styles.statusText}>
          {state === 'granted' ? T(lang, 'Recording consent granted', 'रिकॉर्डिंग की सहमति दी गई', 'રેકોર્ડિંગ સંમતિ આપી') : T(lang, 'Recording declined', 'रिकॉर्डिंग अस्वीकृत', 'રેકોર્ડિંગ નકારી')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <Ionicons name="recording" size={14} color="#fff" />
        </View>
        <Text style={styles.title}>
          {T(lang, 'May we record this consult?', 'क्या हम इस परामर्श को रिकॉर्ड कर सकते हैं?', 'શું અમે આ સલાહને રેકોર્ડ કરી શકીએ?')}
        </Text>
      </View>
      <Text style={styles.body}>
        {T(
          lang,
          'Recording stays in your private clinical record so Dr. Sagar Joshi can review it later. You can refuse — the call still happens.',
          'रिकॉर्डिंग आपके निजी क्लिनिकल रिकॉर्ड में रहती है ताकि डॉ. सागर जोशी बाद में देख सकें। आप मना कर सकते हैं — कॉल वैसे भी होगी।',
          'રેકોર્ડિંગ તમારા ખાનગી ક્લિનિકલ રેકોર્ડમાં રહે છે જેથી ડૉ. સાગર જોશી પછી જોઈ શકે. તમે ના પાડી શકો — કૉલ તો યથાવત રહેશે.',
        )}
      </Text>
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => submit(false)}
          disabled={state === 'saving'}
          testID="recording-decline"
        >
          <Text style={styles.btnSecondaryText}>
            {T(lang, 'Not now', 'अभी नहीं', 'હમણાં નહીં')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => submit(true)}
          disabled={state === 'saving'}
          testID="recording-consent"
        >
          {state === 'saving' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnPrimaryText}>{T(lang, 'I consent', 'मैं सहमत हूँ', 'હું સંમત છું')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function T(lang: string, en: string, hi: string, gu: string): string {
  return lang === 'hi' ? hi : lang === 'gu' ? gu : en;
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#FFFBEF', borderWidth: 1, borderColor: '#F5C26B' + '55',
    borderRadius: RADIUS.md, padding: 12, marginVertical: 10,
  },
  wrapGranted: { backgroundColor: '#F4FBF6', borderColor: COLORS.success + '55', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginVertical: 10 },
  wrapDeclined: { backgroundColor: '#F4F7F7', borderColor: '#DDEAEE', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginVertical: 10 },
  statusText: { color: COLORS.primaryDark, fontSize: 12.5, fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  iconCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E07B2B', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#5C3D00', fontSize: 13, fontWeight: '800' },
  body: { color: '#7A5A1F', fontSize: 12, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.pill, alignItems: 'center' },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDEAEE' },
  btnSecondaryText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600' },
});
