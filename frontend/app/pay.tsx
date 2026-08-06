/**
 * /pay — Razorpay Checkout WebView.
 *
 * Route params (passed via router.push):
 *   - amount_inr      (number)   required (₹)
 *   - target_kind     (string)   consultation | ipd | receipt | rx | other
 *   - target_id?      (string)   booking_id / admission_id / receipt_id
 *   - description?    (string)   shown in checkout UI
 *   - returnTo?       (string)   pathname to push on success (default: back)
 *
 * The screen takes the params, calls the backend to create a Razorpay
 * order, mounts a WebView that runs the Razorpay JS SDK against the
 * order, listens for postMessage events, and on success calls the
 * backend verify endpoint then routes the user back.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useAuth } from '../src/auth';
import {
  createOrder,
  verifyPayment,
  buildCheckoutHtml,
  fetchRazorpayConfig,
} from '../src/payments/razorpay';
import { resetFallback } from '../src/backend-health';
type CreateOrderResponse = Awaited<ReturnType<typeof createOrder>>;

/**
 * Convert any axios / fetch error into a short, patient-friendly
 * message. We deliberately AVOID surfacing Cloudflare error HTML
 * (which the legacy fallback message used to render and looked like
 * the screen had reloaded). HTTP 5xx maps to a "try again" hint.
 */
function friendlyPayError(e: any): string {
  if (e?.code === 'ECONNABORTED') {
    return 'Payment is taking longer than usual. Please check your connection and tap Retry.';
  }
  if (e?.code === 'ERR_NETWORK') {
    return 'You appear to be offline. Reconnect and tap Retry.';
  }
  const status = e?.response?.status;
  const data = e?.response?.data;
  // Backend FastAPI errors come back as { detail: "..." } JSON.
  if (data && typeof data === 'object' && typeof data.detail === 'string') {
    return data.detail;
  }
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'Please sign in again to continue.';
    if (status === 404) return 'This payment could not be located. Please go back and try again.';
    if (status === 400) return 'Invalid payment request. Please go back and try again.';
    if (status >= 502 && status <= 524) {
      return 'The payment server is temporarily unreachable. Please tap Retry in a moment.';
    }
  }
  if (typeof e?.message === 'string' && e.message.length < 160) return e.message;
  return 'Could not start checkout. Please tap Retry.';
}

