/**
 * Small, tappable map preview for a place.
 *
 * Uses Google Maps' keyless embed (output=embed) so it needs no API
 * key. On web it renders an <iframe>, on native a non-interactive
 * WebView. Tapping opens the full map (the provided `openUrl`, else a
 * Maps search for the query).
 */
import React from 'react';
import { Platform, TouchableOpacity, View, Text, StyleSheet, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from './theme';

export default function MapThumbnail({
  query,
  openUrl,
  height = 120,
}: {
  query: string;
  openUrl?: string;
  height?: number;
}) {
  const embed = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`;
  const open = () => {
    const url = openUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={open} style={[styles.wrap, { height }]} testID="map-thumb">
      {Platform.OS === 'web'
        ? React.createElement('iframe', {
            src: embed,
            style: { border: 0, width: '100%', height: '100%', pointerEvents: 'none' },
            loading: 'lazy',
            title: 'map',
          })
        : (
          <WebView
            source={{ uri: embed }}
            style={{ flex: 1, backgroundColor: '#E8EEF0' }}
            pointerEvents="none"
            scrollEnabled={false}
            androidLayerType="hardware"
            startInLoadingState={false}
          />
        )}
      {/* Tap affordance */}
      <View style={styles.pill} pointerEvents="none">
        <Ionicons name="navigate" size={11} color="#fff" />
        <Text style={styles.pillTxt}>Open map</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, borderRadius: 12, overflow: 'hidden', backgroundColor: '#E8EEF0', borderWidth: 1, borderColor: COLORS.border },
  pill: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,124,139,0.92)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14 },
  pillTxt: { ...FONTS.bodyMedium, color: '#fff', fontSize: 11 },
});
