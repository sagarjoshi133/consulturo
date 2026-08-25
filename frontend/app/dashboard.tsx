import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Platform,
  Image,
  Linking,
  RefreshControl,
  Dimensions,
  BackHandler,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { format, startOfWeek, endOfWeek, addDays, addWeeks, addMonths, startOfMonth, endOfMonth, isSameDay, isSameMonth, parseISO } from 'date-fns';
import { Alert } from 'react-native';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS, DOCTOR_PHOTO_URL } from '../src/theme';
import { PrimaryButton, SecondaryButton } from '../src/components';
import { SurgeriesPanel } from '../src/surgery-panel-lazy';
import { AvailabilityPanel, TeamPanelV2, BroadcastsPanel, AdminOverviewPanel, ReferrersPanel, ConsultationsPanel } from '../src/admin-panels-lazy';
import BrandingSettingsPanel from '../src/branding-settings-panel';
import { AnalyticsPanel } from '../src/analytics-panel-lazy';
import PatientReferralsPanel from '../src/patient-referrals-panel';
import AnnouncementsBanner from '../src/announcements/banner';
import OfflineRxBanner from '../src/offline-rx-banner';
import MessageComposer from '../src/message-composer-lazy';
import { resolvePatientRecipient } from '../src/message-recipient';
import { NotificationsHealthPanel } from '../src/notifications-health-panel';
import { AppErrorBoundary } from '../src/error-boundary';
import { BackupHealthPanel } from '../src/backup-health-panel';
import { EmptyState } from '../src/empty-state';
import { useToast } from '../src/toast';
import { useNotifications } from '../src/notifications';
import { DateField, TimeField } from '../src/date-picker';
import {
  fetchRxAndRun,
  printPrescription,
  downloadPrescriptionPdf,
  sharePrescriptionPdf,
  loadClinicSettings,
  ClinicSettings,
} from '../src/rx-pdf-lazy';
import { Dimensions as _Dimensions } from 'react-native';
void _Dimensions;
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Skeleton } from '../src/skeleton';
import { whatsappLink, telLink } from '../src/phone';
import { TodayGlance, SmartAlerts } from '../src/dashboard-widgets';
import { useResponsive } from '../src/responsive';
import { useTier } from '../src/tier';
import SuperOwnerDashboard from '../src/super-owner-dashboard';
import TenantSwitcher from '../src/TenantSwitcher';
import { useTenant } from '../src/tenant-context';
import AssistantBubble from '../src/assistant-bubble';
import IPDPanel from '../src/ipd-panel-lazy';

// ─── Extracted helpers / panels (2026-05-31 refactor) ──────────
// The CSV-export helper + PrescriptionsPanel + RxRowAction now live
// in /app/frontend/src/dashboard/* so this orchestrator can stay
// readable. Imported here so the existing JSX call-sites continue
// to work without changes.
import { downloadCsv } from '../src/dashboard/export-helpers';
import PrescriptionsPanel from '../src/dashboard/prescriptions-panel';

// ---------------------------------------------------------------
// CSV export helper (owner-only on backend). On web, triggers an
// actual file download (Blob + <a download>). On native, uses Share.
// ---------------------------------------------------------------

import { Animated as RNAnimated } from 'react-native';

// ContentPager + tab type — extracted to src/dashboard/content-pager.tsx
// on 2026-05-01 so this file can start shrinking below its 2.6k-line
// crash-prone bulk. See role-labels.ts for the same reason.
import ContentPager, { TabItem } from '../src/dashboard/content-pager';
import { PanelRefreshContext, usePanelRefresh } from '../src/panel-refresh';
// NB: PanelRefreshContext is imported only because dashboard.tsx
// (below) still accesses it directly in a few places.
import { displayDate, displayDateLong, display12h, parseUIDate, UI_DATE_PLACEHOLDER, parseBackendDate, formatISTDate } from '../src/date';
// Role constants + display-label helper extracted to src/dashboard/role-labels.ts
import { STAFF, ROLES, roleDisplayLabel } from '../src/dashboard/role-labels';
import BookingsPanel from "../src/dashboard/bookings-panel";
import { styles } from "../src/dashboard/dashboard-styles";

