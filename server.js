/* ═══════════════════════════════════════════════════════════
   server.js — TES Pro Backend
   Routes: /verify-payment  /macro-data  /news-sentiment  /ai-summary
   ═══════════════════════════════════════════════════════════ */

'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');  // ← declared ONCE here only

const paymentRoute = require('./routes/payment');
const macroRoute   = require('./routes/macro');
const newsRoute    = require('./routes/news');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ─── CORS ────────────────────────────────────────────────────
   Allow your GitHub Pages domain (and localhost for dev).
   Edit ALLOWED_ORIGINS in .env to add / change domains.
   ─────────────────────────────────────────────────────────── */
const RAW_ORIGINS = process.env.ALLOWED_ORIGINS || '';
const ALLOWED = RAW_ORIGINS
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000'
];

const ALL_ORIGINS = [...new Set([...ALLOWED, ...DEV_ORIGINS])];

// Single cors() call with full config — no duplicate app.use(cors())
app.use(cors({
 origin: (origin, cb) => {
    if (!origin || origin === 'null') return cb(null, true);
    if (ALL_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: Origin not allowed → ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

/* ─── HEALTH CHECK ────────────────────────────────────────── */
app.get('/', (_req, res) => {
  res.json({
    service: 'TES Pro Backend',
    status:  'online',
    version: '1.0.0',
  routes:  ['/verify-payment', '/macro-data', '/news-sentiment'] 
  });
});

/* ─── ROUTES ──────────────────────────────────────────────── */
app.post('/verify-payment', paymentRoute);
app.get('/macro-data',      macroRoute);
app.get('/news-sentiment',  newsRoute);

/* ─── LIVE PRICES ─────────────────────────────────────────── */
app.get('/price', async (req, res) => {
  try {
    const pairs  = ['XAU/USD','GBP/USD','EUR/USD','USD/JPY','GBP/JPY','AUD/USD','USD/CAD','NZD/USD','USD/CHF','EUR/JPY'];
    const symbol = pairs.join(',');
    const url    = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_KEY}`;
    const r      = await fetch(url);
    if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
    const data   = await r.json();
    // Also fetch % change
    const url2   = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${process.env.TWELVE_DATA_KEY}`;
    const r2     = await fetch(url2);
    const data2  = await r2.json();
    // Merge price + percent_change
    const merged = {};
    pairs.forEach(p => {
      const priceVal  = data[p]?.price  || data[p] || null;
      const changeVal = data2[p]?.percent_change || 0;
      if (priceVal) merged[p] = { price: priceVal, percent_change: changeVal };
    });
    res.json(merged);
  } catch (err) {
    console.error('[TES] /price error:', err.message);
    res.status(502).json({ error: 'Price fetch failed', detail: err.message });
  }
});

/* ─── ECONOMIC CALENDAR ────────────────────────────────────── */
app.get('/calendar', async (req, res) => {
  try {
    // Get next 7 days of events for the 8 major currencies
    const currencies = 'USD,EUR,GBP,JPY,AUD,NZD,CAD,CHF';
    const url = `https://api.twelvedata.com/economic_calendar?currency=${currencies}&apikey=${process.env.TWELVE_DATA_KEY}`;
    const r   = await fetch(url);
    if (!r.ok) throw new Error('Twelve Data HTTP ' + r.status);
    const data = await r.json();
    // Normalise the events array
    const events = (data.result || data.data || data || []).map(ev => ({
      event:    ev.event || ev.name || ev.title || '',
      currency: ev.currency || ev.country || '',
      datetime: ev.date || ev.datetime || ev.time || '',
      impact:   (ev.importance || ev.impact || 'low').toLowerCase().replace('high','high').replace('medium','medium').replace('low','low'),
      forecast: ev.forecast || ev.estimate || '',
      previous: ev.previous || ev.prev || ''
    }));
    // Sort by datetime ascending
    events.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    res.json(events);
  } catch (err) {
    console.error('[TES] /calendar error:', err.message);
    res.status(502).json({ error: 'Calendar fetch failed', detail: err.message });
  }
});

/* ─── AI SUMMARY ──────────────────────────────────────────── */
app.post('/ai-summary', (_req, res) => {
  res.status(503).json({ error: 'AI summary temporarily unavailable.' });
});

/* ─── GLOBAL ERROR HANDLER ───────────────────────────────── */
app.use((err, _req, res, _next) => {
  console.error('[TES ERROR]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

/* ─── START ───────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`[TES] Backend running on port ${PORT}`);
  console.log(`[TES] Allowed origins: ${ALL_ORIGINS.join(', ')}`);
});