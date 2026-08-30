/*
 * /video/[code].tsx — In-app video consultation screen.
 *
 * Renders the 100ms Prebuilt room INSIDE ConsultUro so patients
 * (and doctors who prefer it) never leave the app for the call.
 *
 *   • Web:    <iframe src="https://consulturo.app.100ms.live/meeting/{code}" />
 *   • Native: WebView (react-native-webview) with camera + mic
 *             permission requests forwarded to the WebRTC engine.
 *
 * Renders a clinic-branded "pre-call" screen first (logo, doctor,
 * tech-check tips). Patient taps "Join now" → iframe/WebView mounts.
 *
 * Closing the screen returns to wherever the user navigated from
 * (booking detail, push-notification deep link, etc).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../../src/api';
import { COLORS, FONTS, LOGO_URL, RADIUS } from '../../src/theme';
import PreCallIntakeForm from '../../src/video/PreCallIntakeForm';
import PostCallFeedbackModal from '../../src/video/PostCallFeedbackModal';
import RecordingConsentBanner from '../../src/video/RecordingConsentBanner';
import WaitingRoomQueue from '../../src/video/WaitingRoomQueue';
import AttachmentsCard from '../../src/video/AttachmentsCard';

// react-native-webview is preinstalled in Expo SDK; on web it's a no-op.
let WebView: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WebView = require('react-native-webview').WebView;
  } catch {
    WebView = null;
  }
}

const DOMAIN_FALLBACK = 'consulturo.app.100ms.live';

export default function VideoCallScreen() {
  const params = useLocalSearchParams<{
    code?: string;
    role?: 'patient' | 'doctor';
    bookingId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [domain, setDomain] = useState<string>(DOMAIN_FALLBACK);
  const [doctorName, setDoctorName] = useState<string>('Dr Sagar Joshi');
  const [clinicName, setClinicName] = useState<string>('Sterling Hospitals');
  const [joined, setJoined] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(false);
  // Bundle A — pre-call intake state
  const [intakeEnabled, setIntakeEnabled] = useState<boolean>(true);
  const [showIntake, setShowIntake] = useState<boolean>(false);
  const [intakeSubmittedOrSkipped, setIntakeSubmittedOrSkipped] = useState<boolean>(false);
  // Bundle C — post-call feedback state
  const [feedbackEnabled, setFeedbackEnabled] = useState<boolean>(true);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  // Bundle G — recording-consent banner state
  const [recordingConsentEnabled, setRecordingConsentEnabled] = useState<boolean>(false);
  // Bundle F+I — queue position + attachments toggles
  const [queueEnabled, setQueueEnabled] = useState<boolean>(true);
  const [attachmentsEnabled, setAttachmentsEnabled] = useState<boolean>(true);
  const code = String(params.code || '');
  const role = (params.role as 'patient' | 'doctor') || 'patient';
  const bookingId = String(params.bookingId || '');

  /* Fetch domain + clinic name + video settings (intake/feedback toggles). */
  useEffect(() => {
    api.get('/video/health').then(() => {
      api.get('/video/settings')
        .then((s) => {
          setDomain(s.data?.domain || DOMAIN_FALLBACK);
          const cfg = s.data?.settings || {};
          if (typeof cfg.enable_precall_intake === 'boolean') setIntakeEnabled(cfg.enable_precall_intake);
          if (typeof cfg.enable_post_call_feedback === 'boolean') setFeedbackEnabled(cfg.enable_post_call_feedback);
          if (typeof cfg.enable_recording_consent === 'boolean') setRecordingConsentEnabled(cfg.enable_recording_consent);
          if (typeof cfg.enable_queue_position === 'boolean') setQueueEnabled(cfg.enable_queue_position);
          if (typeof cfg.enable_attachments === 'boolean') setAttachmentsEnabled(cfg.enable_attachments);
        })
        .catch(() => {
          // Patient session may not be allowed to read settings — try
          // the public clinic-settings doc as a fallback.
          api.get('/clinic-settings').then((cs) => {
            const v = cs.data?.video || {};
            if (typeof v.enable_precall_intake === 'boolean') setIntakeEnabled(v.enable_precall_intake);
            if (typeof v.enable_post_call_feedback === 'boolean') setFeedbackEnabled(v.enable_post_call_feedback);
            if (typeof v.enable_recording_consent === 'boolean') setRecordingConsentEnabled(v.enable_recording_consent);
            if (typeof v.enable_queue_position === 'boolean') setQueueEnabled(v.enable_queue_position);
            if (typeof v.enable_attachments === 'boolean') setAttachmentsEnabled(v.enable_attachments);
          }).catch(() => {});
        });
    }).catch(() => {});
    api.get('/clinic-settings').then((r) => {
      const d = r.data || {};
      if (d.clinic_name) setClinicName(d.clinic_name);
      if (d.doctor_name) setDoctorName(d.doctor_name);
    }).catch(() => {});
  }, []);

  /* Notify backend the moment the patient lands on this screen with
   * a valid bookingId — powers the no-show auto-detection cron (a
   * booking with `patient_joined_at` is exempt). */
  useEffect(() => {
    if (!bookingId || role !== 'patient') return;
    api.post(`/video/bookings/${bookingId}/joined`).catch(() => {/* silent */});
  }, [bookingId, role]);

  const meetingUrl = `https://${domain}/meeting/${code}`;

  const handleJoinTap = useCallback(() => {
    // If intake is enabled & not yet completed → show the form first.
    // Doctor view (role==='doctor') skips intake entirely.
    if (
      role === 'patient'
      && intakeEnabled
      && !intakeSubmittedOrSkipped
      && bookingId
    ) {
      setShowIntake(true);
      return;
    }
    setLoadingRoom(true);
    setJoined(true);
    setTimeout(() => setLoadingRoom(false), 800);
  }, [role, intakeEnabled, intakeSubmittedOrSkipped, bookingId]);

  const handleLeaveCall = useCallback(() => {
    // Show feedback modal first (patients only, when enabled, when we
    // have a bookingId). Doctor or no-bookingId → straight back.
    if (role === 'patient' && feedbackEnabled && bookingId) {
      setJoined(false);
      setShowFeedback(true);
    } else {
      (router.canGoBack() ? router.back() : router.replace('/' as any));
    }
  }, [role, feedbackEnabled, bookingId, router]);

  /* ── Pre-call intake form (Bundle A) ─────────────────────────── */
  if (showIntake) {
    return (
      <View style={[styles.bg, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => setShowIntake(false)} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primaryDark} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Pre-consult check-in</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={{ flex: 1 }}>
          <PreCallIntakeForm
            bookingId={bookingId}
            onSubmitted={() => {
              setIntakeSubmittedOrSkipped(true);
              setShowIntake(false);
              setLoadingRoom(true);
              setJoined(true);
              setTimeout(() => setLoadingRoom(false), 800);
            }}
            onSkip={() => {
              setIntakeSubmittedOrSkipped(true);
              setShowIntake(false);
              setLoadingRoom(true);
              setJoined(true);
              setTimeout(() => setLoadingRoom(false), 800);
            }}
          />
        </View>
      </View>
    );
  }

  /* ── Pre-call screen ─────────────────────────────────────────── */
  if (!joined) {
    return (
      <View style={[styles.bg, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={COLORS.primaryDark} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>Video consultation</Text>
          <View style={{ width: 28 }} />
        </View>

        {/* Scrollable body — Bug fix 2026-06-18: the previous layout
            stacked the brand banner, doctor card, checklist, queue,
            attachments, consent and big Join CTA in a flat <View>
            with an absolutely-positioned footer. On phones where the
            content height exceeded the viewport, everything below
            "REPORTS & IMAGES" was clipped behind the footer and there
            was no way to scroll. Wrapping the middle content in a
            ScrollView restores access. We leave the Join CTA pinned
            to the bottom so users always see the primary action. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: 160 + (insets.bottom || 0),
            // ↑ 160px reserves room for the absolute footer (Join button +
            //   privacy tiny line) so the last in-flow item is always
            //   reachable on small phones.
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Brand banner */}
          <View style={styles.brandWrap}>
            <Image source={{ uri: LOGO_URL }} style={styles.brandLogo} />
            <Text style={styles.brandName}>ConsultUro</Text>
            <Text style={styles.brandTag}>Urology Care Platform</Text>
          </View>

          {/* Doctor card */}
          <View style={styles.docCard}>
            <View style={styles.docAvatar}>
              <Ionicons name="medkit-outline" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName}>{doctorName}</Text>
              <Text style={styles.docClinic}>{clinicName}</Text>
            </View>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Ready</Text>
          </View>

          {/* Tech-check checklist */}
          <View style={styles.checklist}>
            <Text style={styles.checklistTitle}>Before you join</Text>
            <Tip icon="mic-outline" text="Use a quiet room — close other tabs that use the mic." />
            <Tip icon="videocam-outline" text="Allow camera + microphone when your browser asks." />
            <Tip icon="wifi-outline" text="Stay on a stable Wi-Fi or strong 4G connection." />
            <Tip icon="bulb-outline" text="Face a light source so the doctor can see you clearly." />
          </View>

          {/* Bundle F — Live waiting-room queue (patient only) */}
          {role === 'patient' && queueEnabled && bookingId ? (
            <WaitingRoomQueue bookingId={bookingId} />
          ) : null}

          {/* Bundle I — Reports & images (both roles) */}
          {attachmentsEnabled && bookingId ? (
            <AttachmentsCard bookingId={bookingId} isStaff={role === 'doctor'} />
          ) : null}

          {/* Recording consent (Bundle G) — only patients, only when enabled */}
          {role === 'patient' && recordingConsentEnabled && bookingId ? (
            <RecordingConsentBanner bookingId={bookingId} />
          ) : null}
        </ScrollView>

        {/* Big Join CTA — pinned to the bottom edge so the primary
            action is always visible. */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={handleJoinTap}
            testID="video-prescreen-join"
          >
            <Ionicons name="videocam" size={20} color="#fff" />
            <Text style={styles.joinBtnText}>Join {role === 'doctor' ? 'as doctor' : 'video call'}</Text>
          </TouchableOpacity>
          <Text style={styles.privacyTiny}>
            Your call is encrypted end-to-end. ConsultUro never stores video without your consent.
          </Text>
        </View>
        {/* Post-call feedback modal — mounted on pre-call too because
         * `handleLeaveCall` sets joined=false BEFORE showing the modal. */}
        <PostCallFeedbackModal
          visible={showFeedback}
          bookingId={bookingId}
          onClose={() => {
            setShowFeedback(false);
            (router.canGoBack() ? router.back() : router.replace('/' as any));
          }}
        />
      </View>
    );
  }

  /* ── In-call view ────────────────────────────────────────────── */
  return (
    <View style={[styles.callShell, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Floating Leave button — themed pill, kept clear of the notch /
       * status bar via the safe-area top inset so it's always tappable
       * on devices with a camera cutout. Visible on BOTH web & native so
       * the patient can trigger the post-call feedback modal regardless
       * of whether they tapped Prebuilt's own "Leave" button first. */}
      <TouchableOpacity
        style={[styles.exitBtn, { top: insets.top + 12 }]}
        onPress={handleLeaveCall}
        testID="video-exit"
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color="#fff" />
        <Text style={styles.exitBtnText}>Leave</Text>
      </TouchableOpacity>

      {loadingRoom ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loaderText}>Connecting…</Text>
        </View>
      ) : null}

      {Platform.OS === 'web' ? (
        // @ts-ignore — iframe is HTML-only, RN-web allows it via createElement
        React.createElement('iframe', {
          src: meetingUrl,
          allow:
            'camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; fullscreen',
          style: { border: 0, width: '100%', height: '100%', flex: 1 },
          title: 'ConsultUro video call',
        })
      ) : WebView ? (
        <WebView
          source={{ uri: meetingUrl }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={['*']}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loaderWrap}>
              <ActivityIndicator size="large" color="#fff" />
              <Text style={styles.loaderText}>Connecting…</Text>
            </View>
          )}
          onPermissionRequest={(req: any) => req.grant?.(req.resources || [])}
          style={{ flex: 1, backgroundColor: '#000' }}
        />
      ) : (
        <View style={styles.loaderWrap}>
          <Text style={styles.loaderText}>
            WebView module not available. Please update your ConsultUro app.
          </Text>
          <TouchableOpacity style={styles.fallbackBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}>
            <Text style={styles.fallbackBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Post-call feedback modal (Bundle C) */}
      <PostCallFeedbackModal
        visible={showFeedback}
        bookingId={bookingId}
        onClose={() => {
          setShowFeedback(false);
          (router.canGoBack() ? router.back() : router.replace('/' as any));
        }}
      />
    </View>
  );
}

function Tip({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.tipRow}>
      <View style={styles.tipIconWrap}><Ionicons name={icon} size={15} color={COLORS.primary} /></View>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#F4F9FA' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
  iconBtn: { padding: 4 },
  topTitle: { color: COLORS.primaryDark, ...FONTS.h4, fontSize: 15 },

  brandWrap: { alignItems: 'center', marginTop: 18, marginBottom: 12 },
  brandLogo: { width: 64, height: 64, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: '#DDEAEE' },
  brandName: { ...FONTS.h2, color: COLORS.primaryDark, fontSize: 22, letterSpacing: 0.2 },
  brandTag: { color: '#6A8388', fontSize: 10.5, marginTop: 1, letterSpacing: 1.5, textTransform: 'uppercase' },

  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 18, marginTop: 16, padding: 14, borderRadius: RADIUS.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary + '22' },
  docAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  docName: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 15 },
  docClinic: { color: '#5E7C81', fontSize: 12 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.success, marginRight: 4 },
  liveText: { color: COLORS.success, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

  checklist: { marginHorizontal: 18, marginTop: 20, padding: 14, borderRadius: RADIUS.lg, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2ECEC' },
  checklistTitle: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 13, marginBottom: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  tipIconWrap: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary + '14', alignItems: 'center', justifyContent: 'center' },
  tipText: { flex: 1, color: '#1A2E35', fontSize: 12.5, lineHeight: 17 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 18, paddingTop: 10, backgroundColor: '#F4F9FA' },
  joinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  joinBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 16 },
  privacyTiny: { color: '#98AAAE', fontSize: 10.5, textAlign: 'center', marginTop: 8, paddingHorizontal: 20, lineHeight: 14 },

  /* In-call shell */
  callShell: { flex: 1, backgroundColor: '#000' },
  exitBtn: {
    position: 'absolute', right: 14, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: 40, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: COLORS.primary,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  exitBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
  loaderWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', zIndex: 5 },
  loaderText: { color: '#fff', marginTop: 10, fontSize: 13 },
  fallbackBtn: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  fallbackBtnText: { color: '#fff', fontWeight: '700' },
});
