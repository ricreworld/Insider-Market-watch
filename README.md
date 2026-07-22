# Market Pulse

A personal market intelligence dashboard. It scans fresh market-moving news with live web search, maps each event to the stocks it touches, hunts for lower-priced stocks (twenty-five dollars a share and under) with real dated catalysts or live hooks, screens established names for genuine fundamental value on real filings data, checks stocks you already own from both sides, and watches your starred tickers live for unusual price and volume movement.

It never gives investment advice, price predictions, or buy, sell, or hold recommendations. It is a research and awareness tool. The full rules live in the Master Brief, which is embedded in the app as the BRIEF constant and prefixed to every scan prompt.

## What you need before starting

1. Node.js version 20 or newer installed on your computer.
2. A key for the AI brain, either a free Gemini key from https://aistudio.google.com or a paid Anthropic key from https://console.anthropic.com. Both stay on the server and never reach the browser. You can also run with neither; only the AI buttons need one.
3. A free Finnhub API key from https://finnhub.io. This one powers the live price watcher in the browser.
4. A free Alpha Vantage key from https://www.alphavantage.co/support/#api-key. This one powers the earnings calendar on the Live wire tab.

## Setup, step by step

Step 1. Install the dependencies.

```
npm install
```

Step 2. Create your environment file by copying the example.

```
cp .env.example .env
```

Step 3. Open the new .env file in any text editor and replace the placeholder values with your real Anthropic key, your real Finnhub key, and your email address for SEC_CONTACT_EMAIL. The SEC asks automated tools to identify themselves with a contact when reading its free filing feeds, and any email you own works. Save the file. It is ignored by git on purpose, so your keys never end up in the repository.

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

The React app lives in src/MarketPulse.jsx. When you run a scan, the browser sends only the prompt text to /api/scan, a small backend route in api/scan.js. That route picks a brain on the server side: Gemini 2.5 Flash with Google Search grounding when GEMINI_API_KEY is set, otherwise the Anthropic API with web search enabled, model claude-sonnet-4-6. If Gemini fails and an Anthropic key exists, it falls back automatically. Quick scans use 1000 max tokens; the deep dive and daily brief ask for more room, capped at 2000 on the server. The response comes back to the browser, where extractJson parses it, including the salvage logic that rescues complete items when a response gets cut off.

Your watchlist, last scan, diamond results, dip results, value screen, daily brief, and Finnhub key are saved in your browser's localStorage under these keys: pulse-watchlist, pulse-last-scan, pulse-diamonds, pulse-dips, pulse-value, pulse-daily-brief, pulse-finnhub-key. Clearing your browser data clears them.

The live watcher connects straight from the browser to the Finnhub WebSocket during US market hours, using the key from VITE_FINNHUB_KEY or one you paste into the field.

## Running it completely free

The app works with zero paid services. The Live wire tab pulls SEC filings, insider Form 4 filings, press releases, and news feeds, all free, and the server tags items with their tickers on its own using the SEC's free company to ticker file plus the tickers that press releases print in their own headlines. Star any tagged ticker straight from the wire, and the live watcher tracks it in real time on a free Finnhub key. That whole loop costs nothing.

The AI buttons, fresh scan, diamond hunt, deep dive, morning brief, position check, Find the movers, and the dip reads, can run entirely free. The app tries AI brains in a chain so a single exhausted free tier never leaves it dead. First Gemini, with a free key from aistudio.google.com set as GEMINI_API_KEY, which also has web search; when its daily quota on the main model runs low the app automatically falls to lighter Gemini models with their own larger free allowances. Then Groq, a second free brain with no card and generous limits from console.groq.com set as GROQ_API_KEY, which keeps the app running after Gemini is used up, though without live web search. Then the paid Anthropic API, set as ANTHROPIC_API_KEY, as a last resort. With none of them set, the AI buttons explain that plainly instead of failing, and everything else, the Live wire, the dip screen, the watcher, keeps working.

