/* ═══════════════════════════════════════════════════════════
   routes/news.js — GET /news-sentiment
   ───────────────────────────────────────────────────────────
   1. Fetches latest 20 forex/macro headlines from NewsAPI.org
   2. Runs keyword sentiment scoring on each headline
   3. Returns:
      { bias: { USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF },
        headlines: [ { title, source, url, publishedAt, impact } ] }

   Cache: 30-minute in-memory (news changes often, but we
   don't want to exhaust the 100 req/day free tier limit).
   ═══════════════════════════════════════════════════════════ */

'use strict';

const axios = require('axios');

/* ── Cache ───────────────────────────────────────────────── */
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/* ── Currencies we track ─────────────────────────────────── */
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

/* ══════════════════════════════════════════════════════════
   SENTIMENT RULES
   Each rule: { pattern, scores }
   pattern : RegExp tested against lowercase headline text
   scores  : partial object { USD: +2, JPY: -1, ... }
             Only currencies explicitly listed are adjusted.
   ══════════════════════════════════════════════════════════ */
const RULES = [
  /* ── Fed / USD-specific ─────────────────────────────── */
  {
    pattern: /\bnfp\b.*\bbeat|non.?farm.*\bbeat|jobs.*\bbeat|employment.*\bbeat/i,
    scores:  { USD: +2 }
  },
  {
    pattern: /\bnfp\b.*\bmiss|non.?farm.*\bmiss|jobs.*\bmiss|employment.*\bmiss/i,
    scores:  { USD: -2 }
  },
  {
    pattern: /\bfed\b.*\brate hike|federal reserve.*\bhike|fed hike/i,
    scores:  { USD: +2 }
  },
  {
    pattern: /\bfed\b.*\brate cut|federal reserve.*\bcut|fed cut/i,
    scores:  { USD: -2 }
  },
  {
    pattern: /\bfed\b.*\bhawkish|federal reserve.*\bhawkish/i,
    scores:  { USD: +2 }
  },
  {
    pattern: /\bfed\b.*\bdovish|federal reserve.*\bdovish/i,
    scores:  { USD: -2 }
  },

  /* ── ECB / EUR ──────────────────────────────────────── */
  {
    pattern: /\becb\b.*\brate hike|european central bank.*\bhike|ecb hike/i,
    scores:  { EUR: +2 }
  },
  {
    pattern: /\becb\b.*\brate cut|european central bank.*\bcut|ecb cut/i,
    scores:  { EUR: -2 }
  },
  {
    pattern: /\becb\b.*\bhawkish/i,
    scores:  { EUR: +2 }
  },
  {
    pattern: /\becb\b.*\bdovish/i,
    scores:  { EUR: -2 }
  },

  /* ── BOE / GBP ──────────────────────────────────────── */
  {
    pattern: /\bboe\b.*\bhike|bank of england.*\bhike/i,
    scores:  { GBP: +2 }
  },
  {
    pattern: /\bboe\b.*\bcut|bank of england.*\bcut/i,
    scores:  { GBP: -2 }
  },
  {
    pattern: /\bboe\b.*\bhawkish|bank of england.*\bhawkish/i,
    scores:  { GBP: +2 }
  },
  {
    pattern: /\bboe\b.*\bdovish|bank of england.*\bdovish/i,
    scores:  { GBP: -2 }
  },

  /* ── BOJ / JPY ──────────────────────────────────────── */
  {
    pattern: /\bboj\b.*\bhike|bank of japan.*\bhike/i,
    scores:  { JPY: +2 }
  },
  {
    pattern: /\bboj\b.*\bcut|bank of japan.*\bcut/i,
    scores:  { JPY: -2 }
  },
  {
    pattern: /\bboj\b.*\bhawkish|bank of japan.*\bhawkish/i,
    scores:  { JPY: +2 }
  },
  {
    pattern: /\bboj\b.*\bdovish|bank of japan.*\bdovish/i,
    scores:  { JPY: -2 }
  },

  /* ── RBA / AUD ──────────────────────────────────────── */
  {
    pattern: /\brba\b.*\bhike|reserve bank of australia.*\bhike/i,
    scores:  { AUD: +2 }
  },
  {
    pattern: /\brba\b.*\bcut|reserve bank of australia.*\bcut/i,
    scores:  { AUD: -2 }
  },

  /* ── RBNZ / NZD ─────────────────────────────────────── */
  {
    pattern: /\brbnz\b.*\bhike|reserve bank of new zealand.*\bhike/i,
    scores:  { NZD: +2 }
  },
  {
    pattern: /\brbnz\b.*\bcut|reserve bank of new zealand.*\bcut/i,
    scores:  { NZD: -2 }
  },

  /* ── BOC / CAD ──────────────────────────────────────── */
  {
    pattern: /\bboc\b.*\bhike|bank of canada.*\bhike/i,
    scores:  { CAD: +2 }
  },
  {
    pattern: /\bboc\b.*\bcut|bank of canada.*\bcut/i,
    scores:  { CAD: -2 }
  },

  /* ── SNB / CHF ──────────────────────────────────────── */
  {
    pattern: /\bsnb\b.*\bhike|swiss national bank.*\bhike/i,
    scores:  { CHF: +2 }
  },
  {
    pattern: /\bsnb\b.*\bcut|swiss national bank.*\bcut/i,
    scores:  { CHF: -2 }
  },

  /* ── Generic: rate hike / hawkish (multi-currency signal) */
  {
    pattern: /\brate hike\b|\bhawkish\b/i,
    scores:  { USD: +1, GBP: +1, AUD: +1 }   // general risk-on for carry
  },
  {
    pattern: /\brate cut\b|\bdovish\b/i,
    scores:  { USD: -1, GBP: -1, AUD: -1 }
  },

  /* ── CPI / Inflation ────────────────────────────────── */
  {
    pattern: /\brising inflation|\binflation surges|\bcpi rises|\bcpi beats/i,
    scores:  { USD: +1 }   // US context assumed unless central bank named
  },
  {
    pattern: /\binflation falls|\bcpi misses|\bdeflation/i,
    scores:  { USD: -1 }
  },

  /* ── Recession / risk-off ───────────────────────────── */
  {
    pattern: /\brecession\b|\brecession fears|\bglobal slowdown/i,
    scores:  { JPY: +2, CHF: +2, AUD: -2, NZD: -2 }
  },

  /* ── Risk-on ────────────────────────────────────────── */
  {
    pattern: /\brisk.on\b|\bstrong growth|\beconomic expansion/i,
    scores:  { AUD: +1, NZD: +1, JPY: -1, CHF: -1 }
  },

  /* ── Risk-off (explicit) ────────────────────────────── */
  {
    pattern: /\brisk.off\b|\bsafe haven demand|\bflight to safety/i,
    scores:  { JPY: +2, CHF: +2, AUD: -1, NZD: -1 }
  }
];

