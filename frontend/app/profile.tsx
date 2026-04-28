// Profile — premium revamp.
//
// • Gradient hero with avatar, name and role/access badges
// • "Sign-in identifiers" section (Email / Phone with link buttons)
// • "Preferences" section — language picker + push-notification toggle
// • "Account" section — registered date, member id (last 8 chars)
// • "Danger zone" — prominent Sign-out button
//
// Both linking sub-flows (Phone via Firebase, Email via 6-digit OTP)
// are unchanged — we just present them inside an elegant container.

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  Modal,
  Platform,
  KeyboardAvoidingView,
  Switch,
  Alert,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useAuth } from '../src/auth';
import { useTier, roleLabel, roleEmoji } from '../src/tier';
import api from '../src/api';
import PhoneAuthModal from '../src/phone-auth';
import { useI18n } from '../src/i18n';
import LanguageDropdown from '../src/language-dropdown';

const PUSH_PREF_KEY = 'pref:push_enabled';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh, signOut } = useAuth();
  const { t } = useI18n();

  const [linkingPhone, setLinkingPhone] = useState(false);
  const [linkingEmail, setLinkingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState<'enter' | 'verify'>('enter');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);

  const u: any = user || {};
  const isStaff = ['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'].includes(u.role);
  // Owner-tier (super_owner / primary_owner / partner / legacy owner).
  // Used to gate clinic-wide settings & permission-manager visibility.
  const isOwner = ['super_owner', 'primary_owner', 'owner', 'partner'].includes(u.role);
  const tier = useTier();
  const isFullAccess = !!u.dashboard_full_access;

  // Hydrate push preference from local storage. (Native push registration
  // happens in /app/frontend/src/push.ts; this toggle stores user intent.)
  useEffect(() => {
    AsyncStorage.getItem(PUSH_PREF_KEY).then((v) => {
      if (v === '0') setPushEnabled(false);
    });
  }, []);

  const togglePush = async (v: boolean) => {
    setPushEnabled(v);
    await AsyncStorage.setItem(PUSH_PREF_KEY, v ? '1' : '0');
    if (!v) {
      Alert.alert(
        t('profile.pushOffTitle') || 'Notifications turned off',
        t('profile.pushOffMsg') || 'You will no longer receive push notifications. Re-enable any time.',
      );
    }
  };

  const memberId = useMemo(() => {
    const id = (u.user_id || '') as string;
    return id ? id.slice(-8).toUpperCase() : '';
  }, [u.user_id]);

  // Scroll-driven hero collapse: as the user scrolls the body up, the
  // expanded hero (avatar + info + stats) shrinks into a compact bar
  // showing only `[avatar] Name … [Today] [Pending]` in a single row.
  // The hero is absolutely positioned over a ScrollView whose content
  // is offset by `HERO_EXPANDED + insets.top + 8` so nothing is ever
  // hidden behind the bar.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y; } });
  const HERO_EXPANDED  = 196;
  const HERO_COLLAPSED = 56;
  const HERO_RANGE     = HERO_EXPANDED - HERO_COLLAPSED;
  // Header container shrinks in height as the user scrolls.
  const heroContainerAnim = useAnimatedStyle(() => {
    const h = interpolate(scrollY.value, [0, HERO_RANGE], [HERO_EXPANDED, HERO_COLLAPSED], Extrapolation.CLAMP);
    return { height: h + insets.top };
  });
  // Expanded content fades out within the first 60 % of scroll travel.
  const heroAnim = useAnimatedStyle(() => {
    const op = interpolate(scrollY.value, [0, HERO_RANGE * 0.6], [1, 0], Extrapolation.CLAMP);
    return { opacity: op };
  });
  // Compact bar fades in over the last 50 % of travel.
  const compactAnim = useAnimatedStyle(() => {
    const op = interpolate(scrollY.value, [HERO_RANGE * 0.45, HERO_RANGE], [0, 1], Extrapolation.CLAMP);
    return { opacity: op };
  });

  // Quick-stats — two compact tiles anchored to the right edge of the
  // header. Refreshes whenever the screen receives focus so figures
  // stay live (e.g. after a new booking).
  type StatTile = { label: string; value: number; icon: string; color: string };
  const [statTiles, setStatTiles] = useState<StatTile[]>([]);
  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      if (!user) return;
      try {
        const { data } = await api.get('/profile/quick-stats');
        if (!cancelled) setStatTiles(Array.isArray(data?.tiles) ? data.tiles : []);
      } catch {
        if (!cancelled) setStatTiles([]);
      }
    };
    fetchStats();
    return () => { cancelled = true; };
  }, [user]);

  const memberSince = useMemo(() => {
    const dt = u.created_at ? new Date(u.created_at) : null;
    if (!dt || isNaN(dt.valueOf())) return '';
    try { return format(dt, 'MMM yyyy'); } catch { return ''; }
  }, [u.created_at]);

  // Profile completion — measures how many of the 4 key fields are
  // filled. Each missing field is 25 % off; tap the progress bar to
  // jump to the linkable identifiers card. Filling the gap on the
  // right side of the hero AND nudging the user to add missing IDs.
  const profileChecks = useMemo(() => {
    const arr = [
      { label: 'Name',    ok: !!u.name },
      { label: 'Photo',   ok: !!u.picture },
      { label: 'Email',   ok: !!u.email },
      { label: 'Phone',   ok: !!u.phone },
    ];
    const done = arr.filter((x) => x.ok).length;
    return { items: arr, done, total: arr.length, pct: Math.round((done / arr.length) * 100) };
  }, [u.name, u.picture, u.email, u.phone]);
  const missingLabels = profileChecks.items.filter((x) => !x.ok).map((x) => x.label);

  const sendEmailLink = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
      setErr('Enter a valid email.');
      return;
    }
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/link-email/request', { email: emailInput.trim().toLowerCase() });
      setEmailStep('verify');
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not send email.');
    } finally {
      setBusy(false);
    }
  };

  const verifyEmailLink = async () => {
    if (emailCode.length !== 6) { setErr('Enter the 6-digit code.'); return; }
    setErr(''); setBusy(true);
    try {
      await api.post('/auth/link-email/verify', {
        email: emailInput.trim().toLowerCase(),
        code: emailCode,
      });
      await refresh();
      setLinkingEmail(false);
      setEmailInput(''); setEmailCode(''); setEmailStep('enter');
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmSignOut = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(t('profile.signOutConfirmMsg') || 'Sign out of ConsultUro?')) signOut();
    } else {
      Alert.alert(
        t('profile.signOutConfirmTitle') || 'Sign out',
        t('profile.signOutConfirmMsg') || 'Sign out of ConsultUro?',
        [
          { text: t('profile.cancel') || 'Cancel', style: 'cancel' },
          { text: t('profile.signOut') || 'Sign Out', style: 'destructive', onPress: () => signOut() },
        ],
      );
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="person-circle-outline" size={64} color={COLORS.textDisabled} />
        <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginTop: 12 }}>{t('profile.pleaseSignIn') || 'Please sign in to view your profile.'}</Text>
        <TouchableOpacity onPress={() => router.replace('/login' as any)} style={styles.openSignIn}>
          <Text style={{ color: '#fff', ...FONTS.bodyMedium }}>{t('profile.openSignIn') || 'Open sign-in'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      {/* Scrollable body — fills the screen, content begins below the
          expanded hero via paddingTop. The header floats on top with
          absolute positioning and its own animated height. */}
      <Animated.ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: HERO_EXPANDED + insets.top + 12,
          paddingBottom: 60 + insets.bottom,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* Sign-in Identifiers */}
        <Text style={[styles.sectionLabel, { marginTop: 0 }]}>{t('profile.sectionIdentifiers') || 'SIGN-IN IDENTIFIERS'}</Text>
        <View style={styles.section}>
          {/* Email row */}
          <View style={styles.row}>
            <View style={styles.iconWrap}><Ionicons name="mail" size={18} color={COLORS.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowEmail') || 'Email'}</Text>
              <Text style={[styles.rowSub, !u.email && { fontStyle: 'italic' }]}>
                {u.email || (t('profile.rowEmailEmpty') || 'Not linked yet')}
              </Text>
            </View>
            {u.email ? (
              <View style={styles.linkedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                <Text style={styles.linkedText}>{t('profile.verified') || 'Verified'}</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setLinkingEmail(true); setEmailStep('enter'); setErr(''); }} style={styles.linkBtn} testID="profile-link-email">
                <Ionicons name="add" size={14} color="#fff" />
                <Text style={styles.linkBtnText}>{t('profile.link') || 'Link'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Phone row */}
          <View style={[styles.row, styles.divider]}>
            <View style={styles.iconWrap}><Ionicons name="call" size={18} color={COLORS.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowPhone') || 'Phone'}</Text>
              <Text style={[styles.rowSub, !u.phone && { fontStyle: 'italic' }]}>
                {u.phone || (t('profile.rowPhoneEmpty') || 'Not linked yet')}
              </Text>
            </View>
            {u.phone ? (
              <View style={styles.linkedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                <Text style={styles.linkedText}>{t('profile.verified') || 'Verified'}</Text>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setLinkingPhone(true)} style={styles.linkBtn} testID="profile-link-phone">
                <Ionicons name="add" size={14} color="#fff" />
                <Text style={styles.linkBtnText}>{t('profile.link') || 'Link'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Preferences */}
        <Text style={styles.sectionLabel}>{t('profile.sectionPreferences') || 'PREFERENCES'}</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#7C3AED' + '18' }]}>
              <Ionicons name="language" size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowLanguage') || 'Language'}</Text>
              <Text style={styles.rowSub}>{t('profile.rowLanguageSub') || 'Switch app language any time'}</Text>
            </View>
            <LanguageDropdown testID="profile-lang-pref" />
          </View>

          <View style={[styles.row, styles.divider]}>
            <View style={[styles.iconWrap, { backgroundColor: '#0EA5E9' + '18' }]}>
              <Ionicons name="notifications" size={18} color="#0284C7" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowPush') || 'Push notifications'}</Text>
              <Text style={styles.rowSub}>{t('profile.rowPushSub') || 'Booking updates, broadcasts, reminders'}</Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={togglePush}
              trackColor={{ false: COLORS.border, true: COLORS.primary + '88' }}
              thumbColor={pushEnabled ? COLORS.primary : '#fff'}
              testID="profile-push-toggle"
            />
          </View>
        </View>

        {/* Quick links */}
        <Text style={styles.sectionLabel}>{t('profile.sectionShortcuts') || 'SHORTCUTS'}</Text>
        <View style={styles.section}>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/notifications' as any)} activeOpacity={0.78}>
            <View style={[styles.iconWrap, { backgroundColor: COLORS.warning + '18' }]}>
              <Ionicons name="mail-unread" size={18} color={COLORS.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowNotifications') || 'Notifications'}</Text>
              <Text style={styles.rowSub}>{t('profile.rowNotificationsSub') || 'Your in-app inbox'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>

          {!isStaff && (
            <TouchableOpacity style={[styles.row, styles.divider]} onPress={() => router.push('/my-bookings' as any)} activeOpacity={0.78}>
              <View style={[styles.iconWrap, { backgroundColor: COLORS.success + '18' }]}>
                <Ionicons name="calendar" size={18} color={COLORS.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('profile.rowMyBookings') || 'My bookings'}</Text>
                <Text style={styles.rowSub}>{t('profile.rowMyBookingsSub') || 'Past & upcoming visits'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.row, styles.divider]} onPress={() => router.push('/privacy' as any)} activeOpacity={0.78}>
            <View style={[styles.iconWrap, { backgroundColor: COLORS.textSecondary + '18' }]}>
              <Ionicons name="shield-checkmark" size={18} color={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowPrivacy') || 'Privacy & data'}</Text>
              <Text style={styles.rowSub}>{t('profile.rowPrivacySub') || 'How we handle your information'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>
        </View>

        {/* Account meta */}
        <Text style={styles.sectionLabel}>{t('profile.sectionAccount') || 'ACCOUNT'}</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: COLORS.primary + '12' }]}>
              <Ionicons name="finger-print" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t('profile.rowMemberId') || 'Member ID'}</Text>
              <Text style={styles.rowSub}>{memberId || '—'}</Text>
            </View>
          </View>
          {!!memberSince && (
            <View style={[styles.row, styles.divider]}>
              <View style={[styles.iconWrap, { backgroundColor: COLORS.primary + '12' }]}>
                <Ionicons name="calendar-clear" size={18} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{t('profile.rowJoined') || 'Joined'}</Text>
                <Text style={styles.rowSub}>{memberSince}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Sign out — danger */}
        <TouchableOpacity onPress={confirmSignOut} style={styles.signOutBtn} testID="profile-signout" activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.accent} />
          <Text style={styles.signOutText}>{t('profile.signOut') || 'Sign out'}</Text>
        </TouchableOpacity>

        <Text style={styles.versionTxt}>{t('profile.versionFooter') || 'ConsultUro v1.0.6 · © Dr. Sagar Joshi'}</Text>
      </Animated.ScrollView>

      {/* ─── Floating header ───
          Absolutely positioned, animated height. Contains both the
          full expanded hero (fades out on scroll) and the compact bar
          (fades in). */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.heroFloat, heroContainerAnim]}
      >
        <LinearGradient
          colors={COLORS.heroGradient}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Expanded hero content — fades OUT */}
        <Animated.View style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 14 }, heroAnim]} pointerEvents="box-none">
          <View style={styles.heroBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.heroIconBtn} testID="profile-back">
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.heroBarTitle}>{t('profile.title') || 'Profile'}</Text>
            {/* Top-right Sign-out icon — mirrors the bell circle style on
                the More header (44 × 44 round, on-gradient translucent
                surface) so the action is always reachable from the
                profile, matching the rest of the app's header pattern. */}
            <TouchableOpacity
              onPress={confirmSignOut}
              style={styles.heroHeaderCircle}
              testID="profile-header-signout"
              accessibilityLabel={t('profile.signOut') || 'Sign out'}
              activeOpacity={0.75}
            >
              <Ionicons name="log-out-outline" size={20} color="#fff" />
            </TouchableOpacity>
          </View>

          <View style={styles.heroBody}>
            {u.picture ? (
              <Image source={{ uri: u.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.avatarInitial}>
                  {(u.name || 'U').trim().charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.heroInfo}>
              <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
              {!!u.email && (
                <View style={styles.heroIdRow}>
                  <Ionicons name="mail" size={11} color="#E0F7FA" />
                  <Text style={styles.heroIdTxt} numberOfLines={1}>{u.email}</Text>
                </View>
              )}
              {!!u.phone && (
                <View style={styles.heroIdRow}>
                  <Ionicons name="call" size={11} color="#E0F7FA" />
                  <Text style={styles.heroIdTxt} numberOfLines={1}>{u.phone}</Text>
                </View>
              )}
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {roleEmoji(u.role)} {roleLabel(u.role).toUpperCase()}
                  </Text>
                </View>
                {!isOwner && isFullAccess && (
                  <View style={[styles.badge, { backgroundColor: '#F59E0B' }]}>
                    <Ionicons name="key" size={10} color="#fff" />
                    <Text style={styles.badgeText}>{t('profile.fullAccess') || 'FULL ACCESS'}</Text>
                  </View>
                )}
                {isStaff && (
                  <View style={[styles.badge, { backgroundColor: 'rgba(255,255,255,0.28)' }]}>
                    <Ionicons name="medkit" size={10} color="#fff" />
                    <Text style={styles.badgeText}>{t('profile.team') || 'TEAM'}</Text>
                  </View>
                )}
                {!!memberSince && (
                  <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                    <Ionicons name="calendar" size={10} color="#fff" />
                    <Text style={styles.badgeText}>{memberSince.toUpperCase()}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Quick-stats column */}
            {statTiles.length > 0 && (
              <View style={styles.statsCol}>
                {statTiles.slice(0, 2).map((s, i) => (
                  <View key={i} style={styles.statTile}>
                    <Ionicons name={s.icon as any} size={12} color="#E0F7FA" />
                    <Text style={styles.statValue}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Animated.View>

        {/* Compact bar — fades IN */}
        <Animated.View pointerEvents="box-none" style={[styles.compactBar, { paddingTop: insets.top + 4 }, compactAnim]}>
          <View style={styles.compactInner}>
            <TouchableOpacity onPress={() => router.back()} style={styles.heroIconBtn}>
              <Ionicons name="arrow-back" size={18} color="#fff" />
            </TouchableOpacity>
            {u.picture ? (
              <Image source={{ uri: u.picture }} style={styles.compactAvatar} />
            ) : (
              <View style={[styles.compactAvatar, { backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontFamily: 'Manrope_800ExtraBold', fontSize: 14 }}>{(u.name || 'U').trim().charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <Text style={styles.compactName} numberOfLines={1}>{u.name}</Text>
            {statTiles.slice(0, 2).map((s, i) => (
              <View key={i} style={styles.compactStat}>
                <Text style={styles.compactStatValue}>{s.value}</Text>
                <Text style={styles.compactStatLabel}>{s.label.slice(0, 6).toUpperCase()}</Text>
              </View>
            ))}
            {/* Sign-out — anchored to the right of the compact bar so
                the action is reachable even after the hero collapses. */}
            <TouchableOpacity
              onPress={confirmSignOut}
              style={styles.heroIconBtn}
              testID="profile-header-signout-compact"
              accessibilityLabel={t('profile.signOut') || 'Sign out'}
            >
              <Ionicons name="log-out-outline" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>

      {/* Phone-link modal */}
      <PhoneAuthModal
        visible={linkingPhone}
        onClose={() => setLinkingPhone(false)}
        onSuccess={async () => { setLinkingPhone(false); await refresh(); }}
      />

      {/* Email-link bottom sheet */}
      <Modal visible={linkingEmail} animationType="slide" transparent onRequestClose={() => setLinkingEmail(false)}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <View style={styles.sheet}>
              <View style={styles.sheetHead}>
                <Text style={styles.sheetTitle}>{emailStep === 'enter' ? (t('profile.addEmailTitle') || 'Add your email') : (t('profile.verifyEmailTitle') || 'Verify email')}</Text>
                <TouchableOpacity onPress={() => setLinkingEmail(false)}>
                  <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                </TouchableOpacity>
              </View>

              {emailStep === 'enter' ? (
                <>
                  <Text style={styles.sheetBody}>{t('profile.addEmailHint') || "We'll email a 6-digit code to confirm."}</Text>
                  <TextInput
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="you@example.com"
                    placeholderTextColor={COLORS.textDisabled}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    style={styles.input}
                    testID="profile-link-email-input"
                  />
                  {err ? <Text style={styles.err}>{err}</Text> : null}
                  <TouchableOpacity
                    onPress={sendEmailLink}
                    disabled={busy}
                    style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>{busy ? '…' : (t('profile.sendCode') || 'Send code')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.sheetBody}>{(t('profile.verifyEmailHint') || 'Enter the 6-digit code sent to {email}.').replace('{email}', emailInput)}</Text>
                  <TextInput
                    value={emailCode}
                    onChangeText={(s) => setEmailCode(s.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    placeholderTextColor={COLORS.textDisabled}
                    keyboardType="number-pad"
                    maxLength={6}
                    style={[styles.input, styles.codeInput]}
                  />
                  {err ? <Text style={styles.err}>{err}</Text> : null}
                  <TouchableOpacity
                    onPress={verifyEmailLink}
                    disabled={busy || emailCode.length !== 6}
                    style={[styles.primaryBtn, (busy || emailCode.length !== 6) && { opacity: 0.6 }]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>{busy ? '…' : (t('profile.verifyAndLink') || 'Verify & link')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setEmailStep('enter')} style={{ marginTop: 10, alignSelf: 'center' }}>
                    <Text style={{ ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 }}>{t('profile.changeEmail') || '← Change email'}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Floating header — absolutely positioned over the ScrollView so
  // its height can animate while the body content keeps scrolling.
  heroFloat: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    overflow: 'hidden',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 10,
  },
  // Compact bar — fades in via `compactAnim`. Sits absolutely inside
  // the floating hero so it overlaps the (faded) expanded content.
  compactBar: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 14,
    justifyContent: 'flex-start',
  },
  compactInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  compactAvatar: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
  },
  compactName: {
    flex: 1,
    color: '#fff',
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
  },
  compactStat: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 44,
  },
  compactStatValue: {
    color: '#fff',
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 13,
  },
  compactStatLabel: {
    color: '#E0F7FA',
    fontFamily: 'Manrope_700Bold',
    fontSize: 7.5,
    letterSpacing: 0.4,
    marginTop: -1,
  },

  // Hero — compact: image left, info right
  hero: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  heroIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  // Top-right circle — sized to match the bell on the More header
  // (44 × 44). On the gradient hero we use a translucent white surface
  // for visibility (instead of the primary tint used on the white More
  // page) while keeping the same overall shape and visual weight.
  heroHeaderCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroBarTitle: { ...FONTS.h4, color: '#fff', fontSize: 16, flex: 1 },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 12,
  },
  heroInfo: { flex: 1, minWidth: 0, justifyContent: 'center' },
  avatar: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: '#fff',
    alignSelf: 'center',
  },
  avatarInitial: { color: '#fff', fontFamily: 'Manrope_800ExtraBold', fontSize: 32 },
  name: { ...FONTS.h3, color: '#fff', fontSize: 17, lineHeight: 22 },
  heroIdRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  heroIdTxt: { ...FONTS.body, color: '#E0F7FA', fontSize: 11, flex: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 7,
  },
  badgeText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 9, letterSpacing: 0.4 },
  memberSince: { ...FONTS.body, color: '#E0F7FA', fontSize: 10.5, marginTop: 5 },

  // Quick-stats column — anchored to the right of heroInfo. Each
  // tile is a compact 2-line block (icon · value · label).
  // Uses fixed height (matches avatar) so the right column doesn't
  // stretch the avatar; the avatar is centered with the info next
  // to it as the canonical layout.
  statsCol: {
    width: 64,
    gap: 6,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  statTile: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 12,
    paddingHorizontal: 6, paddingVertical: 7,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  statValue: {
    color: '#fff',
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    lineHeight: 22,
    marginTop: 1,
  },
  statLabel: {
    color: '#E0F7FA',
    fontFamily: 'Manrope_700Bold',
    fontSize: 8.5,
    letterSpacing: 0.6,
    marginTop: 1,
  },

  // Profile completion strip — sits below the badge row inside the
  // info column so it fills any wasted right-side space.
  completeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10,
  },
  completeHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  completeLabel: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 0.2, flex: 1 },
  completeBarTrack: {
    height: 4, marginTop: 5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  completeBarFill: {
    height: 4, borderRadius: 2,
    backgroundColor: '#FFE6A1',
  },

  // Sections
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10.5, marginTop: 18, marginBottom: 6, letterSpacing: 0.7 },
  section: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  divider: { borderTopWidth: 1, borderTopColor: COLORS.border },
  iconWrap: { width: 34, height: 34, borderRadius: 11, backgroundColor: COLORS.primary + '12', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13.5 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  linkedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.success + '15',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  linkedText: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 11 },
  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill,
  },
  linkBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 12 },

  // Sign out / version
  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 22,
    paddingVertical: 14, paddingHorizontal: 18,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5, borderColor: COLORS.accent + '66',
    backgroundColor: COLORS.accent + '08',
  },
  signOutText: { ...FONTS.bodyMedium, color: COLORS.accent, fontSize: 14 },
  versionTxt: { ...FONTS.body, color: COLORS.textDisabled, textAlign: 'center', marginTop: 18, fontSize: 11 },

  // Sheet (email link)
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  sheetBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 14 },
  input: { backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 15, color: COLORS.textPrimary, marginTop: 12 },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  err: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 6 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 14 },

  // Sign-in fallback
  openSignIn: { marginTop: 16, backgroundColor: COLORS.primary, paddingHorizontal: 22, paddingVertical: 12, borderRadius: RADIUS.pill },
});
