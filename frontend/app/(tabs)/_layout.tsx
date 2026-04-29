import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Animated,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import { haptics } from '../../src/haptics';
import { useResponsive } from '../../src/responsive';
import { useThemeColors } from '../../src/theme-context';
import type { ThemeColors } from '../../src/theme-presets';

/**
 * ConsultUro — Premium custom bottom tab bar.
 *
 * Design language:
 *   • Clean white bar with a soft top shadow (feels elevated, not stuck).
 *   • Every tab shows icon + label — labels are always visible (the key
 *     complaint in earlier revisions). Labels sit on a shared baseline so
 *     they visually align across all 5 tabs.
 *   • Active state uses three coordinated cues:
 *       1. A 3px rounded pill indicator above the icon (top-bar style).
 *       2. The icon swaps to the FILLED variant and tints to primary.
 *       3. The label becomes bold + primary colored.
 *       4. Subtle pop animation (scale 0.96→1.0) on press.
 *   • The centre "Book" tab is a FAB that floats 22px above the bar in a
 *     primary gradient circle with a white ring — a hero call-to-action
 *     without stealing the shared label baseline.
 *
 * Zero hardcoded bottom padding — we only honour iOS's home-indicator
 * inset. Android (with or without gesture nav) gets labels pressed as
 * HIGH as possible in the bar so nothing ever clips.
 */

type IconFamily = 'ion' | 'mci';

type TabDef = {
  label: string;
  iconFilled: string;
  iconOutline: string;
  family: IconFamily;
  isFab?: boolean;
};

function IconFor({
  family,
  name,
  size,
  color,
}: {
  family: IconFamily;
  name: string;
  size: number;
  color: string;
}) {
  if (family === 'mci') {
    return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
  }
  return <Ionicons name={name as any} size={size} color={color} />;
}

