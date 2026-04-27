// Global offline banner. Listens to NetInfo and slides a soft amber
// notice down from the top of the screen whenever connectivity drops.
// Auto-dismisses ~2 seconds after reconnection so users get positive
// feedback that they're back online.

import React from 'react';
import { View, Text, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS } from './theme';
import { useI18n } from './i18n';

type Status = 'online' | 'offline' | 'reconnected';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [status, setStatus] = React.useState<Status>('online');
  const translateY = React.useRef(new Animated.Value(-80)).current;
  const reconnectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const handle = (s: NetInfoState) => {
      const offline = s.isConnected === false || s.isInternetReachable === false;
      setStatus((prev) => {
        if (offline) {
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current);
            reconnectTimer.current = null;
          }
          return 'offline';
        }
        if (prev === 'offline') {
          // We just came back online — flash a green "Back online" for 2s.
          if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(() => setStatus('online'), 2200);
          return 'reconnected';
        }
        return 'online';
      });
    };
    const unsub = NetInfo.addEventListener(handle);
    // Fetch initial state once
    NetInfo.fetch().then(handle).catch(() => {});
    return () => {
      unsub();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  React.useEffect(() => {
    const toValue = status === 'online' ? -120 : 0;
    Animated.timing(translateY, {
      toValue,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [status, translateY]);

  if (status === 'online') {
    // Still render the animated container so it can slide back out next time
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.wrap,
          { paddingTop: insets.top + 8, transform: [{ translateY }] },
        ]}
      />
    );
  }

  const isReconnected = status === 'reconnected';

  // Trilingual copy with safe EN fallback so the banner is always readable
  const offlineLabel =
    t('offline.offline') === 'offline.offline'
      ? "You're offline — changes will sync later."
      : t('offline.offline');
  const reconnectLabel =
    t('offline.reconnected') === 'offline.reconnected'
      ? 'Back online'
      : t('offline.reconnected');

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingTop: insets.top + 8, transform: [{ translateY }] },
      ]}
    >
      <View
        style={[
          styles.pill,
          isReconnected
            ? { backgroundColor: '#E7F7EE', borderColor: '#7CC79E' }
            : { backgroundColor: '#FFF6E2', borderColor: '#E3B25A' },
        ]}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
      >
        <Ionicons
          name={isReconnected ? 'cloud-done' : 'cloud-offline'}
          size={16}
          color={isReconnected ? '#1F7A4D' : '#8A5A00'}
        />
        <Text
          numberOfLines={2}
          style={[
            styles.text,
            { color: isReconnected ? '#1F7A4D' : '#8A5A00' },
          ]}
        >
          {isReconnected ? reconnectLabel : offlineLabel}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 9999,
    // iOS needs elevation-like shadow for stacking above content
    ...Platform.select({
      android: { elevation: 20 },
      default: {},
    }),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 560,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  text: {
    ...FONTS.bodyMedium,
    fontSize: 13,
    flexShrink: 1,
  },
});

// Tiny hook if anywhere in the app wants to conditionally disable a button
// while offline.
export function useIsOffline(): boolean {
  const [offline, setOffline] = React.useState(false);
  React.useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => {
      setOffline(s.isConnected === false || s.isInternetReachable === false);
    });
    return () => unsub();
  }, []);
  return offline;
}
