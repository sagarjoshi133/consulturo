/*
 * WaitingRoomQueue — Patient-facing live queue status (Bundle F).
 *
 * Polls /api/video/bookings/{id}/queue-position every 25s on the
 * pre-call screen so the patient knows whether the doctor is busy
 * with someone else and roughly how long until they'll be seen.
 *
 * Shape:
 *   • Big "You are #X" pill
 *   • Subtext: "1 patient ahead of you" / "Doctor is in another consult"
 *   • Soft pulsing dot for the live feel
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, RADIUS } from '../theme';

type Q = {
  position?: number;
  ahead_of_you?: number;
  est_wait_minutes?: number;
  doctor_in_call?: boolean;
  total_in_queue?: number;
};

type Props = {
  bookingId: string;
  lang?: 'en' | 'hi' | 'gu';
};

function T(lang: string, en: string, hi: string, gu: string): string {
  return lang === 'hi' ? hi : lang === 'gu' ? gu : en;
}

export default function WaitingRoomQueue({ bookingId, lang = 'en' }: Props) {
  const [q, setQ] = useState<Q | null>(null);
  const [errored, setErrored] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    let timer: any = null;

    const fetchPos = async () => {
      try {
        const r = await api.get(`/video/bookings/${bookingId}/queue-position`);
        if (cancelled) return;
        setErrored(false);
        setQ(r.data || {});
      } catch {
        if (!cancelled) setErrored(true);
      }
    };

    fetchPos();
    timer = setInterval(fetchPos, 25000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [bookingId]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
      { iterations: -1 },
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (errored || !q) return null;
  const pos = q.position || 1;
  const ahead = q.ahead_of_you || 0;
  const est = q.est_wait_minutes || 0;

  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  let subline: string;
  if (q.doctor_in_call) {
    subline = T(lang,
      `Doctor is currently in another consult · about ${est} min wait`,
      `डॉक्टर अभी एक और परामर्श में हैं · लगभग ${est} मिनट प्रतीक्षा`,
      `ડૉક્ટર હાલ બીજી સલાહમાં છે · લગભગ ${est} મિનિટ રાહ`);
  } else if (ahead === 0) {
    subline = T(lang,
      'You are next — please join the call.',
      'आप अगले हैं — कृपया कॉल जॉइन करें।',
      'તમે આગળ છો — કૃપા કરીને કૉલ જોડાઓ.');
  } else {
    subline = T(lang,
      `${ahead} patient${ahead === 1 ? '' : 's'} ahead of you · about ${est} min wait`,
      `${ahead} रोगी आगे · लगभग ${est} मिनट प्रतीक्षा`,
      `${ahead} દર્દી${ahead === 1 ? '' : 'ઓ'} આગળ · લગભગ ${est} મિનિટ રાહ`);
  }

  return (
    <View style={styles.card} testID="waiting-queue">
      <View style={styles.row}>
        <Animated.View style={[styles.dot, { opacity: pulseOpacity }]} />
        <Text style={styles.label}>
          {T(lang, 'LIVE QUEUE', 'सीधी प्रतीक्षा सूची', 'લાઇવ કતાર')}
        </Text>
      </View>
      <View style={styles.row}>
        <View style={styles.posPill}>
          <Ionicons name="person" size={13} color="#fff" />
          <Text style={styles.posText}>
            {T(lang, `You are #${pos}`, `आप क्रमांक #${pos} पर हैं`, `તમે #${pos} પર છો`)}
          </Text>
        </View>
      </View>
      <Text style={styles.subline}>{subline}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary + '44',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: 14,
    marginVertical: 10,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22BB44' },
  label: { color: COLORS.primaryDark, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  posPill: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.primary, borderRadius: 14 },
  posText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  subline: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
