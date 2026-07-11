# Market Pulse

A personal market intelligence dashboard. It scans fresh market-moving news with live web search, maps each event to the stocks it touches, hunts for sub five dollar stocks with real dated catalysts, checks stocks you already own from both sides, and watches your starred tickers live for unusual price and volume movement.

It never gives investment advice, price predictions, or buy, sell, or hold recommendations. It is a research and awareness tool. The full rules live in the Master Brief, which is embedded in the app as the BRIEF constant and prefixed to every scan prompt.

## What you need before starting

1. Node.js version 20 or newer installed on your computer.
2. An Anthropic API key from https://console.anthropic.com. This key stays on the server and never reaches the browser.
3. A free Finnhub API key from https://finnhub.io. This one powers the live price watcher in the browser.

## Setup, step by step

Step 1. Install the dependencies.

```
npm install
```

Step 2. Create your environment file by copying the example.

```
cp .env.example .env
```

Step 3. Open the new .env file in any text editor and replace the placeholder values with your real Anthropic key and your real Finnhub key. Save it. This file is ignored by git on purpose, so your keys never end up in the repository.

Step 4. Start the API server in one terminal.

```
npm run dev:api
```

Step 5. Start the app in a second terminal.

```
npm run dev
```

Step 6. Open the address Vite prints, usually http://localhost:5173. That is it.

## How the pieces fit together

The React app lives in src/MarketPulse.jsx. When you run a scan, the browser sends only the prompt text to /api/scan, a small backend route in api/scan.js. That route adds your Anthropic key on the server side and forwards the request to the Anthropic API with web search enabled, model claude-sonnet-4-6. Quick scans use 1000 max tokens; the deep dive and daily brief ask for more room, capped at 2000 on the server. The response comes back to the browser, where extractJson parses it, including the salvage logic that rescues complete items when a response gets cut off.

Your watchlist, last scan, diamond results, daily brief, and Finnhub key are saved in your browser's localStorage under these keys: pulse-watchlist, pulse-last-scan, pulse-diamonds, pulse-daily-brief, pulse-finnhub-key. Clearing your browser data clears them.

The live watcher connects straight from the browser to the Finnhub WebSocket during US market hours, using the key from VITE_FINNHUB_KEY or one you paste into the field.

## Deploying to a free host

This project is set up for Vercel, which has a free tier that covers everything the app needs.

1. Push this repository to GitHub.
2. Go to https://vercel.com, sign in with GitHub, and import the repository. Vercel detects Vite automatically and picks up the api folder as serverless functions with no extra configuration.
3. In the project settings on Vercel, under Environment Variables, add ANTHROPIC_API_KEY with your Anthropic key and VITE_FINNHUB_KEY with your Finnhub key.
4. Deploy. Your app will be live at the URL Vercel gives you, and the Anthropic key stays server side.

## The four modes

Mode one is the default event scan. It searches for genuinely market-moving news from the last 24 hours and maps each event to the companies it touches, with the real mechanism, how fresh the signal is, and whether the market has already reacted.

Mode two is the focused check. Tap any ticker in your follow up list to search just that company.

Mode three is the position check for stocks you mark as owned. It reports signals that support the case for holding and signals that weaken it, both sides, and leaves the decision to you.

Mode four is the diamond scanner. It hunts for US stocks under five dollars with a real, dated, verifiable catalyst within roughly 90 days, and scores each candidate on four trap checks: dated catalyst, cash runway, insider buying per SEC Form 4, and dilution history.

Mode five is the deep dive. The Deep dive button next to any ticker in your follow up list builds one structured report combining four research angles in a single pass: a fundamentals snapshot of what the company does and how it makes money, a five point quality checklist covering valuation, growth, financial health, moat, and sentiment, a technical chart read with trend, levels, volume, and likely scenarios, and a balanced news impact review with short and long term effects. Scenarios and scorecards only, never predictions.

Mode six is the daily brief, its own tab. One button builds a ten minute morning read: overall market mood with the drivers behind it, the themes moving money today with tappable tickers, fresh news that touches your starred watchlist specifically, and one honest discipline reminder about the risk mix in your list. The last brief is saved so it is still there when you come back.

## Honesty line

Free sources lag real events by minutes to hours. Professional terminals are faster. This system is honest, not instant, and nothing it shows is investment advice.
