/**
 * TenantSwitcher — the "Viewing as: <Clinic> ▾" pill.
 *
 * Behavior:
 *  • Hidden if the user has 0 or 1 clinic AND is not super_owner —
 *    there's nothing to switch between.
 *  • Tap → bottom-sheet modal (slides up) with the full list, role
 *    badge per row, and an "All clinics" entry for super_owner.
 *  • Selecting a clinic persists it via TenantContext + AsyncStorage
 *    and triggers a light haptic tick.
 */
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ALL_CLINICS_ID, useTenant } from './tenant-context';

type Variant = 'compact' | 'block';

interface Props {
  /** `compact` = pill in the dashboard header. `block` = full-width
   *  card in the More tab on mobile. */
  variant?: Variant;
  /** Color tokens — wired through so the switcher matches host theme. */
  primaryColor?: string;
  textColor?: string;
  bgColor?: string;
  borderColor?: string;
}

// Per-role chip color (subtle backgrounds, readable foreground).
const ROLE_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  primary_owner: { bg: '#0F4C7515', fg: '#0F4C75', label: 'Owner' },
  partner: { bg: '#1FA1B71A', fg: '#0E6F80', label: 'Partner' },
  doctor: { bg: '#7B3FB51A', fg: '#5C2C99', label: 'Doctor' },
  assistant: { bg: '#FFAA001A', fg: '#9A6500', label: 'Assistant' },
  reception: { bg: '#1A2E351A', fg: '#1A2E35', label: 'Reception' },
  nursing: { bg: '#C0392B1A', fg: '#9B2A1F', label: 'Nursing' },
};

