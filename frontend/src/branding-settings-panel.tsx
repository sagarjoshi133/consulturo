/**
 * BrandingSettingsPanel — consolidated Branding & Settings panel for
 * the Dashboard. Replaces the separate "Branding" and "Settings"
 * tabs with a single panel that exposes every clinic-customisation
 * surface organised under three intuitive categories so a Primary
 * Owner / Partner can navigate without hunting across screens.
 *
 * Categories:
 *   1. "Patient Home"  → controls what visitors see on the home
 *      screen (doctor photo, cover banner, tagline, contact strip,
 *      help/contact info). Mounts the existing HomepagePanel.
 *   2. "Clinic Branding" → controls the clinic identity surfaces
 *      (about-doctor copy, photos, social handles, partner edit
 *      gates). Mounts the existing BrandingPanel.
 *   3. "Prescription Look" → letterhead, custom Patient Education
 *      copy, custom Need-Help copy. Sources the same fields from
 *      the Branding panel but renders only the Rx-specific section
 *      so the user understands "this is what gets printed".
 *
 * The chip bar is sticky at the top so the user can switch
 * categories without scrolling back up. On compact phones the chip
 * row scrolls horizontally; on tablets / web it lays out as
 * three pills inline.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import { HomepagePanel } from './homepage-panel';
import BrandingPanel from './branding-panel';
import { useResponsive } from './responsive';

type Category = 'home' | 'branding' | 'rx';

const CATEGORIES: {
  key: Category;
  label: string;
  short: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  desc: string;
}[] = [
  {
    key: 'home',
    label: 'Patient Home',
    short: 'Home',
    icon: 'home',
    color: '#0EA5E9',
    desc: 'Hero, tagline, contact info — what your patients see on the home screen.',
  },
  {
    key: 'branding',
    label: 'Clinic Branding',
    short: 'Branding',
    icon: 'color-palette',
    color: '#0E7C8B',
    desc: 'Photos, About-Doctor copy, social handles & partner permissions.',
  },
  {
    key: 'rx',
    label: 'Prescription Look',
    short: 'Rx',
    icon: 'document-text',
    color: '#7C3AED',
    desc: 'Letterhead, Patient Education and Need-Help blocks printed on every Rx.',
  },
];

export default function BrandingSettingsPanel() {
  const [cat, setCat] = useState<Category>('home');
  const { isWebDesktop } = useResponsive();

  const active = CATEGORIES.find((c) => c.key === cat) || CATEGORIES[0];

  return (
    <View style={{ flex: 1 }}>
      {/* Sticky category chip bar */}
      <View style={styles.chipBarWrap}>
        <ScrollView
          horizontal={!isWebDesktop}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipBar}
        >
          {CATEGORIES.map((c) => {
            const on = cat === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => setCat(c.key)}
                style={[
                  styles.chip,
                  on && { backgroundColor: c.color, borderColor: c.color },
                  isWebDesktop && { flex: 1 },
                ]}
                testID={`branding-cat-${c.key}`}
              >
                <Ionicons name={c.icon} size={14} color={on ? '#fff' : c.color} />
                <Text style={[styles.chipText, on && { color: '#fff' }]} numberOfLines={1}>
                  {isWebDesktop ? c.label : c.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={styles.descRow}>
          <View style={[styles.descDot, { backgroundColor: active.color }]} />
          <Text style={styles.descText} numberOfLines={2}>
            {active.desc}
          </Text>
        </View>
      </View>

      {/* Body — mount the appropriate panel. We DO NOT lazy-mount /
          preserve scroll across categories: switching is meant to
          reset scroll so the user lands at the top of the new
          context. */}
      <View style={{ flex: 1 }}>
        {cat === 'home' && (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
            showsVerticalScrollIndicator={false}
          >
            <HomepagePanel />
          </ScrollView>
        )}
        {cat === 'branding' && <BrandingPanel category="full" />}
        {cat === 'rx' && <BrandingPanel category="rx" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chipBarWrap: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: 8,
    paddingBottom: 6,
  },
  chipBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
    minWidth: 92,
    justifyContent: 'center',
  },
  chipText: {
    ...FONTS.bodyMedium,
    color: COLORS.textPrimary,
    fontSize: 12,
  },
  descRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  descDot: { width: 6, height: 6, borderRadius: 3 },
  descText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, flex: 1, lineHeight: 16 },
});
