// IPSS — collapsible-header layout.
//
// • Header collapses on scroll (gradient panel shrinks; the BIG score
//   becomes a compact pill in the AppBar so the patient can always see
//   their running total while answering questions).
// • An "About IPSS" educational card sits just below the header so
//   patients understand what they're filling in and why it matters —
//   per Dr. Joshi's request to motivate them to take it seriously.
// • Severity-specific guidance updates as the score crosses thresholds
//   (Mild / Moderate / Severe) — gives instant context.

import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { useI18n } from '../src/i18n';
import LanguageDropdown from '../src/language-dropdown';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { PrimaryButton } from '../src/components';

function severityOf(score: number): 'mild' | 'moderate' | 'severe' {
  if (score <= 7) return 'mild';
  if (score <= 19) return 'moderate';
  return 'severe';
}

const HEADER_EXPANDED = 230;   // tall hero height
const HEADER_COLLAPSED = 64;   // compact app-bar height (above safe-area)
const SCROLL_RANGE = HEADER_EXPANDED - HEADER_COLLAPSED;

export default function IPSS() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { t, tRaw } = useI18n();

  const questions: string[] = tRaw('calc.ipss.questions') || [];
  const scoreLabels: string[] = tRaw('calc.ipss.scoreLabels') || [];
  const qolLabels: string[] = tRaw('calc.ipss.qolLabels') || [];
  const nocturiaLabels: string[] = tRaw('calc.ipss.nocturiaLabels') || [];

  const [scores, setScores] = useState<number[]>(Array(7).fill(0));
  const [qol, setQol] = useState<number>(0);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  // Both info sections start COLLAPSED — patient taps to expand
  // (per Dr. Joshi's instruction: "show details only when clicked").
  const [whatExpanded, setWhatExpanded] = useState(false);
  const [whyExpanded, setWhyExpanded] = useState(false);

  const total = useMemo(() => scores.reduce((a, b) => a + b, 0), [scores]);
  const sev = severityOf(total);
  const sevLabel = t(`calc.severity.${sev}`);
  const sevColor =
    sev === 'severe' ? COLORS.accent : sev === 'moderate' ? COLORS.warning : COLORS.success;
  const sevTip =
    sev === 'severe'
      ? t('calc.ipss.tipSevere')
      : sev === 'moderate'
      ? t('calc.ipss.tipModerate')
      : t('calc.ipss.tipMild');

  // Scroll-driven animation values.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => { scrollY.value = e.contentOffset.y; },
  });

  // Tall hero panel — fades & shrinks as user scrolls.
  const heroAnim = useAnimatedStyle(() => {
    const h = interpolate(
      scrollY.value, [0, SCROLL_RANGE], [HEADER_EXPANDED, HEADER_COLLAPSED],
      Extrapolation.CLAMP,
    );
    const op = interpolate(
      scrollY.value, [0, SCROLL_RANGE * 0.65], [1, 0],
      Extrapolation.CLAMP,
    );
    return { height: h + insets.top, opacity: op };
  });
  // Compact app-bar — fades IN as user scrolls past the threshold.
  const barAnim = useAnimatedStyle(() => {
    const op = interpolate(
      scrollY.value, [SCROLL_RANGE * 0.5, SCROLL_RANGE], [0, 1],
      Extrapolation.CLAMP,
    );
    return { opacity: op };
  });

  const loadHistory = async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/ipss/history');
      setHistory(data);
    } catch {}
  };

  useEffect(() => { loadHistory(); }, [user]);

  const setScore = (i: number, v: number) => {
    const copy = [...scores];
    copy[i] = v;
    setScores(copy);
  };

  const save = async () => {
    if (!user) {
      Alert.alert(t('calc.signIn'), t('calc.signInPrompt'));
      return;
    }
    try {
      const sevEn = sev === 'mild' ? 'Mild' : sev === 'moderate' ? 'Moderate' : 'Severe';
      const payload = {
        entries: questions.map((q, i) => ({ question: q, score: scores[i] })),
        total_score: total,
        severity: sevEn,
        qol_score: qol,
      };
      const { data } = await api.post('/ipss', payload);
      setResult(data);
      loadHistory();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.response?.data?.detail || t('calc.couldNotSave'));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar barStyle="light-content" />

      {/* ─────────────  Tall hero (fades+shrinks)  ─────────────── */}
      <Animated.View style={[styles.hero, heroAnim, { paddingTop: insets.top }]}>
        <LinearGradient colors={COLORS.heroGradient} style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="ipss-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('calc.ipss.title')}</Text>
          <LanguageDropdown testID="ipss-lang" />
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>{t('calc.currentScore')}</Text>
          <Text style={styles.scoreValue} testID="ipss-total">{total}<Text style={styles.scoreOutOf}> / 35</Text></Text>
          <View style={[styles.sevTag, { backgroundColor: sevColor }]}>
            <Text style={styles.sevText}>{sevLabel.toUpperCase()}</Text>
          </View>
        </View>
      </Animated.View>

      {/* ─────────────  Compact app-bar (fades in)  ─────────────── */}
      <Animated.View pointerEvents="box-none" style={[styles.compactBar, { paddingTop: insets.top, height: HEADER_COLLAPSED + insets.top }, barAnim]}>
        <LinearGradient colors={COLORS.heroGradient} style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
        <View style={styles.compactInner}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.compactCenter}>
            <Text style={styles.compactTitle} numberOfLines={1}>IPSS</Text>
            <View style={styles.compactScorePill}>
              <Text style={styles.compactScoreVal}>{total}</Text>
              <Text style={styles.compactScoreOut}>/35</Text>
            </View>
            <View style={[styles.compactSev, { backgroundColor: sevColor }]}>
              <Text style={styles.compactSevText} numberOfLines={1}>{sevLabel}</Text>
            </View>
          </View>
          <LanguageDropdown testID="ipss-lang-compact" />
        </View>
      </Animated.View>

      {/* ─────────────  Scrollable body  ─────────────── */}
      <Animated.ScrollView
        contentContainerStyle={{
          paddingTop: HEADER_EXPANDED + insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 120,
        }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        showsVerticalScrollIndicator={false}
      >
        {/* About IPSS — both sections are collapsible buttons */}
        <View style={styles.aboutCard}>
          <TouchableOpacity
            style={styles.aboutHead}
            onPress={() => setWhatExpanded((v) => !v)}
            activeOpacity={0.75}
            testID="ipss-what-toggle"
          >
            <View style={styles.aboutIcon}>
              <Ionicons name="information-circle" size={20} color={COLORS.primary} />
            </View>
            <Text style={styles.aboutTitle}>{t('calc.ipss.whatIs')}</Text>
            <Ionicons
              name={whatExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
          {whatExpanded && (
            <Text style={styles.aboutBody}>{t('calc.ipss.whatIsBody')}</Text>
          )}

          <View style={styles.aboutDivider} />

          <TouchableOpacity
            style={styles.aboutHead}
            onPress={() => setWhyExpanded((v) => !v)}
            activeOpacity={0.75}
            testID="ipss-why-toggle"
          >
            <View style={[styles.aboutIcon, { backgroundColor: COLORS.warning + '22' }]}>
              <Ionicons name="bulb" size={18} color={COLORS.warning} />
            </View>
            <Text style={styles.aboutTitle}>{t('calc.ipss.whyItMatters')}</Text>
            <Ionicons
              name={whyExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={COLORS.textSecondary}
            />
          </TouchableOpacity>
          {whyExpanded && (
            <Text style={styles.aboutBody}>{t('calc.ipss.whyItMattersBody')}</Text>
          )}

          {/* Severity-aware tip remains ALWAYS visible (it's a quick
              actionable nudge) — but only after the user has answered
              at least one question (so the collapsed state stays clean
              when they first open the page). */}
          {total > 0 && (
            <View style={[styles.tipBox, { borderLeftColor: sevColor }]}>
              <Text style={[styles.tipText, { color: sevColor }]}>{sevTip}</Text>
            </View>
          )}
        </View>

        {questions.map((q, i) => (
          <View key={i} style={styles.qCard}>
            <Text style={styles.qNum}>{t('calc.ipss.question')} {i + 1}</Text>
            <Text style={styles.qText}>{q}</Text>
            <View style={styles.scoreRow}>
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setScore(i, v)}
                  style={[styles.scoreBtn, scores[i] === v && styles.scoreBtnActive]}
                  testID={`ipss-q${i}-${v}`}
                >
                  <Text style={[styles.scoreBtnText, scores[i] === v && { color: '#fff' }]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.scoreCaption}>
              {i === 6 ? nocturiaLabels[scores[i]] : scoreLabels[scores[i]]}
            </Text>
          </View>
        ))}

        <View style={[styles.qCard, { backgroundColor: '#FFF6E0', borderColor: COLORS.warning }]}>
          <Text style={styles.qNum}>{t('calc.ipss.qolLabel')}</Text>
          <Text style={styles.qText}>{t('calc.ipss.qolText')}</Text>
          <View style={styles.scoreRow}>
            {[0, 1, 2, 3, 4, 5, 6].map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => setQol(v)}
                style={[styles.scoreBtn, qol === v && { backgroundColor: COLORS.warning, borderColor: COLORS.warning }]}
                testID={`ipss-qol-${v}`}
              >
                <Text style={[styles.scoreBtnText, qol === v && { color: '#fff' }]}>{v}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.scoreCaption}>{qolLabels[qol]}</Text>
        </View>

        <PrimaryButton
          title={user ? t('calc.saveAndHistory') : t('calc.save')}
          onPress={save}
          testID="ipss-calculator-submit-button"
          style={{ marginTop: 8 }}
          icon={<Ionicons name="save" size={20} color="#fff" />}
        />

        {result && (
          <View style={styles.resultBox}>
            <Ionicons name="checkmark-circle" size={28} color={COLORS.success} />
            <Text style={styles.resultTitle}>{t('calc.saved')}</Text>
            <Text style={styles.resultBody}>{total}/35 · {sevLabel}</Text>
          </View>
        )}

        {history.length > 0 && (
          <>
            <Text style={styles.histTitle}>{t('calc.history')}</Text>
            {history.map((h) => (
              <View key={h.record_id} style={styles.histRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.histDate}>{format(new Date(h.created_at), 'dd-MM-yyyy, h:mm a')}</Text>
                  <Text style={styles.histScore}>
                    {h.total_score}/35 · <Text style={{ color: COLORS.primary }}>{h.severity}</Text>
                  </Text>
                </View>
                {h.qol_score != null && (
                  <View style={styles.qolChip}>
                    <Text style={styles.qolText}>QoL: {h.qol_score}</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Hero — absolute-positioned panel that resizes via Animated style
  hero: {
    position: 'absolute', left: 0, right: 0, top: 0,
    paddingHorizontal: 16,
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    zIndex: 1,
  },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, gap: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...FONTS.h4, color: '#fff', flex: 1, textAlign: 'center' },
  scoreBox: { alignItems: 'center', marginTop: 14 },
  scoreLabel: { ...FONTS.body, color: '#E0F7FA', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  scoreValue: { ...FONTS.h1, color: '#fff', fontSize: 56, marginTop: 2, lineHeight: 64 },
  scoreOutOf: { fontSize: 22, opacity: 0.7, fontFamily: 'Manrope_600SemiBold' },
  sevTag: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14, marginTop: 6 },
  sevText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11, letterSpacing: 0.5 },

  // Compact app-bar — appears on scroll
  compactBar: {
    position: 'absolute', left: 0, right: 0, top: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
    zIndex: 2,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
    }),
  },
  compactInner: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  // Centre-content cluster between the back button and lang switcher.
  // Set to flex:1 so it occupies the remaining horizontal space and
  // doesn't bunch at the left edge on narrow phones.
  compactCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  compactTitle: { ...FONTS.h4, color: '#fff', fontSize: 15 },
  compactScorePill: {
    flexDirection: 'row', alignItems: 'baseline', gap: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
  },
  compactScoreVal: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 16 },
  compactScoreOut: { color: '#E0F7FA', fontSize: 11, fontFamily: 'Manrope_600SemiBold' },
  compactSev: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9 },
  compactSevText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 10, letterSpacing: 0.3 },

  // About card — educational
  aboutCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  aboutHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  aboutIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  aboutTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  aboutBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8, paddingLeft: 4 },
  aboutDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  tipBox: {
    marginTop: 10,
    paddingLeft: 10, paddingVertical: 6,
    borderLeftWidth: 3,
    backgroundColor: COLORS.bg,
    borderRadius: 6,
  },
  tipText: { ...FONTS.bodyMedium, fontSize: 12, lineHeight: 17 },

  // Question cards
  qCard: { backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  qNum: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  qText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 6, lineHeight: 20 },
  scoreRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  scoreBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  scoreBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  scoreBtnText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  scoreCaption: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6, textAlign: 'center' },

  resultBox: { backgroundColor: '#E8F5E9', padding: 14, borderRadius: RADIUS.md, marginTop: 14, alignItems: 'center', gap: 4 },
  resultTitle: { ...FONTS.h4, color: COLORS.success },
  resultBody: { ...FONTS.body, color: COLORS.textPrimary },
  histTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 22, marginBottom: 10 },
  histRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  histDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  histScore: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 2, fontSize: 15 },
  qolChip: { backgroundColor: COLORS.warning + '22', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  qolText: { ...FONTS.label, color: COLORS.warning, fontSize: 10 },
});