export default function TenantSwitcher({
  variant = 'compact',
  primaryColor = '#0F4C75',
  textColor = '#1A2E35',
  bgColor = '#FFFFFF',
  borderColor = '#E5EAF0',
}: Props) {
  const {
    clinics,
    currentClinicId,
    currentClinic,
    isAllClinicsView,
    isSuperOwner,
    setCurrentClinicId,
  } = useTenant();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  // Hide if the user has only one option to choose from.
  const showSwitcher = clinics.length > 1 || (isSuperOwner && clinics.length >= 1);

  const labelText = useMemo(() => {
    if (isAllClinicsView) return 'All Clinics';
    return currentClinic?.name || 'Select clinic';
  }, [isAllClinicsView, currentClinic]);

  const labelTagline = isAllClinicsView
    ? 'Platform-wide view'
    : currentClinic?.tagline || '';

  if (!showSwitcher) return null;

  const onPick = async (id: string) => {
    setOpen(false);
    try {
      Haptics.selectionAsync();
    } catch {
      /* noop on web */
    }
    await setCurrentClinicId(id);
  };

  const onOpen = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      /* noop on web */
    }
    setOpen(true);
  };

  // Split list so super_owner's "All Clinics" sits in its own section.
  const allEntry = clinics.find((c) => c.clinic_id === ALL_CLINICS_ID);
  const realClinics = clinics.filter((c) => c.clinic_id !== ALL_CLINICS_ID);

  // ── Trigger pill ────────────────────────────────────────────────────
  const Trigger = (
    <Pressable
      onPress={onOpen}
      android_ripple={{ color: '#0F4C7522' }}
      style={({ pressed }) => [
        variant === 'compact' ? styles.pill : styles.block,
        { backgroundColor: bgColor, borderColor },
        pressed && Platform.OS === 'ios' ? { opacity: 0.7 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Viewing as ${labelText}. Tap to switch clinic.`}
    >
      <View
        style={[
          styles.pillIcon,
          {
            backgroundColor: isAllClinicsView ? primaryColor + '15' : '#1FA1B71A',
            width: variant === 'compact' ? 22 : 32,
            height: variant === 'compact' ? 22 : 32,
            borderRadius: variant === 'compact' ? 11 : 16,
          },
        ]}
      >
        <Feather
          name={isAllClinicsView ? 'globe' : 'briefcase'}
          size={variant === 'compact' ? 12 : 16}
          color={primaryColor}
        />
      </View>
      <View style={{ flex: variant === 'compact' ? 0 : 1, minWidth: 0, marginLeft: 8 }}>
        {variant === 'compact' ? (
          <Text
            numberOfLines={1}
            style={[styles.pillText, { color: textColor }]}
          >
            <Text style={{ color: '#7A8A98', fontWeight: '600' }}>
              Viewing as{' '}
            </Text>
            <Text style={{ color: textColor, fontWeight: '700' }}>
              {labelText}
            </Text>
          </Text>
        ) : (
          <>
            <Text style={{ color: '#7A8A98', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
              VIEWING AS
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: textColor, fontSize: 16, fontWeight: '700', marginTop: 2 }}
            >
              {labelText}
            </Text>
            {labelTagline ? (
              <Text
                numberOfLines={1}
                style={{ color: '#7A8A98', fontSize: 12, marginTop: 1 }}
              >
                {labelTagline}
              </Text>
            ) : null}
          </>
        )}
      </View>
      <Feather
        name="chevron-down"
        size={variant === 'compact' ? 14 : 18}
        color={primaryColor}
        style={{ marginLeft: 6 }}
      />
    </Pressable>
  );

  // ── Modal sheet ─────────────────────────────────────────────────────
  return (
    <>
      {Trigger}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.sheet,
              {
                backgroundColor: bgColor,
                paddingBottom: 18 + (insets.bottom || 0),
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: textColor }]}>
                Switch clinic
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={12}
                style={styles.closeBtn}
              >
                <Feather name="x" size={18} color="#7A8A98" />
              </Pressable>
            </View>
            <Text style={styles.sheetSub}>
              You'll only see data for the clinic you pick. Switch any time.
            </Text>
            <ScrollView
              style={{ maxHeight: Dimensions.get('window').height * 0.6 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 6 }}
            >
              {/* Super_owner "All Clinics" sticky header row */}
              {allEntry && (
                <>
                  <ClinicRow
                    clinic={allEntry}
                    active={allEntry.clinic_id === currentClinicId}
                    primaryColor={primaryColor}
                    textColor={textColor}
                    borderColor={borderColor}
                    onPick={onPick}
                  />
                  <View style={styles.divider}>
                    <View style={[styles.dividerLine, { backgroundColor: borderColor }]} />
                    <Text style={styles.dividerText}>YOUR CLINICS</Text>
                    <View style={[styles.dividerLine, { backgroundColor: borderColor }]} />
                  </View>
                </>
              )}
              {realClinics.map((c) => (
                <ClinicRow
                  key={c.clinic_id}
                  clinic={c}
                  active={c.clinic_id === currentClinicId}
                  primaryColor={primaryColor}
                  textColor={textColor}
                  borderColor={borderColor}
                  onPick={onPick}
                />
              ))}
              {realClinics.length === 0 && !allEntry && (
                <Text style={{ color: '#7A8A98', textAlign: 'center', padding: 20 }}>
                  No clinics yet. Ask your owner for an invitation.
                </Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── Single row in the bottom-sheet ────────────────────────────────────
function ClinicRow({
  clinic,
  active,
  primaryColor,
  textColor,
  borderColor,
  onPick,
}: {
  clinic: any;
  active: boolean;
  primaryColor: string;
  textColor: string;
  borderColor: string;
  onPick: (id: string) => void;
}) {
  const isAll = clinic.clinic_id === ALL_CLINICS_ID;
  const role = clinic.role as string | undefined;
  const tone = role ? ROLE_TONES[role] : undefined;

  return (
    <Pressable
      onPress={() => onPick(clinic.clinic_id)}
      android_ripple={{ color: '#0F4C7522' }}
      style={({ pressed }) => [
        styles.row,
        { borderColor },
        active && {
          borderColor: primaryColor,
          backgroundColor: '#0F4C7510',
          shadowColor: primaryColor,
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 2,
        },
        pressed && Platform.OS === 'ios' ? { opacity: 0.6 } : null,
      ]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: isAll ? '#0F4C75' : '#1FA1B7' },
        ]}
      >
        <Feather
          name={isAll ? 'globe' : 'briefcase'}
          size={16}
          color="#fff"
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ color: textColor, fontWeight: '700', fontSize: 15 }}
        >
          {clinic.name}
        </Text>
        {!!clinic.tagline && (
          <Text
            numberOfLines={1}
            style={{ color: '#7A8A98', fontSize: 12, marginTop: 1 }}
          >
            {clinic.tagline}
          </Text>
        )}
      </View>
      {tone && !isAll ? (
        <View style={[styles.roleChip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.roleChipText, { color: tone.fg }]}>
            {tone.label}
          </Text>
        </View>
      ) : null}
      {active && (
        <Feather
          name="check-circle"
          size={20}
          color={primaryColor}
          style={{ marginLeft: 8 }}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    minHeight: 36,
    maxWidth: 280,
  },
  pillText: { fontSize: 13 },
  pillIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#00000055',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: 18,
    paddingTop: 8,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: -4 },
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D7DCE3',
    alignSelf: 'center',
    marginVertical: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sheetTitle: { fontSize: 19, fontWeight: '800' },
  sheetSub: { fontSize: 13, color: '#7A8A98', marginTop: 4, marginBottom: 14 },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F1F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  roleChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 8,
  },
  roleChipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 4,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#7A8A98',
    marginHorizontal: 10,
  },
});
