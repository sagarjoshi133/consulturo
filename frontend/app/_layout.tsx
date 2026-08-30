import React, { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { View, Text, ActivityIndicator, Linking, TouchableOpacity, StyleSheet } from 'react-native';
import {
  useFonts,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth';
import { TenantProvider } from '../src/tenant-context';
import { ThemeProvider } from '../src/theme-context';
import { DarkModeProvider, useStatusBarStyle } from '../src/dark-mode';
import { installWebAlertPolyfill } from '../src/web-alert-polyfill';
import { installWebKeyboardShortcuts } from '../src/web-keyboard-shortcuts';
import { installPwaBootstrap } from '../src/pwa-bootstrap';

// Patch Alert.alert on web at module load so every existing Alert.alert
// callsite in the app gets a real confirm/alert dialog on the web
// preview (react-native-web's Alert is a silent no-op otherwise).
// No-op on iOS / Android — native Alert is fine there.
installWebAlertPolyfill();

// PWA bootstrap — injects manifest link / theme-color / apple-touch-icon
// meta tags and registers /sw.js so the web build is installable as
// a Progressive Web App on Android Chrome ("Install app" prompt) and
// iOS Safari ("Share → Add to Home Screen"). Hard no-op on native.
installPwaBootstrap();

/** Status bar that automatically inverts between light/dark text
 *  based on the user's saved dark-mode preference. Lives inside the
 *  DarkModeProvider tree so it picks up the resolved theme. */
function AppStatusBar() {
  const style = useStatusBarStyle();
  return <StatusBar style={style} />;
}
import { I18nProvider } from '../src/i18n';
import { PhoneGate } from '../src/phone-gate';
import { ConsentGate } from '../src/consent-gate';
import { ToastProvider } from '../src/toast';
import { NotificationProvider } from '../src/notifications';
import { attachNotificationListeners } from '../src/push';
import {
  registerAndroidChannels,
  registerIosCategories,
} from '../src/push-channels';
import {
  registerV2AndroidChannels,
  registerV2IosCategories,
} from '../src/comm-v2/push-channels-v2';
import { attachV2TokenRotationListener } from '../src/comm-v2/installation';
import { CommunicationsProvider, triggerCommV2Refresh } from '../src/comm-v2/communications-provider';
import { initSentry } from '../src/sentry';
import { initOtaUpdates } from '../src/ota-updates';
import { COLORS } from '../src/theme';
import OfflineBanner from '../src/offline-banner';
import FallbackBanner from '../src/fallback-banner';
import PwaInstallBanner from '../src/pwa-install-banner';
import AnimatedSplash from '../src/animated-splash';
import { WebShell } from '../src/web-shell';
import { DemoBanner } from '../src/demo-banner';
import { AppErrorBoundary } from '../src/error-boundary';
import { saveLastRoute, loadLastRouteForResume, appendCrashLog } from '../src/last-route';

// Initialise error monitoring once on cold start.
// On web, defer to the next idle frame so Sentry's ~80 KB JS module
// doesn't contend with the first paint of the patient home page.
if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
  (window as any).requestIdleCallback(() => { try { initSentry(); } catch {} }, { timeout: 2000 });
} else if (typeof setTimeout === 'function') {
  setTimeout(() => { try { initSentry(); } catch {} }, 1000);
} else {
  initSentry();
}

// ── Splash screen: controlled hide ────────────────────────────────
// Keep the native splash visible until fonts have loaded, instead of
// auto-hiding to a blank/spinner frame and "flickering" between the
// splash → white flash → content (recurring user complaint). The
// splash is hidden exactly once in RootLayout when fonts resolve.
try {
  SplashScreen.preventAutoHideAsync().catch(() => {});
  // Soften the transition out of the splash on Android.
  SplashScreen.setOptions?.({ duration: 250, fade: true });
} catch {}

// ── Push: module-scope setup per Emergent Push playbook ───────────
// These MUST live at module scope (not inside a component) so they
// register BEFORE any notification arrives — critical for cold-start
// taps where the OS may deliver a push before React mounts.
//
// Defensive: every call is individually try/caught so a single
// expo-notifications hiccup on an exotic Android ROM never crashes
// the entire JS bundle.
if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        // expo-notifications 0.32+ requires shouldShowBanner +
        // shouldShowList. shouldShowAlert is deprecated — DO NOT
        // include it, it triggers a TypeError on stricter builds.
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // expo-notifications may throw on web fallthrough; safe to swallow.
  }
}
// Register all Android channels (messages, broadcasts, appointments,
// video_calls, reminders, default) so the OS knows about every type
// before the first push arrives. iOS gets equivalent categories.
try { registerAndroidChannels(); } catch {}
try { registerIosCategories(); } catch {}
// Comm V2: 5 new PRIVATE-visibility channels alongside legacy. These
// power the direct-FCM path (spec: no clinical detail on lock screen).
try { registerV2AndroidChannels(); } catch {}
try { registerV2IosCategories(); } catch {}

