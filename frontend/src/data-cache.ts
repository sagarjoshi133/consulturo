/**
 * Data cache for stale-while-revalidate tab loading — now PERSISTED.
 *
 * Screens live inside a tab navigator, so switching away unmounts the
 * panel and switching back remounts it — which previously meant a full
 * spinner + refetch every single time. This module keeps the last
 * successful payload per key in memory so a remounting screen renders
 * its previous data INSTANTLY and refreshes quietly in the background.
 *
 * v2 (persistence): entries are also written-through to AsyncStorage so
 * a FULL APP RESTART paints the last-known data instantly too, instead
 * of showing spinners on every cold open. Safety:
 *   • Cache is scoped to one account — `ensureCacheOwner(userId)` wipes
 *     everything when a different user signs in.
 *   • `invalidateCached()` (called on sign-out) clears storage as well.
 *   • Oversized payloads (>400 KB) stay memory-only so we never blow
 *     the AsyncStorage budget on Android.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type Entry = { data: unknown; at: number };

const _cache = new Map<string, Entry>();

const STORE_PREFIX = 'dc:';
const OWNER_KEY = 'dc_owner';
const MAX_PERSIST_BYTES = 400_000;

export function getCached<T = unknown>(key: string): T | undefined {
  const e = _cache.get(key);
  return e ? (e.data as T) : undefined;
}

export function hasCached(key: string): boolean {
  return _cache.has(key);
}

/** When the cache entry was written (ms epoch), or 0 if absent. */
export function cachedAt(key: string): number {
  return _cache.get(key)?.at ?? 0;
}

export function setCached(key: string, data: unknown): void {
  const entry: Entry = { data, at: Date.now() };
  _cache.set(key, entry);
  // Write-through to disk, fire-and-forget. Never blocks the UI.
  try {
    const raw = JSON.stringify(entry);
    if (raw && raw.length <= MAX_PERSIST_BYTES) {
      AsyncStorage.setItem(STORE_PREFIX + key, raw).catch(() => {});
    }
  } catch {
    /* non-serialisable payload — memory-only */
  }
}

/** Drop everything (no prefix) or just keys starting with `prefix`. */
export function invalidateCached(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    _clearPersisted().catch(() => {});
    return;
  }
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) {
      _cache.delete(k);
      AsyncStorage.removeItem(STORE_PREFIX + k).catch(() => {});
    }
  }
}

async function _clearPersisted(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(STORE_PREFIX));
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch {
    /* best-effort */
  }
}

/**
 * Load every persisted entry into memory. Called once at app boot
 * (AuthProvider) BEFORE the first screen mounts, so `getCached()` hits
 * from the very first render after a cold start.
 */
export async function hydrateCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(STORE_PREFIX));
    if (!mine.length) return;
    const pairs = await AsyncStorage.multiGet(mine);
    for (const [k, raw] of pairs) {
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as Entry;
        const memKey = k.slice(STORE_PREFIX.length);
        if (!_cache.has(memKey)) _cache.set(memKey, entry);
      } catch {
        AsyncStorage.removeItem(k).catch(() => {});
      }
    }
  } catch {
    /* hydration is best-effort — app works identically without it */
  }
}

/**
 * Scope the persisted cache to a single account. If a DIFFERENT user
 * signs in, wipe everything (memory + disk) so no data can leak across
 * accounts on a shared device.
 */
export async function ensureCacheOwner(userId: string): Promise<void> {
  try {
    const prev = await AsyncStorage.getItem(OWNER_KEY);
    if (prev && prev !== userId) {
      _cache.clear();
      await _clearPersisted();
    }
    if (prev !== userId) await AsyncStorage.setItem(OWNER_KEY, userId);
  } catch {
    /* best-effort */
  }
}
