/*
 * RecordingControls — Staff-side controls for Bundle G.
 *
 *   • Shows live recording state (recording / stopped / not_started).
 *   • Start button disabled until patient grants consent.
 *   • Stop button visible while recording.
 *   • Renders CDN-hosted recording assets (links) once 100ms uploads
 *     them — appears a few minutes after Stop.
 *
 * Polling: refreshes /recording every 8s while recording is in-flight
 * AND for 2 minutes after stop, to catch the asset URL.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS, RADIUS } from '../theme';

type Asset = { path?: string; url?: string; created_at?: string; size?: number };
type Recording = { recording_id?: string; status?: string; started_at?: string; stopped_at?: string };
type Consent = { granted?: boolean; at?: string };

type Props = { bookingId: string; visible: boolean };

export default function RecordingControls({ bookingId, visible }: Props) {
  const [rec, setRec] = useState<Recording>({});
  const [consent, setConsent] = useState<Consent>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  const refresh = useCallback(async () => {
    if (!visible) return;
    try {
      const r = await api.get(`/video/bookings/${bookingId}/recording`);
      setRec(r.data?.recording || {});
      setConsent(r.data?.consent || {});
      setAssets(r.data?.assets || []);
    } catch { /* silent */ }
  }, [bookingId, visible]);

  useEffect(() => {
    refresh();
    // Poll while recording or for 2 min after stopped
    if (rec.status === 'recording') {
      pollRef.current && clearInterval(pollRef.current);
      pollRef.current = setInterval(refresh, 8000);
    } else if (rec.status === 'stopped') {
      pollRef.current && clearInterval(pollRef.current);
      let count = 0;
      pollRef.current = setInterval(() => {
        refresh();
        count += 1;
        if (count > 15) { clearInterval(pollRef.current); pollRef.current = null; }
      }, 8000);
    }
    return () => { pollRef.current && clearInterval(pollRef.current); };
  }, [refresh, rec.status]);

  const startRec = useCallback(async () => {
    setBusy('start');
    try {
      await api.post(`/video/bookings/${bookingId}/recording/start`);
      await refresh();
    } catch (e: any) {
      Alert.alert('Recording', e?.response?.data?.detail || 'Could not start recording. Make sure the call is active and the patient has consented.');
    } finally { setBusy(null); }
  }, [bookingId, refresh]);

  const stopRec = useCallback(async () => {
    setBusy('stop');
    try {
      await api.post(`/video/bookings/${bookingId}/recording/stop`);
      await refresh();
    } catch (e: any) {
      Alert.alert('Recording', e?.response?.data?.detail || 'Could not stop recording.');
    } finally { setBusy(null); }
  }, [bookingId, refresh]);

  if (!visible) return null;

  const isRecording = rec.status === 'recording';
  const isStopped = rec.status === 'stopped' || rec.status === 'stop_failed';
  const consentGranted = !!consent.granted;

  return (
    <View style={styles.card} testID="recording-controls">
      <View style={styles.header}>
        <View style={[styles.dot, isRecording && styles.dotLive]} />
        <Text style={styles.title}>
          {isRecording ? 'Recording call' : isStopped ? 'Recording stopped' : 'Recording'}
        </Text>
        <View style={[styles.consentBadge, consentGranted ? styles.consentGranted : styles.consentDenied]}>
          <Ionicons
            name={consentGranted ? 'shield-checkmark' : 'shield-outline'}
            size={11}
            color={consentGranted ? COLORS.success : '#9A6A2B'}
          />
          <Text style={[styles.consentBadgeText, consentGranted ? { color: COLORS.success } : { color: '#9A6A2B' }]}>
            {consentGranted ? 'Consent granted' : 'Awaiting consent'}
          </Text>
        </View>
      </View>

      <View style={styles.btnRow}>
        {!isRecording ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnRec, !consentGranted && styles.btnDisabled]}
            onPress={startRec}
            disabled={!consentGranted || !!busy}
            testID="recording-start"
          >
            {busy === 'start' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="recording" size={14} color="#fff" />
                <Text style={styles.btnText}>Start recording</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.btn, styles.btnStop]}
            onPress={stopRec}
            disabled={!!busy}
            testID="recording-stop"
          >
            {busy === 'stop' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="stop" size={14} color="#fff" />
                <Text style={styles.btnText}>Stop recording</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Asset list — appears a few minutes after stop */}
      {assets.length ? (
        <View style={styles.assetsWrap}>
          <Text style={styles.assetsTitle}>Recordings</Text>
          {assets.map((a, i) => {
            const url = a.url || a.path || '';
            return (
              <TouchableOpacity
                key={i}
                style={styles.assetRow}
                onPress={() => url && Linking.openURL(url).catch(() => {})}
              >
                <Ionicons name="cloud-download-outline" size={14} color={COLORS.primary} />
                <Text style={styles.assetText} numberOfLines={1}>
                  Recording {i + 1}{a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString()}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : isStopped ? (
        <Text style={styles.assetsPending}>Recording is being processed — link will appear here in a few minutes.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10, padding: 12,
    borderRadius: RADIUS.md, backgroundColor: '#FFF5F5',
    borderWidth: 1, borderColor: '#E07B2B' + '44',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C4D2D6' },
  dotLive: { backgroundColor: '#E03737' },
  title: { flex: 1, color: '#5C3D00', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  consentBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1 },
  consentGranted: { borderColor: COLORS.success + '55' },
  consentDenied: { borderColor: '#F5C26B' + '55' },
  consentBadgeText: { fontSize: 10, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: RADIUS.pill },
  btnRec: { backgroundColor: '#E03737' },
  btnStop: { backgroundColor: '#444' },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  assetsWrap: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#FFE4E4', paddingTop: 10 },
  assetsTitle: { color: '#5C3D00', fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  assetRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  assetText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '600', flex: 1 },
  assetsPending: { marginTop: 10, color: '#7A5A1F', fontSize: 11.5, fontStyle: 'italic' },
});
