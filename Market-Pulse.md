# Technical Briefing: Market Pulse — architecture handoff to another Claude

Reader: you are an AI assistant helping the owner rebuild a similar app from scratch, possibly for a different industry. This is architecture only. No real third-party names, no private data, no employer ties. Read all sections before proposing code.

> Reconciliation note: the requester asked to document three bugs — "negative Days Old," "revenue correlation," and "account flags." None exist in THIS codebase; there is no Days-Old field, no revenue-correlation model, and no account-flag system here. Those belong to a separate lead-scoring/prospecting app. Section 5 documents the bugs THIS project actually fixed. When rebuilding a lead-scoring app (Section 8), the analogous defects to watch for are called out inline.

---

## 1. Purpose (two sentences)

Market Pulse is a single-user market-intelligence dashboard that pulls free public financial signals (SEC filings, insider Form 4, drawdowns, fundamentals, options flow, social/Reddit chatter, congressional trades, news) and maps each to the tickers it touches. It scores and triages those signals with a server-side LLM and presents them as tabs, never issuing buy/sell/hold calls — the decision stays with the user.

---

## 2. Tech stack (versions where they matter)

- **Frontend:** React 18.3 SPA, single component. Vite 6.3 build. Tailwind CSS v4.1 via `@tailwindcss/vite` (v4 uses the Vite plugin, not a `tailwind.config.js` + PostCSS pipeline — this matters, v3 instructions will mislead you).
- **Backend:** Vercel serverless functions, ESM default-export handlers (`export default async function handler(req, res)`). Node runtime (uses `undici` `fetch`, `headers.getSetCookie()`).
- **LLM:** Google Gemini (primary, `generativelanguage.googleapis.com/v1beta`, models `gemini-flash-latest` / `gemini-2.5-flash` / `gemini-flash-lite-latest` / `gemini-2.0-flash`), Groq (`llama-3.3-70b-versatile`) fallback, Anthropic (`claude-sonnet-4-6`, web_search tool) last resort. Chain is server-side only; keys never reach the browser.
- **Live prices:** Finnhub WebSocket, connected **directly from the browser** (the only key allowed client-side, injected as `VITE_FINNHUB_KEY`).
- **Free data sources (no key):** Yahoo Finance chart endpoint (`query1.finance.yahoo.com/v8/finance/chart`), Yahoo quoteSummary (`/v10/finance/quoteSummary`, needs crumb handshake), SEC EDGAR (`company_tickers.json` → CIK → submissions → Form 4 XML), Reddit (OAuth or Arctic Shift archive fallback), Senate eFD + House Clerk (STOCK Act), SEC 8-K/RSS wires, Stocktwits.
- **Free data sources (free key):** Alpha Vantage (earnings calendar, options put/call).
- **PDF parsing:** `unpdf` ^1.6.2 (House disclosure PDFs in congress route).
- **Local dev shim:** `dev-api.mjs` (plain Node http server that routes `/api/*` to the same handlers and polyfills `res.status`/`res.json`).
- **Persistence:** browser `localStorage` only. No database, no server state except in-memory per-function caches.
- **Deploy:** Vercel, auto-deploys from `main`. Work happens on a feature branch, merged `--no-edit` to `main` to trigger deploy.

---

## 3. File map (one line each)

**API routes (`api/*.js`, each a Vercel serverless handler):**
- `api/scan.js` — LLM brain chain; accepts `{prompt, maxTokens}`, returns `{content:[{type:"text",text}]}`; Gemini→Groq→Anthropic with model + request-variant fallback; `maxDuration: 60`.
- `api/wire.js` — pulls free public wires (SEC 8-K, Form 4, press releases, news RSS), tags items with tickers, returns raw headlines.
- `api/buzz.js` — Stocktwits social sentiment per ticker.
- `api/puts.js` — Alpha Vantage: previous-day traded put vs call volume per starred ticker; server-cached to respect free daily limit.
- `api/dips.js` — Yahoo chart endpoint; computes real drawdown off 52-week high for a fixed universe + starred; returns names down ≥ threshold.
- `api/insider.js` — SEC EDGAR Form 4 aggregation; open-market buys/sells per ticker; rate-gated.
- `api/reddit.js` — Reddit chatter per ticker; official OAuth API primary, Arctic Shift community archive fallback (keyless).
- `api/congress.js` — STOCK Act trades from Senate eFD + House Clerk; parses House PDFs with `unpdf`.
- `api/value.js` — fundamental value screen; Yahoo quoteSummary (with crumb handshake); scores names on valuation/FCF/balance-sheet/growth; fair-value range.

