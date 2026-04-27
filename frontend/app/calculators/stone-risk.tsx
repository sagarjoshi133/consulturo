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

export default function StonePassCalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [size, setSize] = useState('');
  const [location, setLocation] = useState<'upper' | 'middle' | 'lower'>('lower');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('stone_risk');

  const result = useMemo(() => {
    const mm = parseFloat(size);
    if (!mm) return null;
    let probability = 0;
    if (mm <= 2) probability = location === 'lower' ? 98 : location === 'middle' ? 85 : 80;
    else if (mm <= 4) probability = location === 'lower' ? 85 : location === 'middle' ? 75 : 65;
    else if (mm <= 6) probability = location === 'lower' ? 60 : location === 'middle' ? 47 : 35;
    else if (mm <= 8) probability = location === 'lower' ? 30 : location === 'middle' ? 20 : 15;
    else probability = location === 'lower' ? 10 : 5;
    return { probability, mm };
  }, [size, location]);

  const recommend = (r: { probability: number; mm: number }) => {
    if (r.mm <= 5 && r.probability >= 60) return { label: t('calc.stone.verdict.spontaneous'), color: COLORS.success };
    if (r.mm <= 10 && r.probability >= 20) return { label: t('calc.stone.verdict.trial'), color: COLORS.warning };
    return { label: t('calc.stone.verdict.surgery'), color: COLORS.accent };
  };

  const handleSave = async () => {
    if (!result) return;
    await saveScore(result.probability, `${result.mm} mm · ${location} · ${result.probability}% pass`, { mm: result.mm, location, probability: result.probability });
  };

  const locLabels: any = { upper: t('calc.stone.upper'), middle: t('calc.stone.middle'), lower: t('calc.stone.lower') };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.stone.title')}</Text>
        <LanguageDropdown testID="stone-lang" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.subtitle}>{t('calc.stone.subtitle')}</Text>
        <Text style={styles.label}>{t('calc.stone.size')}</Text>
        <TextInput value={size} onChangeText={setSize} keyboardType="decimal-pad" style={styles.input} placeholder="5" placeholderTextColor={COLORS.textDisabled} testID="stone-size" />
        <Text style={styles.label}>{t('calc.stone.location')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          {(['upper','middle','lower'] as const).map((l) => (
            <TouchableOpacity key={l} onPress={() => setLocation(l)} style={[styles.chip, location === l && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} testID={`stone-loc-${l}`}>
              <Text style={[styles.chipText, location === l && { color: '#fff' }]}>{locLabels[l]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {result && (
          <View style={styles.result}>
            <Text style={styles.resultNum}>{result.probability}%</Text>
            <Text style={styles.resultUnit}>{t('calc.stone.likelihood')}</Text>
            <Text style={[styles.resultTag, { color: recommend(result).color }]}>{recommend(result).label}</Text>
          </View>
        )}
        {result && <SaveScoreButton onPress={handleSave} saving={saving} />}
        <Text style={styles.info}>{t('calc.stone.info')}</Text>
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
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 16 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border, fontSize: 15 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  chipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  result: { backgroundColor: '#fff', padding: 18, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginTop: 20 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 46 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' },
  resultTag: { ...FONTS.h4, marginTop: 10, textAlign: 'center' },
  info: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 16, fontSize: 12, lineHeight: 18 },
  histHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
});
