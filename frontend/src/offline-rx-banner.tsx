/**
 * OfflineRxBanner — shows when Rx items are queued for upload.
 * Auto-runs the queue on connectivity-return events.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONTS, RADIUS } from './theme';
import { runRxQueue, useOfflineRxQueueCount } from './offline-rx-queue';

export default function OfflineRxBanner() {
  const count = useOfflineRxQueueCount();

  // Auto-flush on mount + when count changes (e.g. just added).
  useEffect(() => {
    if (count > 0) void runRxQueue();
  }, [count]);

  // Browser online event → retry.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const fn = () => { void runRxQueue(); };
    window.addEventListener('online', fn);
    return () => window.removeEventListener('online', fn);
  }, []);

  // Periodic retry every 60 s while there are queued items.
  useEffect(() => {
    if (count === 0) return;
    const id = setInterval(() => { void runRxQueue(); }, 60_000);
    return () => clearInterval(id);
  }, [count]);

  if (count === 0) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline" size={16} color="#F59E0B" />
      <Text style={styles.text}>
        {count} prescription{count === 1 ? '' : 's'} waiting to upload
      </Text>
      <TouchableOpacity onPress={() => void runRxQueue()} style={styles.btn} testID="offline-rx-retry">
        <Text style={styles.btnText}>Retry now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: '#FEF3C7', borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#FCD34D',
  },
  text: { ...FONTS.bodyMedium, color: '#78350F', fontSize: 12, flex: 1 },
  btn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: '#F59E0B' },
  btnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 11 },
});
