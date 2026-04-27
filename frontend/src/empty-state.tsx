// Reusable, lightweight empty-state card used across list panels.
// Shows an icon, a headline, optional body, and an optional CTA button.

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  style?: ViewStyle;
  compact?: boolean;
  testID?: string;
};

export function EmptyState({
  icon = 'document-text-outline',
  title,
  subtitle,
  ctaLabel,
  onCta,
  secondaryLabel,
  onSecondary,
  style,
  compact,
  testID,
}: Props) {
  // Subtle fade + rise entrance animation so empty states feel polished
  // rather than suddenly "popping" in.
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.timing(translateY, { toValue: 0, duration: 320, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[styles.wrap, compact && styles.compactWrap, { opacity, transform: [{ translateY }] }, style]}
      testID={testID}
    >
      <View style={[styles.iconBg, compact && styles.iconBgCompact]}>
        <Ionicons name={icon} size={compact ? 32 : 44} color={COLORS.primary} />
      </View>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.sub, compact && styles.subCompact]}>{subtitle}</Text>
      ) : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity onPress={onCta} style={styles.cta} activeOpacity={0.85} testID={`${testID || 'empty'}-cta`}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
      {secondaryLabel && onSecondary ? (
        <TouchableOpacity onPress={onSecondary} style={styles.secondary} activeOpacity={0.7}>
          <Text style={styles.secondaryText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 28,
  },
  compactWrap: { paddingVertical: 24 },
  iconBg: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconBgCompact: { width: 60, height: 60, borderRadius: 30, marginBottom: 10 },
  title: {
    ...FONTS.h3,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  titleCompact: { ...FONTS.h4, textAlign: 'center' },
  sub: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
    maxWidth: 320,
  },
  subCompact: { ...FONTS.body, textAlign: 'center', marginTop: 4 },
  cta: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
  },
  ctaText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 15 },
  secondary: { marginTop: 10, padding: 8 },
  secondaryText: { ...FONTS.bodyMedium, color: COLORS.primary },
});
