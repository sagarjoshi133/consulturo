/**
 * AnnouncementPreviewCard — renders a single banner from an in-progress
 * draft (the admin form's `editing` state), so owners see exactly how it
 * will look before publishing. Mirrors the real banner.tsx styling; no
 * network fetch, no dismiss/CTA navigation.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VARIANT_META, type AnnouncementVariant } from './types';

type Draft = {
  title_en?: string; title_hi?: string; title_gu?: string;
  body_en?: string; body_hi?: string; body_gu?: string;
  cta_label_en?: string; cta_label_hi?: string; cta_label_gu?: string;
  cta_url?: string;
  variant?: string;
  icon?: string | null;
  pinned?: boolean;
};

function pick(d: Draft, field: 'title' | 'body' | 'cta_label', lang: 'en' | 'hi' | 'gu'): string {
  const v = (d as any)[`${field}_${lang}`] || (d as any)[`${field}_en`] || '';
  return String(v || '');
}

export default function AnnouncementPreviewCard({
  draft,
  lang = 'en',
}: {
  draft: Draft;
  lang?: 'en' | 'hi' | 'gu';
}) {
  const meta = VARIANT_META[(draft.variant as AnnouncementVariant)] || VARIANT_META.info;
  const title = pick(draft, 'title', lang) || 'Your banner title';
  const body = pick(draft, 'body', lang);
  const ctaLabel = pick(draft, 'cta_label', lang);
  const hasCta = !!ctaLabel && !!(draft.cta_url || '').trim();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: meta.bg, borderColor: meta.color + '44' },
        draft.pinned && styles.pinned,
      ]}
      testID="announcement-preview"
    >
      <View style={[styles.iconBubble, { backgroundColor: meta.color + '22' }]}>
        <Ionicons name={(draft.icon as any) || meta.icon} size={18} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: meta.color }]} numberOfLines={2}>{title}</Text>
        {body ? <Text style={styles.body} numberOfLines={4}>{body}</Text> : null}
        {hasCta ? (
          <View style={[styles.ctaBtn, { backgroundColor: meta.color }]}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Ionicons name="arrow-forward" size={13} color="#fff" />
          </View>
        ) : null}
      </View>
      <View style={styles.dismiss}>
        <Ionicons name="close" size={16} color={meta.color} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  iconBubble: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '800', fontSize: 14, marginBottom: 2 },
  body: { color: '#1F2937', fontSize: 12.5, lineHeight: 17 },
  ctaBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  dismiss: { padding: 4, marginLeft: 4 },
});
