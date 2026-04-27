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

export default function ProstateVolumeCalc() {
  const router = useRouter();
  const { t } = useI18n();
  const [l, setL] = useState('');
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('prostate_volume');

  const volume = useMemo(() => {
    const L = parseFloat(l); const W = parseFloat(w); const H = parseFloat(h);
    if (!L || !W || !H) return null;
    return Number((0.524 * L * W * H).toFixed(1));
  }, [l, w, h]);

  const category = (v: number) => {
    if (v < 30) return { label: t('calc.pv.categories.normal'), color: COLORS.success };
    if (v < 60) return { label: t('calc.pv.categories.moderate'), color: COLORS.warning };
    return { label: t('calc.pv.categories.significant'), color: COLORS.accent };
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.pv.title')}</Text>
        <LanguageDropdown testID="pv-lang" />
      </View>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.subtitle}>{t('calc.pv.subtitle')}</Text>
        <Text style={styles.label}>{t('calc.pv.length')}</Text>
        <TextInput value={l} onChangeText={setL} keyboardType="decimal-pad" style={styles.input} placeholder="4.5" placeholderTextColor={COLORS.textDisabled} testID="pv-length" />
        <Text style={styles.label}>{t('calc.pv.width')}</Text>
        <TextInput value={w} onChangeText={setW} keyboardType="decimal-pad" style={styles.input} placeholder="3.2" placeholderTextColor={COLORS.textDisabled} testID="pv-width" />
        <Text style={styles.label}>{t('calc.pv.height')}</Text>
        <TextInput value={h} onChangeText={setH} keyboardType="decimal-pad" style={styles.input} placeholder="3.8" placeholderTextColor={COLORS.textDisabled} testID="pv-height" />
        {volume && (
          <View style={styles.result}>
            <Text style={styles.resultLbl}>{t('calc.pv.yourVol')}</Text>
            <Text style={styles.resultNum}>{volume}</Text>
            <Text style={styles.resultUnit}>ml (cc)</Text>
            <Text style={[styles.resultTag, { color: category(volume).color }]}>{category(volume).label}</Text>
            <SaveScoreButton onPress={() => saveScore(volume, `${volume} cc · ${category(volume).label}`, { L: parseFloat(l), W: parseFloat(w), H: parseFloat(h) })} saving={saving} />
          </View>
        )}
        <Text style={styles.info}>{t('calc.pv.info')}</Text>
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
  result: { backgroundColor: '#fff', padding: 18, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginTop: 20 },
  resultLbl: { ...FONTS.label, color: COLORS.primary, marginBottom: 4 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 46 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary },
  resultTag: { ...FONTS.h4, marginTop: 8, textAlign: 'center' },
  info: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 16, fontSize: 12, lineHeight: 18 },
});
