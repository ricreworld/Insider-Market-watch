// Fallen-quality screen, with REAL numbers. Ported from Ricardo's Kimi
// scanner. Pulls the free Yahoo Finance chart endpoint (no key needed)
// for a universe of established names, computes the true drawdown off
// each one's 52-week high, and returns the ones that have fallen hard.
// This is the honest, data-grounded core of the dip scanner: the app no
// longer guesses which stocks fell or by how much, it measures it. The
// AI's only job downstream is reading WHY, on names that verifiably are
// down big.
//
// Fundamentals (market cap, PE) come from Yahoo's quoteSummary endpoint,
// which frequently 401s without a crumb cookie; when it does, those
// fields degrade to null and render as n/a, never estimated.

// ~45 established, recognizable US-listed names across sectors. Sub-$5
// microcaps are intentionally out of scope, the diamond scanner covers
// those. This is a default net, not a recommendation list.
const UNIVERSE = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "ORCL", "ADBE", "CRM",
  "AMD", "INTC", "QCOM", "IBM", "CSCO", "PYPL", "UBER", "PLTR",
  "NKE", "SBUX", "MCD", "DIS", "LULU", "TGT", "EL", "CLX", "KO", "PEP",
  "JNJ", "PFE", "MRNA", "NVO", "MDT", "TMO", "DHR", "BDX", "UNH", "ZTS",
  "BA", "GE", "CAT", "DECK", "CHTR", "WBD", "F", "GM", "MMM", "ON",
];

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const QS_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/";
const UA = "Mozilla/5.0 (MarketPulse personal research dashboard)";

// Cache the whole screen for 20 minutes so repeated hits do not hammer
// Yahoo (which rate-limits) and stay well within serverless time limits.
let cache = { at: 0, data: null };
const TTL_MS = 20 * 60 * 1000;

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}
function raw(v) {
  // quoteSummary values look like {raw: 123, fmt: "123"}.
  if (v && typeof v === "object" && "raw" in v) return num(v.raw);
  return num(v);
}

// Run promise-returning tasks with a concurrency cap.
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

async function fetchChart(ticker) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(`${CHART_URL}${encodeURIComponent(ticker)}?range=1y&interval=1d`, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const meta = (((j.chart || {}).result || [])[0] || {}).meta;
    if (!meta) return null;
    const price = num(meta.regularMarketPrice);
    const high = num(meta.fiftyTwoWeekHigh);
    const low = num(meta.fiftyTwoWeekLow);
    if (price == null || high == null || high <= 0) return null;
    const drawdownPct = ((high - price) / high) * 100;
    const offLowPct = low && low > 0 ? ((price - low) / low) * 100 : null;
    return {
      ticker,
      name: meta.longName || meta.shortName || ticker,
      price,
      high,
      low,
      drawdownPct,
      offLowPct, // how far it has already bounced off the 52wk low
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFundamentals(ticker) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const mods = "summaryDetail,financialData,defaultKeyStatistics,price";
    const r = await fetch(`${QS_URL}${encodeURIComponent(ticker)}?modules=${mods}`, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) return null; // commonly 401 without a crumb; degrade to n/a
    const j = await r.json();
    const root = ((((j.quoteSummary || {}).result) || [])[0]) || {};
    const sd = root.summaryDetail || {};
    const fin = root.financialData || {};
    const ks = root.defaultKeyStatistics || {};
    const pr = root.price || {};
    return {
      marketCap: raw(sd.marketCap) ?? raw(pr.marketCap),
      forwardPE: raw(sd.forwardPE) ?? raw(ks.forwardPE),
      trailingPE: raw(sd.trailingPE) ?? raw(ks.trailingPE),
      revenueGrowth: raw(fin.revenueGrowth),
      recommendation: typeof fin.recommendationKey === "string" ? fin.recommendationKey.toLowerCase() : null,
      targetMean: raw(fin.targetMeanPrice),
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const qs = (req.url || "").split("?")[1] || "";
  const params = new URLSearchParams(qs);
  const minDrawdown = Math.min(Math.max(parseFloat(params.get("min")) || 20, 5), 90);
  const extra = (params.get("extra") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s));

  // Serve cache when fresh and no custom extras were requested.
  if (extra.length === 0 && cache.data && Date.now() - cache.at < TTL_MS) {
    res.status(200).json({ ...cache.data, cached: true });
    return;
  }

  const tickers = Array.from(new Set([...UNIVERSE, ...extra]));

  // Wave 1: real drawdown for the whole universe, concurrency-capped.
  const charts = (await pool(tickers, 12, fetchChart)).filter(Boolean);
  const fetched = charts.length;

  // Screen: down at least minDrawdown off the 52wk high.
  const survivors = charts
    .filter((c) => c.drawdownPct >= minDrawdown)
    .sort((a, b) => b.drawdownPct - a.drawdownPct)
    .slice(0, 12);

  // Wave 2: fundamentals only for survivors (best effort, may all be n/a).
  const funds = await pool(survivors, 8, (c) => fetchFundamentals(c.ticker));
  survivors.forEach((c, i) => { c.fundamentals = funds[i] || null; });

  const data = {
    candidates: survivors,
    universeSize: tickers.length,
    fetched,
    minDrawdown,
    asOf: new Date().toISOString(),
    note: charts.length === 0
      ? "Could not reach the price data source. Try again in a moment."
      : survivors.length === 0
      ? `Screened ${fetched} names; none are down ${minDrawdown}% or more off their 52-week high right now.`
      : "",
  };

  if (extra.length === 0) cache = { at: Date.now(), data };
  res.status(200).json(data);
}
