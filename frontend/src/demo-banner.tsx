/**
 * DemoBanner — persistent yellow strip shown on every screen for
 * accounts flagged with `is_demo: true` on the backend.
 *
 * Demo accounts are read-only — every backend WRITE returns a 403
 * with body "Demo mode — actions are disabled in this preview
 * account." The banner explains this to the user so they understand
 * why their submits are no-ops.
 *
 * Mounted in `_layout.tsx` so it lives above the navigator and
 * always sits at the top of the viewport.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from './auth';

export function DemoBanner() {
  const { user } = useAuth();
  const isDemo = !!(user as any)?.is_demo;
  if (!user || !isDemo) return null;

  return (
    <View style={styles.bar} pointerEvents="none" testID="demo-banner">
      <Ionicons name="film" size={14} color="#7C2D12" />
      <Text style={styles.text}>
        DEMO MODE · Changes are not saved
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
    ...Platform.select({
      web: { position: 'sticky' as any, top: 0, zIndex: 1000 },
      default: {},
    }),
  },
  text: {
    color: '#7C2D12',
    fontSize: 11,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.4,
  },
});
