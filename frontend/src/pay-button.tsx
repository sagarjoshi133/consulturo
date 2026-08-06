/**
 * PayButton — One-tap "Pay ₹XX" CTA that deep-links into the
 * Razorpay checkout screen. Renders nothing while loading config and
 * auto-hides if Razorpay is disabled (Activation pending). Pass:
 *
 *   <PayButton
 *     amount={750}
 *     targetKind="consultation"
 *     targetId={booking.booking_id}
 *     description="Consultation fee — Dr. Sagar Joshi"
 *     paidLabel="Paid"
 *     paid={booking.payment_status === 'paid'}
 *   />
 */
import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import { useAuth } from './auth';
import { fetchRazorpayConfig, type RazorpayConfig } from './payments/razorpay';

type Props = {
  amount: number;                       // ₹ rupees
  targetKind: 'consultation' | 'ipd' | 'receipt' | 'rx' | 'other';
  targetId?: string;
  description?: string;
  paid?: boolean;
  paidLabel?: string;
  compact?: boolean;
  /** Override the label when not paid (default: "Pay ₹{amount}"). */
  label?: string;
  /** Optional pathname to return to after success — defaults to back-nav. */
  returnTo?: string;
  testID?: string;
};

// Module-level cache so we only hit /payments/razorpay/config once per
// session — config rarely changes and avoids spamming the API.
let _cfgCache: { at: number; cfg: RazorpayConfig | null } | null = null;

export default function PayButton({
  amount,
  targetKind,
  targetId,
  description,
  paid,
  paidLabel = 'Paid',
  compact,
  label,
  returnTo,
  testID,
}: Props) {
  const router = useRouter();
  const { user } = useAuth() as any;
  const [cfg, setCfg] = useState<RazorpayConfig | null>(_cfgCache?.cfg || null);
  const [loading, setLoading] = useState(!_cfgCache);

  useEffect(() => {
    if (_cfgCache && Date.now() - _cfgCache.at < 5 * 60 * 1000) {
      setCfg(_cfgCache.cfg);
      setLoading(false);
      return;
    }
    let live = true;
    fetchRazorpayConfig()
      .then((c) => {
        _cfgCache = { at: Date.now(), cfg: c };
        if (live) { setCfg(c); setLoading(false); }
      })
      .catch(() => {
        if (live) { setCfg(null); setLoading(false); }
      });
    return () => { live = false; };
  }, []);

  if (loading) {
    return (
      <View style={[styles.btn, compact && styles.btnCompact, styles.btnDisabled]} testID={testID}>
        <ActivityIndicator size="small" color={COLORS.textSecondary} />
      </View>
    );
  }

  if (paid) {
    return (
      <View style={[styles.btn, compact && styles.btnCompact, styles.btnPaid]} testID={testID}>
        <Ionicons name="checkmark-circle" size={compact ? 14 : 16} color="#fff" />
        <Text style={[styles.txt, compact && styles.txtCompact, { color: '#fff' }]}>{paidLabel}</Text>
      </View>
    );
  }

  if (!cfg?.enabled) {
    // Activation pending — show subtle disabled pill so admin sees it
    // and patient understands payment will open later.
    return (
      <View style={[styles.btn, compact && styles.btnCompact, styles.btnDisabled]} testID={testID}>
        <Ionicons name="card-outline" size={compact ? 13 : 15} color={COLORS.textSecondary} />
        <Text style={[styles.txt, compact && styles.txtCompact, { color: COLORS.textSecondary }]}>
          Pay later
        </Text>
      </View>
    );
  }

  const onPress = () => {
    // Login is compulsory for payments — protects the patient from
    // anonymous charges and ensures we can persist a receipt + send
    // confirmation notifications. Already-logged-in users go straight
    // to checkout; anonymous users are routed to /login with a
    // `returnTo` deep-link that brings them back to this payment
    // intent after they sign in.
    if (!user) {
      const target = {
        pathname: '/pay',
        params: {
          amount_inr: String(amount),
          target_kind: targetKind,
          target_id: targetId || '',
          description: description || '',
          returnTo: returnTo || '',
        },
      };
      const returnUrl = `/pay?amount_inr=${amount}&target_kind=${encodeURIComponent(targetKind)}&target_id=${encodeURIComponent(targetId || '')}&description=${encodeURIComponent(description || '')}&returnTo=${encodeURIComponent(returnTo || '')}`;
      const proceed = () =>
        router.push({ pathname: '/login', params: { returnTo: returnUrl } } as any);
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined' && window.confirm('Please sign in to pay. Continue to sign-in?')) proceed();
      } else {
        Alert.alert(
          'Sign in required',
          'Please sign in to pay so we can email you the receipt and confirmation.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: proceed },
          ],
        );
      }
      return;
    }
    router.push({
      pathname: '/pay',
      params: {
        amount_inr: String(amount),
        target_kind: targetKind,
        target_id: targetId || '',
        description: description || '',
        returnTo: returnTo || '',
      },
    } as any);
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.btn, compact && styles.btnCompact, styles.btnPrimary]}
      testID={testID}
    >
      <Ionicons name="card" size={compact ? 13 : 15} color="#fff" />
      <Text style={[styles.txt, compact && styles.txtCompact, { color: '#fff' }]}>
        {label || `Pay ₹${amount.toFixed(2)}`}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  btnCompact: { paddingHorizontal: 10, paddingVertical: 6 },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPaid: { backgroundColor: COLORS.success },
  btnDisabled: { backgroundColor: COLORS.border },
  txt: { ...FONTS.bodyMedium, fontSize: 13 },
  txtCompact: { fontSize: 11 },
});