**Frontend:**
- `src/MarketPulse.jsx` — the entire app: all prompt builders, color/label maps, `callClaude` fetch+retry, `extractJson` salvage, per-tab run functions, external-route loaders, all React components (cards, watcher, tabs), localStorage load/save.
- `src/main.jsx` + `index.html` — Vite entry and mount.

**Config / dev / docs:**
- `dev-api.mjs` — local dev router; imports every handler, dispatches by `req.url`, adds `res.status`/`res.json` and JSON body parsing so the same handler code runs locally and on Vercel.
- `package.json` — scripts: `dev` (vite), `dev:api` (`node --env-file=.env dev-api.mjs`), `build`, `preview`.
- `.env.example` — every env var documented (see Section 7).
- `README.md`, `api/CONGRESS_SETUP.md`, `api/REDDIT_SETUP.md` — human setup docs.

---

## 4. Data flow (text diagram)

Two independent flows converge in the browser.

**Flow A — LLM scans (fresh-signal analysis):**
```
Browser (MarketPulse.jsx)
  builds prompt via <mode>Prompt(dateStr, ...)   # BRIEF constant prefixed to every prompt
  → callClaude(prompt, retries=2, maxTokens)      # POST /api/scan {prompt, maxTokens}
      → api/scan.js: pick brain (Gemini→Groq→Anthropic)
          → provider returns text (grounded web search when available)
      ← {content:[{type:"text", text}]}
  ← extractJson(text)                             # parse; salvage complete items on truncation
  → setState + localStorage.set(pulse-*)          # render cards + persist
```

**Flow B — data routes (real numbers, minimal/no AI):**
```
Browser loader (loadWire/runDips/runValue/loadCongress/...)
  → GET /api/<route>?extra=<starred>              # starred tickers passed as extra
      → route fetches external free source(s)
          Yahoo chart / quoteSummary, SEC EDGAR, Reddit, eFD+Clerk, Alpha Vantage, Stocktwits
      → normalize + (dips/value) score, in-memory cache (TTL 20–30 min)
      ← {candidates|results|events|..., note}
  → setState + localStorage.set(pulse-*)
  (dips/value only) → THEN optional Flow-A read layer on survivors (overreaction/trap verdict)
```

**Flow C — live prices (browser-direct, no server):**
```
Browser Watcher component → Finnhub WebSocket (VITE_FINNHUB_KEY) → tick stream
  → detects unusual move (price %/volume spike) → optional system notification
```

**Storage:** `localStorage` keys, all prefixed `pulse-`: `pulse-watchlist`, `pulse-last-scan`, `pulse-diamonds`, `pulse-dips`, `pulse-value`, `pulse-daily-brief`, `pulse-wire-picks`, `pulse-puts`, `pulse-history`, `pulse-tips`, `pulse-finnhub-key`, `pulse-auto-brief`, `pulse-brief-day`. `pulse-history` holds the last ~40 runs across all modes.

**Ticker tagging:** routes map events→tickers using SEC's `company_tickers.json` and tickers printed in press-release headlines; the LLM tags free-text scans. Nothing is fabricated — missing values render `n/a`.

---

## 5. Scoring logic (complete)

### 5a. Value screen (`api/value.js`) — the primary quantitative scorer

Per-name score, max 100, from four blocks. All inputs are real, pulled from Yahoo quoteSummary; missing inputs simply contribute 0 (no imputation).

**Valuation block (max 35).** Uses the first available multiple: P/E if profitable (`pe > 0 && pe <= 40`), else price-to-book, else price-to-sales. Graded by `gradeMultiple(mult, sectorMedian, cheapLevel)`:
- base `+12` for being in range;
- discount bonus `+min(18, max(0, (1 - mult/sectorMedian) * 40))` when below the sector median;
- `+5` when `mult <= cheapLevel` (cheapLevel: 12 for P/E, 1.0 for P/B and P/S).

**Free-cash-flow block (max 25).** `fcfYield = freeCashflow / marketCap`. `>=0.10 → +25`; `>=0.07 → +20`; `>=0.04 → +12`; `<=0 → -15`.

**Balance-sheet block (max 20).** Current ratio: `>=1.5 → +10`, `<1 → -8`. Debt/equity (Yahoo reports as a percent, divided by 100 to a ratio): `0..1 → +10`, `>3 → -12`.

**Growth / value-trap defense (max 20).** Revenue growth: `>=0.10 → +20`; `>=0 → +10`; `<=-0.15 → -20`; else `-5`.

