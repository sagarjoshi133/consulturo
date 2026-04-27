import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../src/api';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useResponsive } from '../src/responsive';

export default function Videos() {
  const router = useRouter();
  const [videos, setVideos] = useState<any[]>([]);
  const { isWebDesktop, isWebWide } = useResponsive();

  useEffect(() => {
    api.get('/videos').then((r) => setVideos(r.data)).catch(() => {});
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="videos-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Videos</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.subtitle}>Educational videos by Dr. Sagar Joshi</Text>

        <TouchableOpacity
          onPress={() => Linking.openURL('https://www.youtube.com/@dr_sagar_j')}
          style={styles.ytBtn}
          testID="videos-youtube-channel"
        >
          <Ionicons name="logo-youtube" size={22} color="#FF0000" />
          <Text style={styles.ytBtnText}>Open YouTube Channel</Text>
          <Ionicons name="open-outline" size={16} color={COLORS.textSecondary} />
        </TouchableOpacity>

        {/* Desktop: 2 / 3-column grid for video thumbnails. Mobile
            keeps the existing single-column stack. */}
        <View style={isWebDesktop ? styles.grid : undefined}>
        {videos.map((v) => (
          <TouchableOpacity
            key={v.id}
            onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${v.youtube_id}`)}
            activeOpacity={0.85}
            style={[styles.card, isWebDesktop && (isWebWide ? styles.cardDesktop3 : styles.cardDesktop2)]}
            testID={`video-${v.id}`}
          >
            <View style={{ position: 'relative' }}>
              <Image source={{ uri: v.thumbnail }} style={styles.thumb} />
              <View style={styles.playBtn}>
                <Ionicons name="play" size={22} color="#fff" />
              </View>
              {v.duration ? (
                <View style={styles.duration}>
                  <Text style={styles.durText}>{v.duration}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ padding: 12 }}>
              <View style={styles.catPill}>
                <Text style={styles.catText}>{v.category}</Text>
              </View>
              <Text style={styles.vTitle}>{v.title}</Text>
            </View>
          </TouchableOpacity>
        ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 12 },
  ytBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 16 },
  ytBtnText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1 },
  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, marginBottom: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cardDesktop2: { width: '48.5%' },
  cardDesktop3: { width: '32%' },
  thumb: { width: '100%', height: 200, backgroundColor: '#000' },
  playBtn: { position: 'absolute', top: '50%', left: '50%', marginLeft: -28, marginTop: -28, width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(229,57,53,0.9)', alignItems: 'center', justifyContent: 'center' },
  duration: { position: 'absolute', bottom: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  durText: { ...FONTS.body, color: '#fff', fontSize: 11 },
  catPill: { alignSelf: 'flex-start', backgroundColor: COLORS.primary + '18', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  catText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  vTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 6 },
});
