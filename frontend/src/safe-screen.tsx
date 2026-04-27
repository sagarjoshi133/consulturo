/**
 * SafeScreen — the one wrapper every screen should use.
 *
 * Solves these recurring bugs in ONE place so new screens can't regress:
 *   • Content overlapping the status bar / notch / camera cut-out
 *   • Bottom action bars colliding with Android gesture nav / iOS home indicator
 *   • Form inputs being hidden behind the on-screen keyboard
 *   • Inconsistent scroll container padding
 *
 * Usage (simplest):
 *
 *   <SafeScreen>
 *     <Text>Hello</Text>
 *   </SafeScreen>
 *
 * Usage (scrollable screens with an optional footer bar):
 *
 *   <SafeScreen scroll footer={<PrimaryButton .../>}>
 *     {form fields}
 *   </SafeScreen>
 *
 * Footer receives automatic bottom-inset padding so buttons never sit
 * on top of the Android gesture bar or home indicator.
 *
 * Pair with `useBottomSafePadding()` when you need the value for
 * ScrollView contentContainerStyle on screens that don't use <SafeScreen>.
 */
import React from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ViewStyle,
  StyleProp,
  ScrollViewProps,
  StatusBar as RNStatusBar,
  StatusBarStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from './theme';

export type SafeScreenProps = {
  children: React.ReactNode;
  /** Wrap content in a ScrollView automatically (recommended for most screens). */
  scroll?: boolean;
  /** Optional footer bar (e.g. action buttons) that's pinned to the bottom
   *  and automatically gets safe-area bottom padding. */
  footer?: React.ReactNode;
  /** Background color. Defaults to the theme bg. */
  bg?: string;
  /** StatusBar style — defaults to 'dark' for our light theme. */
  statusBarStyle?: StatusBarStyle;
  /** Which edges of the device to respect. Default = all. */
  edges?: Edge[];
  /** Additional content container padding (in addition to horizontal default). */
  contentPadding?: number;
  /** When `scroll`, extra padding at the bottom of the scroll content. */
  extraBottom?: number;
  /** Use KeyboardAvoidingView. Default: true on iOS, false on Android
   *  (Android's adjustResize handles it natively and can fight us). */
  avoidKeyboard?: boolean;
  /** Pass through to ScrollView (ref, refreshControl, onScroll, etc.) */
  scrollProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle'>;
  /** Style for the outermost View. */
  style?: StyleProp<ViewStyle>;
  /** Style for the content wrapper (inside ScrollView if enabled). */
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export default function SafeScreen({
  children,
  scroll = false,
  footer,
  bg = COLORS.bg,
  statusBarStyle = 'dark',
  edges,
  contentPadding,
  extraBottom = 0,
  avoidKeyboard,
  scrollProps,
  style,
  contentStyle,
  testID,
}: SafeScreenProps) {
  const insets = useSafeAreaInsets();

  // Decide keyboard avoidance default per platform
  const shouldAvoid = typeof avoidKeyboard === 'boolean' ? avoidKeyboard : Platform.OS === 'ios';

  // Android status bar needs top padding when translucent; SafeAreaView
  // handles this through `edges` (default includes 'top').
  const safeEdges: Edge[] = edges || ['top', 'left', 'right'];

  const paddingBottom = Math.max(
    insets.bottom,
    Platform.OS === 'android' ? 8 : 0, // Small minimum for Android gesture bar
  );

  const content = (
    <>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            {
              paddingHorizontal: contentPadding ?? 0,
              paddingBottom: (footer ? 16 : paddingBottom) + extraBottom,
              flexGrow: 1,
            },
            contentStyle,
          ]}
          {...scrollProps}
        >
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            {
              flex: 1,
              paddingHorizontal: contentPadding ?? 0,
              paddingBottom: footer ? 0 : paddingBottom,
            },
            contentStyle,
          ]}
        >
          {children}
        </View>
      )}

      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingBottom: Math.max(paddingBottom, 10),
              backgroundColor: bg,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView
      edges={safeEdges}
      style={[{ flex: 1, backgroundColor: bg }, style]}
      testID={testID}
    >
      <StatusBar style={statusBarStyle} backgroundColor={bg} translucent={false} />
      {shouldAvoid ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

/**
 * Return `paddingBottom` value a ScrollView's content container should
 * use to clear the Android gesture bar / iOS home indicator.
 */
export function useBottomSafePadding(extra = 0) {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 0) + extra;
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: Platform.OS === 'android' ? 0 : StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
});

// Re-export so screens don't need to import from two places
export { SafeAreaView, useSafeAreaInsets };
// Hint linter that RNStatusBar is intentionally imported for Android platform checks in future
void RNStatusBar;
