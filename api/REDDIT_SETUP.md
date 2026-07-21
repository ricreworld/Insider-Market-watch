# /api/reddit.js — Setup & Reliability Verdict

## What this route does
`GET /api/reddit?symbols=NKE,ZTS,ORCL` (max 5) →
```json
{
  "asOf": "...",
  "authMode": "reddit-oauth" | "arctic-shift-fallback",
  "results": [{ "ticker", "mentions24h", "baseline", "surging", "sentiment", "topPosts": [{ "title", "subreddit", "author", "score", "numComments", "url" }], "source", "degraded" }],
  "failed": []
}
```
Missing values are always `"n/a"` — never estimated. `GET /api/reddit?selftest=1` runs a live connectivity check from your deployment and tells you which path works.

## Path comparison (researched + probed 2026-07-21)

| Path | Works from Vercel/cloud IP? | Cost | Verdict |
|---|---|---|---|
| **1. Official OAuth Data API** (client_credentials) | **Usually yes.** Reddit's edge IP filter blocks *unauthenticated* traffic hardest; the official docs say "traffic not using OAuth will be blocked," i.e. OAuth is the sanctioned escape hatch. No guarantee — a heavily flagged egress IP can 403 even the token endpoint. | Free tier: **100 QPM per OAuth client, averaged over 10 min** | **PRIMARY** — only fully ToS-clean path with fresh data |
| **2. Public .json endpoints** | **No.** Unauthenticated `.json` broadly returns 403 from datacenter IPs (worsened ~May 2026; old.reddit logged-out access ended June 2026). Not viable. | — | Rejected |
| **3. Search endpoint** | Works over OAuth: `/r/a+b/search?q=…&restrict_sr=1&sort=new&limit=100`. Quirk: the `t=` timeframe param is ignored with `sort=new`, so the code buckets by `created_utc` itself. Comments are not searchable at all. | — | Used by primary path |
| **4. Intermediaries** | Pushshift: dead for public (moderator-only). PullPush: live but **archive frozen May 2025** — useless for 24h chatter. **Arctic Shift: live and current** (verified: posts from 2026-07-20), free, no key; full-text search flaky (500s), so the code lists recent posts per subreddit and matches the ticker client-side. | Free | **FALLBACK** (Arctic Shift), flagged `degraded` |
| CORS proxies / residential relay | Circumvents an explicit block → **ToS violation** (Reddit is actively litigating this). Not used. | — | Rejected |

## Setup: getting Reddit credentials (READ THIS — it changed)

**Since Nov 11, 2025, Reddit closed self-service API app creation.** You can no longer just create a "script" app at reddit.com/prefs/apps unless your account was grandfathered. Options, in order:

1. **Try the classic way first (2 min):** log in → https://www.reddit.com/prefs/apps → scroll down → "create app" → type **script**, redirect URI `http://localhost:8080` → create. Client ID = the string under the app name; secret = "secret" field. If the form works for your account, you're done.
2. **If blocked** (error about reading policies / HTTP 500): file a request at https://support.reddithelp.com/hc/en-us/requests/new?ticket_form_id=14868593862164 — describe it as a **non-commercial personal developer project** ("personal ticker-chatter dashboard, ~100 req/10min, displays post titles/scores with links back to Reddit"), NOT as "research" (research access goes through a separate program). Approval is opaque; reports range from ~1 week to ghosting. **Until/unless approved, the route automatically runs on the Arctic Shift fallback with zero setup.**

Then in Vercel → Project → Settings → Environment Variables:
- `REDDIT_CLIENT_ID` = the string under your app name
- `REDDIT_CLIENT_SECRET` = the app's secret
- (optional) `REDDIT_USER_AGENT` — e.g. `myapp-ticker-tracker/1.0 (by u/yourname)`. Reddit 403s generic user agents; set this to something unique with your username.

Deploy, then hit `/api/reddit?selftest=1` — it tells you whether OAuth works from Vercel's IPs and whether the fallback is healthy.

## Rate limits & degradation behavior
- Primary: 100 QPM/client averaged over 10 min. This route uses **2 requests per ticker max** (usually 1), 10-min in-memory cache, concurrency 2, ≤5 tickers per call → you'll never come close.
- On OAuth 429/403/token failure → automatic Arctic Shift fallback, `degraded: true`, `source: "arctic-shift-archive"`. Fallback caveat: it matches tickers in post **titles/selftext only** (no comment-only chatter) and is a volunteer-run archive with no SLA.
- On total failure → ticker lands in `failed[]` with `mentions24h: "n/a"` etc. Nothing is invented.

## ToS compliance notes (personal, non-commercial dashboard)
- Fine for the free tier **with approved access**: non-commercial, displays titles/scores/links.
- **Required:** link each post back to Reddit (the `url` field does this), show the author's username (`author` field is included for this), and indicate content is from Reddit.
- Don't store Reddit content long-term — deleted content must be purged (the 10-min in-memory cache naturally complies).
- Don't use Reddit trademarks in your app's name ("X for Reddit" style is the permitted pattern).
- The Arctic Shift fallback has grey-zone provenance (community archive, not Reddit-sanctioned) — standard practice for academic research, low practical risk for a personal read-only dashboard, but the OAuth path is the clean one long-term.

## Testing done
- 22 unit/integration tests (`test-reddit.mjs`, run with `node test-reddit.mjs`): OAuth happy path, token-once-per-batch, caching, OAuth-fail fallback, 429 fallback, total-failure n/a handling, input validation, no-creds mode, selftest shape. **All pass.**
- Live probes (2026-07-21): reddit.com unreachable from this sandbox's network (egress firewall), so the OAuth path could not be tested live end-to-end here — that's exactly what `?selftest=1` is for; run it once deployed on Vercel. Arctic Shift verified live and current; PullPush verified stale; Pushshift verified gated.