function RootNav() {
  const { loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // ─── Last-route persistence (crash-recovery) ─────────────────────
  // Every time the user lands on a route we write it to AsyncStorage
  // (throttled — at most one write per route change). On a native
  // crash the JS bundle is reloaded and Expo Router lands at "/"; the
  // resume banner below then offers a one-tap return to where the user
  // was. Cold-launches that don't follow a crash see no banner because
  // the saved route ages out after 90s.
  const lastSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || pathname === lastSavedRef.current) return;
    lastSavedRef.current = pathname;
    void saveLastRoute(pathname);
  }, [pathname]);

  // ─── Resume-from-crash banner ────────────────────────────────────
  const [resumeTo, setResumeTo] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entry = await loadLastRouteForResume();
      if (cancelled || !entry) return;
      // If we somehow landed on the same route we crashed on, no
      // resume needed.
      if (entry.path === pathname) return;
      // Also record this in the diagnostic crash log — a JS bundle
      // reload that happens to land at "/" while a fresh `lastRoute`
      // exists is a strong signal of a native crash.
      void appendCrashLog(entry.path);
      setResumeTo(entry.path);
    })();
    return () => { cancelled = true; };
    // Only run on cold start — pathname is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResume = () => {
    const to = resumeTo;
    setResumeTo(null);
    if (!to) return;
    try { router.push(to as any); } catch {}
  };
  const handleDismissResume = () => setResumeTo(null);

  useEffect(() => {
    // Kick off EAS Update in the background. On cold start it checks
    // once; a listener re-checks every time the app returns to the
    // foreground. Dev / Expo Go / web all no-op. Silent on failure
    // so a flaky network never interrupts the clinic flow.
    const stopOta = initOtaUpdates();
    return () => { stopOta(); };
  }, []);

  // Comm V2: watch for FCM token rotations and auto-re-register.
  useEffect(() => {
    const sub = attachV2TokenRotationListener();
    return () => { try { sub?.remove(); } catch {} };
  }, []);

  useEffect(() => {
    // Route user on tap of a push notification
    const unsub = attachNotificationListeners((data) => {
      const type = data?.type;
      // Legacy notifications use `link`; some (e.g. receipt_issued) use
      // `deep_link`. Honour both so every tap has a destination.
      const link = data?.link || data?.deep_link;

      // Comm V2: every push tap should refresh the inbox counts so
      // the bell + category badges reflect reality. Silent no-op when
      // the flag is off.
      triggerCommV2Refresh();

      // ── Comm V2 deep-links ────────────────────────────────────
      // V2 pushes (messages, broadcasts, inbox items) carry an
      // `inbox_action` + target id instead of the legacy `type`/`link`.
      // V2 pushes are only fanned out to canary users, so routing
      // straight to the V2 screens is safe (they're unlocked for them).
      const inboxAction = data?.inbox_action;
      if (type === 'v2_message' || inboxAction === 'open_conversation') {
        const convId = data?.conversation_id;
        if (convId) {
          router.push({ pathname: '/comm-v2/conversations/[id]', params: { id: String(convId) } } as any);
        } else {
          router.push('/comm-v2/conversations' as any);
        }
        return;
      }
      if (inboxAction === 'open_broadcast') {
        const bid = data?.broadcast_id;
        if (bid) {
          router.push({ pathname: '/comm-v2/broadcasts/[id]', params: { id: String(bid) } } as any);
        } else {
          router.push('/comm-v2/inbox' as any);
        }
        return;
      }
      if (inboxAction && inboxAction !== 'none' && inboxAction !== 'open_home') {
        // Any other V2 inbox action lands the user in the Notification
        // Centre where the item lives and can be opened directly.
        router.push('/comm-v2/inbox' as any);
        return;
      }

      // ── Receipt issued (billing) ──────────────────────────────
      if (type === 'receipt_issued') {
        const rid = data?.receipt_id;
        if (rid) {
          router.push({ pathname: '/receipts/[id]', params: { id: String(rid) } } as any);
        } else {
          router.push('/receipts' as any);
        }
        return;
      }

      // ── Video consultation deep-link (Phase 5.13) ─────────────
      // Patient receives `role=patient` + their patient_code/url;
      // primary owner receives `role=doctor` + the host code/url.
      // Route to the in-app /video/[code] WebView screen so the
      // call never leaves ConsultUro.
      if (type === 'video_room_ready') {
        const role = (data?.role || 'patient') as 'patient' | 'doctor';
        const code = data?.code
          || (role === 'doctor' ? data?.doctor_code : data?.patient_code)
          || extractCodeFromUrl(role === 'doctor' ? data?.doctor_url : data?.patient_url);
        if (code) {
          router.push({
            pathname: '/video/[code]',
            params: { code, role, bookingId: data?.booking_id },
          } as any);
        } else if (link && typeof link === 'string') {
          Linking.openURL(link).catch(() => {});
        }
        return;
      }

      if (type === 'broadcast' && link && typeof link === 'string' && link.startsWith('http')) {
        Linking.openURL(link).catch(() => {});
        return;
      }
      if (type === 'broadcast' || type === 'broadcast_sent' || type === 'broadcast_rejected') {
        router.push('/notifications' as any);
        return;
      }
      if (type === 'broadcast_review') {
        // replace (not push) to avoid stacking duplicate /dashboard
        // routes on the native nav stack — stacked duplicates caused
        // the "dashboard collapses back to home on back-press" bug
        // reported on v1.0.11.
        router.replace('/dashboard' as any);
        return;
      }
      if (type === 'new_booking' || type === 'booking_cancelled_by_patient') {
        router.replace('/dashboard' as any);
        return;
      }
      if (type === 'booking_confirmed' || type === 'booking_rejected' || type === 'booking_cancelled' || type === 'booking_completed' || type === 'booking_note' || type === 'booking_rescheduled') {
        router.push('/my-bookings' as any);
        return;
      }
      if (type === 'booking_reminder') {
        // 24h / 2h reminder for a confirmed appointment.
        router.push('/my-bookings' as any);
        return;
      }
      if (type === 'note_reminder') {
        const noteId = data?.note_id;
        if (noteId && typeof noteId === 'string') {
          router.push({ pathname: '/notes/[id]', params: { id: noteId } } as any);
        } else {
          router.push('/notes' as any);
        }
        return;
      }
      // Personal direct messages — route the recipient to their Inbox so
      // they land on the conversation list. The backend stamps both
      // `type` and `kind` ('personal') for backward-compatibility with
      // older clients.
      if (type === 'personal' || data?.kind === 'personal') {
        router.push('/inbox' as any);
        return;
      }

      // ── Generic fallback (Phase 5.13) ─────────────────────────
      // Any other notification that carries a `link` (promotional,
      // newsletter, deep-link to an external resource) opens the URL.
      // External links go via Linking.openURL so iOS/Android decide
      // whether to launch the deep-link inside the app (if scheme
      // matches) or the browser.
      if (link && typeof link === 'string') {
        if (link.startsWith('http://') || link.startsWith('https://')) {
          Linking.openURL(link).catch(() => {});
        } else if (link.startsWith('/')) {
          router.push(link as any);
        }
      }
    });
    return unsub;
  }, [router]);

