// Simple, dependency-free toast / snackbar system.
//
// Usage:
//   wrap your root with <ToastProvider> (done in _layout.tsx),
//   then call:   const { success, error, info } = useToast();
//                success('Prescription saved');
//                error('Could not delete booking');
//
// Messages auto-dismiss after ~2.5s, stack neatly from the bottom
// (above the tab bar), and animate in/out.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, RADIUS } from './theme';

type ToastVariant = 'success' | 'error' | 'info';
type Toast = { id: string; message: string; variant: ToastVariant };

type ToastCtx = {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const Ctx = createContext<ToastCtx>({
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);

  const show = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = Math.random().toString(36).slice(2, 10);
    setQueue((q) => [...q, { id, message, variant }]);
    // Auto-dismiss after 2.6s.
    setTimeout(() => setQueue((q) => q.filter((t) => t.id !== id)), 2600);
  }, []);

  const value: ToastCtx = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport items={queue} />
    </Ctx.Provider>
  );
}

function ToastViewport({ items }: { items: Toast[] }) {
  const insets = useSafeAreaInsets();
  const bottomInset = insets.bottom || 0;
  // Sit comfortably above the bottom tab bar on mobile.
  const bottom = bottomInset + (Platform.OS === 'ios' ? 96 : 78);
  return (
    <View pointerEvents="box-none" style={[styles.viewport, { bottom }]}>
      {items.map((t, i) => (
        <ToastCard key={t.id} toast={t} index={i} total={items.length} />
      ))}
    </View>
  );
}

function ToastCard({ toast, index, total }: { toast: Toast; index: number; total: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]).start();
  }, []);

  const palette =
    toast.variant === 'success'
      ? { bg: COLORS.success, icon: 'checkmark-circle' as const }
      : toast.variant === 'error'
      ? { bg: COLORS.accent, icon: 'alert-circle' as const }
      : { bg: COLORS.primary, icon: 'information-circle' as const };

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: palette.bg,
          opacity,
          transform: [{ translateY }],
          // Most-recent toast sits on top, slightly overlapping older ones.
          marginTop: index === total - 1 ? 0 : 6,
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={palette.icon} size={18} color="#fff" />
      <Text style={styles.msg} numberOfLines={2}>{toast.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    marginHorizontal: 24,
    maxWidth: 520,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  msg: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14, flexShrink: 1 },
});
