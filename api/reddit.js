// /api/reddit.js — Vercel serverless route (ESM default-export handler)
// Tracks Reddit chatter per stock ticker across r/wallstreetbets, r/stocks,
// r/options, r/pennystocks.
//
// PRIMARY PATH: Reddit official OAuth Data API (client_credentials, app-only).
//   Env vars (set in Vercel → Project → Settings → Environment Variables):
//     REDDIT_CLIENT_ID      — from your registered "script" app (under the app name)
//     REDDIT_CLIENT_SECRET  — the "secret" field of that app
//   Optional:
//     REDDIT_USER_AGENT     — defaults to a descriptive UA; Reddit requires one.
//
// FALLBACK PATH: Arctic Shift archive (arctic-shift.photon-reddit.com) — free, no
//   key, community-maintained Reddit archive with near-current data. Used when no
//   Reddit creds are set or OAuth fails. Its full-text search is flaky, so we list
//   recent posts per subreddit and match the ticker client-side (title/selftext
//   only — comment-only chatter is NOT captured in fallback mode; see `degraded`).
//   (Pushshift proper is moderator-only; pullpush.io's archive froze in May 2025.)
//
// Never invents data: any metric that cannot be obtained renders as "n/a".
// Personal research/awareness tool — not investment advice.

const SUBREDDITS = "wallstreetbets+stocks+options+pennystocks";
const USER_AGENT =
  process.env.REDDIT_USER_AGENT ||
  "personal-research-dashboard/1.0 (by u/your_username; ticker chatter tracker)";

const CACHE_TTL_MS = 10 * 60 * 1000;      // 10 min per response
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000; // refresh token 60s before expiry
const MAX_SYMBOLS = 5;
const MAX_CONCURRENCY = 2;                  // stay well under Reddit's rate limits
const FETCH_TIMEOUT_MS = 9000;

// ---- in-memory cache (per warm lambda instance) ----
const cache = new Map(); // key -> { t, data }
let oauthToken = null;   // { access_token, expiresAt }

// ---- tiny helpers ----
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.data;
  return null;
}
function cacheSet(key, data) {
  if (cache.size > 200) cache.clear();
  cache.set(key, { t: Date.now(), data });
}

