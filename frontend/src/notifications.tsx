// App-wide notification centre hook.
//
// Usage (inside a screen once per session):
//   const { items, unread, refresh, markRead, markAllRead } = useNotifications();
//
// Features:
//   • Polls /api/notifications every minute while the app is open.
//   • Fires a toast for every NEW unread notification detected since the
//     last poll so the user gets a visual ping even if they missed the
//     native push banner.
//   • Exposes `refresh()` to force an immediate fetch (e.g. after an action).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNEventSource from 'react-native-sse';
import api from './api';
import { getActiveBase } from './backend-health';
import { useAuth } from './auth';
import { useToast } from './toast';

export type Notification = {
  id: string;
  user_id?: string;
  title: string;
  body: string;
  kind: string;
  source_type?: string;
  image_url?: string | null;
  link?: string | null;
  data?: Record<string, any>;
  read: boolean;
  created_at: string;
};

type Ctx = {
  items: Notification[];
  unread: number;
  // Unread count specifically for personal messages — used by the
  // dedicated Inbox icon (next to the bell). Bell shows ALL notif
  // unread; Inbox icon shows ONLY kind="personal".
  personalUnread: number;
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotifCtx = createContext<Ctx>({
  items: [],
  unread: 0,
  personalUnread: 0,
  loading: false,
  refresh: async () => {},
  markRead: async () => {},
  markAllRead: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, refresh: refreshAuth } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [personalUnread, setPersonalUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  // Remember which notification IDs we've already shown as toasts so we
  // don't spam the user on every poll.
  const toasted = useRef<Set<string>>(new Set());
  const firstRun = useRef(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnread(0);
      setPersonalUnread(0);
      return;
    }
    setLoading(true);
    try {
      // Phase A: unified feed — notifications + broadcast inbox + push
      // log merged server-side into one list.
      const { data } = await api.get('/inbox/all', { params: { limit: 50 } });
      const list: Notification[] = data?.items || [];
      // Sort in the order the user expects when tapping the bell:
      //   1. Unread first, newest to oldest.
      //   2. Then read, newest to oldest.
      // This prevents unread items from getting buried under stale-but-read ones.
      const sorted = [...list].sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        const at = new Date(a.created_at || 0).getTime();
        const bt = new Date(b.created_at || 0).getTime();
        return bt - at;
      });
      setItems(sorted);
      // Compute the two unread counts directly from the items list so
      // they're always in sync:
      //   • personalUnread → only kind='personal'   (Inbox icon)
      //   • unread         → ALL OTHER unread items (Bell icon)
      // This makes the Inbox icon and bell icon mutually exclusive
      // counters — opening either screen clears only its own badge.
      const pCount = sorted.filter((n) => !n.read && n.kind === 'personal').length;
      const otherCount = sorted.filter((n) => !n.read && n.kind !== 'personal').length;
      setPersonalUnread(pCount);
      setUnread(otherCount);

      // On SUBSEQUENT polls, toast any new unread items we haven't shown yet.
      // Skip the initial load to avoid a flurry of toasts the first time.
      if (!firstRun.current) {
        const fresh = sorted.filter((n) => !n.read && !toasted.current.has(n.id));
        fresh.slice(0, 3).forEach((n) => {
          toast.info(n.title);
          // Web: also raise a native browser notification pop-up so the
          // user is alerted even when this tab isn't focused. Requires
          // one-time permission (requested on mount); silently skipped
          // otherwise. `tag` de-dupes if the same item fires twice.
          if (
            Platform.OS === 'web' &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification(n.title, { body: n.body || undefined, tag: n.id });
            } catch {}
          }
          toasted.current.add(n.id);
        });
      } else {
        // Mark all existing unread ones as "already seen" for toast purposes
        // so we don't show them again during this session.
        sorted.filter((n) => !n.read).forEach((n) => toasted.current.add(n.id));
      }
      firstRun.current = false;
    } catch {
      // Silent — notifications are a non-critical enhancement.
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  // Ask for web browser-notification permission once (contextually, for
  // a signed-in user) so we can raise native pop-ups for new items.
  useEffect(() => {
    if (
      Platform.OS === 'web' &&
      user &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      try { Notification.requestPermission(); } catch {}
    }
  }, [user]);

  // Live updates: adaptive polling + a real-time SSE stream.
  //   • Polls every 15s ONLY while the app/tab is active; pauses when
  //     hidden/backgrounded (saves battery + requests).
  //   • Refreshes instantly on focus / foreground so returning users
  //     see the latest immediately.
  //   • Opens an SSE stream (web: EventSource, native: react-native-sse)
  //     that pushes a `notify` event within a few seconds of any new
  //     item — the "live app" feel. Polling is the graceful fallback if
  //     the stream can't hold open (e.g. a buffering proxy).
  useEffect(() => {
    if (!user) return;
    refresh();

    let pollTimer: any = null;
    let authTimer: any = null;
    let es: any = null;
    let closed = false;

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => { refresh(); }, 15_000);
    };
    const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };

    const connectStream = async () => {
      if (closed || es) return;
      try {
        const token = await AsyncStorage.getItem('session_token');
        if (!token) return;
        const url = `${getActiveBase()}/api/inbox/stream?token=${encodeURIComponent(token)}`;
        if (Platform.OS === 'web') {
          if (typeof EventSource === 'undefined') return;
          es = new EventSource(url);
        } else {
          es = new RNEventSource(url);
        }
        es.addEventListener('notify', () => { refresh(); });
      } catch { es = null; }
    };
    const disconnectStream = () => {
      if (es) {
        try { es.removeAllEventListeners?.(); } catch {}
        try { es.close?.(); } catch {}
        es = null;
      }
    };

    const onActive = () => { refresh(); startPolling(); connectStream(); };
    const onInactive = () => { stopPolling(); disconnectStream(); };

    // Keep auth/permission propagation on the original ~60s cadence.
    authTimer = setInterval(() => { try { refreshAuth?.(); } catch {} }, 60_000);

    let cleanupActivity = () => {};
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const visHandler = () => {
        if (document.visibilityState === 'visible') onActive(); else onInactive();
      };
      document.addEventListener('visibilitychange', visHandler);
      window.addEventListener('focus', onActive);
      cleanupActivity = () => {
        document.removeEventListener('visibilitychange', visHandler);
        window.removeEventListener('focus', onActive);
      };
      if (document.visibilityState === 'visible') onActive(); else startPolling();
    } else {
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') onActive(); else onInactive();
      });
      cleanupActivity = () => { try { sub.remove(); } catch {} };
      onActive();
    }

    return () => {
      closed = true;
      stopPolling();
      if (authTimer) clearInterval(authTimer);
      disconnectStream();
      cleanupActivity();
    };
  }, [user, refresh, refreshAuth]);

  const markRead = useCallback(async (id: string) => {
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((prev) => {
        const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
        // Recompute personal unread after mark.
        const p = updated.filter((n) => !n.read && n.kind === 'personal').length;
        setPersonalUnread(p);
        // Re-sort so the newly-read item moves to the read section
        return [...updated].sort((a, b) => {
          if (a.read !== b.read) return a.read ? 1 : -1;
          const at = new Date(a.created_at || 0).getTime();
          const bt = new Date(b.created_at || 0).getTime();
          return bt - at;
        });
      });
      setUnread((c) => Math.max(0, c - 1));
    } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      // Covers both db.notifications and db.broadcast_inbox in one call.
      await api.post('/inbox/all/read');
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
      setPersonalUnread(0);
    } catch {}
  }, []);

  const value: Ctx = { items, unread, personalUnread, loading, refresh, markRead, markAllRead };
  return <NotifCtx.Provider value={value}>{children}</NotifCtx.Provider>;
}

export function useNotifications() {
  return useContext(NotifCtx);
}
