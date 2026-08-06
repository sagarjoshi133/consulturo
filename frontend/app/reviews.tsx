/**
 * /reviews — public landing showing the full featured reviews grid
 * + a CTA "Write your own review" pointing to the clinic's Google
 * review URL. Premium themed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  Dimensions,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome, MaterialCommunityIcons } from '@expo/vector-icons';
import api from '../src/api';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useDarkMode } from '../src/dark-mode';

type Review = {
  id: string;
  reviewer_name: string;
  reviewer_avatar_url?: string | null;
  rating: number;
  text: string;
  source?: string;
  review_date?: string;
  location?: string | null;
};

type Cta = {
  enabled: boolean;
  review_url?: string;
  maps_url?: string;
  tagline?: string;
  clinic_name?: string;
  // Canonical Google numbers — sourced from the latest pull-google
  // call and cached server-side. When present, the patient page
  // displays "4.8 ★ based on 36 reviews" instead of averaging only
  // the locally-stored sample.
  google_rating?: number | null;
  google_total_ratings?: number | null;
  google_place_name?: string | null;
};

export default function ReviewsPage() {
  const router = useRouter();
  const darkMode = useDarkMode();
  const [items, setItems] = useState<Review[]>([]);
  const [cta, setCta] = useState<Cta | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const win = Dimensions.get('window');
  const isWide = win.width >= 720;

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        api.get('/featured-reviews'),
        api.get('/featured-reviews/cta'),
      ]);
      setItems(r.data?.items || []);
      setCta(c.data || null);
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Prefer canonical Google numbers when available (sourced from the
  // last successful pull-google sync, cached in clinic_settings).
  // Fall back to averaging the locally-stored sample so the page is
  // never empty on a brand-new install.
  const avg = (typeof cta?.google_rating === 'number' && cta.google_rating > 0)
    ? cta.google_rating
    : (items.length > 0
        ? items.reduce((s, r) => s + (r.rating || 0), 0) / items.length
        : 5);
  const totalCount = (typeof cta?.google_total_ratings === 'number' && cta.google_total_ratings > 0)
    ? cta.google_total_ratings
    : items.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: darkMode.effective === 'dark' ? darkMode.colors.bg : '#fffbeb' }}>
      <LinearGradient colors={['#fef3c7', '#fff7ed']} style={styles.hero}>
        <View style={styles.heroRow}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#7c2d12" />
          </TouchableOpacity>
          <Text style={styles.heroTitle}>Patient Reviews</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.ratingSummary}>
          <Text style={styles.bigRating}>{avg.toFixed(1)}</Text>
          <View style={{ alignItems: 'flex-start' }}>
            <View style={{ flexDirection: 'row' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <FontAwesome
                  key={i}
                  name={avg >= i + 0.5 ? 'star' : 'star-o'}
                  size={20}
                  color="#f59e0b"
                  style={{ marginRight: 2 }}
                />
              ))}
            </View>
            <Text style={styles.basedOn}>Based on {totalCount} verified review{totalCount === 1 ? '' : 's'}</Text>
          </View>
        </View>
        {cta?.review_url ? (
          <View style={styles.heroBtnRow}>
            <TouchableOpacity
              style={styles.primaryCta}
              onPress={() => Linking.openURL(cta.review_url!)}
              testID="reviews-write-cta"
            >
              <FontAwesome name="google" size={14} color="#fff" />
              <Text style={styles.primaryCtaText}>Write a Google Review</Text>
            </TouchableOpacity>
            {cta?.maps_url ? (
              <TouchableOpacity
                style={styles.secondaryCta}
                onPress={() => Linking.openURL(cta.maps_url!)}
                testID="reviews-maps-cta"
              >
                <MaterialCommunityIcons name="map-marker" size={14} color="#7c2d12" />
                <Text style={styles.secondaryCtaText}>View on Maps</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </LinearGradient>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        {items.length === 0 ? (
          <View style={styles.emptyCard}>
            <FontAwesome name="star-o" size={36} color="#fcd34d" />
            <Text style={styles.emptyTitle}>No reviews yet</Text>
            <Text style={styles.emptyText}>Be the first to leave a Google review!</Text>
          </View>
        ) : (
          <View style={[styles.grid, isWide && styles.gridWide]}>
            {items.map((r) => (
              <ReviewCard key={r.id} review={r} isWide={isWide} />
            ))}
          </View>
        )}

        {/* Bottom "Write a review" CTA — a second prompt for users
            who scrolled through every review. Wrapped in a soft
            gradient card so it doesn't compete with the hero CTA but
            stays unmissable at the end of the page. */}
        {cta?.review_url ? (
          <LinearGradient
            colors={['#fff7ed', '#fef3c7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.bottomCta}
          >
            <FontAwesome name="quote-left" size={22} color="#f59e0b" />
            <Text style={styles.bottomCtaTitle}>Loved your visit?</Text>
            <Text style={styles.bottomCtaSub}>
              Your honest review on Google helps fellow patients find quality urology care.
            </Text>
            <TouchableOpacity
              style={styles.bottomCtaBtn}
              onPress={() => Linking.openURL(cta.review_url!)}
              testID="reviews-bottom-write-cta"
            >
              <FontAwesome name="google" size={13} color="#fff" />
              <Text style={styles.bottomCtaBtnText}>Write a Google Review</Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </TouchableOpacity>
          </LinearGradient>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewCard({ review, isWide }: { review: Review; isWide: boolean }) {
  const initial = (review.reviewer_name || '?').trim().charAt(0).toUpperCase();
  return (
    <LinearGradient
      colors={['#ffffff', '#fffbeb']}
      style={[styles.card, isWide && styles.cardWide]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        {review.reviewer_avatar_url ? (
          <Image source={{ uri: review.reviewer_avatar_url }} style={styles.avatar} />
        ) : (
          <LinearGradient colors={['#f97316', '#dc2626']} style={styles.avatar}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </LinearGradient>
        )}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={styles.name}>{review.reviewer_name}</Text>
          <View style={{ flexDirection: 'row', marginTop: 2 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <FontAwesome
                key={i}
                name="star"
                size={11}
                // Use the EXACT rating Google returned (integer 1-5).
                // Previous code defaulted to 5 stars when `rating` was
                // 0/undefined, causing a row with no Google rating to
                // incorrectly show a perfect score. Now we render
                // only the gold stars Google actually reported.
                color={i < Math.round(Number(review.rating) || 0) ? '#f59e0b' : '#fef3c7'}
                style={{ marginRight: 1 }}
              />
            ))}
          </View>
        </View>
        <View style={styles.sourcePill}>
          <FontAwesome name="google" size={9} color="#1f2937" />
          <Text style={styles.sourceText}>Google</Text>
        </View>
      </View>
      <Text style={styles.body}>{review.text}</Text>
      <Text style={styles.metaBottom}>
        {review.review_date ? formatDate(review.review_date) : ''}
        {review.location ? ` · ${review.location}` : ''}
      </Text>
    </LinearGradient>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 8 },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  backBtn: { padding: 6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.6)' },
  heroTitle: { ...FONTS.h2, color: '#7c2d12', fontSize: 18 },
  ratingSummary: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  bigRating: { fontSize: 56, fontWeight: '800', color: '#7c2d12' },
  basedOn: { color: '#9a3412', fontSize: 12, marginTop: 4 },
  heroBtnRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  primaryCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#4285F4', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
  },
  primaryCtaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  secondaryCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff7ed', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: '#fcd34d',
  },
  secondaryCtaText: { color: '#7c2d12', fontWeight: '700', fontSize: 13 },

  grid: { gap: 12 },
  gridWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    padding: 14, borderRadius: RADIUS.card, borderWidth: 1, borderColor: '#fcd34d',
    ...Platform.select({
      ios: { shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8 },
      android: { elevation: 2 },
      web: { boxShadow: '0 6px 18px rgba(245, 158, 11, 0.15)' as any },
    }),
  },
  cardWide: { width: '48.5%' },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: '#fff', fontWeight: '700', fontSize: 14 },
  name: { ...FONTS.bodyMedium, color: '#7c2d12', fontSize: 13 },
  body: { ...FONTS.body, color: '#7c2d12', fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  metaBottom: { color: '#9a3412', fontSize: 10.5, opacity: 0.7, marginTop: 8 },
  sourcePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fff', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: '#fcd34d' },
  sourceText: { fontSize: 9.5, fontWeight: '700', color: '#1f2937' },

  emptyCard: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { ...FONTS.h3, color: '#7c2d12' },
  emptyText: { color: '#9a3412', fontSize: 13 },

  bottomCta: {
    marginTop: 24,
    padding: 20,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: '#fcd34d',
    alignItems: 'center',
    gap: 8,
    ...Platform.select({
      ios: { shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 3 },
      web: { boxShadow: '0 8px 20px rgba(245, 158, 11, 0.18)' as any },
    }),
  },
  bottomCtaTitle: { ...FONTS.h3, color: '#7c2d12', fontSize: 16, marginTop: 4 },
  bottomCtaSub: {
    ...FONTS.body,
    color: '#9a3412',
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 6,
  },
  bottomCtaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#4285F4', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 999,
    marginTop: 4,
  },
  bottomCtaBtnText: { color: '#fff', fontWeight: '800', fontSize: 13.5 },
});