## Deploying to a free host

This project is set up for Vercel, which has a free tier that covers everything the app needs.

1. Push this repository to GitHub.
2. Go to https://vercel.com, sign in with GitHub, and import the repository. Vercel detects Vite automatically and picks up the api folder as serverless functions with no extra configuration.
3. In the project settings on Vercel, under Environment Variables, add VITE_FINNHUB_KEY with your Finnhub key, SEC_CONTACT_EMAIL with your email, ALPHAVANTAGE_API_KEY with your free Alpha Vantage key for the earnings calendar, and for the AI brain add GEMINI_API_KEY with your free Gemini key or ANTHROPIC_API_KEY with your paid Anthropic key, or both to get free first with paid backup.
4. Deploy. Your app will be live at the URL Vercel gives you, and the Anthropic key stays server side.

## The four modes

Mode one is the default event scan. It searches for genuinely market-moving news from the last 24 hours and maps each event to the companies it touches, with the real mechanism, how fresh the signal is, and whether the market has already reacted.

Mode two is the focused check. Tap any ticker in your follow up list to search just that company.

Mode three is the position check for stocks you mark as owned. It reports signals that support the case for holding and signals that weaken it, both sides, and leaves the decision to you.

Mode four is the diamond scanner. It hunts for lower-priced US stocks, twenty-five dollars a share and under, where something concrete makes the name interesting right now, a real, dated, verifiable catalyst within roughly 90 days or a live situation the market has not fully priced, and scores each candidate on four trap checks: dated catalyst, cash runway, insider buying per SEC Form 4, and dilution history. This covers true penny stocks under five dollars, small-caps in the five to ten range, and larger small-caps up to twenty-five dollars, like a small medical-device or biotech name with a pending FDA or earnings event.

Mode five is the deep dive. The Deep dive button next to any ticker in your follow up list builds one structured report combining four research angles in a single pass: a fundamentals snapshot of what the company does and how it makes money, a five point quality checklist covering valuation, growth, financial health, moat, and sentiment, a technical chart read with trend, levels, volume, and likely scenarios, and a balanced news impact review with short and long term effects. Scenarios and scorecards only, never predictions.

Mode six is the daily brief, its own tab. One button builds a ten minute morning read: overall market mood with the drivers behind it, the themes moving money today with tappable tickers, fresh news that touches your starred watchlist specifically, and one honest discipline reminder about the risk mix in your list. The last brief is saved so it is still there when you come back.

The live wire tab also carries the put pressure check. For each starred ticker, up to eight, it totals the previous trading day's traded put options against call options from Alpha Vantage. Far more puts than calls can mean someone is betting on a fall, or simply insuring a large position; the page says both. Real time options flow is a paid product everywhere, so this is deliberately the free version, one day behind, cached on the server to respect the free daily limit.

The live watcher can send system notifications. Tap Turn on alert notifications once, allow it in the browser, and alerts reach you even when the tab is in the background, as long as the page stays open somewhere.

The daily brief has an auto mode. Turn on Auto brief in its tab and the brief runs by itself the first time you open the app each day, using the free brain when a Gemini key is present.

The History tab remembers the last forty runs of everything, scans, hunts, briefs, wire triages, and put checks, saved in your browser. Reviewing which signals were early and which were noise is how the tool makes you sharper over time.

Mode seven is the live wire, its own tab. The backend pulls free public sources that publish before most news sites rewrite them: the SEC 8-K filing wire for material corporate events, the SEC Form 4 wire where executives disclose their own stock buys and sells, press release wires, and financial news feeds. Refresh the wire pulls the raw headlines, with optional auto refresh every two minutes. Find the movers sends the freshest headlines through one intelligence pass that throws away the noise and keeps only items with a real mechanism, each mapped to tickers with the direction the pressure points, up, down, or unclear, whether the market has reacted yet, and a confidence level. Pressure describes mechanics, it is never a buy or sell recommendation. This is the legal version of the inside scoop: public information seconds after it becomes public.

