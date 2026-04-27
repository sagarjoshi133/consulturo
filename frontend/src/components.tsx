import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, RADIUS, FONTS } from './theme';
import { haptics } from './haptics';

export function PrimaryButton({
  title,
  onPress,
  testID,
  disabled,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        haptics.medium();
        onPress();
      }}
      disabled={disabled}
      testID={testID}
      style={[{ borderRadius: RADIUS.pill, overflow: 'hidden' }, style, disabled && { opacity: 0.5 }]}
    >
      <LinearGradient
        colors={COLORS.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.btn}
      >
        {icon}
        <Text style={styles.btnText}>{title}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  title,
  onPress,
  testID,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      testID={testID}
      style={[styles.secondary, style]}
    >
      {icon}
      <Text style={styles.secondaryText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 8,
  },
  btnText: {
    color: '#fff',
    ...FONTS.h4,
    fontFamily: 'Manrope_700Bold',
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  secondaryText: {
    color: COLORS.primary,
    ...FONTS.h4,
    fontFamily: 'Manrope_700Bold',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0E7C8B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
});
