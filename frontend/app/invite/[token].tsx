/**
 * /invite/<token> — Accept-clinic-invitation landing page.
 *
 * Phase D of the multi-tenant rollout. Flow:
 *  1. Page mounts → calls GET /api/invitations/<token> (PUBLIC) to
 *     load the clinic name + role + status.
 *  2. If the user is NOT signed in → push them to /login with a
 *     `?next=/invite/<token>` so we return here after sign-in.
 *  3. If signed in → render an "Accept" CTA. On tap →
 *     POST /api/invitations/<token>/accept which creates the
 *     clinic_membership and consumes the token. Then refresh the
 *     TenantContext and route to /dashboard.
 *
 * Edge cases:
 *  • Expired / revoked / already-accepted token → friendly error.
 *  • User signed in with a different email than the invite → confirm
 *    dialog before accepting (it's still allowed; we just warn).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

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

export default function InviteAccept() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = String(Array.isArray(params.token) ? params.token[0] : params.token || '');
  const { user, loading: authLoading } = useAuth();
  const { refresh: refreshTenants, setCurrentClinicId } = useTenant();

  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

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

  // ── Accept the invite ───────────────────────────────────────────────
  const onAccept = async () => {
    if (!invite || accepting) return;
    if (!user) {
      // Not signed in — bounce to login with a return-path.
      router.replace(`/login?next=/invite/${encodeURIComponent(token)}` as any);
      return;
    }
    // Warn if the signed-in email doesn't match the invited email.
    const userEmail = (user.email || '').toLowerCase();
    if (userEmail !== invite.email.toLowerCase()) {
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
      // Refresh tenant list so the new clinic shows up in the switcher
      // and immediately make it the active selection.
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

  // ── States ──────────────────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Loading invitation', headerShown: false }} />
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error || !invite) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: COLORS.bg }]}>
        <Stack.Screen options={{ title: 'Invitation', headerShown: false }} />
        <Feather name="x-circle" size={48} color={COLORS.error} />
        <Text style={[styles.h1, { marginTop: 12 }]}>Invitation unavailable</Text>
        <Text style={[styles.sub, { marginTop: 6, textAlign: 'center', maxWidth: 320 }]}>
          {error || 'This invitation could not be loaded.'}
        </Text>
        <Pressable
          onPress={() => router.replace('/' as any)}
          style={[styles.cta, { marginTop: 20 }]}
        >
          <Text style={styles.ctaText}>Go to ConsultUro home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const role_pretty = invite.role.replace(/_/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase());

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
          <View style={styles.iconBubble}>
            <Feather name="user-plus" size={32} color="#fff" />
          </View>
          <Text style={styles.heroTitle} numberOfLines={2}>
            You're invited
          </Text>
          <Text style={styles.heroSub} numberOfLines={2}>
            to join {invite.clinic.name}
          </Text>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.card}>
          <Row label="Clinic" value={invite.clinic.name} />
          {!!invite.clinic.tagline && (
            <Row label="Tagline" value={invite.clinic.tagline} />
          )}
          <Row label="Your role" value={role_pretty} />
          <Row label="Invited email" value={invite.email} />
          {!!invite.note && (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.label, { marginBottom: 4 }]}>Message</Text>
              <Text style={styles.note}>{invite.note}</Text>
            </View>
          )}
        </View>

        {!user ? (
          <Pressable
            onPress={() => router.replace(`/login?next=/invite/${encodeURIComponent(token)}` as any)}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.8 }]}
          >
            <Feather name="log-in" size={16} color="#fff" />
            <Text style={styles.ctaText}>Sign in to accept</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={onAccept}
            disabled={accepting}
            style={({ pressed }) => [
              styles.cta,
              accepting && { opacity: 0.7 },
              pressed && !accepting ? { opacity: 0.8 } : null,
            ]}
          >
            {accepting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Feather name="check" size={16} color="#fff" />
                <Text style={styles.ctaText}>Accept invitation</Text>
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
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  hero: { paddingBottom: 8 },
  iconBubble: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 24,
  },
  heroTitle: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: 15, textAlign: 'center', marginTop: 6 },
  body: { paddingHorizontal: 16, paddingTop: 24, gap: 18 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
  },
  row: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  label: { fontSize: 11, color: COLORS.sub, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  value: { fontSize: 15, color: COLORS.text, fontWeight: '600', marginTop: 4 },
  note: {
    fontSize: 14,
    color: COLORS.text,
    backgroundColor: COLORS.bg,
    padding: 10,
    borderRadius: 8,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  cta: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  h1: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.sub },
});
