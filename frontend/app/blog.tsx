import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../src/api';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useI18n } from '../src/i18n';
import { displayDate } from '../src/date';
import SmartSearch from '../src/smart-search';

export default function Blog() {
  const router = useRouter();
  const [posts, setPosts] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const { t, lang, setLang } = useI18n();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter((p) => {
      const hay = [p.title, p.excerpt, p.category, ...(Array.isArray(p.tags) ? p.tags : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [posts, query]);

  const searchPlaceholder =
    lang === 'hi'
      ? 'पोस्ट, श्रेणियाँ खोजें…'
      : lang === 'gu'
      ? 'પોસ્ટ, શ્રેણીઓ શોધો…'
      : 'Search posts, categories…';
  const noResultsLabel =
    lang === 'hi' ? 'कोई मिलान नहीं मिला' : lang === 'gu' ? 'કોઈ પરિણામ મળ્યું નથી' : 'No matches found';

  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';

  const load = useCallback(async () => {
    try {
      const r = await api.get('/blog');
      setPosts(r.data);
    } catch {}
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="blog-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('blog.title')}</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={cycleLang}
          style={styles.langBtn}
          testID="blog-lang"
          accessibilityLabel={`Language: ${lang}`}
        >
          <Text style={styles.langBadgeText} allowFontScaling={false}>
            {langBadge}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 60, alignItems: 'center' }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        <View style={{ width: '100%', maxWidth: 680 }}>
          <Text style={styles.subtitle}>{t('blog.listSubtitle')}</Text>

          <SmartSearch
            placeholder={searchPlaceholder}
            onDebouncedChange={setQuery}
            testID="blog-search"
            style={{ marginBottom: 16 }}
          />

          {posts.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="newspaper-outline" size={36} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>{t('blog.noPosts')}</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={36} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>{noResultsLabel}</Text>
            </View>
          ) : null}

          {filtered.map((p) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => router.push(`/blog/${p.id}` as any)}
              activeOpacity={0.85}
              style={styles.card}
              testID={`blog-post-${p.id}`}
            >
              {!!p.cover && <Image source={{ uri: p.cover }} style={styles.cover} resizeMode="cover" />}
              <View style={{ padding: 14 }}>
                {p.category ? (
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryText}>{p.category}</Text>
                  </View>
                ) : null}
                <Text style={styles.postTitle}>{p.title}</Text>
                {p.excerpt ? (
                  <Text style={styles.postExcerpt} numberOfLines={2}>{p.excerpt}</Text>
                ) : null}
                <View style={styles.postMeta}>
                  <Ionicons name="calendar-outline" size={12} color={COLORS.textSecondary} />
                  <Text style={styles.postDate}>{displayDate(p.published_at)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
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
  langBtn: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  langBadgeText: {
    color: COLORS.primary,
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.5,
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 16 },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cover: { width: '100%', height: 200, backgroundColor: COLORS.bg },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary + '18',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  categoryText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  postTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 8, lineHeight: 22 },
  postExcerpt: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, lineHeight: 20 },
  postMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  postDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
});
