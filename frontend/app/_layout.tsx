import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, ActivityIndicator, Linking } from 'react-native';
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
import { AuthProvider, useAuth } from '../src/auth';
import { TenantProvider } from '../src/tenant-context';
import { ThemeProvider } from '../src/theme-context';
import { I18nProvider } from '../src/i18n';
import { PhoneGate } from '../src/phone-gate';
import { ConsentGate } from '../src/consent-gate';
import { ToastProvider } from '../src/toast';
import { NotificationProvider } from '../src/notifications';
import { attachNotificationListeners } from '../src/push';
import { initSentry } from '../src/sentry';
import { COLORS } from '../src/theme';
import OfflineBanner from '../src/offline-banner';
import { WebShell } from '../src/web-shell';
import { DemoBanner } from '../src/demo-banner';

// Initialise error monitoring once on cold start.
initSentry();

function RootNav() {
  const { loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Route user on tap of a push notification
    const unsub = attachNotificationListeners((data) => {
      const type = data?.type;
      const link = data?.link;
      if (type === 'broadcast' && link && typeof link === 'string' && link.startsWith('http')) {
        Linking.openURL(link).catch(() => {});
        return;
      }
      if (type === 'broadcast' || type === 'broadcast_sent' || type === 'broadcast_rejected') {
        router.push('/notifications' as any);
        return;
      }
      if (type === 'broadcast_review') {
        router.push('/dashboard' as any);
        return;
      }
      if (type === 'new_booking' || type === 'booking_cancelled_by_patient') {
        router.push('/dashboard' as any);
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
    });
    return unsub;
  }, [router]);

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
      <WebShell>
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
      </WebShell>
      <PhoneGate />
      <ConsentGate />
      <OfflineBanner />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <TenantProvider>
              <ThemeProvider>
                <ToastProvider>
                  <NotificationProvider>
                    <StatusBar style="light" />
                    <RootNav />
                  </NotificationProvider>
                </ToastProvider>
              </ThemeProvider>
            </TenantProvider>
          </AuthProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