// Helper — extract the last path segment of a 100ms prebuilt URL
// (e.g. https://x.100ms.live/meeting/abcd-1234 → "abcd-1234").
function extractCodeFromUrl(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return '';
  try { return new URL(url).pathname.split('/').filter(Boolean).pop() || ''; }
  catch { return url.split('/').filter(Boolean).pop() || ''; }
}

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <DemoBanner />
      <FallbackBanner />
      {resumeTo ? (
        <View style={rbStyles.banner} pointerEvents="box-none">
          <View style={rbStyles.bannerInner}>
            <Text style={rbStyles.bannerText} numberOfLines={2}>
              Resume where you were?
            </Text>
            <View style={rbStyles.bannerActions}>
              <TouchableOpacity
                onPress={handleResume}
                style={[rbStyles.bannerBtn, rbStyles.bannerBtnPrimary]}
                testID="resume-banner-resume"
              >
                <Text style={rbStyles.bannerBtnPrimaryText}>Resume</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDismissResume}
                style={[rbStyles.bannerBtn, rbStyles.bannerBtnGhost]}
                testID="resume-banner-dismiss"
              >
                <Text style={rbStyles.bannerBtnGhostText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
      <WebShell>
        {/* AppErrorBoundary catches JS render errors in ANY screen below.
            We deliberately DO NOT auto-redirect on caught errors anymore
            — the boundary shows a Try Again + Go Back card so the user
            stays in context. Native crashes (which destroy the JS
            context entirely) are handled by the Resume banner above. */}
        <AppErrorBoundary
          onBack={() => {
            try {
              if (router.canGoBack && router.canGoBack()) router.back();
              else router.replace('/' as any);
            } catch {}
          }}
        >
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
          <Stack.Screen name="login" />
          <Stack.Screen name="auth-callback" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="disease/[id]" />
          <Stack.Screen name="blog/[id]" />
          <Stack.Screen name="education/[id]" />
          <Stack.Screen name="ipss" />
          <Stack.Screen name="calculators/psa" />
          <Stack.Screen name="calculators/egfr" />
          <Stack.Screen name="calculators/bmi" />
          <Stack.Screen name="calculators/iief5" />
          <Stack.Screen name="calculators/prostate-volume" />
          <Stack.Screen name="calculators/crcl" />
          <Stack.Screen name="calculators/stone-risk" />
          <Stack.Screen name="calculators/creatinine" />
          <Stack.Screen name="calculators/bladder-diary" />
          <Stack.Screen name="my-bookings" />
          <Stack.Screen name="my-records" />
          <Stack.Screen name="inbox" />
          <Stack.Screen name="dashboard" />
          <Stack.Screen name="admin/blog" />
          <Stack.Screen name="admin/billing-settings" />
          <Stack.Screen name="ipd" />
          <Stack.Screen name="about" />
          <Stack.Screen name="blog" />
          <Stack.Screen name="videos" />
          <Stack.Screen name="education" />
          <Stack.Screen name="prescriptions/index" />
          <Stack.Screen name="prescriptions/new" />
          <Stack.Screen name="help" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="terms" />
          <Stack.Screen name="branding" />
          <Stack.Screen name="about-app" />
        </Stack>
        </AppErrorBoundary>
      </WebShell>
      <PhoneGate />
      <ConsentGate />
      <OfflineBanner />
      <PwaInstallBanner />
    </>
  );
}