function TabItem({
  def,
  isFocused,
  onPress,
  onLongPress,
  testID,
  theme,
}: {
  def: TabDef;
  isFocused: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
  theme: ThemeColors;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={styles.tabSlot}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      testID={testID}
      hitSlop={6}
    >
      <Animated.View style={[styles.tabInner, { transform: [{ scale }] }]}>
        {/* active indicator bar above the icon */}
        <View style={styles.indicatorTrack}>
          {isFocused && <View style={[styles.indicatorPill, { backgroundColor: theme.primary }]} />}
        </View>
        <View style={styles.iconWrap}>
          <IconFor
            family={def.family}
            name={isFocused ? def.iconFilled : def.iconOutline}
            size={24}
            color={isFocused ? theme.primary : '#8A9BA3'}
          />
        </View>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.tabLabel, isFocused && [styles.tabLabelActive, { color: theme.primary }]]}
        >
          {def.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function FabItem({
  def,
  isFocused,
  onPress,
  testID,
  theme,
}: {
  def: TabDef;
  isFocused: boolean;
  onPress: () => void;
  testID?: string;
  theme: ThemeColors;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 10 }).start();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={styles.fabSlot}
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      testID={testID}
    >
      <Animated.View style={[styles.fabAnim, { transform: [{ scale }] }]}>
        <View style={[styles.fabHalo, { shadowColor: theme.primary }]}>
          <LinearGradient
            colors={[theme.primaryLight, theme.primary, theme.primaryDark]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.fabCircle}
          >
            <Ionicons name="calendar" size={26} color="#fff" />
          </LinearGradient>
        </View>
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.fabLabel, isFocused && [styles.fabLabelActive, { color: theme.primary }]]}
        >
          {def.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const theme = useThemeColors();
  // Hide the bottom tab bar on desktop web — the WebShell sidebar
  // already provides navigation. The tabs would compete for space and
  // look out-of-place on a wide desktop monitor.
  const r = useResponsive();
  if (r.isWebDesktop) return null;
  // Only iOS reserves bottom room for the home-indicator. On Android we
  // keep labels flush high — zero bottom padding as the user requested.
  // Respect the OS bottom safe-area inset on BOTH iOS AND Android so the
  // tab bar never falls under the system navigation buttons / gesture pill.
  // On Android with edge-to-edge enabled (Expo default), this returns the
  // soft-navigation bar height. On devices without a nav bar the inset is
  // 0 — we add a small minimum so labels don't hug the screen edge.
  const rawInset = insets.bottom || 0;
  const minFloor = Platform.OS === 'android' ? 6 : 0;
  const bottomInset = Math.max(rawInset, minFloor);

  // Hide the tab bar while the keyboard is visible (Android esp.) so it
  // doesn't float over text inputs.
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);
  React.useEffect(() => {
    const s1 = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setKeyboardOpen(true)
    );
    const s2 = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setKeyboardOpen(false)
    );
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);
  if (keyboardOpen) return null;

  const TABS: Record<string, TabDef> = {
    index: {
      label: t('tabs.home'),
      iconFilled: 'home',
      iconOutline: 'home-outline',
      family: 'ion',
    },
    diseases: {
      label: t('tabs.diseases'),
      iconFilled: 'medkit',
      iconOutline: 'medkit-outline',
      family: 'ion',
    },
    book: {
      label: t('tabs.book'),
      iconFilled: 'calendar',
      iconOutline: 'calendar-outline',
      family: 'ion',
      isFab: true,
    },
    tools: {
      label: t('tabs.tools'),
      iconFilled: 'calculator-variant',
      iconOutline: 'calculator-variant-outline',
      family: 'mci',
    },
    more: {
      label: t('tabs.more'),
      iconFilled: 'apps',
      iconOutline: 'apps-outline',
      family: 'ion',
    },
  };

  return (
    <View style={[styles.container, { paddingBottom: bottomInset }]}>
      {/* Hairline border + soft shadow bar */}
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const def = TABS[route.name];
          if (!def) return null;
          const isFocused = state.index === index;

          const onPress = () => {
            const ev = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !ev.defaultPrevented) {
              haptics.select();
              navigation.navigate(route.name as never);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          if (def.isFab) {
            return (
              <FabItem
                key={route.key}
                def={def}
                isFocused={isFocused}
                onPress={onPress}
                testID={`tab-${route.name}`}
                theme={theme}
              />
            );
          }

          return (
            <TabItem
              key={route.key}
              def={def}
              isFocused={isFocused}
              onPress={onPress}
              onLongPress={onLongPress}
              testID={`tab-${route.name}`}
              theme={theme}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="diseases" options={{ title: t('tabs.diseases') }} />
      <Tabs.Screen name="book" options={{ title: t('tabs.book') }} />
      <Tabs.Screen name="tools" options={{ title: t('tabs.tools') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more') }} />
    </Tabs>
  );
}

const BAR_HEIGHT = 64;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2EDEF',
    // Elevation / shadow that lifts the bar off the page
    shadowColor: '#0A5E6B',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 24,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: BAR_HEIGHT,
    overflow: 'visible',
  },

  // ----- regular tab -----
  tabSlot: {
    flex: 1,
    overflow: 'visible',
  },
  tabInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  indicatorTrack: {
    height: 4,
    marginBottom: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicatorPill: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.primary,
  },
  iconWrap: {
    width: 44,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    marginTop: 2,
    fontFamily: 'DMSans_500Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#8A9BA3',
    includeFontPadding: false,
    textAlign: 'center',
  },
  tabLabelActive: {
    fontFamily: 'DMSans_700Bold',
    color: COLORS.primary,
  },

  // ----- center FAB (Book) -----
  fabSlot: {
    flex: 1,
    overflow: 'visible',
    alignItems: 'center',
  },
  fabAnim: {
    flex: 1,
    alignItems: 'center',
    overflow: 'visible',
  },
  fabHalo: {
    // White ring around the gradient circle — creates a "cut-out" effect
    // above the bar edge, very premium look.
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 14,
  },
  fabCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabLabel: {
    marginTop: 4,
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    lineHeight: 14,
    color: '#8A9BA3',
    includeFontPadding: false,
    textAlign: 'center',
  },
  fabLabelActive: {
    color: COLORS.primary,
  },
});
