/**
 * Local-notification scheduler for note reminders.
 *
 * We keep a tiny AsyncStorage map of {note_id -> notification_identifier}
 * so we can cancel/replace a note's alarm whenever the note is edited or
 * deleted. Gracefully no-ops on web (expo-notifications has no scheduler
 * there) — the cloud-side reminder_fired worker will still eventually
 * deliver push in that case.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'noteReminderIds.v1';

type IdMap = Record<string, string>;

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
 * Schedule (or replace) a local alarm for a given note. If `whenIso` is null
 * or in the past we just cancel any existing one.
 * Returns the notification identifier (or null if not scheduled).
 */
export async function scheduleNoteReminder(
  noteId: string,
  title: string | undefined,
  body: string,
  whenIso: string | null
): Promise<string | null> {
  // Always cancel the previous alarm for this note first so updates don't
  // double-fire.
  await cancelNoteReminder(noteId);

  if (!whenIso) return null;
  const trigger = new Date(whenIso);
  if (isNaN(trigger.getTime())) return null;
  if (trigger.getTime() <= Date.now() + 1000) return null; // only future times

  if (Platform.OS === 'web') {
    // No reliable background scheduler on web — skip.
    return null;
  }

  const granted = await ensurePermission();
  if (!granted) return null;

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: title && title.trim() ? title.trim() : 'Note reminder',
        body: (body || '').slice(0, 140) || 'Tap to open your note',
        sound: 'default',
        data: { kind: 'note_reminder', note_id: noteId },
      },
      trigger: { type: 'date', date: trigger } as any,
    });
    const map = await readMap();
    map[noteId] = id;
    await writeMap(map);
    return id;
  } catch {
    return null;
  }
}

export async function cancelNoteReminder(noteId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const map = await readMap();
  const prev = map[noteId];
  if (!prev) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(prev);
  } catch {
    /* ignore */
  }
  delete map[noteId];
  await writeMap(map);
}
