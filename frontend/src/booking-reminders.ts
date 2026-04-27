/**
 * Local-notification scheduler for APPOINTMENT reminders.
 *
 * Lets a patient choose when they'd like to be reminded before an
 * upcoming consultation (1 hour, 1 day, or 1 week in advance). The
 * server-side engine also sends 24h/2h push notifications for
 * confirmed appointments, but these local reminders:
 *   - work even BEFORE the booking is confirmed by staff
 *   - work if device notifications can't reach the server (no internet)
 *   - respect the user's personally chosen lead time
 *
 * Implementation mirrors note-reminders.ts — a tiny AsyncStorage map
 * of {booking_id -> [notification_ids]} so we can cancel/replace a
 * booking's alarms when the slot is rescheduled or cancelled.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'bookingReminderIds.v1';

type IdMap = Record<string, string[]>;

export type ReminderLead = '1h' | '1d' | '1w';

export const REMINDER_LEADS: { key: ReminderLead; minutes: number; labelEn: string; labelHi: string; labelGu: string }[] = [
  { key: '1h', minutes: 60, labelEn: '1 hour before', labelHi: '1 घंटा पहले', labelGu: '1 કલાક પહેલાં' },
  { key: '1d', minutes: 60 * 24, labelEn: '1 day before', labelHi: '1 दिन पहले', labelGu: '1 દિવસ પહેલાં' },
  { key: '1w', minutes: 60 * 24 * 7, labelEn: '1 week before', labelHi: '1 सप्ताह पहले', labelGu: '1 અઠવાડિયા પહેલાં' },
];

async function readMap(): Promise<IdMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(m: IdMap) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return req.status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Combines 'YYYY-MM-DD' + 'HH:mm' into a local Date object.
 */
function combine(dateStr: string, timeStr: string): Date | null {
  try {
    const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10));
    const [hh, mm] = timeStr.split(':').map((n) => parseInt(n, 10));
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, hh || 0, mm || 0, 0);
  } catch {
    return null;
  }
}

export type BookingRemindInput = {
  booking_id: string;
  booking_date: string;   // 'YYYY-MM-DD'
  booking_time: string;   // 'HH:mm'
  patient_name?: string;
  mode?: string;          // 'in-person' | 'online'
};

/**
 * Schedule (or replace) local reminders for a booking at the chosen
 * lead times. Returns the number of reminders that were actually
 * scheduled (0 on web, or if permission was denied, or if all chosen
 * lead times are in the past).
 */
export async function scheduleBookingReminders(
  ev: BookingRemindInput,
  leads: ReminderLead[]
): Promise<number> {
  // Cancel previous ones first
  await cancelBookingReminders(ev.booking_id);

  if (!leads || leads.length === 0) return 0;
  if (Platform.OS === 'web') return 0;

  const apt = combine(ev.booking_date, ev.booking_time);
  if (!apt) return 0;
  if (apt.getTime() <= Date.now() + 60_000) return 0; // need future appt

  const granted = await ensurePermission();
  if (!granted) return 0;

  const isOnline = ev.mode === 'online';
  const title = 'Upcoming consultation';
  const humanTime = apt.toLocaleString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const bodyFor = (leadLabel: string) =>
    `${leadLabel} — ${ev.patient_name ? ev.patient_name + "'s " : ''}appointment with Dr. Sagar Joshi on ${humanTime}${isOnline ? ' (Online)' : ''}.`;

  const ids: string[] = [];
  for (const key of leads) {
    const lead = REMINDER_LEADS.find((l) => l.key === key);
    if (!lead) continue;
    const when = new Date(apt.getTime() - lead.minutes * 60 * 1000);
    if (when.getTime() <= Date.now() + 1000) continue; // skip past-due leads
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body: bodyFor(lead.labelEn),
          sound: 'default',
          data: { kind: 'booking_reminder_local', booking_id: ev.booking_id, lead: key },
        },
        trigger: { type: 'date', date: when } as any,
      });
      ids.push(id);
    } catch {
      /* skip */
    }
  }

  if (ids.length) {
    const map = await readMap();
    map[ev.booking_id] = ids;
    await writeMap(map);
  }
  return ids.length;
}

export async function cancelBookingReminders(booking_id: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const map = await readMap();
  const prev = map[booking_id] || [];
  for (const id of prev) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }
  delete map[booking_id];
  await writeMap(map);
}

/** Human label helper — exported for use by UI chips. */
export function labelFor(key: ReminderLead, lang: 'en' | 'hi' | 'gu' = 'en'): string {
  const l = REMINDER_LEADS.find((r) => r.key === key);
  if (!l) return key;
  return lang === 'hi' ? l.labelHi : lang === 'gu' ? l.labelGu : l.labelEn;
}
