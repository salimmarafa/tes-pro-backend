/* ═══════════════════════════════════════════════════════════
   routes/payment.js — POST /verify-payment
   ───────────────────────────────────────────────────────────
   Receives  : { reference, plan }
   Calls     : Paystack GET /transaction/verify/:reference
   Returns   : { success, plan, expiresAt }  or  { success: false, error }

   Price table (kobo = NGN × 100):
     monthly → NGN 21,000 → 2,100,000 kobo
     annual  → NGN 168,000 → 16,800,000 kobo

   Tolerance: ±5 % to absorb Paystack rounding on some cards.
   ═══════════════════════════════════════════════════════════ */

'use strict';

const axios = require('axios');

/* ── Plan prices in kobo ──────────────────────────────────── */
const PLAN_KOBO = {
  monthly: 2_100_000,   // NGN 21,000
  annual:  16_800_000   // NGN 168,000
};

/* ── Subscription durations in ms ────────────────────────── */
const SUB_MS = {
  monthly: 30  * 24 * 60 * 60 * 1000,
  annual:  365 * 24 * 60 * 60 * 1000
};

/* ── 5 % tolerance for rounding / FX variation ───────────── */
const TOLERANCE = 0.05;

function amountMatches(expected, received) {
  const low  = expected * (1 - TOLERANCE);
  const high = expected * (1 + TOLERANCE);
  return received >= low && received <= high;
}

/* ── Route handler ───────────────────────────────────────── */
module.exports = async function verifyPayment(req, res) {
  const { reference, plan } = req.body || {};

  /* ── Input validation ──────────────────────────────────── */
  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing or invalid reference.' });
  }
  if (!plan || !PLAN_KOBO[plan]) {
    return res.status(400).json({ success: false, error: 'Invalid plan. Must be "monthly" or "annual".' });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error('[payment] PAYSTACK_SECRET_KEY not set in .env');
    return res.status(500).json({ success: false, error: 'Server configuration error.' });
  }

  /* ── Call Paystack ─────────────────────────────────────── */
  let paystackData;
  try {
    const { data } = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        timeout: 10_000
      }
    );
    paystackData = data;
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('[payment] Paystack API error:', msg);
    return res.status(502).json({ success: false, error: `Paystack error: ${msg}` });
  }

  /* ── Verify status ─────────────────────────────────────── */
  if (!paystackData.status || paystackData.data?.status !== 'success') {
    console.warn('[payment] Transaction not successful:', reference);
    return res.json({ success: false, error: 'Transaction not successful.' });
  }

  /* ── Verify amount ─────────────────────────────────────── */
  const paidKobo   = paystackData.data.amount;        // Paystack returns kobo
  const expectedKobo = PLAN_KOBO[plan];

  if (!amountMatches(expectedKobo, paidKobo)) {
    console.warn(
      `[payment] Amount mismatch: expected ~${expectedKobo} kobo, got ${paidKobo} kobo | ref: ${reference}`
    );
    return res.json({ success: false, error: 'Amount does not match plan price.' });
  }

  /* ── All checks passed → return grant ─────────────────── */
  const expiresAt = Date.now() + SUB_MS[plan];

  console.log(
    `[payment] ✓ Verified | ref: ${reference} | plan: ${plan} | paid: ${paidKobo} kobo | expires: ${new Date(expiresAt).toISOString()}`
  );

  return res.json({
    success:   true,
    plan,
    expiresAt,                            // Unix ms — store in localStorage
    paidKobo,                             // For your own records
    verifiedAt: new Date().toISOString()
  });
};
