/**
 * Shared helpers for all Urology Calculators.
 *
 * - useCalcPatientContext(): reads `patient_phone` & `patient_name`
 *   from URL params so calculators opened from a Patient Profile keep
 *   the patient context.
 * - <PatientContextBanner>: top-of-screen pill showing "For patient X"
 *   that staff can tap to clear the context.
 * - <CopyResultButton>: copies a one-line summary to the clipboard.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from './theme';

export type CalcPatientContext = {
  patient_phone?: string;
  patient_name?: string;
};

export function useCalcPatientContext(): CalcPatientContext {
  const params = useLocalSearchParams<{
    patient_phone?: string;
    patient_name?: string;
  }>();
  return {
    patient_phone: params.patient_phone || undefined,
    patient_name: params.patient_name || undefined,
  };
}

export function PatientContextBanner({
  patient_name,
  patient_phone,
  testID,
}: {
  patient_name?: string;
  patient_phone?: string;
  testID?: string;
}) {
  const router = useRouter();
  if (!patient_name && !patient_phone) return null;
  return (
    <View style={styles.banner} testID={testID || 'calc-patient-banner'}>
      <Ionicons name="person-circle" size={18} color={COLORS.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerHead}>Running calculator for</Text>
        <Text style={styles.bannerName} numberOfLines={1}>
          {patient_name || patient_phone}
          {patient_name && patient_phone ? `  ·  ${patient_phone}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => router.setParams({ patient_phone: '', patient_name: '' } as any)}
        style={styles.bannerClose}
        hitSlop={10}
        testID="calc-patient-clear"
      >
        <Ionicons name="close" size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

export function CopyResultButton({
  text,
  testID,
  label = 'Copy result',
}: {
  text: string;
  testID?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }, [text]);
  return (
    <TouchableOpacity
      onPress={onCopy}
      style={[styles.copyBtn, copied && styles.copyBtnDone]}
      testID={testID || 'calc-copy-btn'}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={16}
        color={copied ? COLORS.success : COLORS.primary}
      />
      <Text style={[styles.copyText, copied && { color: COLORS.success }]}>
        {copied ? 'Copied!' : label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.primary + '10',
    borderColor: COLORS.primary + '30',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  bannerHead: { ...FONTS.label, color: COLORS.primary, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  bannerName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginTop: 1 },
  bannerClose: { padding: 4 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary + '60',
    backgroundColor: COLORS.primary + '0A',
    marginTop: 10,
  },
  copyBtnDone: {
    backgroundColor: COLORS.success + '12',
    borderColor: COLORS.success + '60',
  },
  copyText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
});
