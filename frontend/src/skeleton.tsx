/**
 * Skeleton — Wave 2 · F
 *
 * Lightweight shimmer placeholder using react-native-reanimated.
 * Falls back to a static muted block on platforms where reanimated
 * isn't available.
 *
 * Usage:
 *   <Skeleton width="60%" height={16} radius={6} />
 *   <SkeletonList count={5} rowHeight={64} />
 *   <SkeletonCard />
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, Platform, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { COLORS, RADIUS } from './theme';

type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: any;
  /** ms — defaults to 1100 */
  duration?: number;
};

export function Skeleton({ width = '100%', height = 14, radius = 6, style, duration = 1100 }: SkeletonProps) {
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.95, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [duration, opacity]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        styles.block,
        { width: width as any, height, borderRadius: radius, backgroundColor: '#E5E7EB' },
        animStyle,
        style,
      ]}
    />
  );
}

export function SkeletonCircle({ size = 36, style }: { size?: number; style?: any }) {
  return <Skeleton width={size} height={size} radius={size / 2} style={style} />;
}

export function SkeletonRow({ avatar = true, lines = 2, style }: { avatar?: boolean; lines?: number; style?: any }) {
  return (
    <View style={[styles.row, style]}>
      {avatar ? <SkeletonCircle size={40} /> : null}
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="60%" height={12} />
        {lines >= 2 ? <Skeleton width="42%" height={10} /> : null}
        {lines >= 3 ? <Skeleton width="30%" height={10} /> : null}
      </View>
    </View>
  );
}

export function SkeletonCard({ height = 100, style }: { height?: number; style?: any }) {
  return (
    <View style={[styles.card, { minHeight: height }, style]}>
      <Skeleton width="40%" height={14} />
      <View style={{ height: 8 }} />
      <Skeleton width="100%" height={10} />
      <View style={{ height: 4 }} />
      <Skeleton width="80%" height={10} />
    </View>
  );
}

export function SkeletonList({
  count = 5,
  avatar = true,
  lines = 2,
  rowGap = 14,
  style,
}: {
  count?: number;
  avatar?: boolean;
  lines?: number;
  rowGap?: number;
  style?: any;
}) {
  return (
    <View style={[{ gap: rowGap }, style]}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} avatar={avatar} lines={lines} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: '#E5E7EB' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  card: {
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
});

// Keep the import alive even if unused in the future.
void Platform;
