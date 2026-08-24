/**
 * <UpdatedHint> — a subtle "Updated just now / 3 min ago" line that
 * tells staff how fresh the currently-shown (cached) data is.
 *
 * Pairs with the tab-cache (src/data-cache.ts): screens render their
 * cached data instantly and refresh in the background, so this line
 * reassures the user the numbers aren't stale. It self-updates every
 * 30s so "just now" ages into "1 min ago" without a manual refresh.
 */
import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { COLORS, FONTS } from './theme';

export function timeAgo(ts: number): string {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 1) return 'just now';
  if (m === 1) return '1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return '1 hr ago';
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function UpdatedHint({ at, style }: { at: number; style?: StyleProp<TextStyle> }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!at) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [at]);
  if (!at) return null;
  return (
    <Text style={[styles.hint, style]} testID="updated-hint">
      Updated {timeAgo(at)}
    </Text>
  );
}

const styles = StyleSheet.create({
  hint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11 },
});
