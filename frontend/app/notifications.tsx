import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, formatDistanceToNow } from 'date-fns';
import { formatIST, parseBackendDate } from '../src/date';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useNotifications, Notification } from '../src/notifications';
import { useAuth } from '../src/auth';
import { EmptyState } from '../src/empty-state';

const KIND_META: Record<string, { icon: keyof typeof import('@expo/vector-icons/Ionicons').glyphMap; color: string }> = {
  role_change: { icon: 'shield-checkmark', color: COLORS.primary },
  booking: { icon: 'calendar', color: COLORS.primary },
  broadcast: { icon: 'megaphone', color: COLORS.accent },
  referral: { icon: 'people', color: COLORS.success || COLORS.primary },
  rx: { icon: 'document-text', color: COLORS.primary },
  info: { icon: 'information-circle', color: COLORS.primary },
};

function humanTime(iso: string) {
  try {
    const d = parseBackendDate(iso);
    if (isNaN(d.getTime())) return iso;
    const deltaMs = Date.now() - d.getTime();
    if (deltaMs < 6 * 24 * 60 * 60 * 1000) {
      return formatDistanceToNow(d, { addSuffix: true });
    }
    // Show timestamps older than 6 days in Indian Standard Time.
    return formatIST(d);
  } catch {
    return iso;
  }
}
// Keep `format` in the import graph — legacy callers may still use it.
void format;

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { items, unread, loading, refresh, markRead, markAllRead } = useNotifications();
  const { user } = useAuth();
  const isStaff =
    user && (user.role === 'owner' || user.role === 'doctor' ||
             user.role === 'assistant' || user.role === 'staff' ||
             (user as any).can_approve_bookings);

  // Partition for section headers (unread first, then earlier read).
  const { unreadItems, readItems } = useMemo(() => {
    const u: Notification[] = [];
    const r: Notification[] = [];
    items.forEach((n) => (n.read ? r.push(n) : u.push(n)));
    return { unreadItems: u, readItems: r };
  }, [items]);

  const onPress = async (n: Notification) => {
    if (!n.read) await markRead(n.id);
    const data: any = n.data || {};
    // Deep-link by notification kind + data payload.
    if (n.kind === 'role_change') {
      router.push('/(tabs)/more' as any);
      return;
    }
    if (n.kind === 'booking') {
      // Staff goes to the full booking detail (can take actions);
      // patients land on their My Bookings list where the badge/reason shows.
      if (data.booking_id) {
        if (isStaff) {
          router.push(`/bookings/${data.booking_id}` as any);
        } else {
          router.push('/my-bookings' as any);
        }
      } else {
        router.push(isStaff ? '/dashboard' : '/my-bookings' as any);
      }
      return;
    }
    if (n.kind === 'rx') {
      if (data.prescription_id) {
        router.push(`/prescriptions/${data.prescription_id}` as any);
      } else {
        router.push('/prescriptions' as any);
      }
      return;
    }
    if (n.kind === 'broadcast') {
      if (isStaff) {
        router.push('/dashboard' as any);
      } else {
        router.push('/blog' as any);
      }
      return;
    }
    if (n.kind === 'referral') {
      router.push('/dashboard' as any);
      return;
    }
    if (n.kind === 'note_reminder') {
      const noteId = data?.note_id;
      if (noteId) {
        router.push({ pathname: '/notes/[id]', params: { id: noteId } } as any);
      } else {
        router.push('/notes' as any);
      }
      return;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="notif-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        {unread > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAll} testID="notif-mark-all">
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {items.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
        >
          <EmptyState
            icon="notifications-off-outline"
            title="You're all caught up"
            subtitle="Role changes, booking updates and other alerts will appear here."
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />}
        >
          {unreadItems.length > 0 && (
            <Text style={styles.sectionLabel}>
              Unread ({unreadItems.length})
            </Text>
          )}
          {unreadItems.map((n) => renderRow(n))}
          {readItems.length > 0 && (
            <Text style={[styles.sectionLabel, unreadItems.length > 0 && { marginTop: 18 }]}>
              Earlier
            </Text>
          )}
          {readItems.map((n) => renderRow(n))}
        </ScrollView>
      )}
    </SafeAreaView>
  );

  function renderRow(n: Notification) {
    const meta = KIND_META[n.kind] || KIND_META.info;
    return (
      <TouchableOpacity
        key={n.id}
        activeOpacity={0.75}
        onPress={() => onPress(n)}
        style={[styles.card, !n.read && styles.unread]}
        testID={`notif-${n.id}`}
      >
        <View style={[styles.iconWrap, { backgroundColor: meta.color + '18' }]}>
          <Ionicons name={meta.icon} size={20} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.titleText} numberOfLines={1}>{n.title}</Text>
            {!n.read && <View style={styles.dot} />}
          </View>
          <Text style={styles.body}>{n.body}</Text>
          <Text style={styles.time}>{humanTime(n.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  }
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h3, color: COLORS.textPrimary, flex: 1 },
  markAll: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary + '14' },
  markAllText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  sectionLabel: {
    ...FONTS.label,
    color: COLORS.textSecondary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginLeft: 2,
  },
  unread: { borderColor: COLORS.primary + '50', backgroundColor: COLORS.primary + '06' },
  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  titleText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flexShrink: 1 },
  body: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4 },
  time: { ...FONTS.label, color: COLORS.textDisabled, fontSize: 10, marginTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
});
