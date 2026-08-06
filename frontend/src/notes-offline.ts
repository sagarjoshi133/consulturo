/**
 * Offline support for Notes.
 *
 * Provides three pieces:
 *   1) Per-note **local cache** — every successful API fetch is mirrored
 *      to AsyncStorage so the editor can show the last-known body even
 *      when the device is offline.
 *   2) **Draft auto-save** — a debounced snapshot of the editor state
 *      is kept under a separate key so the user never loses unsaved
 *      changes (app close, network drop, browser refresh).
 *   3) **Offline write queue** — when a save POST/PATCH/DELETE fails
 *      because the device is offline, the operation is queued and
 *      replayed on reconnect (`flushQueue()`).
 *
 * All functions degrade gracefully if AsyncStorage is unavailable.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const NOTES_CACHE_KEY = 'notesCache.v1';      // { [note_id]: NoteSnapshot }
const NOTES_DRAFT_KEY = 'notesDraft.v1';      // { [note_id_or_new]: Draft }
const NOTES_QUEUE_KEY = 'notesOfflineQueue.v1'; // QueuedOp[]
const NOTES_LIST_KEY  = 'notesListCache.v1';  // NoteSnapshot[]

export type NoteSnapshot = {
  note_id: string;
  title?: string;
  body: string;
  reminder_at?: string | null;
  reminder_fired?: boolean;
  labels?: string[];
  updated_at?: string;
};

export type NoteDraft = {
  key: string;          // 'new' for unsaved notes, otherwise note_id
  title: string;
  body: string;
  labels: string[];
  reminder_at?: string | null;
  saved_at: string;     // ISO timestamp of last local save
};

type QueuedOp =
  | { kind: 'create'; tmp_id: string; payload: any; created_at: string }
  | { kind: 'update'; note_id: string; payload: any; created_at: string }
  | { kind: 'delete'; note_id: string; created_at: string };

// ── List cache ───────────────────────────────────────────────────────
export async function getCachedNotesList(): Promise<NoteSnapshot[] | null> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_LIST_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export async function setCachedNotesList(items: NoteSnapshot[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_LIST_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

// ── Per-note cache ───────────────────────────────────────────────────
async function readMap<T = any>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

async function writeMap(key: string, m: Record<string, any>): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(m));
  } catch { /* ignore */ }
}

export async function getCachedNote(noteId: string): Promise<NoteSnapshot | null> {
  const m = await readMap<NoteSnapshot>(NOTES_CACHE_KEY);
  return m[noteId] || null;
}

export async function cacheNote(snap: NoteSnapshot): Promise<void> {
  const m = await readMap<NoteSnapshot>(NOTES_CACHE_KEY);
  m[snap.note_id] = snap;
  await writeMap(NOTES_CACHE_KEY, m);
}

export async function dropCachedNote(noteId: string): Promise<void> {
  const m = await readMap<NoteSnapshot>(NOTES_CACHE_KEY);
  if (m[noteId]) {
    delete m[noteId];
    await writeMap(NOTES_CACHE_KEY, m);
  }
}

// ── Drafts ───────────────────────────────────────────────────────────
export async function saveDraft(d: NoteDraft): Promise<void> {
  const m = await readMap<NoteDraft>(NOTES_DRAFT_KEY);
  m[d.key] = d;
  await writeMap(NOTES_DRAFT_KEY, m);
}

export async function getDraft(key: string): Promise<NoteDraft | null> {
  const m = await readMap<NoteDraft>(NOTES_DRAFT_KEY);
  return m[key] || null;
}

export async function clearDraft(key: string): Promise<void> {
  const m = await readMap<NoteDraft>(NOTES_DRAFT_KEY);
  if (m[key]) {
    delete m[key];
    await writeMap(NOTES_DRAFT_KEY, m);
  }
}

// ── Offline queue ────────────────────────────────────────────────────
export async function getQueue(): Promise<QueuedOp[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTES_QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setQueue(q: QueuedOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTES_QUEUE_KEY, JSON.stringify(q));
  } catch { /* ignore */ }
}

export async function enqueueCreate(payload: any): Promise<string> {
  const tmp_id = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const q = await getQueue();
  q.push({ kind: 'create', tmp_id, payload, created_at: new Date().toISOString() });
  await setQueue(q);
  return tmp_id;
}

export async function enqueueUpdate(note_id: string, payload: any): Promise<void> {
  const q = await getQueue();
  q.push({ kind: 'update', note_id, payload, created_at: new Date().toISOString() });
  await setQueue(q);
}

export async function enqueueDelete(note_id: string): Promise<void> {
  const q = await getQueue();
  q.push({ kind: 'delete', note_id, created_at: new Date().toISOString() });
  await setQueue(q);
}

export async function pendingCount(): Promise<number> {
  return (await getQueue()).length;
}

/**
 * Replay queued ops in order. Stops at the first failure that looks
 * like a network error so we don't drop data on transient blips.
 * Returns { processed, remaining }.
 */
export async function flushQueue(): Promise<{ processed: number; remaining: number }> {
  const q = await getQueue();
  if (q.length === 0) return { processed: 0, remaining: 0 };
  let processed = 0;
  const remaining: QueuedOp[] = [];
  for (let i = 0; i < q.length; i += 1) {
    const op = q[i];
    try {
      if (op.kind === 'create') {
        await api.post('/notes', op.payload);
      } else if (op.kind === 'update') {
        await api.patch(`/notes/${op.note_id}`, op.payload);
      } else if (op.kind === 'delete') {
        await api.delete(`/notes/${op.note_id}`);
      }
      processed += 1;
    } catch (e: any) {
      // Network errors → keep in queue and stop processing further.
      const isNetwork = !e?.response || e?.code === 'ERR_NETWORK';
      if (isNetwork) {
        remaining.push(...q.slice(i));
        break;
      }
      // Otherwise drop the bad op (e.g. 404 / 403) so it doesn't
      // permanently block the queue.
    }
  }
  await setQueue(remaining);
  return { processed, remaining: remaining.length };
}
