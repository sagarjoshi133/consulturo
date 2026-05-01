/**
 * Notifications Health Panel — owner-only dashboard view.
 *
 * Surfaces:
 *   • Total push tokens registered
 *   • 24-hour send aggregates (successes / failures)
 *   • Per-staff-user token count + platform/device
 *   • Last 20 push attempts with their errors
 *   • "Send test push to my devices" button — end-to-end verification
 *     in under 30s.
 *
 * Also shows the CURRENT DEVICE's local push-state chip so the owner
 * can immediately see whether THIS phone is registered (including the
 * exact failure reason if not).
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { useResponsive } from './responsive';
import { COLORS, FONTS, RADIUS } from './theme';
import { haptics } from './haptics';
import { formatIST } from './date';
import {
  getPushState,
  registerForPushNotifications,
  PushDiagnosticReason,
} from './push';

/** Heuristic — does this error string look like the Android FCM-credentials
 *  setup gap? If so the panel offers an inline "How to fix" guide. */
function isFcmSetupError(err?: string): boolean {
  if (!err) return false;
  const s = err.toLowerCase();
  return (
    s.includes('fcm') ||
    s.includes('firebase') ||
    s.includes('default firebase app') ||
    s.includes('google-services.json') ||
    s.includes('docs.expo.dev/push')
  );
}

const FCM_DOCS_URL = 'https://docs.expo.dev/push-notifications/fcm-credentials/';
const FIREBASE_CONSOLE_URL = 'https://console.firebase.google.com/';

type RecentRow = {
  id?: string;
  title?: string;
  body?: string;
  data_type?: string;
  total?: number;
  sent?: number;
  purged?: number;
  errors?: { error?: string; details?: any }[];
  created_at?: string;
  note?: string;
};

type Diag = {
  total_tokens: number;
  sends_last_24h: number;
  successes_last_24h: number;
  failures_last_24h: number;
  users: {
    user_id: string;
    email?: string;
    name?: string;
    role?: string;
    token_count: number;
    tokens: {
      platform?: string;
      device_name?: string;
      token_preview?: string;
      created_at?: string;
      updated_at?: string;
    }[];
  }[];
  recent: RecentRow[];
};

const REASON_COPY: Record<PushDiagnosticReason, { icon: any; color: string; label: string; hint?: string }> = {
  success: { icon: 'checkmark-circle', color: COLORS.success, label: 'Registered' },
  already_registered: { icon: 'checkmark-circle', color: COLORS.success, label: 'Registered' },
  web_unsupported: {
    icon: 'globe-outline',
    color: COLORS.textSecondary,
    label: 'Web preview',
    hint: 'Push notifications require the mobile app.',
  },
  simulator: {
    icon: 'phone-portrait-outline',
    color: COLORS.warning,
    label: 'Simulator',
    hint: 'Simulators cannot receive Expo push. Test on a real device.',
  },
  permission_denied: {
    icon: 'close-circle',
    color: COLORS.accent,
    label: 'Permission denied',
    hint: 'Enable Notifications for this app in device Settings.',
  },
  missing_project_id: {
    icon: 'alert-circle',
    color: COLORS.accent,
    label: 'Missing EAS projectId',
    hint: 'Rebuild the app after adding expo.extra.eas.projectId to app.json.',
  },
  token_fetch_failed: {
    icon: 'cloud-offline',
    color: COLORS.accent,
    label: 'Token fetch failed',
    hint: 'Expo push service unreachable. Retry once online.',
  },
  api_register_failed: {
    icon: 'warning',
    color: COLORS.warning,
    label: 'Backend registration failed',
    hint: 'Token was fetched but /push/register returned an error.',
  },
};

function formatTime(iso?: string) {
  if (!iso) return '';
  // Always display in IST so ops timestamps are consistent across timezones.
  return formatIST(iso);
}

