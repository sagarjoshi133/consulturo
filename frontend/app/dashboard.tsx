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
import { SurgeriesPanel } from '../src/surgery-panel';
import { AvailabilityPanel } from '../src/availability-panel';
import { BroadcastsPanel } from '../src/broadcasts-panel';
import BrandingSettingsPanel from '../src/branding-settings-panel';
import { TeamPanelV2 } from '../src/team-panel';
import { AnalyticsPanel } from '../src/analytics-panel';
import { ReferrersPanel } from '../src/referrers-panel';
import { AdminOverviewPanel } from '../src/admin-overview-panel';
import MessageComposer from '../src/message-composer';
import { resolvePatientRecipient } from '../src/message-recipient';
import { ConsultationsPanel } from '../src/consultations-panel';
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
} from '../src/rx-pdf';
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

// ---------------------------------------------------------------
// CSV export helper (owner-only on backend). On web, triggers an
// actual file download (Blob + <a download>). On native, uses Share.
// ---------------------------------------------------------------
async function downloadCsv(kind: 'bookings' | 'prescriptions' | 'referrers') {
  try {
    const backend = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
    const url = `${backend}/api/export/${kind}.csv`;
    const token = await AsyncStorage.getItem('session_token');
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      const msg = resp.status === 403 ? 'Owner access required' : `Export failed (${resp.status})`;
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Export failed', msg);
      return;
    }
    const blob = await resp.blob();
    const filename = `consulturo-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try { document.body.removeChild(a); } catch {}
        try { URL.revokeObjectURL(blobUrl); } catch {}
      }, 2000);
    } else {
      // Native fallback: alert the user; full native save would need
      // expo-file-system + expo-sharing.
      Alert.alert('CSV ready', `Downloaded ${filename} (open via a file sharing flow on mobile).`);
    }
  } catch (e: any) {
    const msg = e?.message || 'Could not export CSV';
    if (Platform.OS === 'web') window.alert(msg);
    else Alert.alert('Export failed', msg);
  }
}

import { Animated as RNAnimated } from 'react-native';

type TabItem = { id: string; label: string; icon: any; badge?: number };

// Context so each panel can register a pull-to-refresh handler
// against its own tab id. (Moved to src/panel-refresh.tsx to avoid
// circular imports with surgery-panel.tsx.)
import { PanelRefreshContext, usePanelRefresh } from '../src/panel-refresh';

function ContentPager({
  tabs,
  activeId,
  onChange,
  renderPanel,
  onVerticalScroll,
}: {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  renderPanel: (id: string) => React.ReactNode;
  onVerticalScroll?: (e: any) => void;
}) {
  const pagerRef = React.useRef<ScrollView | null>(null);
  const [width, setWidth] = React.useState(Dimensions.get('window').width);
  const activeIndex = Math.max(0, tabs.findIndex((x) => x.id === activeId));
  // Lazy panel mounting — keeps initial dashboard mount cheap by only
  // rendering the panel for the active tab + its immediate neighbours
  // (so the swipe gesture still feels native). Once a tab has been
  // visited the panel STAYS mounted so its in-tab state, scroll
  // position and any cached data are preserved across swipes.
  //
  // Without this, all 13 dashboard panels mounted on the very first
  // render — each one fired its own /api/* request and ran its own
  // useFocusEffect, which on Android APK starved the JS thread and
  // could trigger a silent native crash back to the home tab.
  const [mountedIds, setMountedIds] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    if (tabs[activeIndex]?.id) s.add(tabs[activeIndex].id);
    if (tabs[activeIndex + 1]?.id) s.add(tabs[activeIndex + 1].id);
    if (activeIndex > 0 && tabs[activeIndex - 1]?.id) s.add(tabs[activeIndex - 1].id);
    return s;
  });
  React.useEffect(() => {
    setMountedIds((prev) => {
      const next = new Set(prev);
      if (tabs[activeIndex]?.id) next.add(tabs[activeIndex].id);
      if (tabs[activeIndex + 1]?.id) next.add(tabs[activeIndex + 1].id);
      if (activeIndex > 0 && tabs[activeIndex - 1]?.id) next.add(tabs[activeIndex - 1].id);
      // Identity stability — only update when something new was added.
      return next.size === prev.size ? prev : next;
    });
  }, [activeIndex, tabs]);
  // Desktop-aware inner padding & max-width so dashboard panels feel
  // compact + centered on wide web viewports. Mobile keeps the
  // existing tight 20px padding which is best for thumb use.
  const { isWebDesktop } = useResponsive();
  const panelPad = React.useMemo(
    () => (isWebDesktop
      ? { paddingHorizontal: 28, paddingTop: 16, paddingBottom: 48 }
      : { padding: 20, paddingBottom: 110 }),
    [isWebDesktop],
  );
  const panelMax = isWebDesktop ? 1120 : undefined;
  // Debounce swipe-driven tab updates so we only fire once per settle.
  const settleTimer = React.useRef<any>(null);

  // --- Refresh context plumbing ---
  const refreshMap = React.useRef<Record<string, () => Promise<void> | void>>({});
  const [refreshingTab, setRefreshingTab] = React.useState<string>('');

  const register = React.useCallback((tabId: string, fn: () => Promise<void> | void) => {
    refreshMap.current[tabId] = fn;
  }, []);
  const unregister = React.useCallback((tabId: string) => {
    delete refreshMap.current[tabId];
  }, []);
  const trigger = React.useCallback(async (tabId: string) => {
    const fn = refreshMap.current[tabId];
    if (!fn) return;
    setRefreshingTab(tabId);
    try {
      await Promise.resolve(fn());
    } finally {
      setRefreshingTab('');
    }
  }, []);

  React.useEffect(() => {
    if (width > 0 && pagerRef.current) {
      pagerRef.current.scrollTo({ x: activeIndex * width, animated: true });
    }
  }, [activeIndex, width]);

  const settleToPage = React.useCallback(
    (x: number) => {
      if (width <= 0) return;
      const idx = Math.round(x / width);
      if (tabs[idx] && tabs[idx].id !== activeId) {
        onChange(tabs[idx].id);
      }
    },
    [width, tabs, activeId, onChange]
  );

  return (
    <PanelRefreshContext.Provider value={{ register, unregister }}>
      <View
        style={{ flex: 1, backgroundColor: COLORS.bg }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Native fires momentum/endDrag reliably so we can throttle
          // onScroll heavily; web doesn't, so we keep 16 ms there.
          scrollEventThrottle={Platform.OS === 'web' ? 16 : 64}
          onScroll={Platform.OS === 'web' ? (e) => {
            // Web fallback — momentum/endDrag don't always fire so we
            // settle off the raw scroll position with a small debounce.
            const x = e.nativeEvent.contentOffset.x;
            if (settleTimer.current) clearTimeout(settleTimer.current);
            settleTimer.current = setTimeout(() => settleToPage(x), 140);
          } : undefined}
          onMomentumScrollEnd={(e) => settleToPage(e.nativeEvent.contentOffset.x)}
          onScrollEndDrag={(e) => settleToPage(e.nativeEvent.contentOffset.x)}
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 0 }}
        >
          {tabs.map((tb) => {
            const shouldMount = mountedIds.has(tb.id);
            return (
            <RNAnimated.ScrollView
              key={tb.id}
              style={{ width }}
              contentContainerStyle={panelPad}
              showsVerticalScrollIndicator={false}
              // 32ms (≈30 fps) is plenty for a slow header collapse
              // and keeps the JS thread free for everything else.
              scrollEventThrottle={32}
              onScroll={onVerticalScroll}
              // On Android, slightly slower deceleration keeps the
              // collapse animation feeling smooth at the end of a fling.
              decelerationRate={Platform.OS === 'ios' ? 'normal' : 0.985}
              refreshControl={
                <RefreshControl
                  refreshing={refreshingTab === tb.id}
                  onRefresh={() => trigger(tb.id)}
                  tintColor={COLORS.primary}
                  colors={[COLORS.primary]}
                />
              }
            >
              {shouldMount ? (
                panelMax ? (
                  <View style={{ width: '100%', maxWidth: panelMax, alignSelf: 'center' }}>
                    {renderPanel(tb.id)}
                  </View>
                ) : (
                  renderPanel(tb.id)
                )
              ) : (
                // Cheap placeholder for not-yet-visited tabs. Keeps the
                // pager geometry intact (so swipe-to-page still works
                // and the active index calc stays correct) without
                // mounting heavy panel components or firing their
                // initial data fetches.
                <View style={{ flex: 1, minHeight: 200 }} />
              )}
            </RNAnimated.ScrollView>
          );
          })}
        </ScrollView>
      </View>
    </PanelRefreshContext.Provider>
  );
}
import { displayDate, displayDateLong, display12h, parseUIDate, UI_DATE_PLACEHOLDER, parseBackendDate, formatISTDate } from '../src/date';

const STAFF = ['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'];
const ROLES = [
  { id: 'doctor', label: 'Doctor' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'reception', label: 'Reception' },
  { id: 'nursing', label: 'Nursing Staff' },
];

// Short, single-line-friendly labels for the role chip in the user
// card. The raw role keys (primary_owner, super_owner) wrap to two
// lines and overflow into the right-side widgets on narrow phones —
// so we render a friendlier label here while keeping the underlying
// `user.role` value unchanged for permission checks.
function roleDisplayLabel(role?: string | null): string {
  if (!role) return '';
  const map: Record<string, string> = {
    super_owner: 'SUPER OWNER',
    primary_owner: 'OWNER',
    owner: 'OWNER',
    partner: 'PARTNER',
    doctor: 'DOCTOR',
    assistant: 'ASSISTANT',
    reception: 'RECEPTION',
    nursing: 'NURSING',
    patient: 'PATIENT',
  };
  return map[role] || role.toUpperCase().replace(/_/g, ' ');
}

export default function Dashboard() {
  // Wraps the (massive) DashboardImpl component below in a local error
  // boundary. When a widget / panel (branding, broadcasts, team, etc.)
  // throws at render time the user sees a clean "Try again / Back to
  // Home" card INSTEAD of the entire nav Stack being unmounted — which
  // on Android manifests as "the app falls back to the Home tab".
  // 2026-05-01 — added after Dr. Joshi reported recurring dashboard
  // crashes that silently dropped him to the (tabs)/index Home.
  const router = useRouter();
  return (
    <AppErrorBoundary onEscape={() => { try { router.replace('/' as any); } catch {} }}>
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
  type TabStateType = 'today' | 'consultations' | 'bookings' | 'analytics' | 'prescriptions' | 'surgeries' | 'referrers' | 'availability' | 'team' | 'blog' | 'broadcasts' | 'homepage' | 'branding';
  const TAB_VALUES: TabStateType[] = ['today', 'consultations', 'bookings', 'analytics', 'prescriptions', 'surgeries', 'referrers', 'availability', 'team', 'blog', 'broadcasts', 'homepage', 'branding'];
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
        const { data } = await api.get('/bookings/all');
        if (!cancelled) setPendingCount(data.filter((b: any) => b.status === 'requested').length);
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
        { id: 'analytics', label: 'Analytics', icon: 'analytics', canSee: canPrescribe },
        { id: 'surgeries', label: 'Surgeries', icon: 'medkit', canSee: canPrescribe },
        { id: 'referrers', label: 'Referrers', icon: 'people-circle', canSee: true },
        { id: 'broadcasts', label: 'Broadcast', icon: 'megaphone', canSee: true },
        { id: 'blog', label: 'Blog', icon: 'newspaper', canSee: tier.canCreateBlog },
        { id: 'team', label: 'Team', icon: 'people', canSee: allowTab('team') },
        { id: 'push', label: 'Notifs', icon: 'notifications', canSee: allowTab('push') },
        { id: 'branding', label: 'Branding', icon: 'color-palette', canSee: isOwner },
        { id: 'backups', label: 'Backups', icon: 'cloud-upload', canSee: allowTab('backups') },
      ];
      return all.filter((t) => t.canSee).map(({ canSee, ...rest }) => rest);
    },
    [canPrescribe, isOwner, allowTab, pendingCount, tier.canCreateBlog]
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
          if (id === 'today') return (
            <AdminOverviewPanel
              onJumpTab={(x) => setTab(x as any)}
              onNewSurgery={() => { setTab('surgeries'); setSxAutoOpen((n) => n + 1); }}
              onNewBroadcast={() => { setTab('broadcasts'); setBcAutoOpen((n) => n + 1); }}
              onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }}
            />
          );
          if (id === 'consultations') return <ConsultationsPanel onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }} />;
          if (id === 'bookings') return <BookingsPanel onMessagePatient={(r) => { setMsgRecipient(r); setMsgOpen(true); }} />;
          if (id === 'analytics') return <AnalyticsPanel />;
          if (id === 'prescriptions') return <PrescriptionsPanel />;
          if (id === 'surgeries') return <SurgeriesPanel autoOpen={sxAutoOpen} />;
          if (id === 'referrers') return <ReferrersPanel />;
          if (id === 'availability') return <AvailabilityPanel />;
          if (id === 'broadcasts') return <BroadcastsPanel autoOpen={bcAutoOpen} />;
          if (id === 'homepage') return <BrandingSettingsPanel />;
          if (id === 'branding') return <BrandingSettingsPanel />;
          if (id === 'team') return <TeamPanelV2 />;
          if (id === 'push') return <NotificationsHealthPanel />;
          if (id === 'backups') return <BackupHealthPanel />;
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
    </View>
  );
}

function BookingsPanel({ onMessagePatient }: { onMessagePatient?: (r: { user_id: string; name?: string; phone?: string; email?: string; role?: string }) => void } = {}) {
  const { isWebDesktop } = useResponsive();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'requested' | 'all' | 'confirmed' | 'rescheduled' | 'completed' | 'cancelled' | 'missed' | 'rejected'>('requested');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [ed, setEd] = useState<{ date: string; time: string; note: string }>({ date: '', time: '', note: '' });
  const [viewMode, setViewMode] = useState<'list' | 'day' | 'week' | 'month'>('list');
  const [cursor, setCursor] = useState<Date>(new Date());
  // P1: smart filters
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [onlyRescheduled, setOnlyRescheduled] = useState(false);
  // P1: bulk selection mode
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // P2: icon-popup toolbar — filter & sort menus are shown on demand instead
  // of consuming permanent vertical space.
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [sortBy, setSortBy] = useState<'date_asc' | 'date_desc' | 'name' | 'created_desc'>('date_asc');
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const toast = useToast();
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/bookings/all');
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Register pull-to-refresh for this tab
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const manualRefresh = useCallback(async () => {
    setManualRefreshing(true);
    try { await load(); } finally { setManualRefreshing(false); }
  }, [load]);
  usePanelRefresh('bookings', manualRefresh);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const patch = async (id: string, body: any) => {
    try {
      await api.patch(`/bookings/${id}`, body);
      load();
      setEditing(null);
      const label =
        body.status === 'confirmed' ? 'Booking confirmed' :
        body.status === 'completed' ? 'Marked as done' :
        body.status === 'cancelled' ? 'Booking cancelled' :
        body.status === 'rejected' ? 'Booking rejected' :
        'Booking updated';
      toast.success(label);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not update';
      toast.error(msg);
    }
  };

  // --- P1: Bulk operations ---
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const exitBulkMode = () => {
    setBulkMode(false);
    clearSelection();
  };

  const bulkPatch = async (status: 'confirmed' | 'cancelled' | 'rejected') => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const doRun = async () => {
      setBulkBusy(true);
      let ok = 0;
      let fail = 0;
      // Sequential to avoid race on slot conflicts
      for (const id of ids) {
        try {
          await api.patch(`/bookings/${id}`, { status });
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      setBulkBusy(false);
      await load();
      exitBulkMode();
      if (fail === 0) {
        toast.success(`${ok} booking${ok === 1 ? '' : 's'} ${status === 'confirmed' ? 'confirmed' : status === 'cancelled' ? 'cancelled' : 'rejected'}`);
      } else if (ok === 0) {
        toast.error('None could be updated');
      } else {
        toast.info(`${ok} updated, ${fail} failed`);
      }
    };
    const label = status === 'confirmed' ? `Confirm ${ids.length} booking${ids.length === 1 ? '' : 's'}?` :
                  status === 'cancelled' ? `Cancel ${ids.length} booking${ids.length === 1 ? '' : 's'}?` :
                  `Reject ${ids.length} booking${ids.length === 1 ? '' : 's'}?`;
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (typeof window !== 'undefined' && window.confirm(label)) doRun();
    } else {
      Alert.alert('Bulk action', label, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', onPress: doRun, style: status === 'confirmed' ? 'default' : 'destructive' },
      ]);
    }
  };

  // --- P1: Copy patient info ---
  const copyPatientInfo = async (b: any) => {
    const lines = [
      b.patient_name,
      b.patient_phone,
      b.registration_no ? `Reg ${b.registration_no}` : '',
      `${displayDate(b.booking_date)} ${display12h(b.booking_time)} (${b.mode || 'in-person'})`,
      b.reason,
    ].filter(Boolean).join('\n');
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(lines);
      } else {
        const Clipboard = require('expo-clipboard');
        await Clipboard.setStringAsync(lines);
      }
      toast.success('Patient info copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  // --- P1: Reject with reason (cross-platform prompt) ---
  const promptRejectReason = async (booking_id: string) => {
    const ask = (): Promise<string | null> => new Promise((resolve) => {
      if (Platform.OS === 'web') {
        const r = typeof window !== 'undefined' ? window.prompt('Why are you rejecting this booking? (shown to patient)') : null;
        resolve(r == null ? null : r.trim());
      } else {
        // @ts-ignore — Alert.prompt only exists on iOS, fall back to accept-any on Android
        if (typeof Alert.prompt === 'function') {
          // @ts-ignore
          Alert.prompt(
            'Reject appointment',
            'Provide a reason — patient will be notified.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Reject', style: 'destructive', onPress: (v?: string) => resolve((v || '').trim() || null) },
            ],
            'plain-text'
          );
        } else {
          Alert.alert('Reject appointment', 'On Android, please open the booking detail to add a rejection reason.', [
            { text: 'OK', onPress: () => resolve(null) },
          ]);
        }
      }
    });
    const reason = await ask();
    if (!reason) { toast.info('Rejection cancelled — reason required'); return; }
    await patch(booking_id, { status: 'rejected', reason });
  };

  // ── Primary-owner delete ─────────────────────────────────────────
  // Hard-delete a booking with NO patient notification. Used to remove
  // test / duplicate / accidental entries. Gated to primary_owner /
  // owner / super_owner on both frontend (shown conditionally) and
  // backend (DELETE /api/bookings/{id} enforces the role).
  const canDelete = user?.role === 'super_owner' || user?.role === 'primary_owner' || user?.role === 'owner';
  const onDelete = async (booking_id: string, patient_name: string) => {
    const msg = `Permanently delete this booking for ${patient_name}? The patient will NOT be notified.`;
    const go = await new Promise<boolean>((resolve) => {
      if (Platform.OS === 'web') {
        resolve(typeof window !== 'undefined' && window.confirm(msg));
      } else {
        Alert.alert('Delete booking', msg, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ]);
      }
    });
    if (!go) return;
    try {
      await api.delete(`/bookings/${booking_id}`);
      setItems((prev) => prev.filter((b) => b.booking_id !== booking_id));
      toast.success('Booking deleted');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not delete booking');
    }
  };

  const isRescheduled = (b: any) =>
    (b.original_date && b.original_date !== b.booking_date) ||
    (b.original_time && b.original_time !== b.booking_time);
  const statusFiltered =
    filter === 'all'
      ? items
      : filter === 'rescheduled'
        ? items.filter((b) => isRescheduled(b) && b.status !== 'cancelled' && b.status !== 'rejected')
        : items.filter((b) => b.status === filter);

  // Smart filters removed — all status categories now live in the top
  // status pill row.
  const smartFiltered = statusFiltered;

  // Full-text search across name/phone/reason/reg
  const searchFiltered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return smartFiltered;
    return smartFiltered.filter((b) => {
      return (
        (b.patient_name || '').toLowerCase().includes(q) ||
        (b.patient_phone || '').includes(q) ||
        (b.reason || '').toLowerCase().includes(q) ||
        (b.registration_no || '').toLowerCase().includes(q)
      );
    });
  }, [smartFiltered, search]);

  // Apply view-mode date filter on top of status + search filters
  const viewFiltered = (() => {
    if (viewMode === 'list') return searchFiltered;
    if (viewMode === 'day') {
      const iso = format(cursor, 'yyyy-MM-dd');
      return searchFiltered.filter((b) => b.booking_date === iso);
    }
    if (viewMode === 'week') {
      const start = startOfWeek(cursor, { weekStartsOn: 1 });
      const end = endOfWeek(cursor, { weekStartsOn: 1 });
      return searchFiltered.filter((b) => {
        try {
          const d = parseISO(b.booking_date);
          return d >= start && d <= end;
        } catch {
          return false;
        }
      });
    }
    // month
    return searchFiltered.filter((b) => {
      try {
        return isSameMonth(parseISO(b.booking_date), cursor);
      } catch {
        return false;
      }
    });
  })();
  const sortedFiltered = React.useMemo(() => {
    const arr = [...viewFiltered];
    switch (sortBy) {
      case 'date_asc':
        arr.sort((a, b) => (a.booking_date || '').localeCompare(b.booking_date || '') || (a.booking_time || '').localeCompare(b.booking_time || ''));
        break;
      case 'date_desc':
        arr.sort((a, b) => (b.booking_date || '').localeCompare(a.booking_date || '') || (b.booking_time || '').localeCompare(a.booking_time || ''));
        break;
      case 'name':
        arr.sort((a, b) => (a.patient_name || '').localeCompare(b.patient_name || ''));
        break;
      case 'created_desc':
        arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        break;
    }
    return arr;
  }, [viewFiltered, sortBy]);
  const filtered = sortedFiltered;
  const stats = {
    pending: items.filter((b) => b.status === 'requested').length,
    upcoming: items.filter((b) => b.status === 'confirmed').length,
    completed: items.filter((b) => b.status === 'completed').length,
    cancelled: items.filter((b) => b.status === 'cancelled' || b.status === 'rejected').length,
  };

  if (loading) {
    // Skeletons mimic the layout: 4 stat tiles, view-mode toggle, then 3 booking cards
    return (
      <View style={{ paddingTop: 8 }} testID="dashboard-bookings-skel">
        <View style={styles.statsRow}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              <Skeleton w={36} h={28} br={8} />
              <Skeleton w={56} h={12} />
            </View>
          ))}
        </View>
        <View style={[styles.viewToggle, { gap: 8 }]}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} w={70} h={32} br={16} />
          ))}
        </View>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ marginTop: 12, padding: 14, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, gap: 10 }}>
            <Skeleton w="60%" h={16} />
            <Skeleton w="40%" h={12} />
            <Skeleton w="80%" h={12} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <>
      <SmartAlerts />

      {/* ── Status filter — compact dropdown button (mobile-friendly).
           Replaces the previous 6-chip row. Shows the currently-active
           status + count; tap opens a full-width popover listing every
           status including Missed + Rejected with per-status counts. ── */}
      {(() => {
        const FILTERS = [
          { key: 'requested',   label: 'Pending',      color: '#F59E0B' },
          { key: 'confirmed',   label: 'Confirmed',    color: '#10B981' },
          { key: 'rescheduled', label: 'Rescheduled',  color: '#3B82F6' },
          { key: 'completed',   label: 'Completed',    color: '#0E7C8B' },
          { key: 'missed',      label: 'Missed',       color: '#C0392B' },
          { key: 'cancelled',   label: 'Cancelled',    color: '#EF4444' },
          { key: 'rejected',    label: 'Rejected',     color: '#7F1D1D' },
          { key: 'all',         label: 'All',          color: COLORS.primary },
        ] as const;
        const countFor = (key: string) =>
          key === 'all' ? items.length :
          key === 'rescheduled' ? items.filter(isRescheduled).length :
          items.filter((b) => b.status === key).length;
        const active = FILTERS.find((f) => f.key === filter) || FILTERS[FILTERS.length - 1];
        return (
          <>
            <TouchableOpacity
              onPress={() => setShowFilterMenu(true)}
              activeOpacity={0.85}
              style={[styles.filterDropdown, { borderColor: active.color + '88', backgroundColor: active.color + '10' }]}
              testID="bk-filter-dropdown"
            >
              <View style={[styles.filterDot, { backgroundColor: active.color }]} />
              <Text style={[styles.filterDropdownLabel, { color: active.color }]} numberOfLines={1}>
                {active.label}
              </Text>
              <View style={[styles.statusPillCount, { backgroundColor: active.color + '26' }]}>
                <Text style={[styles.statusPillCountText, { color: active.color }]}>
                  {countFor(active.key)}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={active.color} />
            </TouchableOpacity>

            {showFilterMenu && (
              <Modal transparent animationType="fade" onRequestClose={() => setShowFilterMenu(false)}>
                <Pressable style={styles.filterBackdrop} onPress={() => setShowFilterMenu(false)}>
                  <Pressable style={styles.filterSheet} onPress={(e) => e.stopPropagation()}>
                    <Text style={styles.filterSheetTitle}>Filter by status</Text>
                    {FILTERS.map((f) => {
                      const isActive = f.key === filter;
                      const count = countFor(f.key);
                      return (
                        <TouchableOpacity
                          key={f.key}
                          onPress={() => { setFilter(f.key as any); setShowFilterMenu(false); }}
                          style={[
                            styles.filterRow,
                            isActive && { backgroundColor: f.color + '14' },
                          ]}
                          testID={`bk-filter-${f.key}`}
                        >
                          <View style={[styles.filterDot, { backgroundColor: f.color }]} />
                          <Text style={[styles.filterRowLabel, { color: f.color, fontFamily: isActive ? 'Manrope_700Bold' : 'Manrope_600SemiBold' }]}>
                            {f.label}
                          </Text>
                          <View style={[styles.statusPillCount, { backgroundColor: f.color + '22' }]}>
                            <Text style={[styles.statusPillCountText, { color: f.color }]}>{count}</Text>
                          </View>
                          {isActive && (
                            <Ionicons name="checkmark" size={18} color={f.color} style={{ marginLeft: 6 }} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </Pressable>
                </Pressable>
              </Modal>
            )}
          </>
        );
      })()}

      {/* ── Toolbar — single row: search + view + sort + refresh ─────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 10, height: 38 }}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search…"
            placeholderTextColor={COLORS.textDisabled}
            style={{ flex: 1, marginLeft: 6, ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, outlineWidth: 0 as any }}
            testID="bk-search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} testID="bk-search-clear">
              <Ionicons name="close-circle" size={16} color={COLORS.textDisabled} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => { setShowViewMenu((v) => !v); setShowSortMenu(false); }}
          style={[styles.iconSquareBtn, viewMode !== 'list' && { backgroundColor: COLORS.primary + '18', borderColor: COLORS.primary }]}
          testID="bk-view-toggle"
        >
          <Ionicons
            name={viewMode === 'list' ? 'list' : viewMode === 'day' ? 'today' : viewMode === 'week' ? 'calendar' : 'calendar-outline'}
            size={16}
            color={COLORS.primary}
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setShowSortMenu((v) => !v); setShowViewMenu(false); }}
          style={styles.iconSquareBtn}
          testID="bk-sort-toggle"
        >
          <Ionicons name="swap-vertical" size={16} color={COLORS.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={manualRefresh}
          disabled={manualRefreshing}
          style={styles.iconSquareBtn}
          activeOpacity={0.75}
          testID="bk-refresh"
        >
          {manualRefreshing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={16} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── View popup ─────────────────────────────────────────────────── */}
      {showViewMenu && (
        <View style={styles.popupPanel} testID="bk-view-menu">
          <Text style={styles.popupTitle}>View as</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {(['list', 'day', 'week', 'month'] as const).map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => { setViewMode(v); setShowViewMenu(false); }}
                style={[styles.smartChip, viewMode === v && styles.smartChipActive]}
                testID={`bk-view-${v}`}
              >
                <Ionicons
                  name={v === 'list' ? 'list' : v === 'day' ? 'today' : v === 'week' ? 'calendar' : 'calendar-outline'}
                  size={13}
                  color={viewMode === v ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.smartChipText, viewMode === v && { color: '#fff' }]}>
                  {v === 'list' ? 'List' : v.charAt(0).toUpperCase() + v.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Sort popup ─────────────────────────────────────────────────── */}
      {showSortMenu && (
        <View style={styles.popupPanel} testID="bk-sort-menu">
          <Text style={styles.popupTitle}>Sort by</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { key: 'date_asc', label: 'Date · earliest', icon: 'arrow-up' as const },
              { key: 'date_desc', label: 'Date · latest', icon: 'arrow-down' as const },
              { key: 'name', label: 'Patient name', icon: 'text' as const },
              { key: 'created_desc', label: 'Newest first', icon: 'time' as const },
            ].map((s) => (
              <TouchableOpacity
                key={s.key}
                onPress={() => { setSortBy(s.key as any); setShowSortMenu(false); }}
                style={[styles.smartChip, sortBy === s.key && styles.smartChipActive]}
                testID={`bk-sort-${s.key}`}
              >
                <Ionicons name={s.icon} size={13} color={sortBy === s.key ? '#fff' : COLORS.primary} />
                <Text style={[styles.smartChipText, sortBy === s.key && { color: '#fff' }]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Bulk bar — visible whenever bulk mode is on. Long-press a card
          to enter bulk mode; "Select all" lets you tick every booking in
          the current filtered view in one tap. Compact icon-style actions
          to avoid horizontal overlap on narrow screens. ─────────────── */}
      {bulkMode && (() => {
        const allSelected = filtered.length > 0 && filtered.every((b: any) => selectedIds.has(b.booking_id));
        return (
          <View style={styles.bulkBar}>
            <TouchableOpacity
              onPress={() => {
                if (allSelected) setSelectedIds(new Set());
                else setSelectedIds(new Set(filtered.map((b: any) => b.booking_id)));
              }}
              style={styles.bulkSelectAllBtn}
              testID="bk-bulk-select-all"
            >
              <Ionicons
                name={allSelected ? 'checkbox' : 'square-outline'}
                size={16}
                color={COLORS.primary}
              />
              <Text style={styles.bulkSelectAllText} numberOfLines={1}>
                {selectedIds.size > 0 ? `${selectedIds.size}` : 'All'}
              </Text>
            </TouchableOpacity>

            <View style={{ flex: 1 }} />

            {selectedIds.size > 0 && (
              <>
                <TouchableOpacity
                  onPress={() => bulkPatch('confirmed')}
                  disabled={bulkBusy}
                  style={[styles.bulkIconBtn, { backgroundColor: COLORS.success }]}
                  testID="bk-bulk-confirm"
                >
                  {bulkBusy ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => bulkPatch('cancelled')}
                  disabled={bulkBusy}
                  style={[styles.bulkIconBtn, { backgroundColor: COLORS.accent }]}
                  testID="bk-bulk-cancel"
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              onPress={() => { setBulkMode(false); clearSelection(); }}
              style={[styles.bulkIconBtn, { backgroundColor: COLORS.textSecondary }]}
              testID="bk-bulk-exit"
            >
              <Ionicons name="exit-outline" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* Date navigator (for Day / Week / Month) */}
      {viewMode !== 'list' && (
        <View style={styles.dateNav}>
          <TouchableOpacity
            onPress={() => setCursor(viewMode === 'day' ? addDays(cursor, -1) : viewMode === 'week' ? addWeeks(cursor, -1) : addMonths(cursor, -1))}
            style={styles.navArrow}
            testID="bk-nav-prev"
          >
            <Ionicons name="chevron-back" size={18} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.dateNavText}>
            {viewMode === 'day'
              ? format(cursor, 'EEE, dd-MM-yyyy')
              : viewMode === 'week'
              ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), 'dd MMM')} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), 'dd MMM yyyy')}`
              : format(cursor, 'MMMM yyyy')}
          </Text>
          <TouchableOpacity onPress={() => setCursor(new Date())} style={styles.todayBtn} testID="bk-nav-today">
            <Text style={styles.todayText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCursor(viewMode === 'day' ? addDays(cursor, 1) : viewMode === 'week' ? addWeeks(cursor, 1) : addMonths(cursor, 1))}
            style={styles.navArrow}
            testID="bk-nav-next"
          >
            <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Week strip */}
      {viewMode === 'week' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const day = addDays(startOfWeek(cursor, { weekStartsOn: 1 }), i);
            const iso = format(day, 'yyyy-MM-dd');
            const count = statusFiltered.filter((b) => b.booking_date === iso).length;
            const isToday = isSameDay(day, new Date());
            return (
              <TouchableOpacity
                key={iso}
                onPress={() => {
                  setCursor(day);
                  setViewMode('day');
                }}
                style={[styles.weekDay, isToday && { borderColor: COLORS.primary, borderWidth: 2 }]}
              >
                <Text style={styles.weekDow}>{format(day, 'EEE')}</Text>
                <Text style={styles.weekDate}>{format(day, 'dd')}</Text>
                {count > 0 && (
                  <View style={styles.weekDot}>
                    <Text style={styles.weekDotText}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Month grid */}
      {viewMode === 'month' && (
        <MonthGrid
          cursor={cursor}
          items={statusFiltered}
          onPickDay={(d) => {
            setCursor(d);
            setViewMode('day');
          }}
        />
      )}

      {/* Bulk action bar — appears on the LEFT of any selected card row */}

      {filtered.length === 0 && (
        <EmptyState
          icon={search ? 'search' : 'calendar-outline'}
          title={search ? 'No matching bookings' : items.length === 0 ? 'No bookings yet' : 'Nothing in this view'}
          subtitle={
            search
              ? 'Try a different name, phone or keyword.'
              : items.length === 0
              ? 'Your upcoming bookings will appear here. Share your booking link with patients.'
              : 'Change filters or switch to the List view to see all bookings.'
          }
          ctaLabel={!search && items.length === 0 ? 'View public booking page' : undefined}
          onCta={!search && items.length === 0 ? () => Linking.openURL('/book' as any) : undefined}
          testID="bk-empty"
        />
      )}

      {/* Desktop web — booking cards flex into a 2-up grid. Each row
          has identical-height columns and the existing per-card
          interactions (open / select / edit / actions) work
          unchanged. Mobile keeps the single-column stack which is
          best for thumb scrolling. */}
      <View style={isWebDesktop ? styles.bkGrid : undefined}>
      {filtered.map((b) => {
        const statusColor =
          b.status === 'requested' ? COLORS.warning :
          b.status === 'confirmed' ? COLORS.success :
          b.status === 'completed' ? COLORS.primaryDark :
          COLORS.accent;
        const isEditing = editing === b.booking_id;
        const wasRescheduled =
          (b.original_date && b.original_date !== b.booking_date) ||
          (b.original_time && b.original_time !== b.booking_time);
        const selected = selectedIds.has(b.booking_id);
        return (
          <View key={b.booking_id} style={[styles.bkCard, selected && styles.bkCardSelected, isWebDesktop && styles.bkCardDesktop]} testID={`bk-card-${b.booking_id}`}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={() => {
                if (bulkMode) {
                  toggleSelect(b.booking_id);
                } else {
                  router.push({ pathname: '/bookings/[id]', params: { id: b.booking_id } } as any);
                }
              }}
              onLongPress={() => {
                // Long-press enters bulk mode and selects this card —
                // standard mobile pattern; replaces the dedicated
                // "Bulk select" button which the user found redundant.
                if (!bulkMode) setBulkMode(true);
                toggleSelect(b.booking_id);
              }}
              testID={`bk-open-${b.booking_id}`}
            >
              <View style={styles.bkHead}>
                {bulkMode && (
                  <View style={styles.bulkCheckbox} testID={`bk-select-${b.booking_id}`}>
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={selected ? COLORS.primary : COLORS.textDisabled}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.bkName}>
                    {b.patient_name}
                    {b.patient_age ? ` · ${b.patient_age}y` : ''}
                    {b.patient_gender ? ` · ${b.patient_gender}` : ''}
                  </Text>
                  <Text style={styles.bkMeta}>
                    {displayDateLong(b.booking_date)} · {display12h(b.booking_time)}
                  </Text>
                  {wasRescheduled && b.status !== 'requested' && (
                    <Text style={[styles.bkMeta, { color: COLORS.accent }]}>
                      (Rescheduled from {displayDate(b.original_date)} {display12h(b.original_time)})
                    </Text>
                  )}
                </View>
                <View style={[styles.statusPill, { backgroundColor: statusColor + '22' }]}>
                  <Text style={[styles.statusText, { color: statusColor }]}>{b.status}</Text>
                </View>
              </View>
              {b.status === 'confirmed' && (b.confirmed_by_name || b.confirmed_by) && (
                <View style={styles.approverBadge}>
                  <Ionicons name="checkmark-circle" size={12} color={COLORS.success} />
                  <Text style={styles.approverBadgeText} numberOfLines={1}>
                    Confirmed by {b.confirmed_by_name || 'staff'}
                    {b.approver_note ? ' · note attached' : ''}
                  </Text>
                </View>
              )}
              {b.reason ? <Text style={styles.bkReason}>{b.reason}</Text> : null}
            </TouchableOpacity>
            {!bulkMode && (
              <View style={styles.bkFoot}>
                <TouchableOpacity onPress={() => Linking.openURL(telLink((b as any).country_code, b.patient_phone))} style={styles.bkAction}>
                  <Ionicons name="call" size={14} color={COLORS.primary} />
                  <Text style={styles.bkActionText} numberOfLines={1}>{b.patient_phone}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const msg = b.status === 'confirmed'
                      ? `Dear ${b.patient_name}, your appointment on ${displayDate(b.booking_date)} at ${display12h(b.booking_time)} is CONFIRMED with Dr. Sagar Joshi. — ConsultUro`
                      : `Hello ${b.patient_name}, regarding your appointment request on ${displayDate(b.booking_date)}…`;
                    Linking.openURL(whatsappLink((b as any).country_code, b.patient_phone, msg));
                  }}
                  style={styles.bkAction}
                >
                  <Ionicons name="logo-whatsapp" size={14} color={COLORS.whatsapp} />
                  <Text style={[styles.bkActionText, { color: COLORS.whatsapp }]} numberOfLines={1}>WhatsApp</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => copyPatientInfo(b)}
                  style={styles.bkAction}
                  testID={`bk-copy-${b.booking_id}`}
                >
                  <Ionicons name="copy-outline" size={14} color={COLORS.textSecondary} />
                  <Text style={[styles.bkActionText, { color: COLORS.textSecondary }]} numberOfLines={1}>Copy</Text>
                </TouchableOpacity>
                {!!b.patient_phone && onMessagePatient && (
                  <TouchableOpacity
                    onPress={async () => {
                      const r = await resolvePatientRecipient({
                        patient_user_id: b.patient_user_id,
                        patient_name: b.patient_name,
                        patient_phone: b.patient_phone,
                        country_code: (b as any).country_code,
                        patient_email: b.patient_email,
                      });
                      if (r.ok) {
                        onMessagePatient(r.recipient);
                      } else if (r.reason === 'not_registered') {
                        toast.error(`${b.patient_name || 'Patient'} hasn't installed the app yet — try WhatsApp.`);
                      } else if (r.reason === 'no_phone') {
                        toast.error('No phone on file for this patient');
                      } else {
                        toast.error('Could not look up patient');
                      }
                    }}
                    style={styles.bkAction}
                    testID={`bk-msg-${b.booking_id}`}
                  >
                    <Ionicons name="paper-plane" size={14} color={COLORS.primary} />
                    <Text style={[styles.bkActionText, { color: COLORS.primary }]} numberOfLines={1}>Message</Text>
                  </TouchableOpacity>
                )}
                {canDelete && (
                  <TouchableOpacity
                    onPress={() => onDelete(b.booking_id, b.patient_name || 'this patient')}
                    style={[styles.bkAction, { borderColor: '#EF4444' + '55' }]}
                    testID={`bk-delete-${b.booking_id}`}
                  >
                    <Ionicons name="trash" size={14} color="#EF4444" />
                    <Text style={[styles.bkActionText, { color: '#EF4444' }]} numberOfLines={1}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {!bulkMode && isEditing ? (
              <View style={styles.editBox}>
                <DateField
                  label="New date"
                  value={ed.date}
                  onChange={(v) => setEd((s) => ({ ...s, date: v }))}
                />
                <TimeField
                  label="New time"
                  value={ed.time}
                  onChange={(v) => setEd((s) => ({ ...s, time: v }))}
                  style={{ marginTop: 10 }}
                />
                <Text style={styles.smallLabel}>Reason for reschedule (shown to patient) *</Text>
                <TextInput
                  value={ed.note}
                  onChangeText={(v) => setEd((s) => ({ ...s, note: v }))}
                  placeholder="e.g. Doctor unavailable; moving to next available slot."
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, { minHeight: 54, textAlignVertical: 'top' }]}
                  multiline
                  testID={`bk-note-${b.booking_id}`}
                />
                <View style={styles.bkButtons}>
                  <TouchableOpacity
                    style={[styles.bkSmallBtn, { borderColor: COLORS.success }]}
                    onPress={() => {
                      const iso = parseUIDate(ed.date) || b.booking_date;
                      const time24 = ed.time ? (() => { try { const { to24h } = require('../src/date'); return to24h(ed.time); } catch { return ed.time; } })() : b.booking_time;
                      const changed = iso !== b.booking_date || time24 !== b.booking_time;
                      const reason = (ed.note || '').trim();
                      if (changed && !reason) {
                        toast.error('Please enter a reason for rescheduling');
                        return;
                      }
                      const body: any = { booking_date: iso, booking_time: time24 };
                      // Only transition to confirmed if currently requested
                      if (b.status === 'requested') body.status = 'confirmed';
                      if (reason) { body.note = reason; body.reason = reason; }
                      patch(b.booking_id, body);
                    }}
                    testID={`dash-save-${b.booking_id}`}
                  >
                    <Ionicons name="checkmark" size={14} color={COLORS.success} />
                    <Text style={[styles.bkSmallText, { color: COLORS.success }]}>
                      {b.status === 'confirmed' ? 'Reschedule' : 'Reschedule & Confirm'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.bkSmallBtn, { borderColor: COLORS.textDisabled }]} onPress={() => setEditing(null)}>
                    <Text style={[styles.bkSmallText, { color: COLORS.textSecondary }]}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : b.status === 'requested' ? (
              <View style={styles.bkButtons}>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.success }]}
                  onPress={() => patch(b.booking_id, { status: 'confirmed' })}
                  testID={`dash-confirm-${b.booking_id}`}
                >
                  <Ionicons name="checkmark" size={14} color={COLORS.success} />
                  <Text style={[styles.bkSmallText, { color: COLORS.success }]}>Confirm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.primary }]}
                  onPress={() => {
                    setEditing(b.booking_id);
                    // date: UI format (DD-MM-YYYY), time: 24h (HH:mm) for the new picker.
                    setEd({ date: displayDate(b.booking_date), time: (b.booking_time || '').slice(0, 5), note: b.approver_note || '' });
                  }}
                  testID={`dash-reschedule-${b.booking_id}`}
                >
                  <Ionicons name="create" size={14} color={COLORS.primary} />
                  <Text style={[styles.bkSmallText, { color: COLORS.primary }]}>Reschedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.accent }]}
                  onPress={() => promptRejectReason(b.booking_id)}
                  testID={`dash-reject-${b.booking_id}`}
                >
                  <Ionicons name="close" size={14} color={COLORS.accent} />
                  <Text style={[styles.bkSmallText, { color: COLORS.accent }]}>Reject</Text>
                </TouchableOpacity>
              </View>
            ) : b.status === 'confirmed' ? (
              <View style={styles.bkButtons}>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.primary }]}
                  onPress={() => {
                    setEditing(b.booking_id);
                    setEd({ date: displayDate(b.booking_date), time: (b.booking_time || '').slice(0, 5), note: '' });
                  }}
                  testID={`dash-reschedule-${b.booking_id}`}
                >
                  <Ionicons name="create" size={14} color={COLORS.primary} />
                  <Text style={[styles.bkSmallText, { color: COLORS.primary }]}>Reschedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.bkSmallBtn, { borderColor: COLORS.accent }]}
                  onPress={() => patch(b.booking_id, { status: 'cancelled' })}
                  testID={`dash-cancel-${b.booking_id}`}
                >
                  <Ionicons name="close" size={14} color={COLORS.accent} />
                  <Text style={[styles.bkSmallText, { color: COLORS.accent }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        );
      })}
      </View>
    </>
  );
}

