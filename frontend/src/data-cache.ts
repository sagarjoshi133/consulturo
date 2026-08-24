/**
 * Tiny in-memory data cache for stale-while-revalidate tab loading.
 *
 * Screens live inside a tab navigator, so switching away unmounts the
 * panel and switching back remounts it — which previously meant a full
 * spinner + refetch every single time. This module keeps the last
 * successful payload per key in memory (for the app session) so a
 * remounting screen can render its previous data INSTANTLY and refresh
 * quietly in the background.
 *
 * Intentionally in-memory only (no persistence): it survives tab
 * switches and navigation within a session, which is exactly what the
 * "keep already-loaded data when you switch tabs" ask needs, and it can
 * never surface another account's data across a fresh launch/login.
 * `invalidateCached()` is called on sign-out to be safe.
 */
type Entry = { data: unknown; at: number };

const _cache = new Map<string, Entry>();

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
  _cache.set(key, { data, at: Date.now() });
}

/** Drop everything (no prefix) or just keys starting with `prefix`. */
export function invalidateCached(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    return;
  }
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) _cache.delete(k);
  }
}