**Derived:** `score` rounded to 0.1. `conviction = clamp(round(score/10), 1, 10)`. **Fair value** = re-rate to sector-median multiple: prefer earnings (`price * min(sectorMedianPE, 25) / pe`), else book value (`price * min(sectorMedianPB, 3) / priceToBook`); range = midpoint × [0.85, 1.15]; `basis` returned ("earnings"/"book value"/null). `upside = midpoint/price - 1`.

**Sector medians** are computed from the fetched set itself (peer-relative, not absolute cutoffs), per multiple, falling back to the all-universe median when a sector has too few names.

**Gates:** default universe filtered to `price ∈ [2, 400]` and `marketCap >= 300_000_000`. **Starred tickers bypass all gates**, are pinned above the ranked list, and are exempt from the top-`MAX_RESULTS` (6) cut.

### 5b. Diamond scanner (LLM trap-check, in `MarketPulse.jsx` diamondPrompt + render)

Universe: web-searched US names `<= $25`. Each candidate scored on 4 binary trap checks, each `pass|fail|unknown`: `catalyst` (dated + verifiable), `cash` (runway to catalyst), `insiders` (recent Form 4 buying), `dilution` (no heavy recent dilution/reverse split). Display score = count of `pass` out of 4. Hard gate: no concrete verifiable reason → excluded entirely. The scoring is the LLM's structured judgment, not a numeric model; the app only counts passes.

### 5c. Dip scanner (`api/dips.js` + LLM read)

Real screen: `drawdownPct = (fiftyTwoWeekHigh - price) / fiftyTwoWeekHigh * 100`, keep `>= minDrawdown` (default 20, clamped [5,90]), sort desc, `slice(0, 8)`. Then two enrichments: insider verdict (buying/selling/mixed/quiet from Form 4) and an LLM read (`overreaction|structural|unclear`, `stabilized yes|no|unclear`, risk). `offLowPct` flags names that already bounced ≥30% off the 52-week low.

### 5d. Full read (LLM synthesis) — qualitative

Gathers verified signals (drawdown, insider, options, Reddit, congress, news) for one starred ticker and returns an overall `lean` (`constructive|cautious|conflicted|neutral`), a per-signal breakdown, and an explicit agree/conflict note. No numeric score; never a buy/sell call.

### 5e. Bugs actually fixed in this project

1. **Diamond scan truncation.** The only web-grounded multi-item scan was left at the default `maxTokens=1000`; grounded models spend tokens on search before emitting JSON, so 3 candidates overran and the JSON was cut mid-write → "did not come back clean." Fix: raised that call to `maxTokens=2000` (matching the dip read); `extractJson` also salvages complete array items on truncation via `salvageArray`.
2. **Gemini 400 "invalid argument."** The paid key rejected every request. Root cause: the request body contained `generationConfig.thinkingConfig={thinkingBudget:0}`, which some model aliases reject; a secondary fragility is the `google_search` grounding tool. Fix: a variant ladder — try `grounded + no thinkingConfig` first (keeps web search, which the fresh-signal scans depend on), then `grounded + thinkingConfig`, then `ungrounded + minimal`; on a 400 escalate to the next variant, on any non-400 skip to the next model. Also collapsed a two-key free/paid chain to a single key (`GEMINI_PAID_API_KEY || GEMINI_API_KEY`).
3. **Yahoo quoteSummary 401.** Anonymous quoteSummary calls 401. Fix: `getCrumb()` performs the cookie→crumb handshake once (seed `fc.yahoo.com`/`finance.yahoo.com` for the cookie via `getSetCookie()`, trade it at `/v1/test/getcrumb`), then reuses the crumb for every name; on failure the route degrades to a clear note, never fabricated numbers.
4. **Starred small-caps dropped.** A deliberately starred name below the `$300M` cap was fetched then filtered out. Fix: starred bypass gates, pin to top, exempt from top-N; missing starred surfaced by name.
5. **Unprofitable names skipped.** Value scoring was P/E-only, so no-earnings names (negative P/E → null) scored nothing and vanished. Fix: fall back to price-to-book then price-to-sales; fair value re-rates on book value; the AI read is told the name is unprofitable so it judges an asset/revenue play honestly (a value trap stays a value trap).
6. **Insider layer key failure.** Originally on a paid market-data provider that 401'd on a stale key; rebuilt entirely on keyless SEC EDGAR with a `~140ms` request gate (`SEC_GAP_MS`, ≈7 req/s) plus per-ticker/total caps (`MAX_FILINGS_PER_TICKER=5`, `MAX_TICKERS=8`) to respect EDGAR's rate limit.

