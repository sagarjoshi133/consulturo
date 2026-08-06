/**
 * /guides/diet/[condition] — Dietary guide for a given condition.
 *
 * 4 tabs:  Eat | Avoid | Sample Day | Tips
 * Plus a short summary banner up top + medical disclaimer.
 * Trilingual EN/HI/GU.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../src/api';
import { COLORS, FONTS, RADIUS } from '../../../src/theme';
import { useI18n } from '../../../src/i18n';

type Trilingual = { en?: string; hi?: string; gu?: string };

type DietGuide = {
  key: string;
  name: Trilingual;
  summary?: Trilingual;
  eat?: Trilingual[];
  avoid?: Trilingual[];
  sample_day?: Trilingual[];
  tips?: Trilingual[];
};

type Tab = 'eat' | 'avoid' | 'sample' | 'tips';

const TABS: { key: Tab; label: Trilingual; icon: any; family: 'mci' | 'ion'; tint: string }[] = [
  { key: 'eat',    label: { en: 'Eat',         hi: 'खाएँ',      gu: 'ખાવ' },           icon: 'leaf',                family: 'mci', tint: '#16a34a' },
  { key: 'avoid',  label: { en: 'Avoid',       hi: 'न खाएँ',    gu: 'ન ખાવ' },        icon: 'close-circle',        family: 'ion', tint: '#dc2626' },
  { key: 'sample', label: { en: 'Sample Day',  hi: 'Sample Day',gu: 'Sample Day' },     icon: 'sunny',               family: 'ion', tint: '#f59e0b' },
  { key: 'tips',   label: { en: 'Tips',        hi: 'टिप्स',     gu: 'ટિપ્સ' },         icon: 'bulb',                family: 'ion', tint: '#0ea5e9' },
];

function pick(t: Trilingual | undefined, lang: 'en' | 'hi' | 'gu'): string {
  if (!t) return '';
  return (t[lang] || t.en || '').toString();
}

export default function DietGuideScreen() {
  const { condition } = useLocalSearchParams<{ condition?: string | string[] }>();
  const key = Array.isArray(condition) ? condition[0] : condition || '';
  const router = useRouter();
  const { lang } = useI18n();
  const L = (lang as 'en' | 'hi' | 'gu') || 'en';

  const [guide, setGuide] = useState<DietGuide | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('eat');

  const load = useCallback(async () => {
    if (!key) { setLoading(false); return; }
    setLoading(true);
    try {
      const r = await api.get(`/diets/${key}`);
      setGuide(r.data || null);
    } catch { setGuide(null); }
    finally { setLoading(false); }
  }, [key]);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => {
    if (!guide) return [] as Trilingual[];
    switch (tab) {
      case 'eat':    return guide.eat || [];
      case 'avoid':  return guide.avoid || [];
      case 'sample': return guide.sample_day || [];
      case 'tips':   return guide.tips || [];
    }
  }, [tab, guide]);

  const tr = (en: string, hi: string, gu: string) => (L === 'hi' ? hi : L === 'gu' ? gu : en);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!guide) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.textTertiary} />
          <Text style={{ marginTop: 10, color: COLORS.textSecondary }}>
            {tr('Diet guide not found.', 'Diet guide नहीं मिली।', 'Diet guide મળી નથી.')}
          </Text>
          <TouchableOpacity style={styles.browseBtn} onPress={() => router.replace('/guides' as any)}>
            <Text style={styles.browseBtnText}>{tr('Browse all guides', 'सभी गाइड देखें', 'બધી માર્ગદર્શિકા જુઓ')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const activeTab = TABS.find((t) => t.key === tab) || TABS[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <LinearGradient colors={['#15803d', '#166534']} style={styles.hero}>
        <View style={styles.heroTop}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/guides' as any))} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroPill}>
            {tr('DIET GUIDE', 'DIET गाइड', 'DIET માર્ગદર્શિકા')}
          </Text>
          <View style={{ width: 32 }} />
        </View>
        <Text style={styles.heroTitle}>{pick(guide.name, L)}</Text>
        {guide.summary ? (
          <Text style={styles.heroSub}>{pick(guide.summary, L)}</Text>
        ) : null}
      </LinearGradient>

      {/* Tab strip — equal-width, fixed layout */}
      <View style={styles.tabsRow}>
        {TABS.map((t) => {
          const active = tab === t.key;
          const IconCmp = t.family === 'ion' ? Ionicons : MaterialCommunityIcons;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && { backgroundColor: t.tint, borderColor: t.tint }]}
              onPress={() => setTab(t.key)}
              testID={`diet-tab-${t.key}`}
              activeOpacity={0.8}
            >
              <IconCmp name={t.icon} size={14} color={active ? '#fff' : t.tint} />
              <Text
                style={[styles.tabText, active && { color: '#fff' }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {pick(t.label, L)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
        {items.length === 0 ? (
          <Text style={styles.empty}>{tr('No items here.', 'कुछ नहीं।', 'કંઈ નહીં.')}</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {items.map((it, idx) => (
              <View key={idx} style={[styles.bulletCard, { borderLeftColor: activeTab.tint }]}>
                <View style={[styles.bulletDot, { backgroundColor: activeTab.tint }]} />
                <Text style={styles.bulletText}>{pick(it, L)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Ionicons name="shield-checkmark" size={14} color={COLORS.textSecondary} />
          <Text style={styles.disclaimerText}>
            {tr('Reviewed by Dr. Sagar Joshi · For information only — not a substitute for in-person dietary advice from your doctor or dietician.',
                'Dr. Sagar Joshi द्वारा review · केवल जानकारी के लिए — व्यक्तिगत doctor/dietician की सलाह का विकल्प नहीं।',
                'Dr. Sagar Joshi દ્વારા review · ફક્ત માહિતી માટે — વ્યક્તિગત doctor/dietician સલાહ નો વિકલ્પ નથી.')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 18, paddingTop: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { padding: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)' },
  heroPill: { color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 2 },
  heroTitle: { color: '#fff', ...FONTS.h2, fontSize: 19, marginTop: 8 },
  heroSub: { color: 'rgba(255,255,255,0.92)', marginTop: 6, fontSize: 12.5, lineHeight: 18 },

  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabText: { fontSize: 11.5, fontWeight: '700', color: COLORS.textPrimary, flexShrink: 1 },

  bulletCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 12, backgroundColor: '#fff',
    borderRadius: RADIUS.card, borderLeftWidth: 3, borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderTopColor: COLORS.border, borderRightColor: COLORS.border, borderBottomColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  bulletDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  bulletText: { flex: 1, color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },

  empty: { color: COLORS.textTertiary, textAlign: 'center', padding: 24 },

  browseBtn: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: COLORS.primary, borderRadius: 999 },
  browseBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 18, padding: 12,
    backgroundColor: 'rgba(22, 163, 74, 0.07)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(22, 163, 74, 0.18)',
  },
  disclaimerText: { flex: 1, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16 },
});
