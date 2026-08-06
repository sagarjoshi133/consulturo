# Razorpay Payment Gateway — Setup Guide for ConsultUro

This is the **step-by-step path from "registration done" to "live UPI
collection"**. The scaffold (backend order-create + frontend checkout)
is already in place; you only need to plug in your Razorpay keys and
activate the account.

> Estimated time: **~45 minutes** if your KYC documents are ready.
> Plus 24–48 hours of waiting on Razorpay's compliance review for
> live-mode activation.

---

## Step 0 — Where you stand right now

| Status | What's done | What's pending |
|---|---|---|
| ✅ | Razorpay account created (Registration done) | – |
| ⏳ | KYC + Activation form submission | YOU need to finish this |
| ⏳ | Test-mode keys plugged into the app | YOU paste keys, AGENT wires them |
| ⏳ | Live-mode keys + production switch-over | After Razorpay activates you |

Until activation, you can still **test the entire flow** using
Razorpay's **Test Mode** keys — they accept the magic card
`4111 1111 1111 1111` + any future date + any CVV. No real money moves.

---

## Step 1 — Finish the KYC / Activation form (one-time)

1. Sign in to <https://dashboard.razorpay.com/>.
2. You'll see a yellow banner: **"Complete account activation"**. Tap it.
3. Razorpay walks you through 4 short sections:

   | Section | What they want |
   |---|---|
   | **Business details** | Legal name (Dr. Sagar Joshi / your clinic LLP/Pvt Ltd name), business type (Proprietorship / Pvt Ltd / LLP), business category → choose **Healthcare → Hospitals / Clinics**. |
   | **Contact details** | Mobile, email, registered address (must match the address on your business proof). |
   | **Bank account** | The current account where settlements land. **Use the clinic's current account, not a personal savings** — RBI rules require business funds → business account. |
   | **Documents** | PAN of business + GSTIN (if registered) + cancelled cheque or bank statement + ID proof (Aadhaar/Passport) + business proof (GST cert / Udyam / incorporation cert). |

4. Submit. Razorpay shows **"Under review"** for 1–2 business days.
   You'll get an email titled *"You're activated"* when ready.

> **While waiting** you can already integrate using Test Mode — go to
> Step 2 right now.

---

## Step 2 — Generate Test-Mode API keys

1. Razorpay Dashboard → **Settings (gear icon) → API Keys**.
2. Top-right toggle: make sure it says **"Test Mode"** (yellow chip).
3. Tap **"Generate Test Key"**.
4. A modal pops up with TWO strings — **copy BOTH immediately**, you
   only see the secret once:

   ```
   Key ID:     rzp_test_XXXXXXXXXXXXXX
   Key Secret: abc123...veryLongString
   ```

5. Store these in your password manager. Lose the secret = generate a
   new pair (the old one keeps working until you delete it).

---

## Step 3 — Paste keys to the agent

Reply to the agent with **exactly this format** so it can wire them
in one go:

```
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=abc123...veryLongString
RAZORPAY_MODE=test
```

The agent will:

1. Add these to `/app/backend/.env` (NEVER committed to git).
2. Restart the backend so the Razorpay client picks them up.
3. Run a smoke test: create a ₹1 test order → confirm payment in the
   simulated checkout → verify webhook signature → mark booking as
   PAID in MongoDB.

You'll see the green **"Payment gateway: Active (test)"** chip on the
Billing Settings screen.

---

## Step 4 — Run a real test transaction (Test Mode)

1. Open the ConsultUro app → book any appointment.
2. At the payment screen tap **"Pay ₹500"** (or whatever fee you've
   configured).
3. Razorpay checkout opens. Use:
   - **Card**: `4111 1111 1111 1111`
   - **Expiry**: any month/year in the future (e.g., `12/30`)
   - **CVV**: any 3 digits (e.g., `123`)
   - **OTP** (if asked): `1234`
4. You should see "Payment successful" and the booking should show
   **Paid** in the dashboard within ~2 seconds.

> Other test cards (UPI, Netbanking, EMI) are listed at
> <https://razorpay.com/docs/payments/payments/test-card-details/>.

---

## Step 5 — Switch to Live Mode (after Razorpay activates you)

Once Razorpay emails you *"You're activated"*:

