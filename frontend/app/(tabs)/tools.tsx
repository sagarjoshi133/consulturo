import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';
import { useAuth } from '../../src/auth';
import StaffPatientDb from '../../src/home/staff-patient-db';
import { PatientContextBanner } from '../../src/calc-shared';
import { useScreenBg } from '../../src/dark-mode';

const STAFF_ROLES = new Set(['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing']);

// Ordered list as requested by Dr. Joshi. `id` maps to locales.tools.items.*
const TOOLS = [
  { id: 'ipss', icon: 'clipboard-text', color: '#0E7C8B', route: '/ipss' },
  { id: 'pv', icon: 'cube-outline', color: '#0A5E6B', route: '/calculators/prostate-volume' },
  { id: 'psa', icon: 'water-percent', color: '#E53935', route: '/calculators/psa' },
  { id: 'bd', icon: 'notebook-outline', color: '#2563EB', route: '/calculators/bladder-diary' },
  { id: 'iief5', icon: 'heart-pulse', color: '#DB2777', route: '/calculators/iief5' },
  { id: 'stone', icon: 'diamond-stone', color: '#CA8A04', route: '/calculators/stone-risk' },
  { id: 'bmi', icon: 'scale-bathroom', color: '#6D28D9', route: '/calculators/bmi' },
  { id: 'creat', icon: 'test-tube', color: '#9333EA', route: '/calculators/creatinine' },
  { id: 'crcl', icon: 'kettle-steam', color: '#B45309', route: '/calculators/crcl' },
  { id: 'egfr', icon: 'speedometer', color: '#16A6B8', route: '/calculators/egfr' },
];

export default function Tools() {
  const __darkBg = useScreenBg();
  const router = useRouter();
  const { t } = useI18n();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ patient_phone?: string; patient_name?: string }>();
  const patient_phone = params.patient_phone || '';
  const patient_name = params.patient_name || '';
  // Role-aware swap: staff see the Patients lookup here (the bottom
  // tab labels this slot "Patients" for staff). Patients keep the
  // urology calculators.
  // EXCEPTION: if a patient context is set (?patient_phone=…), staff
  // are running the calculators FOR a specific patient — so show the
  // calculator grid instead of the patient list.
  if (user && STAFF_ROLES.has(user.role as string) && !patient_phone) {
    return <StaffPatientDb />;
  }

  const buildHref = (route: string) => {
    if (!patient_phone && !patient_name) return route;
    const sep = route.includes('?') ? '&' : '?';
    const qp = new URLSearchParams();
    if (patient_phone) qp.set('patient_phone', patient_phone);
    if (patient_name) qp.set('patient_name', patient_name);
    return `${route}${sep}${qp.toString()}`;
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: __darkBg }}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('tools.title')}</Text>
          <Text style={styles.subtitle}>{t('tools.subtitle')}</Text>
        </View>
        <LanguageDropdown testID="tools-lang" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 100 }}>
        <PatientContextBanner patient_name={patient_name} patient_phone={patient_phone} testID="tools-patient-banner" />
        <Text style={styles.counter}>{t('tools.countLabel', { n: TOOLS.length })}</Text>

        <View style={styles.grid}>
          {TOOLS.map((tool) => {
            const name = t(`tools.items.${tool.id}.name`);
            const full = t(`tools.items.${tool.id}.full`);
            return (
              <TouchableOpacity
                key={tool.id}
                onPress={() => router.push(buildHref(tool.route) as any)}
                activeOpacity={0.85}
                style={styles.card}
                testID={`tool-${tool.id}`}
              >
                <View style={[styles.iconBg, { backgroundColor: tool.color + '18' }]}>
                  <MaterialCommunityIcons name={tool.icon as any} size={24} color={tool.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{name}</Text>
                  <Text style={styles.cardFull} numberOfLines={2}>{full}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 22, lineHeight: 28 },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, lineHeight: 18, marginTop: 2, fontSize: 13 },
  counter: { ...FONTS.label, color: COLORS.primary, marginBottom: 14 },
  grid: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 70,
  },
  iconBg: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardName: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  cardFull: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
