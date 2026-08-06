/**
 * Diagnostic — Last-crash log.
 *
 * Shows recent JS bundle restarts (proxy for native crashes) along
 * with the route the user was on when the bundle reloaded. This
 * gives the developer a fast way to ask the user "which screen do
 * you see crash most?" without needing logcat or any external tool.
 *
 * Entries are written by `_layout.tsx` when it detects a fresh
 * lastRoute on cold-start (see src/last-route.ts).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { COLORS, FONTS, RADIUS } from '../src/theme';
import { readCrashLog, clearCrashLog, type CrashLogEntry } from '../src/last-route';

function formatTs(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function AdminCrashLog() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [entries, setEntries] = useState<CrashLogEntry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const e = await readCrashLog();
    setEntries(e);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onClear = useCallback(() => {
    const proceed = async () => {
      await clearCrashLog();
      await load();
    };
    // Alert.alert with 3-button confirm doesn't render on React Native
    // Web — fall back to the native browser confirm so the delete
    // action works in the desktop preview too.
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert, no-undef
      const ok = typeof window !== 'undefined' && window.confirm
        ? window.confirm('Clear crash log? This removes the diagnostic history of bundle restarts on this device.')
        : true;
      if (ok) void proceed();
      return;
    }
    Alert.alert(
      'Clear crash log?',
      'This removes the diagnostic history of bundle restarts on this device. Useful before reproducing a fresh crash.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => { void proceed(); },
        },
      ],
    );
  }, [load]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
          style={styles.headerBtn}
          testID="crash-log-back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>App stability log</Text>
        <TouchableOpacity
          onPress={onClear}
          style={styles.headerBtn}
          testID="crash-log-clear"
        >
          <Ionicons name="trash-outline" size={20} color="#A02020" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
          />
        }
      >
        <View style={styles.helpCard}>
          <Ionicons name="information-circle" size={18} color={COLORS.primary} />
          <Text style={styles.helpText}>
            This log records when the app's JS bundle reloaded after a
            native crash, and the screen you were on. Share this list
            with support if a particular screen keeps crashing.
          </Text>
        </View>

        {entries === null ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="shield-checkmark" size={28} color={COLORS.success} />
            <Text style={styles.emptyTitle}>No crashes recorded</Text>
            <Text style={styles.emptyBody}>
              The app has not had a native bundle restart on this
              device. Pull down to refresh.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {entries.map((e, idx) => (
              <View key={`${e.ts}-${idx}`} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="warning" size={18} color="#A02020" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {e.fromPath || '(unknown screen)'}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {relTime(e.ts)} · {formatTs(e.ts)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16, flex: 1, textAlign: 'center' },
  helpCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    backgroundColor: COLORS.primary + '12',
    borderRadius: RADIUS.md,
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  helpText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1, lineHeight: 18 },
  emptyCard: {
    padding: 24,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  emptyTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  emptyBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderLeftWidth: 3,
    borderLeftColor: '#A02020',
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFE9E9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  rowMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  center: { padding: 24, alignItems: 'center' },
});
