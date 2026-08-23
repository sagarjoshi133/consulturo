/**
 * Comm V2 — Home Notice Ticker.
 *
 * Placement:
 *   - Below safe-area/header, above primary home actions.
 *   - NEVER overlaps the Android status bar (parent wraps in SafeAreaView).
 *
 * Behaviour:
 *   - Fetches /v2/communications/home-notices/active on mount + focus
 *     + app foreground. Falls back to last-cached response on network
 *     error (spec-compliant offline behaviour).
 *   - If multiple notices, rotate every ~6s (urgency > style > newest).
 *   - Tap pauses rotation and opens the validated action (if any).
 *   - Respects Reduce Motion: falls back to static wrapped text.
 *   - Dismissible notices show an "×" button; urgent may be non-dismissible.
 *
 * Style-to-colour mapping is intentionally muted so the banner reads
 * as a "clinic notice" rather than a warning toast.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../api';

type Notice = {
  id: string;
  message: string;
  audience_scope: 'patients' | 'staff' | 'both';
  notice_style: 'information' | 'warning' | 'urgent' | 'success';
  is_dismissible: boolean;
  action_type?: string | null;
  action_target?: string | null;
};

const CACHE_KEY = 'comm_v2_home_notices_cache_v1';

const STYLE_COLORS: Record<Notice['notice_style'], { bg: string; fg: string; accent: string }> = {
  information: { bg: '#EEF4F6', fg: '#0E3A45', accent: '#0E7C8B' },
  success:     { bg: '#E9F7EE', fg: '#0F3D22', accent: '#128A47' },
  warning:     { bg: '#FFF4E1', fg: '#5A3A05', accent: '#B26A00' },
  urgent:      { bg: '#FDE8E8', fg: '#5A1616', accent: '#C0362C' },
};

type Props = {
  /** Optional deep-link handler. Called with (action_type, action_target). */
  onAction?: (actionType: string, target: string | null) => void;
};

export function HomeNoticeTicker({ onAction }: Props) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [paused, setPaused] = useState(false);
  const rotationTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/v2/communications/home-notices/active');
      const items = (r?.data?.items || []) as Notice[];
      setNotices(items);
      try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch {}
    } catch {
      // Offline / not yet enabled — fall back to cache if any.
      try {
        const cached = await AsyncStorage.getItem(CACHE_KEY);
        if (cached) setNotices(JSON.parse(cached) as Notice[]);
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Foreground refresh — cheapest possible signal.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') load();
    });
    // Periodic 5-minute refresh.
    const t = setInterval(() => load(), 5 * 60_000);
    return () => { sub.remove(); clearInterval(t); };
  }, [load]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => setReduceMotion(!!v)).catch(() => {});
    const listener = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      (v) => setReduceMotion(!!v),
    );
    return () => { try { (listener as any)?.remove?.(); } catch {} };
  }, []);

  // Rotation
  useEffect(() => {
    if (rotationTimer.current) { clearInterval(rotationTimer.current); rotationTimer.current = null; }
    if (paused || reduceMotion || notices.length < 2) return;
    rotationTimer.current = setInterval(() => {
      setIdx((i) => (i + 1) % Math.max(1, notices.length));
    }, 6000);
    return () => {
      if (rotationTimer.current) { clearInterval(rotationTimer.current); rotationTimer.current = null; }
    };
  }, [notices.length, paused, reduceMotion]);

  // Reset index if list shrinks.
  useEffect(() => {
    if (idx >= notices.length) setIdx(0);
  }, [notices.length, idx]);

  if (loading && !notices.length) return null;
  if (!notices.length) return null;

  const current = notices[idx] || notices[0];
  const palette = STYLE_COLORS[current.notice_style];

  const handlePress = () => {
    setPaused(true);
    if (current.action_type && current.action_type !== 'none') {
      try { onAction?.(current.action_type, current.action_target || null); } catch {}
    }
    // Un-pause after 8s so the ticker resumes rotation.
    setTimeout(() => setPaused(false), 8000);
  };

  const handleDismiss = async () => {
    if (!current.is_dismissible) return;
    // Optimistically remove from local list.
    setNotices((cur) => cur.filter((n) => n.id !== current.id));
    try {
      await api.post(`/v2/communications/home-notices/${encodeURIComponent(current.id)}/dismiss`);
    } catch {
      // If dismiss failed, we'll pick it up again on next refresh.
    }
  };

  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${current.notice_style} clinic notice: ${current.message}`}
      style={[styles.container, { backgroundColor: palette.bg }]}
    >
      <View style={[styles.stripe, { backgroundColor: palette.accent }]} />
      <Pressable
        style={styles.pressArea}
        onPress={handlePress}
        onPressIn={() => setPaused(true)}
        onPressOut={() => setTimeout(() => setPaused(false), 4000)}
      >
        <Text
          numberOfLines={reduceMotion ? 3 : 2}
          style={[styles.text, { color: palette.fg }]}
        >
          {current.message}
        </Text>
      </Pressable>

      {/* Dismiss button (only if dismissible) */}
      {current.is_dismissible ? (
        <Pressable
          onPress={handleDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notice"
          style={styles.dismiss}
        >
          <Text style={[styles.dismissX, { color: palette.accent }]}>×</Text>
        </Pressable>
      ) : null}

      {/* Rotation dots (only if >1 notice) */}
      {notices.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {notices.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === idx ? palette.accent : palette.accent + '40',
                  width: i === idx ? 10 : 6,
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 14,
    minHeight: 48,
    paddingRight: 40,
    overflow: 'hidden',
  },
  stripe: {
    width: 4,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  pressArea: {
    flex: 1,
    paddingVertical: 10,
    paddingRight: 8,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  dismiss: {
    position: 'absolute',
    top: 4,
    right: 6,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissX: {
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '700',
  },
  dots: {
    position: 'absolute',
    right: 12,
    bottom: 6,
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    height: 4,
    borderRadius: 2,
  },
});
