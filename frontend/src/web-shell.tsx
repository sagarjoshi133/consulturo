/**
 * WebShell — Desktop-only layout wrapper.
 *
 * On desktop web (≥1024 px) it renders:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  ┌──────┐                                                │
 *   │  │      │   Top bar (search, language, bell, profile)    │
 *   │  │ side │                                                │
 *   │  │ bar  │   Centered content pane (max-width 1100 px)    │
 *   │  │      │                                                │
 *   │  └──────┘                                                │
 *   └──────────────────────────────────────────────────────────┘
 *
 * On mobile (native or web < 768 px) it's a transparent passthrough —
 * children render exactly as today.
 *
 * The shell is mounted ONCE in `_layout.tsx` and wraps every route.
 * Auth screens (login/onboarding) opt-out via the `bare` prop.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { COLORS, FONTS, RADIUS } from './theme';
import { useResponsive, DESKTOP, getForcedView, setForcedView, type ForceView } from './responsive';
import { useAuth } from './auth';
import { useNotifications } from './notifications';
import { useI18n } from './i18n';
import { parseBackendDate, formatISTDate } from './date';
import { useTenant } from './tenant-context';
import * as Clipboard from 'expo-clipboard';

const STAFF_ROLES = new Set(['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing']);

const SIDEBAR_COLLAPSED_KEY = 'web_sidebar_collapsed';

/** Persisted collapsed-state for the desktop sidebar (web only). */
function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (Platform.OS !== 'web') return false;
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    const onChange = () => {
      try {
        setCollapsed(window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
      } catch {}
    };
    window.addEventListener('sidebar-collapse-change', onChange);
    return () => window.removeEventListener('sidebar-collapse-change', onChange);
  }, []);
  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          if (next) window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, '1');
          else window.localStorage?.removeItem(SIDEBAR_COLLAPSED_KEY);
          window.dispatchEvent(new Event('sidebar-collapse-change'));
        }
      } catch {}
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// ── Collapsible per-section state ──────────────────────────────────
// Tracks WHICH section headers are currently collapsed (hiding their
// items). Persisted in localStorage as a JSON string -> string[]. By
// default Account, Dashboard, Practice (and My Health for patients)
// are EXPANDED; every other section starts collapsed per latest spec.
// We seed BOTH English and currently-translated section labels so a
// language switch doesn't accidentally re-expand sections the user
// previously collapsed.
const SECTION_COLLAPSED_KEY = 'consulturo_sidebar_sections_collapsed_v1';
const DEFAULT_COLLAPSED_SECTIONS_BASE = ['Administration', 'Explore', 'App', 'About', 'प्रशासन', 'खोजें', 'ऐप', 'परिचय', 'વ્યવસ્થાપન', 'જુઓ', 'ઍપ', 'વિશે'];
function useCollapsedSections(): [Set<string>, (sec: string) => void] {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      return new Set(DEFAULT_COLLAPSED_SECTIONS_BASE);
    }
    try {
      const raw = window.localStorage?.getItem(SECTION_COLLAPSED_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch {}
    return new Set(DEFAULT_COLLAPSED_SECTIONS_BASE);
  });
  const toggle = React.useCallback((sec: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec); else next.add(sec);
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.localStorage?.setItem(SECTION_COLLAPSED_KEY, JSON.stringify(Array.from(next)));
        }
      } catch {}
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

type NavItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  testID?: string;
  badge?: number;
  staffOnly?: boolean;
  ownerOnly?: boolean;
  /** optional section header rendered BEFORE this item (mirrors More-tab grouping) */
  section?: string;
  /** optional click handler — when provided, replaces router.push */
  onPress?: () => void;
  /** small status pill rendered to the right of the label (e.g. View mode) */
  pill?: string;
};

export function WebShell({ children }: { children: React.ReactNode }) {
  const r = useResponsive();
  const pathname = usePathname();

  // Bare/auth screens — never wrap in shell even on desktop.
  const isAuthScreen =
    pathname === '/login' ||
    pathname === '/onboarding' ||
    pathname.startsWith('/auth-callback');

  // Mobile-first: pass through unchanged.
  if (!r.isWebDesktop || isAuthScreen) {
    return <>{children}</>;
  }

  return <DesktopShell>{children}</DesktopShell>;
}

function DesktopShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { unread, personalUnread, items: notifs, markRead, markAllRead } = useNotifications();
  const { t, lang, setLang } = useI18n();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [collapsedSections, toggleSection] = useCollapsedSections();
  // Notification dropdown popover (desktop). Click bell → toggle.
  // Auto-closes on outside-click via a transparent overlay layer.
  const [bellOpen, setBellOpen] = React.useState(false);

  const isStaff = !!user && STAFF_ROLES.has((user.role as string) || '');
  const isOwner = ['super_owner', 'primary_owner', 'owner', 'partner'].includes((user?.role as string) || '');
  const isSuperOwner = user?.role === 'super_owner';
  const isFullAccess = !!(user as any)?.dashboard_full_access;

  // Sidebar sections mirror the More-tab grouping so desktop + mobile
  // stay cognitively aligned. New layout (per latest spec):
  //   Main → Dashboard → Practice → My Health → Administration → Explore → App → About
  const SEC_MAIN    = t('more.sectionAccount')        || 'Main';
  const SEC_DASH    = t('more.sectionDashboard')      || 'Dashboard';
  const SEC_PRAC    = t('more.sectionPractice')       || 'Practice';
  const SEC_HEALTH  = t('more.sectionMyHealth')       || 'My Health';
  const SEC_ADMIN   = t('more.sectionAdministration') || 'Administration';
  const SEC_EXPLORE = t('more.sectionExplore')        || 'Explore';
  const SEC_APP     = t('more.sectionApp')            || 'App';
  const SEC_ABOUT   = t('more.sectionAbout')          || 'About';

  // View-mode toggle state — cycles Auto / Desktop / Mobile when the
  // sidebar item is tapped (web-only). Mirrors the More-tab toggle so
  // desktop users have an in-place way to preview the alternate layout.
  const [forceMode, setForceMode] = React.useState<ForceView>(() => getForcedView());
  const cycleViewMode = () => {
    const order: ForceView[] = ['auto', 'desktop', 'mobile'];
    const next = order[(order.indexOf(forceMode) + 1) % order.length];
    setForceMode(next);
    setForcedView(next);
    // Force a quick reload so every consumer of useResponsive picks up
    // the new mode without us having to plumb context everywhere.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setTimeout(() => window.location.reload(), 80);
    }
  };

  // ── Clinic Link (public /c/<slug>) helper ─────────────────────────
  // Surfaced as a sidebar shortcut for primary_owner/partner. Tapping
  // copies the URL to clipboard (and also opens it in a new tab on web)
  // so the owner can paste it into WhatsApp / printed material instantly.
  const tenant = useTenant();
  const clinicSlug = tenant?.currentClinic?.slug || '';
  const clinicLink = React.useMemo(() => {
    if (!clinicSlug || clinicSlug === 'all') return '';
    let origin = '';
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      origin = window.location.origin;
    } else {
      origin = (process.env.EXPO_PUBLIC_BACKEND_URL || 'https://urology-pro.emergent.host').replace(/\/$/, '');
    }
    return `${origin}/c/${clinicSlug}`;
  }, [clinicSlug]);
  const copyClinicLink = async () => {
    if (!clinicLink) return;
    try {
      await Clipboard.setStringAsync(clinicLink);
    } catch {}
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // brief, unobtrusive notice and open in new tab
      try { window.open(clinicLink, '_blank'); } catch {}
    }
  };

  // Build sidebar nav items based on role (see new section ordering above).
  const items: NavItem[] = [
    { label: t('tabs.home') || 'Home', icon: 'home', route: '/', section: SEC_MAIN },
    { label: t('tabs.book') || 'Book', icon: 'calendar', route: '/book' },
    {
      label: t('more.inbox') || 'Inbox',
      icon: 'chatbubbles',
      route: '/inbox',
      badge: personalUnread || 0,
    },
    {
      label: t('more.notifications') || 'Notifications',
      icon: 'notifications',
      route: '/notifications',
      badge: unread || 0,
    },
  ];

  // ── DASHBOARD (its own section, just below Main) ───────────────────
  // Super-owner gets a SEPARATE Platform Administration link AND a
  // dedicated Analytics section (per-Primary-Owner usage stats —
  // distinct from clinical analytics so the audit and admin flows
  // are cleanly split). They should NOT see clinical Dashboard tabs.
  if (isSuperOwner) {
    items.push({ label: 'Platform Administration', icon: 'shield-checkmark', route: '/permission-manager', ownerOnly: true, section: SEC_ADMIN });
    items.push({ label: 'Analytics', icon: 'analytics', route: '/admin/primary-owner-analytics', ownerOnly: true });
    items.push({ label: 'Backups', icon: 'cloud-upload', route: '/admin/backups', ownerOnly: true });
  } else if (isStaff) {
    items.push({ label: t('more.doctorDashboard') || 'Dashboard', icon: 'grid', route: '/dashboard', staffOnly: true, section: SEC_DASH });
  }

  // ── PRACTICE (clinical workflow — staff only, never super_owner) ──
  if (isStaff && !isSuperOwner) {
    items.push({ label: t('more.consults') || 'Consults', icon: 'medkit', route: '/dashboard?tab=consultations', staffOnly: true, section: SEC_PRAC });
    items.push({ label: t('more.prescriptions') || 'Prescriptions', icon: 'document-text', route: '/dashboard?tab=prescriptions', staffOnly: true });
    items.push({ label: t('more.surgeries')     || 'Surgeries',     icon: 'medical-outline', route: '/dashboard?tab=surgeries', staffOnly: true });
    items.push({ label: t('more.broadcasts')    || 'Broadcasts',    icon: 'megaphone', route: '/dashboard?tab=broadcasts', staffOnly: true });
    items.push({ label: t('more.notes')         || 'Notes',         icon: 'create',  route: '/notes', staffOnly: true });
    items.push({ label: t('more.reminders')     || 'Reminders',     icon: 'alarm',   route: '/reminders', staffOnly: true });
  } else if (isSuperOwner) {
    // Super-owner: Notes + Reminders surface in the "App" section
    // alongside Inbox so the bell, scratchpad and to-dos all sit
    // together, keeping the sidebar focused on platform admin.
    items.push({ label: t('more.notes')      || 'Notes',     icon: 'create',  route: '/notes', staffOnly: true, section: SEC_APP });
    items.push({ label: t('more.reminders')  || 'Reminders', icon: 'alarm',   route: '/reminders', staffOnly: true });
  } else if (user) {
    // ── MY HEALTH (patient) ─────────────────────────────────────────
    items.push({ label: t('more.myBookings') || 'My Bookings', icon: 'calendar-clear', route: '/my-bookings', section: SEC_HEALTH });
    items.push({ label: t('more.myRecords')  || 'My Records',  icon: 'folder-open',     route: '/my-records' });
    items.push({ label: t('more.notes')      || 'Notes',       icon: 'create',          route: '/notes' });
    items.push({ label: t('more.reminders')  || 'Reminders',   icon: 'alarm',           route: '/reminders' });
  }

  // ── ADMINISTRATION (BELOW Practice per latest spec) ────────────────
  // Super-owner already has these (separate Analytics + Backups under
  // Platform Administration above) — guard against duplicates.
  if (isStaff && (isOwner || isFullAccess) && !isSuperOwner) {
    items.push({ label: t('more.analytics') || 'Analytics', icon: 'analytics', route: '/dashboard?tab=analytics', staffOnly: true, section: SEC_ADMIN });
    items.push({ label: t('more.team')      || 'Team',      icon: 'people',    route: '/dashboard?tab=team',      staffOnly: true });
  }
  if (isOwner && !isSuperOwner) {
    items.push({ label: t('more.branding')    || 'Branding',  icon: 'color-palette', route: '/branding', ownerOnly: true, section: !(isStaff && (isOwner || isFullAccess)) ? SEC_ADMIN : undefined });
    items.push({ label: t('more.permissions') || 'Permissions', icon: 'key', route: '/permission-manager', ownerOnly: true });
    if (clinicLink) {
      items.push({
        label: t('more.clinicLink') || 'Clinic Link',
        icon: 'link',
        route: '#clinic-link',
        onPress: copyClinicLink,
        ownerOnly: true,
        pill: t('more.copy') || 'Copy',
      });
    }
  }
  if ((isOwner || isFullAccess) && !isSuperOwner) {
    items.push({ label: t('more.backups') || 'Backups', icon: 'cloud-upload', route: '/admin/backups', staffOnly: true });
  }

  // ── EXPLORE ────────────────────────────────────────────────────────
  items.push({ label: t('tabs.diseases')  || 'Diseases',          icon: 'medical', route: '/diseases', section: SEC_EXPLORE });
  items.push({ label: t('tabs.tools')     || 'Tools',             icon: 'calculator', route: '/tools' });
  items.push({ label: t('more.education') || 'Patient Education', icon: 'book',       route: '/education' });
  items.push({ label: t('more.blog')      || 'Blog',              icon: 'newspaper',  route: '/blog' });
  items.push({ label: t('more.videos')    || 'Videos',            icon: 'play-circle', route: '/videos' });

  // ── APP — desktop View-mode toggle ─────────────────────────────────
  const modeLabel: Record<ForceView, string> = {
    auto: t('more.viewModeAuto') || 'Auto',
    desktop: t('more.viewModeDesktop') || 'Desktop',
    mobile: t('more.viewModeMobile') || 'Mobile',
  };
  items.push({
    label: t('more.viewMode') || 'View mode',
    icon: 'desktop-outline',
    route: '#view-mode',
    onPress: cycleViewMode,
    pill: modeLabel[forceMode],
    section: SEC_APP,
  });

  // ── ABOUT (last) ───────────────────────────────────────────────────
  // Super-owner shouldn't see "About Doctor" — they're not running a
  // clinic, just the platform. Show only "About App".
  if (!isSuperOwner) {
    items.push({ label: t('more.aboutDoctor') || 'About Doctor', icon: 'person-circle', route: '/about', section: SEC_ABOUT });
  }
  items.push({ label: t('more.aboutApp')    || 'About App',    icon: 'information-circle', route: '/about-app', section: isSuperOwner ? SEC_ABOUT : undefined });

  // Active route detection — match exact OR prefix for nested routes.
  // Special handling for `/dashboard?tab=X` — only highlights the
  // matching tab entry, and silences the bare /dashboard entry when
  // ANY tab query is present (so we don't double-highlight).
  const currentSearch = (typeof window !== 'undefined' && Platform.OS === 'web') ? (window.location.search || '') : '';
  const currentTab = (() => {
    try { return new URLSearchParams(currentSearch).get('tab') || ''; } catch { return ''; }
  })();
  const isActive = (route: string) => {
    if (route === '/') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/';
    if (route === '/book') return pathname === '/book' || pathname === '/(tabs)/book';
    if (route === '/dashboard') {
      // bare /dashboard only when no tab query is present
      return pathname.startsWith('/dashboard') && !currentTab;
    }
    if (route.startsWith('/dashboard?tab=')) {
      const wantTab = route.split('=')[1];
      return pathname.startsWith('/dashboard') && currentTab === wantTab;
    }
    if (route === '/diseases') return pathname.startsWith('/disease');
    if (route === '/tools') return pathname === '/tools' || pathname.startsWith('/calculators') || pathname === '/ipss';
    return pathname === route || pathname.startsWith(route + '/');
  };

  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang as any) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';

  return (
    <View style={styles.root}>
      {/* Sidebar */}
      <View
        style={[
          styles.sidebar,
          { width: collapsed ? DESKTOP.sidebarCollapsedWidth : DESKTOP.sidebarWidth },
          // Smooth web-only transition between widths.
          Platform.OS === 'web' ? ({ transition: 'width 220ms ease' } as any) : null,
        ]}
      >
        <LinearGradient
          colors={COLORS.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Brand */}
        <TouchableOpacity
          onPress={() => router.push('/' as any)}
          style={[styles.brandRow, collapsed && styles.brandRowCollapsed]}
          activeOpacity={0.85}
          accessibilityLabel="Home"
          {...(Platform.OS === 'web' ? { title: 'ConsultUro · Home' } as any : {})}
        >
          <View style={styles.brandLogo}>
            <Ionicons name="medkit" size={20} color={COLORS.primary} />
          </View>
          {!collapsed && (
            <View style={{ flex: 1 }}>
              <Text style={styles.brandName}>ConsultUro</Text>
              <Text style={styles.brandSub}>Dr. Sagar Joshi</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Collapse / expand toggle */}
        <TouchableOpacity
          onPress={toggleCollapsed}
          style={[styles.collapseBtn, collapsed && styles.collapseBtnCentered]}
          activeOpacity={0.8}
          accessibilityLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          testID="web-sidebar-collapse"
          {...(Platform.OS === 'web'
            ? { title: collapsed ? 'Expand sidebar' : 'Collapse sidebar' } as any
            : {})}
        >
          <Ionicons
            name={collapsed ? 'chevron-forward' : 'chevron-back'}
            size={14}
            color="#fff"
          />
          {!collapsed && (
            <Text style={styles.collapseLabel}>Collapse</Text>
          )}
        </TouchableOpacity>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {(() => {
            // Walk the items and track the "current" section. When a
            // section is in the collapsed-set, hide all of its items.
            // Section headers stay visible and act as a toggle button
            // (with a chevron). Collapsed=true → hide children.
            let currentSection = '';
            const out: React.ReactNode[] = [];
            items.forEach((it, idx) => {
              if (it.section) currentSection = it.section;
              const sectionCollapsed = !collapsed && currentSection && collapsedSections.has(currentSection);
              const active = isActive(it.route);
              out.push(
                <React.Fragment key={`${it.route}__${idx}`}>
                  {it.section && !collapsed && (
                    <TouchableOpacity
                      onPress={() => toggleSection(it.section!)}
                      style={styles.navSectionRow}
                      activeOpacity={0.7}
                      testID={`web-sec-${it.section.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <Text style={styles.navSection}>{it.section.toUpperCase()}</Text>
                      <Ionicons
                        name={collapsedSections.has(it.section) ? 'chevron-down' : 'chevron-up'}
                        size={12}
                        color="rgba(255,255,255,0.55)"
                      />
                    </TouchableOpacity>
                  )}
                  {it.section && collapsed && (
                    <View style={styles.navSectionDot} />
                  )}
                  {!sectionCollapsed && (
                    <TouchableOpacity
                      onPress={() => {
                        if (it.onPress) it.onPress();
                        else router.push(it.route as any);
                      }}
                      style={[
                        styles.navItem,
                        active && styles.navItemActive,
                        collapsed && styles.navItemCollapsed,
                      ]}
                      activeOpacity={0.78}
                      testID={`web-nav-${it.label.toLowerCase().replace(/\s+/g, '-')}`}
                      accessibilityLabel={it.label}
                      {...(Platform.OS === 'web' ? { title: it.label } as any : {})}
                    >
                      <Ionicons
                        name={it.icon}
                        size={collapsed ? 20 : 18}
                        color={active ? '#fff' : 'rgba(255,255,255,0.86)'}
                      />
                      {!collapsed && (
                        <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
                          {it.label}
                        </Text>
                      )}
                      {!collapsed && it.pill ? (
                        <View style={styles.navPill}>
                          <Text style={styles.navPillText}>{it.pill}</Text>
                        </View>
                      ) : null}
                      {it.badge && it.badge > 0 ? (
                        <View
                          style={[
                            styles.navBadge,
                            collapsed && styles.navBadgeCollapsed,
                          ]}
                        >
                          <Text style={styles.navBadgeText}>{it.badge > 9 ? '9+' : String(it.badge)}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  )}
                </React.Fragment>
              );
            });
            return out;
          })()}
        </ScrollView>

        {/* Bottom — user card + sign out */}
        {user ? (
          <View style={styles.userCard}>
            <TouchableOpacity
              style={[styles.userRow, collapsed && styles.userRowCollapsed]}
              onPress={() => router.push('/profile' as any)}
              activeOpacity={0.85}
              accessibilityLabel="Profile"
              {...(Platform.OS === 'web' ? { title: user.name || 'Profile' } as any : {})}
            >
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={styles.userAvatar} />
              ) : (
                <View style={[styles.userAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                  <Ionicons name="person" size={16} color="#fff" />
                </View>
              )}
              {!collapsed && (
                <>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
                    <Text style={styles.userRole} numberOfLines={1}>{(user.role || '').toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity onPress={signOut} style={styles.userSignOut} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="log-out-outline" size={16} color="#fff" />
                  </TouchableOpacity>
                </>
              )}
            </TouchableOpacity>
            {collapsed && (
              <TouchableOpacity
                onPress={signOut}
                style={[styles.userRow, styles.userRowCollapsed, { marginTop: 6, backgroundColor: 'rgba(255,255,255,0.06)' }]}
                accessibilityLabel="Sign out"
                {...(Platform.OS === 'web' ? { title: 'Sign out' } as any : {})}
              >
                <Ionicons name="log-out-outline" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.userCard}>
            <TouchableOpacity
              onPress={() => router.push('/login' as any)}
              style={[styles.userRow, collapsed ? styles.userRowCollapsed : { justifyContent: 'center' }]}
              activeOpacity={0.85}
              accessibilityLabel="Sign in"
              {...(Platform.OS === 'web' ? { title: 'Sign in' } as any : {})}
            >
              <Ionicons name="log-in-outline" size={16} color="#fff" />
              {!collapsed && (
                <Text style={[styles.userName, { textAlign: 'center', marginLeft: 8 }]}>Sign in</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Main column */}
      <View style={styles.main}>
        <View style={styles.topbar}>
          <Text style={styles.topbarTitle}>ConsultUro</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={cycleLang} style={styles.topbarBtn} testID="web-topbar-lang">
            <Text style={styles.topbarLangBadge}>{langBadge}</Text>
          </TouchableOpacity>
          {user && (
            <TouchableOpacity onPress={() => router.push('/inbox' as any)} style={styles.topbarBtn}>
              <Ionicons name="chatbubbles" size={18} color={COLORS.primary} />
              {personalUnread > 0 && (
                <View style={styles.topbarBadge}>
                  <Text style={styles.topbarBadgeText}>{personalUnread > 9 ? '9+' : String(personalUnread)}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {user && (
            <View style={{ position: 'relative' }}>
              <TouchableOpacity
                onPress={() => setBellOpen((v) => !v)}
                style={[styles.topbarBtn, bellOpen && { backgroundColor: COLORS.primary + '15' }]}
                accessibilityLabel="Notifications"
                testID="web-topbar-bell"
              >
                <Ionicons name="notifications" size={18} color={COLORS.primary} />
                {unread > 0 && (
                  <View style={styles.topbarBadge}>
                    <Text style={styles.topbarBadgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {bellOpen && (
                <NotificationPopover
                  items={(notifs || []).slice(0, 12)}
                  unread={unread}
                  onClose={() => setBellOpen(false)}
                  onMarkRead={markRead}
                  onMarkAllRead={markAllRead}
                  onViewAll={() => {
                    setBellOpen(false);
                    router.push('/notifications' as any);
                  }}
                />
              )}
            </View>
          )}
        </View>

        {/* Page content — centered with a comfortable max-width on
            desktop so wide monitors don't stretch the existing
            mobile-first layouts into one giant single column. Each
            screen renders unchanged inside this constrained pane. */}
        <View style={styles.contentScroller}>
          <View style={styles.contentInner}>{children}</View>
        </View>
      </View>
    </View>
  );
}


/**
 * Compact desktop notification popover. Renders below the topbar bell
 * button with a transparent overlay that closes the panel on any
 * outside click. Shows up to 12 most-recent notifications with mark-
 * read tap and a "Mark all read" / "View all" footer.
 */
function NotificationPopover({
  items,
  unread,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onViewAll,
}: {
  items: Array<any>;
  unread: number;
  onClose: () => void;
  onMarkRead: (id: string) => Promise<void> | void;
  onMarkAllRead: () => Promise<void> | void;
  onViewAll: () => void;
}) {
  // ESC key + outside click both close the popover. We listen on the
  // window because React Native's Pressable won't catch DOM events.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fmt = (iso?: string) => {
    if (!iso) return '';
    // Always parse backend timestamps as UTC (parseBackendDate compensates
    // for FastAPI's tz-naive serialisation) and render the fallback date
    // in IST so Indian clinic staff see consistent timezones regardless
    // of where the browser is geolocated.
    const d = parseBackendDate(iso);
    if (isNaN(d.getTime())) return '';
    const diffMin = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return formatISTDate(d);
  };

  return (
    <>
      {/* invisible click-catcher so any click outside closes the popover */}
      <TouchableOpacity
        onPress={onClose}
        activeOpacity={1}
        style={popoverStyles.overlay}
      />
      <View style={popoverStyles.panel} testID="web-notif-popover">
        <View style={popoverStyles.header}>
          <Text style={popoverStyles.title}>Notifications</Text>
          {unread > 0 && (
            <View style={popoverStyles.unreadPill}>
              <Text style={popoverStyles.unreadPillText}>{unread} new</Text>
            </View>
          )}
        </View>
        <ScrollView
          style={popoverStyles.list}
          contentContainerStyle={{ paddingBottom: 4 }}
          showsVerticalScrollIndicator={false}
        >
          {items.length === 0 ? (
            <View style={popoverStyles.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={32} color={COLORS.textDisabled} />
              <Text style={popoverStyles.emptyTxt}>No notifications</Text>
            </View>
          ) : items.map((n) => (
            <TouchableOpacity
              key={n.notif_id || n.id}
              style={[popoverStyles.row, !n.read && popoverStyles.rowUnread]}
              activeOpacity={0.78}
              onPress={() => {
                if (!n.read) onMarkRead(n.notif_id || n.id);
              }}
            >
              {!n.read && <View style={popoverStyles.unreadDot} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={popoverStyles.rowTitle} numberOfLines={1}>{n.title || 'Notification'}</Text>
                {!!n.body && (
                  <Text style={popoverStyles.rowBody} numberOfLines={2}>{n.body}</Text>
                )}
                <Text style={popoverStyles.rowTs}>{fmt(n.created_at)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={popoverStyles.footer}>
          <TouchableOpacity
            onPress={() => { onMarkAllRead(); }}
            style={popoverStyles.footerBtn}
            disabled={unread === 0}
          >
            <Ionicons name="checkmark-done" size={14} color={unread === 0 ? COLORS.textDisabled : COLORS.primary} />
            <Text style={[popoverStyles.footerBtnText, unread === 0 && { color: COLORS.textDisabled }]}>
              Mark all read
            </Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={onViewAll}
            style={[popoverStyles.footerBtn, { backgroundColor: COLORS.primary }]}
          >
            <Text style={[popoverStyles.footerBtnText, { color: '#fff' }]}>View all</Text>
            <Ionicons name="arrow-forward" size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}


const popoverStyles = StyleSheet.create({
  overlay: {
    // On web we use a viewport-anchored fixed overlay so clicking
    // anywhere on the page closes the popover without distorting the
    // surrounding layout. The previous huge negative-inset absolute
    // overlay was relative to the topbar and could be clipped by an
    // ancestor's overflow:hidden, leaving the page below visually
    // collapsed (the user's "minimized appearance" complaint).
    ...(Platform.OS === 'web'
      ? ({ position: 'fixed' as any, top: 0, right: 0, bottom: 0, left: 0 } as any)
      : { position: 'absolute', top: -800, right: -2000, bottom: -2000, left: -2000, width: 4000, height: 4000 }),
    backgroundColor: 'transparent',
    zIndex: 998,
  },
  panel: {
    // Anchored to the topbar bell on web (fixed) and to the row on
    // native (absolute). Keeps the panel visible regardless of how
    // the page below is scrolled / collapsed.
    ...(Platform.OS === 'web'
      ? ({ position: 'fixed' as any, top: 60, right: 16 } as any)
      : { position: 'absolute', top: 44, right: 0 }),
    width: 360,
    maxHeight: 480,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
    zIndex: 999,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  title: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, flex: 1 },
  unreadPill: {
    backgroundColor: COLORS.accent + '20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  unreadPillText: { fontSize: 11, color: COLORS.accent, fontWeight: '700' },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowUnread: { backgroundColor: COLORS.primary + '08' },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.accent,
    marginTop: 6,
  },
  rowTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textPrimary },
  rowBody: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  rowTs: { fontSize: 11, color: COLORS.textDisabled, marginTop: 4 },
  empty: { padding: 30, alignItems: 'center', gap: 8 },
  emptyTxt: { fontSize: 12, color: COLORS.textSecondary },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    gap: 6,
    backgroundColor: '#FAFBFC',
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  footerBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
});


const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
  },
  sidebar: {
    width: DESKTOP.sidebarWidth,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 12,
    overflow: 'hidden',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.16)',
    marginBottom: 8,
  },
  brandRowCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  collapseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  collapseBtnCentered: {
    justifyContent: 'center',
    paddingHorizontal: 0,
  },
  collapseLabel: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { ...FONTS.h4, color: '#fff', fontSize: 16, lineHeight: 18 },
  brandSub: { ...FONTS.body, color: 'rgba(255,255,255,0.72)', fontSize: 11 },
  navSection: {
    ...FONTS.bodyMedium,
    fontSize: 10,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.45)',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  navSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
  },
  navSectionDot: {
    height: 1,
    marginVertical: 8,
    marginHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 1,
  },
  navItemCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    gap: 0,
  },
  navItemActive: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  navLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.86)',
    ...FONTS.bodyMedium,
    fontSize: 13,
  },
  navLabelActive: {
    color: '#fff',
    fontFamily: 'Manrope_700Bold',
  },
  navPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  navPillText: {
    ...FONTS.bodyMedium,
    color: '#fff',
    fontSize: 9,
    letterSpacing: 0.5,
  },
  navBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeCollapsed: {
    position: 'absolute',
    top: 4,
    right: 8,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.18)',
  },
  navBadgeText: { color: '#fff', fontSize: 10, fontFamily: 'Manrope_700Bold' },
  userCard: {
    paddingHorizontal: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  userRowCollapsed: {
    justifyContent: 'center',
    paddingHorizontal: 0,
    gap: 0,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  userName: { color: '#fff', ...FONTS.bodyMedium, fontSize: 13 },
  userRole: { color: 'rgba(255,255,255,0.7)', fontSize: 9.5, fontFamily: 'Manrope_700Bold', letterSpacing: 0.4 },
  userSignOut: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'column',
    backgroundColor: COLORS.bg,
    // Removed `overflow: hidden` on web so the absolute-positioned
    // notification popover (anchored under the topbar bell) renders
    // ABOVE the page content. The contentScroller below has its own
    // scroll and stays visually contained.
  },
  topbar: {
    height: DESKTOP.topbarHeight,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
    // Web-only: allow the absolute-positioned notification popover to
    // render OUTSIDE the topbar bounds. Without this, the dropdown is
    // clipped by `main`'s overflow:hidden so nothing appears on click.
    ...Platform.select({ web: { overflow: 'visible' as any, zIndex: 50 }, default: {} }),
  },
  topbarTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  topbarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1,
    borderColor: COLORS.primary + '24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topbarLangBadge: { color: COLORS.primary, fontSize: 12, fontFamily: 'Manrope_700Bold' },
  topbarBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fff',
  },
  topbarBadgeText: { color: '#fff', fontSize: 8, fontFamily: 'Manrope_700Bold' },
  content: {
    flex: 1,
    minHeight: 0,
  },
  // Outer flex container — host for the centered pane.
  contentScroller: {
    flex: 1,
    minHeight: 0,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
  },
  // Centered pane — capped width keeps line-length comfortable on
  // wide monitors. Screens render exactly as on mobile inside it.
  contentInner: {
    flex: 1,
    width: '100%',
    maxWidth: 1180,
    minHeight: 0,
  },
});

/**
 * WebContainer — wraps children with a centered, max-width content
 * area on desktop web. On mobile / native, it's a passthrough.
 *
 * Use this in screens that want their existing single-column layout
 * to read better on wide desktop monitors without rewriting.
 */
export function WebContainer({
  children,
  maxWidth,
  padded = true,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  padded?: boolean;
}) {
  const r = useResponsive();
  if (r.isMobile) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: COLORS.bg }}>
      <View
        style={{
          width: '100%',
          maxWidth: maxWidth ?? r.contentMaxWidth,
          flex: 1,
          paddingHorizontal: padded ? DESKTOP.contentPadX : 0,
          paddingVertical: padded ? DESKTOP.contentPadY : 0,
        }}
      >
        {children}
      </View>
    </View>
  );
}