async function fetchJson(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, json, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

// Run async tasks with a concurrency cap.
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  async function run() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// ---- OAuth (client credentials / app-only) ----
async function getToken() {
  if (oauthToken && Date.now() < oauthToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
    return oauthToken.access_token;
  }
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  const r = await fetchJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (r.status === 200 && r.json?.access_token) {
    oauthToken = {
      access_token: r.json.access_token,
      expiresAt: Date.now() + (r.json.expires_in || 3600) * 1000,
    };
    return oauthToken.access_token;
  }
  const err = new Error(`token request failed: HTTP ${r.status}`);
  err.status = r.status;
  throw err;
}

// ---- data source 1: official OAuth search ----
// One request per ticker: newest 100 matches. We do NOT rely on the `t` param
// (Reddit only honors `t` with sort=top; it's ignored with sort=new) — instead
// we bucket by created_utc ourselves for the 24h and 7d windows.
async function oauthSearch(token, symbol) {
  const url =
    `https://oauth.reddit.com/r/${SUBREDDITS}/search` +
    `?q=${encodeURIComponent(symbol)}&restrict_sr=1&sort=new` +
    `&limit=100&raw_json=1`;
  const r = await fetchJson(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
  });
  if (r.status === 429) { const e = new Error("rate limited"); e.status = 429; throw e; }
  if (r.status !== 200 || !r.json?.data?.children) {
    const e = new Error(`search failed: HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return r.json.data.children
    .map((c) => c?.data)
    .filter(Boolean)
    .map(normalizeRedditPost);
}

// ---- data source 2: Arctic Shift archive fallback ----
// Lists recent posts per subreddit and matches the ticker client-side because
// Arctic Shift's full-text `query` param is currently unreliable (500s).
async function arcticSearch(symbol, afterEpochSec) {
  const tickerRe = new RegExp(
    `(^|[^A-Za-z0-9])\\$?${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i"
  );
  const subs = SUBREDDITS.split("+");
  const results = await pool(subs, 2, async (sub) => {
    const url =
      `https://arctic-shift.photon-reddit.com/api/posts/search` +
      `?subreddit=${sub}&after=${afterEpochSec}&limit=100&sort=desc`;
    const r = await fetchJson(url, { headers: { "User-Agent": USER_AGENT } }, 15000);
    if (r.status !== 200 || !Array.isArray(r.json?.data)) return [];
    return r.json.data;
  });
  const all = results.flat();
  if (all.length === 0) throw new Error("arctic-shift fallback returned no data");
  return all
    .filter((p) => tickerRe.test(`${p.title || ""} ${p.selftext || ""}`))
    .map((p) =>
      normalizeRedditPost({
        title: p.title,
        selftext: p.selftext,
        subreddit: p.subreddit,
        author: p.author,
        score: typeof p.score === "number" ? p.score : null,
        num_comments: typeof p.num_comments === "number" ? p.num_comments : null,
        created_utc: p.created_utc,
        permalink: p.permalink,
        upvote_ratio: typeof p.upvote_ratio === "number" ? p.upvote_ratio : null,
      })
    );
}

function normalizeRedditPost(p) {
  return {
    title: p.title ?? null,
    selftext: typeof p.selftext === "string" ? p.selftext.slice(0, 500) : null,
    subreddit: p.subreddit ?? null,
    author: p.author ?? null, // kept for Reddit ToS attribution requirements
    score: typeof p.score === "number" ? p.score : null,
    numComments: typeof p.num_comments === "number" ? p.num_comments : null,
    createdUtc: typeof p.created_utc === "number" ? p.created_utc : null,
    upvoteRatio: typeof p.upvote_ratio === "number" ? p.upvote_ratio : null,
    url: p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url ?? null),
  };
}

// ---- crude bullish/bearish lean from post titles ----
const BULL = [/\bcalls?\b/i, /\bbull/i, /\bmoon/i, /\bbuy(ing)?\b/i, /\blong\b/i, /\brocket/i, /🚀/, /\bgain(s)?\b/i, /\bupgrade/i, /\bbreakout/i, /\bbeat(s|en)?\b/i];
const BEAR = [/\bputs?\b/i, /\bbear/i, /\bcrash/i, /\bsell(ing)?\b/i, /\bshort(s|ing)?\b/i, /\bdump/i, /\btank/i, /\bdowngrade/i, /\bmiss(es|ed)?\b/i, /\bloss(es)?\b/i, /📉/];
function sentimentOf(posts) {
  let bull = 0, bear = 0;
  for (const p of posts) {
    const text = `${p.title || ""} ${p.selftext || ""}`;
    const b = BULL.some((re) => re.test(text));
    const s = BEAR.some((re) => re.test(text));
    if (b && !s) bull++;
    else if (s && !b) bear++;
  }
  const total = bull + bear;
  if (total === 0) return "n/a";
  const lean = bull / total;
  if (lean >= 0.65) return "bullish";
  if (lean <= 0.35) return "bearish";
  return "mixed";
}

// ---- per-ticker pipeline ----
async function analyzeTicker(symbolRaw, token) {
  const symbol = symbolRaw.toUpperCase().replace(/[^A-Z0-9.]/g, "");
  if (!symbol) throw new Error("invalid symbol");
  const nowSec = Math.floor(Date.now() / 1000);
  const dayAgo = nowSec - 86400;

  let posts24h = null, baselinePerDay = "n/a", source, degraded = false, capped = false;

  if (token) {
    try {
      source = "reddit-oauth";
      const recent = await oauthSearch(token, symbol); // newest ≤100, all time
      posts24h = recent.filter((p) => p.createdUtc && p.createdUtc >= dayAgo);
      // If the newest-100 are ALL within 24h, the true 24h count may exceed 100.
      capped = posts24h.length >= 100;
      // baseline = avg daily mentions over the prior 6 days (24h–7d ago)
      const older = recent.filter(
        (p) => p.createdUtc && p.createdUtc < dayAgo && p.createdUtc >= nowSec - 7 * 86400
      );
      baselinePerDay = older.length > 0 ? +(older.length / 6).toFixed(1) : 0;
    } catch (e) {
      degraded = true;
      posts24h = null;
    }
  }

  if (!posts24h) {
    // fallback: Arctic Shift archive — one fetch covering the whole 7d window,
    // matched client-side (post titles/selftext only, no comment-only chatter).
    const week = await arcticSearch(symbol, nowSec - 7 * 86400);
    posts24h = week.filter((p) => p.createdUtc && p.createdUtc >= dayAgo);
    source = "arctic-shift-archive";
    degraded = true;
    const older = week.filter(
      (p) => p.createdUtc && p.createdUtc < dayAgo && p.createdUtc >= nowSec - 7 * 86400
    );
    baselinePerDay = older.length > 0 ? +(older.length / 6).toFixed(1) : 0;
  }

  const mentions24h = capped ? "100+" : posts24h.length;
  const surging =
    typeof baselinePerDay === "number"
      ? baselinePerDay === 0
        ? mentions24h >= 5          // no baseline but real activity
        : mentions24h >= Math.max(3, baselinePerDay * 2)
      : "n/a";

  const topPosts = [...posts24h]
    .filter((p) => p.title)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      subreddit: p.subreddit ?? "n/a",
      author: p.author ?? "n/a", // Reddit ToS: attribute user content to its author
      score: p.score ?? "n/a",
      numComments: p.numComments ?? "n/a",
      url: p.url ?? "n/a",
    }));

  return {
    ticker: symbol,
    mentions24h,
    baseline: baselinePerDay,
    surging,
    sentiment: sentimentOf(posts24h),
    topPosts,
    source,
    degraded,
  };
}