1. Dashboard → **API Keys** → toggle the chip to **"Live Mode"**.
2. Generate a Live key pair (same flow as Step 2).
3. Send the agent:

   ```
   RAZORPAY_KEY_ID=rzp_live_YYYYYYYYYYYYYY
   RAZORPAY_KEY_SECRET=xyz789...newLongString
   RAZORPAY_MODE=live
   ```

4. The agent swaps the env vars and restarts. The first live payment
   should be a ₹1 charge to **your own card** so you confirm money
   actually lands in your bank — settlement is T+2 days for the first
   transaction, then T+1.

---

## Step 6 — Set up the Webhook (required for refund-tracking & failures)

1. Razorpay Dashboard → **Settings → Webhooks**.
2. Add Webhook URL:
   ```
   https://app.consulturo.com/api/payments/razorpay/webhook
   ```
   (your production deployed URL — the agent will give you the exact
   path during Step 3).
3. Pick **Active events**:
   - `payment.captured` ✅
   - `payment.failed` ✅
   - `refund.processed` ✅
   - `order.paid` (optional)
4. **Secret** — Razorpay shows a string starting with `whsec_...`.
   Copy it. Reply to the agent with:

   ```
   RAZORPAY_WEBHOOK_SECRET=whsec_XXXXXXXXXXXXXX
   ```

   The backend will reject any webhook whose signature doesn't match.

---

## Step 7 — Refund flow (one-tap)

After payment, if a patient cancels:

1. Bookings → tap the **Paid** chip on the row → **"Refund"**.
2. Choose **Full** or **Partial** → confirm.
3. The backend POSTs `/v1/payments/{id}/refund` to Razorpay and
   surfaces a green toast.

Refunds settle to the patient's source card in 5–7 business days
(beyond your control — that's the issuing bank's timeline).

---

## Pricing — what Razorpay actually charges

As of June 2025:

| Method | Standard fee |
|---|---|
| Domestic Cards (Visa/MC/RuPay) | 2.0 % + GST |
| Netbanking | 2.0 % + GST |
| UPI (any amount) | **0 %** (UPI is free) |
| International cards | 3.0 % + GST |
| EMI | 3.0 % + GST |

> For a clinic the fee usually averages ~0.4–0.8 % because most
> patients pay by UPI. You can confirm exact fees in your Dashboard →
> **Settings → Fees & Pricing**.

---

## Common gotchas

| Symptom | Fix |
|---|---|
| Checkout opens but immediately closes with "Unauthorised" | Wrong key pair — most likely Test secret with Live ID. Re-check `.env`. |
| Webhook fires but our backend returns 400 | Signature mismatch. The `whsec_...` in `.env` must EXACTLY match the value Razorpay shows in Dashboard → Webhooks → that webhook → "Reveal". |
| KYC stuck > 3 days | Email `support@razorpay.com` quoting your Merchant ID (visible on the Dashboard top-bar). Usually unblocks within 24 h. |
| Payments succeed in app but bank account empty | Settlements are T+1 / T+2. Check Dashboard → Settlements → settlement schedule. Until KYC is fully complete Razorpay holds payouts. |
| Test mode shows "this payment is for testing only" overlay | Normal — that's how you know real money isn't moving. The overlay disappears in Live Mode. |

---

## Security checklist

- ☐ Live `RAZORPAY_KEY_SECRET` only exists in `/app/backend/.env` and your password manager — never in chat, email, screenshots, or git.
- ☐ Webhook secret separate from key secret.
- ☐ Razorpay Dashboard login has 2FA enabled.
- ☐ Bank account on Razorpay matches the clinic's GST-registered name.
- ☐ Patient-side checkout shows your clinic name (not "Razorpay") — set under Dashboard → Settings → Branding.

---

## Quick reference — what to send the agent, when

| Stage | Reply with |
|---|---|
| After Step 2 | `RAZORPAY_KEY_ID=rzp_test_...`<br>`RAZORPAY_KEY_SECRET=...`<br>`RAZORPAY_MODE=test` |
| After Step 5 | Same 3 lines but with `rzp_live_...` + `RAZORPAY_MODE=live` |
| After Step 6 | `RAZORPAY_WEBHOOK_SECRET=whsec_...` |

That's it — paste, agent wires, you collect.
