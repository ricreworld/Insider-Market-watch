// Free market buzz, no AI involved. Two sources. Stocktwits trending
// shows which tickers retail traders are talking about right now, open
// and keyless, though it sometimes blocks cloud servers, so failure is
// handled gracefully. The Finnhub earnings calendar, included in the
// free tier, shows which companies report in the next two weeks, since
// earnings dates are the most common scheduled catalyst there is.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  // Finnhub keys are exactly 20 characters. The dashboard prints two
  // keys stacked together, so pasted values often arrive glued or with
  // stray whitespace. Clean whatever is stored and use the first key.
  const rawKey = (process.env.VITE_FINNHUB_KEY || process.env.FINNHUB_KEY || "").replace(/\s+/g, "");
  const finnhubKey = rawKey.slice(0, 20);
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
      if (!finnhubKey) {
        out.failed.push("Finnhub earnings calendar, no Finnhub key on the server");
        return;
      }
      const fmt = (d) => d.toISOString().slice(0, 10);
      const from = fmt(new Date());
      const to = fmt(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(
          `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${finnhubKey}`,
          { signal: controller.signal }
        );
        if (!r.ok) throw new Error(`status ${r.status}`);
        const d = await r.json();
        out.earnings = (d.earningsCalendar || [])
          .map((e) => ({ ticker: e.symbol, date: e.date, hour: e.hour || "" }))
          .slice(0, 500);
      } finally {
        clearTimeout(timer);
      }
    })().catch((e) =>
      out.failed.push(
        // Safe diagnostics: the key's length and first 4 characters only,
        // so a wrong or stale stored value can be spotted from the page.
        `Finnhub earnings calendar (${(e && e.message) || "no answer"}; server key length ${rawKey.length}, starts ${rawKey.slice(0, 4) || "empty"})`
      )
    ),
  ]);

  res.status(200).json(out);
}