export default function Dashboard() {
  // Wraps the (massive) DashboardImpl component below in a local error
  // boundary. When a widget / panel (branding, broadcasts, team, etc.)
  // throws at render time the user sees a clean "Try again / Back to
  // Home" card INSTEAD of the entire nav Stack being unmounted — which
  // on Android manifests as "the app falls back to the Home tab".
  // 2026-05-01 — added after Dr. Joshi reported recurring dashboard
  // crashes that silently dropped him to the (tabs)/index Home.
  // 2026-05-30 — per-panel boundaries below also catch widget crashes
  // in place; this top-level boundary now offers Try Again + Go Back
  // (router.back) so the user is never silently teleported home.
  const router = useRouter();
  return (
    <AppErrorBoundary
      label="Dashboard"
      onBack={() => {
        try {
          if (router.canGoBack && router.canGoBack()) router.back();
          else router.replace('/' as any);
        } catch {}
      }}
    >
      <DashboardImpl />
    </AppErrorBoundary>
  );
}

function DashboardImpl() {
  const router = useRouter();
  const { user } = useAuth();
  const tier = useTier();
  // Tenant context — re-renders panels when the user switches clinics.
  const { currentClinicId } = useTenant();
  const currentClinicIdForPanels = currentClinicId || 'all';
  // `effectiveOwner` covers:
  //  • any owner-tier role (super_owner, primary_owner, legacy owner,
  //    partner) — they all get FULL dashboard access by default per
  //    the fundamental hierarchy (SuperOwner > PrimaryOwner > Partner
  //    > Team).
  //  • non-owner team members whose primary_owner explicitly flipped
  //    `dashboard_full_access: true` on their record.
  // The super-owner can LIMIT a specific primary_owner by flipping
  // `dashboard_full_access: false` — that revokes administrative tabs
  // (Analytics, Team, Backups, Blog, Broadcasts) but leaves core
  // clinical tabs (Today, Bookings, Consults, Rx, Surgeries) intact.
  const OWNER_TIER_ROLES = ['super_owner', 'primary_owner', 'owner', 'partner'] as const;
  const isOwnerRole = OWNER_TIER_ROLES.includes((user?.role as any));
  const isOwner = isOwnerRole;
  // `dashboardFullAccess` comes from /api/me/tier which applies the
  // "default-true-for-owner-tier unless explicitly revoked" rule on
  // the server. Fall back to the raw user prop for non-owner roles.
  const isFullAccess = isOwnerRole
    ? tier.dashboardFullAccess
    : !!(user as any)?.dashboard_full_access;
  const effectiveOwner = isOwnerRole ? isFullAccess : (isOwner || isFullAccess);
  // canPrescribe: all owner-tier roles (full Rx power) + doctors. Custom
  // "doctor-category" roles are validated server-side by require_prescriber.
  const canPrescribe = isOwnerRole || user?.role === 'doctor';
  const { unread: notifUnread, personalUnread } = useNotifications();
  // Initial tab from URL search params (`?tab=analytics` etc.) so More
  // tab routes like `/dashboard?tab=team` open the right panel.
  const params = useLocalSearchParams<{ tab?: string }>();
  type TabStateType = 'today' | 'consultations' | 'bookings' | 'analytics' | 'prescriptions' | 'surgeries' | 'ipd' | 'referrers' | 'patient_referrals' | 'availability' | 'team' | 'blog' | 'broadcasts' | 'homepage' | 'backups' | 'push';
  // Jun-16: `backups` and `push` were missing from this list so the
  // sidebar shortcut "/dashboard?tab=backups" silently fell back to
  // the default 'today' tab — looked like the Backups page was
  // broken when it was actually the param-validator dropping the
  // tab name. Keep this list in sync with the `tabs` array below.
  const TAB_VALUES: TabStateType[] = ['today', 'consultations', 'bookings', 'analytics', 'prescriptions', 'surgeries', 'ipd', 'referrers', 'patient_referrals', 'availability', 'team', 'blog', 'broadcasts', 'homepage', 'backups', 'push'];
  const initialTab: TabStateType = (() => {
    const v = String(params?.tab || '').toLowerCase();
    return (TAB_VALUES as string[]).includes(v) ? (v as TabStateType) : 'today';
  })();
  const [tab, setTab] = useState<TabStateType>(initialTab);

  // Re-sync when the user navigates back to dashboard with a different
  // ?tab=... param (Expo router can push the same screen with new params).
  // NOTE: extracting `params?.tab` into a plain variable so the effect
  // deps reference a stable primitive (string) instead of the `params`
  // object — on Android APK, `useLocalSearchParams` can return a NEW
  // params object identity on every render, which previously caused an
  // infinite re-render loop when used directly as a dep.
  const paramTab = params?.tab;
  React.useEffect(() => {
    const v = String(paramTab || '').toLowerCase();
    if ((TAB_VALUES as string[]).includes(v) && v !== tab) setTab(v as TabStateType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTab]);
  const [pendingCount, setPendingCount] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);
  // Bump these counters to signal "open the compose/new-entry form on mount"
  // to the Surgery / Broadcasts panels. Counters (instead of booleans) also
  // re-trigger on repeated FAB taps.
  const [sxAutoOpen, setSxAutoOpen] = useState(0);
  const [bcAutoOpen, setBcAutoOpen] = useState(0);
  // Personal-message composer — fired when staff/owner taps the
  // paper-plane icon on a Today / patient row.
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgRecipient, setMsgRecipient] = useState<any>(null);
  const tabScrollRef = React.useRef<ScrollView | null>(null);
  const tabPositions = React.useRef<Record<string, number>>({});
  const tabBarWidthRef = React.useRef<number>(Dimensions.get('window').width);
  // Safe-area insets for FAB positioning — gesture-nav devices (Android 10+)
  // need the FAB lifted above the home indicator. Avoids the overlap bug.
  const fabInsets = useSafeAreaInsets();
  const fabBottomBase = Math.max(fabInsets.bottom, 0) + 24;
  const { isWebDesktop } = useResponsive();

  // -- Collapsible hero on scroll --
  // The userCard sub-section collapses & fades out as the active panel
  // scrolls down. The topRow (back / title / bell) stays visible.
  // Range start (96) must exceed the *actual* content height of userCard
  // (photo 48 + name 17 + email 14 + badges 22 + paddings) so nothing is
  // clipped at rest — we measure dynamically via onLayout for safety.
  // Collapse-on-scroll for the user card. The hero stays compact while the user
  // scrolls down. The topRow (back / title / bell) stays visible.
  // Range start (96) must exceed the *actual* content height of userCard
  // (photo 48 + name 17 + email 14 + badges 22 + paddings) so nothing is
  // clipped at rest — we measure dynamically via onLayout for safety.
  const COLLAPSE_RANGE = 160;
  const [userCardMeasured, setUserCardMeasured] = React.useState(160);
  const scrollY = React.useRef(new RNAnimated.Value(0)).current;
  const onContentScroll = React.useMemo(
    () => RNAnimated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } } }],
      // height/marginTop are NOT natively animatable, so the driver must
      // run on the JS thread. We mitigate scroll-thread jank by raising
      // `scrollEventThrottle` to 32ms (≈30 fps) on the consumer end —
      // the eye doesn't notice the difference for a slow header
      // collapse, and the JS thread stays free for everything else.
      { useNativeDriver: false },
    ),
    [scrollY],
  );
  const userCardHeight = scrollY.interpolate({
    inputRange: [0, COLLAPSE_RANGE],
    outputRange: [userCardMeasured, 0],
    extrapolate: 'clamp',
  });
  const userCardOpacity = scrollY.interpolate({
    inputRange: [0, COLLAPSE_RANGE * 0.6, COLLAPSE_RANGE],
    outputRange: [1, 0.3, 0],
    extrapolate: 'clamp',
  });
  const userCardMargin = scrollY.interpolate({
    inputRange: [0, COLLAPSE_RANGE],
    outputRange: [6, 0],
    extrapolate: 'clamp',
  });

  // Poll pending bookings every 60s for the badge.
  React.useEffect(() => {
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const { data } = await api.get('/bookings/all', { params: { status: 'requested', limit: 200 } });
        if (!cancelled) setPendingCount(Array.isArray(data) ? data.length : 0);
      } catch {}
    };
    fetchCount();
    const iv = setInterval(fetchCount, 60000);
    return () => { cancelled = true; clearInterval(iv); };
    // Re-poll whenever the active clinic changes — the `data` returned
    // is always scoped to the current X-Clinic-Id header.
  }, [currentClinicId]);

  // Android hardware-back: if currently on a sub-tab (broadcasts, prescriptions,
  // etc.), pressing back returns to "today" first instead of leaving the app.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'today') {
        setTab('today');
        return true; // handled — don't exit
      }
      return false; // default behaviour: fall through (router.back / exit)
    });
    return () => sub.remove();
  }, [tab]);

  // Per-user custom tab whitelist (set by owner via Team panel).
  // Empty array = no override (use role-based defaults).
  const customTabs: string[] = (user as any)?.dashboard_tabs || [];
  const hasCustomList = customTabs.length > 0;

  /** Show a tab to a non-owner team member if:
   *  (a) they have full dashboard access, OR
   *  (b) the tab is in their custom whitelist.
   *  Owner / doctor / prescriber gating still applies first.
   */
  const allowTab = React.useCallback(
    (id: string): boolean => {
      if (effectiveOwner) return true;            // owner or full-access ⇒ all
      if (hasCustomList) return customTabs.includes(id);
      return false;                                // default: not visible
    },
    [effectiveOwner, hasCustomList, customTabs]
  );

  // Session 5.9 — explicit ability flags so non-prescriber team members
  // (e.g. nurse with `can_manage_ipd`) can still see their tab.
  const u = (user as any) || {};
  const canViewAnalytics = canPrescribe || !!u.can_view_analytics || allowTab('analytics');
  const canManageIpd      = canPrescribe || !!u.can_manage_ipd     || allowTab('ipd');
  const canManageSurgery  = canPrescribe || !!u.can_manage_surgeries || allowTab('surgeries');

  const tabs = React.useMemo(
    () => {
      // New ordering — frequency-of-use first.
      // 1. Daily tabs (Bookings → Consults → Rx → Availability)
      // 2. Other practice tabs (Analytics, Surgeries, Referrers, Broadcast, Blog)
      // 3. Admin / settings (Team → Notifs → Profile → Backups) — leftmost daily,
      //    rightmost rare, so the index stays stable for muscle-memory.
      const all: { id: string; label: string; icon: any; badge?: number; canSee: boolean }[] = [
        { id: 'today', label: 'Today', icon: 'home', canSee: true },
        { id: 'bookings', label: 'Bookings', icon: 'calendar', badge: pendingCount, canSee: true },
        { id: 'consultations', label: 'Consults', icon: 'medkit', canSee: true },
        { id: 'prescriptions', label: 'Rx', icon: 'document-text', canSee: canPrescribe || allowTab('rx') },
        { id: 'availability', label: 'Availability', icon: 'time', canSee: canPrescribe || allowTab('availability') },
        { id: 'analytics', label: 'Analytics', icon: 'analytics', canSee: canViewAnalytics },
        { id: 'surgeries', label: 'Surgeries', icon: 'medkit', canSee: canManageSurgery },
        { id: 'ipd', label: 'IPD', icon: 'bed', canSee: canManageIpd },
        { id: 'referrers', label: 'Referrers', icon: 'people-circle', canSee: true },
        { id: 'patient_referrals', label: 'Invites', icon: 'gift', canSee: isOwnerRole },
        { id: 'broadcasts', label: 'Broadcast', icon: 'megaphone', canSee: true },
        // Blog is reachable from More → Administration → Create Blog Post.
        // Removed from dashboard tabs (2026-05-29) to keep the bar focused
        // on day-to-day clinical work — fewer tabs = faster scanning.
        { id: 'team', label: 'Team', icon: 'people', canSee: allowTab('team') },
        { id: 'push', label: 'Notifs', icon: 'notifications', canSee: allowTab('push') },
        // 'branding' tab removed from dashboard — already accessible via
        // the dedicated Administration → Branding menu, avoids duplication.
        { id: 'backups', label: 'Backups', icon: 'cloud-upload', canSee: allowTab('backups') },
      ];
      return all.filter((t) => t.canSee).map(({ canSee, ...rest }) => rest);
    },
    [canPrescribe, isOwner, allowTab, pendingCount, tier.canCreateBlog, canViewAnalytics, canManageIpd, canManageSurgery]
  );

  // Keep the active tab pill centered both on tap and on swipe.
  // Uses measured x positions (set via onLayout on each tab pill) so the
  // active chip lands at the visible center regardless of label width.
  const centerActiveTab = React.useCallback((tabId: string) => {
    const x = tabPositions.current[tabId];
    if (typeof x !== 'number') return;
    // Approximate pill widths to compute center offset; we don't have width
    // readily so estimate from typical pill width 100. Fine-tuning works
    // because `scrollTo` clamps to content bounds.
    const containerW = tabBarWidthRef.current || Dimensions.get('window').width;
    const target = Math.max(0, x - containerW / 2 + 50);
    tabScrollRef.current?.scrollTo({ x: target, animated: true });
  }, []);

  React.useEffect(() => {
    centerActiveTab(tab);
  }, [tab, tabs, centerActiveTab]);

  // Map role → accent color for subtle visual distinction.
  const roleAccent = (user?.role === 'owner'
    ? '#0E7C8B'
    : user?.role === 'doctor'
    ? '#2563EB'
    : user?.role === 'reception'
    ? '#F59E0B'
    : user?.role === 'nursing'
    ? '#16A34A'
    : '#6B7280');

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <EmptyState icon="lock-closed" title="Sign in" sub="Please sign in as staff to access the dashboard." />
      </SafeAreaView>
    );
  }
  // Super-owner short-circuit: hide all clinical workflows. The
  // platform-admin gets a dedicated dashboard with stats / owners /
  // audit log instead of bookings / Rx / surgeries / patients. Placed
  // here (AFTER every hook above has run) so React's hook-order rule
  // is preserved.
  if (tier.isSuperOwner) {
    return <SuperOwnerDashboard />;
  }
  if (!STAFF.includes(user.role as string)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <EmptyState icon="shield-checkmark" title="Staff access only" subtitle={`Your current role is "${user.role}". Contact the owner to get staff access.`} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, isWebDesktop && styles.heroDesktop]}>
        <SafeAreaView edges={['top']}>
          <View style={[styles.topRow, isWebDesktop && { paddingTop: 0 }]}>
            <TouchableOpacity onPress={() => { if (router.canGoBack()) { router.back(); } else { router.replace('/' as any); } }} style={styles.backBtn} testID="dashboard-back">
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.headerTitle}>Dashboard</Text>
              <Text style={styles.headerDate}>{format(new Date(), 'EEEE, dd-MM-yyyy')}</Text>
            </View>
            <View style={styles.topActions}>
              <TouchableOpacity
                onPress={() => router.push('/inbox' as any)}
                style={styles.bellBtn}
                testID="dashboard-inbox"
                accessibilityLabel="Personal messages"
              >
                <Ionicons name="chatbubbles" size={19} color="#fff" />
                {personalUnread > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>
                      {personalUnread > 9 ? '9+' : personalUnread}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push('/notifications' as any)}
                style={styles.bellBtn}
                testID="dashboard-bell"
              >
                <Ionicons name="notifications" size={20} color="#fff" />
                {notifUnread > 0 && (
                  <View style={styles.bellBadge}>
                    <Text style={styles.bellBadgeText}>
                      {notifUnread > 9 ? '9+' : notifUnread}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
          {!isWebDesktop && (
          <RNAnimated.View
            style={{
              height: userCardHeight,
              opacity: userCardOpacity,
              marginTop: userCardMargin,
              overflow: 'hidden',
            }}
            pointerEvents="box-none"
          >
            <View
              onLayout={(e) => {
                const h = Math.ceil(e.nativeEvent.layout.height);
                if (h > 0 && Math.abs(h - userCardMeasured) > 2) setUserCardMeasured(h);
              }}
            >
              {/* User card — avatar + name/email/role on the LEFT, 2×2
                  widgets packed into the empty space on the RIGHT. This
                  saves vertical hero real-estate and lets the tab bar
                  pull up significantly. */}
              <View style={[styles.userCard, { alignItems: 'flex-start' }]}>
                <Image source={{ uri: user.picture || DOCTOR_PHOTO_URL }} style={styles.heroPhoto} />
                <View style={{ flex: 1.2, marginLeft: 12, minWidth: 0 }}>
                  <Text style={styles.heroName} numberOfLines={1}>
                    {user.name.split(' ')[0] ? `Hello, Dr. ${user.name.split(' ').slice(-1)[0]}` : 'Hello'}
                  </Text>
                  <Text style={styles.heroEmail} numberOfLines={1}>{user.email}</Text>
                  <View style={styles.heroBadgeRow}>
                    <View style={[styles.heroRole, { borderColor: roleAccent + '88' }]}>
                      <Ionicons name="ribbon" size={8} color={roleAccent} />
                      <Text
                        style={[styles.heroRoleText, { color: roleAccent }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {roleDisplayLabel(user.role)}
                      </Text>
                    </View>
                    {!isOwner && isFullAccess && (
                      <View style={styles.fullAccessBadge}>
                        <Ionicons name="shield-checkmark" size={8} color="#fff" />
                        <Text style={styles.fullAccessText} numberOfLines={1}>FULL ACCESS</Text>
                      </View>
                    )}
                  </View>
                  {/* Tenant switcher only renders if the user is a member of
                      >1 clinic OR is the platform super_owner. */}
                  <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                    <TenantSwitcher
                      variant="compact"
                      primaryColor="#FFFFFF"
                      textColor="#FFFFFF"
                      bgColor="rgba(255,255,255,0.16)"
                      borderColor="rgba(255,255,255,0.32)"
                    />
                  </View>
                </View>
                {/* 2×2 widget grid in the previously empty right-side of
                    the user card. Flex:1 so it always fills whatever's
                    left over after the avatar + text block. */}
                <View style={{ flex: 1, marginLeft: 10, minWidth: 140 }}>
                  <TodayGlance
                    layout="grid2x2"
                    onTapBookings={() => setTab('bookings')}
                    onTapPending={() => setTab('bookings')}
                  />
                </View>
              </View>
            </View>
          </RNAnimated.View>
          )}

          {/* Desktop — same concept: user card left, 2×2 widgets tucked
              into the empty hero space on the right. No more vertical
              rail below the card. */}
          {isWebDesktop && (
            <View style={[styles.userCard, { alignItems: 'flex-start', marginTop: 6 }]}>
              <Image source={{ uri: user.picture || DOCTOR_PHOTO_URL }} style={styles.heroPhoto} />
              <View style={{ flex: 1.2, marginLeft: 12, minWidth: 0 }}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {user.name.split(' ')[0] ? `Hello, Dr. ${user.name.split(' ').slice(-1)[0]}` : 'Hello'}
                </Text>
                <Text style={styles.heroEmail} numberOfLines={1}>{user.email}</Text>
                <View style={styles.heroBadgeRow}>
                  <View style={[styles.heroRole, { borderColor: roleAccent + '88' }]}>
                    <Ionicons name="ribbon" size={8} color={roleAccent} />
                    <Text
                      style={[styles.heroRoleText, { color: roleAccent }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {roleDisplayLabel(user.role)}
                    </Text>
                  </View>
                  {!isOwner && isFullAccess && (
                    <View style={styles.fullAccessBadge}>
                      <Ionicons name="shield-checkmark" size={8} color="#fff" />
                      <Text style={styles.fullAccessText} numberOfLines={1}>FULL ACCESS</Text>
                    </View>
                  )}
                </View>
                <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                  <TenantSwitcher
                    variant="compact"
                    primaryColor="#FFFFFF"
                    textColor="#FFFFFF"
                    bgColor="rgba(255,255,255,0.16)"
                    borderColor="rgba(255,255,255,0.32)"
                  />
                </View>
              </View>
              <View style={{ flex: 1, marginLeft: 16, minWidth: 200, maxWidth: 320 }}>
                <TodayGlance
                  layout="grid2x2"
                  onTapBookings={() => setTab('bookings')}
                  onTapPending={() => setTab('bookings')}
                />
              </View>
            </View>
          )}
        </SafeAreaView>
      </LinearGradient>

      {/* Owner-curated announcements (staff dashboard) */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <AnnouncementsBanner audience="staff" placement="dashboard" />
      </View>

      {/* Wave 6 (BB) — Offline Rx queue banner. */}
      <OfflineRxBanner />

      <View style={[styles.tabBarContainer, isWebDesktop && styles.tabBarContainerDesktop]} onLayout={(e) => { tabBarWidthRef.current = e.nativeEvent.layout.width; }}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.tabBarScroll, isWebDesktop && { paddingHorizontal: 24, gap: 6 }]}
          style={styles.tabBarWrap}
        >
          {tabs.map((tb, idx) => (
            <TouchableOpacity
              key={tb.id}
              onPress={() => {
                if (tb.id === 'blog') {
                  router.push('/admin/blog' as any);
                } else {
                  setTab(tb.id as any);
                }
                centerActiveTab(tb.id);
              }}
              onLayout={(e) => {
                tabPositions.current[tb.id] = e.nativeEvent.layout.x;
              }}
              style={[styles.tabBtn, isWebDesktop && styles.tabBtnDesktop, tab === tb.id && styles.tabBtnActive]}
              testID={`dashboard-tab-${tb.id}`}
            >
              <View>
                <Ionicons name={tb.icon} size={isWebDesktop ? 14 : 16} color={tab === tb.id ? '#fff' : COLORS.primary} />
                {!!tb.badge && tb.badge > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{tb.badge > 9 ? '9+' : tb.badge}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabText, isWebDesktop && { fontSize: 12 }, tab === tb.id && { color: '#fff' }]}>{tb.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ContentPager
        // Re-mount the entire panel set when the user switches clinics.
        // This forces every child panel (BookingsPanel, PrescriptionsPanel,
        // …) to refetch from the API with the new X-Clinic-Id header
        // injected. Cheaper to bust + re-render than to wire clinic
        // state into each individual panel's loader.
        key={`tenant-${currentClinicIdForPanels}`}
        tabs={tabs.filter((x) => x.id !== 'blog')}
        activeId={tab}
        onChange={(id) => setTab(id as any)}
        onVerticalScroll={onContentScroll}
        renderPanel={(id) => {
          // Wrap every panel in its own local boundary so a render
          // error in ONE widget shows a small inline retry card
          // instead of bubbling to the top-level boundary (which
          // would unmount the whole dashboard and dump the user
          // back at the Home tab).
          const wrap = (label: string, node: React.ReactNode) => (
            <AppErrorBoundary panelMode label={label}>
              {node as any}
            </AppErrorBoundary>
          );
          if (id === 'today') return wrap('Today', (
            <AdminOverviewPanel
              onJumpTab={(x) => setTab(x as any)}
              onNewSurgery={() => { setTab('surgeries'); setSxAutoOpen((n) => n + 1); }}
              onNewBroadcast={() => { setTab('broadcasts'); setBcAutoOpen((n) => n + 1); }}
              onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }}
            />
          ));
          if (id === 'consultations') return wrap('Consultations', <ConsultationsPanel onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }} />);
          if (id === 'bookings') return wrap('Bookings', <BookingsPanel onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }} />);
          if (id === 'analytics') return wrap('Analytics', <AnalyticsPanel />);
          if (id === 'prescriptions') return wrap('Prescriptions', <PrescriptionsPanel />);
          if (id === 'surgeries') return wrap('Surgeries', <SurgeriesPanel autoOpen={sxAutoOpen} />);
          if (id === 'ipd') return wrap('IPD', <IPDPanel />);
          if (id === 'referrers') return wrap('Referrers', <ReferrersPanel />);
          if (id === 'patient_referrals') return wrap('Patient Invites', <PatientReferralsPanel />);
          if (id === 'availability') return wrap('Availability', <AvailabilityPanel />);
          if (id === 'broadcasts') return wrap('Broadcasts', <BroadcastsPanel autoOpen={bcAutoOpen} />);
          if (id === 'homepage') return wrap('Homepage Settings', <BrandingSettingsPanel />);
          if (id === 'team') return wrap('Team', <TeamPanelV2 />);
          if (id === 'push') return wrap('Push Health', <NotificationsHealthPanel />);
          if (id === 'backups') return wrap('Backups', <BackupHealthPanel />);
          return null;
        }}
      />

      {/* Quick-action FAB — visible to prescribers (Rx / Sx / Broadcast)
          and to anyone permitted to send personal messages. The set of
          actions opened depends on the user's permissions. */}
      {(() => {
        const canSendMsg = !!(user && ((user as any).can_send_personal_messages || user.role === 'owner'));
        const showFab = canPrescribe || canSendMsg;
        if (!showFab) return null;
        // Build action list dynamically so we can stack them with the
        // correct vertical offset regardless of role.
        const actions: { key: string; icon: any; label: string; onPress: () => void; testID: string }[] = [];
        if (canPrescribe) {
          actions.push({
            key: 'rx',
            icon: 'document-text',
            label: 'New Rx',
            testID: 'fab-new-rx',
            onPress: () => { setFabOpen(false); router.push('/prescriptions/new' as any); },
          });
          actions.push({
            key: 'sx',
            icon: 'medkit',
            label: 'New Surgery',
            testID: 'fab-new-sx',
            onPress: () => { setFabOpen(false); setTab('surgeries'); setSxAutoOpen((n) => n + 1); },
          });
          actions.push({
            key: 'bc',
            icon: 'megaphone',
            label: 'Broadcast',
            testID: 'fab-new-bc',
            onPress: () => { setFabOpen(false); setTab('broadcasts'); setBcAutoOpen((n) => n + 1); },
          });
        }
        if (canSendMsg) {
          actions.push({
            key: 'msg',
            icon: 'paper-plane',
            label: 'New Message',
            testID: 'fab-new-msg',
            onPress: () => { setFabOpen(false); setMsgRecipient(null); setMsgOpen(true); },
          });
        }
        return (
          <>
            {fabOpen && actions.map((a, idx) => (
              <TouchableOpacity
                key={a.key}
                style={[styles.fabAction, { bottom: fabBottomBase + 60 + idx * 56 }]}
                onPress={a.onPress}
                testID={a.testID}
              >
                <Ionicons name={a.icon} size={20} color="#fff" />
                <Text style={styles.fabActionText}>{a.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.fabMain, { bottom: fabBottomBase }]} onPress={() => setFabOpen(!fabOpen)} testID="dashboard-fab">
              <Ionicons name={fabOpen ? 'close' : 'add'} size={28} color="#fff" />
            </TouchableOpacity>
          </>
        );
      })()}

      {/* Personal-message composer — shared across the dashboard so
          patient-row icons and team rows can both open it. */}
      <MessageComposer
        visible={msgOpen}
        onClose={() => setMsgOpen(false)}
        initialRecipient={msgRecipient}
      />
      {/* Floating AI assistant bubble for owner / staff — mirrors the
          patient-side bubble so the doctor can always reach the AI
          (history search, IPSS interpret, WA templates) from any
          dashboard tab without going back to the home screen.
          Positioned ABOVE the dashboard FAB (which lives at bottom-
          right) so the two don't overlap. */}
      <AssistantBubble bottom={Platform.OS === 'web' ? 96 : 100 + fabInsets.bottom} />
    </View>
  );
}