// Module-scope flag — prevents the animated splash from replaying on
// Metro fast-refresh / web HMR. Reset only on a fresh page-load /
// app cold-start. Declared BEFORE RootLayout so the useState
// initialiser inside the component can read it.
let __splashHasShown = false;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  // ── Animated JS splash ────────────────────────────────────────────
  // Shows ONCE per cold start, overlaying the rest of the app for
  // ~1.7 s. Crossfades to a fully-rendered home screen, so the user
  // never sees a blank/loading frame. Suppressed on warm reloads
  // (web HMR / Metro fast refresh) via the module-scope flag.
  const [splashDone, setSplashDone] = useState(__splashHasShown);

  // Install ⌘K / Ctrl+K / "/" global search shortcut on web (no-op on native).
  useEffect(() => {
    installWebKeyboardShortcuts(() => {
      try {
        if (typeof window !== 'undefined') {
          window.location.assign('/search');
        }
      } catch {}
    });
  }, []);

  // Hide the native splash exactly once, as soon as fonts are ready —
  // the UI below renders real content on the very next frame, so the
  // user never sees a blank/spinner flash between splash and app.
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <I18nProvider>
            <AuthProvider>
              <TenantProvider>
                <ThemeProvider>
                  <DarkModeProvider>
                    <ToastProvider>
                      <NotificationProvider>
                        <CommunicationsProvider>
                          <AppStatusBar />
                          <RootNav />
                          {!splashDone ? (
                            <AnimatedSplash
                              onFinish={() => {
                                __splashHasShown = true;
                                setSplashDone(true);
                              }}
                            />
                          ) : null}
                        </CommunicationsProvider>
                      </NotificationProvider>
                    </ToastProvider>
                  </DarkModeProvider>
                </ThemeProvider>
              </TenantProvider>
            </AuthProvider>
          </I18nProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const rbStyles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
  },
  bannerInner: {
    marginHorizontal: 12,
    marginTop: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1F2937',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  bannerText: {
    flex: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '500',
  },
  bannerActions: { flexDirection: 'row', gap: 6 },
  bannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerBtnPrimary: { backgroundColor: COLORS.primary },
  bannerBtnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  bannerBtnGhost: { backgroundColor: 'transparent' },
  bannerBtnGhostText: { color: '#9CA3AF', fontWeight: '600', fontSize: 12 },
});

