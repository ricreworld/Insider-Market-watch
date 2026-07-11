// Free market buzz, no AI involved. Two sources. Stocktwits trending
// shows which tickers retail traders are talking about right now, open
// and keyless, though it sometimes blocks cloud servers, so failure is
// handled gracefully. Earnings dates come from the Alpha Vantage
// earnings calendar (free key from alphavantage.co), since earnings
// are the most common scheduled catalyst there is. Finnhub's calendar
// turned out to be paywalled (it answers 401 to free keys), which is
// why it is not used here.

// The Alpha Vantage free tier allows only 25 requests per day, so the
// three month calendar is cached in memory and reused for hours.
let earnCache = { at: 0, rows: null };
const EARN_CACHE_MS = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const avKey = (process.env.ALPHAVANTAGE_API_KEY || "").trim();
  const out = { trending: [], earnings: [], failed: [] };

  await Promise.allSettled([
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch("https://api.stocktwits.com/api/2/trending/symbols.json", {
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (MarketPulse personal research dashboard)" },
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        const d = await r.json();
        out.trending = (d.symbols || [])
          .filter((s) => s.symbol && !s.symbol.includes("."))
          .slice(0, 15)
          .map((s) => ({ ticker: s.symbol, name: s.title || s.symbol, watchers: s.watchlist_count || 0 }));
      } finally {
        clearTimeout(timer);
      }
    })().catch((e) => out.failed.push(`Stocktwits trending (${(e && e.message) || "no answer"})`)),

    (async () => {
      if (!avKey) {
        out.failed.push("earnings calendar, add a free ALPHAVANTAGE_API_KEY from alphavantage.co");
        return;
      }
      if (!earnCache.rows || Date.now() - earnCache.at > EARN_CACHE_MS) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const r = await fetch(
            `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${avKey}`,
            { signal: controller.signal, headers: { "User-Agent": "MarketPulse personal research dashboard" } }
          );
          if (!r.ok) throw new Error(`status ${r.status}`);
          const csv = await r.text();
          // Rate-limit and error answers come back as JSON, not CSV.
          if (csv.trim().startsWith("{")) throw new Error("daily free limit reached, resets tomorrow");
          // CSV columns: symbol,name,reportDate,fiscalDateEnding,estimate,currency
          const rows = csv
            .trim()
            .split("\n")
            .slice(1)
            .map((line) => {
              const c = line.split(",");
              return { ticker: (c[0] || "").trim(), date: (c[2] || "").trim() };
            })
            .filter((e) => e.ticker && e.date);
          if (!rows.length) throw new Error("empty calendar");
          earnCache = { at: Date.now(), rows };
        } finally {
          clearTimeout(timer);
        }
      }
      const cutoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      out.earnings = earnCache.rows.filter((e) => e.date <= cutoff).slice(0, 1500);
    })().catch((e) => out.failed.push(`earnings calendar (${(e && e.message) || "no answer"})`)),
  ]);

  res.status(200).json(out);
}
