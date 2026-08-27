/**
 * /guides/[surgery] — Patient-facing surgery guide with 4 tabs:
 *   Pre-op | Day-of | Post-op | Diet
 * Plus a "Recovery Timeline" + "Do's & Don'ts" sticky strip.
 *
 * Trilingual via i18n locale picker (en / hi / gu).
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
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { shareLink } from '../../src/share';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';

type Trilingual = { en?: string; hi?: string; gu?: string };

type DietBlock = { preop?: Trilingual[]; postop?: Trilingual[] };
type DosDonts = { dos?: Trilingual[]; donts?: Trilingual[] };

type Milestone = { day: number; en?: string; hi?: string; gu?: string };

type Guide = {
  key: string;
  name: Trilingual;
  duration_minutes?: number;
  hospital_stay_days?: number;
  preop?: Trilingual[];
  day_of?: Trilingual[];
  postop?: Trilingual[];
  diet?: DietBlock;
  recovery_milestones?: Milestone[];
  dos_donts?: DosDonts;
};

type Tab = 'preop' | 'day_of' | 'postop' | 'diet';

const TABS: { key: Tab; label: Trilingual; icon: any; family: 'ion' | 'mci' | 'fa' }[] = [
  { key: 'preop',  label: { en: 'Before Surgery', hi: 'सर्जरी से पहले', gu: 'સર્જરી પહેલા' },      icon: 'shield-checkmark-outline', family: 'ion' },
  { key: 'day_of', label: { en: 'Day of Surgery', hi: 'सर्जरी का दिन',  gu: 'સર્જરી નો દિવસ' },     icon: 'sunny-outline',            family: 'ion' },
  { key: 'postop', label: { en: 'After Surgery',  hi: 'सर्जरी के बाद',   gu: 'સર્જરી પછી' },         icon: 'medkit-outline',           family: 'ion' },
  { key: 'diet',   label: { en: 'Diet',           hi: 'आहार',            gu: 'આહાર' },               icon: 'food-apple',               family: 'mci' },
];

function pick(t: Trilingual | undefined, lang: 'en' | 'hi' | 'gu'): string {
  if (!t) return '';
  return (t[lang] || t.en || '').toString();
}

export default function GuideScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ surgery: string }>();
  const { lang } = useI18n();
  const slug = (params.surgery || '').toString().toLowerCase();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [tab, setTab] = useState<Tab>('preop');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/guides/${encodeURIComponent(slug)}`);
      setGuide(r.data);
    } catch {
      setGuide(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const L = (lang as 'en' | 'hi' | 'gu') || 'en';

  const items: Trilingual[] = useMemo(() => {
    if (!guide) return [];
    if (tab === 'preop') return guide.preop || [];
    if (tab === 'day_of') return guide.day_of || [];
    if (tab === 'postop') return guide.postop || [];
    return [];
  }, [guide, tab]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (!guide) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{L === 'hi' ? 'गाइड नहीं मिली' : L === 'gu' ? 'માર્ગદર્શિકા મળી નથી' : 'Guide not found'}</Text>
        </View>
        <View style={{ padding: 24, alignItems: 'center' }}>
          <MaterialCommunityIcons name="file-search-outline" size={56} color={COLORS.textTertiary} />
          <Text style={styles.emptyTitle}>{L === 'hi' ? 'इस सर्जरी के लिए गाइड उपलब्ध नहीं है' : L === 'gu' ? 'આ સર્જરી માટે માર્ગદર્શિકા ઉપલબ્ધ નથી' : 'No guide available for this surgery yet.'}</Text>
          <TouchableOpacity style={styles.browseBtn} onPress={() => router.replace('/guides' as any)}>
            <Text style={styles.browseBtnText}>{L === 'hi' ? 'सभी गाइड देखें' : L === 'gu' ? 'બધી માર્ગદર્શિકાઓ જુઓ' : 'Browse all guides'}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* Hero */}
      <LinearGradient colors={[COLORS.primary, COLORS.primaryDark]} style={styles.hero}>
        <View style={styles.heroTop}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.heroPill}>{L === 'hi' ? 'मरीज़ गाइड' : L === 'gu' ? 'દર્દી માર્ગદર્શિકા' : 'PATIENT GUIDE'}</Text>
          <TouchableOpacity
            onPress={() => shareLink({
              kind: 'guide',
              ident: slug,
              title: `${pick(guide.name, L)} — Patient Guide`,
              description: L === 'hi' ? 'सर्जरी से पहले, दौरान और बाद में क्या करें।'
                : L === 'gu' ? 'સર્જરી પહેલા, દરમિયાન અને પછી શું અપેક્ષા રાખવી.'
                : 'What to expect before, during and after your procedure.',
            })}
            style={styles.backBtn}
            testID="guide-share"
          >
            <Ionicons name="share-social" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={styles.heroTitle}>{pick(guide.name, L)}</Text>
        <View style={styles.heroMeta}>
          {guide.duration_minutes ? (
            <View style={styles.metaPill}>
              <Ionicons name="time-outline" size={12} color="#fff" />
              <Text style={styles.metaPillText}>~{guide.duration_minutes} min</Text>
            </View>
          ) : null}
          {guide.hospital_stay_days ? (
            <View style={styles.metaPill}>
              <Ionicons name="bed-outline" size={12} color="#fff" />
              <Text style={styles.metaPillText}>{guide.hospital_stay_days} {L === 'hi' ? 'दिन भर्ती' : L === 'gu' ? 'દિવસ દાખલ' : 'day stay'}</Text>
            </View>
          ) : null}
        </View>
      </LinearGradient>

      {/* Tabs — equal-width, fixed layout (no shift on select) */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const on = tab === t.key;
          const IconEl = t.family === 'mci' ? MaterialCommunityIcons : (t.family === 'fa' ? FontAwesome5 : Ionicons);
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, on && styles.tabBtnActive]}
              onPress={() => setTab(t.key)}
              testID={`guide-tab-${t.key}`}
              activeOpacity={0.8}
            >
              <IconEl name={t.icon as any} size={13} color={on ? '#fff' : COLORS.primary} />
              <Text
                style={[styles.tabBtnText, on && { color: '#fff' }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {pick(t.label, L)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* Tab content */}
        {tab !== 'diet' ? (
          <View style={{ gap: 10 }}>
            {items.length === 0 ? (
              <Text style={styles.empty}>{L === 'hi' ? 'इस अनुभाग के लिए कोई जानकारी नहीं' : L === 'gu' ? 'આ વિભાગ માટે કોઈ માહિતી નથી' : 'No information for this section.'}</Text>
            ) : (
              items.map((it, i) => (
                <View key={i} style={styles.card}>
                  <View style={styles.cardBullet}>
                    <Text style={styles.cardBulletText}>{i + 1}</Text>
                  </View>
                  <Text style={styles.cardText}>{pick(it, L)}</Text>
                </View>
              ))
            )}
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            <DietSection
              title={L === 'hi' ? 'सर्जरी से पहले' : L === 'gu' ? 'સર્જરી પહેલા' : 'Before Surgery'}
              items={guide.diet?.preop || []}
              icon="restaurant-outline"
              color="#0EA5E9"
              lang={L}
            />
            <DietSection
              title={L === 'hi' ? 'सर्जरी के बाद' : L === 'gu' ? 'સર્જરી પછી' : 'After Surgery'}
              items={guide.diet?.postop || []}
              icon="leaf-outline"
              color="#16a34a"
              lang={L}
            />
          </View>
        )}

        {/* Recovery Timeline */}
        {tab === 'postop' && guide.recovery_milestones?.length ? (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.sectionTitle}>{L === 'hi' ? 'रिकवरी टाइमलाइन' : L === 'gu' ? 'રિકવરી ટાઈમલાઈન' : 'Recovery Timeline'}</Text>
            <View style={styles.timeline}>
              {guide.recovery_milestones.map((m, i) => (
                <View key={i} style={styles.timelineRow}>
                  <View style={styles.timelineDot}>
                    <Text style={styles.timelineDayNum}>{m.day}</Text>
                    <Text style={styles.timelineDayLabel}>{L === 'hi' ? 'दिन' : L === 'gu' ? 'દિવસ' : 'day'}</Text>
                  </View>
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineText}>
                    <Text style={styles.timelineBody}>{m[L as 'en' | 'hi' | 'gu'] || m.en}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Do's & Don'ts */}
        {guide.dos_donts && (guide.dos_donts.dos?.length || guide.dos_donts.donts?.length) ? (
          <View style={{ marginTop: 22 }}>
            <Text style={styles.sectionTitle}>{L === 'hi' ? 'क्या करें / क्या न करें' : L === 'gu' ? 'શું કરવું / શું ન કરવું' : "Do's & Don'ts"}</Text>
            <View style={styles.ddRow}>
              <DDColumn
                title={L === 'hi' ? 'करें' : L === 'gu' ? 'કરો' : 'Do'}
                items={guide.dos_donts.dos || []}
                color="#16a34a"
                icon="checkmark"
                lang={L}
              />
              <DDColumn
                title={L === 'hi' ? 'न करें' : L === 'gu' ? 'ન કરો' : "Don't"}
                items={guide.dos_donts.donts || []}
                color="#dc2626"
                icon="close"
                lang={L}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.disclaimer}>
          <Ionicons name="information-circle" size={14} color={COLORS.textSecondary} />
          <Text style={styles.disclaimerText}>
            {L === 'hi' ? 'यह सामान्य गाइडलाइन है। डॉक्टर की सलाह को प्राथमिकता दें।' : L === 'gu' ? 'આ સામાન્ય માર્ગદર્શિકા છે. ડૉક્ટરની સલાહને પ્રાધાન્ય આપો.' : 'These are general guidelines. Always follow your doctor’s specific advice.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DietSection({ title, items, icon, color, lang }: { title: string; items: Trilingual[]; icon: any; color: string; lang: 'en' | 'hi' | 'gu' }) {
  if (items.length === 0) return null;
  return (
    <View style={[styles.card, { flexDirection: 'column', alignItems: 'stretch', borderLeftWidth: 4, borderLeftColor: color }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Ionicons name={icon} size={16} color={color} />
        <Text style={[styles.cardTitle, { color }]}>{title}</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
          <Text style={{ color }}>•</Text>
          <Text style={[styles.cardText, { flex: 1 }]}>{pick(it, lang)}</Text>
        </View>
      ))}
    </View>
  );
}

function DDColumn({ title, items, color, icon, lang }: { title: string; items: Trilingual[]; color: string; icon: any; lang: 'en' | 'hi' | 'gu' }) {
  return (
    <View style={[styles.ddCol, { borderColor: color + '55' }]}>
      <View style={[styles.ddHeader, { backgroundColor: color }]}>
        <Ionicons name={icon} size={14} color="#fff" />
        <Text style={styles.ddHeaderText}>{title}</Text>
      </View>
      <View style={{ padding: 10, gap: 6 }}>
        {items.length === 0 ? (
          <Text style={styles.empty}>—</Text>
        ) : items.map((it, i) => (
          <Text key={i} style={styles.ddItem}>• {pick(it, lang)}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: { padding: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)' },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: COLORS.primary, gap: 12 },
  headerTitle: { color: '#fff', ...FONTS.h2, fontSize: 17 },
  heroPill: { color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 2 },
  heroTitle: { color: '#fff', ...FONTS.h1, fontSize: 22, marginTop: 8 },
  heroMeta: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  metaPillText: { color: '#fff', fontSize: 11.5, fontWeight: '600' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff',
  },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 11.5, flexShrink: 1 },

  card: {
    flexDirection: 'row', gap: 10, padding: 12, backgroundColor: '#fff',
    borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  cardBullet: { width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' },
  cardBulletText: { color: COLORS.primary, fontWeight: '800', fontSize: 11 },
  cardTitle: { ...FONTS.bodyMedium, fontSize: 14 },
  cardText: { color: COLORS.textPrimary, fontSize: 13.5, lineHeight: 20 },

  sectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 10, fontSize: 15 },

  timeline: { paddingLeft: 4 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  timelineDot: { width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  timelineDayNum: { color: '#fff', fontWeight: '800', fontSize: 16 },
  timelineDayLabel: { color: '#fff', fontSize: 8.5, opacity: 0.85, marginTop: -2 },
  timelineLine: { width: 12, height: 2, backgroundColor: COLORS.primary + '55' },
  timelineText: { flex: 1, backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border },
  timelineBody: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },

  ddRow: { flexDirection: 'row', gap: 10 },
  ddCol: { flex: 1, backgroundColor: '#fff', borderRadius: RADIUS.card, borderWidth: 1, overflow: 'hidden' },
  ddHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8 },
  ddHeaderText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  ddItem: { color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 },

  empty: { color: COLORS.textTertiary, fontSize: 12.5, textAlign: 'center', paddingVertical: 12 },
  emptyTitle: { color: COLORS.textPrimary, fontSize: 14, textAlign: 'center', marginTop: 12 },
  browseBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.button, marginTop: 12 },
  browseBtnText: { color: '#fff', fontWeight: '700' },

  disclaimer: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', padding: 10, backgroundColor: '#f1f5f9', borderRadius: RADIUS.card, marginTop: 20 },
  disclaimerText: { color: COLORS.textSecondary, fontSize: 11, flex: 1, lineHeight: 16 },
});
