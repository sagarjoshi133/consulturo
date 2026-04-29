/**
 * /c/<slug> — Public clinic landing page.
 *
 * Phase C of the multi-tenant rollout. Rendered for ANYONE (no auth
 * required) who knows the clinic's URL slug. Content:
 *  • Clinic name + tagline + branding hero
 *  • Address / phone / email contact card
 *  • "Book a consultation" CTA → routes to /book scoped to this clinic
 *  • "Educational content" + "Blogs" links if the clinic has them
 *
 * The booking flow auto-detects the slug via the route and ensures
 * resulting bookings carry the clinic's `clinic_id`. We do NOT
 * authenticate — patients book without signing up first.
 */
import React, { useEffect, useState } from 'react';
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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

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
};

export default function ClinicLanding() {
  const router = useRouter();
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
    // Booking screen reads the slug from query/params and tags the
    // resulting record with the clinic's id (Phase E will tighten the
    // scoping on the server). For now we pass the slug through query.
    router.push(`/book?clinic=${encodeURIComponent(slug)}` as any);
  };

  // ── Loading / error ─────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Loading…', headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (error || !clinic) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Clinic not found', headerShown: false }} />
        <Feather name="alert-circle" size={48} color={COLORS.sub} />
        <Text style={[styles.h1, { marginTop: 12 }]}>Clinic not found</Text>
        <Text style={[styles.sub, { marginTop: 6, textAlign: 'center', maxWidth: 320 }]}>
          {error || 'The clinic URL you followed does not exist.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/' as any)}
          style={[styles.cta, { marginTop: 20 }]}
        >
          <Text style={styles.ctaText}>Go to ConsultUro home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────
  const branding = clinic.branding || {};
  const heroBg = (branding as any)?.hero_color || COLORS.primary;
  const accent = (branding as any)?.accent_color || COLORS.accent;
  const logo = (branding as any)?.logo_url || '';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Stack.Screen options={{ title: clinic.name, headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Hero */}
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
                style={styles.backBtn}
                hitSlop={12}
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
            </View>

            {!!logo && (
              <Image source={{ uri: logo }} style={styles.heroLogo} resizeMode="contain" />
            )}
            <Text style={styles.heroTitle} numberOfLines={2}>
              {clinic.name}
            </Text>
            {!!clinic.tagline && (
              <Text style={styles.heroTagline} numberOfLines={3}>
                {clinic.tagline}
              </Text>
            )}

            <Pressable onPress={goBook} style={styles.cta}>
              <Feather name="calendar" size={16} color="#fff" />
              <Text style={styles.ctaText}>Book a consultation</Text>
            </Pressable>
          </SafeAreaView>
        </LinearGradient>

        {/* Contact card */}
        {(clinic.address || clinic.phone || clinic.email) && (
          <View style={styles.cardWrap}>
            <View style={styles.card}>
              <Text style={styles.cardHeader}>Contact</Text>
              {!!clinic.address && (
                <View style={styles.row}>
                  <Feather name="map-pin" size={16} color={COLORS.primary} style={styles.rowIcon} />
                  <Text style={styles.rowText}>{clinic.address}</Text>
                </View>
              )}
              {!!clinic.phone && (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${clinic.phone!.replace(/\s+/g, '')}`)}
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
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.cardWrap}>
          <View style={styles.cardGrid}>
            <Pressable
              onPress={() => router.push('/education' as any)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: '#1FA1B722' }]}>
                <Feather name="book-open" size={20} color={COLORS.accent} />
              </View>
              <Text style={styles.tileLabel}>Patient Education</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/blog' as any)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: '#0F4C7522' }]}>
                <Feather name="file-text" size={20} color={COLORS.primary} />
              </View>
              <Text style={styles.tileLabel}>Blogs & Articles</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/calculators' as any)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: '#FFAA0022' }]}>
                <Feather name="activity" size={20} color="#E68A00" />
              </View>
              <Text style={styles.tileLabel}>Health Calculators</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push('/videos' as any)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.tileIcon, { backgroundColor: '#9B5DE522' }]}>
                <Feather name="play-circle" size={20} color="#7B3FB5" />
              </View>
              <Text style={styles.tileLabel}>Videos</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footer}>Powered by ConsultUro</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingBottom: 24 },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Platform.OS === 'web' ? 12 : 4,
    marginBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLink: { paddingHorizontal: 10, paddingVertical: 6 },
  brandLinkText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  heroLogo: { width: 80, height: 80, alignSelf: 'center', marginVertical: 12 },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 12 },
  heroTagline: { color: 'rgba(255,255,255,0.92)', fontSize: 14, textAlign: 'center', marginTop: 8 },
  cta: {
    backgroundColor: '#1A2E3580',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    alignSelf: 'center',
    marginTop: 18,
  },
  ctaText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cardWrap: { paddingHorizontal: 16, marginTop: 16 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
  },
  cardHeader: { fontSize: 12, fontWeight: '800', color: COLORS.sub, letterSpacing: 0.6, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rowIcon: { width: 24 },
  rowText: { color: COLORS.text, fontSize: 14, flex: 1 },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    alignItems: 'flex-start',
  },
  tileIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  tileLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.sub },
  footer: { textAlign: 'center', color: COLORS.sub, fontSize: 12, marginTop: 32 },
});
