/**
 * FeaturedReviewsCarousel — premium horizontal carousel for the
 * patient home screen. Pulls /api/featured-reviews and renders 1
 * card at a time (auto-advances every 6s, with manual swipe).
 *
 * Card design:
 *   • Gradient bg (gold → amber) — premium feel.
 *   • 5-star row in gold.
 *   • Italic, large quote.
 *   • Reviewer avatar + name + date + location + source badge.
 *   • Tap → opens dedicated /reviews route.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Image,
  Animated,
  Linking,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from './api';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';

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

export default function FeaturedReviewsCarousel() {
  const router = useRouter();
  const { user } = useAuth() as any;
  const [items, setItems] = useState<Review[]>([]);
  const [cta, setCta] = useState<{ review_url?: string; maps_url?: string; clinic_name?: string } | null>(null);
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const width = Math.min(Dimensions.get('window').width - 32, 540);

  // Auto-hide for owner / staff — reviews are a patient-facing
  // testimonial surface only.
  const STAFF_ROLES = new Set([
    'super_owner', 'primary_owner', 'owner', 'partner',
    'doctor', 'assistant', 'reception', 'nursing',
  ]);
  const isStaff = !!(user?.role && STAFF_ROLES.has(user.role));

  useEffect(() => {
    if (isStaff) { setItems([]); setCta(null); return; }
    let cancelled = false;
    Promise.all([
      api.get('/featured-reviews').then((r) => r.data?.items || []).catch(() => []),
      api.get('/featured-reviews/cta').then((r) => r.data || {}).catch(() => ({})),
    ]).then(([rows, c]) => {
      if (cancelled) return;
      setItems(rows);
      setCta(c);
    });
    return () => { cancelled = true; };
  }, [isStaff]);

  // Auto-advance every 6 seconds.
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % items.length;
        scrollRef.current?.scrollTo({ x: next * width, animated: true });
        return next;
      });
    }, 6000);
    return () => clearInterval(id);
  }, [items.length, width]);

  if (isStaff) return null;
  // Empty state: section is still visible to patients & anonymous
  // users (per user spec) — invite them to be the first reviewer.
  // Renders an inviting card even when no `review_url` is configured
  // yet, so the homepage section between Latest Videos and Connect
  // never collapses.
  if (items.length === 0) {
    return <EmptyReviewsCta cta={cta || {}} />;
  }

  return (
    <View style={styles.wrap} testID="featured-reviews-carousel">
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.googleBadge}>
            <FontAwesome name="google" size={14} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>What patients say</Text>
            <Text style={styles.headerSub}>Verified Google reviews</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {cta?.review_url ? (
            <TouchableOpacity
              style={styles.writeBtn}
              onPress={() => Linking.openURL(cta.review_url!)}
              testID="featured-reviews-write-btn"
              accessibilityLabel="Write a Google review"
            >
              <FontAwesome name="google" size={11} color="#fff" />
              <Text style={styles.writeBtnText}>Write a review</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => router.push('/reviews' as any)} style={styles.viewAllBtn}>
            <Text style={styles.viewAllText}>View all</Text>
            <Ionicons name="chevron-forward" size={14} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        snapToInterval={width}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / width);
          setIndex(idx);
        }}
      >
        {items.map((r) => (
          <ReviewCard key={r.id} review={r} width={width} onPress={() => router.push('/reviews' as any)} />
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={styles.dotsRow}>
        {items.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

function ReviewCard({ review, width, onPress }: { review: Review; width: number; onPress: () => void }) {  const initial = (review.reviewer_name || '?').trim().charAt(0).toUpperCase();
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={{ width, paddingHorizontal: 8 }}>
      <LinearGradient
        colors={['#fff7ed', '#fef3c7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Quote icon decorative */}
        <View style={styles.quoteMark}>
          <FontAwesome name="quote-left" size={32} color="#f59e0b" />
        </View>

        {/* Star row — renders the EXACT rating Google returned
            (integer 1-5). We deliberately do NOT fall back to "5"
            on missing data — a row with no rating shows zero stars
            so the carousel never lies about the actual score. */}
        <View style={styles.starRow}>
          {Array.from({ length: 5 }).map((_, i) => (
            <FontAwesome
              key={i}
              name="star"
              size={16}
              color={i < Math.round(Number(review.rating) || 0) ? '#f59e0b' : '#fef3c7'}
              style={{ marginRight: 2 }}
            />
          ))}
        </View>

        <Text style={styles.text} numberOfLines={6}>
          {review.text}
        </Text>

        <View style={styles.footerRow}>
          {review.reviewer_avatar_url ? (
            <Image source={{ uri: review.reviewer_avatar_url }} style={styles.avatar} />
          ) : (
            <LinearGradient
              colors={['#f97316', '#dc2626']}
              style={styles.avatar}
            >
              <Text style={styles.avatarInitial}>{initial}</Text>
            </LinearGradient>
          )}
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.name}>{review.reviewer_name}</Text>
            <View style={styles.metaRow}>
              {review.review_date ? <Text style={styles.meta}>{formatDate(review.review_date)}</Text> : null}
              {review.location ? <Text style={styles.meta}> · {review.location}</Text> : null}
            </View>
          </View>
          <View style={styles.sourcePill}>
            <FontAwesome name="google" size={10} color="#1f2937" />
            <Text style={styles.sourceText}>Google</Text>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