> Lead-scoring analogs (for Section 8 rebuilds): "negative Days Old" ≡ any recency field computed as `now - eventDate` that can go negative when the source timestamp is in the future or timezone-shifted — clamp to `>=0` and validate the parsed date. "Revenue correlation" ≡ a scoring input derived from a noisy/estimated field (e.g. estimated revenue) that should be bucketed or down-weighted, not used linearly. "Account flags" ≡ boolean enrichment flags that default truthy on missing data and must default to unknown/false — the same class as bug #5 here (missing data must degrade to unknown, never to a positive signal).

---

## 6. Automation vs manual

**Automated (no user action):**
- LLM brain selection, model + request-variant fallback, token clamping (server).
- Ticker tagging on wire/scan routes; drawdown/value scoring; sector-median computation; fair-value; caches (TTL 20–30 min); SEC rate gate; crumb handshake.
- `extractJson` truncation salvage.
- Daily brief auto-run: with "Auto brief" on, runs once on first open each day (`pulse-auto-brief` + `pulse-brief-day`).
- Live watcher move detection + optional system notifications.

**Manual (user-triggered):**
- Every scan button (fresh scan, hunt diamonds, hunt dips, screen for value, brief, deep dive, full read, find movers, position check, capture tip).
- Starring/unstarring tickers (drives which extras the routes fetch and which the watcher tracks).
- Starting the live watcher; pasting a Finnhub key if not env-injected.
- Marking a stock "owned" to unlock the position check.
- Grapevine: pasting raw chat text for the LLM to structure.
- Deploy: merge feature branch → `main`.

---

## 7. Fragile points and hardcoded values

**Fragile / external-dependency risks:**
- **Yahoo endpoints are unofficial.** Chart endpoint is reliable keyless; quoteSummary needs the crumb handshake and can still 401/rate-limit. Both can change without notice. Sandbox/proxied environments often 403 all Yahoo hosts — verify on the real deploy, not locally.
- **Gemini model aliases drift.** `-latest` resolves to different underlying models per project/tier; dated models get retired (404) or have free-tier `limit:0`. The model list is a fallback ladder for exactly this.
- **Grounding + config coupling.** `google_search` tool and `thinkingConfig` each independently cause 400s on some models; keep the variant ladder.
- **SEC EDGAR** requires a `User-Agent`/contact and enforces ~10 req/s; the 140ms gate is deliberately conservative.
- **Senate eFD** may refuse serverless IPs (degrades to House-only); congressional data lags up to 45 days by law — context, not an early signal.
- **`maxDuration: 60`** is required on LLM/heavy routes; the platform default (~10s) truncates grounded searches and looks like "no AI returned."

**Hardcoded values (grep targets):**
- `scan.js`: `GEMINI_MODELS` (4 aliases), `GEMINI_VARIANTS` (3), token clamp `min(max(x,256),2000)` default 1000, Groq `llama-3.3-70b-versatile`, Anthropic `claude-sonnet-4-6`, `maxDuration: 60`.
- `value.js`: `MIN_MARKET_CAP=300_000_000`, `MIN_PRICE=2.0`, `MAX_PRICE=400.0`, `MAX_RESULTS=6`, `TTL_MS=30min`, concurrency `8`, per-name timeouts `6–7s`, scoring weights/thresholds (Section 5a), the ~55-name `UNIVERSE`.
- `dips.js`: `minDrawdown` default 20 (clamp [5,90]), `slice(0,8)`, `TTL_MS=20min`, concurrency `12`, the ~45-name `UNIVERSE`.
- `insider.js`: `SEC_GAP_MS=140`, `MAX_FILINGS_PER_TICKER=5`, `MAX_TICKERS=8`.
- Per-mode `maxTokens` in `MarketPulse.jsx` run functions (scan 1000, deep 1600, full read 1800, brief 1400, wire 1600, dips/diamonds/value 2000, tip 500).
- Universes are static ticker lists — the main thing to swap per user; starred tickers extend them at runtime via `?extra=`.

---

## 8. Rebuild recipe (ordered) — generic example: an early-signal dashboard for a hauling/logistics business

Goal: same architecture, different domain. Instead of tickers→financial signals, the entities are **prospect accounts** and the signals are **public triggers** (new permits, posted RFPs/bids, business-license filings, facility news, hiring signals). Same "real data first, LLM triages, never auto-decides" spine. Give Claude Code these steps in order; each bullet is a prompt you can paste.

