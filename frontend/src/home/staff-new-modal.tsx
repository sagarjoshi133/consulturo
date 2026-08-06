/**
 * StaffNewModal — Bottom-sheet style action picker triggered by the
 * centre "+" FAB in the bottom tab bar (staff role only).
 *
 * Offers the four most-used "create" flows on a clinic day:
 *   • New Booking      → /(tabs)/book
 *   • New Prescription → /dashboard?tab=prescriptions
 *   • New Note         → /notes
 *   • New Surgery log  → /dashboard?tab=surgeries
 *
 * Implemented as a plain Modal + animated overlay (no third-party
 * bottom-sheet library) so it works identically on iOS / Android /
 * web with zero added dependencies.
 */
import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Action = {
  label: string;
  sub?: string;
  icon: string;
  iconLib?: 'ion' | 'mci';
  color: string;
  route: string;
  testID: string;
};

const ACTIONS: Action[] = [
  {
    label: 'New Booking',
    sub: 'Add a slot for a new or repeat patient',
    icon: 'calendar-plus',
    iconLib: 'mci',
    color: '#0E7C8B',
    route: '/(tabs)/book',
    testID: 'new-action-booking',
  },
  {
    label: 'New Prescription',
    sub: 'Compose & print Rx',
    icon: 'document-text',
    color: '#0EA5E9',
    route: '/dashboard?tab=prescriptions',
    testID: 'new-action-rx',
  },
  {
    label: 'New Note',
    sub: 'Personal or clinical scratchpad',
    icon: 'create',
    color: '#8B5CF6',
    route: '/notes',
    testID: 'new-action-note',
  },
  {
    label: 'Log Surgery',
    sub: 'Record a procedure',
    icon: 'medical',
    color: '#16A34A',
    route: '/dashboard?tab=surgeries',
    testID: 'new-action-surgery',
  },
];

export default function StaffNewModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(400)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          stiffness: 200,
          damping: 20,
          mass: 0.6,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 400,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, opacity]);

  const handlePress = (route: string) => {
    onClose();
    // Slight delay so the close animation can play before navigating
    // (avoids a jarring instant route change on the same frame).
    setTimeout(() => router.push(route as any), 120);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>Create new</Text>
        <Text style={styles.subtitle}>Quick actions for your day</Text>
        <View style={{ height: 12 }} />
        {ACTIONS.map((a) => {
          const I: any = a.iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;
          return (
            <TouchableOpacity
              key={a.label}
              style={styles.row}
              activeOpacity={0.85}
              onPress={() => handlePress(a.route)}
              testID={a.testID}
            >
              <View style={[styles.rowIcon, { backgroundColor: a.color + '1F' }]}>
                <I name={a.icon as any} size={22} color={a.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{a.label}</Text>
                {!!a.sub && <Text style={styles.rowSub}>{a.sub}</Text>}
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={onClose} style={styles.cancelBtn} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    ...FONTS.h3,
    fontSize: 18,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowLabel: {
    ...FONTS.body,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  rowSub: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  cancelText: {
    ...FONTS.body,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});
