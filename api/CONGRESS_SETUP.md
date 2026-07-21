# /api/congress — congressional stock trades (STOCK Act) for your Vercel app

Drop-in serverless route. No API keys. Both chambers. Tested end-to-end (20/20 checks).

```
GET /api/congress                     recent trades, both chambers (default: last 45 days)
GET /api/congress?symbols=NKE,ZTS     only those tickers
GET /api/congress?days=90&limit=200   tune window (max 120) / size (max 1000)
GET /api/congress?chamber=senate      or chamber=house
```

Response:

```json
{
  "trades": [{ "name": "Laurel Lee", "chamber": "House", "party": "n/a",
               "ticker": "BAC", "action": "sell", "amount": "$1,001 - $15,000",
               "txDate": "2026-06-02", "disclosedDate": "2026-07-19",
               "link": "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20034694.pdf",
               "asset": "Bank of America Corporation Common Stock", "owner": "spouse" }],
  "failed": [],
  "meta": { "days": 45, "from": "...", "to": "...", "cached": false, "sources": { "senate": {"ok": true}, "house": {"ok": true} } }
}
```

`action` ∈ `buy | sell | exchange`. Missing values are literally `"n/a"` — nothing is invented.

## Setup (2 minutes)

1. Copy `congress.js` into your repo at `/api/congress.js` (same folder as `insider.js`, `dips.js`, `buzz.js`).
2. `npm i unpdf` — the one dependency; it's what lets the route read House PTR **PDFs** in a serverless function (plain pdfjs crashes there; unpdf is the serverless-hardened wrapper). Without it the route still works, but Senate-only and `"house: unpdf not installed"` shows up in `failed`.
3. Deploy. **No environment variables, no accounts, no keys.**
   (Optional: `CONGRESS_UA` to override the built-in browser User-Agent.)
4. Optional, to re-run the tests yourself: copy `congress.test.mjs` next to the route, `npm i unpdf`, then `node congress.test.mjs`. Senate requests are served from fixtures in the test (see "Senate caveat" below); House runs live.

## Sources used (both official, both free)

| Chamber | Source | What it gives |
|---|---|---|
| Senate | `efdsearch.senate.gov` (eFD) — session/CSRF handshake → `POST /search/report/data/` (PTR list, `report_type=11`) → `GET /search/view/ptr/{uuid}/` (transaction table) | Structured rows: ticker, type, amount range, tx date, filing date, link |
| House | `disclosures-clerk.house.gov` — `GET /public_disc/financial-pdfs/{YEAR}FD.ZIP` (XML index of every filing) → `GET /public_disc/ptr-pdfs/{YEAR}/{docID}.pdf` for recent PTRs | Filing metadata from the index; transactions extracted from the PDF text layer |

## The four options you asked about — verdict

1. **senate-stock-watcher / house-stock-watcher S3 datasets — DEAD, do not use.**
   The canonical URLs (`https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/transaction_report_current_year.json`, `…/aggregate/all_transactions.json`, `https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json`, and the `s3-us-east-2` variants) all return **403 AccessDenied** as of 2026-07-21 (bucket exists, objects no longer public). `senatestockwatcher.com` and `housestockwatcher.com` are offline. The GitHub mirrors (`timothycarambat/*-data`, `jeremiak/us-senate-financial-disclosure-data`) stalled in 2023–Jan 2024.

2. **Official primary sources — the winners.**
   Senate eFD exposes real structure (JSON filing list + HTML transaction tables) and is what every serious tracker scrapes. House is harder: the only structured thing is the filing index; the trades themselves live in per-filing PDFs, which are machine-generated (parseable, what this route does), encrypted-with-empty-password (also parseable), or **handwritten scans** (no text layer — those filings simply yield no rows and are counted in `meta.sources.house.unreadablePdfs`).

3. **Free-tier APIs — none actually free for this data (checked 2026-07-21).**
   Finnhub lists congressional trading in docs but it is **not in the Free plan** (nor in the standard All-in-One alternative-data list). Quiver Quantitative's API is paid (from ~$30/mo). EODHD's `congressional-trades` requires the All-in-One plan (~$80/mo). FMP's senate/house endpoints 403 on the free key. Apify's `johnvc` congressional-trading actor works on the free $5 credit but needs an account + token and ~30–60s actor runs (bad for a live endpoint; OK for a nightly cache-warming cron). parse.bot has a 100-credits/mo free wrapper — third-party, unvetted, too small for per-request use.

4. **Capitol Trades — web-only.** No documented/free API; the app is Cloudflare-protected and answers programmatic requests with 429. Scraping it would be both brittle and against their terms.

## Reliability — honest assessment

- **Freshness:** House index is updated on business days (verified: index stamped 2026-07-20, filings through 2026-07-19). Senate eFD shows filings the day they land. By law, trades may be disclosed up to **45 days after execution** — that lag is inherent to the STOCK Act, not the pipeline. Default `days=45` matches one full statutory window.
- **Senate caveat (read this):** eFD sits behind Akamai and refuses some IP ranges. My dev sandbox was refused outright (same as other `.gov` Akamai sites), so the Senate half of the test suite runs against fixtures that replicate the live contract — the endpoint itself was verified publicly reachable and current in a real browser session, and every live tracker scrapes eFD from cloud IPs daily. On Vercel it should just work; **if Akamai ever refuses your function's IP, the route reports `senate: …` in `failed[]` and keeps serving House + cached data** — no hard outage. If you ever see that persistently, the fix is a tiny relay (or Apify cron) writing to a blob, not a rewrite.
- **House caveat:** scanned paper PTRs can't be parsed by anyone (no text layer) — expect a minority of filings to contribute zero rows. Some e-filed rows disclose an asset with no ticker (funds, private companies) → `ticker: "n/a"` with the asset name preserved.
- **Rate limits:** none documented for either source. The route is polite anyway: concurrency capped at 4, 6 h in-memory cache, CDN cache headers (`s-maxage=3600`, shorter when degraded), 15 s per-request timeouts, ≤15 House PDFs per run.
- **Party affiliation:** published by neither source → `party: "n/a"`. If you want it later, the free congress.gov API (one key) can enrich by name+state — out of scope here to stay within your one-key budget.
- Public-record data for personal research/awareness. Not investment advice.
