// /api/congress.js — Vercel serverless route: U.S. congressional stock trades (STOCK Act PTRs)
//
// GET /api/congress                     → recent trades, both chambers (default: last 45 days)
// GET /api/congress?symbols=NKE,ZTS     → only trades in those tickers
// GET /api/congress?days=90&limit=200   → tune window / size
// GET /api/congress?chamber=senate      → one chamber only (senate | house)
//
// Response: { trades: [{name, chamber, party, ticker, action, amount, txDate, disclosedDate, link}],
//             failed: [ "source: reason" ], meta: {...} }
//
// Sources (both official, both free, ZERO API keys required):
//   Senate — eFD (efdsearch.senate.gov): structured transaction tables per PTR filing.
//   House  — Clerk (disclosures-clerk.house.gov): yearly filing index (ZIP/XML) + per-filing
//            PTR PDFs, parsed with the optional `unpdf` package (npm i unpdf — see README).
//
// Env vars required: none. Optional: CONGRESS_UA to override the browser User-Agent.
// Works on Vercel Node 18+ runtime (uses global fetch). Keep `unpdf` in dependencies for House trades.

export const maxDuration = 60; // allow long enough for PDF parsing on paid plans; hobby caps lower

const UA = process.env.CONGRESS_UA ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const DEFAULT_DAYS = 45;      // STOCK Act filing window is 45 days — a full sweep by default
const MAX_DAYS = 120;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const FEED_TTL_MS = 6 * 3600e3;   // successful feed cached 6h
const FAIL_TTL_MS = 15 * 60e3;    // failures retried after 15 min
const CONCURRENCY = 4;            // outbound request cap
const FETCH_TIMEOUT_MS = 15e3;
const HOUSE_MAX_PDFS = 15;        // per run, to stay inside serverless time budgets

/* ------------------------------ tiny utilities ------------------------------ */

const NA = "n/a";
const val = (v) => (v === undefined || v === null || String(v).trim() === "" || String(v).trim() === "--" ? NA : String(v).trim());

