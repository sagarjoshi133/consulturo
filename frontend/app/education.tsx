import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../src/api';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useI18n } from '../src/i18n';
import LanguageDropdown from '../src/language-dropdown';
import SmartSearch from '../src/smart-search';

// Cream background matching the custom illustration artwork so the
// `resizeMode: 'contain'` letterboxing is visually seamless.
const ART_BG = '#FAF7F2';

export default function Education() {
  const router = useRouter();
  const { lang, t } = useI18n();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = [
        it.title,
        it.summary,
        it.category,
        ...(Array.isArray(it.tags) ? it.tags : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const load = async () => {
    try {
      const r = await api.get('/education', { params: { lang } });
      setItems(r.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const subtitle =
    lang === 'hi'
      ? 'घर पर अपनाने योग्य व्यावहारिक, चरण-दर-चरण मार्गदर्शिकाएँ'
      : lang === 'gu'
      ? 'ઘરે અપનાવી શકાય તેવા વ્યવહારુ, પગલાં-દર-પગલાંના માર્ગદર્શનો'
      : 'Practical, step-by-step guides you can follow at home';

  const title = t('more.education') || 'Patient Education';
  const topicsLabel = lang === 'hi' ? 'विषय' : lang === 'gu' ? 'વિષયો' : 'topics';
  const loadingLabel = lang === 'hi' ? 'लोड हो रहा है…' : lang === 'gu' ? 'લોડ થઈ રહ્યું છે…' : 'Loading…';
  const searchPlaceholder =
    lang === 'hi'
      ? 'विषय, बीमारियाँ खोजें…'
      : lang === 'gu'
      ? 'વિષય, રોગો શોધો…'
      : 'Search topics, diseases…';
  const noResultsLabel =
    lang === 'hi' ? 'कोई मिलान नहीं मिला' : lang === 'gu' ? 'કોઈ પરિણામ મળ્યું નથી' : 'No matches found';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="education-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>{title}</Text>
        <LanguageDropdown testID="education-lang" />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Compact hero header */}
        <View style={styles.heroWrap}>
          <View style={styles.hero}>
            <View style={styles.heroIconCircle}>
              <Ionicons name="book" size={22} color="#fff" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroTitle} numberOfLines={1}>{title}</Text>
              <Text style={styles.heroSub} numberOfLines={2}>{subtitle}</Text>
            </View>
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeNum}>{items.length}</Text>
              <Text style={styles.heroBadgeText}>{topicsLabel}</Text>
            </View>
          </View>
        </View>

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <SmartSearch
            placeholder={searchPlaceholder}
            onDebouncedChange={setQuery}
            testID="education-search"
          />
          {query.length > 0 && (
            <Text style={styles.searchMeta}>
              {filtered.length} / {items.length}
            </Text>
          )}
        </View>

        {loading && items.length === 0 ? (
          <Text style={styles.loading}>{loadingLabel}</Text>
        ) : filtered.length === 0 ? (
          <View style={styles.noResults}>
            <Ionicons name="search-outline" size={36} color={COLORS.textSecondary} />
            <Text style={styles.noResultsText}>{noResultsLabel}</Text>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {filtered.map((it) => (
              <TouchableOpacity
                key={it.id}
                onPress={() => router.push(`/education/${it.id}` as any)}
                activeOpacity={0.85}
                style={styles.card}
                testID={`education-${it.id}`}
              >
                <View style={styles.imgFrame}>
                  <Image source={{ uri: it.cover }} style={styles.cardImg} resizeMode="contain" />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{it.title}</Text>
                  <Text style={styles.cardSum} numberOfLines={2}>{it.summary}</Text>
                </View>
                <View style={styles.chevron}>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  topTitle: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1, fontSize: 20 },

  /* Compact hero */
  heroWrap: { paddingHorizontal: 16, marginTop: 8, marginBottom: 12 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: 14,
  },
  heroIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroTitle: { ...FONTS.h3, color: '#fff', fontSize: 16 },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 2, lineHeight: 15 },
  heroBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    minWidth: 54,
  },
  heroBadgeNum: { ...FONTS.h3, color: '#fff', fontSize: 18, lineHeight: 22 },
  heroBadgeText: { ...FONTS.label, color: '#fff', fontSize: 9, letterSpacing: 0.5, marginTop: -2 },

  /* Compact list */
  listWrap: { paddingHorizontal: 16, gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#0B3142',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  imgFrame: {
    width: 104,
    aspectRatio: 4 / 3, // -> 78h when width=104
    backgroundColor: ART_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImg: { width: '100%', height: '100%' },
  cardBody: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, minWidth: 0 },
  cardTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14, lineHeight: 19 },
  cardSum: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 16 },
  chevron: { paddingRight: 12, paddingLeft: 2 },
  loading: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 40, textAlign: 'center' },
  searchWrap: { paddingHorizontal: 16, marginBottom: 12, gap: 6 },
  searchMeta: {
    ...FONTS.label,
    color: COLORS.textSecondary,
    fontSize: 11,
    paddingHorizontal: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  noResults: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
    gap: 10,
  },
  noResultsText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
});
