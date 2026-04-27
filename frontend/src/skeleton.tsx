/**
 * Lightweight skeleton placeholder primitives built on react-native-reanimated.
 *
 * Usage:
 *   <Skeleton w={160} h={20} />
 *   <Skeleton w="80%" h={14} br={4} style={{ marginTop: 8 }} />
 *   <SkeletonRow lines={3} />
 *
 * Designed to mimic the dimensions of the real content the screen will
 * eventually render, so the layout doesn't shift when data loads.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet, ViewStyle, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  cancelAnimation,
} from 'react-native-reanimated';
import { COLORS } from './theme';

type Props = {
  w?: DimensionValue;
  h?: DimensionValue;
  /** Border radius — rounded corners default to 6 to match cards */
  br?: number;
  /** Inline override style */
  style?: ViewStyle | ViewStyle[];
  /** Test hook (defaults to "skeleton") so automation can count placeholders */
  testID?: string;
};

export function Skeleton({ w = '100%', h = 14, br = 6, style, testID = 'skeleton' }: Props) {
  // 0 → 1 loop, mapped to 0.4 → 1 → 0.4 opacity for a subtle pulse.
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.45, 0.95]),
  }));

  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={[
        styles.base,
        { width: w as any, height: h as any, borderRadius: br },
        animatedStyle,
        style as any,
      ]}
    />
  );
}

/** Convenience: a stack of N text-line skeletons of varying widths. */
export function SkeletonRow({
  lines = 2,
  spacing = 8,
  style,
}: {
  lines?: number;
  spacing?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const widths = ['90%', '78%', '85%', '60%', '70%'];
  return (
    <View style={style as any}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          h={12}
          w={widths[i % widths.length] as DimensionValue}
          style={{ marginTop: i === 0 ? 0 : spacing }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
});

export default Skeleton;