function isoDate(mdy) { // "07/01/2026" -> "2026-07-01" (or n/a)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(mdy || "").trim());
  if (!m) return NA;
  const [, mm, dd, yy] = m;
  return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
function mdy(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${date.getUTCFullYear()}`;
}
function daysAgoUTC(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; }

async function fetchText(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      ...opts,
      signal: ctrl.signal,
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(opts.headers || {}) },
    });
    const body = await r.text();
    return { status: r.status, body, headers: r.headers, url: r.url };
  } finally { clearTimeout(t); }
}

async function fetchBytes(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      ...opts,
      signal: ctrl.signal,
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...(opts.headers || {}) },
    });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, buf, headers: r.headers };
  } finally { clearTimeout(t); }
}

// hand-rolled p-limit
function limited(limit) {
  let active = 0; const q = [];
  const next = () => { if (active >= limit || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

// in-memory cache that survives warm invocations
const cache = (globalThis.__congressCache ||= new Map());
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) { cache.delete(key); return { stale: true, data: hit.data }; }
  return { stale: false, data: hit.data };
}
function cacheSet(key, data, ttl) { cache.set(key, { data, exp: Date.now() + ttl }); }

/* ------------------------- minimal ZIP reader (deflate) ------------------------- */
// The Clerk publishes the yearly filing index only as {YEAR}FD.ZIP containing {YEAR}FD.xml.
// Zero-dependency extraction: End Of Central Directory -> central directory -> inflate.
function unzipFirstFile(zipBuf) {
  const EOCD_SIG = 0x06054b50, CD_SIG = 0x02014b50, LH_SIG = 0x04034b50;
  let eocd = -1;
  for (let i = zipBuf.length - 22; i >= 0 && i > zipBuf.length - 65558; i--) {
    if (zipBuf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip (no EOCD)");
  const count = zipBuf.readUInt16LE(eocd + 10);
  let off = zipBuf.readUInt32LE(eocd + 16);
  const zlib = process.getBuiltinModule ? process.getBuiltinModule("zlib") : require("zlib");
  for (let n = 0; n < count; n++) {
    if (zipBuf.readUInt32LE(off) !== CD_SIG) break;
    const method = zipBuf.readUInt16LE(off + 10);
    const compSize = zipBuf.readUInt32LE(off + 20);
    const nameLen = zipBuf.readUInt16LE(off + 28);
    const extraLen = zipBuf.readUInt16LE(off + 30);
    const cmtLen = zipBuf.readUInt16LE(off + 32);
    const lhOff = zipBuf.readUInt32LE(off + 42);
    const name = zipBuf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    if (zipBuf.readUInt32LE(lhOff) === LH_SIG) {
      const lNameLen = zipBuf.readUInt16LE(lhOff + 26);
      const lExtraLen = zipBuf.readUInt16LE(lhOff + 28);
      const dataStart = lhOff + 30 + lNameLen + lExtraLen;
      const comp = zipBuf.subarray(dataStart, dataStart + compSize);
      const data = method === 8 ? zlib.inflateRawSync(comp) : method === 0 ? comp : null;
      if (data && /\.xml$/i.test(name)) return data.toString("utf8");
    }
    off += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error("no xml entry found in zip");
}

/* ------------------------------ Senate: eFD ------------------------------ */
// Flow (plain HTTP, no key):
//   1) GET  /search/home/                 -> session cookies + csrfmiddlewaretoken
//   2) POST /search/home/ (agree)         -> session marked agreement-accepted
//   3) POST /search/report/data/          -> DataTables JSON of PTR filings
//      fields: report_type=11 (PTR), fromDate/toDate MM/DD/YYYY
//   4) GET  /search/view/ptr/{uuid}/      -> HTML page with a transactions table
// NOTE: eFD sits behind Akamai. It serves normal cloud IPs (every live tracker scrapes it
// daily) but can refuse flagged ones; any failure lands in `failed[]` and the route still
// serves House + cached data.

function parseCookies(resHeaders) {
  const raw = resHeaders.getSetCookie ? resHeaders.getSetCookie() : (resHeaders.get("set-cookie") ? [resHeaders.get("set-cookie")] : []);
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function senateSession() {
  const home = await fetchText(`${EFD}/search/home/`, { headers: { accept: "text/html" } });
  if (home.status !== 200) throw new Error(`eFD home HTTP ${home.status} (possibly IP-blocked by Akamai)`);
  const tok = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(home.body)?.[1];
  if (!tok) throw new Error("eFD home: csrf token not found");
  let cookie = parseCookies(home.headers);
  const form = new URLSearchParams({ csrfmiddlewaretoken: tok, agree: "agree" });
  const acc = await fetchText(`${EFD}/search/home/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie, referer: `${EFD}/search/home/` },
    body: form.toString(),
  });
  cookie = [cookie, parseCookies(acc.headers)].filter(Boolean).join("; ");
  const searchPage = await fetchText(`${EFD}/search/`, { headers: { cookie, referer: `${EFD}/search/home/` } });
  if (!/searchForm|Report Types|Find Reports/i.test(searchPage.body)) throw new Error("eFD: agreement not accepted");
  const tok2 = /name="csrfmiddlewaretoken" value="([^"]+)"/.exec(searchPage.body)?.[1] || tok;
  return { cookie, csrf: tok2 };
}

