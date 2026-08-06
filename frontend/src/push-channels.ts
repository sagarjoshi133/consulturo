/**
 * Push notification channel & category configuration.
 *
 * On Android, channels are how the OS groups notifications and lets
 * the user control sound / vibration / pop-on-lock-screen behaviour
 * PER notification type from the system Settings → Notifications page.
 *
 * On iOS, the equivalent concept is "notification categories". We
 * register the same set so iOS users can also customise per-type
 * behaviour in iOS Settings.
 *
 * The mapping from server-side `kind`/`type` → channel lives in
 * `channelForKind()` below. Backend sets `data.channel_id` to one of
 * these IDs so the device routes the notification to the right
 * channel when displayed in the foreground.
 *
 * Channel definitions must be registered at MODULE SCOPE (NOT inside
 * a component) so they exist BEFORE any push arrives — critical for
 * the cold-start case where the OS may deliver a push before React
 * mounts.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type ChannelId =
  | 'messages'
  | 'broadcasts'
  | 'appointments'
  | 'video_calls'
  | 'reminders'
  | 'default';

type ChannelSpec = {
  id: ChannelId;
  name: string;
  description: string;
  importance: Notifications.AndroidImportance;
  sound?: 'default' | null;
  vibrationPattern?: number[];
  lightColor?: string;
};

/**
 * Channel catalogue. Order here determines order in Android Settings.
 * Importance levels:
 *  - MAX  → pops on lock-screen + heads-up banner (urgent)
 *  - HIGH → heads-up banner (important)
 *  - DEFAULT → no banner, just tray (informational)
 */
export const CHANNELS: ChannelSpec[] = [
  {
    id: 'video_calls',
    name: 'Video consultations',
    description: 'Doctor or patient is ready to join the call.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 150, 400, 150, 400],
    lightColor: '#0E7C8B',
  },
  {
    id: 'appointments',
    name: 'Appointments',
    description: 'New bookings, confirmations, cancellations and reminders.',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 300, 150, 300],
    lightColor: '#0E7C8B',
  },
  {
    id: 'messages',
    name: 'Messages',
    description: 'Personal messages from your care team and inbox replies.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3B82F6',
  },
  {
    id: 'broadcasts',
    name: 'Announcements',
    description: 'Clinic-wide announcements and broadcasts.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250],
    lightColor: '#F59E0B',
  },
  {
    id: 'reminders',
    name: 'Reminders',
    description: 'Note reminders, follow-ups and gentle nudges.',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 200],
    lightColor: '#A855F7',
  },
  {
    id: 'default',
    name: 'Other',
    description: 'General notifications that don\'t fit other categories.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0E7C8B',
  },
];

/**
 * Map server-side `kind` or `type` → channel id.
 * Keep in sync with the same mapping on the backend
 * (`services/push_relay.py :: _channel_for_kind`).
 */
export function channelForKind(kind: string | null | undefined): ChannelId {
  const k = (kind || '').toLowerCase();
  if (!k) return 'default';
  if (k === 'video_room_ready') return 'video_calls';
  if (k.startsWith('booking') || k === 'new_booking' || k === 'note_reminder') {
    return k === 'note_reminder' ? 'reminders' : 'appointments';
  }
  if (k === 'personal' || k === 'message' || k === 'inbox') return 'messages';
  if (k.startsWith('broadcast')) return 'broadcasts';
  if (k.includes('reminder')) return 'reminders';
  return 'default';
}

/**
 * Idempotent — safe to call repeatedly on every cold start.
 * Android only; iOS uses categories instead (see registerIosCategories).
 */
export function registerAndroidChannels() {
  if (Platform.OS !== 'android') return;
  for (const spec of CHANNELS) {
    try {
      Notifications.setNotificationChannelAsync(spec.id, {
        name: spec.name,
        description: spec.description,
        importance: spec.importance,
        sound: spec.sound ?? 'default',
        vibrationPattern: spec.vibrationPattern,
        lightColor: spec.lightColor,
        // Show on lock screen with full content for MAX-importance
        // channels; truncate sensitive content for default/lower.
        lockscreenVisibility:
          spec.importance === Notifications.AndroidImportance.MAX
            ? Notifications.AndroidNotificationVisibility.PUBLIC
            : Notifications.AndroidNotificationVisibility.PRIVATE,
        enableVibrate: true,
        showBadge: true,
      }).catch(() => {});
    } catch {
      // expo-notifications may throw on web fallthrough — ignore.
    }
  }
}

/**
 * iOS notification categories — analogue of Android channels.
 * Registered so the user can tweak per-category behaviour in iOS
 * Settings → Notifications → ConsultUro.
 */
export function registerIosCategories() {
  if (Platform.OS !== 'ios') return;
  for (const spec of CHANNELS) {
    try {
      Notifications.setNotificationCategoryAsync(spec.id, [], {
        // Show the body in the lock-screen preview for high-importance
        // categories. iOS doesn't expose channel-style importance, so
        // we lean on the OS-level "Time Sensitive" interruption level
        // (set per-notification via the relay if supported).
        showTitle: true,
        showSubtitle: true,
      }).catch(() => {});
    } catch {
      // Safe to ignore on web / older OS versions.
    }
  }
}
