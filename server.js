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
