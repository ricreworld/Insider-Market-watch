// Insider activity, the smart-money layer, straight from SEC EDGAR.
// No key, ever. For each ticker it resolves the CIK, reads the company's
// recent Form 4 filings, parses each one for OPEN-MARKET purchases and
// sales, and summarizes the last few months: are officers and directors
// buying the dip with their own money, or selling into it. This is the
// exact synthesis from Ricardo's insider scan, fallen quality plus
// insider buying is the strong setup, fallen plus insider selling
// confirms the trap. Only transaction code P (purchase) and S (sale)
// count; grants, option exercises, tax withholding, gifts, and
// derivative moves are noise and are excluded. Nothing is fabricated,
// figures come only from the filings themselves.

const WINDOW_DAYS = 150;
const MAX_FILINGS_PER_TICKER = 6; // cap fetches per ticker
const MAX_TICKERS = 6; // and only the deepest few survivors per run
const UA_BASE = "MarketPulse personal research dashboard";

// SEC enforces a hard ~10 requests/second fair-access limit; exceed it
// and the IP gets a 10-minute 403 timeout. Every SEC call goes through
// this gate, which spaces request starts ~140ms apart (~7/s, safely
// under the ceiling) so a burst of Form 4 fetches never trips it.
const SEC_GAP_MS = 140;
let secGate = Promise.resolve();
function secTurn() {
  const p = secGate.then(() => new Promise((r) => setTimeout(r, SEC_GAP_MS)));
  secGate = p.catch(() => {});
  return p;
}

async function secFetch(url, ua, timeoutMs = 7000) {
  await secTurn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { "User-Agent": ua, Accept: "application/json, text/xml, */*" } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// CIK lookup, cached a day. Same free SEC file the wire route uses.
let cikMapPromise = null;
let cikMapAt = 0;
async function loadCikMap(ua) {
  // Two tries: if the IP is briefly throttled, a short wait may clear it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await secFetch("https://www.sec.gov/files/company_tickers.json", ua, 9000);
    if (r.ok) {
      try {
        const data = JSON.parse(r.text);
        const byTicker = {};
        for (const k of Object.keys(data)) {
          const row = data[k];
          if (row && row.ticker) byTicker[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
        }
        return byTicker;
      } catch (e) {
        return null;
      }
    }
    await new Promise((res) => setTimeout(res, 600));
  }
  return null;
}

async function getCikMap(ua) {
  const now = Date.now();
  if (!cikMapPromise || now - cikMapAt > 24 * 60 * 60 * 1000) {
    cikMapAt = now;
    cikMapPromise = loadCikMap(ua);
  }
  const map = await cikMapPromise;
  if (!map) cikMapPromise = null; // failed, retry on the next request
  return map;
}

let cache = {}; // ticker -> { at, data }
const TTL_MS = 6 * 60 * 60 * 1000;

function daysAgoISO(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function firstTag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"));
  return m ? m[1].trim() : "";
}
function valueTag(block, name) {
  // Shapes like <transactionShares><value>123</value></transactionShares>
  const m = block.match(new RegExp(`<${name}>\\s*<value>\\s*([^<]*?)\\s*</value>`, "i"));
  return m ? m[1].trim() : "";
}

// Parse one Form 4 ownership XML into {name, buys:[{usd}], sells:[{usd}]}.
function parseForm4(xml) {
  const name =
    firstTag(xml, "rptOwnerName") ||
    (xml.match(/<rptOwnerName>\s*([^<]+?)\s*<\/rptOwnerName>/i) || [])[1] ||
    "";
  const blocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/gi) || [];
  let bought = 0, sold = 0, latest = "";
  for (const b of blocks) {
    const code = (b.match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i) || [])[1];
    const shares = parseFloat(valueTag(b, "transactionShares")) || 0;
    const price = parseFloat(valueTag(b, "transactionPricePerShare")) || 0;
    const ad = (valueTag(b, "transactionAcquiredDisposedCode") || "").toUpperCase();
    const date = valueTag(b, "transactionDate");
    if (date && date > latest) latest = date;
    if (code === "P" && ad === "A") bought += shares * price;
    else if (code === "S" && ad === "D") sold += shares * price;
  }
  return { name: name.trim(), bought, sold, latest };
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

