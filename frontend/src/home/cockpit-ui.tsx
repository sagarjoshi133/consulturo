/**
 * Shared UI primitives for the staff/owner/super-owner home cockpits.
 *
 * Designed to keep the three role-specific home screens
 * (owner-home, super-owner-home, staff-home) visually consistent
 * without duplicating the same card/KPI/tile JSX in three places.
 *
 * Everything here is presentation-only — data fetching happens in the
 * parent screen so each role can hit different endpoints.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../theme';
import { useAuth } from '../auth';
import { useNotifications } from '../notifications';
import { roleDisplayLabel } from '../dashboard/role-labels';

// ─── Animated Number ────────────────────────────────────────────────
// Count-up animation for KPI values. Drives the visual energy of the
// cockpit — KPIs feel "alive" instead of static. Falls back to plain
// rendering for non-numeric values (em-dash, "—", strings).
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedNumber({
  value,
  duration = 800,
  style,
}: {
  value: number | string;
  duration?: number;
  style?: any;
}) {
  const [display, setDisplay] = useState<number | string>(
    typeof value === 'number' ? 0 : value,
  );
  const fromRef = useRef<number>(0);
  const targetRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof value !== 'number') {
      setDisplay(value);
      return;
    }
    fromRef.current =
      typeof display === 'number' ? display : 0;
    targetRef.current = value;
    const startTime =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const tick = () => {
      const nowT =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsed = nowT - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const next = Math.round(
        fromRef.current + (targetRef.current - fromRef.current) * eased,
      );
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <Text style={style}>{display}</Text>;
}

// ─── Greeting Header ─────────────────────────────────────────────────
// Shared rounded gradient header card with avatar, greeting, role
// badge, language pill, inbox + bell. All three cockpits use this so
// the visual "skin" is identical across roles.
export function CockpitHeader({
  subtitle,
  onLangPress,
  langBadge,
  hideRoleBadge = false,
}: {
  subtitle?: string;
  onLangPress?: () => void;
  langBadge?: string;
  hideRoleBadge?: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { unread, personalUnread } = useNotifications();

  const firstName = (user?.name || '').trim().split(/\s+/)[0] || '';
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <LinearGradient
      colors={[COLORS.primary, COLORS.primaryDark || '#0a5d6b']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <View style={styles.headerTop}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={styles.headerGreet} numberOfLines={1}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </Text>
          {!!subtitle && (
            <Text style={styles.headerSub} numberOfLines={2}>
              {subtitle}
            </Text>
          )}
          {!hideRoleBadge && !!user?.role && (
            <View style={styles.roleBadge}>
              <Ionicons name="shield-checkmark" size={11} color="#fff" />
              <Text style={styles.roleBadgeText} numberOfLines={1}>
                {roleDisplayLabel(user.role)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.headerActions}>
          {onLangPress && (
            <TouchableOpacity
              onPress={onLangPress}
              style={styles.iconCircle}
              testID="cockpit-lang"
              accessibilityLabel="Language"
            >
              <Text style={styles.langText} allowFontScaling={false}>
                {langBadge || 'EN'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => router.push('/inbox' as any)}
            style={styles.iconCircle}
            testID="cockpit-inbox"
            accessibilityLabel="Inbox"
          >
            <Ionicons name="chatbubbles" size={18} color="#fff" />
            {personalUnread > 0 && (
              <View style={styles.dot}>
                <Text style={styles.dotText}>
                  {personalUnread > 9 ? '9+' : String(personalUnread)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={styles.iconCircle}
            testID="cockpit-bell"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications" size={18} color="#fff" />
            {unread > 0 && (
              <View style={styles.dot}>
                <Text style={styles.dotText}>
                  {unread > 9 ? '9+' : String(unread)}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push('/profile' as any)}
            style={styles.avatarCircle}
            testID="cockpit-profile"
          >
            {user?.picture ? (
              <Image
                source={{ uri: user.picture }}
                style={{ width: 38, height: 38, borderRadius: 19 }}
              />
            ) : (
              <Ionicons name="person" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
}

// ─── Quick Actions Row ──────────────────────────────────────────────
// Horizontal row of 4 white pill buttons that floats just below the
// hero on every role's home page. Visually identical to the patient
// home's existing quick-actions pattern (Book / WhatsApp / IPSS /
// Education) so the app feels uniform across roles. Items are passed
// in as a prop so each cockpit can pick its own 4 actions.
export type QuickAction = {
  key: string;
  label: string;
  icon: string;
  iconLib?: 'ion' | 'mci';
  color: string;
  onPress: () => void;
  testID?: string;
};

export function QuickActionsRow({ items }: { items: QuickAction[] }) {
  // When the cockpit passes more than 4 actions, render as a 2-row grid
  // (3 columns each). RN-web's flexWrap with percentage widths is
  // unreliable, so we explicitly chunk into rows of 3.
  const isGrid = items.length > 4;
  const rows = isGrid
    ? Array.from({ length: Math.ceil(items.length / 3) }, (_, i) => items.slice(i * 3, i * 3 + 3))
    : [items];

  const renderTile = (qa: QuickAction) => {
    const I: any = qa.iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;
    return (
      <TouchableOpacity
        key={qa.key}
        onPress={qa.onPress}
        activeOpacity={0.85}
        style={styles.qaTile}
        testID={qa.testID}
      >
        <View style={[styles.qaIcon, { backgroundColor: qa.color + '18' }]}>
          <I name={qa.icon as any} size={20} color={qa.color} />
        </View>
        <Text style={styles.qaLabel} numberOfLines={2}>
          {qa.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.qaRow, isGrid && styles.qaRowGrid]}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.qaInnerRow}>
          {row.map(renderTile)}
          {/* Pad incomplete rows with invisible placeholders so the
              last row's tiles align left rather than stretch wide. */}
          {row.length < 3 &&
            Array.from({ length: 3 - row.length }, (_, i) => (
              <View key={`pad-${i}`} style={styles.qaTile} />
            ))}
        </View>
      ))}
    </View>
  );
}