// ---- handler ----
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  if (req.method === "OPTIONS") return res.status(204).end();

  // Vercel populates req.query; the local dev server does not, so parse
  // the query string from req.url as a fallback to work in both.
  const q = req.query || Object.fromEntries(new URLSearchParams((req.url || "").split("?")[1] || ""));
  const raw = (q.symbols || "").toString();
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))]
    .slice(0, MAX_SYMBOLS);

  // Optional connectivity self-test: GET /api/reddit?selftest=1
  if (q.selftest) {
    return res.status(200).json(await selfTest());
  }
  if (symbols.length === 0) {
    return res.status(400).json({ error: "pass ?symbols=NKE,ZTS,... (max 5)" });
  }

  const cacheKey = "v1:" + symbols.join(",");
  const cached = cacheGet(cacheKey);
  if (cached) return res.status(200).json({ ...cached, cached: true });

  const failed = [];
  let token = null, authMode = "arctic-shift-fallback";
  try {
    token = await getToken();
    if (token) authMode = "reddit-oauth";
  } catch (e) {
    failed.push({ ticker: "_auth", error: `OAuth token failed (${e.message}); using archive fallback` });
  }

  let results;
  try {
    results = await pool(symbols, MAX_CONCURRENCY, async (sym) => {
      try {
        return await analyzeTicker(sym, token);
      } catch (e) {
        failed.push({ ticker: sym.toUpperCase(), error: e.message });
        return {
          ticker: sym.toUpperCase(),
          mentions24h: "n/a",
          baseline: "n/a",
          surging: "n/a",
          sentiment: "n/a",
          topPosts: [],
          source: "n/a",
          degraded: true,
        };
      }
    });
  } catch (e) {
    return res.status(502).json({ error: "upstream failure", detail: e.message, results: [], failed });
  }

  const payload = {
    asOf: new Date().toISOString(),
    authMode,
    disclaimer: "Personal research/awareness tool. Not investment advice.",
    results,
    failed,
    cached: false,
  };
  cacheSet(cacheKey, payload);
  return res.status(200).json(payload);
}

// ---- self-test (helps verify deployment from Vercel's own IPs) ----
async function selfTest() {
  const out = { checks: {}, verdict: "unknown" };
  // 1) token endpoint reachable + creds valid?
  try {
    const t = await getToken();
    out.checks.oauthToken = t ? "ok" : "no-credentials-set";
  } catch (e) {
    out.checks.oauthToken = `failed: ${e.message}`;
  }
  // 2) authenticated search works from this IP?
  if (out.checks.oauthToken === "ok") {
    try {
      const posts = await oauthSearch(oauthToken.access_token, "NKE");
      out.checks.oauthSearch = `ok (${posts.length} posts in 24h)`;
    } catch (e) {
      out.checks.oauthSearch = `failed: ${e.message}`;
    }
  }
  // 3) fallback archive reachable?
  try {
    const pp = await arcticSearch("NKE", Math.floor(Date.now() / 1000) - 7 * 86400);
    out.checks.archiveFallback = `ok (${pp.length} posts in 7d — note: archive may lag)`;
  } catch (e) {
    out.checks.archiveFallback = `failed: ${e.message}`;
  }
  out.verdict =
    out.checks.oauthSearch?.startsWith("ok") ? "primary (Reddit OAuth) works from this host"
    : out.checks.archiveFallback?.startsWith("ok") ? "OAuth unavailable; archive fallback works (data may lag)"
    : "both paths failing from this host — check env vars and Reddit status";
  return out;
}
