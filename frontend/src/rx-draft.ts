/**
 * rx-draft — per-booking offline draft persistence.
 *
 * Saves the current state of the "New Prescription / Consultation"
 * form to AsyncStorage, keyed by `draft:rx:<bookingId>`. Used so the
 * doctor can:
 *   • Fill in a consultation on a flaky mobile connection without
 *     losing work.
 *   • Close the app mid-consultation and resume exactly where they
 *     left off.
 *   • Recover from accidental app crashes.
 *
 * Key = 'draft:rx:<bookingId>' (no bookingId → no draft persistence,
 * since we need a stable key to avoid mixing drafts).
 *
 * On successful server save, the caller MUST invoke `clearRxDraft()`
 * to prevent stale prompts on next mount.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type RxDraft = Record<string, any> & {
  _savedAt: string;
};

const keyFor = (bookingId: string) => `draft:rx:${bookingId}`;

/** Debounce-save a snapshot. Fire-and-forget — UI should never block. */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSaveRxDraft(
  bookingId: string,
  fields: Record<string, any>,
  delay = 600,
): void {
  if (!bookingId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const payload: RxDraft = { ...fields, _savedAt: new Date().toISOString() };
      await AsyncStorage.setItem(keyFor(bookingId), JSON.stringify(payload));
    } catch {
      /* silent — offline draft is best-effort */
    }
  }, delay);
}

/** Read the saved draft (or null) for a booking. */
export async function loadRxDraft(bookingId: string): Promise<RxDraft | null> {
  if (!bookingId) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(bookingId));
    if (!raw) return null;
    return JSON.parse(raw) as RxDraft;
  } catch {
    return null;
  }
}

/** Remove the saved draft — call on successful server save. */
export async function clearRxDraft(bookingId: string): Promise<void> {
  if (!bookingId) return;
  try {
    await AsyncStorage.removeItem(keyFor(bookingId));
  } catch {
    /* noop */
  }
}

/** Quick check — used to show a "Draft available" indicator. */
export async function hasRxDraft(bookingId: string): Promise<boolean> {
  if (!bookingId) return false;
  try {
    const raw = await AsyncStorage.getItem(keyFor(bookingId));
    return !!raw;
  } catch {
    return false;
  }
}
