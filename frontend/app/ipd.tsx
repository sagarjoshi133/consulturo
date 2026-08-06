/**
 * /ipd — Top-level IPD module entry point.
 *
 * Wrapped in <SafeScreen> so:
 *   • Status bar / notch padded automatically
 *   • Android gesture pill / iOS home indicator cleared from the
 *     bottom of the scrollable content
 *   • On-screen keyboard never hides focused IPD form inputs
 *     (uses softwareKeyboardLayoutMode=resize on Android +
 *      KeyboardAvoidingView + automaticallyAdjustKeyboardInsets on iOS).
 *
 * The actual IPD UI lives in <IPDPanel> and is also embedded inside
 * the dashboard. Access is gated by <PermissionGate require="can_manage_ipd">;
 * owners + dashboard_full_access pass through automatically.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import IPDPanel from '../src/ipd-panel-lazy';
import PermissionGate from '../src/permission-gate';
import SafeScreen from '../src/safe-screen';
import { COLORS, FONTS } from '../src/theme';

export default function IpdScreen() {
  return (
    <PermissionGate
      require="can_manage_ipd"
      title="IPD"
      message="Ask the owner to enable 'Can manage IPD' for your account in Team → Edit member."
    >
      <IpdInner />
    </PermissionGate>
  );
}

function IpdInner() {
  const router = useRouter();
  return (
    <SafeScreen scroll contentPadding={12} extraBottom={16}>
      <View style={styles.bar}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
          style={styles.back}
          hitSlop={10}
          testID="ipd-back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>IPD</Text>
          <Text style={styles.sub}>Admissions, beds & discharge summaries</Text>
        </View>
      </View>
      <View style={{ paddingTop: 12 }}>
        <IPDPanel />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    marginHorizontal: -12, // bleed outside SafeScreen's contentPadding
  },
  back: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center',
  },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 17 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
});
