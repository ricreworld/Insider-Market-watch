// Fundamental value screen, with REAL numbers, keyless. This is the
// quantitative cousin of the dip scanner: instead of asking an AI which
// stocks look cheap (which invites hallucinated financials), it measures
// each name's actual fundamentals from Yahoo's free endpoints and scores
// them the same way a disciplined value screen would, on valuation,
// free-cash-flow yield, balance-sheet health, and growth. The score and
// the fair-value range are computed from real filings data, never guessed.
// An optional AI read layer downstream only interprets WHY a cheap name is
// cheap (genuine bargain vs value trap); it never invents the numbers.
//
// Yahoo's quoteSummary endpoint 401s for anonymous callers, so this route
// first performs the crumb + cookie handshake yfinance uses, then reuses
// that crumb for every name. If the handshake fails, the route says so
// plainly instead of returning fabricated or empty data.

// ~55 established, recognizable US-listed names across sectors, the kind
// of universe a morning value screen would sweep. Deliberately mid-to-large
// cap and priced under a few hundred dollars; true microcaps are the
// diamond scanner's job, not this one. This is a default net, not a
// recommendation list. The user's starred tickers get added on top.

// Web-search grounding is not used here, but the crumb handshake plus ~55
// sequential-ish fundamental pulls can take a while; give it room so a slow
// Yahoo response never looks like a failure.
export const config = { maxDuration: 60 };

const UNIVERSE = [
  // Tech / comms
  "AAPL", "MSFT", "GOOGL", "META", "ORCL", "CSCO", "IBM", "INTC", "QCOM", "HPQ",
  "CMCSA", "VZ", "T", "PYPL",
  // Financials
  "JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "AXP", "SCHW",
  // Healthcare
  "JNJ", "PFE", "MRK", "CVS", "CI", "GILD", "MDT", "BMY", "UNH",
  // Consumer
  "KO", "PEP", "PG", "MO", "KHC", "TGT", "F", "GM", "KR", "WBA",
  // Industrials / energy / materials
  "CAT", "DE", "GE", "MMM", "CVX", "XOM", "COP", "VLO", "NUE", "DOW",
  "LYB", "FDX",
];

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const QS_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/";
const UA = "Mozilla/5.0 (MarketPulse personal research dashboard)";

const MIN_MARKET_CAP = 300_000_000;
const MIN_PRICE = 2.0;
const MAX_PRICE = 400.0;
const MAX_RESULTS = 6;

// Cache the whole screen for 30 minutes. Fundamentals barely move
// intraday, and this keeps us far under Yahoo's rate limits.
let cache = { at: 0, data: null };
const TTL_MS = 30 * 60 * 1000;

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}
function raw(v) {
  if (v && typeof v === "object" && "raw" in v) return num(v.raw);
  return num(v);
}
function median(arr) {
  const xs = arr.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await worker(items[idx]); } catch (e) { out[idx] = null; }
    }
  });
  await Promise.all(runners);
  return out;
}

// The crumb + cookie handshake. Yahoo hands anonymous callers a cookie on
// almost any hit, then trades that cookie for a crumb token that its data
// endpoints require. We do it once and reuse the crumb for every name.
async function getCrumb() {
  const readCookie = (r) => {
    if (typeof r.headers.getSetCookie === "function") {
      const list = r.headers.getSetCookie();
      if (list && list.length) return list.map((c) => c.split(";")[0]).join("; ");
    }
    const sc = r.headers.get("set-cookie");
    if (sc) return sc.split(/,(?=[^ ;]+=)/).map((c) => c.split(";")[0]).join("; ");
    return "";
  };
  const seeds = ["https://fc.yahoo.com/", "https://finance.yahoo.com/"];
  for (const seed of seeds) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      let cookie = "";
      try {
        const r1 = await fetch(seed, { signal: controller.signal, headers: { "User-Agent": UA } });
        cookie = readCookie(r1);
      } finally {
        clearTimeout(timer);
      }
      if (!cookie) continue;
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), 6000);
      try {
        const r2 = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
          signal: c2.signal,
          headers: { "User-Agent": UA, Cookie: cookie, Accept: "text/plain" },
        });
        const crumb = (await r2.text()).trim();
        // A valid crumb is a short token; an error page is long HTML.
        if (crumb && !crumb.includes("<") && crumb.length > 0 && crumb.length < 60) return { cookie, crumb };
      } finally {
        clearTimeout(t2);
      }
    } catch (e) {
      // try the next seed
    }
  }
  return null;
}

