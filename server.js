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
    routes:  ['/verify-payment', '/macro-data', '/news-sentiment', '/ai-summary']
  });
});

/* ─── ROUTES ──────────────────────────────────────────────── */
app.post('/verify-payment', paymentRoute);
app.get('/macro-data',      macroRoute);
app.get('/news-sentiment',  newsRoute);

/* ─── AI SUMMARY ──────────────────────────────────────────── */
app.post('/ai-summary', async (req, res) => {
  try {
    const { rankings, globalRisk } = req.body;

    if (!rankings || !Array.isArray(rankings)) {
      return res.status(400).json({ error: 'rankings array required' });
    }

    const rankText = rankings.map((r, i) => {
      const sign = r.score > 0 ? '+' : '';
      const bias = r.score > 1 ? 'Bullish' : r.score < -1 ? 'Bearish' : 'Neutral';
      return `${i + 1}. ${r.currency}: score ${sign}${r.score} (${bias})`;
    }).join('\n');

    const prompt = `You are a senior forex analyst. Based on the following currency strength scores from a fundamentals-based scoring engine, write a concise 3–4 sentence weekly bias summary. Speak like a professional analyst, not a chatbot. Do not use bullet points. Be direct about which currencies to buy and which to sell.

Global Risk Sentiment: ${globalRisk || 'not set'}

Currency Rankings (strongest to weakest):
${rankText}

Write the bias summary now:`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[TES backend] Gemini error:', geminiRes.status, errText);
      return res.status(502).json({ error: 'Gemini API error', detail: errText });
    }

    const geminiData = await geminiRes.json();
    const summary = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Unable to generate summary at this time.';

    return res.json({ summary });

  } catch (err) {
    console.error('[TES backend] /ai-summary error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
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
