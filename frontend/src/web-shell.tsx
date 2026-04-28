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
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname } from 'expo-router';
import { COLORS, FONTS, RADIUS } from './theme';
import { useResponsive, DESKTOP } from './responsive';
import { useAuth } from './auth';
import { useNotifications } from './notifications';
import { useI18n } from './i18n';

const STAFF_ROLES = new Set(['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing']);

type NavItem = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  testID?: string;
  badge?: number;
  staffOnly?: boolean;
  ownerOnly?: boolean;
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
  const { unread, personalUnread } = useNotifications();
  const { t, lang, setLang } = useI18n();

  const isStaff = !!user && STAFF_ROLES.has((user.role as string) || '');
  const isOwner = ['super_owner', 'primary_owner', 'owner', 'partner'].includes((user?.role as string) || '');
  const isFullAccess = !!(user as any)?.dashboard_full_access;

  // Build sidebar nav items based on role.
  const items: NavItem[] = [
    { label: 'Home', icon: 'home', route: '/' },
    { label: 'Book', icon: 'calendar', route: '/book' },
  ];
  if (isStaff) {
    items.push({ label: 'Dashboard', icon: 'grid', route: '/dashboard', staffOnly: true });
  } else if (user) {
    items.push({ label: 'My Bookings', icon: 'calendar-clear', route: '/my-bookings' });
    items.push({ label: 'My Records', icon: 'folder-open', route: '/my-records' });
  }
  items.push({
    label: 'Inbox',
    icon: 'chatbubbles',
    route: '/inbox',
    badge: personalUnread || 0,
  });
  items.push({
    label: 'Notifications',
    icon: 'notifications',
    route: '/notifications',
    badge: unread || 0,
  });
  items.push({ label: 'Diseases', icon: 'medical', route: '/diseases' });
  items.push({ label: 'Tools', icon: 'calculator', route: '/tools' });
  items.push({ label: 'Education', icon: 'book', route: '/education' });
  items.push({ label: 'Blog', icon: 'newspaper', route: '/blog' });
  items.push({ label: 'Videos', icon: 'play-circle', route: '/videos' });
  if (isStaff) {
    items.push({ label: 'Notes', icon: 'create', route: '/notes', staffOnly: true });
    items.push({ label: 'Reminders', icon: 'alarm', route: '/reminders', staffOnly: true });
  }
  if (isOwner || isFullAccess) {
    items.push({ label: 'Backups', icon: 'cloud-upload', route: '/admin/backups', staffOnly: true });
  }
  if (isOwner) {
    items.push({ label: 'Permissions', icon: 'key', route: '/permission-manager', ownerOnly: true });
  }
  items.push({ label: 'About', icon: 'information-circle', route: '/about' });

  // Active route detection — match exact OR prefix for nested routes.
  const isActive = (route: string) => {
    if (route === '/') return pathname === '/' || pathname === '/(tabs)' || pathname === '/(tabs)/';
    if (route === '/book') return pathname === '/book' || pathname === '/(tabs)/book';
    if (route === '/dashboard') return pathname.startsWith('/dashboard');
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
      <View style={styles.sidebar}>
        <LinearGradient
          colors={COLORS.heroGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.6, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* Brand */}
        <TouchableOpacity
          onPress={() => router.push('/' as any)}
          style={styles.brandRow}
          activeOpacity={0.85}
        >
          <View style={styles.brandLogo}>
            <Ionicons name="medkit" size={20} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.brandName}>ConsultUro</Text>
            <Text style={styles.brandSub}>Dr. Sagar Joshi</Text>
          </View>
        </TouchableOpacity>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {items.map((it) => {
            const active = isActive(it.route);
            return (
              <TouchableOpacity
                key={it.route}
                onPress={() => router.push(it.route as any)}
                style={[styles.navItem, active && styles.navItemActive]}
                activeOpacity={0.78}
                testID={`web-nav-${it.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Ionicons
                  name={it.icon}
                  size={18}
                  color={active ? '#fff' : 'rgba(255,255,255,0.86)'}
                />
                <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>
                  {it.label}
                </Text>
                {it.badge && it.badge > 0 ? (
                  <View style={styles.navBadge}>
                    <Text style={styles.navBadgeText}>{it.badge > 9 ? '9+' : String(it.badge)}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Bottom — user card + sign out */}
        {user ? (
          <View style={styles.userCard}>
            <TouchableOpacity
              style={styles.userRow}
              onPress={() => router.push('/profile' as any)}
              activeOpacity={0.85}
            >
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={styles.userAvatar} />
              ) : (
                <View style={[styles.userAvatar, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                  <Ionicons name="person" size={16} color="#fff" />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.userName} numberOfLines={1}>{user.name}</Text>
                <Text style={styles.userRole} numberOfLines={1}>{(user.role || '').toUpperCase()}</Text>
              </View>
              <TouchableOpacity onPress={signOut} style={styles.userSignOut} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="log-out-outline" size={16} color="#fff" />
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.userCard}>
            <TouchableOpacity
              onPress={() => router.push('/login' as any)}
              style={[styles.userRow, { justifyContent: 'center' }]}
              activeOpacity={0.85}
            >
              <Ionicons name="log-in-outline" size={16} color="#fff" />
              <Text style={[styles.userName, { textAlign: 'center', marginLeft: 8 }]}>Sign in</Text>
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
            <TouchableOpacity onPress={() => router.push('/notifications' as any)} style={styles.topbarBtn}>
              <Ionicons name="notifications" size={18} color={COLORS.primary} />
              {unread > 0 && (
                <View style={styles.topbarBadge}>
                  <Text style={styles.topbarBadgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
                </View>
              )}
            </TouchableOpacity>
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
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 1,
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
  navBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
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
    ...Platform.select({
      web: { overflow: 'hidden' },
      default: {},
    }),
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