async function senatePtrList(sess, fromMDY, toMDY) {
  const form = new URLSearchParams({
    report_type: "11",           // 11 = Periodic Transaction Report (verified against the live form)
    fromDate: fromMDY,
    toDate: toMDY,
    firstName: "", lastName: "", senator_state: "", candidate_state: "",
    draw: "1", start: "0", length: "300",
  });
  const r = await fetchText(`${EFD}/search/report/data/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "x-csrftoken": sess.csrf,
      cookie: sess.cookie,
      referer: `${EFD}/search/`,
      accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: form.toString(),
  });
  if (r.status !== 200) throw new Error(`eFD report/data HTTP ${r.status}`);
  let j; try { j = JSON.parse(r.body); } catch { throw new Error("eFD report/data: non-JSON response"); }
  const rows = Array.isArray(j) ? j : (j.data || []);
  // DataTables rows: [firstName, lastName, office, <a href=/search/view/ptr/uuid/>…</a>, dateReceived]
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : Object.values(row);
    const href = /href="([^"]*\/search\/view\/ptr\/[^"]+)"/i.exec(String(cells[3] || ""))?.[1]
      || /\/search\/view\/ptr\/[0-9a-f-]+\/?/i.exec(String(cells[3] || ""))?.[0];
    if (!href) return null;
    return {
      first: String(cells[0] || "").trim(),
      last: String(cells[1] || "").trim(),
      office: String(cells[2] || "").trim(),
      link: href.startsWith("http") ? href : `${EFD}${href}`,
      received: String(cells[4] || "").trim(),
    };
  }).filter(Boolean);
}

// PTR page: one or more tables; map columns from their thead text (order has varied over time).
function parseSenatePtrHtml(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const txs = [];
  for (const t of tables) {
    const head = /<thead[\s\S]*?<\/thead>/i.exec(t)?.[0] || "";
    const ths = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").trim().toLowerCase());
    if (!ths.length || !ths.some((h) => h.includes("transaction")) || !ths.some((h) => h.includes("amount"))) continue;
    // exact match first, then prefix, then substring — "type" must beat "asset type"
    const col = (names) => {
      for (const n of names) { const i = ths.findIndex((h) => h === n); if (i >= 0) return i; }
      for (const n of names) { const i = ths.findIndex((h) => h.startsWith(n)); if (i >= 0) return i; }
      for (const n of names) { const i = ths.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
      return -1;
    };
    const ci = {
      date: col(["transaction date", "date"]),
      owner: col(["owner"]),
      ticker: col(["ticker"]),
      asset: col(["asset name", "asset"]),
      type: col(["type"]),
      amount: col(["amount"]),
    };
    const body = /<tbody[\s\S]*?<\/tbody>/i.exec(t)?.[0] || t;
    for (const tr of body.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (tds.length < 5) continue;
      const pick = (i) => (i >= 0 && i < tds.length ? tds[i] : "");
      const tick = val(pick(ci.ticker));
      txs.push({
        txDate: isoDate(pick(ci.date)),
        owner: val(pick(ci.owner)),
        ticker: tick === NA ? NA : tick.toUpperCase(),
        asset: val(pick(ci.asset)),
        type: pick(ci.type),
        amount: val(pick(ci.amount)),
      });
    }
  }
  return txs;
}

async function senateTrades({ fromMDY, toMDY, limit }) {
  const sess = await senateSession();
  const filings = await senatePtrList(sess, fromMDY, toMDY);
  const run = limited(CONCURRENCY);
  const seen = new Set();
  const jobs = filings.slice(0, limit).map((f) => run(async () => {
    const r = await fetchText(f.link, { headers: { cookie: sess.cookie, referer: `${EFD}/search/` } });
    if (r.status !== 200) return [];
    return parseSenatePtrHtml(r.body).map((t) => ({
      name: val(`${f.first} ${f.last}`.trim()),
      chamber: "Senate",
      party: NA, // eFD does not publish party affiliation
      ticker: t.ticker,
      action: normalizeAction(t.type),
      amount: val(t.amount),
      txDate: t.txDate,
      disclosedDate: isoDate(f.received),
      link: f.link,
      asset: t.asset,
    }));
  }));
  const out = (await Promise.all(jobs)).flat()
    .filter((t) => t.ticker !== NA || t.asset !== NA)
    .filter((t) => { const k = `${t.name}|${t.ticker}|${t.asset}|${t.action}|${t.txDate}|${t.amount}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { trades: out, filings: filings.length };
}

function normalizeAction(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("purchase") || s === "p" || s.includes("buy")) return "buy";
  if (s.includes("sale") || s === "s" || s.includes("sell")) return "sell";
  if (s.includes("exchange") || s === "e" || s === "x") return "exchange";
  return s ? s : NA;
}

/* ------------------------------ House: Clerk ------------------------------ */
// 1) GET /public_disc/financial-pdfs/{YEAR}FD.ZIP  -> XML index of every filing
//    (<Member><First><Last><FilingType>P</FilingType><StateDst><FilingDate><DocID>)
// 2) for recent P-type (PTR) filings:
//    GET /public_disc/ptr-pdfs/{YEAR}/{DocID}.pdf   -> text via optional `unpdf` dependency
// E-filed PTRs extract cleanly; paper-scanned PTRs contain no text layer and simply yield
// no transactions (counted in meta, not treated as failures).

async function loadUnpdf() {
  try { return await import("unpdf"); }
  catch { return null; }
}

async function houseIndex(year) {
  const url = `${HOUSE}/public_disc/financial-pdfs/${year}FD.ZIP`;
  const r = await fetchBytes(url, { headers: { accept: "application/zip,*/*" } }, 25e3);
  if (r.status !== 200) throw new Error(`House index HTTP ${r.status}`);
  const xml = unzipFirstFile(r.buf);
  const members = xml.match(/<Member>[\s\S]*?<\/Member>/g) || [];
  return members.map((m) => {
    const g = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(m)?.[1]?.trim() || "";
    return { first: g("First"), last: g("Last"), type: g("FilingType"), stateDst: g("StateDst"), filingDate: g("FilingDate"), docID: g("DocID"), year: g("Year") || String(year) };
  }).filter((f) => f.type === "P" && f.docID);
}

