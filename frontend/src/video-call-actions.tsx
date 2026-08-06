/*
 * VideoCallActions — premium tele-consultation console.
 *
 * Visual goals:
 *   • Premium / professional / elegant aesthetic matching the
 *     prescription + receipt + consent PDFs.
 *   • Live status pill (Idle / Doctor in call / Patient waiting /
 *     Both connected / Recording / Ended) updated by polling the
 *     backend every 8 seconds while the card is in view.
 *   • Action buttons grouped by intent:
 *       Row 1 — Big primary "Join as doctor" CTA.
 *       Row 2 — Patient outreach: WhatsApp / SMS / Email / Copy link
 *               + a small QR-code launcher for in-clinic patients.
 *       Row 3 — Room ops: Open in browser / End room / View
 *               recordings (when applicable).
 *   • Live participant chips when the doctor is already in the room.
 *
 * Behaviour:
 *   • Probes /api/video/health on mount — renders nothing if the
 *     environment isn't wired up.
 *   • Probes /api/video/bookings/{id}/room — silent 404 means "not
 *     provisioned yet".
 *   • Staff view shows the full console; patient view shows a single
 *     elegant "Join now" card (deep-links to the in-app patient
 *     screen so the call opens inside ConsultUro itself).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import RecordingControls from './video/RecordingControls';
import AutoSummaryCard from './video/AutoSummaryCard';
import AttachmentsCard from './video/AttachmentsCard';

type VideoRoom = {
  room_id: string;
  doctor_url?: string;
  patient_url?: string;
  doctor_code?: string;
  patient_code?: string;
  is_staff?: boolean;
  created_at_unix?: number;
};

type LiveStatus = {
  active: boolean;
  participants: number;
  doctor_connected?: boolean;
  patient_connected?: boolean;
  recording?: boolean;
  session_started_at?: string;
};

type Props = {
  bookingId: string;
  patientName?: string;
  patientPhone?: string;
  patientEmail?: string;
  isStaff: boolean;
  mode?: string;
  onProvisioned?: (room: VideoRoom) => void;
};

const POLL_INTERVAL_MS = 8000;

export default function VideoCallActions({
  bookingId, patientName, patientPhone, patientEmail,
  isStaff, mode, onProvisioned,
}: Props) {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [room, setRoom] = useState<VideoRoom | null>(null);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  // Bundle A — pre-call vitals/symptoms submitted by the patient
  const [precall, setPrecall] = useState<Record<string, any> | null>(null);
  // Bundle C — feedback already submitted (display read-only)
  const [feedback, setFeedback] = useState<Record<string, any> | null>(null);
  // Bundle G+H — admin toggles for recording / auto-summary cards
  const [enableRecording, setEnableRecording] = useState<boolean>(false);
  const [enableAutoSummary, setEnableAutoSummary] = useState<boolean>(true);
  // Bundle I — attachments toggle
  const [enableAttachments, setEnableAttachments] = useState<boolean>(true);
  const pollerRef = useRef<any>(null);

  /* ── 1. Probe video availability ─────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    api.get('/video/health')
      .then((r) => { if (!cancelled) setAvailable(!!r.data?.configured); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  /* ── 2. Load room ──────────────────────────────────────────── */
  const loadRoom = useCallback(async () => {
    if (!bookingId || available === false) return;
    setLoading(true);
    try {
      const r = await api.get(`/video/bookings/${bookingId}/room`);
      setRoom(r.data || null);
    } catch { setRoom(null); }
    finally { setLoading(false); }
  }, [bookingId, available]);

  useEffect(() => { loadRoom(); }, [loadRoom]);

  /* ── 2b. Bundle A — load precall vitals + Bundle C — feedback ── */
  const loadPrecall = useCallback(async () => {
    if (!bookingId || !isStaff) return;
    try {
      const r = await api.get(`/video/bookings/${bookingId}/precall`);
      const intake = r.data?.precall_intake || null;
      setPrecall(intake && Object.keys(intake).length ? intake : null);
    } catch { setPrecall(null); }
    try {
      const r = await api.get(`/video/bookings/${bookingId}/feedback`);
      const fb = r.data?.feedback || null;
      setFeedback(fb && fb.rating ? fb : null);
    } catch { setFeedback(null); }
  }, [bookingId, isStaff]);

  useEffect(() => { loadPrecall(); }, [loadPrecall, room?.room_id]);

  /* ── Bundle G+H — load video settings to gate the new cards ──── */
  useEffect(() => {
    if (!isStaff) return;
    api.get('/video/settings')
      .then((r) => {
        const cfg = r.data?.settings || {};
        if (typeof cfg.enable_recording_consent === 'boolean') setEnableRecording(cfg.enable_recording_consent);
        if (typeof cfg.enable_auto_summary === 'boolean') setEnableAutoSummary(cfg.enable_auto_summary);
        if (typeof cfg.enable_attachments === 'boolean') setEnableAttachments(cfg.enable_attachments);
      })
      .catch(() => {});
  }, [isStaff]);

  /* ── 3. Poll live status while room exists + staff view ───── */
  useEffect(() => {
    if (!isStaff || !room?.room_id) {
      if (pollerRef.current) { clearInterval(pollerRef.current); pollerRef.current = null; }
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await api.get(`/video/bookings/${bookingId}/room/status`);
        if (!cancelled) setStatus(r.data || null);
      } catch { /* silent */ }
    };
    poll();
    pollerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollerRef.current) { clearInterval(pollerRef.current); pollerRef.current = null; }
    };
  }, [bookingId, isStaff, room?.room_id]);

  /* ── 4. Provision ──────────────────────────────────────────── */
  const provision = useCallback(async () => {
    if (busy) return;
    setBusy('provision');
    try {
      const r = await api.post(`/video/bookings/${bookingId}/room`);
      setRoom(r.data || null);
      onProvisioned?.(r.data);
    } catch (e: any) {
      Alert.alert('Video room', e?.response?.data?.detail || e?.message || 'Could not create room.');
    } finally { setBusy(null); }
  }, [bookingId, busy, onProvisioned]);

  /* ── 5. Open URL helpers ───────────────────────────────────── */
  const openUrl = useCallback(async (url: string) => {
    if (!url) return;
    try {
      if (Platform.OS === 'web') {
        const w: any = typeof window !== 'undefined' ? window : null;
        w?.open(url, '_blank');
      } else {
        await WebBrowser.openBrowserAsync(url, {
          dismissButtonStyle: 'close',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        });
      }
    } catch {
      try { await Linking.openURL(url); } catch { /* no-op */ }
    }
  }, []);

  /* ── 6. Outreach: WhatsApp / SMS / Email / Copy ───────────── */
  const patientMessage = useMemo(() => (
    `🩺 ConsultUro video consultation\n\n` +
    `Hi${patientName ? ` ${patientName}` : ''}, please tap this link to join your appointment with the doctor:\n\n` +
    `${room?.patient_url || ''}\n\n` +
    `Tip: Use Chrome or Safari on your phone. Allow camera + microphone when prompted.`
  ), [patientName, room?.patient_url]);

  const safePhone = useMemo(() => {
    const p = (patientPhone || '').replace(/[^0-9]/g, '');
    if (!p) return '';
    return p.length === 10 ? `91${p}` : p;
  }, [patientPhone]);

  const shareWhatsApp = useCallback(async () => {
    if (!room?.patient_url || busy) return;
    setBusy('whatsapp');
    try {
      const url = safePhone
        ? `https://wa.me/${safePhone}?text=${encodeURIComponent(patientMessage)}`
        : `https://wa.me/?text=${encodeURIComponent(patientMessage)}`;
      if (Platform.OS === 'web') {
        const w: any = typeof window !== 'undefined' ? window : null;
        w?.open(url, '_blank');
      } else {
        await Linking.openURL(url);
      }
    } catch (e: any) {
      await Clipboard.setStringAsync(patientMessage);
      Alert.alert('Copied', 'WhatsApp not available — message copied to clipboard.');
    } finally { setBusy(null); }
  }, [busy, patientMessage, room?.patient_url, safePhone]);

  const shareSMS = useCallback(async () => {
    if (!room?.patient_url || busy) return;
    setBusy('sms');
    try {
      const phone = safePhone || patientPhone || '';
      // RFC 5724 — body= works on iOS & most Androids
      const url = phone
        ? `sms:${phone}?body=${encodeURIComponent(patientMessage)}`
        : `sms:?body=${encodeURIComponent(patientMessage)}`;
      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(patientMessage);
        Alert.alert('Copied', 'SMS only works on phones — message copied to clipboard.');
      } else {
        await Linking.openURL(url);
      }
    } finally { setBusy(null); }
  }, [busy, patientMessage, patientPhone, room?.patient_url, safePhone]);

  const shareEmail = useCallback(async () => {
    if (!room?.patient_url || busy) return;
    setBusy('email');
    try {
      const subject = encodeURIComponent('Your ConsultUro video consultation link');
      const body = encodeURIComponent(patientMessage);
      const url = `mailto:${patientEmail || ''}?subject=${subject}&body=${body}`;
      if (Platform.OS === 'web') {
        const w: any = typeof window !== 'undefined' ? window : null;
        if (w) w.location.href = url;
      } else {
        await Linking.openURL(url);
      }
    } finally { setBusy(null); }
  }, [busy, patientEmail, patientMessage, room?.patient_url]);

  const copyLink = useCallback(async () => {
    if (!room?.patient_url || busy) return;
    setBusy('copy');
    try {
      await Clipboard.setStringAsync(room.patient_url);
      Alert.alert('Copied', 'Patient join link copied to clipboard.');
    } finally { setBusy(null); }
  }, [busy, room?.patient_url]);

  /* ── Bundle D — One-tap re-invite ─────────────────────────── */
  const reinvitePatient = useCallback(async () => {
    if (!room?.patient_url || busy) return;
    setBusy('reinvite');
    try {
      await api.post(`/video/bookings/${bookingId}/reinvite`);
      Alert.alert(
        'Re-invited',
        'Push + WhatsApp link fired. Check Telegram for the one-tap WA button.',
      );
    } catch (e: any) {
      Alert.alert('Re-invite', e?.response?.data?.detail || 'Could not re-send link.');
    } finally { setBusy(null); }
  }, [bookingId, busy, room?.patient_url]);

  /* ── 7. Status pill copy ─────────────────────────────────── */
  const statusPill = useMemo(() => {
    if (!room?.room_id) return { label: 'Not provisioned', tone: 'idle' as const };
    if (!status) return { label: 'Idle · waiting for activity', tone: 'idle' as const };
    if (status.recording) return { label: 'Live · Recording', tone: 'recording' as const };
    if (status.doctor_connected && status.patient_connected) return { label: 'Live · Both in call', tone: 'live' as const };
    if (status.doctor_connected) return { label: 'Doctor in call · waiting for patient', tone: 'wait-patient' as const };
    if (status.patient_connected) return { label: 'Patient waiting · please join', tone: 'wait-doctor' as const };
    if (status.active) return { label: `Room open · ${status.participants} in call`, tone: 'live' as const };
    return { label: 'Idle · ready to start', tone: 'idle' as const };
  }, [room?.room_id, status]);

  /* ── Render gates ──────────────────────────────────────────── */
  if (available === null || available === false) return null;

  /* ── PATIENT VIEW ─────────────────────────────────────────── */
  if (!isStaff) {
    if (!room?.patient_url) return null;
    return (
      <View style={styles.patientCard}>
        <View style={styles.patientHeaderRow}>
          <View style={styles.patientIconWrap}>
            <Ionicons name="videocam" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.patientCardTitle}>Your video consultation is ready</Text>
            <Text style={styles.patientCardSub}>Tap to join the doctor inside ConsultUro</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.bigJoinBtn}
          onPress={() => router.push({ pathname: '/video/[code]', params: { code: room.patient_code || extractCode(room.patient_url!), role: 'patient', bookingId } } as any)}
          testID="video-join-patient"
        >
          <Ionicons name="videocam" size={20} color="#fff" />
          <Text style={styles.bigJoinText}>Join now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* ── STAFF VIEW ───────────────────────────────────────────── */
  const hasRoom = !!room?.room_id && !!room?.doctor_url;

  return (
    <View style={styles.card}>
      {/* Top bar: title + live status pill */}
      <View style={styles.cardTop}>
        <View style={styles.titleRow}>
          <View style={styles.titleIconWrap}>
            <Ionicons name="videocam" size={16} color="#fff" />
          </View>
          <Text style={styles.cardTitle}>Video consultation</Text>
        </View>
        <StatusPill label={statusPill.label} tone={statusPill.tone} />
      </View>

      {/* Body */}
      {loading && !room ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
      ) : !hasRoom ? (
        <>
          <Text style={styles.helper}>
            Tap below to provision a private 100ms room for this booking. The
            patient gets their own branded join link with camera + mic prompts.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={provision}
            disabled={busy === 'provision'}
            testID="video-provision"
          >
            {busy === 'provision' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="videocam-outline" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Start video call</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Participants strip */}
          <View style={styles.participantsRow}>
            <ParticipantChip
              label="Doctor"
              connected={!!status?.doctor_connected}
              testID="chip-doctor"
            />
            <ParticipantChip
              label={patientName || 'Patient'}
              connected={!!status?.patient_connected}
              testID="chip-patient"
            />
            {status?.recording ? (
              <View style={[styles.recPill]}>
                <View style={styles.recDot} />
                <Text style={styles.recPillText}>REC</Text>
              </View>
            ) : null}
          </View>

          {/* Row 1: primary CTA — opens 100ms inside ConsultUro using
              the in-app /video/[code] WebView (role=doctor). No more
              external browser pop-up. */}
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push({
              pathname: '/video/[code]',
              params: {
                code: room!.doctor_code || extractCode(room!.doctor_url!),
                role: 'doctor',
                bookingId,
              },
            } as any)}
            testID="video-join-doctor"
          >
            <Ionicons name="videocam" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Join as doctor</Text>
          </TouchableOpacity>

          {/* Bundle A — Patient pre-call intake */}
          {precall ? <PrecallSummary intake={precall} /> : null}

          {/* Bundle C — Last call feedback (when present) */}
          {feedback ? <FeedbackSummary feedback={feedback} /> : null}

          {/* Bundle G — Recording controls (admin-gated) */}
          <RecordingControls bookingId={bookingId} visible={enableRecording} />

          {/* Bundle I — Reports & images */}
          {enableAttachments ? (
            <AttachmentsCard bookingId={bookingId} visible={true} isStaff={true} />
          ) : null}

          {/* Bundle H — Auto post-call summary (admin-gated) */}
          <AutoSummaryCard
            bookingId={bookingId}
            patientPhone={patientPhone}
            visible={enableAutoSummary}
          />

          {/* Row 2: patient outreach (4 actions) */}
          <Text style={styles.sectionLabel}>Send link to patient</Text>
          <View style={styles.quadRow}>
            <QuadButton
              icon="logo-whatsapp"
              label="WhatsApp"
              onPress={shareWhatsApp}
              busy={busy === 'whatsapp'}
              testID="video-share-patient"
            />
            <QuadButton
              icon="chatbubble-outline"
              label="SMS"
              onPress={shareSMS}
              busy={busy === 'sms'}
              testID="video-share-sms"
            />
            <QuadButton
              icon="mail-outline"
              label="Email"
              onPress={shareEmail}
              busy={busy === 'email'}
              testID="video-share-email"
            />
            <QuadButton
              icon="qr-code-outline"
              label="QR"
              onPress={() => setShowQr(true)}
              testID="video-show-qr"
            />
          </View>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={copyLink}
            disabled={busy === 'copy'}
            testID="video-copy-patient"
          >
            <Ionicons name="copy-outline" size={14} color={COLORS.primary} />
            <Text style={styles.linkBtnText}>
              {busy === 'copy' ? 'Copied' : 'Copy patient link'}
            </Text>
          </TouchableOpacity>

          {/* Bundle D — One-tap re-invite (push + WhatsApp + Telegram) */}
          <TouchableOpacity
            style={styles.reinviteBtn}
            onPress={reinvitePatient}
            disabled={busy === 'reinvite'}
            testID="video-reinvite"
          >
            {busy === 'reinvite' ? (
              <ActivityIndicator color={COLORS.primary} size="small" />
            ) : (
              <>
                <Ionicons name="refresh" size={15} color={COLORS.primary} />
                <Text style={styles.reinviteText}>Re-send join link to patient</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Row 3: room ops */}
          <Text style={styles.sectionLabel}>Room operations</Text>
          <View style={styles.quadRow}>
            <QuadButton
              icon="open-outline"
              label="Open browser"
              onPress={() => openUrl(room!.doctor_url!)}
              testID="video-open-browser"
            />
            <QuadButton
              icon="refresh-outline"
              label="New link"
              onPress={() => Alert.alert(
                'Reset room?',
                'This will create fresh join codes. Old links stop working immediately. Continue?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: provision },
                ],
              )}
              testID="video-reset-room"
            />
            <QuadButton
              icon="information-circle-outline"
              label="Room ID"
              onPress={() => {
                Clipboard.setStringAsync(room!.room_id);
                Alert.alert('Room ID copied', room!.room_id);
              }}
              testID="video-show-id"
            />
            <QuadButton
              icon="settings-outline"
              label="Settings"
              onPress={() => router.push('/admin/video-settings' as any)}
              testID="video-settings-link"
            />
          </View>

          <Text style={styles.metaTiny}>
            Room {room?.room_id?.slice(-12)} · consulturo.app.100ms.live
          </Text>
        </>
      )}

      {/* QR modal — for in-clinic patients who can scan a phone */}
      <Modal
        visible={showQr}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQr(false)}
      >
        <Pressable style={styles.qrBackdrop} onPress={() => setShowQr(false)}>
          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>Scan to join</Text>
            <Text style={styles.qrSubtitle}>
              Patient scans this with their phone camera — opens the video room directly
            </Text>
            <View style={styles.qrImageWrap}>
              {room?.patient_url ? (
                <QrFromUrl url={room.patient_url} />
              ) : null}
            </View>
            <Text style={styles.qrUrl} numberOfLines={2}>{room?.patient_url}</Text>
            <TouchableOpacity style={styles.qrClose} onPress={() => setShowQr(false)}>
              <Text style={styles.qrCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ── Sub-components ─────────────────────────────────────────────── */
function StatusPill({ label, tone }: { label: string; tone: 'idle' | 'live' | 'recording' | 'wait-doctor' | 'wait-patient' }) {
  const palette = {
    idle: { bg: '#E2ECEC', fg: '#5E7C81', dot: '#98AAAE' },
    live: { bg: COLORS.success + '22', fg: COLORS.success, dot: COLORS.success },
    recording: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#DC2626' },
    'wait-doctor': { bg: '#FEF3C7', fg: '#92400E', dot: '#D97706' },
    'wait-patient': { bg: COLORS.primary + '14', fg: COLORS.primaryDark, dot: COLORS.primary },
  }[tone];
  return (
    <View style={[styles.statusPill, { backgroundColor: palette.bg }]}>
      <View style={[styles.statusDot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.statusPillText, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ParticipantChip({ label, connected, testID }: { label: string; connected: boolean; testID?: string }) {
  return (
    <View style={[styles.partChip, connected ? styles.partChipOn : styles.partChipOff]} testID={testID}>
      <View style={[styles.partDot, { backgroundColor: connected ? COLORS.success : '#C9D8DC' }]} />
      <Text style={[styles.partLabel, connected ? styles.partLabelOn : styles.partLabelOff]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function QuadButton({ icon, label, onPress, busy, testID }: { icon: any; label: string; onPress: () => void; busy?: boolean; testID?: string }) {
  return (
    <TouchableOpacity style={styles.quadBtn} onPress={onPress} disabled={!!busy} testID={testID}>
      {busy ? (
        <ActivityIndicator color={COLORS.primary} size="small" />
      ) : (
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      )}
      <Text style={styles.quadLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ── Bundle A — Pre-call vitals + symptoms summary ──────────────── */
function PrecallSummary({ intake }: { intake: Record<string, any> }) {
  const vitals: Array<{ label: string; value: string }> = [];
  if (intake.bp_systolic || intake.bp_diastolic) {
    vitals.push({
      label: 'BP',
      value: `${intake.bp_systolic ?? '—'}/${intake.bp_diastolic ?? '—'} mmHg`,
    });
  }
  if (intake.pulse) vitals.push({ label: 'Pulse', value: `${intake.pulse} bpm` });
  if (intake.temperature_c) vitals.push({ label: 'Temp', value: `${intake.temperature_c}°C` });
  if (intake.spo2) vitals.push({ label: 'SpO₂', value: `${intake.spo2}%` });
  if (intake.weight_kg) vitals.push({ label: 'Weight', value: `${intake.weight_kg} kg` });

  const symptoms: string[] = Array.isArray(intake.symptoms) ? intake.symptoms : [];

  return (
    <View style={styles.intakeCard} testID="precall-intake-summary">
      <View style={styles.intakeHeader}>
        <View style={styles.intakeIcon}>
          <Ionicons name="clipboard-outline" size={13} color="#fff" />
        </View>
        <Text style={styles.intakeTitle}>Patient pre-call check-in</Text>
      </View>

      {vitals.length ? (
        <View style={styles.vitalsGrid}>
          {vitals.map((v) => (
            <View key={v.label} style={styles.vitalChip}>
              <Text style={styles.vitalLabel}>{v.label}</Text>
              <Text style={styles.vitalValue}>{v.value}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {intake.chief_complaint ? (
        <Text style={styles.intakeText}>
          <Text style={styles.intakeFieldLabel}>Complaint: </Text>
          {intake.chief_complaint}
          {intake.duration ? <Text style={{ color: '#5E7C81' }}>{' · '}{intake.duration}</Text> : null}
        </Text>
      ) : null}

      {symptoms.length ? (
        <View style={styles.symptomChipsRow}>
          {symptoms.map((s: string) => (
            <View key={s} style={styles.symptomChip}>
              <Text style={styles.symptomChipText}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {intake.notes ? (
        <Text style={[styles.intakeText, { color: '#5E7C81', marginTop: 6 }]}>
          <Text style={styles.intakeFieldLabel}>Notes: </Text>
          {intake.notes}
        </Text>
      ) : null}
    </View>
  );
}

/* ── Bundle C — Feedback rating summary ────────────────────────── */
function FeedbackSummary({ feedback }: { feedback: Record<string, any> }) {
  const rating = Number(feedback.rating) || 0;
  return (
    <View style={styles.fbCard} testID="feedback-summary">
      <View style={styles.fbHeader}>
        <View style={styles.fbIcon}>
          <Ionicons name="star" size={12} color="#fff" />
        </View>
        <Text style={styles.fbTitle}>Last call feedback</Text>
        <View style={styles.fbStars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Ionicons
              key={n}
              name={n <= rating ? 'star' : 'star-outline'}
              size={12}
              color={n <= rating ? '#F5B400' : '#C4D2D6'}
              style={{ marginLeft: 1 }}
            />
          ))}
        </View>
      </View>
      {feedback.comment ? (
        <Text style={styles.fbComment} numberOfLines={3}>{`"${feedback.comment}"`}</Text>
      ) : null}
    </View>
  );
}

/** Tiny QR renderer that uses the free `api.qrserver.com` image proxy.
 *  Renders to an <Image/> via remote URL — no native dep needed. */
function QrFromUrl({ url, size = 220 }: { url: string; size?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Image } = require('react-native');
  const safe = encodeURIComponent(url);
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${safe}`;
  return <Image source={{ uri: src }} style={{ width: size, height: size }} />;
}

function extractCode(url: string): string {
  // Best-effort fallback if the backend didn't return a patient_code
  // (e.g. older provisioned room). Pulls the last path segment of the
  // prebuilt URL.
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || ''; }
  catch { return url.split('/').filter(Boolean).pop() || ''; }
}

/* ── Styles ────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.primary + '2A',
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 10,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: COLORS.primaryDark, ...FONTS.h4, fontSize: 15 },

  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, maxWidth: 200 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusPillText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },

  helper: { color: '#5E7C81', fontSize: 12.5, lineHeight: 18, marginBottom: 12 },

  participantsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  partChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 11, borderWidth: 1 },
  partChipOn: { backgroundColor: COLORS.success + '14', borderColor: COLORS.success + '55' },
  partChipOff: { backgroundColor: '#F4F9FA', borderColor: '#DCE9EC' },
  partDot: { width: 6, height: 6, borderRadius: 3 },
  partLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.2 },
  partLabelOn: { color: COLORS.success },
  partLabelOff: { color: '#5E7C81' },

  recPill: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: '#FEE2E2' },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#DC2626' },
  recPillText: { color: '#B91C1C', fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary, marginBottom: 4 },
  primaryBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14.5 },

  sectionLabel: { marginTop: 14, marginBottom: 7, fontSize: 10.5, color: COLORS.primaryDark, fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },

  quadRow: { flexDirection: 'row', gap: 6 },
  quadBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 5, borderRadius: RADIUS.md, backgroundColor: '#F4F9FA', borderWidth: 1, borderColor: COLORS.primary + '22' },
  quadLabel: { color: COLORS.primaryDark, fontSize: 11, fontWeight: '600', textAlign: 'center' },

  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 6, paddingVertical: 8 },
  linkBtnText: { color: COLORS.primary, fontSize: 11.5, fontWeight: '600' },

  metaTiny: { marginTop: 10, fontSize: 9.5, color: '#98AAAE', textAlign: 'center', letterSpacing: 0.4 },

  /* QR modal */
  qrBackdrop: { flex: 1, backgroundColor: 'rgba(10,30,40,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  qrCard: { width: '92%', maxWidth: 360, backgroundColor: '#fff', borderRadius: RADIUS.xl, padding: 20, alignItems: 'center' },
  qrTitle: { ...FONTS.h3, color: COLORS.primaryDark, marginBottom: 4 },
  qrSubtitle: { color: '#5E7C81', textAlign: 'center', fontSize: 12, marginBottom: 14, lineHeight: 17 },
  qrImageWrap: { padding: 10, backgroundColor: '#F4F9FA', borderRadius: RADIUS.md, marginBottom: 10 },
  qrUrl: { color: '#6A8388', fontSize: 10, textAlign: 'center', marginBottom: 14 },
  qrClose: { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: RADIUS.pill },
  qrCloseText: { color: '#fff', fontWeight: '700' },

  /* Patient view */
  patientCard: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, marginBottom: 4, borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.primary + '33' },
  patientHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  patientIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  patientCardTitle: { color: COLORS.primaryDark, ...FONTS.h4, fontSize: 14.5 },
  patientCardSub: { color: '#5E7C81', fontSize: 12, marginTop: 1 },
  bigJoinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  bigJoinText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 16 },

  /* Bundle D — Re-invite */
  reinviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 4, paddingVertical: 10, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '12', borderWidth: 1, borderColor: COLORS.primary + '44',
  },
  reinviteText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },

  /* Bundle A — Pre-call intake summary */
  intakeCard: {
    marginTop: 12, padding: 12,
    borderRadius: RADIUS.md, backgroundColor: '#FBFCFD',
    borderWidth: 1, borderColor: COLORS.primary + '22',
  },
  intakeHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  intakeIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  intakeTitle: { color: COLORS.primaryDark, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  vitalChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDEAEE' },
  vitalLabel: { color: '#5E7C81', fontSize: 9, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  vitalValue: { color: COLORS.primaryDark, fontSize: 12.5, fontWeight: '700', marginTop: 1 },
  intakeText: { color: COLORS.textPrimary, fontSize: 12.5, lineHeight: 17 },
  intakeFieldLabel: { color: COLORS.primaryDark, fontWeight: '700' },
  symptomChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  symptomChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 11, backgroundColor: COLORS.primary + '12' },
  symptomChipText: { color: COLORS.primary, fontSize: 10.5, fontWeight: '700' },

  /* Bundle C — Feedback summary */
  fbCard: {
    marginTop: 8, padding: 10,
    borderRadius: RADIUS.md, backgroundColor: '#FFFBEF',
    borderWidth: 1, borderColor: '#F5C26B' + '55',
  },
  fbHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fbIcon: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#F5B400', alignItems: 'center', justifyContent: 'center' },
  fbTitle: { flex: 1, color: '#5C3D00', fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  fbStars: { flexDirection: 'row' },
  fbComment: { color: '#5C3D00', fontSize: 12, lineHeight: 16, marginTop: 6, fontStyle: 'italic' },
});
