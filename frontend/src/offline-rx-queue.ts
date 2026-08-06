/**
 * Wave 6 (BB) — Offline Rx queue.
 *
 * Stores Rx payloads that failed to upload (no network / timeout)
 * and retries them silently when connectivity returns.
 *
 * Backed by AsyncStorage. The queue is keyed by an opaque uuid
 * so duplicate uploads are de-duped.
 *
 * Usage:
 *   import { enqueueRxDraft, runRxQueue, useOfflineRxQueueCount } from './offline-rx-queue';
 *
 *   try {
 *     await api.post('/prescriptions', payload);
 *   } catch (e) {
 *     if (isNetworkError(e)) await enqueueRxDraft(payload);
 *   }
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import api from './api';

const KEY = '@consulturo/offline-rx-queue.v1';

type RxQueueItem = {
  id: string;
  payload: Record<string, any>;
  added_at: string;
  attempts: number;
  last_error?: string;
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function notifyListeners(count: number) {
  for (const l of listeners) {
    try { l(count); } catch { /* noop */ }
  }
}

async function loadQueue(): Promise<RxQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(items: RxQueueItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
    notifyListeners(items.length);
  } catch {
    // best-effort
  }
}

function uuid(): string {
  return 'rxq_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function isNetworkError(e: any): boolean {
  if (!e) return false;
  const msg = (e?.message || '').toLowerCase();
  // Axios sets `e.code === 'ERR_NETWORK'` for network failures.
  if (e?.code === 'ERR_NETWORK') return true;
  if (msg.includes('network error')) return true;
  if (msg.includes('timeout')) return true;
  if (e?.response == null) return true; // request never reached the server
  return false;
}

export async function enqueueRxDraft(payload: Record<string, any>): Promise<string> {
  const q = await loadQueue();
  const item: RxQueueItem = {
    id: uuid(),
    payload,
    added_at: new Date().toISOString(),
    attempts: 0,
  };
  q.push(item);
  await saveQueue(q);
  return item.id;
}

export async function getQueueCount(): Promise<number> {
  return (await loadQueue()).length;
}

/** Try to flush every queued Rx. Items that still fail stay in the queue.
 *  Returns the number of successfully uploaded items. */
export async function runRxQueue(): Promise<number> {
  const q = await loadQueue();
  if (q.length === 0) return 0;
  const remaining: RxQueueItem[] = [];
  let success = 0;
  for (const it of q) {
    try {
      await api.post('/prescriptions', it.payload);
      success += 1;
    } catch (e: any) {
      remaining.push({
        ...it,
        attempts: it.attempts + 1,
        last_error: (e?.message || String(e)).slice(0, 200),
      });
    }
  }
  await saveQueue(remaining);
  return success;
}

/** React hook that returns the current queue count and subscribes
 *  to live updates (other parts of the app calling enqueue/run). */
export function useOfflineRxQueueCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await getQueueCount();
      if (alive) setN(c);
    })();
    const listener: Listener = (count) => { if (alive) setN(count); };
    listeners.add(listener);
    return () => {
      alive = false;
      listeners.delete(listener);
    };
  }, []);
  return n;
}
