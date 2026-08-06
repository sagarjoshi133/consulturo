/*
 * AssistantBubble — Floating action button that opens the AI chatbot.
 *
 * NEW (2026-05-31): COLLAPSIBLE.
 *   • Default state: expanded full FAB (56-60 px).
 *   • Long-press OR right-side-handle tap: collapses to a tiny
 *     half-circle tab pinned flush with the right edge — only the
 *     sparkles icon peeks out, occupying ~28 px width.
 *   • Tap the tab → expands back.
 *   • Preference persisted in AsyncStorage so it stays put across
 *     app launches.
 *   • Animated transition between states.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import { COLORS, SHADOWS } from './theme';

const COLLAPSED_KEY = '@consulturo.assistant.bubble.collapsed';

type Props = {
  bottom?: number;
  right?: number;
  initialPulse?: boolean;
};

export default function AssistantBubble({ bottom = 24, right = 16, initialPulse = true }: Props) {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current; // 0 = expanded, 1 = collapsed

  /* ── Hydrate persisted collapse state ──────────── */
  useEffect(() => {
    AsyncStorage.getItem(COLLAPSED_KEY).then((v) => {
      const c = v === '1';
      setCollapsed(c);
      slide.setValue(c ? 1 : 0);
      setHydrated(true);
    }).catch(() => setHydrated(true));
  }, [slide]);

  /* ── Probe assistant availability ──────────────── */
  useEffect(() => {
    let cancelled = false;
    api.get('/assistant/health')
      .then((r) => { if (!cancelled) setAvailable(!!r.data?.configured); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  /* ── Pulse animation (only when expanded) ──────── */
  useEffect(() => {
    if (!initialPulse || collapsed) { pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
      { iterations: -1 },
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, initialPulse, collapsed]);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    Animated.timing(slide, {
      toValue: next ? 1 : 0,
      duration: 260,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
    AsyncStorage.setItem(COLLAPSED_KEY, next ? '1' : '0').catch(() => {});
  }, [collapsed, slide]);

  const openAssistant = useCallback(() => {
    router.push('/assistant' as any);
  }, [router]);

  if (available !== true || !hydrated) return null;

  const size = Platform.OS === 'web' ? 60 : 56;
  const collapsedWidth = 22;       // visible portion of the tab
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  // Slide translates the FAB to the right by (size - collapsedWidth)
  // when collapsed, leaving only the left edge poking out.
  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, size - collapsedWidth],
  });
  const fabScale = slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] });

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom, right }]}
      testID="assistant-bubble-wrap"
    >
      {/* Pulse ring — only shown while expanded */}
      {initialPulse && !collapsed ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              width: size, height: size, borderRadius: size / 2,
              transform: [{ scale: ringScale }], opacity: ringOpacity,
            },
          ]}
        />
      ) : null}

      <Animated.View
        style={{
          transform: [{ translateX }, { scale: fabScale }],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable
          onPress={collapsed ? toggleCollapsed : openAssistant}
          onLongPress={toggleCollapsed}
          delayLongPress={350}
          style={({ pressed }) => [
            styles.fab,
            { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.85 : 1 },
            collapsed && styles.fabCollapsed,
          ]}
          testID="assistant-bubble"
          accessibilityLabel={collapsed ? 'Expand AI assistant' : 'Open AI assistant'}
        >
          <Ionicons name="sparkles" size={size === 60 ? 26 : 24} color="#fff" />
        </Pressable>

        {/* Small "collapse" chevron on the LEFT edge of the FAB,
            only visible when expanded. Tapping collapses to the tab. */}
        {!collapsed ? (
          <TouchableOpacity
            onPress={toggleCollapsed}
            hitSlop={6}
            style={[styles.collapseHandle, { left: -8, top: size / 2 - 11 }]}
            testID="assistant-bubble-collapse"
            accessibilityLabel="Collapse assistant"
          >
            <Ionicons name="chevron-forward" size={13} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  fab: {
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    ...SHADOWS.pop,
  },
  fabCollapsed: {
    // Asymmetric corners when collapsed → half-pill on the LEFT edge,
    // flush square on the right (because it's tucked off-screen).
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  ring: {
    position: 'absolute',
    backgroundColor: COLORS.primary,
  },
  collapseHandle: {
    position: 'absolute',
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.primaryDark,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
  },
});
