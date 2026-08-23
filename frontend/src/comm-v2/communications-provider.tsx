/**
 * CommunicationsProvider — the single source of truth for Comm V2
 * unread counts + refresh triggers across the app.
 *
 * Per spec:
 *   "Create a single CommunicationsProvider responsible for:
 *      - Notification counts
 *      - Message counts (Comm-4 — will extend this provider)
 *      - Foreground refresh
 *      - Push-response refresh
 *      - Installation registration state
 *      - Connectivity-aware retries
 *    Do not have multiple screens independently calculate global
 *    badge counts."
 *
 * Flag-gated: if the master flag is off and the user is not a canary,
 * every field returns 0 / null so existing legacy UI is untouched.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import api from '../api';
import { useAuth } from '../auth';

export type InboxCounts = {
  total_unread: number;
  by_category: Record<string, number>;
};

export type MessagesCounts = {
  total_unread: number;
  conversation_count: number;
};

export type InboxItem = {
  id: string;
  category: string;
  item_type: string;
  source_id: string | null;
  title: string;
  body: string;
  action_type: string;
  action_target: string | null;
  priority: 'low' | 'normal' | 'high';
  metadata?: Record<string, unknown>;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
};

type CommV2Ctx = {
  /** Comm V2 master switch — false when flag off + user not canary. */
  enabled: boolean;
  /** Server-computed notification-inbox counts. Never derived on the client. */
  counts: InboxCounts;
  /** Server-computed message counts (Comm-4). */
  messageCounts: MessagesCounts;
  /** Explicit refresh (e.g. after push tap). */
  refresh: () => Promise<void>;
  /** Cursor-paginated inbox fetch. */
  fetchInbox: (opts?: {
    limit?: number;
    cursor?: string | null;
    category?: string | null;
    unread_only?: boolean;
    include_archived?: boolean;
  }) => Promise<{ items: InboxItem[]; next_cursor: string | null }>;
  /** Mark specific supplied ids read (server-side, atomic). */
  markRead: (ids: string[]) => Promise<number>;
  /** Archive one item. */
  archive: (id: string) => Promise<boolean>;
  /** Provider status snapshot for diagnostics UI. */
  lastRefreshedAt: number | null;
  lastError: string | null;
};

const DEFAULT_COUNTS: InboxCounts = { total_unread: 0, by_category: {} };
const DEFAULT_MSG_COUNTS: MessagesCounts = { total_unread: 0, conversation_count: 0 };

const CommV2Context = createContext<CommV2Ctx>({
  enabled: false,
  counts: DEFAULT_COUNTS,
  messageCounts: DEFAULT_MSG_COUNTS,
  refresh: async () => {},
  fetchInbox: async () => ({ items: [], next_cursor: null }),
  markRead: async () => 0,
  archive: async () => false,
  lastRefreshedAt: null,
  lastError: null,
});

/**
 * Detect whether Comm V2 is enabled for THIS user. We piggy-back on
 * the diagnostics endpoint's `flags` block (owner-only) or fall back
 * to a lightweight probe of the counts endpoint (always safe — it
 * returns 200 with total_unread=0 for a user with no inbox items).
 */
async function _resolveEnabled(): Promise<boolean> {
  try {
    const r = await api.get('/v2/communications/me');
    return Boolean(r?.data?.enabled);
  } catch {
    return false;
  }
}

