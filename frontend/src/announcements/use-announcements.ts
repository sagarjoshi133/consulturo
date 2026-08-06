/**
 * useAnnouncements — fetches owner-curated banners for a given
 * audience+placement. Honours device-local dismissals so a patient
 * who taps ✕ doesn't see the same banner again on next launch.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';
import type { Announcement, AnnouncementAudience, AnnouncementPlacement } from './types';

const DISMISS_KEY = 'announcements.dismissed.v1';

async function getDismissed(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(DISMISS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

async function setDismissed(ids: string[]): Promise<void> {
  try { await AsyncStorage.setItem(DISMISS_KEY, JSON.stringify(ids)); } catch {}
}

export function useAnnouncements({
  audience, placement, slug,
}: {
  audience: AnnouncementAudience;
  placement: AnnouncementPlacement;
  slug?: string;
}) {
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissed, setDismissedState] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { audience, placement };
      if (slug) params.slug = slug;
      const r = await api.get('/announcements', { params });
      setItems((r.data?.items || []) as Announcement[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [audience, placement, slug]);

  useEffect(() => {
    (async () => {
      setDismissedState(await getDismissed());
      await load();
    })();
  }, [load]);

  const dismiss = useCallback(async (id: string) => {
    const next = Array.from(new Set([...dismissed, id]));
    setDismissedState(next);
    await setDismissed(next);
  }, [dismissed]);

  const visible = items.filter((a) => !dismissed.includes(a.id));
  return { items: visible, all: items, dismissed, dismiss, loading, reload: load };
}
