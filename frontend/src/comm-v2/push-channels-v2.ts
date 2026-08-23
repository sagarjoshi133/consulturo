/**
 * Communications V2 Android channels + iOS categories.
 *
 * Five NEW channels created alongside the legacy set. Not a replacement —
 * legacy channels remain functional until the Comm-9 cutover. This lets
 * us canary V2 push against a small audience without disturbing anyone
 * else's notification settings.
 *
 * Privacy contract (per Comm V2 spec):
 *   ALL channels use `AndroidNotificationVisibility.PRIVATE`. That means
 *   the lock-screen shows "New notification" (or "Nnn notifications from
 *   ConsultUro"), never the actual title or body. The full content is
 *   only visible AFTER the phone is unlocked and inside the authenticated
 *   app. Never leak diagnosis, procedure, medicine or investigation to
 *   the lock screen.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export const V2_CHANNELS = {
  APPOINTMENTS: 'consulturo_appointments_v2',
  MESSAGES: 'consulturo_messages_v2',
  REMINDERS: 'consulturo_reminders_v2',
  ANNOUNCEMENTS: 'consulturo_announcements_v2',
  SYSTEM: 'consulturo_system_v2',
} as const;

export type V2ChannelId = typeof V2_CHANNELS[keyof typeof V2_CHANNELS];

type Spec = {
  id: V2ChannelId;
  name: string;
  description: string;
  importance: Notifications.AndroidImportance;
  vibrationPattern?: number[];
  lightColor?: string;
};

const SPECS: Spec[] = [
  {
    id: V2_CHANNELS.APPOINTMENTS,
    name: 'Appointments',
    description: 'Bookings, confirmations, cancellations and appointment updates.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 150, 300],
    lightColor: '#0E7C8B',
  },
  {
    id: V2_CHANNELS.MESSAGES,
    name: 'Clinic messages',
    description: 'Messages between you and the ConsultUro clinic team.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3B82F6',
  },
  {
    id: V2_CHANNELS.REMINDERS,
    name: 'Reminders',
    description: 'Appointment, medication and follow-up reminders.',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200],
    lightColor: '#A855F7',
  },
  {
    id: V2_CHANNELS.ANNOUNCEMENTS,
    name: 'Announcements',
    description: 'Clinic-wide announcements and broadcasts.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250],
    lightColor: '#F59E0B',
  },
  {
    id: V2_CHANNELS.SYSTEM,
    name: 'Account & system',
    description: 'Sign-in alerts, account security, app maintenance notices.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200],
    lightColor: '#0E7C8B',
  },
];

/**
 * Idempotent — safe on every cold start. Registers all v2 channels
 * with PRIVATE lock-screen visibility. Silent no-op on non-Android.
 */
export function registerV2AndroidChannels() {
  if (Platform.OS !== 'android') return;
  for (const spec of SPECS) {
    try {
      Notifications.setNotificationChannelAsync(spec.id, {
        name: spec.name,
        description: spec.description,
        importance: spec.importance,
        sound: 'default',
        vibrationPattern: spec.vibrationPattern,
        lightColor: spec.lightColor,
        // PRIVATE across the board — spec requires generic lock-screen
        // titles for clinical notifications. The real content is only
        // visible once the phone is unlocked and inside the app.
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
        enableVibrate: true,
        showBadge: true,
      }).catch(() => {});
    } catch {
      // expo-notifications hiccup on exotic Android ROMs — swallow.
    }
  }
}

/** iOS categories mirror. */
export function registerV2IosCategories() {
  if (Platform.OS !== 'ios') return;
  for (const spec of SPECS) {
    try {
      Notifications.setNotificationCategoryAsync(spec.id, [], {
        showTitle: true,
        showSubtitle: true,
      }).catch(() => {});
    } catch {}
  }
}