export function CommunicationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [counts, setCounts] = useState<InboxCounts>(DEFAULT_COUNTS);
  const [messageCounts, setMessageCounts] = useState<MessagesCounts>(DEFAULT_MSG_COUNTS);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlight = useRef(false);

  // On login change, resolve enabled + fetch initial counts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setEnabled(false);
        setCounts(DEFAULT_COUNTS);
        return;
      }
      const on = await _resolveEnabled();
      if (cancelled) return;
      setEnabled(on);
    })();
    return () => { cancelled = true; };
  }, [user?.user_id]);

  const refresh = useCallback(async () => {
    if (!user || inFlight.current) return;
    inFlight.current = true;
    try {
      // Run both count queries in parallel.
      const [inboxRes, convRes] = await Promise.allSettled([
        api.get('/v2/communications/inbox/counts'),
        api.get('/v2/communications/conversations', { params: { limit: 100 } }),
      ]);

      if (inboxRes.status === 'fulfilled') {
        const r: any = inboxRes.value;
        setCounts({
          total_unread: Number(r?.data?.total_unread || 0),
          by_category: (r?.data?.by_category || {}) as Record<string, number>,
        });
      }

      if (convRes.status === 'fulfilled') {
        const items: any[] = (convRes.value?.data?.items || []) as any[];
        // Sum unread per side depending on whether this user is the
        // patient in the conversation or on the clinic side. The
        // conversation payload already carries both counters.
        let total = 0;
        for (const c of items) {
          const isPatient = c?.patient_user_id === (user as any)?.user_id;
          const n = isPatient
            ? Number(c?.unread_for_patient || 0)
            : Number(c?.unread_for_clinic || 0);
          total += n;
        }
        setMessageCounts({
          total_unread: total,
          conversation_count: items.length,
        });
      }

      setLastRefreshedAt(Date.now());
      setLastError(null);
    } catch (e: any) {
      setLastError(e?.response?.data?.detail || e?.message || 'refresh_failed');
    } finally {
      inFlight.current = false;
    }
  }, [user?.user_id]);

  // Refresh on foreground / on enabled toggle.
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => { sub.remove(); };
  }, [enabled, refresh]);

  // Publish the current refresh function so `triggerCommV2Refresh()`
  // can be called from outside React (push-tap handler etc.).
  useEffect(() => {
    _registerExternalRefresh(refresh);
    return () => _registerExternalRefresh(null);
  }, [refresh]);

  // Periodic gentle refresh — 60s while foregrounded.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => refresh(), 60_000);
    return () => clearInterval(t);
  }, [enabled, refresh]);

  const fetchInbox = useCallback<CommV2Ctx['fetchInbox']>(async (opts) => {
    if (!enabled) return { items: [], next_cursor: null };
    const params: Record<string, unknown> = {
      limit: opts?.limit ?? 30,
    };
    if (opts?.cursor) params.cursor = opts.cursor;
    if (opts?.category) params.category = opts.category;
    if (opts?.unread_only) params.unread_only = true;
    if (opts?.include_archived) params.include_archived = true;
    try {
      const r = await api.get('/v2/communications/inbox', { params });
      return {
        items: (r?.data?.items || []) as InboxItem[],
        next_cursor: (r?.data?.next_cursor || null) as string | null,
      };
    } catch {
      return { items: [], next_cursor: null };
    }
  }, [enabled]);

  const markRead = useCallback(async (ids: string[]) => {
    if (!enabled || !ids.length) return 0;
    try {
      const r = await api.post('/v2/communications/inbox/read-batch', { item_ids: ids });
      // Refresh counts once the server confirmed the update.
      refresh().catch(() => {});
      return Number(r?.data?.updated || 0);
    } catch {
      return 0;
    }
  }, [enabled, refresh]);

  const archiveItem = useCallback(async (id: string) => {
    if (!enabled) return false;
    try {
      await api.post(`/v2/communications/inbox/${encodeURIComponent(id)}/archive`);
      refresh().catch(() => {});
      return true;
    } catch {
      return false;
    }
  }, [enabled, refresh]);

  const value = useMemo<CommV2Ctx>(() => ({
    enabled,
    counts,
    messageCounts,
    refresh,
    fetchInbox,
    markRead,
    archive: archiveItem,
    lastRefreshedAt,
    lastError,
  }), [enabled, counts, messageCounts, refresh, fetchInbox, markRead, archiveItem, lastRefreshedAt, lastError]);

  return <CommV2Context.Provider value={value}>{children}</CommV2Context.Provider>;
}

/** Consumer hook — use anywhere in the tree that's inside the provider. */
export function useCommunicationsV2(): CommV2Ctx {
  return useContext(CommV2Context);
}

/** External trigger for push-tap → refresh. Placed outside the hook so
 *  the push listener in _layout.tsx can call it without breaking rules
 *  of hooks. */
let _externalRefresh: (() => Promise<void>) | null = null;
export function _registerExternalRefresh(fn: (() => Promise<void>) | null) {
  _externalRefresh = fn;
}
export async function triggerCommV2Refresh() {
  try { await _externalRefresh?.(); } catch {}
}
