/**
 * Comm V2 hub — landing screen for owner canary. Three tiles:
 * Notifications · Messages · Broadcast Studio.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { V2, shared } from '../../src/comm-v2/ui-tokens';
import { useCommunicationsV2 } from '../../src/comm-v2/communications-provider';

export default function CommV2Hub() {
  const router = useRouter();
  const { counts, messageCounts, enabled, refresh } = useCommunicationsV2();

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>Communications V2</Text>
        <Pressable onPress={() => refresh()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="refresh" size={18} color={V2.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        {!enabled ? (
          <View style={[shared.card, { backgroundColor: V2.warningSoft, borderColor: V2.warning + '40' }]}>
            <Text style={{ color: V2.warning, fontWeight: '700', marginBottom: 4 }}>Canary not active</Text>
            <Text style={{ color: V2.fgMuted, fontSize: 12 }}>
              Sign out and back in as an owner-tier account that has been added to the canary list.
            </Text>
          </View>
        ) : null}

        <Tile
          icon="notifications"
          title="Notification Centre"
          sub={`${counts.total_unread || 0} unread across ${Object.keys(counts.by_category || {}).length} categories`}
          onPress={() => router.push('/comm-v2/inbox' as any)}
        />
        <Tile
          icon="chatbubbles"
          title="Clinic Messages"
          sub={`${messageCounts.total_unread || 0} unread across ${messageCounts.conversation_count || 0} conversations`}
          onPress={() => router.push('/comm-v2/conversations' as any)}
        />
        <Tile
          icon="megaphone"
          title="Broadcast Studio"
          sub="Draft, preview, approve & analyse announcements"
          onPress={() => router.push('/comm-v2/broadcasts' as any)}
        />

        <View style={[shared.card, { marginTop: 10 }]}>
          <Text style={{ fontSize: 11, color: V2.fgMuted, letterSpacing: 0.5,
                          textTransform: 'uppercase', fontWeight: '700', marginBottom: 6 }}>
            About this preview
          </Text>
          <Text style={{ fontSize: 12, color: V2.fgMuted, lineHeight: 17 }}>
            These are the new Communications V2 surfaces. Legacy notification and message screens
            continue to work in parallel. Only canary users see this menu until the master flag flips.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ icon, title, sub, onPress }:
  { icon: any; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <View style={styles.iconBubble}>
        <Ionicons name={icon} size={22} color={V2.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={V2.fgHint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: V2.card, borderRadius: 14, padding: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: V2.border,
  },
  iconBubble: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: V2.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  tileTitle: { fontSize: 15, fontWeight: '700', color: V2.fg, marginBottom: 2 },
  tileSub: { fontSize: 12, color: V2.fgMuted, lineHeight: 16 },
});
