import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToolHistory } from '../../src/tool-history';
import { ToolHistoryList, SaveScoreButton } from '../../src/tool-history-ui';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

export default function Iief5Calc() {
  const router = useRouter();
  const { t, tRaw } = useI18n();
  const [answers, setAnswers] = useState<(number | null)[]>([null, null, null, null, null]);
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('iief5');

  const questions: string[] = tRaw('calc.iief5.questions') || [];
  const options: string[][] = tRaw('calc.iief5.options') || [];

  const total = useMemo(() => {
    if (answers.some((a) => a == null)) return null;
    return (answers as number[]).reduce((s, v) => s + v, 0);
  }, [answers]);

  const category = (score: number) => {
    if (score >= 22) return { label: t('calc.iief5.interpret.none'), color: COLORS.success };
    if (score >= 17) return { label: t('calc.iief5.interpret.mild'), color: COLORS.warning };
    if (score >= 12) return { label: t('calc.iief5.interpret.mildmod'), color: COLORS.warning };
    if (score >= 8) return { label: t('calc.iief5.interpret.moderate'), color: COLORS.accent };
    return { label: t('calc.iief5.interpret.severe'), color: COLORS.accent };
  };

  const handleSave = async () => {
    if (total == null) return;
    await saveScore(total, `${total}/25 · ${category(total).label}`, { answers });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{t('calc.iief5.title')}</Text>
        <LanguageDropdown testID="iief-lang" />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.subtitle}>{t('calc.iief5.subtitle')}</Text>

        {questions.map((q, qi) => (
          <View key={qi} style={styles.qCard}>
            <Text style={styles.qNum}>Q{qi + 1}</Text>
            <Text style={styles.qText}>{q}</Text>
            <View style={styles.opts}>
              {(options[qi] || []).map((label, oi) => {
                const score = oi + 1;
                const selected = answers[qi] === score;
                return (
                  <TouchableOpacity
                    key={oi}
                    onPress={() => {
                      const next = [...answers];
                      next[qi] = score;
                      setAnswers(next);
                    }}
                    style={[styles.opt, selected && styles.optActive]}
                    testID={`iief-q${qi + 1}-${score}`}
                  >
                    <Text style={[styles.optScore, selected && { color: '#fff' }]}>{score}</Text>
                    <Text style={[styles.optLabel, selected && { color: '#fff' }]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {total != null && (
          <View style={styles.result}>
            <Text style={styles.resultNum}>{total}</Text>
            <Text style={styles.resultUnit}>/25</Text>
            <Text style={[styles.resultTag, { color: category(total).color }]}>{category(total).label}</Text>
            <SaveScoreButton onPress={handleSave} saving={saving} />
          </View>
        )}

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
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 12 },
  qCard: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  qNum: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },
  qText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 4, lineHeight: 20 },
  opts: { flexDirection: 'column', gap: 6, marginTop: 10 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  optActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  optScore: { ...FONTS.bodyMedium, color: COLORS.primary, width: 18, fontSize: 13 },
  optLabel: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  result: { backgroundColor: '#fff', padding: 18, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', marginTop: 16 },
  resultNum: { ...FONTS.h1, color: COLORS.primary, fontSize: 52 },
  resultUnit: { ...FONTS.body, color: COLORS.textSecondary, marginTop: -4 },
  resultTag: { ...FONTS.h4, marginTop: 8 },
});
