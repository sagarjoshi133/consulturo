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

export default function EgfrCalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [cr, setCr] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('egfr');

  const result = useMemo(() => {
    const c = parseFloat(cr);
    const a = parseInt(age, 10);
    if (!c || !a) return null;
    const k = sex === 'female' ? 0.7 : 0.9;
    const alpha = sex === 'female' ? -0.241 : -0.302;
    const minV = Math.min(c / k, 1);
    const maxV = Math.max(c / k, 1);
    const egfr = 142 * Math.pow(minV, alpha) * Math.pow(maxV, -1.2) * Math.pow(0.9938, a) * (sex === 'female' ? 1.012 : 1);
    return Math.round(egfr);
  }, [cr, age, sex]);

  const stage = (v: number) => {
    if (v >= 90) return { label: t('calc.egfr.stages.g1'), color: COLORS.success };
    if (v >= 60) return { label: t('calc.egfr.stages.g2'), color: COLORS.success };
    if (v >= 45) return { label: t('calc.egfr.stages.g3a'), color: COLORS.warning };
    if (v >= 30) return { label: t('calc.egfr.stages.g3b'), color: COLORS.warning };
    if (v >= 15) return { label: t('calc.egfr.stages.g4'), color: COLORS.accent };
    return { label: t('calc.egfr.stages.g5'), color: COLORS.accent };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.egfr.title')}</Text>
        <LanguageDropdown testID="egfr-lang" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.sub}>{t('calc.egfr.subtitle')}</Text>
        <Text style={styles.label}>{t('calc.egfr.creatinine')}</Text>
        <TextInput
          value={cr}
          onChangeText={setCr}
          keyboardType="decimal-pad"
          style={styles.input}
          placeholder="1.0"
          placeholderTextColor={COLORS.textDisabled}
          testID="egfr-creatinine"
        />
        <Text style={styles.label}>{t('calc.egfr.age')}</Text>
        <TextInput
          value={age}
          onChangeText={setAge}
          keyboardType="number-pad"
          style={styles.input}
          placeholder="55"
          placeholderTextColor={COLORS.textDisabled}
          testID="egfr-age"
        />

        <Text style={styles.label}>{t('calc.egfr.sex')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['male', 'female'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSex(s)}
              style={[styles.sexChip, sex === s && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
              testID={`egfr-sex-${s}`}
            >
              <Text style={[styles.sexText, sex === s && { color: '#fff' }]}>
                {s === 'male' ? t('common.male') : t('common.female')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {result && (
          <View style={styles.result}>
            <Text style={styles.resultLbl}>{t('calc.egfr.yourGfr')}</Text>
            <Text style={styles.resultNum}>{result}</Text>
            <Text style={styles.resultUnit}>ml/min/1.73 m²</Text>
            <Text style={[styles.resultTag, { color: stage(result).color }]}>{stage(result).label}</Text>
            <SaveScoreButton
              onPress={() => saveScore(result, `${result} · ${stage(result).label}`, { creatinine: parseFloat(cr), age: parseInt(age, 10), sex })}
              saving={saving}
            />
          </View>
        )}

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
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 10 },
  histHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12 },
  input: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 6, ...FONTS.body, color: COLORS.textPrimary },
  sexChip: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  sexText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  result: { backgroundColor: '#E8F7F8', borderRadius: RADIUS.md, padding: 20, marginTop: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary },
  resultLbl: { ...FONTS.label, color: COLORS.primary, marginBottom: 4 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 56 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary },
  resultTag: { ...FONTS.bodyMedium, marginTop: 8, textAlign: 'center' },
});
