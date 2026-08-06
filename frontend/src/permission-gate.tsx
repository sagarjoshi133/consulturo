/**
 * <PermissionGate> — small wrapper that renders `children` only when
 * the current user has at least one of the listed flags / role. Used
 * to gate admin-side screens without duplicating the lock UI on every
 * page. Designed for defence-in-depth — the backend ALSO enforces
 * these permissions; this wrapper just gives a friendlier 403.
 *
 * Usage:
 *   <PermissionGate require="can_manage_settings" title="Branding">
 *     {... actual screen ...}
 *   </PermissionGate>
 *
 * `require` can be a single flag, an array of flags (ANY-match), or
 *   the special value 'owner' to require owner-tier role.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';

type PermFlag =
  | 'can_manage_billing'
  | 'can_manage_ipd'
  | 'can_view_analytics'
  | 'can_manage_blog'
  | 'can_manage_settings'
  | 'can_approve_bookings'
  | 'can_approve_broadcasts'
  | 'can_prescribe'
  | 'can_manage_surgeries'
  | 'can_manage_availability'
  | 'dashboard_full_access'
  | 'owner';

type Props = {
  /** Single flag or list — ANY match grants access. Always include owner-tier shortcut. */
  require: PermFlag | PermFlag[];
  /** Screen title used in the locked banner. */
  title?: string;
  /** Override the default friendly message. */
  message?: string;
  children: React.ReactNode;
};

const OWNER_ROLES = new Set(['super_owner', 'primary_owner', 'partner', 'owner']);

export default function PermissionGate({ require, title = 'This screen', message, children }: Props) {
  const router = useRouter();
  const { user } = useAuth() as any;
  const flags = Array.isArray(require) ? require : [require];

  const role = (user?.role || '') as string;
  const isOwner = OWNER_ROLES.has(role);
  // Full Dashboard Access also unlocks any owner-equivalent surface.
  const fullAccess = !!user?.dashboard_full_access;

  // Allow when EITHER: owner-tier OR full-access OR any of the listed
  // flags is true on the user record. The 'owner' literal short-
  // circuits to the role check.
  const allowed = !!user && (
    isOwner
    || flags.includes('owner') && isOwner
    || flags.some((f) => f === 'dashboard_full_access' ? fullAccess : !!user[f])
  );

  if (allowed) return <>{children}</>;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} style={styles.back} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.centered} testID="perm-gate-locked">
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={32} color={COLORS.warning} />
        </View>
        <Text style={styles.h}>Permission required</Text>
        <Text style={styles.sub}>
          {message
            || `Your account doesn't have access to ${title}. Ask the owner to grant the relevant permission under Team → Edit member.`}
        </Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)/more' as any)} style={styles.btn} testID="perm-gate-back">
          <Ionicons name="home-outline" size={16} color="#fff" />
          <Text style={styles.btnText}>Back to More</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 12 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.warning + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  h: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  btn: {
    marginTop: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
  },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
});