// Transaction rows in extracted PTR text flatten to lines in two shapes:
//   "Apple Inc. - Common Stock"        "Meta Platforms, Inc. - Class A"
//   "(AAPL) [ST]"                  or  "Common Stock (META) [OP]"
//   "S 06/01/2026 06/01/2026 $1,001 - $15,000"
// and occasionally the whole row on one line ("FAS [OT] S 06/01/2026 ...").
// Parse line-wise: anchor on the [XX] asset-type bracket, then rebuild the asset
// name from the previous line when it's a name continuation.
// Filings vary: transaction type can be "S (partial)", and long amounts wrap
// ("$15,001 -" / "$50,000"). Asset lines may carry an owner prefix (SP/JT/DC).
const TX_ROW_RE = /^(P|S|E|X)(?:\s*\((?:partial|full)\))?\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\$[\d,]+\s*-\s*\$[\d,]+|Over \$[\d,]+|\$[\d,]+)\s*$/;
const BRACKET_RE = /^(?<asset>[^()]*?)(?:\((?<ticker>[A-Z0-9.]{1,7})\))?\s*\[(?<atype>[A-Z]{2})\]\s*(?<rest>.*)$/;
const OWNER_CODES = { SP: "spouse", JT: "joint", DC: "dependent child" };
function parseHousePtrText(text) {
  const flat = (Array.isArray(text) ? text.join("\n") : String(text)).replace(/\r/g, "")
    .replace(/(\$[\d,]+\s*-)\s*\n\s*(\$[\d,]+)/g, "$1 $2"); // unwrap wrapped amount ranges
  const lines = flat.split("\n").map((l) => l.trim());
  const looksLikeGarbage = (l) => !l || /[$\[\]()]/.test(l) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(l)
    || /(\b[A-Za-z]\b[ \u00a0]*){2,}:/.test(l)          // letter-soup artifacts ("F  S: New")
    || /^(ID|Owner|Asset|Transaction|Type|Date|Amount|Cap\.|Gains)/i.test(l);
  const txs = [];
  for (let i = 0; i < lines.length; i++) {
    const b = BRACKET_RE.exec(lines[i]);
    if (!b) continue;
    let row = null;
    const rest = (b.groups.rest || "").trim();
    if (rest) row = TX_ROW_RE.exec(rest);                       // single-line row
    if (!row && i + 1 < lines.length) row = TX_ROW_RE.exec(lines[i + 1]); // row on next line
    if (!row) continue;
    let asset = (b.groups.asset || "").trim();
    let ticker = b.groups.ticker;
    const prev = lines[i - 1] || "";
    if (!asset && !ticker) {
      // bracket sits on its own line: "(GE)\n[OP]" — asset+ticker live on the previous line
      const p = /^(?<a>[^()]*?)\s*\((?<t>[A-Z0-9.]{1,7})\)\s*$/.exec(prev.trim());
      if (p) { asset = p.groups.a.trim(); ticker = ticker || p.groups.t; }
    } else if (!looksLikeGarbage(prev)) {
      asset = asset ? `${prev.trim()} ${asset}` : prev.trim();
    }
    asset = asset.replace(/\s+/g, " ").replace(/^\d{6,}\s+/, ""); // drop leading account numbers
    const own = /^(SP|JT|DC)\s+/.exec(asset);      // owner prefix rides on the asset line
    const owner = own ? OWNER_CODES[own[1]] : NA;
    if (own) asset = asset.slice(own[0].length);
    const [, type, txD, , amount] = row;
    const tick = val(ticker);
    txs.push({
      asset: val(asset),
      ticker: tick === NA ? NA : tick.toUpperCase(),
      assetType: b.groups.atype,
      owner,
      action: normalizeAction(type),
      txDate: isoDate(txD),
      amount: val(amount.replace(/\s+/g, " ")),
    });
  }
  return txs;
}

