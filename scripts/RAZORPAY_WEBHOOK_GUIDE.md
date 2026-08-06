# Razorpay Webhook Setup — Step-by-Step

The webhook lets Razorpay tell us when a payment succeeds, fails, or
is refunded — **without** the user having to keep the app open. Set
it up once; reliability of all your refund / failed-payment tracking
depends on it.

> Time required: **3 minutes**.

---

## Step 1 — Open Razorpay Webhooks

1. Sign in at <https://dashboard.razorpay.com/>.
2. Make sure you're in the **mode that matches your keys**:
   - Top-right toggle says **Test Mode** → set up the Test webhook.
   - Same for Live Mode after activation.
3. Side nav → **Account & Settings → Webhooks**.
4. Click **+ Add New Webhook**.

---

## Step 2 — Webhook URL

Paste this URL exactly (replace the host with your production
deployment once live — for now the preview is fine):

```
https://urology-pro.preview.emergentagent.com/api/payments/razorpay/webhook
```

> **Important**: Razorpay validates this URL is reachable when you
> save. If you've just deployed to a new domain, give DNS a couple
> of minutes before saving.

---

## Step 3 — Pick events

Tick **these four**:

| Event | Why we need it |
|---|---|
| `payment.captured` | Most-important — confirms the patient's money landed. |
| `payment.failed` | We mark the booking as `payment_failed` so the team can follow up. |
| `refund.processed` | Records that a refund has been issued to the patient's card. |
| `order.paid` | Belt-and-braces: even if `payment.captured` is delayed, this fires when an order is fully paid. |

Leave the rest unticked — they're noise for our use-case.

---

## Step 4 — Generate & copy the Secret

1. Razorpay shows a field called **"Secret"** — type a strong random
   string (16+ chars) OR tap **Generate Random**. Click **Save**.
2. The Webhook list now shows your new webhook with a **"Reveal Secret"**
   button. Tap it.
3. Copy the full string (looks like `whsec_XXXXXXXXXXXXXXXX...`).

---

## Step 5 — Paste back to the agent

Reply with **exactly this line**:

```
RAZORPAY_WEBHOOK_SECRET=whsec_XXXXXXXXXXXXXXXX...
```

The agent will:

1. Add it to `/app/backend/.env` (never committed to git).
2. Restart the backend — the `/api/payments/razorpay/webhook` endpoint
   immediately starts verifying signatures.
3. Fire a test event from Razorpay Dashboard → your webhook →
   **"Send test event"** → pick `payment.captured` → tap **Test** →
   confirm a green **200 OK** appears in the delivery log.

---

## Verification

After the secret is plugged in:

1. Razorpay Dashboard → Webhooks → your webhook → **Recent Deliveries**.
2. Run a test transaction (use the Test card `4111 1111 1111 1111`).
3. Within 5 seconds you should see a row:

   ```
   payment.captured | 200 OK | 87 ms
   ```

4. If you see a 4xx/5xx, tap the row to view the response body. Most
   common failures:
   - `401 invalid signature` → secret mismatch. Reveal again in
     Razorpay and re-send to the agent.
   - `503 webhook secret not configured` → backend `.env` wasn't
     restarted. `sudo supervisorctl restart backend` fixes it.
   - `404` → wrong path. The URL must end with
     `/api/payments/razorpay/webhook` (singular `/webhook`, not
     `/webhooks`).

---

## Why we don't use polling

Razorpay's webhook is push-only. Polling would either:
- Hit their rate limit (5 reqs/sec, then 429s)
- Or lag actual capture by minutes.

A webhook tells us **immediately**, lets us send the confirmation
push within 2 seconds, and gives the patient a reliable "Paid"
status on their booking card.

---

## After live activation

When you switch from Test to Live mode keys (see
`/app/scripts/RAZORPAY_SETUP_GUIDE.md`):

1. Redo Step 1 above in **Live Mode**.
2. Paste a **DIFFERENT** secret (don't reuse the Test one — security).
3. Reply with both lines so the agent can branch:

   ```
   RAZORPAY_WEBHOOK_SECRET_TEST=whsec_test_...
   RAZORPAY_WEBHOOK_SECRET=whsec_live_...
   ```

   (only `RAZORPAY_WEBHOOK_SECRET` is read by the code today — the
   `_TEST` line is just for your records.)