Mode eight, the grapevine, lives on the live wire tab too. It is for the tips no scanner can ever find, a friend's text, a group chat, a Discord call. Paste the raw chat text in and the AI structures it into a ticker, a neutral one line summary, a bullish, bearish, or mixed sentiment tag, and any options play mentioned, strike and expiry included. It never verifies or endorses the tip, it just gets it out of a scrolling chat and into something you can review and cross reference later.

Mode nine is the dip scanner, its own tab, and it runs on real numbers. A backend route measures the actual drawdown off the 52-week high for a universe of about 45 established names, pulled live from the free Yahoo Finance chart endpoint with no key, and keeps the ones down 20 percent or more, your starred tickers included. That screen alone costs nothing and never fabricates a stock or a number. Each survivor then gets two layers. First, the smart-money check: whether company insiders have been buying the dip with their own money or selling into it, summarized straight from recent SEC EDGAR Form 4 filings with no key at all, counting only open-market purchases and sales, never grants, option exercises, or tax withholding. Fallen plus insiders buying is the strong setup; fallen plus insiders selling confirms the trap. Second, the AI read: why it fell and whether the drop looks like an overreaction to something fixable or a structural change that justifies the lower price, honestly marked unclear when the evidence is mixed, plus whether it has stabilized or is still falling and the biggest risk if the read is wrong. Different in kind from the diamond scanner, which only covers lower-priced stocks twenty-five dollars and under with a dated catalyst or hook; this one is any size, any price, for the big names, the ZTS style setup. The drawdown screen and the insider layer both work with no AI key; only the read layer uses the brain.

The value screen is its own tab, and like the dip scanner it runs on real numbers first. A backend route pulls live fundamentals for a universe of about 55 established US names, keyless, straight from Yahoo's free endpoints using the same crumb handshake a value investor's tools use, and scores each one exactly the way a disciplined quantitative value screen would: valuation graded against its own sector's median price-to-earnings, free-cash-flow yield, balance-sheet health from the current ratio and debt-to-equity, and revenue growth as a value-trap defense. The score, the conviction rating, and the fair-value range are all computed from real filings data, never guessed, and your starred tickers are added to the sweep. Then one AI pass reads each cheap name and judges whether the low multiple is a genuine bargain or a value trap, because a stock can be statistically cheap either because it is undervalued or because the market correctly sees the business declining. It marks each bargain, trap, or honestly unclear, with the real reason it is cheap and the biggest risk if the read is wrong. The scoring works with no AI key at all; only the bargain-versus-trap read uses the brain. Different in kind from the diamond scanner, which chases small catalyst-driven names under twenty-five dollars, and from the dip scanner, which chases fallen big names off their highs; this one asks the quieter question of which established names are simply cheap on the fundamentals right now.

The Full read is the synthesis, the apex mode. On any starred ticker, the Full read button gathers every avenue the app tracks and hands the verified ones to the AI to reason across together into one honest picture. The signals: the real drawdown, insider Form 4 buying or selling from SEC EDGAR, options put and call pressure, Reddit chatter from r/wallstreetbets and friends, congressional trades disclosed under the STOCK Act, and the news catalyst. The output is an overall lean, constructive, cautious, conflicted, or neutral, a plain bottom line, a signal by signal breakdown with a color for each, and, most useful of all, an explicit note of where the signals agree and where they conflict. It reasons as hard as it can but never gives a buy, sell, or hold call. The determination stays yours.

The Reddit layer needs no key: it uses the official Reddit API when REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set, otherwise a free community archive fallback. The congressional trades layer needs no key either: it reads Senate eFD and House Clerk disclosures directly and uses the unpdf dependency to parse House disclosure PDFs. Both lag reality, congressional disclosures by up to 45 days by law, so they are context, not early signals.

## Honesty line

Free sources lag real events by minutes to hours. Professional terminals are faster. This system is honest, not instant, and nothing it shows is investment advice.
