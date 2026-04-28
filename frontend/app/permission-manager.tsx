// Permission Manager — owner's umbrella page for all permission &
// access controls in the clinic.
//
// This is a HUB that surfaces and links into every place where the
// owner can grant / revoke a power. Each card on this page is a
// self-contained section with a quick summary and a "Manage" button
// that jumps to the dedicated screen handling that permission.
//
// Sections (today):
//   1. Messaging Permissions  → /messaging-permissions
//   2. Team Roles & Access    → /dashboard?tab=team
//   3. Booking Approvals      → settings (auto-approve etc.)
//   4. Patient Self-service   → access controls for patients
//
// The page is owner-only (server enforces the underlying APIs; this
// screen just hides the controls behind a friendly UI).

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../src/api';
import { goBackSafe } from '../src/nav';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import OwnersPanel from '../src/owners-panel';
import { useResponsive } from '../src/responsive';

type Section = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  desc: string;
  // Live summary: e.g. "5 allowed · 2 revoked".
  summary?: string;
  onPress: () => void;
};

export default function PermissionManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isWebDesktop } = useResponsive();
  // Owner-tier gate (primary_owner OR partner OR super_owner OR
  // legacy "owner"). Partners now reach this screen because their
  // privilege envelope matches a primary_owner's everywhere except
  // for partner management — and the owners-panel's inner sections
  // self-hide based on the finer-grained tier flags.
  const isOwner =
    user?.role === 'super_owner' ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner'; // legacy alias

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [counts, setCounts] = useState<{
    msg_total: number;
    msg_allowed: number;
    msg_revoked: number;
    team_count: number;
    pending_bookings: number;
  }>({ msg_total: 0, msg_allowed: 0, msg_revoked: 0, team_count: 0, pending_bookings: 0 });

  const load = useCallback(async () => {
    if (!isOwner) { setLoading(false); return; }
    try {
      const [perms, team, analytics] = await Promise.all([
        api.get('/admin/messaging-permissions').catch(() => ({ data: null })),
        api.get('/team').catch(() => ({ data: null })),
        api.get('/analytics/dashboard', { params: { months: 1 } }).catch(() => ({ data: null })),
      ]);
      const items = (perms as any)?.data?.items || [];
      const msg_allowed = items.filter((r: any) => r.allowed).length;
      const teamMembers = (team as any)?.data?.members || (team as any)?.data || [];
      setCounts({
        msg_total: items.length,
        msg_allowed,
        msg_revoked: items.length - msg_allowed,
        team_count: Array.isArray(teamMembers) ? teamMembers.length : 0,
        pending_bookings: Number((analytics as any)?.data?.totals?.pending_bookings) || 0,
      });
    } catch {
      /* keep zeros */
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!isOwner) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.empty}>
          <Ionicons name="lock-closed" size={48} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Owner only</Text>
          <Text style={styles.emptySub}>This panel is restricted to the clinic owner.</Text>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn2}>
            <Text style={styles.backBtn2Text}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const sections: Section[] = [
    {
      key: 'messaging',
      icon: 'paper-plane',
      color: '#0E7C8B',
      title: 'Messaging Permissions',
      desc: 'Authorise / revoke who can send personal messages inside the app.',
      summary: `${counts.msg_allowed} allowed · ${counts.msg_revoked} revoked · ${counts.msg_total} total`,
      onPress: () => router.push('/messaging-permissions' as any),
    },
    {
      key: 'team',
      icon: 'people',
      color: '#7C3AED',
      title: 'Team Roles & Access',
      desc: 'Manage staff roles (doctor / partner / assistant / reception / nursing) and their dashboard access.',
      summary: `${counts.team_count} active member${counts.team_count === 1 ? '' : 's'}`,
      onPress: () => router.push('/dashboard?tab=team' as any),
    },
    {
      key: 'bookings',
      icon: 'calendar',
      color: '#10B981',
      title: 'Booking Approvals',
      desc: 'Review pending booking requests. Confirm or decline from the Bookings panel.',
      summary: counts.pending_bookings > 0
        ? `${counts.pending_bookings} pending approval${counts.pending_bookings === 1 ? '' : 's'}`
        : 'No pending requests',
      onPress: () => router.push('/dashboard?tab=bookings' as any),
    },
    {
      key: 'broadcasts',
      icon: 'megaphone',
      color: '#F59E0B',
      title: 'Broadcasts & Push',
      desc: 'Approve or reject team-drafted broadcasts before they go out.',
      onPress: () => router.push('/dashboard?tab=broadcasts' as any),
    },
    {
      key: 'patient_access',
      icon: 'medical',
      color: '#EC4899',
      title: 'Patient Self-service',
      desc: 'Patients can view bookings, prescriptions and notes by default. Use the Messaging panel to enable patient-initiated chats.',
      onPress: () => router.push('/messaging-permissions' as any),
    },
    {
      key: 'profile',
      icon: 'person-circle',
      color: '#0EA5E9',
      title: 'My Profile & Account',
      desc: 'Owner identity, sign-in identifiers and language preferences.',
      onPress: () => router.push('/profile' as any),
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }, isWebDesktop && { paddingTop: 12, paddingBottom: 10 }]}>
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.iconBtn} testID="perm-mgr-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={styles.kicker}>OWNER · ADMIN</Text>
            <Text style={styles.title}>Permission Manager</Text>
            <Text style={styles.sub}>Authorise team & patient powers in one place.</Text>
          </View>
          <Ionicons name="key" size={22} color="#fff" />
        </View>
      </LinearGradient>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={[{ padding: 16, paddingBottom: 40 + insets.bottom }, isWebDesktop && { maxWidth: 1120, width: '100%', alignSelf: 'center', padding: 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {/* Owners & Partners — surfaced FIRST because they are the
              highest-impact role-management actions in the app. The
              panel internally hides each section based on the
              current user's tier (super_owner / primary_owner /
              partner). */}
          <OwnersPanel />

          <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 } : undefined}>
          {sections.map((s) => (
            <TouchableOpacity
              key={s.key}
              onPress={s.onPress}
              activeOpacity={0.78}
              style={[styles.card, isWebDesktop && { width: '49%', marginBottom: 0 }]}
              testID={`perm-mgr-${s.key}`}
            >
              <View style={[styles.cardIcon, { backgroundColor: s.color + '14' }]}>
                <Ionicons name={s.icon} size={22} color={s.color} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.cardTitle}>{s.title}</Text>
                <Text style={styles.cardDesc}>{s.desc}</Text>
                {s.summary ? (
                  <View style={[styles.cardSummary, { backgroundColor: s.color + '0F' }]}>
                    <View style={[styles.cardSummaryDot, { backgroundColor: s.color }]} />
                    <Text style={[styles.cardSummaryText, { color: s.color }]}>{s.summary}</Text>
                  </View>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />
            </TouchableOpacity>
          ))}
          </View>

          <View style={styles.footnote}>
            <Ionicons name="information-circle" size={14} color={COLORS.textSecondary} />
            <Text style={styles.footnoteText}>
              These controls are server-enforced — even if a card is bypassed, the API rejects unauthorised actions.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 14, paddingBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  kicker: { ...FONTS.label, color: 'rgba(255,255,255,0.85)', fontSize: 10, letterSpacing: 0.6 },
  title: { ...FONTS.h3, color: '#fff', fontSize: 18, marginTop: 1 },
  sub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14.5 },
  cardDesc: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 3, lineHeight: 17 },
  cardSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6,
  },
  cardSummaryDot: { width: 6, height: 6, borderRadius: 3 },
  cardSummaryText: { ...FONTS.bodyMedium, fontSize: 11, letterSpacing: 0.3 },

  empty: { alignItems: 'center', padding: 40, gap: 12 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', fontSize: 12 },
  backBtn2: { backgroundColor: COLORS.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: RADIUS.pill, marginTop: 10 },
  backBtn2Text: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },

  footnote: {
    marginTop: 14, padding: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: COLORS.primary + '0E',
    borderRadius: RADIUS.md,
  },
  footnoteText: { flex: 1, ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, lineHeight: 17 },
});
