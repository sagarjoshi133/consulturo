/**
 * Global ErrorBoundary — catches React render / lifecycle errors anywhere
 * beneath it and shows a graceful recovery screen instead of blowing up
 * to the native OS and making the app look like it "crashed back to
 * homepage".
 *
 * Previously the app had no boundary, so ANY unhandled render error in
 * deep trees (dashboard widgets, branding panel, team panel, broadcasts,
 * etc.) would unmount the entire Stack navigator and the user would find
 * themselves dumped at the root / "Home" tab — commonly reported as:
 *   "Sudden app crashes. App repeatedly falls back to homepage,
 *    especially when using dashboard."
 *
 * Features:
 *   • Catches errors in render, lifecycle, and constructors below it.
 *   • Reports to Sentry (via captureError) — noisy in dev, grouped in prod.
 *   • Offers a "Try again" button that resets the boundary, re-rendering
 *     the subtree fresh.
 *   • Offers a "Back to Home" escape hatch that unmounts the failing
 *     screen without wiping the auth state.
 *   • Purely client-side; no server dependency, works completely offline.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import { captureError } from './sentry';

type State = {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
  resetKey: number;
};

type Props = {
  children: React.ReactNode;
  /** Optional: called when user presses "Back to Home" so the parent
   *  can route away from the failing tree. */
  onEscape?: () => void;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    try {
      // eslint-disable-next-line no-console
      console.error('[AppErrorBoundary] caught render error:', error, errorInfo?.componentStack);
    } catch {}
    try {
      captureError(error, {
        scope: 'app-error-boundary',
        component_stack: errorInfo?.componentStack,
      });
    } catch {}
    this.setState({ errorInfo });
  }

  private reset = () => {
    // Bumping resetKey forces React to remount children with a fresh
    // subtree, clearing any stale hooks / state that triggered the error.
    this.setState((s) => ({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
      resetKey: s.resetKey + 1,
    }));
  };

  private escape = () => {
    this.reset();
    try { this.props.onEscape?.(); } catch {}
  };

  render() {
    if (this.state.hasError) {
      const message =
        this.state.error?.message ||
        String(this.state.error) ||
        'An unexpected error occurred.';
      return (
        <View style={styles.root}>
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="warning" size={32} color="#FF6B6B" />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.subtitle} numberOfLines={3}>
              The screen ran into a problem. Your data is safe — you can
              retry or head back to the Home tab.
            </Text>
            {__DEV__ && (
              <ScrollView
                style={styles.devScroll}
                contentContainerStyle={{ padding: 10 }}
              >
                <Text style={styles.devMsg}>{message}</Text>
                {this.state.errorInfo?.componentStack ? (
                  <Text style={styles.devStack}>
                    {this.state.errorInfo.componentStack}
                  </Text>
                ) : null}
              </ScrollView>
            )}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={this.reset}
                testID="error-boundary-retry"
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.btnPrimaryText}>Try again</Text>
              </TouchableOpacity>
              {this.props.onEscape ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={this.escape}
                  testID="error-boundary-escape"
                >
                  <Ionicons name="home" size={16} color={COLORS.primary} />
                  <Text style={styles.btnSecondaryText}>Back to Home</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      );
    }

    // Pass the resetKey via React.key so a reset truly remounts children.
    return (
      <React.Fragment key={this.state.resetKey}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFE5E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18, textAlign: 'center' },
  subtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  devScroll: {
    maxHeight: 180,
    width: '100%',
    marginTop: 14,
    backgroundColor: '#FFF4F4',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: '#FFD5D5',
  },
  devMsg: {
    ...FONTS.body,
    color: '#A02020',
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
  devStack: {
    ...FONTS.body,
    color: '#666',
    fontSize: 10,
    marginTop: 8,
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' }),
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    minWidth: 130,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  btnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  btnSecondaryText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 14 },
});