// ─── KPI Tile ────────────────────────────────────────────────────────
// Compact metric tile used in the 4-column KPI strip. Tap routes to
// the relevant dashboard tab.
export function KPITile({
  label,
  value,
  icon,
  color = COLORS.primary,
  onPress,
  loading,
  testID,
}: {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
  onPress?: () => void;
  loading?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      style={styles.kpiTile}
      testID={testID}
    >
      <View style={[styles.kpiIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      {loading ? (
        <Text style={[styles.kpiValue, { color }]}>…</Text>
      ) : (
        <AnimatedNumber value={value} style={[styles.kpiValue, { color }]} />
      )}
      <Text style={styles.kpiLabel} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Quick Action Tile ───────────────────────────────────────────────
// Large tappable tile shown in the "Quick actions" grid.
export function ActionTile({
  label,
  icon,
  iconLib = 'ion',
  color = COLORS.primary,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  iconLib?: 'ion' | 'mci';
  color?: string;
  onPress: () => void;
  testID?: string;
}) {
  const I: any = iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.actionTile}
      testID={testID}
    >
      <View style={[styles.actionIcon, { backgroundColor: color + '18' }]}>
        <I name={icon as any} size={22} color={color} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Section Header ──────────────────────────────────────────────────
export function SectionHeader({
  title,
  rightLabel,
  onRightPress,
}: {
  title: string;
  rightLabel?: string;
  onRightPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rightLabel && (
        <TouchableOpacity onPress={onRightPress} hitSlop={8}>
          <Text style={styles.sectionRight}>{rightLabel} ›</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Card Container ──────────────────────────────────────────────────
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: any;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  header: {
    borderRadius: RADIUS.lg,
    padding: 18,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: { elevation: 6 },
      default: { shadowColor: COLORS.primary, shadowOpacity: 0.18 } as any,
    }),
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerGreet: {
    ...FONTS.h2,
    fontSize: 22,
    color: '#fff',
    letterSpacing: -0.3,
  },
  headerSub: {
    ...FONTS.body,
    marginTop: 4,
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 18,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  roleBadgeText: {
    color: '#fff',
    ...FONTS.body,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  langText: {
    color: '#fff',
    ...FONTS.body,
    fontWeight: '700',
    fontSize: 11,
  },
  dot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotText: {
    color: '#fff',
    ...FONTS.body,
    fontWeight: '800',
    fontSize: 9,
  },
  // ── Quick Actions ──────────────────────────────────────────────
  qaRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    paddingHorizontal: 6,
    marginTop: -22, // float above the hero gradient by half its height
    marginHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.10,
        shadowRadius: 14,
      },
      android: { elevation: 5 },
      default: {},
    }),
  },
  qaTile: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 6,
  },
  // ── Grid variant (5+ items) — column container holding inner rows ──
  qaRowGrid: {
    flexDirection: 'column',
    gap: 12,
  },
  qaInnerRow: {
    flexDirection: 'row',
  },
  qaIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qaLabel: {
    ...FONTS.body,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    lineHeight: 14,
  },
  // ── KPI ─────────────────────────────────────────────────────────
  kpiTile: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 12,
    minHeight: 88,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  kpiIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  kpiValue: {
    ...FONTS.h2,
    fontSize: 22,
    letterSpacing: -0.4,
  },
  kpiLabel: {
    ...FONTS.body,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  // ── Action ──────────────────────────────────────────────────────
  actionTile: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    flex: 1,
    ...FONTS.body,
    fontWeight: '600',
    fontSize: 13,
    color: COLORS.textPrimary,
  },
  // ── Section + Card ──────────────────────────────────────────────
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },
  sectionTitle: {
    ...FONTS.h3,
    fontSize: 16,
    color: COLORS.textPrimary,
    letterSpacing: -0.2,
  },
  sectionRight: {
    ...FONTS.body,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
});
