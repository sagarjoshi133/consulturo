import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { PrimaryButton, SecondaryButton } from '../../src/components';
import {
  CollapsibleHero,
  HERO_HEADER_MAX,
  useCollapsibleHeader,
} from '../../src/collapsible-hero';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';

export default function DiseaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useI18n();
  const [d, setD] = useState<any>(null);

  const collapse = useCollapsibleHeader();

  useEffect(() => {
    setD(null);
    api.get(`/diseases/${id}`, { params: { lang } }).then((r) => setD(r.data)).catch(() => setD(null));
  }, [id, lang]);

  if (!d) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/diseases' as any);
  };

  const L = (en: string, hi: string, gu: string) => (lang === 'hi' ? hi : lang === 'gu' ? gu : en);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Animated.ScrollView
        onScroll={collapse.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          padding: 20,
          paddingTop: HERO_HEADER_MAX + 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Section icon="information-circle" title={L('Overview', 'अवलोकन', 'ઝાંખી')} content={d.overview} />
        <ListSection icon="pulse" title={L('Symptoms', 'लक्षण', 'લક્ષણો')} items={d.symptoms} />
        <ListSection icon="warning" title={L('Causes & Risk Factors', 'कारण व जोखिम', 'કારણો અને જોખમ')} items={d.causes} />
        <ListSection icon="medical" title={L('Treatment Options', 'उपचार विकल्प', 'સારવાર વિકલ્પો')} items={d.treatments} />
        <Section icon="alert-circle" title={L('When to See a Doctor', 'डॉक्टर से कब मिलें', 'ડૉક્ટરને ક્યારે મળવું')} content={d.when_to_see} danger />

        <PrimaryButton
          title={L('Book Consultation', 'परामर्श बुक करें', 'કન્સલ્ટેશન બુક કરો')}
          onPress={() => router.push('/(tabs)/book')}
          testID="disease-book-button"
          style={{ marginTop: 16 }}
          icon={<Ionicons name="calendar" size={20} color="#fff" />}
        />
        <SecondaryButton
          title={L('Chat on WhatsApp', 'WhatsApp पर चैट', 'WhatsApp પર ચૅટ')}
          onPress={() =>
            Linking.openURL('whatsapp://send?phone=918155075669').catch(() =>
              Linking.openURL('https://wa.me/918155075669'),
            )
          }
          style={{ marginTop: 10 }}
          testID="disease-whatsapp-button"
          icon={<FontAwesome5 name="whatsapp" size={18} color={COLORS.primary} />}
        />
      </Animated.ScrollView>

      <CollapsibleHero
        title={d.name}
        onBack={goBack}
        backgroundImage={d.image_url}
        headerHeight={collapse.headerHeight}
        heroOpacity={collapse.heroOpacity}
        heroTranslate={collapse.heroTranslate}
        compactOpacity={collapse.compactOpacity}
        imgOpacity={collapse.imgOpacity}
        testID="disease-back"
      >
        <View style={styles.heroIcon}>
          <MaterialCommunityIcons name={(d.icon as any) || 'medical-bag'} size={36} color={COLORS.accent} />
        </View>
        <Text style={styles.heroTitle} numberOfLines={2}>{d.name}</Text>
        <Text style={styles.heroTag} numberOfLines={2}>{d.tagline}</Text>
      </CollapsibleHero>

      {/* Floating language selector */}
      <View style={styles.langFloat} pointerEvents="box-none">
        <LanguageDropdown testID="disease-detail-lang" />
      </View>
    </View>
  );
}

function Section({ icon, title, content, danger }: any) {
  return (
    <View style={[styles.section, danger && { backgroundColor: '#FFEBEE', borderColor: COLORS.accent }]}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={18} color={danger ? COLORS.accent : COLORS.primary} />
        <Text style={[styles.sectionTitle, danger && { color: COLORS.accent }]}>{title}</Text>
      </View>
      <Text style={styles.sectionBody}>{content}</Text>
    </View>
  );
}

function ListSection({ icon, title, items }: any) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {items?.map((item: string, i: number) => (
        <View key={i} style={styles.bullet}>
          <View style={styles.dot} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heroIcon: {
    width: 70,
    height: 70,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { ...FONTS.h1, color: '#fff', marginTop: 12, textAlign: 'center', fontSize: 22 },
  heroTag: { ...FONTS.body, color: '#E0F7FA', marginTop: 4, textAlign: 'center', fontSize: 13 },
  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary },
  sectionBody: { ...FONTS.body, color: COLORS.textPrimary, lineHeight: 22 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 8 },
  bulletText: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, lineHeight: 20 },
  langFloat: {
    position: 'absolute',
    top: 50,
    right: 16,
  },
});
