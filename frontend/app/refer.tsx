/**
 * /refer — Refer-a-Patient share screen.
 *
 * Anyone signed in (patient, staff, doctor) can open this screen,
 * see their personal QR code + link, and share it via WhatsApp /
 * native Share / Copy. Stats card shows invited / booked / visited.
 *
 * No incentive logic in MVP — purely a tracker.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Platform, Share, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useDarkOverrides } from '../src/dark-mode';
import { useToast } from '../src/toast';
import { useI18n } from '../src/i18n';
import { useMyReferralCode } from '../src/referrals/use-my-code';
import { buildShareMessage } from '../src/referrals/share-templates';
import { useTenant } from '../src/tenant-context';
import api from '../src/api';
import { buildShareUrl } from '../src/share';

function logoFromSlug(slug: string): any | null {
  // Branded QR centre logo — uses the app's bundled mark.
  // Falls back to no logo when slug is empty / unknown.
  if (!slug) return null;
  try {
    return require('../assets/icon.png');
  } catch {
    return null;
  }
}

export default function ReferScreen() {
  const toast = useToast();
  const d = useDarkOverrides();
  const { lang } = useI18n();
  const tenant = useTenant();
  const { data, loading, error, reload } = useMyReferralCode();
  const [posting, setPosting] = useState(false);

  // Build the share link from the current tenant slug. Falls back to
  // the app's public site when no slug is available.
  const slug = tenant?.currentClinic?.slug || 'consulturo';
  const clinicName = tenant?.currentClinic?.name || 'ConsultUro';
  const baseUrl = useMemo(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const host = window.location.origin.replace(/\/$/, '');
      return `${host}/c/${slug}`;
    }
    return `https://consulturo.com/c/${slug}`;
  }, [slug]);

  const link = data ? `${baseUrl}?ref=${data.code}` : baseUrl;
  const qrLogo = useMemo(() => logoFromSlug(slug), [slug]);

  const trackShare = useCallback(async (source: string) => {
    if (!data?.code) return;
    setPosting(true);
    try {
      // Fire-and-forget — track how the share happened so the
      // attribution feed shows which channels actually convert.
      await api.post('/referrals/attribute', { code: data.code, source });
    } catch {
      // Non-fatal — UI never blocks on tracking.
    } finally {
      setPosting(false);
      void reload();
    }
  }, [data?.code, reload]);

  const message = useMemo(() => buildShareMessage({
    lang: (lang as any) || 'en',
    link,
    referrerName: data?.referrer_name,
    clinicName,
  }), [link, data?.referrer_name, clinicName, lang]);

  // Rich, unfurl-friendly share URL (redirects to the clinic page while
  // preserving the ?ref= attribution). Used when sharing to chat apps so
  // recipients see a preview card instead of a bare link.
  const shareUrl = useMemo(() => {
    if (!data?.code) return link;
    return buildShareUrl({
      kind: 'clinic',
      ident: slug,
      title: `${clinicName} — Join me on ConsultUro`,
      description: 'Book appointments, view records & urology guides — all in one app.',
      ref: data.code,
    });
  }, [data?.code, slug, clinicName, link]);
  const shareMessage = useMemo(
    () => (link && shareUrl ? message.split(link).join(shareUrl) : message),
    [message, link, shareUrl],
  );

  const copyLink = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(link);
      toast.success('Link copied to clipboard');
      void trackShare('copy');
    } catch {
      Alert.alert('Could not copy', 'Try selecting the link manually.');
    }
  }, [link, toast, trackShare]);

  const copyCode = useCallback(async () => {
    if (!data?.code) return;
    try {
      await Clipboard.setStringAsync(data.code);
      toast.success('Code copied');
    } catch {}
  }, [data?.code, toast]);

  const shareWhatsApp = useCallback(async () => {
    const url = `whatsapp://send?text=${encodeURIComponent(shareMessage)}`;
    const fallback = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(fallback);
      }
      void trackShare('whatsapp');
    } catch {
      Alert.alert('Could not open WhatsApp', 'Try the share button instead.');
    }
  }, [shareMessage, trackShare]);

  const shareNative = useCallback(async () => {
    try {
      await Share.share({ message: shareMessage, url: shareUrl, title: 'Refer to ConsultUro' });
      void trackShare('native_share');
    } catch {
      // user cancelled — silent
    }
  }, [shareMessage, shareUrl, trackShare]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <Stack.Screen options={{ title: 'Refer a Patient', headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: '#fff' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <Stack.Screen options={{ title: 'Refer a Patient', headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: '#fff' }} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="cloud-offline" size={40} color={COLORS.textTertiary} />
          <Text style={{ color: COLORS.textSecondary, marginTop: 12, textAlign: 'center' }}>
            {error || 'Could not load your referral code. Please retry.'}
          </Text>
          <TouchableOpacity onPress={reload} style={[styles.primaryBtn, { marginTop: 16 }]}>
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: '#f8fafc' }, d.screen]}>
      <Stack.Screen options={{ title: 'Refer a Patient', headerStyle: { backgroundColor: COLORS.primary }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '700' } }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.headerCard}>
          <View style={styles.headerIcon}>
            <Ionicons name="gift" size={22} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Invite a Friend</Text>
          <Text style={styles.headerSub}>
            Share your personal link or QR. When a friend books with this code,
            we'll credit you — see your invites below.
          </Text>
        </View>

        {/* QR card */}
        <View style={[styles.qrCard, d.surface]}>
          <Text style={[styles.cardLabel, d.textP]}>Your QR code</Text>
          <View style={styles.qrWrap}>
            <QRCode
              value={link}
              size={200}
              color={COLORS.textPrimary}
              backgroundColor="#ffffff"
              logo={qrLogo || undefined}
              logoSize={42}
              logoBackgroundColor="#ffffff"
              logoBorderRadius={8}
              logoMargin={3}
              ecl="H"
            />
          </View>
          <Text style={[styles.codeBig, d.textP]} selectable testID="ref-code-display">{data.code}</Text>
          <TouchableOpacity onPress={copyCode} style={styles.copyCodeBtn} testID="ref-code-copy">
            <Ionicons name="copy-outline" size={14} color={COLORS.primary} />
            <Text style={styles.copyCodeText}>Copy code</Text>
          </TouchableOpacity>
        </View>

        {/* Link + share row */}
        <View style={[styles.linkCard, d.surface]}>
          <Text style={[styles.cardLabel, d.textP]}>Your invite link</Text>
          <View style={[styles.linkRow, d.border]}>
            <Text style={[styles.linkText, d.textP]} numberOfLines={1} selectable>{link}</Text>
            <TouchableOpacity onPress={copyLink} style={styles.linkCopyBtn} hitSlop={8} testID="ref-link-copy">
              <Ionicons name="copy-outline" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.shareRow}>
            <TouchableOpacity onPress={shareWhatsApp} style={[styles.shareBtn, { backgroundColor: '#25D366' }]} testID="ref-share-whatsapp">
              <Ionicons name="logo-whatsapp" size={18} color="#fff" />
              <Text style={styles.shareBtnText}>WhatsApp</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={shareNative} style={[styles.shareBtn, { backgroundColor: COLORS.primary }]} testID="ref-share-native">
              <Ionicons name="share-social" size={18} color="#fff" />
              <Text style={styles.shareBtnText}>Share…</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats card */}
        <View style={[styles.statsCard, d.surface]}>
          <Text style={[styles.cardLabel, d.textP]}>Your invites</Text>
          <View style={styles.statRow}>
            <StatTile color="#0EA5E9" icon="person-add" label="Invited" value={data.invited} />
            <StatTile color="#F59E0B" icon="calendar-outline" label="Booked" value={data.booked} />
            <StatTile color="#16A34A" icon="checkmark-done-circle" label="Visited" value={data.visited} />
          </View>
          <Text style={[styles.helpText, d.textS]}>
            "Visited" updates automatically when the doctor marks the consultation complete.
          </Text>
        </View>

        {posting ? (
          <View style={{ alignItems: 'center', marginTop: 8 }}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ color, icon, label, value }: { color: string; icon: any; label: string; value: number }) {
  return (
    <View style={[styles.statTile, { borderLeftColor: color }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: '#fff',
    borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 14,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  headerIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 8,
  },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  headerSub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, textAlign: 'center', lineHeight: 17 },

  qrCard: {
    backgroundColor: '#fff', padding: 18, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  cardLabel: {
    color: COLORS.textSecondary, fontSize: 11.5,
    marginBottom: 8, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
    alignSelf: 'flex-start',
  },
  qrWrap: {
    padding: 12, backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  codeBig: {
    ...FONTS.h2,
    color: COLORS.primary,
    fontSize: 22,
    letterSpacing: 4,
    marginTop: 14,
  },
  copyCodeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.primary,
  },
  copyCodeText: { color: COLORS.primary, fontWeight: '700', fontSize: 12 },

  linkCard: {
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F1F5F9', borderRadius: RADIUS.input,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  linkText: { flex: 1, color: COLORS.textPrimary, fontSize: 12.5 },
  linkCopyBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  shareRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  shareBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11,
    borderRadius: RADIUS.button,
  },
  shareBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  statsCard: {
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  statRow: { flexDirection: 'row', gap: 8 },
  statTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
    borderLeftWidth: 4,
    borderRadius: RADIUS.card,
    padding: 12,
  },
  statVal: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 20, marginTop: 4 },
  statLbl: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  helpText: { color: COLORS.textTertiary, fontSize: 11, marginTop: 8, lineHeight: 15, fontStyle: 'italic' },

  primaryBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.button,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
