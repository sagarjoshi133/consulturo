import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToolHistory } from '../../src/tool-history';
import { ToolHistoryList, SaveScoreButton } from '../../src/tool-history-ui';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

export default function CreatinineTracker() {
  const router = useRouter();
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const { history, loading, saving, saveScore, removeScore } = useToolHistory('creatinine');

  const numeric = parseFloat(value);
  const valid = !isNaN(numeric) && numeric > 0 && numeric < 20;

  const interpret = (v: number) => {
    if (v < 0.6) return { label: t('calc.creat.interp.low'), color: '#2563EB' };
    if (v <= 1.2) return { label: t('calc.creat.interp.normal'), color: '#16A34A' };
    if (v <= 1.5) return { label: t('calc.creat.interp.mild'), color: '#D97706' };
    if (v <= 2.5) return { label: t('calc.creat.interp.moderate'), color: '#EA580C' };
    return { label: t('calc.creat.interp.marked'), color: '#DC2626' };
  };

  const interp = valid ? interpret(numeric) : null;

  const doSave = async () => {
    if (!valid) { setMsg(t('calc.creat.error')); return; }
    setMsg('');
    try {
      await saveScore(numeric, `${numeric} mg/dL · ${interp?.label}`, { value: numeric, note: note.trim() || undefined });
      setValue(''); setNote(''); setMsg(t('calc.saved'));
      setTimeout(() => setMsg(''), 1500);
    } catch (e: any) { setMsg(e?.response?.data?.detail || t('calc.couldNotSave')); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
        <SafeAreaView edges={['top']}>
          <View style={styles.heroRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle} numberOfLines={1}>{t('calc.creat.title')}</Text>
              <Text style={styles.heroSub}>{t('calc.creat.subtitle')}</Text>
            </View>
            <LanguageDropdown testID="creat-lang" />
          </View>
        </SafeAreaView>
      </LinearGradient>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={styles.card}>
          <Text style={styles.lbl}>{t('calc.creat.value')}</Text>
          <TextInput value={value} onChangeText={setValue} placeholder="1.1" placeholderTextColor={COLORS.textDisabled} keyboardType="decimal-pad" style={styles.input} testID="creat-value" />
          <Text style={[styles.lbl, { marginTop: 12 }]}>{t('calc.creat.note')}</Text>
          <TextInput value={note} onChangeText={setNote} placeholder={t('calc.creat.placeholder')} placeholderTextColor={COLORS.textDisabled} style={styles.input} testID="creat-note" />
          {interp && (
            <View style={[styles.interp, { backgroundColor: interp.color + '14', borderColor: interp.color + '55' }]}>
              <Ionicons name="information-circle" size={16} color={interp.color} />
              <Text style={[styles.interpText, { color: interp.color }]}>{numeric.toFixed(2)} mg/dL · {interp.label}</Text>
            </View>
          )}
          {msg ? <Text style={[styles.msg, msg === t('calc.saved') && { color: COLORS.success }]}>{msg}</Text> : null}
          <SaveScoreButton onPress={doSave} saving={saving} disabled={!valid} />
        </View>
        <Text style={styles.sectionHdr}>{t('calc.history')}</Text>
        <ToolHistoryList history={history} loading={loading} onDelete={removeScore} emptyLabel={t('calc.creat.empty')} />
        <View style={styles.tip}>
          <Ionicons name="bulb-outline" size={14} color={COLORS.primary} />
          <Text style={styles.tipText}>{t('calc.creat.tip')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  hero: { paddingBottom: 18, paddingHorizontal: 16 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: Platform.OS === 'ios' ? 0 : 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },
  heroTitle: { ...FONTS.h2, color: '#fff', fontSize: 18 },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  lbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11 },
  input: { marginTop: 6, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 12, ...FONTS.body, color: COLORS.textPrimary },
  interp: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, marginTop: 14 },
  interpText: { ...FONTS.bodyMedium, fontSize: 13 },
  msg: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  sectionHdr: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 },
  tip: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 16, padding: 10, backgroundColor: COLORS.primary + '0D', borderRadius: RADIUS.md },
  tipText: { ...FONTS.body, color: COLORS.primary, fontSize: 12, flex: 1, lineHeight: 17 },
});
