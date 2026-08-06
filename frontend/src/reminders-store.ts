/**
 * Standalone Reminders — pure device-alarm utility.
 *
 * Reminders are intentionally separate from Notes:
 *   • Notes  = rich, urology-oriented note-taking (server-persisted)
 *   • Reminders = simple "buzz me at <time>" alarms scheduled with
 *     expo-notifications and stored locally in AsyncStorage. No body,
 *     no labels, no images.
 *
 * Each reminder carries:
 *   - id          (uuid-ish)
 *   - title       (what to remind)
 *   - when_iso    (ISO 8601 date+time)
 *   - repeat      ('none' | 'daily' | 'weekly')
 *   - role_tag    optional admin orientation: 'clinical' | 'admin' | 'personal'
 *   - notification_id (the expo-notifications scheduled handle)
 *   - created_at  ISO
 *   - active      bool — set false once the user dismisses
 *
 * Web platforms can't schedule local notifications reliably; we still
 * persist the metadata so the list view works, but `notification_id`
 * stays null. (Future: send to backend for cloud push fallback.)
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'reminders.v1';

export type RepeatKind = 'none' | 'daily' | 'weekly';
export type ReminderTag = 'clinical' | 'admin' | 'personal';

export type Reminder = {
  id: string;
  title: string;
  when_iso: string;
  repeat: RepeatKind;
  role_tag?: ReminderTag;
  notification_id?: string | null;
  created_at: string;
  active: boolean;
};

async function read(): Promise<Reminder[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function write(arr: Reminder[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

async function ensurePerm(): Promise<boolean> {
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

async function schedule(
  title: string,
  when: Date,
  repeat: RepeatKind,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (when.getTime() <= Date.now() + 500) return null;
  const granted = await ensurePerm();
  if (!granted) return null;
  try {
    let trigger: any;
    if (repeat === 'daily') {
      trigger = { type: 'daily', hour: when.getHours(), minute: when.getMinutes() };
    } else if (repeat === 'weekly') {
      trigger = { type: 'weekly', weekday: when.getDay() + 1, hour: when.getHours(), minute: when.getMinutes() };
    } else {
      trigger = { type: 'date', date: when };
    }
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: title || 'Reminder',
        body: 'Tap to open ConsultUro',
        sound: 'default',
        data: { kind: 'reminder' },
      },
      trigger,
    });
    return id;
  } catch {
    return null;
  }
}

async function cancel(notificationId?: string | null) {
  if (Platform.OS === 'web' || !notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    /* ignore */
  }
}

export async function listReminders(): Promise<Reminder[]> {
  const arr = await read();
  return arr.sort((a, b) => new Date(a.when_iso).getTime() - new Date(b.when_iso).getTime());
}

export async function addReminder(input: {
  title: string;
  when_iso: string;
  repeat?: RepeatKind;
  role_tag?: ReminderTag;
}): Promise<Reminder> {
  const id = `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const when = new Date(input.when_iso);
  const repeat = input.repeat || 'none';
  const notification_id = await schedule(input.title, when, repeat);
  const r: Reminder = {
    id,
    title: input.title,
    when_iso: input.when_iso,
    repeat,
    role_tag: input.role_tag,
    notification_id,
    created_at: new Date().toISOString(),
    active: true,
  };
  const arr = await read();
  arr.push(r);
  await write(arr);
  return r;
}

export async function updateReminder(
  id: string,
  patch: Partial<Pick<Reminder, 'title' | 'when_iso' | 'repeat' | 'role_tag' | 'active'>>,
): Promise<Reminder | null> {
  const arr = await read();
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const cur = arr[idx];
  // Re-schedule if time / repeat / title changed.
  let next = { ...cur, ...patch };
  if (patch.when_iso || patch.repeat || patch.title || patch.active === false) {
    await cancel(cur.notification_id);
    if (next.active !== false) {
      const newId = await schedule(next.title, new Date(next.when_iso), next.repeat);
      next.notification_id = newId;
    } else {
      next.notification_id = null;
    }
  }
  arr[idx] = next;
  await write(arr);
  return next;
}

export async function deleteReminder(id: string): Promise<void> {
  const arr = await read();
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return;
  await cancel(arr[idx].notification_id);
  arr.splice(idx, 1);
  await write(arr);
}

export async function snoozeReminder(id: string, minutes: number): Promise<Reminder | null> {
  const newWhen = new Date(Date.now() + minutes * 60_000).toISOString();
  return updateReminder(id, { when_iso: newWhen, active: true });
}
