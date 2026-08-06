/**
 * MenuGrid — 4-column icon grid used by the More tab + web sidebar
 * to compress long sections (Practice / Administration) into a
 * scannable grid. Each tile has a coloured icon chip + a tight
 * 2-line label.
 *
 * Why a grid (and not a list)?
 *  • A clinic-app More tab routinely has 10-15 admin entries. As a
 *    list it scrolls 3 screens; as a 4×N grid it fits one screen.
 *  • Doctors hit Administration <2× / day — a quick glance + tap is
 *    enough, full descriptions live on the destination screen.
 *  • Practice items DO have sub-labels because they're more frequent
 *    AND the labels alone are ambiguous ("Notes" — who's notes?), so
 *    we keep that as a list. Only Administration uses the grid.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';

export type GridTile = {
  icon: any;
  iconLib?: 'ion' | 'mci';
  /** Optional tile accent colour — defaults to brand primary. */
  color?: string;
  label: string;
  /** Optional small badge (e.g. "Copy", count). */
  pill?: string;
  /** Either provide route OR action — same as ListMenuItem. */
  route?: string;
  action?: () => void;
  testID?: string;
};

type Props = {
  tiles: GridTile[];
  /** 4 cols on both phones and web/tablet (matches mobile-web parity). */
  columns?: number;
  onTap: (tile: GridTile) => void;
};

export default function MenuGrid({ tiles, columns = 4, onTap }: Props) {
  return (
    <View style={styles.grid}>
      {tiles.map((tile, i) => {
        const accent = tile.color || COLORS.primary;
        return (
          <TouchableOpacity
            key={tile.testID || `grid-${i}`}
            onPress={() => onTap(tile)}
            activeOpacity={0.7}
            style={[styles.tile, { width: `${100 / columns}%` }]}
            testID={tile.testID}
          >
            <View style={[styles.iconBubble, { backgroundColor: accent + '33', borderColor: accent + '66' }]}>
              {tile.iconLib === 'mci' ? (
                <MaterialCommunityIcons name={tile.icon} size={20} color={accent} />
              ) : (
                <Ionicons name={tile.icon} size={20} color={accent} />
              )}
              {tile.pill ? (
                <View style={[styles.pill, { backgroundColor: accent }]}>
                  <Text style={styles.pillText}>{tile.pill}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.label} numberOfLines={2}>{tile.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    marginTop: 4,
  },
  tile: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center',
  },
  iconBubble: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    position: 'relative',
    // No elevation / shadow — Android's elevation:1 made the pale
    // bubble look like a gray gradient under the colored icon.
  },
  label: {
    ...FONTS.label,
    color: COLORS.textPrimary,
    fontSize: 10.5,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 13,
    minHeight: 26,
  },
  pill: {
    position: 'absolute',
    top: -6, right: -6,
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999,
  },
  pillText: { ...FONTS.label, color: '#fff', fontSize: 9 },
});
