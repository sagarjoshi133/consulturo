import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToolHistory } from '../../src/tool-history';
import { ToolHistoryList, SaveScoreButton } from '../../src/tool-history-ui';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

export default function BmiCalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [kg, setKg] = useState('');
  const [cm, setCm] = useState('');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('bmi');

  const bmi = useMemo(() => {
    const w = parseFloat(kg);
    const h = parseFloat(cm) / 100;
    if (!w || !h) return null;
    return Number((w / (h * h)).toFixed(1));
  }, [kg, cm]);

  const cat = (v: number) => {
    if (v < 18.5) return { label: t('calc.bmi.categories.under'), color: COLORS.warning };
    if (v < 25) return { label: t('calc.bmi.categories.normal'), color: COLORS.success };
    if (v < 30) return { label: t('calc.bmi.categories.over'), color: COLORS.warning };
    return { label: t('calc.bmi.categories.obese'), color: COLORS.accent };
  };

  const handleSave = async () => {
    if (!bmi) return;
    await saveScore(bmi, `${bmi} kg/m² · ${cat(bmi).label}`, { weight_kg: parseFloat(kg), height_cm: parseFloat(cm) });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.bmi.title')}</Text>
        <LanguageDropdown testID="bmi-lang" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.label}>{t('calc.bmi.weight')}</Text>
        <TextInput value={kg} onChangeText={setKg} keyboardType="decimal-pad" style={styles.input} placeholder="72" placeholderTextColor={COLORS.textDisabled} testID="bmi-weight" />
        <Text style={styles.label}>{t('calc.bmi.height')}</Text>
        <TextInput value={cm} onChangeText={setCm} keyboardType="decimal-pad" style={styles.input} placeholder="172" placeholderTextColor={COLORS.textDisabled} testID="bmi-height" />

        {bmi && (
          <View style={styles.result}>
            <Text style={styles.resultLbl}>{t('calc.bmi.your')}</Text>
            <Text style={styles.resultNum}>{bmi}</Text>
            <Text style={styles.resultUnit}>kg/m²</Text>
            <Text style={[styles.resultTag, { color: cat(bmi).color }]}>{cat(bmi).label}</Text>
          </View>
        )}

        {bmi && <SaveScoreButton onPress={handleSave} saving={saving} />}

        <Text style={styles.histHdr}>{t('calc.history')}</Text>
        <ToolHistoryList history={history} loading={loading} onDelete={removeScore} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1, fontSize: 20 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12 },
  histHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 6, ...FONTS.body, color: COLORS.textPrimary },
  result: { backgroundColor: '#E8F7F8', borderRadius: RADIUS.md, padding: 20, marginTop: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary },
  resultLbl: { ...FONTS.label, color: COLORS.primary, marginBottom: 4 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 56 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary },
  resultTag: { ...FONTS.bodyMedium, marginTop: 8 },
});
