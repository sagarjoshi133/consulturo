/**
 * TenantSwitcher — the "Viewing as: <Clinic> ▾" pill.
 *
 * Behavior:
 *  • Hidden if the user has 0 or 1 clinic AND is not super_owner —
 *    there's nothing to switch between.
 *  • Tap → bottom-sheet modal with the full list. Selecting a clinic
 *    persists it via TenantContext + AsyncStorage.
 *  • super_owner sees an additional "All Clinics" entry at the top,
 *    which sets currentClinicId=null so the backend returns un-scoped
 *    data.
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

  // Hide if the user has only one option to choose from.
  const showSwitcher = clinics.length > 1 || (isSuperOwner && clinics.length >= 1);
  if (!showSwitcher) return null;

  const labelText = useMemo(() => {
    if (isAllClinicsView) return 'All Clinics';
    return currentClinic?.name || 'Select clinic';
  }, [isAllClinicsView, currentClinic]);

  const labelTagline = isAllClinicsView
    ? 'Platform-wide view'
    : currentClinic?.tagline || '';

  const onPick = async (id: string) => {
    setOpen(false);
    await setCurrentClinicId(id);
  };

  // ── Trigger pill ────────────────────────────────────────────────────
  const Trigger = (
    <Pressable
      onPress={() => setOpen(true)}
      android_ripple={{ color: '#0F4C7522' }}
      style={({ pressed }) => [
        variant === 'compact' ? styles.pill : styles.block,
        { backgroundColor: bgColor, borderColor },
        pressed && Platform.OS === 'ios' ? { opacity: 0.7 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Viewing as ${labelText}. Tap to switch clinic.`}
    >
      <Feather
        name="briefcase"
        size={variant === 'compact' ? 14 : 18}
        color={primaryColor}
        style={{ marginRight: 8 }}
      />
      <View style={{ flex: variant === 'compact' ? 0 : 1, minWidth: 0 }}>
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
            <Text style={{ color: '#7A8A98', fontSize: 11, fontWeight: '700' }}>
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
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: bgColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.handle} />
            <Text style={[styles.sheetTitle, { color: textColor }]}>
              Switch clinic
            </Text>
            <Text style={styles.sheetSub}>
              You'll only see data for the clinic you pick. Switch any time.
            </Text>
            <ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.6 }}>
              {clinics.map((c) => {
                const active = c.clinic_id === currentClinicId;
                const isAll = c.clinic_id === ALL_CLINICS_ID;
                return (
                  <Pressable
                    key={c.clinic_id}
                    onPress={() => onPick(c.clinic_id)}
                    android_ripple={{ color: '#0F4C7522' }}
                    style={({ pressed }) => [
                      styles.row,
                      { borderColor },
                      active && {
                        borderColor: primaryColor,
                        backgroundColor: '#0F4C7510',
                      },
                      pressed && Platform.OS === 'ios' ? { opacity: 0.6 } : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.avatar,
                        {
                          backgroundColor: isAll ? '#0F4C75' : '#1FA1B7',
                        },
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
                        {c.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={{ color: '#7A8A98', fontSize: 12, marginTop: 1 }}
                      >
                        {c.tagline ||
                          (c.role
                            ? `Role: ${c.role.replace('_', ' ')}`
                            : '')}
                      </Text>
                    </View>
                    {active && (
                      <Feather name="check-circle" size={18} color={primaryColor} />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 36,
    maxWidth: 280,
  },
  pillText: { fontSize: 13 },
  block: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'flex-end',
  },
  sheet: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 32,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D7DCE3',
    alignSelf: 'center',
    marginVertical: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  sheetSub: { fontSize: 13, color: '#7A8A98', marginTop: 4, marginBottom: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
});
