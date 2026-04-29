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
import { COLORS, FONTS } from '../src/theme';
import { useResponsive } from '../src/responsive';

/**
 * Videos screen — patient-facing list of educational uploads.
 *
 * Source priority (driven by /api/videos which already merges):
 *   1. Primary-Owner-configured external YouTube channel (Branding panel)
 *   2. Server-level YOUTUBE_API_KEY env (legacy ConsultUro default)
 *   3. Hard-coded VIDEOS_SEED fallback
 *
 * Cards adopt a premium / editorial style:
 *   - Compact thumbnail (140 px) with floating play button
 *   - Floating category chip on top-left of thumbnail
 *   - Title + meta row below; subtle border + soft shadow
 *   - 2-column on desktop / wide tablets; 1-column on phone
 */
export default function Videos() {
  const router = useRouter();
  const [videos, setVideos] = useState<any[]>([]);
  const [channelUrl, setChannelUrl] = useState<string>('https://www.youtube.com/@dr_sagar_j');
  const { isWebDesktop, isWebWide } = useResponsive();

  useEffect(() => {
    api.get('/videos').then((r) => setVideos(r.data || [])).catch(() => {});
    // Surface the clinic's configured external channel (if any) on
    // the "Open YouTube Channel" CTA. Falls back to the legacy
    // ConsultUro channel handle when no external channel is set.
    api
      .get('/clinic-settings')
      .then((r) => {
        const cs = r.data || {};
        if (cs.external_youtube_channel_url) {
          setChannelUrl(cs.external_youtube_channel_url);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="videos-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Videos</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: isWebDesktop ? 1100 : 680 }}>
          <Text style={styles.subtitle}>Educational videos by your urology team</Text>

          <TouchableOpacity
            onPress={() => Linking.openURL(channelUrl)}
            style={styles.ytBtn}
            testID="videos-youtube-channel"
            activeOpacity={0.85}
          >
            <View style={styles.ytIcon}>
              <Ionicons name="logo-youtube" size={18} color="#fff" />
            </View>
            <Text style={styles.ytBtnText} numberOfLines={1}>Open YouTube Channel</Text>
            <Ionicons name="arrow-forward" size={14} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <View style={isWebDesktop ? styles.grid : undefined}>
            {videos.map((v) => (
              <TouchableOpacity
                key={v.id}
                onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${v.youtube_id}`)}
                activeOpacity={0.86}
                style={[styles.card, isWebDesktop && (isWebWide ? styles.cardDesktop3 : styles.cardDesktop2)]}
                testID={`video-${v.id}`}
              >
                <View style={styles.thumbWrap}>
                  <Image source={{ uri: v.thumbnail }} style={styles.thumb} />
                  <View style={styles.thumbOverlay} pointerEvents="none" />
                  <View style={styles.playBtn}>
                    <Ionicons name="play" size={18} color="#fff" />
                  </View>
                  {v.duration ? (
                    <View style={styles.duration}>
                      <Text style={styles.durText}>{v.duration}</Text>
                    </View>
                  ) : null}
                  {v.category ? (
                    <View style={styles.catPill}>
                      <Text style={styles.catText}>{v.category}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.vTitle} numberOfLines={2}>{v.title}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="logo-youtube" size={11} color="#E53935" />
                    <Text style={styles.metaText}>YouTube · Watch →</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: 14 },

  // YouTube CTA — minimal pill instead of full-width button so it
  // recedes visually and lets the cards hold the spotlight.
  ytBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1, borderColor: '#EEF2F4',
    shadowColor: '#0F172A', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
    elevation: 1,
    marginBottom: 16,
  },
  ytIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#E53935',
    alignItems: 'center', justifyContent: 'center',
  },
  ytBtnText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1, fontSize: 13 },

  // Premium card: hairline border + soft shadow
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1, borderColor: '#EEF2F4',
    shadowColor: '#0F172A', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
    elevation: 1,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  cardDesktop2: { width: '48.5%' },
  cardDesktop3: { width: '32%' },

  thumbWrap: { position: 'relative' },
  thumb: { width: '100%', height: 140, backgroundColor: '#000' },
  thumbOverlay: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    height: 50,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  playBtn: {
    position: 'absolute',
    top: '50%', left: '50%',
    marginLeft: -22, marginTop: -22,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(229,57,53,0.92)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
    elevation: 4,
  },
  duration: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.78)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  durText: { ...FONTS.body, color: '#fff', fontSize: 10, fontFamily: 'Manrope_700Bold' },

  // Floating category chip — sits over the thumbnail's overlay
  catPill: {
    position: 'absolute',
    top: 10, left: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 9, paddingVertical: 3,
    borderRadius: 999,
  },
  catText: {
    ...FONTS.label, color: COLORS.primary,
    fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase',
    fontFamily: 'Manrope_700Bold',
  },

  cardBody: { padding: 12, paddingTop: 10 },
  vTitle: {
    ...FONTS.h4, color: COLORS.textPrimary,
    fontSize: 14, lineHeight: 19,
    fontFamily: 'Manrope_700Bold',
  },
  metaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#F1F5F8',
  },
  metaText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
});
