// Put pressure check, the free version of unusual options flow. For
// each requested ticker, pulls the most recent trading day's full
// options chain from Alpha Vantage and totals traded put volume against
// call volume. Far more puts than calls can mean someone is betting on
// a fall, or just insuring a large position; the page explains both.
// Real time options flow is a paid product everywhere; this is the same
// footprint one day behind, which the free tier allows.

// Free tier is 25 requests per day, shared with the earnings calendar,
// so results are cached in memory for 12 hours and each call is capped
// at 8 symbols.
let cache = {};
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_SYMBOLS = 8;

async function checkSymbol(symbol, avKey) {
  const hit = cache[symbol];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const r = await fetch(
      `https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol=${encodeURIComponent(symbol)}&apikey=${avKey}`,
      { signal: controller.signal, headers: { "User-Agent": "MarketPulse personal research dashboard" } }
    );
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    if (j.Note || j.Information) throw new Error("daily free limit reached, resets tomorrow");
    if (!Array.isArray(j.data) || j.data.length === 0) throw new Error("no options data");

    let putVol = 0, callVol = 0, putOI = 0, callOI = 0, date = "";
    for (const c of j.data) {
      const vol = Number(c.volume) || 0;
      const oi = Number(c.open_interest) || 0;
      if (c.date) date = c.date;
      if (c.type === "put") { putVol += vol; putOI += oi; }
      else if (c.type === "call") { callVol += vol; callOI += oi; }
    }
    const ratio = callVol > 0 ? putVol / callVol : putVol > 0 ? 99 : 0;
    const data = { ticker: symbol, date, putVol, callVol, putOI, callOI, ratio };
    cache[symbol] = { at: Date.now(), data };
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const avKey = (process.env.ALPHAVANTAGE_API_KEY || "").trim();
  if (!avKey) {
    res.status(200).json({ results: [], failed: ["add a free ALPHAVANTAGE_API_KEY from alphavantage.co"] });
    return;
  }

  const qs = (req.url || "").split("?")[1] || "";
  const symbols = (new URLSearchParams(qs).get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s))
    .slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    res.status(200).json({ results: [], failed: [] });
    return;
  }

  const results = [];
  const failed = [];
  // Sequential on purpose: gentler on the free rate limit, and later
  // symbols still benefit when an earlier one trips the daily cap.
  for (const sym of symbols) {
    try {
      results.push(await checkSymbol(sym, avKey));
    } catch (e) {
      failed.push(`${sym} (${(e && e.message) || "no answer"})`);
      if (/daily free limit/.test((e && e.message) || "")) break;
    }
  }

  res.status(200).json({ results, failed });
}
