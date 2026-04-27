import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToolHistory } from '../../src/tool-history';
import { ToolHistoryList, SaveScoreButton } from '../../src/tool-history-ui';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

export default function PSACalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [psa, setPsa] = useState('');
  const [vol, setVol] = useState('');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('psa');

  const density = parseFloat(psa) / parseFloat(vol);
  const valid = !isNaN(density) && isFinite(density) && density > 0;
  const high = valid && density >= 0.15;

  const handleSave = async () => {
    if (!valid) return;
    await saveScore(Number(density.toFixed(3)), `PSA-D ${density.toFixed(3)} · ${high ? t('calc.psa.elevated') : t('calc.psa.acceptable')}`, { psa: parseFloat(psa), volume_ml: parseFloat(vol) });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.psa.title')}</Text>
        <LanguageDropdown testID="psa-lang" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.subtitle}>{t('calc.psa.subtitle')}</Text>
        <Text style={styles.label}>{t('calc.psa.psa')}</Text>
        <TextInput value={psa} onChangeText={setPsa} keyboardType="decimal-pad" style={styles.input} placeholder="5.6" placeholderTextColor={COLORS.textDisabled} testID="psa-input" />
        <Text style={styles.label}>{t('calc.psa.volume')}</Text>
        <TextInput value={vol} onChangeText={setVol} keyboardType="decimal-pad" style={styles.input} placeholder="40" placeholderTextColor={COLORS.textDisabled} testID="psa-volume-input" />
        {valid && (
          <View style={[styles.result, high && { borderColor: COLORS.accent, backgroundColor: '#FFEBEE' }]}>
            <Text style={styles.resultNum}>{density.toFixed(3)}</Text>
            <Text style={styles.resultUnit}>ng/ml/cc</Text>
            <Text style={[styles.resultTag, high ? { color: COLORS.accent } : { color: COLORS.success }]}>{high ? t('calc.psa.elevated') : t('calc.psa.acceptable')}</Text>
          </View>
        )}
        <Text style={styles.info}>{t('calc.psa.info')}</Text>
        {valid && <SaveScoreButton onPress={handleSave} saving={saving} />}
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
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 10, marginTop: 4 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12 },
  histHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 6, ...FONTS.body, color: COLORS.textPrimary },
  result: { backgroundColor: '#E8F7F8', borderRadius: RADIUS.md, padding: 20, marginTop: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 46 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary, marginTop: -6 },
  resultTag: { ...FONTS.bodyMedium, marginTop: 8, textAlign: 'center' },
  info: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 20, lineHeight: 20 },
});
