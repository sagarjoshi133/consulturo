/**
 * /c/<slug> — Public clinic landing page.
 *
 * Phase C of the multi-tenant rollout. Rendered for ANYONE (no auth
 * required) who knows the clinic's URL slug.
 *
 * Polished v2:
 *  • Curved-bottom hero with prominent white CTA.
 *  • Quick-action chips (call · WhatsApp · directions · email) when
 *    the clinic has those fields filled in.
 *  • Initials avatar fallback when there's no logo.
 *  • Subtle entrance animations via react-native-reanimated.
 *  • Quick-tile grid with shadows + better hierarchy.
 *  • Sticky "Book a consultation" CTA at the bottom on tall screens.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import api from '../../src/api';

type PublicClinic = {
  clinic_id: string;
  slug: string;
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  branding?: Record<string, any>;
  is_active?: boolean;
};

const COLORS = {
  primary: '#0F4C75',
  accent: '#1FA1B7',
  bg: '#F4F8FB',
  card: '#FFFFFF',
  border: '#E5EAF0',
  text: '#1A2E35',
  sub: '#7A8A98',
  whatsapp: '#25D366',
};

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function digitsOnly(s: string): string {
  return (s || '').replace(/[^\d+]/g, '');
}

export default function ClinicLanding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = String(Array.isArray(params.slug) ? params.slug[0] : params.slug || '').toLowerCase();
  const [clinic, setClinic] = useState<PublicClinic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setLoading(false);
      setError('No clinic specified.');
      return;
    }
    (async () => {
      try {
        const r = await api.get(`/clinics/by-slug/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        setClinic(r.data);
      } catch (e: any) {
        if (cancelled) return;
        const status = e?.response?.status;
        if (status === 404) setError(`No clinic with the URL "${slug}".`);
        else setError(e?.response?.data?.detail || 'Could not load clinic.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const goBook = () => {
    router.push(`/book?clinic=${encodeURIComponent(slug)}` as any);
  };

  const branding = clinic?.branding || {};
  const heroBg = (branding as any)?.hero_color || COLORS.primary;
  const accent = (branding as any)?.accent_color || COLORS.accent;
  const logo = (branding as any)?.logo_url || '';
  const mapUrl = (branding as any)?.map_url as string | undefined;
  const whatsapp = (branding as any)?.whatsapp as string | undefined;

  const quickActions = useMemo(() => {
    if (!clinic) return [] as { key: string; label: string; icon: any; color: string; onPress: () => void }[];
    const out: { key: string; label: string; icon: any; color: string; onPress: () => void }[] = [];
    if (clinic.phone) {
      out.push({
        key: 'call',
        label: 'Call',
        icon: 'phone',
        color: COLORS.primary,
        onPress: () => Linking.openURL(`tel:${digitsOnly(clinic.phone!)}`),
      });
    }
    if (whatsapp) {
      out.push({
        key: 'wa',
        label: 'WhatsApp',
        icon: 'message-circle',
        color: COLORS.whatsapp,
        onPress: () => {
          const num = digitsOnly(whatsapp).replace(/^\+/, '');
          Linking.openURL(`https://wa.me/${num}`);
        },
      });
    }
    if (mapUrl) {
      out.push({
        key: 'map',
        label: 'Directions',
        icon: 'map-pin',
        color: '#E68A00',
        onPress: () => Linking.openURL(mapUrl),
      });
    }
    if (clinic.email) {
      out.push({
        key: 'mail',
        label: 'Email',
        icon: 'mail',
        color: '#7B3FB5',
        onPress: () => Linking.openURL(`mailto:${clinic.email}`),
      });
    }
    return out;
  }, [clinic, whatsapp, mapUrl]);

  // ── Loading / error ─────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Loading…', headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[styles.sub, { marginTop: 12 }]}>Loading clinic…</Text>
      </View>
    );
  }
  if (error || !clinic) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Clinic not found', headerShown: false }} />
        <View style={styles.errorIconWrap}>
          <Feather name="alert-circle" size={42} color={COLORS.sub} />
        </View>
        <Text style={[styles.h1, { marginTop: 14 }]}>Clinic not found</Text>
        <Text style={[styles.sub, { marginTop: 6, textAlign: 'center', maxWidth: 320 }]}>
          {error || 'The clinic URL you followed does not exist.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/' as any)}
          style={({ pressed }) => [styles.cta, styles.ctaPrimary, { marginTop: 22 }, pressed && { opacity: 0.85 }]}
        >
          <Feather name="home" size={16} color="#fff" />
          <Text style={styles.ctaText}>Go to ConsultUro home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Stack.Screen options={{ title: clinic.name, headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 + (insets.bottom || 0) + 76 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ──────────────────────────────────────────────────── */}
        <LinearGradient
          colors={[heroBg, accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <SafeAreaView edges={['top']} style={{ paddingHorizontal: 20 }}>
            <View style={styles.heroTopRow}>
              <Pressable
                onPress={() => router.canGoBack() ? router.back() : router.replace('/' as any)}
                style={styles.iconBtn}
                hitSlop={12}
                accessibilityLabel="Go back"
              >
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => router.push('/' as any)}
                style={styles.brandLink}
                hitSlop={8}
              >
                <Text style={styles.brandLinkText}>ConsultUro</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share) {
                    (navigator as any).share({
                      title: clinic.name,
                      url: typeof window !== 'undefined' ? window.location.href : '',
                    }).catch(() => {});
                  }
                }}
                style={styles.iconBtn}
                hitSlop={12}
                accessibilityLabel="Share clinic"
              >
                <Feather name="share-2" size={18} color="#fff" />
              </Pressable>
            </View>

            <Animated.View entering={FadeIn.duration(450)} style={{ alignItems: 'center' }}>
              {logo ? (
                <Image source={{ uri: logo }} style={styles.heroLogo} resizeMode="contain" />
              ) : (
                <View style={styles.heroAvatar}>
                  <Text style={styles.heroAvatarText}>{initialsOf(clinic.name)}</Text>
                </View>
              )}
              <Text style={styles.heroTitle} numberOfLines={2}>
                {clinic.name}
              </Text>
              {!!clinic.tagline && (
                <Text style={styles.heroTagline} numberOfLines={3}>
                  {clinic.tagline}
                </Text>
              )}
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(450).delay(120)}>
              <Pressable
                onPress={goBook}
                style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.9 }]}
              >
                <Feather name="calendar" size={16} color={COLORS.primary} />
                <Text style={[styles.ctaText, { color: COLORS.primary }]}>
                  Book a consultation
                </Text>
                <Feather name="arrow-right" size={16} color={COLORS.primary} />
              </Pressable>
            </Animated.View>
          </SafeAreaView>
          {/* curved bottom wash */}
          <View style={styles.heroCurve} />
        </LinearGradient>

        {/* ── Quick-action chips ────────────────────────────────────── */}
        {quickActions.length > 0 && (
          <Animated.View
            entering={FadeInDown.duration(450).delay(200)}
            style={[styles.quickActionsWrap, { marginTop: -28 }]}
          >
            <View style={styles.quickActionsRow}>
              {quickActions.map((q) => (
                <Pressable
                  key={q.key}
                  onPress={q.onPress}
                  style={({ pressed }) => [
                    styles.qaTile,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <View style={[styles.qaIcon, { backgroundColor: q.color + '1A' }]}>
                    <Feather name={q.icon} size={18} color={q.color} />
                  </View>
                  <Text style={styles.qaLabel} numberOfLines={1}>
                    {q.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}

        {/* ── About / contact card ──────────────────────────────────── */}
        {(clinic.address || clinic.phone || clinic.email) && (
          <Animated.View
            entering={FadeInDown.duration(450).delay(280)}
            style={styles.cardWrap}
          >
            <View style={styles.card}>
              <Text style={styles.cardHeader}>VISIT US</Text>
              {!!clinic.address && (
                <View style={styles.row}>
                  <Feather name="map-pin" size={16} color={COLORS.primary} style={styles.rowIcon} />
                  <Text style={styles.rowText}>{clinic.address}</Text>
                </View>
              )}
              {!!clinic.phone && (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${digitsOnly(clinic.phone!)}`)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <Feather name="phone" size={16} color={COLORS.primary} style={styles.rowIcon} />
                  <Text style={[styles.rowText, { color: COLORS.primary, fontWeight: '600' }]}>
                    {clinic.phone}
                  </Text>
                </Pressable>
              )}
              {!!clinic.email && (
                <Pressable
                  onPress={() => Linking.openURL(`mailto:${clinic.email}`)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <Feather name="mail" size={16} color={COLORS.primary} style={styles.rowIcon} />
                  <Text style={[styles.rowText, { color: COLORS.primary, fontWeight: '600' }]}>
                    {clinic.email}
                  </Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}

        {/* ── Tile grid ─────────────────────────────────────────────── */}
        <Animated.View
          entering={FadeInDown.duration(450).delay(360)}
          style={styles.cardWrap}
        >
          <Text style={styles.sectionHeader}>EXPLORE</Text>
          <View style={styles.cardGrid}>
            <Tile
              icon="book-open"
              tone="#1FA1B7"
              label="Patient Education"
              onPress={() => router.push('/education' as any)}
            />
            <Tile
              icon="file-text"
              tone="#0F4C75"
              label="Blogs & Articles"
              onPress={() => router.push('/blog' as any)}
            />
            <Tile
              icon="activity"
              tone="#E68A00"
              label="Health Calculators"
              onPress={() => router.push('/calculators' as any)}
            />
            <Tile
              icon="play-circle"
              tone="#7B3FB5"
              label="Videos"
              onPress={() => router.push('/videos' as any)}
            />
          </View>
        </Animated.View>

        <Text style={styles.footer}>Powered by ConsultUro</Text>
      </ScrollView>

      {/* ── Sticky bottom CTA ─────────────────────────────────────── */}
      <View
        style={[
          styles.stickyCta,
          { paddingBottom: 12 + (insets.bottom || 0) },
        ]}
      >
        <Pressable
          onPress={goBook}
          style={({ pressed }) => [
            styles.cta,
            styles.ctaPrimary,
            pressed && { opacity: 0.9 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Book a consultation"
        >
          <Feather name="calendar" size={16} color="#fff" />
          <Text style={styles.ctaText}>Book a consultation</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Tile({
  icon,
  tone,
  label,
  onPress,
}: {
  icon: any;
  tone: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: tone + '1F' }]}>
        <Feather name={icon} size={20} color={tone} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
      <Feather name="chevron-right" size={16} color={COLORS.sub} style={{ marginLeft: 'auto' }} />
    </Pressable>
  );
}

const SHADOW = Platform.select({
  ios: {
    shadowColor: '#0F4C75',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingBottom: 50, position: 'relative', overflow: 'hidden' },
  heroCurve: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 32,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Platform.OS === 'web' ? 12 : 4,
    marginBottom: 12,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLink: { paddingHorizontal: 10, paddingVertical: 6 },
  brandLinkText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  heroLogo: { width: 86, height: 86, marginVertical: 12 },
  heroAvatar: {
    width: 86,
    height: 86,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  heroAvatarText: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  heroTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 0.2,
  },
  heroTagline: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
    lineHeight: 20,
  },
  heroCta: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 28,
    alignSelf: 'center',
    marginTop: 22,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  // Common CTA (used in error / sticky)
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 26,
  },
  ctaPrimary: {
    backgroundColor: COLORS.primary,
  },
  ctaText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Quick actions
  quickActionsWrap: { paddingHorizontal: 16 },
  quickActionsRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 8,
    ...SHADOW,
  },
  qaTile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  qaIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  qaLabel: { fontSize: 11.5, color: COLORS.text, fontWeight: '700' },

  cardWrap: { paddingHorizontal: 16, marginTop: 18 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.sub,
    letterSpacing: 0.8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    ...SHADOW,
  },
  cardHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.sub,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  rowIcon: { width: 26 },
  rowText: { color: COLORS.text, fontSize: 14, flex: 1, lineHeight: 20 },
  cardGrid: {
    gap: 10,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    ...SHADOW,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tileLabel: { fontSize: 14.5, fontWeight: '700', color: COLORS.text },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.sub },
  footer: { textAlign: 'center', color: COLORS.sub, fontSize: 12, marginTop: 36 },
  errorIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#0F4C7510',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(244,248,251,0.95)',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