**Step 0 — scaffold.**
> "Create a Vite + React 18 SPA with Tailwind v4 (via `@tailwindcss/vite`, no PostCSS config). Single main component `Dashboard.jsx`. Add a Vercel `api/` folder for ESM serverless handlers. Add a `dev-api.mjs` local http router that imports every handler, dispatches by `req.url`, and polyfills `res.status`/`res.json` plus JSON body parsing. Scripts: `dev`, `dev:api` (`node --env-file=.env dev-api.mjs`), `build`."

**Step 1 — LLM brain route (copy this design exactly).**
> "Build `api/scan.js`: POST `{prompt, maxTokens}`. Try providers in order from env keys, each isolated so one failure falls through: a primary grounded LLM, a fast fallback, a paid last resort. For the primary, implement a fallback ladder over an array of model ids and an array of request variants `[{search:true,thinking:false},{search:true,thinking:true},{search:false,thinking:false}]`; on HTTP 400 escalate to the next variant, on any other error skip to the next model. Clamp tokens to `[256,2000]`. `export const config={maxDuration:60}`. Keys are server-only. Return `{content:[{type:'text',text}]}`."

**Step 2 — JSON contract + salvage.**
> "In the frontend add `callClaude(prompt, retries=2, maxTokens)` that POSTs to `/api/scan` and `extractJson(text)` that strips code fences, finds the outermost `{...}`, and — on truncation — salvages complete array items for known keys (e.g. `accounts`, `signals`, `reads`). Every prompt is prefixed with a constant house-rules brief and instructs: 'respond with ONLY valid JSON, fields under N words.'"

**Step 3 — a real-numbers data route (the value-screen analog).**
> "Build `api/accounts.js`: accept `?extra=<comma ids>`. Fetch a fixed universe of entities plus the extras from a free/authoritative source. For each, pull real attributes and compute a 0–100 fit score from weighted blocks with explicit thresholds (spell each out). Compute peer medians from the fetched set for any relative metric. Gate the default universe by size/region, but ALWAYS include `extra` entities (bypass gates, pin them, exempt from the top-N). Cache in-memory with a TTL. Missing inputs contribute 0 — never impute. Return `{candidates, note}` with a clear note when a source handshake fails."

**Step 4 — scoring hardening (pre-empt the classic bugs).**
> "Audit every scoring input: (a) any recency/age field must be `max(0, now - eventDate)` with validated date parsing so future/timezone-shifted timestamps can't go negative; (b) noisy estimated fields (e.g. estimated revenue) are bucketed or down-weighted, never used raw-linear; (c) boolean enrichment flags default to unknown/false on missing data, never to a positive signal. Add unit checks for each threshold boundary."

**Step 5 — an authoritative filing route with rate-gating (the EDGAR analog).**
> "Build `api/filings.js` against a free government/registry source. Add a request gate spacing calls ~140ms apart, per-entity and total caps, a `User-Agent`/contact header, and one bounded retry. Degrade to `n/a` on failure; never fabricate."

**Step 6 — triage + synthesis layers.**
> "After the real screen renders, add one LLM pass that only INTERPRETS the real numbers (e.g. genuine-fit vs false-positive), told explicitly which fields are estimated. Add a 'full read' that gathers all verified signals for one entity and returns an overall lean plus an explicit agree/conflict note. Never output a decision — surface, don't decide."

**Step 7 — frontend tabs, persistence, live layer.**
> "Tabs per mode, each with a run button and a static universe the user extends by 'starring' entities (drives `?extra=`). Persist everything to `localStorage` under one prefix; keep a rolling history of the last ~40 runs. If a real-time feed exists, connect it directly from the browser with a client-safe key (env-injected)."

**Step 8 — deploy + ops.**
> "Deploy on Vercel from `main`; develop on a feature branch and merge to deploy. Document every env var in `.env.example` (server keys never client-side; only the realtime key is `VITE_`-prefixed). Note fragile external endpoints and set `maxDuration:60` on any route doing grounded LLM calls or many external fetches."

**Design invariants to preserve across any domain:**
1. Real numbers first, LLM second; the LLM interprets, it does not invent facts or make the decision.
2. Missing data degrades to `n/a`/unknown, never to a positive signal.
3. Static universes + runtime `extra` starring; starred entities always shown.
4. Server-only keys except one browser-safe realtime key.
5. In-memory TTL caches to respect free-tier rate limits.
6. Provider/model/endpoint fragility handled by explicit fallback ladders, not a single hardcoded call.
