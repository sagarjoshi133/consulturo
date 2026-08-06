/**
 * DR-fail-over banner — sticky strip shown across the top of the app
 * whenever the runtime has failed over from the primary backend to a
 * backup (see src/backend-health.ts).
 *
 * UX rationale: writes during fail-over land on the backup backend's
 * MongoDB which may not auto-sync back to production. Surfacing this
 * prominently so the user can choose to wait / re-check before
 * making important edits.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setOnFallback, isOnFallback, getActiveBase } from './backend-health';
import { COLORS, FONTS } from './theme';

export default function FallbackBanner() {
  const [on, setOn] = useState<boolean>(isOnFallback());
  const [base, setBase] = useState<string>(getActiveBase());

  useEffect(() => {
    setOnFallback((isOn, baseUrl) => {
      setOn(isOn);
      setBase(baseUrl);
    });
  }, []);

  if (!on) return null;

  // Show only host portion (no protocol / path) to keep the banner short.
  let host = base;
  try {
    host = new URL(base).host;
  } catch {}

  return (
    <View style={styles.bar} accessibilityRole="alert">
      <Ionicons name="warning" size={14} color="#7C2D12" style={{ marginRight: 6 }} />
      <Text style={styles.txt} numberOfLines={1}>
        Backup server in use ({host}). New data may not sync to your main account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FCD34D',
    paddingHorizontal: 12,
    paddingVertical: 6,
    ...(Platform.OS === 'web'
      ? ({
          position: 'sticky' as any,
          top: 0,
          zIndex: 999,
        } as any)
      : {}),
  },
  txt: {
    ...FONTS.body,
    fontSize: 11,
    color: '#7C2D12',
    fontWeight: '600',
    flexShrink: 1,
  },
});
