/**
 * Last-route persistence — used to recover from native crashes that
 * restart the JS bundle (which always cold-starts at "/").
 *
 * The flow:
 *   1. _layout.tsx listens to pathname changes and calls `saveLastRoute`.
 *   2. On a native crash the JS context is destroyed, the bundle is
 *      reloaded, Expo Router mounts the initial route ("/"), and the
 *      Home tab is shown.
 *   3. _layout.tsx then calls `loadLastRouteForResume` once on app
 *      startup. If the saved route is fresh enough (< STALE_MS) AND
 *      different from the current pathname, we show a small "Resume
 *      where you were?" snackbar so the user can return to the screen
 *      they were on with one tap.
 *
 * Also writes a parallel `last-crash-log` entry so the diagnostic
 * screen at /admin-crash-log can show recent JS bundle restarts.
 *
 * Storage is local-only (AsyncStorage). No network, no analytics.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LAST_ROUTE = 'lastRoute.v1';
const KEY_CRASH_LOG = 'lastCrash.log.v1';

/** Routes that should NEVER be auto-resumed (they have side effects on
 *  entry or are transient by nature). */
const NEVER_RESUME = new Set([
  '/',
  '/login',
  '/auth-callback',
  '/onboarding',
  '/logout',
]);

/** Anything older than 90s is considered stale — the user has
 *  probably moved on. */
const STALE_MS = 90_000;

export type LastRouteEntry = {
  path: string;
  ts: number;     // epoch ms
};

export type CrashLogEntry = {
  ts: number;     // epoch ms when JS bundle re-mounted
  fromPath: string | null;  // last route just before the bundle reload
};

/** Persist the currently-visible route (cheap; throttled by caller). */
export async function saveLastRoute(path: string): Promise<void> {
  if (!path || NEVER_RESUME.has(path)) return;
  try {
    const entry: LastRouteEntry = { path, ts: Date.now() };
    await AsyncStorage.setItem(KEY_LAST_ROUTE, JSON.stringify(entry));
  } catch {
    // Swallow — storage write failures must never crash the app
  }
}

/** Returns the most-recent route IF it is < STALE_MS old AND eligible
 *  for resume; otherwise null. Always clears the stored value so the
 *  prompt only appears once per restart. */
export async function loadLastRouteForResume(): Promise<LastRouteEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_ROUTE);
    if (!raw) return null;
    // Clear immediately so navigation back to that screen doesn't
    // re-trigger the prompt next time the user closes/opens the app.
    await AsyncStorage.removeItem(KEY_LAST_ROUTE);
    const entry = JSON.parse(raw) as LastRouteEntry;
    if (!entry?.path || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > STALE_MS) return null;
    if (NEVER_RESUME.has(entry.path)) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Append a crash entry (kept to the last 25 entries, FIFO). */
export async function appendCrashLog(fromPath: string | null): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CRASH_LOG);
    const arr: CrashLogEntry[] = raw ? JSON.parse(raw) : [];
    arr.unshift({ ts: Date.now(), fromPath });
    if (arr.length > 25) arr.length = 25;
    await AsyncStorage.setItem(KEY_CRASH_LOG, JSON.stringify(arr));
  } catch {
    // Swallow — diagnostic logging must never crash the app
  }
}

/** Read the in-app crash log (newest first). */
export async function readCrashLog(): Promise<CrashLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CRASH_LOG);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Wipe the crash log (used by the diagnostic screen). */
export async function clearCrashLog(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY_CRASH_LOG);
  } catch {
    // ignore
  }
}
