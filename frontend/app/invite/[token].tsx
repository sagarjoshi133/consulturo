/**
 * /invite/<token> — Accept-clinic-invitation landing page.
 *
 * Phase D of the multi-tenant rollout.
 *
 * Polished v2:
 *  • Color-coded role chip + expiry countdown.
 *  • Inline email-mismatch banner (in addition to confirm dialog).
 *  • Subtle entrance animations.
 *  • Sticky CTA at the bottom for one-handed thumb reach.
 *  • Better empty / error states.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from 'react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useTenant } from '../../src/tenant-context';

const COLORS = {
  primary: '#0F4C75',
  accent: '#1FA1B7',
  bg: '#F4F8FB',
  card: '#FFFFFF',
  border: '#E5EAF0',
  text: '#1A2E35',
  sub: '#7A8A98',
  error: '#C0392B',
  warn: '#E68A00',
};

const ROLE_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  primary_owner: { bg: '#0F4C7515', fg: '#0F4C75', label: 'Primary Owner' },
  partner: { bg: '#1FA1B71A', fg: '#0E6F80', label: 'Partner' },
  doctor: { bg: '#7B3FB51A', fg: '#5C2C99', label: 'Doctor' },
  assistant: { bg: '#FFAA001A', fg: '#9A6500', label: 'Assistant' },
  reception: { bg: '#1A2E351A', fg: '#1A2E35', label: 'Reception' },
  nursing: { bg: '#C0392B1A', fg: '#9B2A1F', label: 'Nursing' },
};

type InvitePreview = {
  clinic: {
    clinic_id: string;
    slug: string;
    name: string;
    tagline?: string;
  };
  email: string;
  role: string;
  note?: string;
  expires_at: number;
};

function humanCountdown(expiresAt: number): { text: string; tone: 'ok' | 'warn' | 'expired' } {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return { text: 'Expired', tone: 'expired' };
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day >= 1) return { text: `Expires in ${day} day${day === 1 ? '' : 's'}`, tone: day <= 1 ? 'warn' : 'ok' };
  if (hr >= 1) return { text: `Expires in ${hr} hour${hr === 1 ? '' : 's'}`, tone: 'warn' };
  if (min >= 1) return { text: `Expires in ${min} minute${min === 1 ? '' : 's'}`, tone: 'warn' };
  return { text: `Expires in ${sec}s`, tone: 'warn' };
}

export default function InviteAccept() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = String(Array.isArray(params.token) ? params.token[0] : params.token || '');
  const { user, loading: authLoading } = useAuth();
  const { refresh: refreshTenants, setCurrentClinicId } = useTenant();

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick once a minute so the countdown is reasonably live.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Load invite preview ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError('No invitation token provided.');
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await api.get(`/invitations/${encodeURIComponent(token)}`);
        if (cancelled) return;
        setInvite(r.data);
      } catch (e: any) {
        if (cancelled) return;
        const status = e?.response?.status;
        if (status === 404) setError('This invitation does not exist.');
        else if (status === 410) setError(e?.response?.data?.detail || 'This invitation is no longer valid.');
        else setError(e?.response?.data?.detail || 'Could not load invitation.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const userEmail = (user?.email || '').toLowerCase();
  const inviteEmail = (invite?.email || '').toLowerCase();
  const emailMatches = !!user && !!invite && userEmail === inviteEmail;
  const emailMismatch = !!user && !!invite && userEmail !== inviteEmail;

  const expiry = invite ? humanCountdown(invite.expires_at) : null;
  const expired = expiry?.tone === 'expired';
  // `now` reactively recomputes the displayed countdown without
  // recreating `expiry` — keep `now` in deps to avoid lint warning.
  void now;

  // ── Accept the invite ───────────────────────────────────────────────
  const onAccept = async () => {
    if (!invite || accepting || expired) return;
    if (!user) {
      router.replace(`/login?next=/invite/${encodeURIComponent(token)}` as any);
      return;
    }
    if (emailMismatch) {
      const proceed: boolean = await new Promise((resolve) => {
        Alert.alert(
          'Different email',
          `The invitation was sent to ${invite.email}, but you're signed in as ${userEmail}.\n\nAccept anyway?`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Accept', onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }
    setAccepting(true);
    try {
      const r = await api.post(`/invitations/${encodeURIComponent(token)}/accept`, {});
      const data = r.data || {};
      await refreshTenants();
      if (data.clinic_id) {
        await setCurrentClinicId(data.clinic_id);
      }
      router.replace('/dashboard' as any);
    } catch (e: any) {
      Alert.alert(
        'Could not accept',
        e?.response?.data?.detail || e?.message || 'Please retry.',
      );
    } finally {
      setAccepting(false);
    }
  };

  const role_pretty = useMemo(() => {
    if (!invite) return '';
    const t = ROLE_TONES[invite.role];
    if (t) return t.label;
    return invite.role.replace(/_/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase());
  }, [invite]);
  const roleTone = invite ? ROLE_TONES[invite.role] : undefined;

  // ── States ──────────────────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <View style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Loading invitation', headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={[styles.sub, { marginTop: 12 }]}>Loading invitation…</Text>
      </View>
    );
  }

  if (error || !invite) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Invitation', headerShown: false }} />
        <View style={styles.errorIconWrap}>
          <Feather name="x-circle" size={42} color={COLORS.error} />
        </View>
        <Text style={[styles.h1, { marginTop: 14 }]}>Invitation unavailable</Text>
        <Text style={[styles.sub, { marginTop: 6, textAlign: 'center', maxWidth: 320 }]}>
          {error || 'This invitation could not be loaded.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/' as any)}
          style={({ pressed }) => [styles.cta, styles.ctaPrimary, { marginTop: 22 }, pressed && { opacity: 0.85 }]}
        >
          <Feather name="home" size={16} color="#fff" />
          <Text style={styles.ctaText}>Go to ConsultUro home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Stack.Screen options={{ title: 'Invitation', headerShown: false }} />
      <LinearGradient
        colors={[COLORS.primary, COLORS.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <SafeAreaView edges={['top']} style={{ paddingHorizontal: 20, paddingBottom: 30 }}>
          <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center' }}>
            <View style={styles.iconBubble}>
              <Feather name="user-plus" size={32} color="#fff" />
            </View>
            <Text style={styles.heroTitle} numberOfLines={2}>
              You're invited
            </Text>
            <Text style={styles.heroSub} numberOfLines={2}>
              to join {invite.clinic.name}
            </Text>
            {!!invite.clinic.tagline && (
              <Text style={styles.heroTagline} numberOfLines={2}>
                {invite.clinic.tagline}
              </Text>
            )}
          </Animated.View>
        </SafeAreaView>
        <View style={styles.heroCurve} />
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: 100 + (insets.bottom || 0) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Expiry / mismatch banners */}
        {expired && (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.banner, styles.bannerErr]}>
            <Feather name="clock" size={16} color={COLORS.error} />
            <Text style={[styles.bannerText, { color: COLORS.error }]}>
              This invitation has expired. Ask the inviter to send a fresh one.
            </Text>
          </Animated.View>
        )}
        {!expired && expiry && expiry.tone === 'warn' && (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.banner, styles.bannerWarn]}>
            <Feather name="clock" size={16} color={COLORS.warn} />
            <Text style={[styles.bannerText, { color: COLORS.warn }]}>{expiry.text}</Text>
          </Animated.View>
        )}
        {emailMismatch && !expired && (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.banner, styles.bannerWarn]}>
            <Feather name="alert-triangle" size={16} color={COLORS.warn} />
            <Text style={[styles.bannerText, { color: COLORS.warn }]}>
              Invited as <Text style={{ fontWeight: '800' }}>{invite.email}</Text>; you're signed in as <Text style={{ fontWeight: '800' }}>{userEmail}</Text>.
            </Text>
          </Animated.View>
        )}

        {/* Main detail card */}
        <Animated.View entering={FadeInDown.duration(450).delay(100)} style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.clinicBadge}>
              <Feather name="briefcase" size={16} color="#fff" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.clinicName} numberOfLines={1}>
                {invite.clinic.name}
              </Text>
              {!!expiry && !expired && expiry.tone === 'ok' && (
                <Text style={styles.expiryOk}>{expiry.text}</Text>
              )}
            </View>
            {roleTone && (
              <View style={[styles.roleChip, { backgroundColor: roleTone.bg }]}>
                <Text style={[styles.roleChipText, { color: roleTone.fg }]}>
                  {roleTone.label}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.divider} />

          <Row label="Your role" value={role_pretty} />
          <Row label="Invited email" value={invite.email} />
          {emailMatches && (
            <View style={styles.matchRow}>
              <Feather name="check-circle" size={14} color="#1FA1B7" />
              <Text style={styles.matchText}>
                Matches your account
              </Text>
            </View>
          )}
          {!!invite.note && (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>MESSAGE FROM INVITER</Text>
              <Text style={styles.note}>{invite.note}</Text>
            </View>
          )}
        </Animated.View>

        {/* What happens next */}
        <Animated.View entering={FadeInDown.duration(450).delay(180)} style={[styles.card, { marginTop: 14 }]}>
          <Text style={styles.label}>WHEN YOU ACCEPT</Text>
          <Bullet icon="check" text={`Joined as a ${role_pretty.toLowerCase()} of ${invite.clinic.name}.`} />
          <Bullet icon="briefcase" text="Clinic appears in your top-right switcher." />
          <Bullet icon="shield" text="Only this clinic's data shows on your dashboard." />
        </Animated.View>
      </ScrollView>

      {/* ── Sticky bottom CTA ─────────────────────────────────────── */}
      <View
        style={[
          styles.stickyCta,
          { paddingBottom: 12 + (insets.bottom || 0) },
        ]}
      >
        {!user ? (
          <Pressable
            onPress={() => router.replace(`/login?next=/invite/${encodeURIComponent(token)}` as any)}
            style={({ pressed }) => [styles.cta, styles.ctaPrimary, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Feather name="log-in" size={16} color="#fff" />
            <Text style={styles.ctaText}>Sign in to accept</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onAccept}
            disabled={accepting || expired}
            style={({ pressed }) => [
              styles.cta,
              styles.ctaPrimary,
              (accepting || expired) && { opacity: 0.5 },
              pressed && !(accepting || expired) ? { opacity: 0.85 } : null,
            ]}
            accessibilityRole="button"
          >
            {accepting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check" size={16} color="#fff" />
                <Text style={styles.ctaText}>
                  {expired ? 'Invitation expired' : 'Accept invitation'}
                </Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <Text style={styles.value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Bullet({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletIcon}>
        <Feather name={icon} size={12} color={COLORS.primary} />
      </View>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const SHADOW = Platform.select({
  ios: {
    shadowColor: '#0F4C75',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {},
});

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  hero: { paddingBottom: 8, position: 'relative', overflow: 'hidden' },
  heroCurve: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 28,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  iconBubble: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 24,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  heroTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 18,
    letterSpacing: 0.2,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 24,
  },
  heroTagline: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 24,
    fontStyle: 'italic',
  },
  body: { paddingHorizontal: 16, paddingTop: 18 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    ...SHADOW,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clinicBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  clinicName: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  expiryOk: { fontSize: 12, color: COLORS.sub, marginTop: 2 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  row: { paddingVertical: 8 },
  label: { fontSize: 11, color: COLORS.sub, fontWeight: '800', letterSpacing: 0.6 },
  value: { fontSize: 15, color: COLORS.text, fontWeight: '600', marginTop: 4 },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    marginLeft: 0,
  },
  matchText: { fontSize: 12, color: '#0E6F80', fontWeight: '700' },
  note: {
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
    padding: 12,
    borderRadius: 10,
    fontStyle: 'italic',
    lineHeight: 20,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
  },
  roleChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  roleChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  bannerWarn: { backgroundColor: '#FFF7E8', borderColor: '#FFD58A' },
  bannerErr: { backgroundColor: '#FDECEA', borderColor: '#F2B5B0' },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
  bulletIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0F4C7515',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  bulletText: { flex: 1, fontSize: 13.5, color: COLORS.text, lineHeight: 19 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 26,
  },
  ctaPrimary: { backgroundColor: COLORS.primary },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.sub },
  errorIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(244,248,251,0.96)',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