async function fetchFundamentals(ticker, auth) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const mods = "summaryDetail,financialData,defaultKeyStatistics,price,assetProfile";
    const crumbParam = auth && auth.crumb ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const r = await fetch(`${QS_URL}${encodeURIComponent(ticker)}?modules=${mods}${crumbParam}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(auth && auth.cookie ? { Cookie: auth.cookie } : {}),
      },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const root = ((((j.quoteSummary || {}).result) || [])[0]) || {};
    const sd = root.summaryDetail || {};
    const fin = root.financialData || {};
    const ks = root.defaultKeyStatistics || {};
    const pr = root.price || {};
    const prof = root.assetProfile || {};

    const price = raw(fin.currentPrice) ?? raw(pr.regularMarketPrice);
    const marketCap = raw(pr.marketCap) ?? raw(sd.marketCap);
    const trailingPE = raw(sd.trailingPE) ?? raw(ks.trailingPE);
    const currentRatio = raw(fin.currentRatio);
    // Yahoo reports debtToEquity as a percentage (e.g. 152.3 = 1.52x).
    const deRaw = raw(fin.debtToEquity);
    const debtToEquity = deRaw == null ? null : deRaw / 100;
    const freeCashflow = raw(fin.freeCashflow);
    const revenueGrowth = raw(fin.revenueGrowth);
    const fcfYield = freeCashflow != null && marketCap && marketCap > 0 ? freeCashflow / marketCap : null;

    if (price == null || marketCap == null) return null;
    return {
      ticker,
      name: pr.longName || pr.shortName || ticker,
      sector: typeof prof.sector === "string" && prof.sector ? prof.sector : "Unknown",
      price,
      marketCap,
      pe: trailingPE != null && trailingPE > 0 ? trailingPE : null,
      currentRatio,
      debtToEquity,
      fcfYield,
      revenueGrowth,
      targetMean: raw(fin.targetMeanPrice),
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Ported straight from Ricardo's morning value screener. Real factors,
// real weights: valuation vs sector, cash generation, balance sheet, and a
// growth check that doubles as a value-trap defense.
function scoreCandidate(s, sectorMedianPE) {
  let score = 0;
  // Valuation: up to 35.
  if (s.pe != null && s.pe > 0 && s.pe <= 25) {
    score += 12;
    if (sectorMedianPE && s.pe < sectorMedianPE) {
      const discount = 1 - s.pe / sectorMedianPE;
      score += Math.min(18, Math.max(0, discount * 40));
    }
    if (s.pe <= 12) score += 5;
  }
  // Free cash flow: up to 25.
  if (s.fcfYield != null) {
    if (s.fcfYield >= 0.1) score += 25;
    else if (s.fcfYield >= 0.07) score += 20;
    else if (s.fcfYield >= 0.04) score += 12;
    else if (s.fcfYield <= 0) score -= 15;
  }
  // Balance sheet: up to 20.
  if (s.currentRatio != null) {
    if (s.currentRatio >= 1.5) score += 10;
    else if (s.currentRatio < 1) score -= 8;
  }
  if (s.debtToEquity != null) {
    if (s.debtToEquity >= 0 && s.debtToEquity <= 1) score += 10;
    else if (s.debtToEquity > 3) score -= 12;
  }
  // Growth / value-trap defense: up to 20.
  if (s.revenueGrowth != null) {
    if (s.revenueGrowth >= 0.1) score += 20;
    else if (s.revenueGrowth >= 0) score += 10;
    else if (s.revenueGrowth <= -0.15) score -= 20;
    else score -= 5;
  }
  return Math.round(score * 10) / 10;
}

function fairValue(s, sectorMedianPE) {
  if (s.pe == null || s.pe <= 0 || !sectorMedianPE || sectorMedianPE <= 0) return { low: null, high: null };
  const normalizedPE = Math.min(sectorMedianPE, 25);
  const midpoint = (s.price * normalizedPE) / s.pe;
  return {
    low: Math.round(midpoint * 0.85 * 100) / 100,
    high: Math.round(midpoint * 1.15 * 100) / 100,
  };
}

function conviction(score) {
  return Math.max(1, Math.min(10, Math.round(score / 10)));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const qs = (req.url || "").split("?")[1] || "";
  const params = new URLSearchParams(qs);
  const extra = (params.get("extra") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s));

  if (extra.length === 0 && cache.data && Date.now() - cache.at < TTL_MS) {
    res.status(200).json({ ...cache.data, cached: true });
    return;
  }

  const tickers = Array.from(new Set([...UNIVERSE, ...extra]));

  const auth = await getCrumb();

  // One fundamentals pull per name, concurrency-capped.
  const rows = (await pool(tickers, 8, (t) => fetchFundamentals(t, auth))).filter(Boolean);
  const fetched = rows.length;

  if (fetched === 0) {
    const data = {
      candidates: [],
      universeSize: tickers.length,
      fetched: 0,
      asOf: new Date().toISOString(),
      note: auth
        ? "Reached the data source but got no usable fundamentals back. Try again in a moment."
        : "Could not complete the data-source handshake for fundamentals. This is a Yahoo-side hiccup; try again shortly.",
    };
    res.status(200).json(data);
    return;
  }

  // Sector median P/E from what we actually fetched, so the valuation
  // score is graded against peers, not an absolute cutoff.
  const bySector = {};
  rows.forEach((s) => {
    if (s.pe != null) (bySector[s.sector] = bySector[s.sector] || []).push(s.pe);
  });
  const sectorMedianPE = {};
  Object.keys(bySector).forEach((sec) => { sectorMedianPE[sec] = median(bySector[sec]); });
  const overallMedianPE = median(rows.map((x) => x.pe));

  const scored = rows
    .filter((s) => s.price >= MIN_PRICE && s.price <= MAX_PRICE && s.marketCap >= MIN_MARKET_CAP)
    .map((s) => {
      const medPE = sectorMedianPE[s.sector] || overallMedianPE;
      const score = scoreCandidate(s, medPE);
      const fv = fairValue(s, medPE);
      const upside = fv.low != null && fv.high != null ? ((fv.low + fv.high) / 2) / s.price - 1 : null;
      return {
        ...s,
        score,
        conviction: conviction(score),
        sectorMedianPE: medPE != null ? Math.round(medPE * 10) / 10 : null,
        fairValueLow: fv.low,
        fairValueHigh: fv.high,
        upside,
      };
    })
    .sort((a, b) => b.score - a.score);

  const candidates = scored.slice(0, MAX_RESULTS);

  const data = {
    candidates,
    universeSize: tickers.length,
    fetched,
    asOf: new Date().toISOString(),
    note: candidates.length === 0
      ? `Screened ${fetched} names; none cleared the size and price gates today.`
      : candidates[0].score < 35
      ? "Nothing scored strongly today. These are the least-weak names, not strong bargains, treat the low scores as a warning."
      : "",
  };

  if (extra.length === 0) cache = { at: Date.now(), data };
  res.status(200).json(data);
}
