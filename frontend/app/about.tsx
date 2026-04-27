import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Image, TouchableOpacity, Linking } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../src/api';
import { COLORS, FONTS, RADIUS, DOCTOR_PHOTO_URL } from '../src/theme';
import { CollapsibleHero, useCollapsibleHeader } from '../src/collapsible-hero';
import LanguageDropdown from '../src/language-dropdown';
import { useI18n } from '../src/i18n';

export default function About() {
  const router = useRouter();
  const [info, setInfo] = useState<any>(null);
  const collapse = useCollapsibleHeader(320, 72);
  const { t, lang } = useI18n();

  useEffect(() => {
    api.get('/doctor', { params: { lang } }).then((r) => setInfo(r.data)).catch(() => {});
  }, [lang]);

  if (!info) return null;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/' as any);
  };

  const serviceCategories = info.service_categories || [];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Animated.ScrollView
        onScroll={collapse.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ padding: 20, paddingTop: 320 + 12, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Tagline card */}
        {!!info.tagline && (
          <View style={styles.taglineCard}>
            <Ionicons name="heart" size={16} color={COLORS.primary} />
            <Text style={styles.tagline} numberOfLines={2}>{info.tagline}</Text>
          </View>
        )}

        {/* Quick stats row */}
        {Array.isArray(info.stats) && info.stats.length > 0 && (
          <View style={styles.statsRow}>
            {info.stats.map((s: any, i: number) => (
              <View key={i} style={styles.statCard}>
                <Text style={styles.statVal}>{s.value}</Text>
                <Text style={styles.statLbl} numberOfLines={2}>{s.label}</Text>
              </View>
            ))}
          </View>
        )}

        <Section icon="person" title={t('about.aboutMe')}>
          <Text style={styles.paragraph}>{info.short_bio}</Text>
          {!!info.personal_statement && (
            <View style={styles.quoteBox}>
              <Ionicons name="chatbox-ellipses" size={16} color={COLORS.primary} />
              <Text style={styles.quoteText}>{info.personal_statement}</Text>
            </View>
          )}
        </Section>

        {Array.isArray(info.highlights) && info.highlights.length > 0 && (
          <Section icon="star" title={t('about.highlights')}>
            {info.highlights.map((h: string, i: number) => (
              <View key={i} style={styles.bulletRow}>
                <View style={styles.bulletDot}>
                  <Ionicons name="checkmark" size={12} color="#fff" />
                </View>
                <Text style={styles.bulletText}>{h}</Text>
              </View>
            ))}
          </Section>
        )}

        <Section icon="school" title={t('about.education')} collapsible defaultOpen={false}>
          {info.qualifications?.map((q: any, i: number) => (
            <View key={i} style={styles.quaRow}>
              <View style={styles.quaDeg}>
                <Text style={styles.quaDegText}>{q.degree}</Text>
                {!!q.year && <Text style={styles.quaYear}>{q.year}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.quaInst}>{q.institute}</Text>
                {q.note && <Text style={styles.quaNote}>{q.note}</Text>}
              </View>
            </View>
          ))}
        </Section>

        {Array.isArray(info.past_experience) && info.past_experience.length > 0 && (
          <Section icon="briefcase" title={t('about.pastExperience')} collapsible defaultOpen={false}>
            {info.past_experience.map((e: any, i: number) => (
              <View key={i} style={styles.expRow}>
                <View style={styles.expDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.expRole}>{e.role}</Text>
                  <Text style={styles.expPlace}>{e.place}</Text>
                </View>
              </View>
            ))}
          </Section>
        )}

        <Section icon="medkit" title={t('about.services')}>
          {serviceCategories.length > 0 ? (
            serviceCategories.map((cat: any, i: number) => (
              <CollapsibleCategory
                key={i}
                title={cat.title}
                icon={(cat.icon as any) || 'medkit'}
                items={cat.items || []}
                defaultOpen={i === 0}
              />
            ))
          ) : (
            <View style={styles.serviceGrid}>
              {info.services?.map((s: string, i: number) => (
                <View key={i} style={styles.serviceChip}>
                  <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                  <Text style={styles.serviceText}>{s}</Text>
                </View>
              ))}
            </View>
          )}
        </Section>

        {Array.isArray(info.memberships) && info.memberships.length > 0 && (
          <Section icon="ribbon" title={t('about.memberships')} collapsible defaultOpen={false}>
            {info.memberships.map((m: any, i: number) => (
              <View key={i} style={styles.memberRow}>
                <MaterialCommunityIcons name="medal" size={18} color={COLORS.accent} />
                <Text style={styles.memberText}>{m.name}</Text>
              </View>
            ))}
          </Section>
        )}

        <Section icon="location" title={t('about.clinics')}>
          {info.clinics?.map((c: any, i: number) => (
            <View key={i} style={styles.clinicRow}>
              <View style={styles.clinicDot}>
                <Ionicons name="medkit" size={18} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.clinicName}>{c.name}</Text>
                <Text style={styles.clinicAddr}>{c.address}</Text>
                <Text style={styles.clinicHours}>{c.hours}</Text>
              </View>
            </View>
          ))}
          <View style={styles.clinicsNote}>
            <Ionicons name="information-circle" size={14} color={COLORS.accent} />
            <Text style={styles.clinicsNoteText}>{t('about.clinicsNote')}</Text>
          </View>
        </Section>

        <Section icon="time" title={t('about.availability')} collapsible defaultOpen={false}>
          <Text style={styles.availRow}>
            <Text style={styles.availLabel}>{t('about.monSat')}: </Text>
            {info.availability?.mon_sat}
          </Text>
          <Text style={styles.availRow}>
            <Text style={styles.availLabel}>{t('about.sunday')}: </Text>
            {info.availability?.sunday}
          </Text>
          <Text style={styles.availRow}>
            <Text style={styles.availLabel}>{t('about.whatsapp')}: </Text>
            {info.availability?.whatsapp}
          </Text>
        </Section>

        <Section icon="call" title={t('about.contact')}>
          <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${info.contact.phone}`)} testID="about-contact-phone">
            <Ionicons name="call" size={18} color={COLORS.primary} />
            <Text style={styles.contactText}>{info.contact.phone}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.contactRow}
            onPress={() => Linking.openURL(`whatsapp://send?phone=${info.contact.whatsapp.replace('+', '')}`)}
            testID="about-contact-whatsapp"
          >
            <Ionicons name="logo-whatsapp" size={18} color={COLORS.whatsapp} />
            <Text style={styles.contactText}>WhatsApp: {info.contact.whatsapp}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(info.contact.website)} testID="about-contact-website">
            <Ionicons name="globe" size={18} color={COLORS.primary} />
            <Text style={styles.contactText}>{info.contact.website}</Text>
          </TouchableOpacity>
        </Section>
      </Animated.ScrollView>

      <CollapsibleHero
        title={info.name || 'About'}
        onBack={goBack}
        backgroundImage={info.photo_url || DOCTOR_PHOTO_URL}
        headerHeight={collapse.headerHeight}
        heroOpacity={collapse.heroOpacity}
        heroTranslate={collapse.heroTranslate}
        compactOpacity={collapse.compactOpacity}
        imgOpacity={collapse.imgOpacity}
        compactAvatarUrl={info.photo_url || DOCTOR_PHOTO_URL}
        rightAction={<LanguageDropdown testID="about-lang" />}
        testID="about-back"
      >
        <Image source={{ uri: info.photo_url || DOCTOR_PHOTO_URL }} style={styles.photo} />
        <Text style={styles.name} numberOfLines={1}>{info.name}</Text>
        <Text style={styles.title} numberOfLines={2}>{info.title}</Text>
        {Array.isArray(info.languages) && info.languages.length > 0 && (
          <View style={styles.speaksRow}>
            <Ionicons name="chatbubbles-outline" size={13} color="#E0F7FA" />
            <Text style={styles.speaksText} numberOfLines={1}>
              {t('about.speaks')} {info.languages.slice(0, 4).join(' · ')}
            </Text>
          </View>
        )}
      </CollapsibleHero>
    </View>
  );
}