async function houseTrades({ fromDate, limit }) {
  const unpdf = await loadUnpdf();
  if (!unpdf) throw new Error("unpdf not installed — run `npm i unpdf` to enable House PDF parsing (see README)");
  const year = fromDate.getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();
  const years = year === nowYear ? [nowYear] : [year, nowYear];
  let filings = [];
  for (const y of new Set(years)) filings.push(...await houseIndex(y));
  filings = filings
    .filter((f) => { const d = isoDate(f.filingDate); return d !== NA && d >= isoDate(mdy(fromDate)); })
    .sort((a, b) => (isoDate(b.filingDate) < isoDate(a.filingDate) ? -1 : 1))
    .slice(0, Math.min(limit, HOUSE_MAX_PDFS));
  const run = limited(CONCURRENCY);
  let unreadable = 0;
  const jobs = filings.map((f) => run(async () => {
    const link = `${HOUSE}/public_disc/ptr-pdfs/${f.year}/${f.docID}.pdf`;
    const r = await fetchBytes(link, { headers: { accept: "application/pdf,*/*" } }, 25e3);
    if (r.status !== 200) { unreadable++; return []; }
    let text;
    try {
      const res = await unpdf.extractText(new Uint8Array(r.buf));
      text = res.text;
    } catch { unreadable++; return []; }   // scanned / encrypted-beyond-empty-password PDFs land here
    const txs = parseHousePtrText(text);
    if (!txs.length) unreadable++;
    return txs.map((t) => ({
      name: val(`${f.first} ${f.last}`.trim()),
      chamber: "House",
      party: NA, // Clerk index carries state-district, not party
      ticker: t.ticker,
      action: t.action,
      amount: t.amount,
      txDate: t.txDate,
      disclosedDate: isoDate(f.filingDate),
      link,
      asset: t.asset,
    }));
  }));
  const trades = (await Promise.all(jobs)).flat();
  return { trades, filings: filings.length, unreadable };
}

/* ------------------------------ handler ------------------------------ */

const EFD = "https://efdsearch.senate.gov";
const HOUSE = "https://disclosures-clerk.house.gov";

export default async function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || DEFAULT_DAYS, 10) || DEFAULT_DAYS, 1), MAX_DAYS);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const chamber = (url.searchParams.get("chamber") || "").toLowerCase();
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  const fromDate = daysAgoUTC(days);
  const fromMDY = mdy(fromDate), toMDY = mdy(new Date());
  const cacheKey = `feed|${days}|${chamber}|${limit}`;
  const failed = [];
  const meta = { days, from: isoDate(fromMDY), to: isoDate(toMDY), sources: {}, cached: false };

  let payload = cacheGet(cacheKey);
  if (payload && !payload.stale) {
    meta.cached = true;
    return finish(req, res, filterTrades(payload.data, symbols), failed, meta);
  }

  let fresh = payload?.data || { trades: [], meta: {} };
  try {
    const jobs = [];
    if (chamber !== "house") jobs.push(["senate", () => senateTrades({ fromMDY, toMDY, limit })]);
    if (chamber !== "senate") jobs.push(["house", () => houseTrades({ fromDate, limit })]);
    const results = await Promise.allSettled(jobs.map(([, fn]) => fn()));
    const trades = [];
    results.forEach((r, i) => {
      const name = jobs[i][0];
      if (r.status === "fulfilled") {
        trades.push(...r.value.trades);
        meta.sources[name] = { ok: true, filings: r.value.filings, trades: r.value.trades.length, ...(r.value.unreadable ? { unreadablePdfs: r.value.unreadable } : {}) };
      } else {
        failed.push(`${name}: ${r.reason?.message || String(r.reason)}`);
        meta.sources[name] = { ok: false };
      }
    });
    trades.sort((a, b) => (b.disclosedDate < a.disclosedDate ? -1 : b.disclosedDate > a.disclosedDate ? 1 : 0));
    // cross-filing dedupe: amended PTRs re-list the same trades — same member, ticker,
    // asset, direction, date and amount is one trade, not two
    const seenX = new Set();
    fresh = {
      trades: trades.filter((t) => {
        const k = [t.name, t.chamber, t.ticker, t.asset, t.action, t.txDate, t.amount].join("|");
        if (seenX.has(k)) return false; seenX.add(k); return true;
      }).slice(0, limit),
    };
    cacheSet(cacheKey, fresh, failed.length ? FAIL_TTL_MS : FEED_TTL_MS);
  } catch (e) {
    failed.push(`handler: ${e.message}`);
  }

  const out = filterTrades(fresh, symbols);
  if (!out.length && payload?.stale && payload.data?.trades?.length) {
    meta.cached = "stale";
    return finish(req, res, filterTrades(payload.data, symbols), failed, meta);
  }
  return finish(req, res, out, failed, meta);
}

function filterTrades(feed, symbols) {
  const trades = feed.trades || [];
  if (!symbols.length) return trades;
  return trades.filter((t) => symbols.includes(t.ticker));
}

function finish(req, res, trades, failed, meta) {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", failed.length
    ? "s-maxage=300, stale-while-revalidate=3600"      // degraded: re-check origin in 5 min
    : "s-maxage=3600, stale-while-revalidate=86400");  // healthy: CDN cache 1h
  res.statusCode = 200;
  res.end(JSON.stringify({ trades, failed, meta }));
}
