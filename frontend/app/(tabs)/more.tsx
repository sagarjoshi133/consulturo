// Sectioned More tab. Sections collapse logically:
//   • Profile card (top) — name + email + phone + role badges
//   • Account
//   • Admin (only for staff: dashboard, team analytics quick links)
//   • My Health (for patients) / Practice (for staff)
//   • Explore
//   • App
//   • About Dr. Sagar Joshi (last main section)

import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useAuth } from '../../src/auth';
import { useI18n } from '../../src/i18n';
import { useNotifications } from '../../src/notifications';
import { useResponsive, getForcedView, setForcedView, type ForceView } from '../../src/responsive';
import { useTenant } from '../../src/tenant-context';
import * as Clipboard from 'expo-clipboard';

const WHATSAPP = '+918155075669';
const STAFF_ROLES = ['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'];

type MenuItem = {
  icon: any;
  iconLib?: 'ion' | 'mci';
  label: string;
  sub?: string;
  route?: string;
  action?: () => void;
  testID: string;
  pill?: string;
  pillColor?: string;
};

export default function More() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  // Cycle language on each tap of the language pill (en → hi → gu → en),
  // matching the homepage / dashboard pattern.
  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang as any) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';
  // Use the shared NotificationProvider as the single source of truth for
  // both badges so the More tab matches the homepage/dashboard exactly.
  // - `unread`         → ALL non-personal items (bell)
  // - `personalUnread` → only kind="personal" items (Inbox icon)
  // Previously, this screen ran its own /inbox/all poller which counted
  // unread broadcast_inbox rows. Marking notifications as read via the
  // bell screen does NOT touch broadcast_inbox, so the bell badge here
  // would stay stuck at 1 even after the user cleared all alerts —
  // that was the "ghost notification count" bug. Sourcing both counts
  // from the shared hook keeps every badge in sync.
  const { unread, personalUnread } = useNotifications();
  const { isWebDesktop } = useResponsive();

  // ── Collapsible sections ──────────────────────────────────────────
  // Account, Dashboard, Practice (and "My Health" for patients) are
  // expanded by default; everything else starts collapsed. Persisted
  // in AsyncStorage so the user's preference survives app restarts.
  // The default-set carries BOTH English and current-locale section
  // titles so language switches don't reset the user's choice.
  const SECTIONS_KEY = 'consulturo_more_sections_collapsed_v1';
  const DEFAULT_COLLAPSED = new Set<string>([
    'Administration', 'Explore', 'App', 'About',
    t('more.sectionAdministration') || 'Administration',
    t('more.sectionExplore')        || 'Explore',
    t('more.sectionApp')            || 'App',
    t('more.sectionAbout')          || 'About',
  ]);
  const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(DEFAULT_COLLAPSED);
  React.useEffect(() => {
    AsyncStorage.getItem(SECTIONS_KEY).then((raw) => {
      if (raw) {
        try { setCollapsedSections(new Set(JSON.parse(raw))); } catch {}
      }
    }).catch(() => {});
  }, []);
  const toggleSection = (sec: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec); else next.add(sec);
      AsyncStorage.setItem(SECTIONS_KEY, JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  };
  // View-mode override (web only): cycles auto → desktop → mobile.
  // Hook-state so the pill label refreshes without a full reload when
  // the user taps it.
  const [forceMode, setForceMode] = React.useState<ForceView>(() => getForcedView());
  const cycleViewMode = () => {
    const order: ForceView[] = ['auto', 'desktop', 'mobile'];
    const next = order[(order.indexOf(forceMode) + 1) % order.length];
    setForceMode(next);
    setForcedView(next);
  };

  const isStaff = !!user && STAFF_ROLES.includes(user.role as string);
  // Owner-tier — super_owner, primary_owner, partner, or legacy
  // "owner". Used to gate Permission Manager visibility and the
  // owner-only quick actions on this screen.
  const isOwner =
    user?.role === 'super_owner' ||
    user?.role === 'primary_owner' ||
    user?.role === 'partner' ||
    user?.role === 'owner';
  const isSuperOwner = user?.role === 'super_owner';
  // Dashboard full-access: all owner-tier roles default TRUE per the
  // hierarchy SuperOwner > PrimaryOwner > Partner > Team. Super-owner
  // can revoke for a specific primary_owner via Permission Manager —
  // when revoked, /api/me/tier returns dashboard_full_access:false.
  // Non-owner team members still rely on the explicit per-user prop.
  const rawDfa = (user as any)?.dashboard_full_access;
  const isFullAccess = isOwner ? (rawDfa !== false) : !!rawDfa;

  const confirmAndLogout = () => {
    const msg = 'Sign out of ConsultUro?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) signOut();
    } else {
      const { Alert } = require('react-native');
      Alert.alert('Sign out', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
      ]);
    }
  };

  const goSignIn = () => router.push('/login');

  // ── Clinic Link (public /c/<slug>) — shown to primary_owner & partners
  // so they can quickly grab/share their clinic's public URL. Excludes
  // super_owner since the platform owner has no clinic of their own.
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
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.alert(`Clinic link copied:\n${clinicLink}`);
    } else {
      const { Alert } = require('react-native');
      Alert.alert(
        'Clinic link copied',
        clinicLink,
        [
          { text: 'OK' },
          { text: 'Open', onPress: () => Linking.openURL(clinicLink) },
        ],
      );
    }
  };

  // ── Sections ────────────────────────────────────────────────────────
  const sections: { title: string; items: MenuItem[] }[] = [];

  // ACCOUNT
  if (user) {
    sections.push({
      title: t('more.sectionAccount') || 'Account',
      items: [
        { icon: 'person-circle', label: t('more.profile') || 'Profile', sub: t('more.profileSub') || 'Email, phone, name', route: '/profile', testID: 'more-profile' },
        { icon: 'shield-checkmark', label: t('more.privacy'), route: '/privacy', testID: 'more-privacy' },
        { icon: 'log-out-outline', label: t('common.signOut'), action: confirmAndLogout, testID: 'more-logout' },
      ],
    });
  } else {
    sections.push({
      title: t('more.sectionAccount') || 'Account',
      items: [
        { icon: 'log-in', label: t('common.signIn'), sub: 'Email, phone or Google', action: goSignIn, testID: 'more-signin' },
      ],
    });
  }

  // DASHBOARD — separate single-item section just below Account.
  // Super-owner gets a "Platform Administration" link instead, since
  // the regular doctor dashboard is irrelevant to them. This is the
  // ONLY admin gateway in the More tab for super_owner — every other
  // clinic-management section is hidden below.
  if (isSuperOwner) {
    sections.push({
      title: t('more.sectionAdministration') || 'Administration',
      items: [
        {
          icon: 'shield-checkmark',
          label: 'Platform Administration',
          sub: 'Primary Owners, Demo Accounts, Audit Trail',
          route: '/permission-manager' as any,
          testID: 'more-platform-admin',
        },
      ],
    });
  } else if (isStaff) {
    sections.push({
      title: t('more.sectionDashboard') || 'Dashboard',
      items: [
        { icon: 'view-dashboard', iconLib: 'mci', label: t('more.doctorDashboard'), sub: 'Today, bookings, surgeries, team', route: '/dashboard', testID: 'more-dashboard', pill: user!.role.toUpperCase(), pillColor: COLORS.primary },
      ],
    });
  }

  // PRACTICE — moved to the "Administration's old slot" (immediately
  // after Dashboard) per latest spec. Day-to-day clinical workflow.
  // Super-owner is INTENTIONALLY skipped: they have no clinic to run.
  if (user && !isSuperOwner) {
    const canSendMsg = !!((user as any).can_send_personal_messages || isOwner);
    if (isStaff) {
      const practiceItems: MenuItem[] = [
        {
          icon: 'medkit',
          label: t('more.consults') || 'Consults',
          sub: t('more.consultsSub') || 'Today & upcoming · start / resume Rx',
          route: '/dashboard?tab=consultations' as any,
          testID: 'more-consults',
        },
        { icon: 'document-text', label: t('more.prescriptions') || 'Prescriptions', sub: t('more.prescriptionsSub') || 'Compose & history', route: '/dashboard?tab=prescriptions' as any, testID: 'more-prescriptions' },
        { icon: 'medical', label: t('more.surgeries') || 'Surgeries', sub: t('more.surgeriesSub') || 'Log & track procedures', route: '/dashboard?tab=surgeries' as any, testID: 'more-surgeries' },
        {
          icon: 'chatbubbles', iconLib: 'ion',
          label: t('more.inbox') || 'Inbox',
          sub: 'Personal messages with team & patients',
          route: '/inbox' as any,
          testID: 'more-inbox',
        },
        { icon: 'megaphone', label: t('more.broadcasts') || 'Broadcasts', sub: t('more.broadcastsSub') || 'Send / approve push messages', route: '/dashboard?tab=broadcasts' as any, testID: 'more-broadcasts' },
        {
          icon: 'create',
          label: t('more.notes') || 'Notes',
          sub: t('more.notesSubStaff') || 'Urology-oriented notes · clinical templates',
          route: '/notes',
          testID: 'more-notes',
        },
        {
          icon: 'alarm',
          label: t('more.reminders') || 'Reminders',
          sub: t('more.remindersSubStaff') || 'Device alarms · OPD, OT, calls',
          route: '/reminders',
          testID: 'more-reminders',
        },
      ];
      sections.push({ title: t('more.sectionPractice') || 'Practice', items: practiceItems });
    } else {
      const myHealthItems: MenuItem[] = [
        { icon: 'calendar', label: t('more.myBookings'), route: '/my-bookings', testID: 'more-bookings' },
        { icon: 'folder-open', label: t('more.myRecords'), route: '/my-records', testID: 'more-records' },
        {
          icon: 'chatbubbles', iconLib: 'ion',
          label: t('more.inbox') || 'Inbox',
          sub: canSendMsg
            ? 'Personal messages with the clinic team'
            : 'Personal messages from the clinic team',
          route: '/inbox' as any,
          testID: 'more-inbox',
        },
        {
          icon: 'create',
          label: t('more.notes') || 'Notes',
          sub: t('more.notesSub') || 'Personal medical notes',
          route: '/notes',
          testID: 'more-notes',
        },
        {
          icon: 'alarm',
          label: t('more.reminders') || 'Reminders',
          sub: t('more.remindersSub') || 'Set device alarms for medicines & visits',
          route: '/reminders',
          testID: 'more-reminders',
        },
      ];
      sections.push({
        title: t('more.sectionMyHealth') || 'My Health',
        items: myHealthItems,
      });
    }
  }

  // ADMINISTRATION — moved BELOW Practice per latest spec. Clinic-
  // management surfaces (analytics, team, permissions, branding,
  // backups). Dashboard now lives in its own section above.
  // Super-owner is hidden from the entire clinic-mgmt block — they
  // have a single "Platform Administration" entry above.
  if (isStaff && !isSuperOwner) {
    const adminItems: MenuItem[] = [];
    if (isOwner || isFullAccess) {
      adminItems.push(
        { icon: 'analytics', label: t('more.analytics') || 'Analytics', sub: t('more.analyticsSub') || 'KPIs & trends', route: '/dashboard?tab=analytics' as any, testID: 'more-analytics' },
        { icon: 'people', label: t('more.team') || 'Team', sub: t('more.teamSub') || 'Members & roles', route: '/dashboard?tab=team' as any, testID: 'more-team' },
      );
    }
    if (isOwner) {
      adminItems.push({
        icon: 'key',
        label: t('more.permissionManager') || 'Permission Manager',
        sub: t('more.permissionManagerSub') || 'Messaging, team, bookings & all access controls',
        route: '/permission-manager' as any,
        testID: 'more-perm-mgr',
      });
      adminItems.push({
        icon: 'color-palette',
        label: t('more.branding') || 'Branding & Settings',
        sub: t('more.brandingSub') || 'Patient home, clinic branding & prescription look',
        route: '/branding' as any,
        testID: 'more-branding',
      });
      // Clinic Link — only for primary_owner / partner with a real clinic
      // (super_owner doesn't have one). Tap copies the URL & offers
      // to open it in a browser.
      if (!isSuperOwner && clinicLink) {
        adminItems.push({
          icon: 'link',
          label: t('more.clinicLink') || 'Clinic Link',
          sub: clinicLink.replace(/^https?:\/\//, ''),
          action: copyClinicLink,
          testID: 'more-clinic-link',
          pill: t('more.copy') || 'Copy',
          pillColor: COLORS.primary,
        });
      }
    }
    if (isOwner || isFullAccess) {
      adminItems.push(
        { icon: 'cloud-upload', label: t('more.backups') || 'Backups', sub: 'MongoDB cloud snapshots', route: '/admin/backups' as any, testID: 'more-backups' },
      );
    }
    if (adminItems.length > 0) {
      sections.push({ title: t('more.sectionAdministration') || 'Administration', items: adminItems });
    }
  }

  // EXPLORE
  sections.push({
    title: t('more.sectionExplore') || 'Explore',
    items: [
      { icon: 'newspaper', label: t('more.blog'), route: '/blog', testID: 'more-blog' },
      { icon: 'play-circle', label: t('more.videos'), route: '/videos', testID: 'more-videos' },
      { icon: 'book', label: t('more.education'), route: '/education', testID: 'more-education' },
    ],
  });

  // APP — staff don't need patient-facing items like "Call clinic" or
  // "WhatsApp clinic" (they ARE the clinic). They keep app-level
  // utilities (help, terms) but the patient-only rows are hidden.
  const appItems: MenuItem[] = [
    { icon: 'help-buoy', label: t('more.helpContact'), route: '/help', testID: 'more-help' },
  ];
  if (!isStaff) {
    appItems.push(
      { icon: 'logo-whatsapp', label: t('more.whatsapp'), action: () => Linking.openURL(`https://wa.me/${WHATSAPP.replace('+', '')}`).catch(() => {}), testID: 'more-whatsapp' },
      { icon: 'call', label: t('more.call'), action: () => Linking.openURL(`tel:${WHATSAPP}`), testID: 'more-call' },
      { icon: 'globe', label: t('more.website'), action: () => WebBrowser.openBrowserAsync('https://www.drsagarjoshi.com'), testID: 'more-website' },
    );
  }
  appItems.push({ icon: 'document-text', label: t('more.terms'), route: '/terms', testID: 'more-terms' });
  // View mode toggle (web only) — cycle Auto / Desktop / Mobile so a
  // user can preview either layout regardless of their actual viewport.
  // The toggle ALSO honours the browser's "Request Desktop Site" UA
  // automatically (handled inside useResponsive).
  if (Platform.OS === 'web') {
    const modeLabel: Record<ForceView, string> = {
      auto: 'Auto',
      desktop: 'Desktop',
      mobile: 'Mobile',
    };
    const modeSub: Record<ForceView, string> = {
      auto: 'Adapts to your device width',
      desktop: 'Forced — multi-column shell on every screen',
      mobile: 'Forced — single-column phone layout',
    };
    appItems.push({
      icon: 'desktop',
      label: 'View mode',
      sub: modeSub[forceMode],
      action: cycleViewMode,
      testID: 'more-view-mode',
      pill: modeLabel[forceMode],
      pillColor: forceMode === 'desktop' ? COLORS.primary : forceMode === 'mobile' ? '#7C3AED' : '#6B7280',
    });
  }
  sections.push({ title: t('more.sectionApp') || 'App', items: appItems });

  // ABOUT (last) — kept for everyone. Two entries: About the Doctor
  // (clinic-specific, editable per primary owner) and About the
  // ConsultUro App (platform branding — patient-vs-team variant).
  sections.push({
    title: t('more.sectionAbout') || 'About',
    items: [
      { icon: 'information-circle', label: t('more.aboutDoctor') || 'About the Doctor', sub: t('more.aboutDoctorSub') || 'Credentials, experience, clinic', route: '/about', testID: 'more-about' },
      { icon: 'medical', label: 'About ConsultUro App', sub: isStaff ? 'Practice & branding highlights' : 'How this app helps you', route: '/about-app' as any, testID: 'more-about-app' },
    ],
  });

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>
            {isStaff ? 'More · Admin' : t('more.title')}
          </Text>
          {/* Top-right action cluster — same 44 px circles as the
              homepage header. Always show the language switch; the
              bell appears only for signed-in users. On desktop web
              the WebShell sidebar+topbar already provides these
              actions, so we hide the in-screen cluster to remove
              duplication. */}
          {!isWebDesktop && (
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={cycleLang}
              style={styles.headerCircle}
              testID="more-header-lang"
              accessibilityLabel={`Language: ${lang}`}
            >
              <Text style={styles.headerLangBadge} allowFontScaling={false}>
                {langBadge}
              </Text>
            </TouchableOpacity>
            {user ? (
              <TouchableOpacity
                onPress={() => router.push('/inbox' as any)}
                style={styles.headerCircle}
                testID="more-header-inbox"
                accessibilityLabel="Personal messages"
              >
                <Ionicons name="chatbubbles" size={19} color={COLORS.primary} />
                {personalUnread > 0 && (
                  <View style={styles.headerBellBadge}>
                    <Text style={styles.headerBellBadgeText}>
                      {personalUnread > 9 ? '9+' : String(personalUnread)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
            {user ? (
              <TouchableOpacity
                onPress={() => router.push('/notifications' as any)}
                style={styles.headerCircle}
                testID="more-header-bell"
              >
                <Ionicons name="notifications" size={20} color={COLORS.primary} />
                {unread > 0 && (
                  <View style={styles.headerBellBadge}>
                    <Text style={styles.headerBellBadgeText}>
                      {unread > 9 ? '9+' : String(unread)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          )}
        </View>

        {/* Profile HERO — non-tappable when signed in (use the row below
            in the Account section to open the Profile screen).
            Avatar / role / email / phone badges plus a sign-out icon
            at the right edge. The language switch & notification bell
            now live in the page header (top of /(tabs)/more), matching
            the homepage / dashboard pattern. */}
        {user ? (
          <View style={styles.profileHero} testID="more-profile-hero">
            <LinearGradient
              colors={COLORS.heroGradient}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.heroRow}>
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={styles.heroAvatar} />
              ) : (
                <View style={[styles.heroAvatar, { backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="person" size={28} color="#fff" />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={styles.heroName} numberOfLines={1}>{user.name}</Text>
                {!!user.email && (
                  <View style={styles.heroIdRow}>
                    <Ionicons name="mail" size={11} color="#E0F7FA" />
                    <Text style={styles.heroId} numberOfLines={1}>{user.email}</Text>
                  </View>
                )}
                {!!(user as any).phone && (
                  <View style={styles.heroIdRow}>
                    <Ionicons name="call" size={11} color="#E0F7FA" />
                    <Text style={styles.heroId} numberOfLines={1}>{(user as any).phone}</Text>
                  </View>
                )}
                <View style={styles.heroBadgeRow}>
                  <View style={styles.heroRoleTag}>
                    <Ionicons name="shield-checkmark" size={10} color="#fff" />
                    <Text style={styles.heroRoleText}>{user.role.toUpperCase()}</Text>
                  </View>
                  {!isOwner && isFullAccess && (
                    <View style={[styles.heroRoleTag, { backgroundColor: '#F59E0B' }]}>
                      <Ionicons name="key" size={10} color="#fff" />
                      <Text style={styles.heroRoleText}>FULL ACCESS</Text>
                    </View>
                  )}
                </View>
              </View>
              <TouchableOpacity
                onPress={confirmAndLogout}
                style={styles.heroSignOut}
                testID="more-hero-signout"
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                activeOpacity={0.75}
              >
                <Ionicons name="log-out-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.profileCard}
            onPress={goSignIn}
            activeOpacity={0.85}
            testID="more-profile-card"
          >
            <View style={[styles.avatar, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="person" size={28} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={styles.profileName}>Guest User</Text>
              <Text style={styles.profileEmail}>Tap to sign in or continue as guest</Text>
            </View>
            <View style={styles.signinBtn}>
              <Ionicons name="log-in-outline" size={16} color="#fff" />
              <Text style={styles.signinText}>{t('common.signIn')}</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Sections — collapsible. Account, Dashboard, Practice (and
            "My Health" for patients) start expanded; everything else
            starts collapsed. State persisted in AsyncStorage so the
            user's preference survives app restarts. */}
        {sections.map((sec) => {
          const isCollapsed = collapsedSections.has(sec.title);
          return (
            <View key={sec.title} style={{ marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => toggleSection(sec.title)}
                activeOpacity={0.7}
                style={styles.sectionHead}
                testID={`more-sec-${sec.title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <Text style={styles.sectionLabel}>{sec.title.toUpperCase()}</Text>
                <Ionicons
                  name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                  size={14}
                  color={COLORS.textSecondary}
                />
              </TouchableOpacity>
              {!isCollapsed && (
                <View style={styles.sectionCard}>
                  {sec.items.map((it, i) => (
                    <TouchableOpacity
                      key={`${sec.title}-${it.label}`}
                      style={[styles.menuRow, i !== sec.items.length - 1 && styles.menuRowDivider]}
                      onPress={() => (it.action ? it.action() : it.route ? router.push(it.route as any) : null)}
                      testID={it.testID}
                      activeOpacity={0.75}
                    >
                      <View style={styles.menuIcon}>
                        {it.iconLib === 'mci' ? (
                          <MaterialCommunityIcons name={it.icon} size={20} color={COLORS.primary} />
                        ) : (
                          <Ionicons name={it.icon as any} size={20} color={COLORS.primary} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.menuLabel} numberOfLines={1}>{it.label}</Text>
                        {it.sub ? <Text style={styles.menuSub} numberOfLines={1}>{it.sub}</Text> : null}
                      </View>
                      {it.pill ? (
                        <View style={[styles.pill, it.pillColor && { backgroundColor: it.pillColor + '18' }]}>
                          <Text style={[styles.pillText, it.pillColor && { color: it.pillColor }]}>{it.pill}</Text>
                        </View>
                      ) : null}
                      <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        <Text style={[styles.sectionLabel, { marginTop: 24 }]}>FOLLOW</Text>
        <View style={styles.socialRow}>
          {[
            { icon: 'logo-youtube', color: '#FF0000', url: 'https://www.youtube.com/@dr_sagar_j' },
            { icon: 'logo-facebook', color: '#1877F2', url: 'https://www.facebook.com/drsagarjoshi1' },
            { icon: 'logo-instagram', color: '#E1306C', url: 'https://www.instagram.com/sagar_joshi133' },
            { icon: 'logo-twitter', color: '#000000', url: 'http://twitter.com/Sagar_j_joshi' },
          ].map((s) => (
            <TouchableOpacity key={s.url} style={[styles.socialBtn, { backgroundColor: s.color + '15' }]} onPress={() => Linking.openURL(s.url)}>
              <Ionicons name={s.icon as any} size={22} color={s.color} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.footer}>ConsultUro v1.0.13 · © Dr. Sagar Joshi</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  profileCard: { marginTop: 14, backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, padding: 14, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 52, height: 52, borderRadius: 26 },

  // Premium gradient hero (signed-in)
  profileHero: {
    marginTop: 14,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 4 },
    }),
  },

  // Page header (above the profile hero) — language + bell circles
  // matched to the homepage style: 44 × 44 round, subtle primary tint.
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  headerCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary + '12',
    borderWidth: 1, borderColor: COLORS.primary + '24',
    alignItems: 'center', justifyContent: 'center',
  },
  headerLangBadge: {
    color: COLORS.primary, fontSize: 13,
    fontFamily: 'Manrope_700Bold',
  },
  headerBellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#fff',
  },
  headerBellBadgeText: { color: '#fff', fontSize: 9, fontFamily: 'Manrope_700Bold' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroAvatar: {
    width: 60, height: 60, borderRadius: 30,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
  },
  heroName: { ...FONTS.h3, color: '#fff', fontSize: 17, lineHeight: 22 },
  heroIdRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  heroId: { ...FONTS.body, color: '#E0F7FA', fontSize: 11.5, flex: 1 },
  heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  heroRoleTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8,
  },
  heroRoleText: {
    color: '#fff', fontFamily: 'Manrope_700Bold',
    fontSize: 9, letterSpacing: 0.5,
  },
  heroSignOut: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 8,
  },
  profileName: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 16 },
  profileEmail: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  roleTag: { backgroundColor: COLORS.primary + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  roleTagText: { ...FONTS.label, color: COLORS.primary, fontSize: 9, letterSpacing: 0.4 },
  signinBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, flexDirection: 'row', gap: 5, alignItems: 'center' },
  signinText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 12 },

  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginBottom: 6, letterSpacing: 0.6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4, paddingBottom: 2 },
  sectionCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, gap: 12 },
  menuRowDivider: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  menuIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: COLORS.primary + '12', alignItems: 'center', justifyContent: 'center' },
  menuLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  menuSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  pill: { backgroundColor: COLORS.accent + '18', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  pillText: { ...FONTS.label, color: COLORS.accent, fontSize: 9 },

  socialRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  socialBtn: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  footer: { ...FONTS.body, color: COLORS.textDisabled, textAlign: 'center', marginTop: 28, fontSize: 11 },
});