/**
 * EmptyReviewsCta — shown when the clinic hasn't curated any
 * featured reviews yet. Premium gold card inviting the user to be
 * the first to leave a Google review.
 */
function EmptyReviewsCta({ cta }: { cta: { review_url?: string; maps_url?: string; clinic_name?: string } }) {
  const router = useRouter();
  return (
    <View style={[styles.wrap]} testID="featured-reviews-empty-cta">
      <View style={styles.headerRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.googleBadge}>
            <FontAwesome name="google" size={14} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Share your experience</Text>
            <Text style={styles.headerSub}>Your review helps other patients</Text>
          </View>
        </View>
        {cta.maps_url ? (
          <TouchableOpacity onPress={() => Linking.openURL(cta.maps_url!)} style={styles.viewAllBtn}>
            <FontAwesome name="map-marker" size={12} color={COLORS.primary} />
            <Text style={styles.viewAllText}>View on Maps</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: 8 }}>
        <LinearGradient
          colors={['#fff7ed', '#fef3c7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.quoteMark}>
            <FontAwesome name="quote-left" size={32} color="#f59e0b" />
          </View>
          <View style={styles.starRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <FontAwesome key={i} name="star-o" size={16} color="#f59e0b" style={{ marginRight: 2 }} />
            ))}
          </View>
          <Text style={[styles.text, { marginTop: 6 }]}>
            Loved your visit? Be the first to leave a Google review for
            {' '}<Text style={{ fontWeight: '800', fontStyle: 'normal' }}>{cta.clinic_name || 'us'}</Text>.
            Your feedback genuinely helps fellow patients.
          </Text>
          {cta.review_url ? (
            <TouchableOpacity
              style={styles.emptyCtaBtn}
              onPress={() => Linking.openURL(cta.review_url!)}
              testID="featured-reviews-empty-cta-btn"
            >
              <FontAwesome name="google" size={13} color="#fff" />
              <Text style={styles.emptyCtaBtnText}>Write the first review</Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.emptyCtaBtn, { backgroundColor: COLORS.primary }]}
              onPress={() => router.push('/reviews' as any)}
              testID="featured-reviews-empty-cta-btn"
            >
              <Ionicons name="chatbubbles" size={13} color="#fff" />
              <Text style={styles.emptyCtaBtnText}>Share feedback</Text>
              <Ionicons name="arrow-forward" size={14} color="#fff" />
            </TouchableOpacity>
          )}
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  googleBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#4285F4',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 16 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginTop: 1 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { color: COLORS.primary, fontWeight: '700', fontSize: 12.5 },
  writeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#4285F4', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  writeBtnText: { color: '#fff', fontWeight: '700', fontSize: 11.5 },

  card: {
    padding: 18,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: '#fcd34d',
    minHeight: 200,
    ...Platform.select({
      ios: { shadowColor: '#f59e0b', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16 },
      android: { elevation: 4 },
      web: { boxShadow: '0 10px 30px rgba(245, 158, 11, 0.2)' as any },
    }),
  },
  quoteMark: { position: 'absolute', top: 12, right: 16, opacity: 0.45 },
  starRow: { flexDirection: 'row', marginBottom: 10 },
  text: { ...FONTS.body, color: '#9a3412', fontSize: 14, lineHeight: 21, fontStyle: 'italic' },

  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name: { ...FONTS.bodyMedium, color: '#7c2d12', fontSize: 13.5 },
  metaRow: { flexDirection: 'row', marginTop: 2 },
  meta: { color: '#9a3412', fontSize: 11, opacity: 0.8 },
  sourcePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: '#fcd34d',
  },
  sourceText: { fontSize: 10.5, fontWeight: '700', color: '#1f2937' },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 10, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fcd34d' },
  dotActive: { width: 18, backgroundColor: '#f59e0b' },

  emptyCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: '#4285F4',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  emptyCtaBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
});
