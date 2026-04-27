import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';
import { Skeleton } from '../../src/skeleton';

type Disease = { id: string; name: string; icon: string; tagline: string };

export default function Diseases() {
  const router = useRouter();
  const { lang } = useI18n();
  const [items, setItems] = useState<Disease[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/diseases', { params: { lang: lang || 'en' } });
      if (Array.isArray(r.data)) setItems(r.data);
      else setError('Unexpected response');
    } catch (e: any) {
      setError(e?.message || 'Could not load conditions. Pull to retry.');
      // Keep any previously-loaded items instead of wiping the list
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = items.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  const title =
    lang === 'hi' ? 'यूरोलॉजी रोग' : lang === 'gu' ? 'યુરોલોજી રોગો' : 'Urological Conditions';
  const subtitle =
    lang === 'hi'
      ? 'अधिक जानने के लिए किसी भी रोग पर टैप करें'
      : lang === 'gu'
      ? 'વધુ જાણવા કોઈ પણ રોગ પર ટૅપ કરો'
      : 'Tap any condition to learn more';
  const searchPh =
    lang === 'hi' ? 'रोग खोजें...' : lang === 'gu' ? 'રોગ શોધો...' : 'Search conditions...';

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <LanguageDropdown testID="diseases-lang" />
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={COLORS.textSecondary} />
        <TextInput
          placeholder={searchPh}
          placeholderTextColor={COLORS.textDisabled}
          value={q}
          onChangeText={setQ}
          style={styles.search}
          testID="diseases-search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={
          <RefreshControl
            refreshing={loading && items.length === 0}
            onRefresh={load}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        ListEmptyComponent={
          loading && items.length === 0 ? (
            <View style={{ padding: 0 }} testID="diseases-loading">
              {Array.from({ length: 7 }).map((_, idx) => (
                <View key={idx} style={[styles.row, { marginBottom: 12 }]}>
                  <Skeleton w={48} h={48} br={14} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <Skeleton w="55%" h={16} />
                    <Skeleton w="85%" h={12} />
                  </View>
                </View>
              ))}
            </View>
          ) : error ? (
            <View style={styles.empty} testID="diseases-error">
              <Ionicons name="cloud-offline-outline" size={36} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity onPress={load} style={styles.retryBtn} testID="diseases-retry">
                <Text style={styles.retryText}>Tap to retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="medkit-outline" size={36} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>
                {q ? 'No conditions match your search.' : 'No conditions available yet.'}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push(`/disease/${item.id}` as any)}
            style={styles.row}
            testID={`disease-list-item-${item.id}`}
          >
            <View style={styles.iconWrap}>
              <MaterialCommunityIcons
                name={(item.icon as any) || 'medical-bag'}
                size={24}
                color={COLORS.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.tag} numberOfLines={2}>{item.tagline}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  search: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, paddingVertical: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    padding: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...FONTS.h4, color: COLORS.textPrimary },
  tag: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 2, fontSize: 13 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  retryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