async function forTicker(ticker, cik, ua) {
  const hit = cache[ticker];
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, data: hit.data };

  // Recent filings list for this company.
  const subUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const subRes = await secFetch(subUrl, ua);
  if (!subRes.ok) return { ok: false, reason: `submissions ${subRes.status || "unavailable"}` };
  let sub;
  try { sub = JSON.parse(subRes.text); } catch (e) { return { ok: false, reason: "submissions parse failed" }; }
  const recent = (sub.filings && sub.filings.recent) || {};
  const forms = recent.form || [];
  const accns = recent.accessionNumber || [];
  const docs = recent.primaryDocument || [];
  const dates = recent.filingDate || [];
  const cutoff = daysAgoISO(WINDOW_DAYS);
  const cikInt = String(parseInt(cik, 10));

  const targets = [];
  for (let i = 0; i < forms.length && targets.length < MAX_FILINGS_PER_TICKER; i++) {
    if (forms[i] !== "4") continue;
    if (dates[i] && dates[i] < cutoff) break; // recent[] is newest-first
    const accn = (accns[i] || "").replace(/-/g, "");
    // Strip any xslt render prefix to reach the raw ownership XML.
    const doc = (docs[i] || "").replace(/^xsl[^/]*\//i, "");
    if (!accn || !doc || !/\.xml$/i.test(doc)) continue;
    targets.push(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${accn}/${doc}`);
  }

  if (targets.length === 0) {
    const data = emptyResult(ticker);
    cache[ticker] = { at: Date.now(), data };
    return { ok: true, data };
  }
  const xmls = (await pool(targets, 4, (u) => secFetch(u, ua)))
    .filter((r) => r && r.ok)
    .map((r) => r.text);

  const buyers = new Map();
  const sellers = new Map();
  for (const xml of xmls) {
    if (!/<ownershipDocument/i.test(xml)) continue;
    const p = parseForm4(xml);
    if (!p.name) continue;
    if (p.bought > 0) buyers.set(p.name, (buyers.get(p.name) || 0) + p.bought);
    if (p.sold > 0) sellers.set(p.name, (sellers.get(p.name) || 0) + p.sold);
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
}

function emptyResult(ticker) {
  return { ticker, buyers: 0, sellers: 0, boughtUsd: 0, soldUsd: 0, topBuyer: null, verdict: "quiet", windowDays: WINDOW_DAYS };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const contact = process.env.SEC_CONTACT_EMAIL || "";
  const ua = `${UA_BASE} ${contact}`.trim();

  const qs = (req.url || "").split("?")[1] || "";
  const symbols = (new URLSearchParams(qs).get("symbols") || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z.\-]{1,6}$/.test(s))
    .slice(0, MAX_TICKERS); // deepest survivors first; keeps SEC load bounded

  if (symbols.length === 0) {
    res.status(200).json({ results: [], failed: [] });
    return;
  }

  const cikMap = await getCikMap(ua);
  if (!cikMap) {
    res.status(200).json({ results: [], failed: ["SEC company list unavailable"] });
    return;
  }

  const settled = await pool(symbols, 3, async (s) => {
    const cik = cikMap[s];
    if (!cik) return { ok: false, reason: "no CIK found" };
    return forTicker(s, cik, ua);
  });

  const results = [];
  const failed = [];
  settled.forEach((r, i) => {
    if (r && r.ok) results.push(r.data);
    else failed.push(`${symbols[i]}${r && r.reason ? ` (${r.reason})` : ""}`);
  });

  res.status(200).json({ results, failed });
}
