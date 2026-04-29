/* ═══════════════════════════════════════════════════════════
   routes/macro.js — GET /macro-data
   ───────────────────────────────────────────────────────────
   Returns CPI + interest rate data for 8 major currencies.

   Live data  : USD only → FRED API (free key, no auth wall)
                CPIAUCSL → US CPI (monthly, last value)
                FEDFUNDS  → Fed Funds Rate (monthly, last value)

   Fallback data : EUR/GBP/JPY/AUD/NZD/CAD/CHF
                → Hardcoded object at bottom of this file.
                → Update MANUAL_DATA weekly — takes 30 seconds.

   Cache: 6 hours in-memory so we don't hammer FRED on every
   frontend refresh. Render free tier has no Redis, so memory
   cache is fine.
   ═══════════════════════════════════════════════════════════ */

'use strict';

const axios = require('axios');

/* ── In-memory cache ─────────────────────────────────────── */
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/* ── FRED series IDs ─────────────────────────────────────── */
const FRED_BASE  = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_CPI   = 'CPIAUCSL';   // US CPI (all items, seasonally adjusted)
const FRED_RATE  = 'FEDFUNDS';   // Effective Fed Funds Rate

/* ══════════════════════════════════════════════════════════
   MANUAL FALLBACK DATA — UPDATE THIS WEEKLY
   Sources to check (all free):
     EUR CPI  → eurostat.ec.europa.eu (Flash estimate)
     GBP CPI  → ons.gov.uk
     JPY CPI  → stat.go.jp
     AUD CPI  → abs.gov.au  (quarterly)
     NZD CPI  → stats.govt.nz (quarterly)
     CAD CPI  → statcan.gc.ca
     CHF CPI  → bfs.admin.ch
     Rates    → central bank websites
   cpiTrend: "rising" | "falling" | "stable"
   ══════════════════════════════════════════════════════════ */
const MANUAL_DATA = {
  EUR: { cpi: 2.2, cpiTrend: 'falling', rate: 2.40 },
  GBP: { cpi: 2.6, cpiTrend: 'falling', rate: 4.50 },
  JPY: { cpi: 3.6, cpiTrend: 'rising',  rate: 0.50 },
  AUD: { cpi: 2.4, cpiTrend: 'falling', rate: 4.10 },
  NZD: { cpi: 2.2, cpiTrend: 'falling', rate: 3.75 },
  CAD: { cpi: 2.3, cpiTrend: 'stable',  rate: 2.75 },
  CHF: { cpi: 0.3, cpiTrend: 'falling', rate: 0.25 }
};

/* ── FRED fetch helper ───────────────────────────────────── */
async function fredLatest(seriesId, apiKey) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
  const { data } = await axios.get(url, { timeout: 8_000 });
  const obs = data?.observations?.[0];
  if (!obs || obs.value === '.') throw new Error(`No data for ${seriesId}`);
  return parseFloat(obs.value);
}

/* ── Route handler ───────────────────────────────────────── */
module.exports = async function macroData(_req, res) {
  /* ── Serve from cache if fresh ──────────────────────────── */
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return res.json({ ..._cache, cached: true });
  }

  const fredKey = process.env.FRED_API_KEY;
  let usdCpi  = null;
  let usdRate = null;
  let usdSource = 'hardcoded';

  /* ── Attempt live FRED fetch for USD ───────────────────── */
  if (fredKey) {
    try {
      [usdCpi, usdRate] = await Promise.all([
        fredLatest(FRED_CPI,  fredKey),
        fredLatest(FRED_RATE, fredKey)
      ]);
      usdSource = 'fred-live';
      console.log(`[macro] FRED USD → CPI: ${usdCpi} | Rate: ${usdRate}`);
    } catch (err) {
      console.warn('[macro] FRED fetch failed, using hardcoded USD:', err.message);
    }
  } else {
    console.warn('[macro] FRED_API_KEY not set — using hardcoded USD values.');
  }

  /* ── USD fallback values (update alongside MANUAL_DATA) ── */
  const USD = {
    cpi:      usdCpi  ?? 2.4,
    cpiTrend: usdCpi  ? deriveTrend(usdCpi,  2.4) : 'stable',
    rate:     usdRate ?? 4.33,
    source:   usdSource
  };

  /* ── Assemble full response ─────────────────────────────── */
  const result = {
    USD,
    ...Object.fromEntries(
      Object.entries(MANUAL_DATA).map(([cur, d]) => [cur, { ...d, source: 'manual' }])
    ),
    updatedAt: new Date().toISOString()
  };

  /* ── Cache + return ─────────────────────────────────────── */
  _cache     = result;
  _cacheTime = Date.now();

  return res.json({ ...result, cached: false });
};

/* ── Simple trend helper ─────────────────────────────────── */
function deriveTrend(current, baseline) {
  if (current > baseline + 0.2) return 'rising';
  if (current < baseline - 0.2) return 'falling';
  return 'stable';
}
