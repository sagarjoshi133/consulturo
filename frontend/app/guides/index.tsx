/**
 * /guides — Patient Guides index with two tabs:
 *   • Surgeries (33 procedures)        → /guides/[surgery_key]
 *   • Diet by Condition (30 condit.)   → /guides/diet/[condition_key]
 *
 * Trilingual EN/HI/GU. Includes search filter + medical disclaimer.
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';

type Trilingual = { en?: string; hi?: string; gu?: string };

type SurgerySummary = {
  key: string;
  aliases?: string[];
  name: Trilingual;
  duration_minutes?: number;
  hospital_stay_days?: number;
};

type DietSummary = {
  key: string;
  aliases?: string[];
  name: Trilingual;
  summary?: Trilingual;
};

type TabKey = 'surgeries' | 'diets';

export default function GuidesIndex() {
  const router = useRouter();
  const { lang } = useI18n();
  const L = (lang as 'en' | 'hi' | 'gu') || 'en';

  const [tab, setTab] = useState<TabKey>('surgeries');
  const [surgeries, setSurgeries] = useState<SurgerySummary[]>([]);
  const [diets, setDiets] = useState<DietSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        api.get('/guides').catch(() => ({ data: { items: [] } })),
        api.get('/diets').catch(() => ({ data: { items: [] } })),
      ]);
      setSurgeries(s.data?.items || []);
      setDiets(d.data?.items || []);
    } catch {
      setSurgeries([]); setDiets([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredSurg = useMemo(() => {
    if (!query.trim()) return surgeries;
    const q = query.trim().toLowerCase();
    return surgeries.filter((it) => {
      const n = ((it.name as any)[L] || it.name.en || '').toLowerCase();
      const en = (it.name.en || '').toLowerCase();
      return n.includes(q) || en.includes(q) || it.key.includes(q) || (it.aliases || []).some((a) => a.toLowerCase().includes(q));
    });
  }, [surgeries, query, L]);

  const filteredDiets = useMemo(() => {
    if (!query.trim()) return diets;
    const q = query.trim().toLowerCase();
    return diets.filter((it) => {
      const n = ((it.name as any)[L] || it.name.en || '').toLowerCase();
      const en = (it.name.en || '').toLowerCase();
      const s = ((it.summary as any)?.[L] || it.summary?.en || '').toLowerCase();
      return n.includes(q) || en.includes(q) || s.includes(q) || it.key.includes(q);
    });
  }, [diets, query, L]);

  const tr = (en: string, hi: string, gu: string) => (L === 'hi' ? hi : L === 'gu' ? gu : en);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.hero}>
        <View style={styles.heroTop}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroPill}>
            {tr('PATIENT CARE GUIDES', 'मरीज़ देखभाल गाइड', 'દર્દી સંભાળ માર્ગદર્શિકા')}
          </Text>
          <View style={{ width: 32 }} />
        </View>
        <Text style={styles.heroTitle}>
          {tr('Patient Care Guides — surgery, diet & recovery',
              'मरीज़ देखभाल गाइड — सर्जरी, आहार और रिकवरी',
              'દર્દી સંભાળ માર્ગદર્શિકા — સર્જરી, આહાર અને રિકવરી')}
        </Text>
        <Text style={styles.heroSub}>
          {tr('Reviewed by Dr. Sagar Joshi · 33 surgeries · 30 diet plans',
              'Dr. Sagar Joshi द्वारा review · 33 सर्जरी · 30 diet plans',
              'Dr. Sagar Joshi દ્વારા review · 33 સર્જરી · 30 diet plans')}
        </Text>
      </LinearGradient>

      {/* Top Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'surgeries' && styles.tabActive]}
          onPress={() => setTab('surgeries')}
          testID="tab-surgeries"
        >
          <Ionicons name="medkit" size={15} color={tab === 'surgeries' ? '#fff' : COLORS.primary} />
          <Text style={[styles.tabText, tab === 'surgeries' && styles.tabTextActive]}>
            {tr('Surgeries', 'सर्जरी', 'સર્જરી')}{'  '}
            <Text style={[styles.tabCount, tab === 'surgeries' && styles.tabCountActive]}>· {surgeries.length}</Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, tab === 'diets' && styles.tabActive]}
          onPress={() => setTab('diets')}
          testID="tab-diets"
        >
          <MaterialCommunityIcons name="food-apple-outline" size={16} color={tab === 'diets' ? '#fff' : COLORS.primary} />
          <Text style={[styles.tabText, tab === 'diets' && styles.tabTextActive]}>
            {tr('Diet by Condition', 'Condition के लिए Diet', 'Condition માટે Diet')}{'  '}
            <Text style={[styles.tabCount, tab === 'diets' && styles.tabCountActive]}>· {diets.length}</Text>
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={COLORS.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder={tab === 'surgeries'
            ? tr('Search surgery, e.g. TURP, PCNL...', 'सर्जरी खोजें, जैसे TURP, PCNL...', 'સર્જરી શોધો, જેમ કે TURP, PCNL...')
            : tr('Search condition, e.g. BPH, kidney stones...', 'Condition खोजें, जैसे BPH, पथरी...', 'Condition શોધો, જેમ કે BPH, પથરી...')}
          placeholderTextColor={COLORS.textTertiary}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={COLORS.textTertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }} keyboardShouldPersistTaps="handled">
        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 30 }} />
        ) : tab === 'surgeries' ? (
          filteredSurg.length === 0 ? (
            <Text style={styles.empty}>{tr('No surgery matches your search.', 'कोई सर्जरी नहीं मिली।', 'કોઈ સર્જરી મળી નથી.')}</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {filteredSurg.map((it) => (
                <TouchableOpacity
                  key={it.key}
                  style={styles.card}
                  onPress={() => router.push(`/guides/${it.key}` as any)}
                  testID={`guide-card-${it.key}`}
                >
                  <View style={[styles.cardIcon, { backgroundColor: COLORS.primary }]}>
                    <Ionicons name="medkit" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{(it.name as any)[L] || it.name.en}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {it.duration_minutes ? (
                        <Text style={styles.metaPill}>
                          <Ionicons name="time-outline" size={11} color={COLORS.textSecondary} />
                          {' '}~{it.duration_minutes} min
                        </Text>
                      ) : null}
                      {it.hospital_stay_days ? (
                        <Text style={styles.metaPill}>
                          <Ionicons name="bed-outline" size={11} color={COLORS.textSecondary} />
                          {' '}{it.hospital_stay_days} {tr('d', 'दिन', 'દિવસ')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )
        ) : (
          filteredDiets.length === 0 ? (
            <Text style={styles.empty}>{tr('No condition matches your search.', 'कोई condition नहीं मिली।', 'કોઈ condition મળી નથી.')}</Text>
          ) : (
            <View style={{ gap: 10 }}>
              {filteredDiets.map((it) => (
                <TouchableOpacity
                  key={it.key}
                  style={styles.card}
                  onPress={() => router.push(`/guides/diet/${it.key}` as any)}
                  testID={`diet-card-${it.key}`}
                >
                  <View style={[styles.cardIcon, { backgroundColor: '#16a34a' }]}>
                    <MaterialCommunityIcons name="food-apple" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{(it.name as any)[L] || it.name.en}</Text>
                    {it.summary ? (
                      <Text style={styles.cardSummary} numberOfLines={2}>
                        {(it.summary as any)[L] || it.summary.en}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
                </TouchableOpacity>
              ))}
            </View>
          )
        )}

        {/* Medical disclaimer */}
        <View style={styles.disclaimer}>
          <Ionicons name="shield-checkmark" size={14} color={COLORS.textSecondary} />
          <Text style={styles.disclaimerText}>
            {tr('Reviewed by Dr. Sagar Joshi · For information only — not a substitute for in-person medical advice.',
                'Dr. Sagar Joshi द्वारा review · केवल जानकारी के लिए — व्यक्तिगत doctor की सलाह का विकल्प नहीं।',
                'Dr. Sagar Joshi દ્વારા review · ફક્ત માહિતી માટે — વ્યક્તિગત doctor સલાહ નો વિકલ્પ નથી.')}
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
  heroSub: { color: 'rgba(255,255,255,0.85)', marginTop: 6, fontSize: 12.5, lineHeight: 18 },

  tabs: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16,
    paddingTop: 12, paddingBottom: 6, backgroundColor: '#f8fafc',
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 8, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { color: COLORS.primary, fontWeight: '700', fontSize: 12.5 },
  tabTextActive: { color: '#fff' },
  tabCount: { color: COLORS.textTertiary, fontSize: 11 },
  tabCountActive: { color: 'rgba(255,255,255,0.8)' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: '#fff', borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 13, padding: 0 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6 },
      android: { elevation: 2 },
    }),
  },
  cardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  cardSummary: { color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  metaPill: { color: COLORS.textSecondary, fontSize: 11 },

  empty: { color: COLORS.textTertiary, textAlign: 'center', padding: 24 },

  disclaimer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 18, padding: 12,
    backgroundColor: 'rgba(15, 118, 110, 0.06)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(15, 118, 110, 0.15)',
  },
  disclaimerText: { flex: 1, color: COLORS.textSecondary, fontSize: 11, lineHeight: 16 },
});
