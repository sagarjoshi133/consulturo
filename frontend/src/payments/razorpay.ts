/**
 * Razorpay helpers — thin API layer over the FastAPI backend.
 *
 * The WebView-based Razorpay Standard Checkout flow is used because
 * `react-native-razorpay` requires native modules that aren't available
 * inside Expo Go. The flow:
 *   1. Frontend calls `createOrder({amount, target_kind, target_id})`.
 *   2. Backend creates a Razorpay order + persists the payment row,
 *      returns key_id + order_id + prefill.
 *   3. Frontend opens /pay/[orderId] which mounts a WebView running
 *      the Razorpay JS SDK against that order.
 *   4. On success the WebView posts the signed payload back; we call
 *      `verifyPayment(...)` which validates HMAC and marks paid.
 *
 * If the backend reports `enabled: false` we surface a friendly
 * "activation pending" message rather than crashing.
 */
import api from '../api';

export type RazorpayConfig = {
  enabled: boolean;
  mode: 'test' | 'live';
  key_id: string;
  supports: string[];
  currency: string;
};

export type CreateOrderRequest = {
  amount_inr: number;
  target_kind: 'consultation' | 'ipd' | 'receipt' | 'rx' | 'other';
  target_id?: string;
  description?: string;
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  notes?: Record<string, any>;
};

export type CreateOrderResponse = {
  ok: boolean;
  local_id: string;
  order_id: string;
  amount: number; // paise
  amount_inr: number;
  currency: string;
  key_id: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  mode: 'test' | 'live';
};

export type VerifyRequest = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  target_kind?: string;
  target_id?: string;
};

export async function fetchRazorpayConfig(): Promise<RazorpayConfig> {
  const { data } = await api.get('/payments/razorpay/config');
  return data;
}

export async function createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
  const { data } = await api.post('/payments/razorpay/order', req);
  return data;
}

export async function verifyPayment(req: VerifyRequest): Promise<{ ok: boolean; local_id?: string }> {
  const { data } = await api.post('/payments/razorpay/verify', req);
  return data;
}

export async function listMyPayments() {
  const { data } = await api.get('/payments/razorpay/list');
  return data;
}

/**
 * Build the HTML page that the WebView will render to drive Razorpay
 * Standard Checkout. Keeping it as a string (rather than a hosted page)
 * means we don't need to deploy a tiny static site just for checkout.
 * Result events are POSTed back via window.ReactNativeWebView.postMessage.
 */
export function buildCheckoutHtml(opts: {
  keyId: string;
  orderId: string;
  amount: number; // paise
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  themeColor?: string;
}): string {
  const safe = (s: string) => String(s || '').replace(/[<>"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>ConsultUro · Pay</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
  html,body{margin:0;padding:0;height:100%;background:#0E7C8B;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;text-align:center;padding:20px}
  .spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:s 1s linear infinite;margin-bottom:18px}
  @keyframes s{to{transform:rotate(360deg)}}
  .h{font-size:18px;font-weight:700;margin-bottom:6px}
  .s{font-size:13px;opacity:.85}
</style>
</head>
<body>
<div class="wrap">
  <div class="spinner"></div>
  <div class="h">Opening secure payment…</div>
  <div class="s">Powered by Razorpay</div>
</div>
<script>
  function post(msg){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e){} }
  function launch(){
    if (!window.Razorpay) { setTimeout(launch, 200); return; }
    var rzp = new window.Razorpay({
      key: "${safe(opts.keyId)}",
      order_id: "${safe(opts.orderId)}",
      amount: ${Number(opts.amount) || 0},
      currency: "${safe(opts.currency)}",
      name: "${safe(opts.name)}",
      description: "${safe(opts.description)}",
      image: "https://urology-pro.preview.emergentagent.com/icon.png",
      prefill: {
        name: "${safe(opts.prefill.name)}",
        email: "${safe(opts.prefill.email)}",
        contact: "${safe(opts.prefill.contact)}"
      },
      theme: { color: "${safe(opts.themeColor || '#0E7C8B')}" },
      modal: {
        ondismiss: function(){ post({ type: 'dismiss' }); }
      },
      handler: function(resp){
        post({ type: 'success', data: resp });
      }
    });
    rzp.on('payment.failed', function(resp){ post({ type: 'failed', data: resp.error || resp }); });
    rzp.open();
  }
  window.addEventListener('load', launch);
</script>
</body>
</html>`;
}
