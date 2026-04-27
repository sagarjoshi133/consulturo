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

export default function CrClCalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [age, setAge] = useState('');
  const [kg, setKg] = useState('');
  const [cr, setCr] = useState('');
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('crcl');

  const crcl = useMemo(() => {
    const a = parseFloat(age); const w = parseFloat(kg); const c = parseFloat(cr);
    if (!a || !w || !c) return null;
    const base = ((140 - a) * w) / (72 * c);
    const result = sex === 'F' ? base * 0.85 : base;
    return Number(result.toFixed(1));
  }, [age, kg, cr, sex]);

  const category = (v: number) => {
    if (v >= 90) return { label: t('calc.crcl.stages.normal'), color: COLORS.success };
    if (v >= 60) return { label: t('calc.crcl.stages.mild'), color: COLORS.warning };
    if (v >= 30) return { label: t('calc.crcl.stages.moderate'), color: COLORS.warning };
    if (v >= 15) return { label: t('calc.crcl.stages.severe'), color: COLORS.accent };
    return { label: t('calc.crcl.stages.failure'), color: COLORS.accent };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.crcl.title')}</Text>
        <LanguageDropdown testID="crcl-lang" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.subtitle}>{t('calc.crcl.subtitle')}</Text>
        <Text style={styles.label}>{t('calc.crcl.age')}</Text>
        <TextInput value={age} onChangeText={setAge} keyboardType="number-pad" style={styles.input} placeholder="60" placeholderTextColor={COLORS.textDisabled} testID="crcl-age" />
        <Text style={styles.label}>{t('calc.crcl.weight')}</Text>
        <TextInput value={kg} onChangeText={setKg} keyboardType="decimal-pad" style={styles.input} placeholder="72" placeholderTextColor={COLORS.textDisabled} testID="crcl-weight" />
        <Text style={styles.label}>{t('calc.crcl.creatinine')}</Text>
        <TextInput value={cr} onChangeText={setCr} keyboardType="decimal-pad" style={styles.input} placeholder="1.1" placeholderTextColor={COLORS.textDisabled} testID="crcl-creat" />
        <Text style={styles.label}>{t('calc.crcl.sex')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['M','F'] as const).map((s) => (
            <TouchableOpacity key={s} onPress={() => setSex(s)} style={[styles.sexBtn, sex === s && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} testID={`crcl-sex-${s}`}>
              <Text style={[styles.sexText, sex === s && { color: '#fff' }]}>{s === 'M' ? t('common.male') : t('common.female')}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {crcl && (
          <View style={styles.result}>
            <Text style={styles.resultNum}>{crcl}</Text>
            <Text style={styles.resultUnit}>mL/min</Text>
            <Text style={[styles.resultTag, { color: category(crcl).color }]}>{category(crcl).label}</Text>
            <SaveScoreButton onPress={() => saveScore(crcl, `${crcl} mL/min · ${category(crcl).label}`, { age: parseFloat(age), weight_kg: parseFloat(kg), creatinine: parseFloat(cr), sex })} saving={saving} />
          </View>
        )}
        <Text style={styles.info}>{t('calc.crcl.info')}</Text>
        <Text style={styles.histHdr}>{t('calc.history')}</Text>
        <ToolHistoryList history={history} loading={loading} onDelete={removeScore} />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1, fontSize: 20 },
  histHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 16 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, fontSize: 15 },
  sexBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  sexText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  result: { backgroundColor: '#fff', padding: 18, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginTop: 20 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 46 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary },
  resultTag: { ...FONTS.h4, marginTop: 8, textAlign: 'center' },
  info: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 16, fontSize: 12, lineHeight: 18 },
});