export function NotificationsHealthPanel() {
  const { isWebDesktop } = useResponsive();
  const [data, setData] = React.useState<Diag | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [selfState, setSelfState] = React.useState(getPushState());
  const [showFcmGuide, setShowFcmGuide] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const { data: d } = await api.get('/push/diagnostics');
      setData(d);
      setSelfState(getPushState());
    } catch (e: any) {
      // silent — panel stays in loading if auth fails
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const runTest = async () => {
    haptics.tap();
    setTesting(true);
    try {
      let { data: r } = await api.post('/push/test', {});

      // ── Auto-recovery: backend has no token for this account but
      //    the client DOES have a local Expo token (common after a
      //    DB purge / account switch / Expo receipt auto-purge). We
      //    force a fresh /push/register POST then retry the test.
      //    Prevents the classic "client says Registered, backend says
      //    no tokens" silent-drift bug Dr. Joshi hit on 2026-05-01.
      if (r && r.ok === false && r.reason === 'no_tokens') {
        try {
          await registerForPushNotifications();
          setSelfState(getPushState());
          const regState = getPushState();
          if (regState.token) {
            // One retry after a fresh register — buys up to ~25 s
            // because /push/test now polls receipts in-band.
            const retry = await api.post('/push/test', {});
            r = retry.data;
          }
        } catch {
          // fall through to the original "no tokens" alert
        }
      }

      if (r.ok) {
        haptics.success();
        // Build a more honest message — `sent` counts Expo ticket
        // acceptance; `receipts.delivered` counts actual FCM/APNs
        // delivery which is what the user cares about.
        const delivered = r?.receipts?.delivered;
        const pending = r?.receipts?.pending;
        const deliveredMsg = (typeof delivered === 'number')
          ? `Delivered to ${delivered} of ${r.tokens_found} device(s).`
          : `Accepted by Expo for ${r.sent || 0} of ${r.tokens_found} device(s).`;
        const pendingMsg = (pending && pending > 0)
          ? ` ${pending} device(s) still pending — check the push log in a minute.`
          : '';
        const receiptErrs: any[] = r?.receipts?.receipt_errors || [];
        const errSummary = receiptErrs.length > 0
          ? `\n\nFCM errors:\n  • ${receiptErrs.slice(0,3).map((e:any)=>e.error||e.message).join('\n  • ')}`
          : '';
        Alert.alert(
          'Test push sent',
          `${deliveredMsg}${pendingMsg}${errSummary}\n\nCheck your notification tray.`
        );
      } else {
        haptics.warning();
        Alert.alert(
          'Test push could not be sent',
          r?.message ||
            'No push tokens registered for this account. Grant notification permission in the mobile app and reopen it.',
        );
      }
      await load();
    } catch (e: any) {
      haptics.error();
      Alert.alert('Error', e?.response?.data?.detail || e?.message || 'Could not send test push');
    } finally {
      setTesting(false);
    }
  };

  const retryRegister = async () => {
    haptics.tap();
    try {
      await registerForPushNotifications();
      setSelfState(getPushState());
      const s = getPushState();
      if (s.reason === 'success' || s.reason === 'already_registered') {
        haptics.success();
        Alert.alert('Registered', 'This device is now registered for push notifications.');
        await load();
      } else {
        haptics.warning();
        const copy = REASON_COPY[s.reason];
        Alert.alert(
          'Could not register',
          `${copy.label}${s.error ? ' — ' + s.error : ''}${copy.hint ? '\n\n' + copy.hint : ''}`
        );
      }
    } catch (e: any) {
      haptics.error();
      Alert.alert('Error', e?.message || 'Could not register');
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.loading}>
        <Ionicons name="lock-closed" size={36} color={COLORS.textSecondary} />
        <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 12 }}>
          Owner access required.
        </Text>
      </View>
    );
  }

  const selfCopy = REASON_COPY[selfState.reason];
  const healthColor =
    data.total_tokens === 0
      ? COLORS.accent
      : data.failures_last_24h > data.successes_last_24h
      ? COLORS.warning
      : COLORS.success;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={COLORS.primary}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Top summary */}
      <View style={[styles.summaryCard, { borderColor: healthColor + '66' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
          <Text style={styles.summaryTitle}>Notifications health</Text>
        </View>
        <View style={styles.statsRow}>
          <Stat label="Tokens" value={String(data.total_tokens)} />
          <Stat label="Sent 24h" value={String(data.successes_last_24h)} color={COLORS.success} />
          <Stat label="Failed 24h" value={String(data.failures_last_24h)} color={COLORS.accent} />
          <Stat label="Attempts 24h" value={String(data.sends_last_24h)} />
        </View>
      </View>

      {/* This device state */}
      <View style={styles.selfCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name={selfCopy.icon} size={20} color={selfCopy.color} />
          <Text style={styles.selfTitle}>This device</Text>
        </View>
        <Text style={[styles.selfLabel, { color: selfCopy.color }]}>{selfCopy.label}</Text>
        {selfCopy.hint && <Text style={styles.selfHint}>{selfCopy.hint}</Text>}
        {selfState.error && (
          <Text style={[styles.selfHint, { color: COLORS.accent }]} numberOfLines={3}>
            Error: {selfState.error}
          </Text>
        )}
        {selfState.projectId && (
          <Text style={styles.selfMeta} numberOfLines={1}>
            projectId: {selfState.projectId.slice(0, 12)}…
          </Text>
        )}
        {selfState.token && (
          <Text style={styles.selfMeta} numberOfLines={1}>
            token: {selfState.token.slice(0, 34)}…
          </Text>
        )}

        {/* FCM setup guide — appears when the failure matches the Android
            "Firebase / FCM credentials missing" pattern. One-tap toggle +
            link out to Expo docs, plus the 5 concrete steps the doctor
            (or their developer) needs to do once. */}
        {isFcmSetupError(selfState.error) && (
          <View style={styles.fcmCard}>
            <View style={styles.fcmHeadRow}>
              <Ionicons name="warning" size={18} color={COLORS.warning} />
              <Text style={styles.fcmTitle}>Android push needs Firebase setup</Text>
            </View>
            <Text style={styles.fcmBody}>
              Expo Push for Android requires a one-time Firebase Cloud Messaging credentials upload.
              Until then, push will fail silently on Android (iOS / web are unaffected).
            </Text>

            <TouchableOpacity
              onPress={() => { haptics.select(); setShowFcmGuide((s) => !s); }}
              style={styles.fcmToggle}
              testID="push-fcm-toggle"
            >
              <Ionicons
                name={showFcmGuide ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={COLORS.primary}
              />
              <Text style={styles.fcmToggleText}>
                {showFcmGuide ? 'Hide setup steps' : 'Show how to fix (5 steps)'}
              </Text>
            </TouchableOpacity>

            {showFcmGuide && (
              <View style={styles.fcmSteps}>
                <FcmStep n={1} text="Open Firebase Console → Create project (free)." />
                <FcmStep
                  n={2}
                  text="Add an Android app with package com.drsagarjoshi.consulturo. Download google-services.json."
                />
                <FcmStep
                  n={3}
                  text="Place google-services.json at /app/frontend/google-services.json (replaces the placeholder)."
                />
                <FcmStep
                  n={4}
                  text="From Firebase → Project Settings → Cloud Messaging → copy the FCM Server Key."
                />
                <FcmStep
                  n={5}
                  text="Run: cd /app/frontend && npx eas-cli credentials --platform android — paste the FCM Server Key. Then rebuild the APK with eas build --platform android --profile preview."
                />

                <View style={styles.fcmLinkRow}>
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); Linking.openURL(FIREBASE_CONSOLE_URL); }}
                    style={[styles.fcmLinkBtn, { backgroundColor: COLORS.warning }]}
                    testID="push-fcm-firebase-link"
                  >
                    <Ionicons name="open-outline" size={14} color="#fff" />
                    <Text style={styles.fcmLinkText}>Firebase Console</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { haptics.tap(); Linking.openURL(FCM_DOCS_URL); }}
                    style={[styles.fcmLinkBtn, { backgroundColor: COLORS.primary }]}
                    testID="push-fcm-docs-link"
                  >
                    <Ionicons name="book-outline" size={14} color="#fff" />
                    <Text style={styles.fcmLinkText}>Expo FCM Docs</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fcmFootNote}>
                  Once the new APK is installed, this card turns green and "Send test push" works natively.
                </Text>
              </View>
            )}
          </View>
        )}

        {Platform.OS !== 'web' &&
          selfState.reason !== 'success' &&
          selfState.reason !== 'already_registered' && (
            <TouchableOpacity style={styles.retryBtn} onPress={retryRegister} testID="push-retry-register">
              <Ionicons name="refresh" size={14} color="#fff" />
              <Text style={styles.retryBtnText}>Retry registration</Text>
            </TouchableOpacity>
          )}
      </View>

      {/* Test push button */}
      <TouchableOpacity
        onPress={runTest}
        disabled={testing}
        style={[styles.testBtn, testing && { opacity: 0.6 }]}
        activeOpacity={0.85}
        testID="push-test-button"
      >
        {testing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="paper-plane" size={18} color="#fff" />
            <Text style={styles.testBtnText}>Send test push to my devices</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Staff tokens */}
      <Text style={styles.sectionTitle}>Staff devices ({data.users.length})</Text>
      <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } : undefined}>
      {data.users.map((u) => (
        <View key={u.user_id} style={[styles.userCard, isWebDesktop && { width: '49%', marginBottom: 0 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {u.name || u.email || u.user_id}
            </Text>
            <Text style={styles.userRole} numberOfLines={1}>
              {u.role || 'member'} · {u.email}
            </Text>
            {u.tokens.slice(0, 3).map((t, idx) => (
              <Text key={idx} style={styles.userTok} numberOfLines={1}>
                • {t.platform || '?'} {t.device_name ? `· ${t.device_name}` : ''} ({formatTime(t.updated_at)})
              </Text>
            ))}
            {u.tokens.length > 3 && (
              <Text style={styles.userTok}>+ {u.tokens.length - 3} more</Text>
            )}
          </View>
          <View
            style={[
              styles.countPill,
              u.token_count > 0
                ? { backgroundColor: COLORS.success + '22', borderColor: COLORS.success + '55' }
                : { backgroundColor: COLORS.accent + '22', borderColor: COLORS.accent + '55' },
            ]}
          >
            <Ionicons
              name={u.token_count > 0 ? 'checkmark' : 'alert'}
              size={14}
              color={u.token_count > 0 ? COLORS.success : COLORS.accent}
            />
            <Text style={{ color: u.token_count > 0 ? COLORS.success : COLORS.accent, ...FONTS.bodyMedium, fontSize: 12 }}>
              {u.token_count}
            </Text>
          </View>
        </View>
      ))}
      </View>

      {/* Recent attempts */}
      <Text style={styles.sectionTitle}>Recent push attempts</Text>
      {data.recent.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="time-outline" size={28} color={COLORS.textDisabled} />
          <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 8 }}>
            No push attempts yet.
          </Text>
        </View>
      ) : (
        data.recent.map((r, idx) => {
          const ok = (r.sent || 0) > 0 && (r.total || 0) > 0 && (r.sent || 0) === (r.total || 0);
          const partial = (r.sent || 0) > 0 && (r.sent || 0) < (r.total || 0);
          const statusColor = ok ? COLORS.success : partial ? COLORS.warning : COLORS.accent;
          return (
            <View key={r.id || idx} style={styles.recentRow}>
              <View style={[styles.recentIconWrap, { backgroundColor: statusColor + '22' }]}>
                <Ionicons
                  name={ok ? 'checkmark' : partial ? 'alert' : 'close'}
                  size={14}
                  color={statusColor}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.recentTitle} numberOfLines={1}>
                  {r.title || '(untitled push)'}
                </Text>
                <Text style={styles.recentMeta} numberOfLines={2}>
                  {r.sent || 0}/{r.total || 0} delivered
                  {r.purged ? ` · ${r.purged} purged` : ''}
                  {r.data_type ? ` · ${r.data_type}` : ''}
                  {r.note ? ` · ${r.note}` : ''}
                  {' · '}
                  {formatTime(r.created_at)}
                </Text>
                {Array.isArray(r.errors) && r.errors.length > 0 && (
                  <Text style={styles.recentErr} numberOfLines={2}>
                    ⚠ {r.errors[0]?.error}
                    {r.errors[0]?.details?.error ? ` (${r.errors[0].details.error})` : ''}
                  </Text>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, color && { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function FcmStep({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.fcmStepRow}>
      <View style={styles.fcmStepNum}><Text style={styles.fcmStepNumText}>{n}</Text></View>
      <Text style={styles.fcmStepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  empty: { alignItems: 'center', padding: 24 },

  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    gap: 10,
  },
  healthDot: { width: 10, height: 10, borderRadius: 5 },
  summaryTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  statLabel: {
    ...FONTS.label,
    color: COLORS.textSecondary,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  selfCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 12,
    gap: 4,
  },
  selfTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  selfLabel: { ...FONTS.h4, fontSize: 14, marginTop: 4 },
  selfHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
  selfMeta: {
    ...FONTS.body,
    color: COLORS.textDisabled,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  retryBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  retryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },

  fcmCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.warning + '14',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
  },
  fcmHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fcmTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  fcmBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 },
  fcmToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  fcmToggleText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  fcmSteps: {
    marginTop: 10,
    gap: 8,
  },
  fcmStepRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  fcmStepNum: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: COLORS.warning,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  fcmStepNumText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 11 },
  fcmStepText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, lineHeight: 17, flex: 1 },
  fcmLinkRow: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  fcmLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
  },
  fcmLinkText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11 },
  fcmFootNote: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
    lineHeight: 16,
  },

  testBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  testBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },

  sectionTitle: {
    ...FONTS.label,
    color: COLORS.textSecondary,
    marginTop: 22,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  userName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  userRole: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  userTok: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginTop: 2 },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },

  recentRow: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 6,
  },
  recentIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  recentMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  recentErr: { ...FONTS.body, color: COLORS.accent, fontSize: 11, marginTop: 2 },
});
