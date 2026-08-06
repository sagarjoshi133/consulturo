/**
 * EmptyState — Wave 2 · G
 *
 * Friendly empty-state component for lists/screens. Replaces the
 * "blank screen" experience throughout the app.
 *
 * Usage:
 *   <EmptyState icon="calendar-outline" title="No bookings yet"
 *               subtitle="Tap + to schedule one."
 *               actionLabel="New booking" onAction={...} />
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';

type Props = {
  icon?: any;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tone?: 'default' | 'success' | 'warn';
  style?: any;
  testID?: string;
};

export function EmptyState({
  icon = 'document-outline',
  title,
  subtitle,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  tone = 'default',
  style,
  testID,
}: Props) {
  const palette =
    tone === 'success'
      ? { iconBg: '#ECFDF5', iconColor: '#059669' }
      : tone === 'warn'
        ? { iconBg: '#FEF3C7', iconColor: '#D97706' }
        : { iconBg: COLORS.primary + '14', iconColor: COLORS.primary };

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={[styles.iconCircle, { backgroundColor: palette.iconBg }]}>
        <Ionicons name={icon} size={32} color={palette.iconColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {(actionLabel || secondaryLabel) && (
        <View style={styles.btnRow}>
          {actionLabel ? (
            <TouchableOpacity onPress={onAction} style={[styles.btn, styles.btnPrimary]} testID={`${testID || 'empty'}-action`}>
              <Text style={styles.btnPrimaryText}>{actionLabel}</Text>
            </TouchableOpacity>
          ) : null}
          {secondaryLabel ? (
            <TouchableOpacity onPress={onSecondary} style={[styles.btn, styles.btnGhost]} testID={`${testID || 'empty'}-secondary`}>
              <Text style={styles.btnGhostText}>{secondaryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    paddingVertical: 40,
    gap: 8,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    ...FONTS.bodyMedium,
    color: COLORS.textPrimary,
    fontSize: 15,
    textAlign: 'center',
  },
  subtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 340,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    minWidth: 120,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary },
  btnGhostText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
});
