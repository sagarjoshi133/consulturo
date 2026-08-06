/**
 * VoiceDictationSheet — Wave 3 · M
 *
 * Bottom-sheet modal that records audio via expo-audio, ships it to
 * /api/ai/voice-to-rx, and returns the parsed Rx fields to the parent.
 *
 * Handles permission flow per the `handle_permissions_contract`:
 *   • Checks status before requesting
 *   • Shows pre-permission rationale
 *   • Falls back to "Open Settings" if permanently denied
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Platform,
  Linking,
  TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
} from 'expo-audio';
import { COLORS, FONTS, RADIUS } from './theme';
import { haptics } from './haptics';
import { voiceToRx, VoiceToRxResult } from './wave3/api';

type Props = {
  visible: boolean;
  onClose: () => void;
  onResult: (r: VoiceToRxResult) => void;
};

type Stage = 'idle' | 'permission' | 'recording' | 'uploading' | 'success' | 'error';

export function VoiceDictationSheet({ visible, onClose, onResult }: Props) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);

  const [stage, setStage] = useState<Stage>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const [permBlocked, setPermBlocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<any>(null);

  // Reset on open/close.
  useEffect(() => {
    if (visible) {
      setStage('idle');
      setErrMsg('');
      setPermBlocked(false);
      setElapsed(0);
    } else {
      // Best-effort cleanup if user closes mid-record. Only attempt
      // stop if we know the recorder is actively recording — calling
      // .stop() on an uninitialised MediaRecorder throws on web.
      if (recState.isRecording) {
        try { void recorder.stop(); } catch {}
      }
      if (tickRef.current) clearInterval(tickRef.current);
    }
  }, [visible, recorder, recState.isRecording]);

  const startRecording = async () => {
    setErrMsg('');
    try {
      // Web: navigator.mediaDevices.getUserMedia path
      if (Platform.OS === 'web') {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setStage('error');
          setErrMsg('Voice recording is not supported in this browser. Try Chrome/Edge.');
          return;
        }
      } else {
        // Native: explicit permission check
        const status = await AudioModule.getRecordingPermissionsAsync();
        if (!status.granted) {
          if (!status.canAskAgain) {
            setPermBlocked(true);
            setStage('permission');
            return;
          }
          setStage('permission');
          const req = await AudioModule.requestRecordingPermissionsAsync();
          if (!req.granted) {
            setPermBlocked(!req.canAskAgain);
            return;
          }
        }
      }

      haptics.medium();
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStage('recording');
      setElapsed(0);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setStage('error');
      setErrMsg(e?.message || 'Could not start recording');
    }
  };

  const stopAndUpload = async () => {
    if (tickRef.current) clearInterval(tickRef.current);
    setStage('uploading');
    haptics.tap();
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording produced no audio');
      const ext = (uri.split('.').pop() || 'm4a').split('?')[0];
      const filename = `dictation_${Date.now()}.${ext}`;
      const result = await voiceToRx(uri, { filename });
      haptics.success();
      setStage('success');
      onResult(result);
      // Auto-close shortly after success animation.
      setTimeout(() => onClose(), 400);
    } catch (e: any) {
      haptics.error();
      setStage('error');
      setErrMsg(e?.response?.data?.detail || e?.message || 'Transcription failed');
    }
  };

  const cancel = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (recState.isRecording) {
      try { void recorder.stop(); } catch {}
    }
    setStage('idle');
    onClose();
  };

  const openSettings = () => {
    try { void Linking.openSettings(); } catch {}
  };

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cancel}>
      <TouchableWithoutFeedback onPress={cancel}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
              <View style={styles.handle} />

              <Text style={styles.title}>Voice → Rx</Text>
              <Text style={styles.subtitle}>
                Dictate the prescription out loud. We&apos;ll fill the form for you.
              </Text>

              {stage === 'idle' ? (
                <>
                  <View style={styles.tipsCard}>
                    <Text style={styles.tipsTitle}>Speak naturally — example</Text>
                    <Text style={styles.tipsText}>
                      &quot;Diagnosis: BPH with LUTS. Start Tab Tamsulosin 0.4 mg once at bedtime
                      for 30 days. Advise plenty of fluids and avoid evening caffeine. Review after 4 weeks.&quot;
                    </Text>
                  </View>
                  <TouchableOpacity onPress={startRecording} style={styles.bigBtn} testID="v2rx-start" activeOpacity={0.85}>
                    <View style={styles.micCircle}><Ionicons name="mic" size={32} color="#fff" /></View>
                    <Text style={styles.bigBtnText}>Tap to start recording</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {stage === 'permission' ? (
                <View style={styles.statusCard}>
                  <Ionicons name="mic-off" size={36} color={COLORS.accent} />
                  <Text style={styles.statusTitle}>Microphone access needed</Text>
                  <Text style={styles.statusText}>
                    We use the mic only while you dictate. Audio is sent to our server for
                    transcription, then discarded. Nothing is saved.
                  </Text>
                  {permBlocked ? (
                    <TouchableOpacity onPress={openSettings} style={[styles.bigBtn, { backgroundColor: COLORS.primary }]} testID="v2rx-settings">
                      <Ionicons name="settings" size={18} color="#fff" />
                      <Text style={styles.bigBtnText}>  Open Settings</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={startRecording} style={[styles.bigBtn, { backgroundColor: COLORS.primary }]} testID="v2rx-retry">
                      <Text style={styles.bigBtnText}>Grant access & retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}

              {stage === 'recording' ? (
                <View style={styles.statusCard}>
                  <View style={[styles.micCircle, styles.micRecording]}>
                    <Ionicons name="mic" size={32} color="#fff" />
                  </View>
                  <Text style={styles.recordTimer}>{mm}:{ss}</Text>
                  <Text style={styles.statusText}>Listening… tap stop when done.</Text>
                  <TouchableOpacity onPress={stopAndUpload} style={[styles.bigBtn, styles.stopBtn]} testID="v2rx-stop">
                    <Ionicons name="stop" size={20} color="#fff" />
                    <Text style={styles.bigBtnText}>  Stop & transcribe</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {stage === 'uploading' ? (
                <View style={styles.statusCard}>
                  <ActivityIndicator size="large" color={COLORS.primary} />
                  <Text style={styles.statusTitle}>Transcribing…</Text>
                  <Text style={styles.statusText}>Whisper + Claude are parsing your dictation. ~5–10 seconds.</Text>
                </View>
              ) : null}

              {stage === 'success' ? (
                <View style={styles.statusCard}>
                  <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                  <Text style={styles.statusTitle}>Done! Fields filled in.</Text>
                </View>
              ) : null}

              {stage === 'error' ? (
                <View style={styles.statusCard}>
                  <Ionicons name="warning" size={36} color={COLORS.accent} />
                  <Text style={styles.statusTitle}>Couldn&apos;t transcribe</Text>
                  <Text style={styles.statusText}>{errMsg}</Text>
                  <TouchableOpacity onPress={() => setStage('idle')} style={[styles.bigBtn, { backgroundColor: COLORS.primary }]}>
                    <Text style={styles.bigBtnText}>Try again</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <TouchableOpacity onPress={cancel} style={styles.cancelBtn} testID="v2rx-cancel">
                <Text style={styles.cancelText}>{stage === 'success' ? 'Close' : 'Cancel'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    ...(Platform.OS === 'web' ? { alignSelf: 'center', maxWidth: 480, width: '100%', borderRadius: 22 } : null),
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center', marginBottom: 12,
  },
  title: { ...FONTS.h2, fontSize: 19, color: COLORS.textPrimary, textAlign: 'center' },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 14, lineHeight: 18 },
  tipsCard: {
    backgroundColor: '#F0F9FF',
    borderWidth: 1, borderColor: '#BAE6FD',
    padding: 12, borderRadius: RADIUS.md,
    marginBottom: 14,
  },
  tipsTitle: { ...FONTS.bodyMedium, color: '#0369A1', fontSize: 12, marginBottom: 4 },
  tipsText: { ...FONTS.body, color: '#0C4A6E', fontSize: 12.5, lineHeight: 18, fontStyle: 'italic' },
  bigBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14, paddingHorizontal: 22,
    borderRadius: RADIUS.pill,
    gap: 10,
    minHeight: 52,
  },
  bigBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  micCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  micRecording: { backgroundColor: '#DC2626' },
  recordTimer: { ...FONTS.h2, color: '#DC2626', fontSize: 30, marginTop: 8 },
  statusCard: { alignItems: 'center', gap: 10, paddingVertical: 18 },
  statusTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  statusText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 18 },
  stopBtn: { backgroundColor: '#DC2626', marginTop: 8 },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  cancelText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 13 },
});