function Section({ icon, title, children, collapsible = false, defaultOpen = true }: any) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () => setOpen((v) => !v);
  if (!collapsible) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name={icon} size={18} color={COLORS.primary} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {children}
      </View>
    );
  }
  return (
    <View style={styles.section}>
      <TouchableOpacity onPress={toggle} style={styles.sectionHead} activeOpacity={0.78}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
        <Text style={[styles.sectionTitle, { flex: 1 }]}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textSecondary} />
      </TouchableOpacity>
      {open && <View style={{ marginTop: 4 }}>{children}</View>}
    </View>
  );
}

// Collapsible "service category" — a tappable header pill that
// expands to show the bullet items. Used inside the Services Offered
// section to declutter the page; users tap the category they care
// about and only those services expand.
function CollapsibleCategory({
  title, icon, items, defaultOpen = false,
}: { title: string; icon: any; items: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <View style={styles.catWrap}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} style={styles.catHead} activeOpacity={0.78}>
        <View style={styles.catIcon}>
          <Ionicons name={icon || 'medkit'} size={14} color={COLORS.primary} />
        </View>
        <Text style={[styles.catTitle, { flex: 1 }]}>{title}</Text>
        <View style={styles.catBadge}>
          <Text style={styles.catBadgeText}>{items.length}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
      </TouchableOpacity>
      {open && (
        <View style={[styles.serviceGrid, { marginTop: 8 }]}>
          {items.map((s, j) => (
            <View key={j} style={styles.serviceChip}>
              <Ionicons name="checkmark-circle" size={13} color={COLORS.primary} />
              <Text style={styles.serviceText}>{s}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#fff' },
  name: { ...FONTS.h1, color: '#fff', marginTop: 16, fontSize: 22, textAlign: 'center' },
  title: { ...FONTS.body, color: '#E0F7FA', marginTop: 2, textAlign: 'center', paddingHorizontal: 16, fontSize: 12 },
  langRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  langPill: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  langText: { ...FONTS.body, color: '#fff', fontSize: 11 },
  speaksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  speaksText: { ...FONTS.body, color: '#E0F7FA', fontSize: 11, letterSpacing: 0.3 },

  taglineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.primary + '12',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  tagline: { ...FONTS.h4, color: COLORS.primary, fontSize: 14, flex: 1, lineHeight: 20 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  statVal: { ...FONTS.h2, color: COLORS.primary, fontSize: 20 },
  statLbl: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 4, textAlign: 'center', lineHeight: 14 },

  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  paragraph: { ...FONTS.body, color: COLORS.textPrimary, lineHeight: 22 },
  quoteBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 12,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  quoteText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, lineHeight: 20, fontStyle: 'italic' },

  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  bulletDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bulletText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, lineHeight: 20 },

  quaRow: { flexDirection: 'row', marginBottom: 14, gap: 10 },
  quaDeg: { backgroundColor: COLORS.primary + '18', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start', minWidth: 70, alignItems: 'center' },
  quaDegText: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },
  quaYear: { ...FONTS.body, color: COLORS.primary, fontSize: 10, marginTop: 2 },
  quaInst: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  quaNote: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 },

  expRow: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  expDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.accent, marginTop: 7 },
  expRole: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  expPlace: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  catWrap: {
    marginBottom: 10,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.primary + '18', alignItems: 'center', justifyContent: 'center' },
  catTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13.5 },
  catBadge: {
    minWidth: 22, height: 18, paddingHorizontal: 6,
    borderRadius: 9,
    backgroundColor: COLORS.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  catBadgeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10 },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  serviceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.bg, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  serviceText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },

  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  memberText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1 },

  clinicRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  clinicDot: { width: 36, height: 36, borderRadius: 12, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center' },
  clinicName: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  clinicAddr: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  clinicHours: { ...FONTS.body, color: COLORS.primary, fontSize: 12, marginTop: 2, fontFamily: 'DMSans_500Medium' },
  clinicsNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accent + '10',
    borderWidth: 1,
    borderColor: COLORS.accent + '30',
  },
  clinicsNoteText: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    fontStyle: 'italic',
  },

  availRow: { ...FONTS.body, color: COLORS.textPrimary, marginBottom: 6, lineHeight: 20 },
  availLabel: { fontFamily: 'DMSans_500Medium', color: COLORS.primary },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  contactText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
});
