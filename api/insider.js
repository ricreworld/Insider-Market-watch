// Insider activity, the smart-money layer. For each ticker, pulls recent
// SEC Form 4 transactions from Finnhub (free tier, same key the watcher
// uses) and summarizes the last ~90 days of OPEN-MARKET trades: are
// officers and directors buying the dip with their own money, or selling
// into it. Buying after a big drop is a classic conviction signal;
// selling is a warning. This is the exact synthesis from Ricardo's
// insider scan: fallen quality + insider buying is the strong setup,
// fallen + insider selling confirms the trap.
//
// Only transaction codes P (open-market purchase) and S (open-market
// sale) count. Grants, option exercises, tax withholding, gifts, and
// derivative moves are deliberately ignored, they are not conviction.

const FINNHUB_URL = "https://finnhub.io/api/v1/stock/insider-transactions";
const WINDOW_DAYS = 120;

let cache = {}; // ticker -> { at, data }
const TTL_MS = 6 * 60 * 60 * 1000; // insider filings move slowly; cache 6h

function daysAgoISO(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function forTicker(ticker, key) {
  const hit = cache[ticker];
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, data: hit.data };

  const from = daysAgoISO(WINDOW_DAYS);
  const to = daysAgoISO(0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(ticker)}&from=${from}&to=${to}&token=${key}`;
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) {
      let body = "";
      try { body = (await r.text()).slice(0, 80); } catch (e) {}
      return { ok: false, reason: `status ${r.status}${body ? ` ${body}` : ""}` };
    }
    const j = await r.json();
    if (j && j.error) return { ok: false, reason: String(j.error).slice(0, 80) };
    const rows = Array.isArray(j.data) ? j.data : [];

    const buyers = new Map(); // name -> usd bought
    const sellers = new Map();
    for (const t of rows) {
      const code = (t.transactionCode || "").toUpperCase();
      const change = Number(t.change) || 0;
      const price = Number(t.transactionPrice) || 0;
      if (code === "P" && change > 0) {
        const usd = change * price;
        buyers.set(t.name, (buyers.get(t.name) || 0) + usd);
      } else if (code === "S" && change < 0) {
        const usd = Math.abs(change) * price;
        sellers.set(t.name, (sellers.get(t.name) || 0) + usd);
      }
    }

    const boughtUsd = [...buyers.values()].reduce((a, b) => a + b, 0);
    const soldUsd = [...sellers.values()].reduce((a, b) => a + b, 0);
    const topBuyerEntry = [...buyers.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    let verdict = "quiet";
    if (buyers.size > 0 && boughtUsd >= soldUsd * 1.2) verdict = "buying";
    else if (sellers.size > 0 && soldUsd >= boughtUsd * 1.2) verdict = "selling";
    else if (buyers.size > 0 || sellers.size > 0) verdict = "mixed";

    const data = {
      ticker,
      buyers: buyers.size,
      sellers: sellers.size,
      boughtUsd,
      soldUsd,
      topBuyer: topBuyerEntry ? { name: topBuyerEntry[0], usd: topBuyerEntry[1] } : null,
      verdict,
      windowDays: WINDOW_DAYS,
    };
    cache[ticker] = { at: Date.now(), data };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || "no answer" };
  } finally {
    clearTimeout(timer);
  }
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const qs = (req.url || "").split("?")[1] || "";
  const params = new URLSearchParams(qs);

  // Prefer the key the browser passes (the one that already works in the
  // live watcher) over the server env var, which may be stale. This ends
  // the Vercel-env-key mismatch: whatever key connects the watcher also
  // powers the insider layer, no settings edit needed.
  const passed = (params.get("key") || "").replace(/\s+/g, "").slice(0, 20);
  const envKey = (process.env.VITE_FINNHUB_KEY || process.env.FINNHUB_KEY || "").replace(/\s+/g, "").slice(0, 20);
  const key = passed || envKey;
  if (!key) {
    res.status(200).json({ results: [], failed: ["no Finnhub key available"] });
    return;
  }

  const symbols = (params.get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s))
    .slice(0, 12);

  if (symbols.length === 0) {
    res.status(200).json({ results: [], failed: [] });
    return;
  }

  const settled = await pool(symbols, 6, (s) => forTicker(s, key));
  const results = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r && r.ok) results.push(r.data);
    else failed.push(`${symbols[i]}${r && r.reason ? ` (${r.reason})` : ""}`);
  });

  res.status(200).json({ results, failed });
}