export default function PayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    amount_inr?: string;
    target_kind?: string;
    target_id?: string;
    description?: string;
    returnTo?: string;
  }>();
  const { user } = useAuth() as any;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<CreateOrderResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const html = useMemo(() => {
    if (!order) return '';
    return buildCheckoutHtml({
      keyId: order.key_id,
      orderId: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      themeColor: order.theme?.color || '#0E7C8B',
    });
  }, [order]);
  const dismissedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchRazorpayConfig();
        if (!cfg.enabled) {
          setError(
            cfg.mode === 'test'
              ? 'Razorpay is not yet activated. Please ask the clinic admin to add API keys (Activation pending).'
              : 'Payments are temporarily unavailable. Please try again later.'
          );
          setLoading(false);
          return;
        }
        const amount = Number(params.amount_inr || 0);
        if (!amount || amount < 1) {
          setError('Invalid amount. Minimum payable is ₹1.');
          setLoading(false);
          return;
        }
        // Try once, retry once on transient gateway/Cloudflare errors
        // (520-524 / 502 / 503 / ECONNABORTED) so a single bad hop
        // doesn't dead-end the patient. Razorpay order creation is
        // idempotent on our side (each call generates a fresh order
        // id) so a retry is safe.
        const doCreate = () => createOrder({
          amount_inr: amount,
          target_kind: (params.target_kind as any) || 'other',
          target_id: params.target_id,
          description: params.description,
          patient_name: user?.name,
          patient_phone: user?.phone,
          patient_email: user?.email,
        });
        let resp;
        try {
          resp = await doCreate();
        } catch (firstErr: any) {
          const status = firstErr?.response?.status;
          const code = firstErr?.code;
          const transient =
            (status >= 502 && status <= 524) ||
            code === 'ECONNABORTED' ||
            code === 'ERR_NETWORK' ||
            !firstErr?.response;
          if (!transient) throw firstErr;
          // Small backoff before second attempt.
          await new Promise((r) => setTimeout(r, 800));
          resp = await doCreate();
        }
        if (!cancelled) {
          setOrder(resp);
          setLoading(false);
        }
      } catch (e: any) {
        if (cancelled) return;
        setError(friendlyPayError(e));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const onMessage = async (msg: any) => {
    let payload: any = null;
    try { payload = JSON.parse(msg.nativeEvent.data); } catch { return; }
    if (!payload || !payload.type) return;
    if (payload.type === 'dismiss') {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      Alert.alert('Cancelled', 'Payment was cancelled.');
      goBack();
      return;
    }
    if (payload.type === 'failed') {
      Alert.alert('Payment failed', payload.data?.description || 'Please try again.');
      goBack();
      return;
    }
    if (payload.type === 'success' && payload.data) {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = payload.data;
      setVerifying(true);
      try {
        const res = await verifyPayment({
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          target_kind: params.target_kind,
          target_id: params.target_id,
        });
        Alert.alert('Payment successful', `₹${order?.amount_inr ?? ''} received. Reference: ${res.local_id || razorpay_payment_id}`);
        if (params.returnTo) {
          router.replace(params.returnTo as any);
        } else {
          goBack();
        }
      } catch (e: any) {
        Alert.alert('Verification failed', e?.response?.data?.detail || 'Could not verify payment.');
      } finally {
        setVerifying(false);
      }
    }
  };

  const goBack = () => {
    try {
      if (router.canGoBack && router.canGoBack()) router.back();
      else router.replace('/' as any);
    } catch { router.replace('/' as any); }
  };

  // ── Auth gate ───────────────────────────────────────────────
  // Payments require sign-in (compulsory). Already-authenticated
  // users continue to checkout below; anonymous visitors get a
  // friendly Sign-in CTA that returns to this exact /pay deep link
  // after auth so they don't lose the booking flow.
  if (!user) {
    const returnUrl = `/pay?amount_inr=${params.amount_inr || ''}&target_kind=${encodeURIComponent(params.target_kind || '')}&target_id=${encodeURIComponent(params.target_id || '')}&description=${encodeURIComponent(params.description || '')}&returnTo=${encodeURIComponent(params.returnTo || '')}`;
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={goBack} title="Sign in to pay" />
        <View style={styles.centered}>
          <Ionicons name="lock-closed" size={48} color={COLORS.primary} />
          <Text style={styles.h3}>Sign in to pay</Text>
          <Text style={styles.muted}>
            Please sign in so we can send you the receipt and an appointment confirmation.
          </Text>
          <TouchableOpacity
            onPress={() => router.replace({ pathname: '/login', params: { returnTo: returnUrl } } as any)}
            style={styles.btn}
            testID="pay-signin"
          >
            <Ionicons name="log-in-outline" size={16} color="#fff" />
            <Text style={styles.btnText}> Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={goBack} style={[styles.btn, { backgroundColor: 'transparent', marginTop: 4 }]} testID="pay-cancel">
            <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Render states ───────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={goBack} title="Secure Payment" />
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.muted}>Preparing checkout…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={goBack} title="Payment" />
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={48} color={COLORS.warning} />
          <Text style={styles.h3}>Payment temporarily unavailable</Text>
          <Text style={styles.muted}>{error}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => {
              // Reset DR state so we re-probe the primary backend on
              // the next call — sticks the user on the latest healthy
              // host instead of permanently degrading to a backup
              // origin that may itself be timing out (recurring bug).
              try { resetFallback(); } catch {}
              setError(null);
              setLoading(true);
              setOrder(null);
              // Trigger the effect again by remounting via a tiny
              // hack — we just set a key on the screen body in
              // future revs; for now a simple reload works:
              setTimeout(() => {
                router.replace({
                  pathname: '/pay',
                  params: {
                    amount_inr: params.amount_inr || '',
                    target_kind: params.target_kind || '',
                    target_id: params.target_id || '',
                    description: params.description || '',
                    returnTo: params.returnTo || '',
                    _r: String(Date.now()),
                  },
                } as any);
              }, 50);
            }}
            testID="pay-retry"
          >
            <Ionicons name="refresh" size={16} color="#fff" />
            <Text style={styles.btnText}>  Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: 'transparent', marginTop: 4 }]}
            onPress={goBack}
            testID="pay-back"
          >
            <Text style={[styles.btnText, { color: COLORS.textSecondary }]}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) return null;

  // On web, react-native-webview is a no-op iframe; instead open
  // a tiny inline checkout div directly so desktop browsers work.
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={goBack} title="Secure Payment" />
        <View style={[styles.centered, { paddingHorizontal: 20 }]}>
          <Text style={styles.h3}>Pay ₹{order.amount_inr.toFixed(2)}</Text>
          <Text style={styles.muted}>{order.description}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => openRazorpayWeb(order, params, router)}
            testID="pay-launch-web"
          >
            <Text style={styles.btnText}>Open Razorpay Checkout</Text>
          </TouchableOpacity>
          {order.mode === 'test' ? (
            <Text style={[styles.muted, { marginTop: 14 }]}>Test mode — use card 4111 1111 1111 1111</Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar onBack={goBack} title="Secure Payment" />
      <View style={{ flex: 1 }}>
        <WebView
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://checkout.razorpay.com' }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(req) => {
            // Allow razorpay urls + intent: schemes (UPI app handoff)
            if (req.url.startsWith('upi://') || req.url.startsWith('intent://')) {
              Linking.openURL(req.url).catch(() => {});
              return false;
            }
            return true;
          }}
          mixedContentMode="always"
          startInLoadingState
          renderLoading={() => (
            <View style={styles.centered}><ActivityIndicator color={COLORS.primary} /></View>
          )}
        />
        {verifying ? (
          <View style={styles.verifyOverlay}>
            <ActivityIndicator color="#fff" />
            <Text style={{ color: '#fff', marginTop: 10 }}>Verifying payment…</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.bar}>
      <TouchableOpacity onPress={onBack} style={styles.back} testID="pay-back-top">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function openRazorpayWeb(order: CreateOrderResponse, params: any, router: any) {
  // Load script dynamically once, then open checkout
  const launch = () => {
    // @ts-ignore
    const RP = (window as any).Razorpay;
    if (!RP) return;
    const rzp = new RP({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      theme: order.theme,
      handler: async (resp: any) => {
        try {
          const { verifyPayment } = await import('../src/payments/razorpay');
          await verifyPayment({
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
            target_kind: params.target_kind,
            target_id: params.target_id,
          });
          window.alert('Payment successful ✓');
          if (params.returnTo) router.replace(params.returnTo);
          else router.back();
        } catch (e: any) {
          window.alert('Verification failed: ' + (e?.response?.data?.detail || e?.message));
        }
      },
    });
    rzp.open();
  };
  // @ts-ignore
  if ((window as any).Razorpay) {
    launch();
  } else {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = launch;
    document.body.appendChild(s);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 10 },
  h3: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 17 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', fontSize: 13 },
  btn: {
    marginTop: 14,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  verifyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
