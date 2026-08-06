/**
 * AnnouncementsBanner — Renders zero-or-more owner-curated banners
 * for the given audience+placement. Pinned banners sit on top;
 * unpinned variants render as subtle inline cards. Tapping the CTA
 * navigates to the configured URL (web link or in-app route); the
 * ✕ button dismisses the banner locally so it doesn't show again.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useI18n } from '../i18n';
import { useAnnouncements } from './use-announcements';
import { VARIANT_META, type Announcement, type AnnouncementAudience, type AnnouncementPlacement } from './types';

function pickLang(a: Announcement, field: 'title' | 'body' | 'cta_label', lang: 'en' | 'hi' | 'gu'): string {
  // Fall back to English when a translation is missing.
  const v = (a as any)[`${field}_${lang}`] || (a as any)[`${field}_en`] || '';
  return String(v || '');
}

export default function AnnouncementsBanner({
  audience, placement, slug, style,
}: {
  audience: AnnouncementAudience;
  placement: AnnouncementPlacement;
  slug?: string;
  style?: any;
}) {
  const router = useRouter();
  const { lang } = useI18n();
  const { items, dismiss } = useAnnouncements({ audience, placement, slug });

  if (!items || items.length === 0) return null;

  return (
    <View style={[styles.wrap, style]}>
      {items.map((a) => {
        const meta = VARIANT_META[a.variant] || VARIANT_META.info;
        const title = pickLang(a, 'title', lang as any);
        const body = pickLang(a, 'body', lang as any);
        const ctaLabel = pickLang(a, 'cta_label', lang as any);
        const handleCta = () => {
          const url = (a.cta_url || '').trim();
          if (!url) return;
          // Heuristic: in-app routes start with `/` (no protocol),
          // anything else is treated as an external link.
          if (/^\//.test(url)) {
            router.push(url as any);
          } else {
            const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
            Linking.openURL(full).catch(() => {});
          }
        };
        return (
          <View
            key={a.id}
            style={[
              styles.card,
              { backgroundColor: meta.bg, borderColor: meta.color + '44' },
              a.pinned && styles.pinned,
            ]}
            testID={`announcement-${a.id}`}
          >
            <View style={[styles.iconBubble, { backgroundColor: meta.color + '22' }]}>
              <Ionicons name={(a.icon as any) || meta.icon} size={18} color={meta.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: meta.color }]} numberOfLines={2}>{title}</Text>
              {body ? (
                <Text style={styles.body} numberOfLines={4}>{body}</Text>
              ) : null}
              {ctaLabel && (a.cta_url || '').trim() ? (
                <TouchableOpacity onPress={handleCta} style={[styles.ctaBtn, { backgroundColor: meta.color }]} testID={`announcement-cta-${a.id}`}>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                  <Ionicons name="arrow-forward" size={13} color="#fff" />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={() => dismiss(a.id)}
              hitSlop={10}
              style={styles.dismiss}
              accessibilityLabel="Dismiss"
              testID={`announcement-dismiss-${a.id}`}
            >
              <Ionicons name="close" size={16} color={meta.color} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  pinned: {
    ...Platform.select({
      ios: { shadowOpacity: 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
      android: { elevation: 3 },
      default: {},
    }),
  },
  iconBubble: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontWeight: '800', fontSize: 14, marginBottom: 2 },
  body: { color: '#1F2937', fontSize: 12.5, lineHeight: 17 },
  ctaBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 999,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  dismiss: { padding: 4, marginLeft: 4 },
});
