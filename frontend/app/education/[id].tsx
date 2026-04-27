import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

const ART_BG = '#FAF7F2';

export default function EducationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useI18n();
  const { width } = useWindowDimensions();
  const [it, setIt] = useState<any>(null);

  useEffect(() => {
    setIt(null);
    api.get(`/education/${id}`, { params: { lang } }).then((r) => setIt(r.data));
  }, [id, lang]);

  if (!it) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const stepsLabel = lang === 'hi' ? 'आसान चरण' : lang === 'gu' ? 'સરળ પગલાં' : 'Easy steps to follow';
  const aboutLabel = lang === 'hi' ? 'इस विषय के बारे में' : lang === 'gu' ? 'આ વિષય વિશે' : 'About this topic';

  // 4:3 hero height; cap at 420 to avoid dominating tablets
  const heroH = Math.min(Math.round(Math.min(width, 760) * 0.72), 420);

  return (
    <View style={{ flex: 1, backgroundColor: ART_BG }}>
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="education-detail-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <LanguageDropdown testID="education-detail-lang" />
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.heroWrap, { height: heroH }]}>
          <Image source={{ uri: it.cover }} style={styles.cover} resizeMode="contain" />
        </View>

        <View style={styles.body}>
          <Text style={styles.title}>{it.title}</Text>
          <Text style={styles.sum}>{it.summary}</Text>

          {!!it.details && (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionDot}>
                  <Ionicons name="information-circle" size={14} color={COLORS.primary} />
                </View>
                <Text style={styles.section}>{aboutLabel}</Text>
              </View>
              <Text style={styles.details}>{it.details}</Text>
            </>
          )}

          {Array.isArray(it.steps) && it.steps.length > 0 && (
            <>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionDot}>
                  <Ionicons name="footsteps" size={14} color={COLORS.primary} />
                </View>
                <Text style={styles.section}>{stepsLabel}</Text>
              </View>
              <View style={styles.stepsCard}>
                {it.steps.map((s: string, i: number) => (
                  <View key={i} style={[styles.stepRow, i === it.steps.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={styles.stepNum}>
                      <Text style={styles.stepNumText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{s}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0B3142',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  heroWrap: {
    width: '100%',
    backgroundColor: ART_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 56, // leave headroom for top bar
    paddingHorizontal: 20,
  },
  cover: { width: '100%', height: '100%' },
  body: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -24,
    padding: 24,
    paddingTop: 28,
    minHeight: 400,
  },
  title: { ...FONTS.h1, color: COLORS.textPrimary, fontSize: 24, lineHeight: 30 },
  sum: { ...FONTS.bodyLarge, color: COLORS.textSecondary, marginTop: 8, lineHeight: 24, fontSize: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 12 },
  sectionDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { ...FONTS.label, color: COLORS.primary, fontSize: 12, letterSpacing: 0.6 },
  details: { ...FONTS.bodyLarge, color: COLORS.textPrimary, lineHeight: 25, fontSize: 15 },
  stepsCard: {
    backgroundColor: ART_BG,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
  stepText: { flex: 1, ...FONTS.bodyLarge, color: COLORS.textPrimary, lineHeight: 22, fontSize: 14 },
});
