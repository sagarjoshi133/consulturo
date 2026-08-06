import React, { ReactNode, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from './theme';

export const HERO_HEADER_MAX = 280;
// Base min — actual min will be this + top safe-area inset so the
// collapsed header has room for the status bar + top bar contents.
export const HERO_HEADER_MIN = 64;

/**
 * useCollapsibleHeader — returns an animated scroll handler + a set of
 * interpolations (header height, hero opacity, compact-title opacity, image
 * opacity, translateY) that you plug into a CollapsibleHero and an
 * Animated.ScrollView.
 */
export function useCollapsibleHeader(
  maxHeight: number = HERO_HEADER_MAX,
  minHeight: number = HERO_HEADER_MIN,
) {
  const insets = useSafeAreaInsets();
  // Effective min-height must accommodate the top safe-area (status bar /
  // notch) so the compact back button + title never get clipped. Without
  // this, devices with a larger status bar (Android + cutouts) render the
  // collapsed header overlapping the status bar or cutting off the title.
  const effectiveMin = minHeight + insets.top;
  const scrollY = useRef(new Animated.Value(0)).current;
  const range = maxHeight - effectiveMin;

  const headerHeight = scrollY.interpolate({
    inputRange: [0, range],
    outputRange: [maxHeight, effectiveMin],
    extrapolate: 'clamp',
  });
  const heroOpacity = scrollY.interpolate({
    inputRange: [0, range * 0.6, range],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });
  const heroTranslate = scrollY.interpolate({
    inputRange: [0, range],
    outputRange: [0, -40],
    extrapolate: 'clamp',
  });
  const compactOpacity = scrollY.interpolate({
    inputRange: [0, range * 0.6, range],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const imgOpacity = scrollY.interpolate({
    inputRange: [0, range],
    outputRange: [0.45, 0.1],
    extrapolate: 'clamp',
  });

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false },
  );

  return {
    scrollY,
    onScroll,
    headerHeight,
    heroOpacity,
    heroTranslate,
    compactOpacity,
    imgOpacity,
    maxHeight,
    minHeight: effectiveMin,
  };
}

export type CollapsibleHeroProps = {
  onBack: () => void;
  title: string;
  backgroundImage?: string | null;
  children: ReactNode;
  headerHeight: Animated.AnimatedInterpolation<number>;
  heroOpacity: Animated.AnimatedInterpolation<number>;
  heroTranslate: Animated.AnimatedInterpolation<number>;
  compactOpacity: Animated.AnimatedInterpolation<number>;
  imgOpacity: Animated.AnimatedInterpolation<number>;
  testID?: string;
  rightAction?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Optional small avatar shown next to the collapsed title */
  compactAvatarUrl?: string | null;
};

export function CollapsibleHero({
  onBack,
  title,
  backgroundImage,
  children,
  headerHeight,
  heroOpacity,
  heroTranslate,
  compactOpacity,
  imgOpacity,
  testID = 'collapsible-back',
  rightAction,
  style,
  compactAvatarUrl,
}: CollapsibleHeroProps) {
  return (
    <Animated.View style={[styles.wrap, { height: headerHeight }, style]} pointerEvents="box-none">
      {/* Background gradient */}
      <LinearGradient
        colors={COLORS.heroGradient as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Background image */}
      {!!backgroundImage && (
        <Animated.Image
          source={{ uri: backgroundImage }}
          style={[StyleSheet.absoluteFill, { opacity: imgOpacity }]}
          resizeMode="cover"
        />
      )}
      {/* Dark overlay for legibility */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0, 85, 97, 0.45)' }]} />

      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Always-visible top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onBack} style={styles.backBtn} testID={testID}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Animated.View style={[styles.compactRow, { opacity: compactOpacity }]}>
            {!!compactAvatarUrl && (
              <Image source={{ uri: compactAvatarUrl }} style={styles.compactAvatar} />
            )}
            <Animated.Text style={styles.compactTitle} numberOfLines={1}>
              {title}
            </Animated.Text>
          </Animated.View>
          <View style={rightAction ? { minWidth: 40, alignItems: 'flex-end' } : { width: 40 }}>{rightAction}</View>
        </View>

        {/* Expanded hero content (collapses on scroll) */}
        <Animated.View
          style={[
            styles.hero,
            {
              opacity: heroOpacity,
              transform: [{ translateY: heroTranslate }],
            },
          ]}
          pointerEvents="box-none"
        >
          {children}
        </Animated.View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    zIndex: 10,
    ...Platform.select({
      web: {
        // Ensure header stays above web-rendered children
        boxShadow: '0 4px 14px rgba(0,0,0,0.08)' as any,
      },
      default: {
        elevation: 6,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
      },
    }),
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 8,
  },
  compactAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  compactTitle: {
    ...FONTS.h4,
    color: '#fff',
    fontSize: 16,
    flexShrink: 1,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 18,
  },
});