function PrescriptionsPanel() {
  const { isWebDesktop } = useResponsive();
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<ClinicSettings>({});
  const [busyId, setBusyId] = useState<string>(''); // `${id}:print` | `${id}:pdf` | `${id}:delete`

  const load = useCallback(async () => {
    try {
      const [{ data }, s] = await Promise.all([
        api.get('/prescriptions'),
        loadClinicSettings(),
      ]);
      setItems(data);
      setSettings(s);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull-to-refresh
  const [rxRefreshing, setRxRefreshing] = useState(false);
  const manualRxRefresh = useCallback(async () => {
    setRxRefreshing(true);
    try { await load(); } finally { setRxRefreshing(false); }
  }, [load]);
  usePanelRefresh('prescriptions', manualRxRefresh);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const runPrint = async (id: string) => {
    setBusyId(`${id}:print`);
    await fetchRxAndRun(id, (rx) => printPrescription(rx, settings));
    setBusyId('');
  };

  const runDownload = async (id: string) => {
    setBusyId(`${id}:pdf`);
    await fetchRxAndRun(id, (rx) => downloadPrescriptionPdf(rx, settings));
    setBusyId('');
  };

  const runShare = async (id: string) => {
    setBusyId(`${id}:share`);
    await fetchRxAndRun(id, (rx) => sharePrescriptionPdf(rx, settings));
    setBusyId('');
  };

  const deleteRx = (id: string) => {
    const doDelete = async () => {
      setBusyId(`${id}:delete`);
      try {
        await api.delete(`/prescriptions/${id}`);
        load();
        toast.success('Prescription deleted');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        toast.error(msg);
      } finally {
        setBusyId('');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this prescription permanently?')) doDelete();
    } else {
      Alert.alert('Delete prescription?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const filtered = React.useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (rx) =>
        (rx.patient_name || '').toLowerCase().includes(q) ||
        (rx.patient_phone || '').includes(q) ||
        (rx.registration_no || '').includes(q) ||
        (rx.diagnosis || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <>
      {items.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, height: 40 }}>
            <Ionicons name="search" size={16} color={COLORS.textSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, phone, reg, diagnosis…"
              placeholderTextColor={COLORS.textDisabled}
              style={{ flex: 1, marginLeft: 8, ...FONTS.body, color: COLORS.textPrimary }}
              testID="rx-search"
            />
          </View>
          {/* Compact + button — replaces the full-width "New Prescription"
              CTA to save vertical space. Same action, smaller footprint. */}
          <TouchableOpacity
            onPress={() => router.push('/prescriptions/new')}
            style={[styles.refreshBtn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
            activeOpacity={0.75}
            testID="dashboard-new-rx"
            accessibilityLabel="New prescription"
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={manualRxRefresh}
            disabled={rxRefreshing}
            style={styles.refreshBtn}
            activeOpacity={0.75}
            testID="rx-refresh"
          >
            {rxRefreshing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="refresh" size={18} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        </View>
      )}
      {loading ? (
        <View style={{ marginTop: 16, gap: 12 }} testID="dashboard-rx-skel">
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ padding: 14, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, gap: 10 }}>
              <Skeleton w="55%" h={16} />
              <Skeleton w="35%" h={12} />
              <Skeleton w="80%" h={12} />
            </View>
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={{ ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' }}>
            {items.length === 0 ? 'No prescriptions yet' : 'No matches.'}
          </Text>
          {items.length === 0 && (
            <TouchableOpacity
              onPress={() => router.push('/prescriptions/new')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: COLORS.primary,
                paddingVertical: 10, paddingHorizontal: 18,
                borderRadius: 22, marginTop: 12,
              }}
              testID="dashboard-new-rx-empty"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={{ ...FONTS.bodyMedium, color: '#fff' }}>New Prescription</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        // Desktop: same card layout, but flex into a 2-up grid
        // wrapper. Mobile keeps the single-column stack.
        <View style={isWebDesktop ? styles.bkGrid : undefined}>
        {filtered.map((rx) => (
          <View key={rx.prescription_id} style={[styles.rxCard, isWebDesktop && styles.bkCardDesktop]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
              testID={`rx-open-${rx.prescription_id}`}
            >
              <View style={styles.bkHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bkName}>{rx.patient_name}</Text>
                  {rx.registration_no ? (
                    <Text style={{ ...FONTS.body, color: COLORS.primary, fontSize: 11, marginTop: 2 }}>
                      Reg. {rx.registration_no}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.bkMeta}>{formatISTDate(parseBackendDate(rx.created_at))}</Text>
              </View>
              {rx.chief_complaints ? (
                <Text style={styles.bkReason} numberOfLines={2}>{rx.chief_complaints}</Text>
              ) : null}
              <Text style={[styles.bkActionText, { marginTop: 6 }]}>{(rx.medicines || []).length} medicine(s)</Text>
            </TouchableOpacity>

            <View style={styles.rxActionRow}>
              <RxRowAction
                icon="eye-outline"
                label="Open"
                onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
                testID={`rx-view-${rx.prescription_id}`}
              />
              <RxRowAction
                icon="create-outline"
                label="Edit"
                onPress={() => router.push({ pathname: '/prescriptions/new', params: { rxId: rx.prescription_id } } as any)}
                testID={`rx-edit-${rx.prescription_id}`}
              />
              <RxRowAction
                icon="print-outline"
                label="Print"
                loading={busyId === `${rx.prescription_id}:print`}
                onPress={() => runPrint(rx.prescription_id)}
                testID={`rx-print-${rx.prescription_id}`}
              />
              <RxRowAction
                icon="download-outline"
                label="PDF"
                loading={busyId === `${rx.prescription_id}:pdf`}
                onPress={() => runDownload(rx.prescription_id)}
                testID={`rx-pdf-${rx.prescription_id}`}
              />
              <RxRowAction
                icon="share-social-outline"
                label="Share"
                loading={busyId === `${rx.prescription_id}:share`}
                onPress={() => runShare(rx.prescription_id)}
                testID={`rx-share-${rx.prescription_id}`}
              />
              {isOwner && (
                <RxRowAction
                  icon="trash-outline"
                  label="Delete"
                  color={COLORS.accent}
                  loading={busyId === `${rx.prescription_id}:delete`}
                  onPress={() => deleteRx(rx.prescription_id)}
                  testID={`rx-del-${rx.prescription_id}`}
                />
              )}
            </View>
          </View>
        ))}
        </View>
      )}
    </>
  );
}

function RxRowAction({
  icon,
  label,
  onPress,
  loading,
  color,
  testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  loading?: boolean;
  color?: string;
  testID?: string;
}) {
  const c = color || COLORS.primary;
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={styles.rxRowAction} testID={testID}>
      {loading ? <ActivityIndicator size="small" color={c} /> : <Ionicons name={icon} size={16} color={c} />}
      <Text style={[styles.rxRowActionText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function TeamPanel() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('assistant');
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/team');
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const invite = async () => {
    setErr('');
    if (!email.includes('@')) {
      setErr('Valid email required');
      return;
    }
    setBusy(true);
    try {
      await api.post('/team/invites', {
        email: email.toLowerCase(),
        name: name || undefined,
        role,
        can_approve_bookings: role === 'doctor' ? true : canApprove,
      });
      setEmail('');
      setName('');
      setCanApprove(false);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not invite');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (em: string) => {
    try {
      await api.delete(`/team/${em}`);
      load();
    } catch {}
  };

  // Toggle `can_send_personal_messages` for a specific team member.
  // Only the owner can call this (the backend enforces it via
  // require_owner on PATCH /api/team/{email}).
  const toggleSendMsgPerm = async (em: string, current: boolean) => {
    try {
      await api.patch(`/team/${em}`, { can_send_personal_messages: !current });
      load();
    } catch {}
  };

  const autoApprove = role === 'owner' || role === 'doctor';

  return (
    <>
      <Text style={styles.sectionTitle}>Invite Team Member</Text>
      <View style={styles.formCard}>
        <TextInput value={email} onChangeText={setEmail} placeholder="team@example.com" placeholderTextColor={COLORS.textDisabled} autoCapitalize="none" keyboardType="email-address" style={styles.input} testID="team-invite-email" />
        <TextInput value={name} onChangeText={setName} placeholder="Name (optional)" placeholderTextColor={COLORS.textDisabled} style={[styles.input, { marginTop: 8 }]} testID="team-invite-name" />
        <Text style={styles.smallLabel}>Role</Text>
        <View style={styles.roleRow}>
          {ROLES.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => setRole(r.id)} style={[styles.roleChip, role === r.id && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} testID={`team-role-${r.id}`}>
              <Text style={[styles.roleText, role === r.id && { color: '#fff' }]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.approveRow, autoApprove && { opacity: 0.5 }]}
          onPress={() => !autoApprove && setCanApprove(!canApprove)}
          disabled={autoApprove}
          testID="team-approver-toggle"
        >
          <Ionicons name={autoApprove || canApprove ? 'checkbox' : 'square-outline'} size={22} color={autoApprove || canApprove ? COLORS.primary : COLORS.textDisabled} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.approveLbl}>Can approve / reschedule appointments</Text>
            <Text style={styles.approveSub}>
              {autoApprove
                ? `Automatic for ${role === 'owner' ? 'Owner' : 'Doctor'}`
                : 'Enable to let this staff member confirm booking requests and send patient notifications.'}
            </Text>
          </View>
        </TouchableOpacity>
        {err ? <Text style={{ color: COLORS.accent, ...FONTS.body, marginTop: 6 }}>{err}</Text> : null}
        <PrimaryButton title={busy ? 'Inviting…' : 'Send Invite'} onPress={invite} disabled={busy} style={{ marginTop: 12 }} icon={<Ionicons name="person-add" size={18} color="#fff" />} testID="team-invite-submit" />
        <Text style={styles.note}>Once invited, the person signs in with Google using the same email — they're automatically given the selected role.</Text>
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Current Team</Text>
      {loading ? (
        <View style={{ gap: 10 }} testID="dashboard-team-skel">
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border }}>
              <Skeleton w={36} h={36} br={18} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton w="55%" h={14} />
                <Skeleton w="75%" h={11} />
              </View>
            </View>
          ))}
        </View>
      ) : list.length === 0 ? (
        <Text style={{ ...FONTS.body, color: COLORS.textSecondary }}>No team members yet</Text>
      ) : (
        list.map((m) => (
          <View key={m.email} style={styles.tmCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {m.picture ? (
                <Image source={{ uri: m.picture }} style={styles.tmAvatar} />
              ) : (
                <View style={[styles.tmAvatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="person" size={18} color={COLORS.primary} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.tmName}>{m.name || m.email}</Text>
                <Text style={styles.tmEmail}>{m.email}</Text>
                <View style={styles.tmTagRow}>
                  <View style={[styles.tmRole, m.role === 'owner' && { backgroundColor: COLORS.accent + '22' }]}>
                    <Text
                      style={[styles.tmRoleText, m.role === 'owner' && { color: COLORS.accent }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {roleDisplayLabel(m.role)}
                    </Text>
                  </View>
                  <View style={[styles.tmStatus, m.status === 'active' ? { backgroundColor: COLORS.success + '22' } : { backgroundColor: COLORS.warning + '22' }]}>
                    <Text style={[styles.tmStatusText, { color: m.status === 'active' ? COLORS.success : COLORS.warning }]}>
                      {m.status === 'active' ? 'Active' : 'Invited'}
                    </Text>
                  </View>
                  {m.can_approve_bookings && (
                    <View style={styles.tmStatus}>
                      <Text style={[styles.tmStatusText, { color: COLORS.primary }]}>Approver</Text>
                    </View>
                  )}
                  {m.can_send_personal_messages && m.role !== 'owner' && (
                    <View style={styles.tmStatus}>
                      <Text style={[styles.tmStatusText, { color: '#10B981' }]}>Messenger</Text>
                    </View>
                  )}
                </View>
              </View>
              {m.role !== 'owner' && (
                <TouchableOpacity onPress={() => remove(m.email)} style={{ padding: 8 }} testID={`team-remove-${m.email}`}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
                </TouchableOpacity>
              )}
            </View>

            {/* Owner-only permission toggles for non-owner members. */}
            {m.role !== 'owner' && (
              <TouchableOpacity
                onPress={() => toggleSendMsgPerm(m.email, !!m.can_send_personal_messages)}
                style={[styles.permToggle, m.can_send_personal_messages && styles.permToggleOn]}
                activeOpacity={0.78}
                testID={`team-toggle-msg-${m.email}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.permLabel}>Send personal messages</Text>
                  <Text style={styles.permSub}>
                    Compose &amp; deliver in-app messages to teammates and patients
                  </Text>
                </View>
                <View style={[styles.permSwitch, m.can_send_personal_messages && styles.permSwitchOn]}>
                  <View style={[styles.permKnob, m.can_send_personal_messages && styles.permKnobOn]} />
                </View>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.statBox, { borderLeftColor: color }]}>
      <Text style={[styles.statVal, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.statLbl} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
    </View>
  );
}

function EmptyStateLocal({ icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <Ionicons name={icon} size={54} color={COLORS.textDisabled} />
      <Text style={{ ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 }}>{title}</Text>
      <Text style={{ ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 6 }}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 4, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  heroDesktop: { paddingHorizontal: 24, paddingBottom: 4, paddingTop: 6, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h4, color: '#fff', fontSize: 16 },
  headerDate: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 1 },
  bellBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  bellBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  bellBadgeText: { color: '#fff', ...FONTS.label, fontSize: 10 },
  tabBadge: { position: 'absolute', top: -6, right: -10, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { color: '#fff', ...FONTS.label, fontSize: 9 },
  fabMain: { position: 'absolute', right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 10 },
  fabAction: { position: 'absolute', right: 20, bottom: 84, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 24, backgroundColor: COLORS.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  fabActionText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
  userCard: { flexDirection: 'row', alignItems: 'center', marginTop: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 10 },
  heroPhoto: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff' },
  heroName: { ...FONTS.h4, color: '#fff', fontSize: 16 },
  heroEmail: { ...FONTS.body, color: '#E0F7FA', fontSize: 12 },
  // Role badge shrunk to ~2/3 of previous size per design feedback —
  // padding, gap, radius and font size all scaled down proportionally.
  heroRole: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', backgroundColor: '#fff', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, maxWidth: '100%' },
  heroRoleText: { ...FONTS.label, color: COLORS.primary, fontSize: 8, letterSpacing: 0.3, flexShrink: 1 },
  // Wraps the primary role badge + the optional Full Access pill so they
  // sit side-by-side rather than stacked. Wraps to a new line gracefully
  // on extra-narrow phones / long role names.
  heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 4, maxWidth: '100%' },
  // Distinct gold-tinted treatment for "Full Access" so it pops next to
  // the role chip without competing visually with the primary CTA.
  // Scaled proportionally to the shrunken heroRole badge.
  fullAccessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#F5C26B',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 1,
  },
  fullAccessText: { ...FONTS.label, color: '#5C3D00', fontSize: 7, letterSpacing: 0.3 },
  tabBarContainer: { backgroundColor: COLORS.bg, paddingTop: 4, paddingBottom: 2 },
  tabBarContainerDesktop: { paddingTop: 4, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabBarWrap: { maxHeight: 48 },
  tabBarScroll: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  tabBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2, minWidth: 90 },
  tabBtnDesktop: { paddingVertical: 7, paddingHorizontal: 12, minWidth: 0, gap: 5 },
  tabBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, shadowOpacity: 0.22, shadowRadius: 6 },
  tabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 14 },
  statsRow: { flexDirection: 'row', gap: 6 },
  // Compact colored pill row — replaces stat boxes + status filter chips.
  // Wraps to 2 lines on narrow phones; each pill shows label + count.
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  statusPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  statusPillLabel: { ...FONTS.bodyMedium, fontSize: 11 },
  statusPillCount: {
    minWidth: 18,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillCountText: { ...FONTS.bodyMedium, fontSize: 10 },
  // ── Filter dropdown (replaces the 6-chip status row) ────────────
  filterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginTop: 4,
  },
  filterDropdownLabel: { ...FONTS.bodyMedium, fontSize: 14, flex: 1 },
  filterDot: { width: 10, height: 10, borderRadius: 5 },
  filterBackdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    padding: 24,
  },
  filterSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  filterSheetTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginBottom: 10, marginLeft: 4 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    marginBottom: 2,
  },
  filterRowLabel: { flex: 1, fontSize: 14 },
  statBox: { flex: 1, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 6, borderRadius: RADIUS.md, borderLeftWidth: 3, borderWidth: 1, borderColor: COLORS.border, minWidth: 0, alignItems: 'flex-start' },
  statVal: { ...FONTS.h2, fontSize: 18 },
  statLbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  // Quick-jump pills — slimmer than filterChip, sit above viewToggle
  quickJump: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '0F',
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  quickJumpActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  quickJumpText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  smartChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '33',
  },
  smartChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  smartChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  bulkBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary + '0D',
    borderWidth: 1, borderColor: COLORS.primary + '33',
    borderRadius: RADIUS.md,
    paddingVertical: 6, paddingHorizontal: 8,
    marginBottom: 10,
    gap: 6,
  },
  bulkBarText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  bulkSelectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1,
    borderColor: COLORS.primary + '44',
  },
  bulkSelectAllText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12, minWidth: 20 },
  // Compact icon-only action button (32x32) — fits 3 in the right cluster
  // without overlapping on 360px-wide screens.
  bulkIconBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  bulkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill,
  },
  bulkBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },
  bulkCheckbox: { marginRight: 10, marginTop: 2 },
  bkCardSelected: { borderColor: COLORS.primary, borderWidth: 2, backgroundColor: COLORS.primary + '08' },
  // Desktop grid container — wraps booking & Rx cards into a 2-up
  // flex grid on wide screens. Mobile keeps the existing single
  // column stack.
  bkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bkCardDesktop: {
    width: '49.3%',
  },
  filterText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  bkCard: { backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  approverBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: COLORS.success + '1A', borderWidth: 1, borderColor: COLORS.success + '40', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 8 },
  approverBadgeText: { ...FONTS.label, color: COLORS.success, fontSize: 11, flexShrink: 1 },
  bkHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bkName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 16 },
  bkMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
  statusPill: { backgroundColor: COLORS.success + '22', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { ...FONTS.label, color: COLORS.success, fontSize: 11, textTransform: 'uppercase' },
  bkReason: { ...FONTS.body, color: COLORS.textPrimary, marginTop: 6 },
  bkFoot: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 6, marginTop: 10 },
  bkAction: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  bkActionText: { ...FONTS.body, color: COLORS.primary, fontSize: 13 },
  bkButtons: { flexDirection: 'row', gap: 8, marginTop: 10 },
  bkSmallBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.success, backgroundColor: '#fff' },
  bkSmallText: { ...FONTS.bodyMedium, fontSize: 13 },
  rxCard: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginTop: 10, borderWidth: 1, borderColor: COLORS.border },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 40, borderRadius: 24, borderWidth: 1, borderColor: COLORS.primary + '40', backgroundColor: COLORS.primary + '0F' },
  refreshBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.primary + '40',
    backgroundColor: COLORS.primary + '0F',
  },
  iconSquareBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  popupPanel: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  popupTitle: { ...FONTS.label, color: COLORS.primary, fontSize: 10, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  exportText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  rxActionRow: { flexDirection: 'row', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border, justifyContent: 'space-around' },
  rxRowAction: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingVertical: 6, gap: 3 },
  rxRowActionText: { ...FONTS.label, fontSize: 11 },
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginBottom: 10 },
  formCard: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border },
  input: { backgroundColor: COLORS.bg, padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  smallLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12 },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  roleChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  roleText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  note: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, marginTop: 10, lineHeight: 19 },
  tmCard: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  permToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  permToggleOn: {},
  permLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  permSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  permSwitch: {
    width: 38, height: 22, borderRadius: 11,
    backgroundColor: COLORS.border,
    padding: 2,
    justifyContent: 'center',
  },
  permSwitchOn: { backgroundColor: '#10B981' },
  permKnob: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#fff',
  },
  permKnobOn: { transform: [{ translateX: 16 }] },
  tmAvatar: { width: 40, height: 40, borderRadius: 20 },
  tmName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  tmEmail: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  tmTagRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tmRole: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: COLORS.primary + '18' },
  tmRoleText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  tmStatus: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  tmStatusText: { ...FONTS.label, fontSize: 10 },
  editBox: { marginTop: 10, padding: 12, backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  approveRow: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, marginTop: 12, backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  approveLbl: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  approveSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  viewToggle: { flexDirection: 'row', gap: 6, marginTop: 8 },
  viewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  viewBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  viewText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  dateNav: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  navArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  dateNavText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },
  todayBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: COLORS.primary + '18' },
  todayText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  weekDay: { width: 52, paddingVertical: 8, borderRadius: 10, alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, position: 'relative' },
  weekDow: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10 },
  weekDate: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 18, marginTop: 2 },
  weekDot: { position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  weekDotText: { color: '#fff', fontSize: 9, fontFamily: 'DMSans_700Bold' },
  monthGrid: { marginTop: 10, backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 10, borderWidth: 1, borderColor: COLORS.border },
  monthRow: { flexDirection: 'row' },
  monthDow: { flex: 1, ...FONTS.label, color: COLORS.textSecondary, textAlign: 'center', fontSize: 10, paddingVertical: 6 },
  monthCell: { flex: 1, aspectRatio: 1, margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  monthCellOther: { opacity: 0.35 },
  monthCellToday: { backgroundColor: COLORS.primary + '28' },
  monthCellText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },
  monthCellDot: { position: 'absolute', bottom: 4, minWidth: 14, height: 14, borderRadius: 7, paddingHorizontal: 3, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  monthCellDotText: { color: '#fff', fontSize: 8, fontFamily: 'DMSans_700Bold' },
});

/** Compact month calendar for the Dashboard Bookings panel. */
function MonthGrid({
  cursor,
  items,
  onPickDay,
}: {
  cursor: Date;
  items: any[];
  onPickDay: (d: Date) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const cells: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    cells.push(d);
    d = addDays(d, 1);
  }
  const countFor = (day: Date) => {
    const iso = format(day, 'yyyy-MM-dd');
    return items.filter((b) => b.booking_date === iso).length;
  };
  const rows: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View style={styles.monthGrid}>
      <View style={styles.monthRow}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <Text key={d} style={styles.monthDow}>{d}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.monthRow}>
          {row.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const isToday = isSameDay(day, new Date());
            const n = countFor(day);
            return (
              <TouchableOpacity
                key={day.toISOString()}
                onPress={() => onPickDay(day)}
                style={[styles.monthCell, !inMonth && styles.monthCellOther, isToday && styles.monthCellToday]}
                testID={`bk-month-${format(day, 'yyyy-MM-dd')}`}
              >
                <Text style={styles.monthCellText}>{format(day, 'd')}</Text>
                {n > 0 && (
                  <View style={styles.monthCellDot}>
                    <Text style={styles.monthCellDotText}>{n}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}
