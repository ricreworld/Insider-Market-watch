// Live price quotes for the watcher, keyless and server-side. The old
// watcher connected the browser straight to the Finnhub WebSocket, which
// (a) exposed an API key in the client bundle and (b) increasingly needs a
// paid plan for real-time US trades, so it would connect but never tick.
// This route polls Yahoo's free chart endpoint (the same source the dip
// scanner trusts) from the server, where there is no CORS wall and no key.
// The browser polls THIS route every ~20s instead of holding a socket.

export const config = { maxDuration: 30 };

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const UA = "Mozilla/5.0 (MarketPulse personal research dashboard)";

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
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

async function fetchQuote(ticker) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(`${CHART_URL}${encodeURIComponent(ticker)}?range=1d&interval=1m`, {
      signal: controller.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const result = ((((j.chart || {}).result) || [])[0]) || null;
    if (!result) return null;
    const meta = result.meta || {};
    const price = num(meta.regularMarketPrice);
    if (price == null) return null;
    const prevClose = num(meta.chartPreviousClose) ?? num(meta.previousClose);
    // Cumulative day volume: meta when present, else sum the minute bars.
    let volume = num(meta.regularMarketVolume);
    if (volume == null) {
      const vols = (((result.indicators || {}).quote || [])[0] || {}).volume || [];
      volume = vols.reduce((s, v) => s + (num(v) || 0), 0);
    }
    const dayPct = prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
    return {
      ticker,
      price,
      prevClose,
      dayPct,
      volume,
      marketState: typeof meta.marketState === "string" ? meta.marketState : null,
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
  const symbols = (params.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s))
    .slice(0, 12);

  if (symbols.length === 0) {
    res.status(200).json({ quotes: {}, marketState: null, note: "No symbols requested." });
    return;
  }

  const rows = (await pool(symbols, 8, fetchQuote)).filter(Boolean);
  const quotes = {};
  rows.forEach((r) => { quotes[r.ticker] = r; });

  res.status(200).json({
    quotes,
    marketState: rows.length ? rows[0].marketState : null,
    asOf: new Date().toISOString(),
    note: rows.length === 0 ? "Could not reach the price source. Try again in a moment." : "",
  });
}