/* ── Impact level based on score magnitude ───────────────── */
function impactLevel(totalScore) {
  const abs = Math.abs(totalScore);
  if (abs >= 4) return 'high';
  if (abs >= 2) return 'medium';
  return 'low';
}

/* ── Score a single headline ─────────────────────────────── */
function scoreHeadline(title) {
  const lower  = title.toLowerCase();
  const scores = Object.fromEntries(CURRENCIES.map(c => [c, 0]));
  let total = 0;

  for (const rule of RULES) {
    if (rule.pattern.test(lower)) {
      for (const [cur, delta] of Object.entries(rule.scores)) {
        scores[cur] = (scores[cur] || 0) + delta;
        total += delta;
      }
    }
  }

  return { scores, total };
}

/* ── Route handler ───────────────────────────────────────── */
module.exports = async function newsSentiment(_req, res) {
  /* ── Serve from cache if fresh ──────────────────────────── */
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) {
    return res.json({ ..._cache, cached: true });
  }

  const newsKey = process.env.NEWS_API_KEY;
  if (!newsKey) {
    return res.status(500).json({ success: false, error: 'NEWS_API_KEY not configured.' });
  }

  /* ── Fetch from NewsAPI ─────────────────────────────────── */
  let articles = [];
  try {
    const query = 'Fed OR ECB OR inflation OR CPI OR "rate hike" OR NFP OR forex OR "rate cut" OR hawkish OR dovish';
    const url   = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${newsKey}`;

    const { data } = await axios.get(url, { timeout: 10_000 });
    articles = data?.articles || [];
  } catch (err) {
    console.error('[news] NewsAPI error:', err.message);
    return res.status(502).json({ success: false, error: `NewsAPI error: ${err.message}` });
  }

  /* ── Score + build response ─────────────────────────────── */
  const bias     = Object.fromEntries(CURRENCIES.map(c => [c, 0]));
  const headlines = [];

  for (const art of articles) {
    if (!art.title || art.title === '[Removed]') continue;

    const { scores, total } = scoreHeadline(art.title);

    // Accumulate into global bias
    for (const [cur, delta] of Object.entries(scores)) {
      bias[cur] += delta;
    }

    headlines.push({
      title:       art.title,
      source:      art.source?.name || 'Unknown',
      url:         art.url,
      publishedAt: art.publishedAt,
      impact:      impactLevel(total)
    });
  }

  const result = {
    bias,
    headlines,
    scoredAt: new Date().toISOString(),
    count:    headlines.length
  };

  _cache     = result;
  _cacheTime = Date.now();

  return res.json({ ...result, cached: false });
};
