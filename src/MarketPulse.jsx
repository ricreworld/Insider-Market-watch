import { useState, useEffect, useRef } from "react";
import { storage } from "./storage";

const C = {
  bg: "#0B1220",
  panel: "#131C2C",
  panelSoft: "#0F1726",
  line: "#233046",
  text: "#E9E6DB",
  dim: "#8B93A7",
  urgent: "#FF8A3D",
  soon: "#5FB2E8",
  context: "#7C8698",
  gold: "#F5C664",
  green: "#7BC98F",
  red: "#E06C5F",
  violet: "#B08FE8",
};

const URGENCY = {
  now: { label: "Time sensitive", color: C.urgent, blurb: "Fresh, market still digesting" },
  soon: { label: "Developing", color: C.soon, blurb: "In motion, track today" },
  context: { label: "Background", color: C.context, blurb: "Slower, shapes the bigger picture" },
};

const REL = {
  direct: { label: "Direct", color: C.gold },
  competitor: { label: "Competitor", color: C.soon },
  supplier: { label: "Supply chain", color: C.green },
  etf: { label: "Sector ETF", color: C.context },
};

const CHECKS = {
  catalyst: { label: "Dated catalyst", help: "A real, verifiable event with a date, not a rumor" },
  cash: { label: "Cash runway", help: "Enough cash to survive to the catalyst without emergency fundraising" },
  insiders: { label: "Insider buying", help: "Executives buying their own stock with their own money, per SEC Form 4" },
  dilution: { label: "Dilution history", help: "Has the company avoided flooding the market with new shares" },
};

// Quality checklist for the deep dive, adapted from classic screener
// questions: valuation, growth, financial health, moat, and sentiment.
const DEEP_CHECKS = {
  valuation: { label: "Valuation", help: "Is the price reasonable next to earnings, sales, and peers" },
  growth: { label: "Growth", help: "Real growth prospects with evidence, not hope" },
  health: { label: "Financial health", help: "Debt, cash flow, and margins in decent shape" },
  moat: { label: "Competitive moat", help: "Something durable that keeps competitors out" },
  sentiment: { label: "Sentiment", help: "How the market currently feels about it" },
};

const MOODS = {
  risk_on: { label: "Risk on", color: "#7BC98F" },
  risk_off: { label: "Risk off", color: "#E06C5F" },
  mixed: { label: "Mixed", color: "#F5C664" },
};

// Source kinds on the live wire, roughly ordered by how early they are.
const KINDS = {
  filing: { label: "SEC filing", color: "#5FB2E8" },
  insider: { label: "Insider Form 4", color: "#B08FE8" },
  pr: { label: "Press release", color: "#7BC98F" },
  news: { label: "News", color: "#8B93A7" },
};

const PRESSURE = {
  up: { label: "Pressure up", color: "#7BC98F", mark: "↑" },
  down: { label: "Pressure down", color: "#E06C5F", mark: "↓" },
  unclear: { label: "Pressure unclear", color: "#8B93A7", mark: "→" },
};

const CONF_LEVELS = { low: 1, medium: 2, high: 3 };

const SCOPES = {
  market: { label: "Whole market", prompt: "across the entire market, any sector" },
  zones: {
    label: "My zones",
    prompt:
      "weighted toward energy and utilities, AI and technology, and waste, environmental services and sustainability, but still include anything huge from other sectors",
  },
};

const LOADING_LINES = [
  "Searching fresh headlines and filings...",
  "Filtering out recycled news...",
  "Mapping each event to affected companies...",
  "Checking what the market already priced in...",
  "Scoring confidence, almost done...",
];

const DIAMOND_LINES = [
  "Hunting sub $5 stocks with real dated catalysts...",
  "Checking cash runway and dilution history...",
  "Looking for insider buying in SEC filings...",
  "Killing the trap stocks, keeping candidates...",
  "Building scorecards, almost done...",
];

const WIRE_LINES = [
  "Reading the raw wire...",
  "Killing the fluff, ads, and recycled items...",
  "Mapping each headline to the stock it touches...",
  "Checking which moves already happened...",
  "Scoring the survivors, almost done...",
];

const BRIEF_LINES = [
  "Checking indexes and overnight macro...",
  "Finding the themes driving today...",
  "Sweeping fresh news on your starred tickers...",
  "Separating fresh signals from priced in noise...",
  "Writing your ten minute read, almost done...",
];

// Master Brief v2, shared by every scan mode in the app
const BRIEF = `MASTER BRIEF: You are Ricardo's real time market intelligence analyst. The goal is catching early signals before they are fully priced in, for his own awareness and follow up, never for trading advice. Use high effort. Prioritize freshness and accuracy over completeness, never pad with speculation. Boundaries: no investment advice, no price predictions, no buy sell or hold recommendations, never invent sources, numbers, events, or tickers. Explain everything in plain language for a smart friend with no finance background. If nothing meaningful exists, say so plainly instead of forcing a report.`;

function scanPrompt(scopeText, dateStr) {
  return `${BRIEF}

Mode one, event first. Today is ${dateStr}.

Search the web for genuinely market-moving events from the last 24 hours ${scopeText}. Prioritize: earnings surprises and guidance changes, FDA or regulatory decisions, government policy moves, M&A and major deals, executive departures or statements, material disclosures, major lawsuits, macro data.

STRICT RULES:
1. Only report events you actually found in search results with a named source. Never invent or fill gaps.
2. Only include a ticker if you are certain it is correct. If unsure, write "?".
3. Never present recycled or old news as fresh. Check the event date.
4. Map the ripple: direct company plus competitors, supply chain, or sector ETF. Tag each with rel.
5. Confidence high only when the mechanism is direct and clear.
6. freshness: fresh means market has not fully reacted, priced_in means the move already happened.

Respond with ONLY valid JSON. No markdown, no fences, no preamble. At most 4 events. Every text field under 18 words. Brevity is critical, the response gets cut off if too long.

{"events":[{"urgency":"now|soon|context","headline":"plain headline","what":"what happened, simple language","companies":[{"name":"Company","ticker":"TICK","rel":"direct|competitor|supplier|etf","why":"real mechanism"}],"freshness":"fresh|developing|priced_in","age":"like 2 hours ago","reacted":"no|partial|yes","source":"publication","confidence":"low|medium|high"}],"note":"only if nothing meaningful, else empty string"}`;
}

function diamondPrompt(dateStr) {
  return `${BRIEF}

Mode four, diamond scan. Today is ${dateStr}. Remember: a low price alone is never a signal, only the catalyst and the checks matter.

Search the web for US-listed stocks currently trading under $5 that have a REAL, DATED, VERIFIABLE upcoming catalyst within roughly the next 90 days. Valid catalysts: FDA decision dates or trial readouts, government contract awards or decisions, court rulings, earnings with confirmed dates, regulatory approvals, major product launches. NOT valid: rumors, social media hype, undated speculation.

HARD GATE: if you cannot verify the catalyst and its approximate date from a real source, do not include the stock at all.

For each candidate, run this trap check and mark each item pass, fail, or unknown based on what you find:
- catalyst: is the catalyst confirmed and dated
- cash: does the company appear to have cash to survive to the catalyst date without emergency fundraising
- insiders: any recent insider buying (SEC Form 4)
- dilution: has the company avoided heavy recent share dilution or reverse splits

Be honest with unknown. Never mark pass without evidence. This is not investment advice, only a research scorecard.

Respond with ONLY valid JSON, no markdown, no preamble. At most 3 candidates, every text field under 20 words.

{"candidates":[{"name":"Company","ticker":"TICK","price":"about $1.20","catalyst":"what the event is","date":"when, like mid Aug 2026","checks":{"catalyst":"pass|fail|unknown","cash":"pass|fail|unknown","insiders":"pass|fail|unknown","dilution":"pass|fail|unknown"},"risk":"the single biggest risk in one line","source":"where verified"}],"note":"if no clean candidates found, say so plainly, else empty string"}`;
}

function focusPrompt(name, ticker, dateStr, moveContext) {
  const moveLine = moveContext
    ? `IMPORTANT: This stock was just flagged for unusual movement: ${moveContext}. Search specifically for what is causing this move right now.`
    : "";
  return `${BRIEF}

Mode two, focused check. Today is ${dateStr}. ${moveLine}

Search the web for the latest news, filings, executive statements and regulatory items about ${name} (${ticker}) from the last few days.

STRICT RULES: only report what you actually found with a named source, never invent, never present old news as fresh, confidence high only for direct clear mechanisms.

Respond with ONLY valid JSON, no markdown, no preamble. At most 3 items, every text field under 25 words.

{"events":[{"urgency":"now|soon|context","headline":"plain headline","what":"what happened, simple language","companies":[{"name":"${name}","ticker":"${ticker}","rel":"direct","why":"real mechanism"}],"freshness":"fresh|developing|priced_in","age":"how recent","reacted":"no|partial|yes","source":"publication","confidence":"low|medium|high"}],"note":"only if nothing meaningful, else empty string"}`;
}

function ownedPrompt(name, ticker, dateStr) {
  return `${BRIEF}

Mode three, position check on a stock Ricardo already owns. Today is ${dateStr}. Report signals on both sides so the owner decides. The decision is his.

Search the web for recent developments on ${name} (${ticker}): guidance changes, insider selling or buying, share dilution or offerings, missed or hit milestones, analyst actions, competitive threats, regulatory items.

Sort what you find into two buckets: signals that support the original case for owning it, and signals that weaken it. Only include what you actually found with a named source.

Respond with ONLY valid JSON, no markdown, no preamble. At most 3 items per bucket, every text field under 20 words.

{"supports":[{"signal":"what happened","why":"why it supports the case","source":"publication","age":"how recent"}],"weakens":[{"signal":"what happened","why":"why it weakens the case","source":"publication","age":"how recent"}],"note":"if nothing meaningful either way, say so plainly, else empty string"}`;
}

// Mode five, deep dive. One structured report per ticker that fuses a
// fundamentals analyst, a quality screener checklist, a technical chart
// read, and a news impact review into a single pass. Analysis and
// scenarios only, never predictions or advice.
function deepPrompt(name, ticker, dateStr) {
  return `${BRIEF}

Mode five, deep dive. Today is ${dateStr}. Build one structured research report on ${name} (${ticker}) combining four angles: fundamentals, a quality checklist, a technical read, and news impact.

Search the web for: what the company does and how it makes money, financial health and key ratios, competitive position, recent price action with support and resistance and volume behavior, and the latest news with short and long term implications.

STRICT RULES:
1. Only report what you actually found with named sources. Never invent numbers or ratios.
2. Checklist items are pass, fail, or unknown. Never mark pass without evidence. Honest unknowns.
3. The technical read describes likely scenarios, never predictions or price targets.
4. News impact is balanced, short term and long term, no buy or sell language.

Respond with ONLY valid JSON, no markdown, no preamble. Every text field under 20 words.

{"snapshot":{"what":"what the company does, plain language","model":"how it actually makes money","edge":"its competitive edge, or the lack of one","health":"financial health in plain words"},"checklist":{"valuation":"pass|fail|unknown","growth":"pass|fail|unknown","health":"pass|fail|unknown","moat":"pass|fail|unknown","sentiment":"pass|fail|unknown"},"technicals":{"trend":"up|down|sideways","levels":"key support and resistance in plain words","volume":"volume behavior lately","read":"likely scenarios, not predictions"},"news":[{"headline":"plain headline","shortTerm":"possible short term effect","longTerm":"possible long term effect","source":"publication","age":"how recent"}],"biggestRisk":"the single biggest risk in one line","confidence":"low|medium|high"}`;
}

// Mode six, daily brief. The ten minute morning routine as one button:
// market mood, driving themes, watchlist news, and a discipline check.
function briefPrompt(dateStr, tickers) {
  const wl = tickers.length
    ? `My starred watchlist: ${tickers.join(", ")}.`
    : "I have no starred tickers yet, so skip the watchlist section.";
  return `${BRIEF}

Mode six, daily brief. Today is ${dateStr}. ${wl}

Build my ten minute morning read in one pass. Search the web for: how US indexes or index futures and any major overnight macro moved and why, the two or three themes actually driving today, and any fresh news touching my watchlist tickers specifically.

STRICT RULES:
1. Only what you actually found with named sources. Never present recycled news as fresh.
2. If a watchlist ticker has no real fresh news, leave it out. Never force an item.
3. The discipline line is one honest observation about concentration or risk in the watchlist mix, never advice.

Respond with ONLY valid JSON, no markdown, no preamble. Every text field under 18 words.

{"market":{"mood":"risk_on|risk_off|mixed","summary":"the market this morning in one plain sentence","drivers":["driver one","driver two"]},"themes":[{"theme":"what is moving","why":"the real mechanism","tickers":["TICK"]}],"watchlist":[{"ticker":"TICK","item":"what happened","why":"real mechanism","source":"publication","age":"how recent"}],"discipline":"one honest reminder about the watchlist mix, no advice","note":"only if markets are quiet, else empty string"}`;
}

// Mode seven, wire triage. Takes the raw headlines pulled from the free
// wires and asks: which of these could move a specific stock before the
// market fully reacts, and in which direction does the pressure point.
// Direction of pressure is mechanics, never a buy or sell call.
function wirePrompt(dateStr, items) {
  const list = items
    .map((it, i) => `${i + 1}. [${it.source}] ${it.title}${it.age ? ` (${it.age})` : ""}`)
    .join("\n");
  return `${BRIEF}

Mode seven, wire triage. Today is ${dateStr}. Below are raw headlines pulled minutes ago from free public wires: SEC 8-K filings, insider Form 4 filings, press release wires, and news feeds. Most are noise. Your job is finding the few that could move a specific stock before the market fully reacts.

${list}

RULES:
1. Pick at most 6 items with a real mechanism connecting them to a specific stock. Skip fluff, ads, macro commentary with no ticker, and routine filings.
2. Map each pick to tickers. Only name a ticker you are certain of, else "?". Use web search only to verify a ticker or check whether the price already moved.
3. pressure is the direction this kind of news typically pushes the stock: up, down, or unclear. It describes mechanics. It is never a recommendation.
4. For Form 4 items, say whether it is buying or selling. Executive buying with their own money is the stronger signal.
5. n is the number of the headline in the list above. Keep it exact.

Respond with ONLY valid JSON, no markdown, no preamble. Every text field under 18 words.

{"picks":[{"n":1,"headline":"short restatement","tickers":["TICK"],"mechanism":"why this moves the stock","pressure":"up|down|unclear","reacted":"no|partial|yes","confidence":"low|medium|high"}],"note":"only if nothing on the wire is actionable, else empty string"}`;
}

function fmtAge(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function salvageArray(clean, key) {
  const kIdx = clean.indexOf(`"${key}"`);
  if (kIdx === -1) return null;
  const aIdx = clean.indexOf("[", kIdx);
  if (aIdx === -1) return null;
  const items = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = aIdx + 1; i < clean.length; i++) {
    const ch = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { items.push(JSON.parse(clean.slice(objStart, i + 1))); } catch (e) {}
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return items.length ? items : null;
}

function extractJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("no json");
  for (let end = clean.lastIndexOf("}"); end > start; end = clean.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch (e) {}
  }
  // Response got cut off mid-write. Rescue every complete item instead of failing.
  const events = salvageArray(clean, "events");
  if (events) return { events, note: "" };
  const candidates = salvageArray(clean, "candidates");
  if (candidates) return { candidates, note: "" };
  const supports = salvageArray(clean, "supports");
  if (supports) return { supports, weakens: salvageArray(clean, "weakens") || [], note: "" };
  const picks = salvageArray(clean, "picks");
  if (picks) return { picks, note: "" };
  throw new Error("unparseable json");
}

async function callClaude(prompt, retries = 2, maxTokens = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // The Anthropic key lives on the server. The browser only sends
      // the prompt to our own /api/scan route, which forwards it.
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, maxTokens }),
      });
      const data = await response.json();
      const text = (data.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return extractJson(text);
    } catch (e) {
      if (attempt === retries) throw e;
    }
  }
}

function ConfidenceMeter({ level, color }) {
  const lit = CONF_LEVELS[level] || 1;
  return (
    <div className="flex flex-col-reverse gap-1" title={`Confidence: ${level}`}>
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-sm" style={{ width: 6, height: 10, background: i <= lit ? color : C.line, opacity: i <= lit ? 1 : 0.6 }} />
      ))}
    </div>
  );
}

function FreshnessTag({ ev }) {
  const map = {
    fresh: { label: "Fresh signal", color: C.green },
    developing: { label: "Developing", color: C.gold },
    priced_in: { label: "Mostly priced in", color: C.dim },
  };
  const m = map[ev.freshness] || map.developing;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: `1px solid ${m.color}`, color: m.color, fontFamily: "'IBM Plex Mono', monospace" }}>
      {m.label}
    </span>
  );
}

function TickerChip({ company, starred, onToggle }) {
  const unknown = !company.ticker || company.ticker === "?";
  return (
    <button
      onClick={() => !unknown && onToggle(company)}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm"
      style={{
        background: starred ? "rgba(245,198,100,0.12)" : C.panelSoft,
        border: `1px solid ${starred ? C.gold : C.line}`,
        color: unknown ? C.dim : starred ? C.gold : C.text,
        fontFamily: "'IBM Plex Mono', monospace",
        cursor: unknown ? "default" : "pointer",
      }}
      title={unknown ? "Ticker not verified" : starred ? "Remove from list" : "Add to follow up list"}
    >
      <span style={{ fontSize: 13 }}>{unknown ? "\u2013" : starred ? "\u2605" : "\u2606"}</span>
      {unknown ? "n/a" : company.ticker}
    </button>
  );
}

function RelTag({ rel }) {
  const r = REL[rel] || REL.direct;
  return (
    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: r.color, border: `1px solid ${C.line}` }}>
      {r.label}
    </span>
  );
}

function CheckPill({ name, value, dict = CHECKS }) {
  const meta = dict[name];
  const color = value === "pass" ? C.green : value === "fail" ? C.red : C.dim;
  const mark = value === "pass" ? "\u2713" : value === "fail" ? "\u2717" : "?";
  return (
    <span
      className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
      style={{ border: `1px solid ${color}`, color, background: "rgba(255,255,255,0.02)" }}
      title={meta.help}
    >
      <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{mark}</span> {meta.label}
    </span>
  );
}

function EventCard({ ev, watch, onToggle }) {
  const [open, setOpen] = useState(false);
  const u = URGENCY[ev.urgency] || URGENCY.context;
  const tickers = (ev.companies || []).map((c) => c.ticker).filter((t) => t && t !== "?");
  return (
    <div className="rounded-lg overflow-hidden flex" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <div style={{ width: 4, background: u.color, flexShrink: 0 }} />
      <div className="flex-1">
        <button onClick={() => setOpen(!open)} className="w-full text-left p-4 flex items-start justify-between gap-3" style={{ background: "transparent", border: "none", cursor: "pointer", color: C.text }}>
          <div className="flex-1">
            <h3 className="text-base leading-snug" style={{ fontWeight: 600 }}>{ev.headline}</h3>
            <p className="text-xs mt-1" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
              {tickers.join("  ")} {tickers.length > 0 ? "\u00b7 " : ""}{ev.age || ""} \u00b7 tap to {open ? "close" : "expand"}
            </p>
          </div>
          <ConfidenceMeter level={ev.confidence} color={u.color} />
        </button>

        {open && (
          <div className="px-4 pb-4">
            <p className="text-sm leading-relaxed" style={{ color: C.dim }}>{ev.what}</p>
            <div className="mt-3 space-y-2">
              {(ev.companies || []).map((co, i) => (
                <div key={i} className="flex items-start gap-2 flex-wrap">
                  <TickerChip company={co} starred={watch.some((w) => w.ticker === co.ticker)} onToggle={onToggle} />
                  <RelTag rel={co.rel} />
                  <p className="text-sm leading-relaxed pt-0.5 w-full" style={{ color: C.text, opacity: 0.85 }}>
                    <span style={{ color: C.dim }}>{co.name}: </span>{co.why}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <FreshnessTag ev={ev} />
              <span className="text-xs" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
                {ev.source} \u00b7 {ev.age}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiamondCard({ cand, watch, onToggle }) {
  const score = Object.values(cand.checks || {}).filter((v) => v === "pass").length;
  return (
    <div className="rounded-lg overflow-hidden flex" style={{ background: C.panel, border: `1px solid ${score >= 3 ? C.violet : C.line}` }}>
      <div style={{ width: 4, background: C.violet, flexShrink: 0, opacity: 0.3 + score * 0.175 }} />
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <TickerChip company={cand} starred={watch.some((w) => w.ticker === cand.ticker)} onToggle={onToggle} />
              <span className="text-sm" style={{ color: C.text, fontWeight: 600 }}>{cand.name}</span>
              <span className="text-sm" style={{ color: C.violet, fontFamily: "'IBM Plex Mono', monospace" }}>{cand.price}</span>
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded" style={{ color: C.violet, border: `1px solid ${C.violet}`, fontFamily: "'IBM Plex Mono', monospace" }}>
            {score}/4 checks
          </span>
        </div>

        <p className="mt-2 text-sm leading-relaxed" style={{ color: C.text, opacity: 0.9 }}>
          <span style={{ color: C.dim }}>Catalyst: </span>{cand.catalyst} <span style={{ color: C.gold }}>({cand.date})</span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {["catalyst", "cash", "insiders", "dilution"].map((k) => (
            <CheckPill key={k} name={k} value={(cand.checks || {})[k] || "unknown"} />
          ))}
        </div>

        <p className="mt-3 text-sm" style={{ color: C.red, opacity: 0.9 }}>
          <span style={{ color: C.dim }}>Biggest risk: </span>{cand.risk}
        </p>
        <p className="mt-1 text-xs" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
          Verified via {cand.source}
        </p>
      </div>
    </div>
  );
}

// ---------- Live watcher (Finnhub WebSocket) ----------

const WINDOW_MS = 5 * 60 * 1000;
const PRICE_MOVE_PCT = 1.5;
const VOL_SPIKE_X = 4;
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

// The Finnhub key comes from the environment now, never hardcoded.
// It is fine for this key to reach the browser because the WebSocket
// connects directly from the page, but it must not live in the repo.
const DEFAULT_KEYS = [import.meta.env.VITE_FINNHUB_KEY].filter(Boolean);

function Watcher({ watch, onExplain, explaining }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState("off");
  const [alerts, setAlerts] = useState([]);
  const [prices, setPrices] = useState({});
  const wsRef = useRef(null);
  const bufRef = useRef({});
  const lastAlertRef = useRef({});
  const sessionVolRef = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const k = await storage.get("pulse-finnhub-key");
        setKey(k && k.value ? k.value : DEFAULT_KEYS[0] || "");
      } catch (e) {
        setKey(DEFAULT_KEYS[0] || "");
      }
    })();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  async function saveKey(v) {
    setKey(v);
    try { await storage.set("pulse-finnhub-key", v); } catch (e) {}
  }

  function handleTrades(trades) {
    const now = Date.now();
    const priceUpdates = {};
    for (const t of trades) {
      const sym = t.s;
      if (!bufRef.current[sym]) bufRef.current[sym] = [];
      bufRef.current[sym].push({ t: now, p: t.p, v: t.v || 0 });
      priceUpdates[sym] = t.p;
      bufRef.current[sym] = bufRef.current[sym].filter((x) => now - x.t <= WINDOW_MS);
      if (!sessionVolRef.current[sym]) sessionVolRef.current[sym] = { total: 0, since: now };
      sessionVolRef.current[sym].total += t.v || 0;
    }
    setPrices((p) => ({ ...p, ...priceUpdates }));

    for (const sym of Object.keys(priceUpdates)) {
      const buf = bufRef.current[sym];
      if (buf.length < 5) continue;
      const first = buf[0].p;
      const last = buf[buf.length - 1].p;
      const pct = ((last - first) / first) * 100;
      const winVol = buf.reduce((s, x) => s + x.v, 0);
      const sess = sessionVolRef.current[sym];
      const elapsedWindows = Math.max(1, (now - sess.since) / WINDOW_MS);
      const avgWinVol = sess.total / elapsedWindows;
      const volX = avgWinVol > 0 ? winVol / avgWinVol : 0;

      const priceTrip = Math.abs(pct) >= PRICE_MOVE_PCT;
      const volTrip = volX >= VOL_SPIKE_X && elapsedWindows >= 2;
      if (!priceTrip && !(volTrip && Math.abs(pct) >= 0.5)) continue;

      const lastA = lastAlertRef.current[sym] || 0;
      if (now - lastA < ALERT_COOLDOWN_MS) continue;
      lastAlertRef.current[sym] = now;

      const desc = `${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% in 5 min${volTrip ? `, volume about ${volX.toFixed(0)}x normal` : ""}`;
      setAlerts((a) => [
        { sym, desc, at: new Date().toLocaleTimeString(), dir: pct >= 0 ? "up" : "down" },
        ...a.slice(0, 9),
      ]);
    }
  }

  function connect() {
    if (watch.length === 0) return;
    const typed = key.trim();
    const candidates = [typed, ...DEFAULT_KEYS.filter((k) => k !== typed)].filter(Boolean);
    attempt(candidates, 0);
  }

  function attempt(cands, i) {
    if (i >= cands.length) {
      setStatus("error");
      return;
    }
    setStatus("connecting");
    let opened = false;
    try {
      const ws = new WebSocket(`wss://ws.finnhub.io?token=${cands[i]}`);
      wsRef.current = ws;
      ws.onopen = () => {
        opened = true;
        setStatus("live");
        saveKey(cands[i]);
        watch.forEach((w) => ws.send(JSON.stringify({ type: "subscribe", symbol: w.ticker })));
      };
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "trade" && data.data) handleTrades(data.data);
        } catch (e) {}
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        if (!opened) attempt(cands, i + 1);
        else setStatus("off");
      };
    } catch (e) {
      attempt(cands, i + 1);
    }
  }

  function disconnect() {
    if (wsRef.current) wsRef.current.close();
    wsRef.current = null;
    setStatus("off");
  }

  return (
    <section className="mb-5 rounded-lg p-4" style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs" style={{ color: C.soon, fontFamily: "'IBM Plex Mono', monospace" }}>
          LIVE WATCHER {status === "live" && <span style={{ color: C.green }}>\u25cf connected</span>}
          {status === "connecting" && <span style={{ color: C.gold }}> connecting...</span>}
          {status === "error" && <span style={{ color: C.red }}> connection failed, check your key</span>}
        </p>
        {status === "live" ? (
          <button onClick={disconnect} className="text-xs px-2.5 py-1 rounded" style={{ border: `1px solid ${C.line}`, color: C.dim, background: "transparent", cursor: "pointer" }}>
            Stop watching
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={watch.length === 0}
            className="text-xs px-2.5 py-1 rounded"
            style={{
              border: `1px solid ${watch.length > 0 ? C.green : C.line}`,
              color: watch.length > 0 ? C.green : C.dim,
              background: "transparent",
              cursor: watch.length > 0 ? "pointer" : "default",
            }}
          >
            Start watching my list
          </button>
        )}
      </div>

      {status !== "live" && (
        <div className="mt-3">
          <input
            type="password"
            value={key}
            onChange={(e) => saveKey(e.target.value)}
            placeholder="Paste your free Finnhub API key"
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}
          />
          <p className="text-xs mt-2 leading-relaxed" style={{ color: C.dim }}>
            {key ? "Your key is loaded. Just hit Start." : "Paste your free Finnhub key from finnhub.io. It stays in your browser."} Works during US market hours. {watch.length === 0 ? "Star at least one ticker first." : `Watching ${watch.length} ticker${watch.length > 1 ? "s" : ""} once started.`}
          </p>
        </div>
      )}

      {status === "live" && Object.keys(prices).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {watch.map((w) => (
            <span key={w.ticker} className="text-xs px-2 py-1 rounded" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, fontFamily: "'IBM Plex Mono', monospace" }}>
              {w.ticker} {prices[w.ticker] ? `$${prices[w.ticker].toFixed(2)}` : "waiting..."}
            </span>
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mt-3 space-y-2">
          {alerts.map((a, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-md px-3 py-2" style={{ background: C.panel, border: `1px solid ${a.dir === "up" ? C.green : C.red}` }}>
              <p className="text-sm" style={{ color: C.text }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: a.dir === "up" ? C.green : C.red }}>{a.sym}</span> {a.desc} <span className="text-xs" style={{ color: C.dim }}>{a.at}</span>
              </p>
              <button
                onClick={() => onExplain({ ticker: a.sym, name: a.sym }, `${a.sym} ${a.desc}`)}
                disabled={explaining}
                className="text-xs px-2.5 py-1.5 rounded whitespace-nowrap"
                style={{ background: C.gold, color: "#151206", border: "none", cursor: explaining ? "default" : "pointer", fontWeight: 600, opacity: explaining ? 0.5 : 1 }}
              >
                Explain this move
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function MarketPulse() {
  const [tab, setTab] = useState("pulse"); // pulse | diamonds
  const [scope, setScope] = useState("market");
  const [events, setEvents] = useState([]);
  const [note, setNote] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadLine, setLoadLine] = useState(0);
  const [error, setError] = useState("");
  const [watch, setWatch] = useState([]);
  const [focus, setFocus] = useState(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [ownedCheck, setOwnedCheck] = useState(null);
  const [ownedLoading, setOwnedLoading] = useState(false);
  const [diamonds, setDiamonds] = useState([]);
  const [diamondNote, setDiamondNote] = useState("");
  const [diamondRun, setDiamondRun] = useState(null);
  const [diamondLoading, setDiamondLoading] = useState(false);
  const [deep, setDeep] = useState(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [brief, setBrief] = useState(null);
  const [briefRun, setBriefRun] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [wire, setWire] = useState([]);
  const [wireAt, setWireAt] = useState(null);
  const [wireLoading, setWireLoading] = useState(false);
  const [wireFailed, setWireFailed] = useState([]);
  const [autoWire, setAutoWire] = useState(false);
  const [picks, setPicks] = useState([]);
  const [picksNote, setPicksNote] = useState("");
  const [picksRun, setPicksRun] = useState(null);
  const [picksLoading, setPicksLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const w = await storage.get("pulse-watchlist");
        if (w) setWatch(JSON.parse(w.value));
      } catch (e) {}
      try {
        const s = await storage.get("pulse-last-scan");
        if (s) {
          const parsed = JSON.parse(s.value);
          setEvents(parsed.events || []);
          setNote(parsed.note || "");
          setLastRun(parsed.at || null);
          setScope(parsed.scope || "market");
        }
      } catch (e) {}
      try {
        const d = await storage.get("pulse-diamonds");
        if (d) {
          const parsed = JSON.parse(d.value);
          setDiamonds(parsed.candidates || []);
          setDiamondNote(parsed.note || "");
          setDiamondRun(parsed.at || null);
        }
      } catch (e) {}
      try {
        const b = await storage.get("pulse-daily-brief");
        if (b) {
          const parsed = JSON.parse(b.value);
          setBrief(parsed.data || null);
          setBriefRun(parsed.at || null);
        }
      } catch (e) {}
      try {
        const p = await storage.get("pulse-wire-picks");
        if (p) {
          const parsed = JSON.parse(p.value);
          setPicks(parsed.picks || []);
          setPicksNote(parsed.note || "");
          setPicksRun(parsed.at || null);
        }
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    if (!loading && !diamondLoading && !briefLoading && !picksLoading) return;
    const id = setInterval(() => setLoadLine((n) => (n + 1) % 5), 5000);
    return () => clearInterval(id);
  }, [loading, diamondLoading, briefLoading, picksLoading]);

  // While the wire tab is open with auto refresh on, re-pull the raw
  // feeds every two minutes. Only the free feeds refresh automatically;
  // the intelligence pass stays a button because it costs tokens.
  useEffect(() => {
    if (tab !== "wire" || !autoWire) return;
    const id = setInterval(() => {
      loadWire();
    }, 120000);
    return () => clearInterval(id);
  }, [tab, autoWire]);

  async function saveWatch(next) {
    setWatch(next);
    try { await storage.set("pulse-watchlist", JSON.stringify(next)); } catch (e) {}
  }

  function toggleWatch(company) {
    const exists = watch.some((w) => w.ticker === company.ticker);
    const next = exists
      ? watch.filter((w) => w.ticker !== company.ticker)
      : [...watch, { ticker: company.ticker, name: company.name, owned: false }];
    saveWatch(next);
  }

  function toggleOwned(ticker) {
    saveWatch(watch.map((w) => (w.ticker === ticker ? { ...w, owned: !w.owned } : w)));
  }

  async function runScan() {
    setLoading(true);
    setError("");
    setLoadLine(0);
    setFocus(null);
    setOwnedCheck(null);
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(scanPrompt(SCOPES[scope].prompt, dateStr));
      const at = new Date().toLocaleString();
      setEvents(result.events || []);
      setNote(result.note || "");
      setLastRun(at);
      try {
        await storage.set("pulse-last-scan", JSON.stringify({ events: result.events || [], note: result.note || "", at, scope }));
      } catch (e) {}
    } catch (e) {
      setError("The scan did not come back clean, even after an automatic retry. Hit Run fresh scan again.");
    }
    setLoading(false);
  }

  async function runDiamonds() {
    setDiamondLoading(true);
    setError("");
    setLoadLine(0);
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(diamondPrompt(dateStr));
      const at = new Date().toLocaleString();
      const sorted = (result.candidates || []).sort((a, b) => {
        const sa = Object.values(a.checks || {}).filter((v) => v === "pass").length;
        const sb = Object.values(b.checks || {}).filter((v) => v === "pass").length;
        return sb - sa;
      });
      setDiamonds(sorted);
      setDiamondNote(result.note || "");
      setDiamondRun(at);
      try {
        await storage.set("pulse-diamonds", JSON.stringify({ candidates: sorted, note: result.note || "", at }));
      } catch (e) {}
    } catch (e) {
      setError("The diamond hunt did not come back clean, even after a retry. Run it again.");
    }
    setDiamondLoading(false);
  }

  async function runFocus(item, moveContext) {
    setFocusLoading(true);
    setFocus({ ...item, events: [], note: "" });
    setOwnedCheck(null);
    setDeep(null);
    setError("");
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(focusPrompt(item.name, item.ticker, dateStr, moveContext));
      setFocus({ ...item, events: result.events || [], note: result.note || "" });
    } catch (e) {
      setFocus(null);
      setError(`The follow up check on ${item.ticker} did not come back clean. Try it again.`);
    }
    setFocusLoading(false);
  }

  async function runOwnedCheck(item) {
    setOwnedLoading(true);
    setOwnedCheck({ ...item, supports: [], weakens: [], note: "" });
    setFocus(null);
    setDeep(null);
    setError("");
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(ownedPrompt(item.name, item.ticker, dateStr));
      setOwnedCheck({ ...item, supports: result.supports || [], weakens: result.weakens || [], note: result.note || "" });
    } catch (e) {
      setOwnedCheck(null);
      setError(`The position check on ${item.ticker} did not come back clean. Try it again.`);
    }
    setOwnedLoading(false);
  }

  async function runDeep(item) {
    setDeepLoading(true);
    setDeep({ ...item, data: null });
    setFocus(null);
    setOwnedCheck(null);
    setError("");
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(deepPrompt(item.name, item.ticker, dateStr), 2, 1600);
      setDeep({ ...item, data: result });
    } catch (e) {
      setDeep(null);
      setError(`The deep dive on ${item.ticker} did not come back clean. Try it again.`);
    }
    setDeepLoading(false);
  }

  async function runBrief() {
    setBriefLoading(true);
    setError("");
    setLoadLine(0);
    try {
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(briefPrompt(dateStr, watch.map((w) => w.ticker)), 2, 1400);
      const at = new Date().toLocaleString();
      setBrief(result);
      setBriefRun(at);
      try {
        await storage.set("pulse-daily-brief", JSON.stringify({ data: result, at }));
      } catch (e) {}
    } catch (e) {
      setError("The morning brief did not come back clean, even after a retry. Run it again.");
    }
    setBriefLoading(false);
  }

  async function loadWire() {
    setWireLoading(true);
    setError("");
    try {
      const r = await fetch("/api/wire");
      const data = await r.json();
      const items = (data.items || []).map((it) => ({ ...it, age: fmtAge(it.at) }));
      setWire(items);
      setWireAt(new Date().toLocaleTimeString());
      setWireFailed(data.failed || []);
      setWireLoading(false);
      return items;
    } catch (e) {
      setError("Could not pull the wire feeds. Check that the API server is running, then try again.");
      setWireLoading(false);
      return [];
    }
  }

  async function runPicks() {
    setPicksLoading(true);
    setError("");
    setLoadLine(0);
    try {
      let items = wire;
      if (items.length === 0) items = await loadWire();
      if (items.length === 0) throw new Error("no wire items");
      const batch = items.slice(0, 40);
      const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const result = await callClaude(wirePrompt(dateStr, batch), 2, 1600);
      const at = new Date().toLocaleString();
      // Reattach the original link and source so every pick stays traceable.
      const enriched = (result.picks || []).map((p) => {
        const src = batch[(p.n || 0) - 1];
        return { ...p, link: src ? src.link : "", source: src ? src.source : "", age: src ? src.age : "" };
      });
      setPicks(enriched);
      setPicksNote(result.note || "");
      setPicksRun(at);
      try {
        await storage.set("pulse-wire-picks", JSON.stringify({ picks: enriched, note: result.note || "", at }));
      } catch (e) {}
    } catch (e) {
      setError("The wire triage did not come back clean, even after a retry. Run it again.");
    }
    setPicksLoading(false);
  }

  const groups = ["now", "soon", "context"]
    .map((k) => ({ key: k, ...URGENCY[k], items: events.filter((e) => e.urgency === k) }))
    .filter((g) => g.items.length > 0);

  const busy = loading || diamondLoading || briefLoading || picksLoading;
  const busyLines = diamondLoading ? DIAMOND_LINES : briefLoading ? BRIEF_LINES : picksLoading ? WIRE_LINES : LOADING_LINES;

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
        body { margin: 0; }
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        @keyframes pulseDot { 0%,100% { opacity: 0.3 } 50% { opacity: 1 } }
      `}</style>

      <div className="max-w-3xl mx-auto px-4 py-6" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        <header className="mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl tracking-tight" style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 700, letterSpacing: "-0.02em" }}>
                Market Pulse
              </h1>
              <p className="text-sm mt-0.5" style={{ color: C.dim }}>Events first, then the stocks they touch</p>
            </div>
            {tab === "pulse" ? (
              <button
                onClick={runScan}
                disabled={busy}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: busy ? C.panel : C.gold, color: busy ? C.dim : "#151206", border: `1px solid ${busy ? C.line : C.gold}`, cursor: busy ? "default" : "pointer" }}
              >
                {loading ? "Scanning..." : "Run fresh scan"}
              </button>
            ) : tab === "diamonds" ? (
              <button
                onClick={runDiamonds}
                disabled={busy}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: busy ? C.panel : C.violet, color: busy ? C.dim : "#1A0F2E", border: `1px solid ${busy ? C.line : C.violet}`, cursor: busy ? "default" : "pointer" }}
              >
                {diamondLoading ? "Hunting..." : "Hunt for diamonds"}
              </button>
            ) : tab === "brief" ? (
              <button
                onClick={runBrief}
                disabled={busy}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: busy ? C.panel : C.soon, color: busy ? C.dim : "#06121C", border: `1px solid ${busy ? C.line : C.soon}`, cursor: busy ? "default" : "pointer" }}
              >
                {briefLoading ? "Reading the market..." : "Run morning brief"}
              </button>
            ) : (
              <button
                onClick={runPicks}
                disabled={busy || wireLoading}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ background: busy ? C.panel : C.green, color: busy ? C.dim : "#0A1A0F", border: `1px solid ${busy ? C.line : C.green}`, cursor: busy ? "default" : "pointer" }}
              >
                {picksLoading ? "Triaging the wire..." : "Find the movers"}
              </button>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setTab("pulse")}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ background: tab === "pulse" ? "rgba(245,198,100,0.14)" : "transparent", border: `1px solid ${tab === "pulse" ? C.gold : C.line}`, color: tab === "pulse" ? C.gold : C.dim, cursor: "pointer" }}
            >
              Market events
            </button>
            <button
              onClick={() => setTab("diamonds")}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ background: tab === "diamonds" ? "rgba(176,143,232,0.14)" : "transparent", border: `1px solid ${tab === "diamonds" ? C.violet : C.line}`, color: tab === "diamonds" ? C.violet : C.dim, cursor: "pointer" }}
            >
              Diamond scanner
            </button>
            <button
              onClick={() => setTab("brief")}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ background: tab === "brief" ? "rgba(95,178,232,0.14)" : "transparent", border: `1px solid ${tab === "brief" ? C.soon : C.line}`, color: tab === "brief" ? C.soon : C.dim, cursor: "pointer" }}
            >
              Daily brief
            </button>
            <button
              onClick={() => { setTab("wire"); if (wire.length === 0 && !wireLoading) loadWire(); }}
              className="px-3 py-1.5 rounded-md text-sm"
              style={{ background: tab === "wire" ? "rgba(123,201,143,0.14)" : "transparent", border: `1px solid ${tab === "wire" ? C.green : C.line}`, color: tab === "wire" ? C.green : C.dim, cursor: "pointer" }}
            >
              Live wire
            </button>
            {tab === "pulse" &&
              Object.entries(SCOPES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setScope(k)}
                  className="px-3 py-1.5 rounded-md text-sm"
                  style={{ background: scope === k ? "rgba(95,178,232,0.14)" : "transparent", border: `1px solid ${scope === k ? C.soon : C.line}`, color: scope === k ? C.soon : C.dim, cursor: "pointer" }}
                >
                  {v.label}
                </button>
              ))}
            {(tab === "pulse" ? lastRun : tab === "diamonds" ? diamondRun : tab === "brief" ? briefRun : picksRun) && (
              <span className="text-xs ml-auto" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
                Last run {tab === "pulse" ? lastRun : tab === "diamonds" ? diamondRun : tab === "brief" ? briefRun : picksRun}
              </span>
            )}
          </div>
        </header>

        {watch.length > 0 && (
          <section className="mb-5 rounded-lg p-3" style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}>
            <p className="text-xs mb-2" style={{ color: C.gold, fontFamily: "'IBM Plex Mono', monospace" }}>FOLLOW UP LIST</p>
            <div className="space-y-2">
              {watch.map((w) => (
                <div key={w.ticker} className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => runFocus(w)}
                    disabled={focusLoading || ownedLoading}
                    className="px-2.5 py-1 rounded-md text-sm"
                    style={{ background: "rgba(245,198,100,0.1)", border: `1px solid ${C.gold}`, color: C.gold, fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer" }}
                    title={`Run a focused news check on ${w.name}`}
                  >
                    {w.ticker} \u2192
                  </button>
                  <button
                    onClick={() => runDeep(w)}
                    disabled={focusLoading || ownedLoading || deepLoading}
                    className="text-xs px-2 py-1 rounded"
                    style={{ border: `1px solid ${C.violet}`, color: C.violet, background: "transparent", cursor: "pointer" }}
                    title={`Full research report on ${w.name}: fundamentals, checklist, chart read, and news`}
                  >
                    Deep dive
                  </button>
                  <button
                    onClick={() => toggleOwned(w.ticker)}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      border: `1px solid ${w.owned ? C.green : C.line}`,
                      color: w.owned ? C.green : C.dim,
                      background: w.owned ? "rgba(123,201,143,0.08)" : "transparent",
                      cursor: "pointer",
                    }}
                    title={w.owned ? "Marked as owned" : "Mark as a stock you own"}
                  >
                    {w.owned ? "\u2713 I own this" : "I own this"}
                  </button>
                  {w.owned && (
                    <button
                      onClick={() => runOwnedCheck(w)}
                      disabled={focusLoading || ownedLoading}
                      className="text-xs px-2 py-1 rounded"
                      style={{ border: `1px solid ${C.soon}`, color: C.soon, background: "transparent", cursor: "pointer" }}
                      title="Check signals that support or weaken the case for holding"
                    >
                      Position check
                    </button>
                  )}
                  <button
                    onClick={() => toggleWatch(w)}
                    className="text-xs px-1.5 py-1 rounded ml-auto"
                    style={{ color: C.dim, background: "transparent", border: "none", cursor: "pointer" }}
                    title={`Remove ${w.ticker}`}
                  >
                    \u2715
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: C.dim }}>
              Tap a ticker for a news check. Mark stocks you own to unlock the position check, which reports signals both ways so you decide.
            </p>
          </section>
        )}

        <Watcher watch={watch} onExplain={runFocus} explaining={focusLoading || ownedLoading} />

        {ownedCheck && (
          <section className="mb-5 rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.soon}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: C.soon }}>
                Position check: {ownedCheck.name} ({ownedCheck.ticker})
              </p>
              <button onClick={() => setOwnedCheck(null)} className="text-xs px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.line}`, background: "transparent", cursor: "pointer" }}>
                Close
              </button>
            </div>
            {ownedLoading ? (
              <p className="text-sm" style={{ color: C.dim }}>Checking signals both ways on {ownedCheck.ticker}... about 30 seconds.</p>
            ) : ownedCheck.note && ownedCheck.supports.length === 0 && ownedCheck.weakens.length === 0 ? (
              <p className="text-sm" style={{ color: C.dim }}>{ownedCheck.note}</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs mb-2" style={{ color: C.green, fontFamily: "'IBM Plex Mono', monospace" }}>SUPPORTS THE CASE</p>
                  {ownedCheck.supports.length === 0 ? (
                    <p className="text-sm" style={{ color: C.dim }}>Nothing found on this side.</p>
                  ) : (
                    ownedCheck.supports.map((s, i) => (
                      <p key={i} className="text-sm leading-relaxed mb-1.5" style={{ color: C.text }}>
                        {s.signal}. <span style={{ color: C.dim }}>{s.why} ({s.source}, {s.age})</span>
                      </p>
                    ))
                  )}
                </div>
                <div>
                  <p className="text-xs mb-2" style={{ color: C.red, fontFamily: "'IBM Plex Mono', monospace" }}>WEAKENS THE CASE</p>
                  {ownedCheck.weakens.length === 0 ? (
                    <p className="text-sm" style={{ color: C.dim }}>Nothing found on this side.</p>
                  ) : (
                    ownedCheck.weakens.map((s, i) => (
                      <p key={i} className="text-sm leading-relaxed mb-1.5" style={{ color: C.text }}>
                        {s.signal}. <span style={{ color: C.dim }}>{s.why} ({s.source}, {s.age})</span>
                      </p>
                    ))
                  )}
                </div>
                <p className="text-xs" style={{ color: C.dim }}>Signals only, both sides shown. The decision is yours.</p>
              </div>
            )}
          </section>
        )}

        {deep && (
          <section className="mb-5 rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.violet}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: C.violet }}>
                Deep dive: {deep.name} ({deep.ticker})
              </p>
              <button onClick={() => setDeep(null)} className="text-xs px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.line}`, background: "transparent", cursor: "pointer" }}>
                Close
              </button>
            </div>
            {deepLoading ? (
              <p className="text-sm" style={{ color: C.dim }}>
                Building the full report on {deep.ticker}: fundamentals, quality checklist, chart read, and news impact... about a minute.
              </p>
            ) : deep.data ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs mb-2" style={{ color: C.violet, fontFamily: "'IBM Plex Mono', monospace" }}>SNAPSHOT</p>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>What they do: </span>{(deep.data.snapshot || {}).what || "unknown"}
                  </p>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>How they make money: </span>{(deep.data.snapshot || {}).model || "unknown"}
                  </p>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>Edge: </span>{(deep.data.snapshot || {}).edge || "unknown"}
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>Financial health: </span>{(deep.data.snapshot || {}).health || "unknown"}
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-2" style={{ color: C.violet, fontFamily: "'IBM Plex Mono', monospace" }}>QUALITY CHECKLIST</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(DEEP_CHECKS).map((k) => (
                      <CheckPill key={k} name={k} value={(deep.data.checklist || {})[k] || "unknown"} dict={DEEP_CHECKS} />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs mb-2" style={{ color: C.violet, fontFamily: "'IBM Plex Mono', monospace" }}>CHART READ</p>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>Trend: </span>
                    <span style={{ color: (deep.data.technicals || {}).trend === "up" ? C.green : (deep.data.technicals || {}).trend === "down" ? C.red : C.gold }}>
                      {(deep.data.technicals || {}).trend || "unknown"}
                    </span>
                    <span style={{ color: C.dim }}> {"·"} Levels: </span>{(deep.data.technicals || {}).levels || "unknown"}
                  </p>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>Volume: </span>{(deep.data.technicals || {}).volume || "unknown"}
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: C.text }}>
                    <span style={{ color: C.dim }}>Scenarios: </span>{(deep.data.technicals || {}).read || "unknown"}
                  </p>
                </div>
                {(deep.data.news || []).length > 0 && (
                  <div>
                    <p className="text-xs mb-2" style={{ color: C.violet, fontFamily: "'IBM Plex Mono', monospace" }}>NEWS IMPACT</p>
                    {(deep.data.news || []).map((n, i) => (
                      <div key={i} className="mb-2">
                        <p className="text-sm leading-relaxed" style={{ color: C.text, fontWeight: 600 }}>{n.headline}</p>
                        <p className="text-sm leading-relaxed" style={{ color: C.text, opacity: 0.85 }}>
                          <span style={{ color: C.dim }}>Short term: </span>{n.shortTerm} <span style={{ color: C.dim }}>Long term: </span>{n.longTerm}
                        </p>
                        <p className="text-xs" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>{n.source} {"·"} {n.age}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-sm" style={{ color: C.red, opacity: 0.9 }}>
                  <span style={{ color: C.dim }}>Biggest risk: </span>{deep.data.biggestRisk || "unknown"}
                </p>
                <p className="text-xs" style={{ color: C.dim }}>
                  Research scorecard only, scenarios not predictions, never advice. Confidence: {deep.data.confidence || "low"}.
                </p>
              </div>
            ) : null}
          </section>
        )}

        {focus && (
          <section className="mb-5 rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.gold}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold" style={{ color: C.gold }}>
                Follow up: {focus.name} ({focus.ticker})
              </p>
              <button onClick={() => setFocus(null)} className="text-xs px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.line}`, background: "transparent", cursor: "pointer" }}>
                Close
              </button>
            </div>
            {focusLoading ? (
              <p className="text-sm" style={{ color: C.dim }}>Checking the latest on {focus.ticker}... about 30 seconds.</p>
            ) : focus.events.length === 0 ? (
              <p className="text-sm" style={{ color: C.dim }}>{focus.note || "Nothing meaningful found right now. That is a real answer, not a failure."}</p>
            ) : (
              <div className="space-y-3">
                {focus.events.map((ev, i) => (
                  <EventCard key={i} ev={ev} watch={watch} onToggle={toggleWatch} />
                ))}
              </div>
            )}
          </section>
        )}

        {busy && (
          <div className="rounded-lg p-5 mb-5 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: diamondLoading ? C.violet : C.gold, animation: `pulseDot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
            <div>
              <p className="text-sm" style={{ color: C.text }}>{busyLines[loadLine % busyLines.length]}</p>
              <p className="text-xs mt-0.5" style={{ color: C.dim }}>Live searches take 30 to 60 seconds. Real results, not cached.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg p-4 mb-5 text-sm" style={{ background: "rgba(224,108,95,0.1)", border: `1px solid ${C.red}`, color: C.red }}>
            {error}
          </div>
        )}

        {tab === "pulse" && (
          <>
            {!loading && events.length === 0 && !note && !error && (
              <div className="rounded-lg p-8 text-center" style={{ background: C.panelSoft, border: `1px dashed ${C.line}` }}>
                <p className="text-base" style={{ color: C.text }}>No scan yet.</p>
                <p className="text-sm mt-1" style={{ color: C.dim }}>
                  Pick a scope, hit Run fresh scan. Star tickers to build your list, mark the ones you own, and the live watcher can track them in real time.
                </p>
              </div>
            )}
            {!loading && note && events.length === 0 && (
              <div className="rounded-lg p-5" style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}>
                <p className="text-sm" style={{ color: C.text }}>{note}</p>
              </div>
            )}
            {!loading &&
              groups.map((g) => (
                <section key={g.key} className="mb-6">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: g.color, display: "inline-block" }} />
                    <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: g.color, fontFamily: "'IBM Plex Mono', monospace" }}>
                      {g.label}
                    </h2>
                    <span className="text-xs" style={{ color: C.dim }}>{g.blurb}</span>
                  </div>
                  <div className="space-y-3">
                    {g.items.map((ev, i) => (
                      <EventCard key={i} ev={ev} watch={watch} onToggle={toggleWatch} />
                    ))}
                  </div>
                </section>
              ))}
          </>
        )}

        {tab === "diamonds" && (
          <>
            <div className="rounded-lg p-3 mb-4 text-xs leading-relaxed" style={{ background: "rgba(176,143,232,0.06)", border: `1px solid ${C.violet}`, color: C.dim }}>
              <span style={{ color: C.violet }}>How this works: </span>
              only stocks under $5 with a real, dated, verifiable catalyst make the list. That is the hard gate. Then each one gets scored on four trap checks. A 4/4 is rare and worth your attention. A 1/4 just dodged you a bullet. Lottery ticket money only, never rent or ring money.
            </div>
            {!diamondLoading && diamonds.length === 0 && !diamondNote && (
              <div className="rounded-lg p-8 text-center" style={{ background: C.panelSoft, border: `1px dashed ${C.line}` }}>
                <p className="text-base" style={{ color: C.text }}>No hunt yet.</p>
                <p className="text-sm mt-1" style={{ color: C.dim }}>Hit Hunt for diamonds. It searches for sub $5 stocks with confirmed upcoming catalysts and scores each one.</p>
              </div>
            )}
            {!diamondLoading && diamondNote && diamonds.length === 0 && (
              <div className="rounded-lg p-5" style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}>
                <p className="text-sm" style={{ color: C.text }}>{diamondNote}</p>
              </div>
            )}
            {!diamondLoading && diamonds.length > 0 && (
              <div className="space-y-3">
                {diamonds.map((cand, i) => (
                  <DiamondCard key={i} cand={cand} watch={watch} onToggle={toggleWatch} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "brief" && (
          <>
            <div className="rounded-lg p-3 mb-4 text-xs leading-relaxed" style={{ background: "rgba(95,178,232,0.06)", border: `1px solid ${C.soon}`, color: C.dim }}>
              <span style={{ color: C.soon }}>How this works: </span>
              one button builds your ten minute morning read. Market mood and what is driving it, the themes moving money today, fresh news on your starred tickers, and one honest discipline reminder. Run it once before the open.
            </div>
            {!briefLoading && !brief && (
              <div className="rounded-lg p-8 text-center" style={{ background: C.panelSoft, border: `1px dashed ${C.line}` }}>
                <p className="text-base" style={{ color: C.text }}>No brief yet today.</p>
                <p className="text-sm mt-1" style={{ color: C.dim }}>Hit Run morning brief. Starring tickers first makes the watchlist section richer.</p>
              </div>
            )}
            {!briefLoading && brief && (
              <div className="space-y-5">
                {brief.market && (
                  <section className="rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <p className="text-xs" style={{ color: C.soon, fontFamily: "'IBM Plex Mono', monospace" }}>MARKET MOOD</p>
                      {MOODS[brief.market.mood] && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: `1px solid ${MOODS[brief.market.mood].color}`, color: MOODS[brief.market.mood].color, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {MOODS[brief.market.mood].label}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: C.text }}>{brief.market.summary}</p>
                    {(brief.market.drivers || []).map((d, i) => (
                      <p key={i} className="text-sm leading-relaxed mt-1" style={{ color: C.text, opacity: 0.85 }}>
                        <span style={{ color: C.dim }}>Driver: </span>{d}
                      </p>
                    ))}
                  </section>
                )}
                {(brief.themes || []).length > 0 && (
                  <section>
                    <p className="text-xs mb-2" style={{ color: C.soon, fontFamily: "'IBM Plex Mono', monospace" }}>TODAY'S THEMES</p>
                    <div className="space-y-3">
                      {(brief.themes || []).map((t, i) => (
                        <div key={i} className="rounded-lg p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                          <p className="text-sm leading-snug" style={{ color: C.text, fontWeight: 600 }}>{t.theme}</p>
                          <p className="text-sm leading-relaxed mt-1" style={{ color: C.dim }}>{t.why}</p>
                          {(t.tickers || []).length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(t.tickers || []).map((tk, j) => (
                                <TickerChip key={j} company={{ ticker: tk, name: tk }} starred={watch.some((w) => w.ticker === tk)} onToggle={toggleWatch} />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {(brief.watchlist || []).length > 0 && (
                  <section>
                    <p className="text-xs mb-2" style={{ color: C.gold, fontFamily: "'IBM Plex Mono', monospace" }}>YOUR TICKERS IN THE NEWS</p>
                    <div className="space-y-2">
                      {(brief.watchlist || []).map((w, i) => (
                        <div key={i} className="rounded-lg px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.gold}` }}>
                          <p className="text-sm leading-relaxed" style={{ color: C.text }}>
                            <span style={{ color: C.gold, fontFamily: "'IBM Plex Mono', monospace" }}>{w.ticker}</span> {w.item}
                          </p>
                          <p className="text-sm leading-relaxed" style={{ color: C.dim }}>
                            {w.why} <span className="text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>({w.source}, {w.age})</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {brief.discipline && (
                  <p className="text-sm rounded-lg px-4 py-3 leading-relaxed" style={{ background: "rgba(245,198,100,0.06)", border: `1px solid ${C.line}`, color: C.dim }}>
                    <span style={{ color: C.gold }}>Discipline check: </span>{brief.discipline}
                  </p>
                )}
                {brief.note && (
                  <p className="text-sm rounded-lg px-4 py-3" style={{ background: C.panelSoft, border: `1px solid ${C.line}`, color: C.text }}>{brief.note}</p>
                )}
              </div>
            )}
          </>
        )}

        {tab === "wire" && (
          <>
            <div className="rounded-lg p-3 mb-4 text-xs leading-relaxed" style={{ background: "rgba(123,201,143,0.06)", border: `1px solid ${C.green}`, color: C.dim }}>
              <span style={{ color: C.green }}>How this works: </span>
              this is the legal inside scoop. SEC filings, executive Form 4 buys and sells, and press releases hit these free public wires seconds after they publish, before most news sites rewrite them. Refresh pulls the raw feeds. Find the movers reads them and keeps only items with a real mechanism, mapped to tickers, with the direction the pressure points. Pressure is mechanics, never a buy or sell call. The decision is always yours.
            </div>

            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={loadWire}
                disabled={wireLoading}
                className="text-xs px-2.5 py-1.5 rounded"
                style={{ border: `1px solid ${C.green}`, color: C.green, background: "transparent", cursor: "pointer" }}
              >
                {wireLoading ? "Pulling feeds..." : "Refresh the wire"}
              </button>
              <button
                onClick={() => setAutoWire(!autoWire)}
                className="text-xs px-2.5 py-1.5 rounded"
                style={{ border: `1px solid ${autoWire ? C.green : C.line}`, color: autoWire ? C.green : C.dim, background: autoWire ? "rgba(123,201,143,0.08)" : "transparent", cursor: "pointer" }}
              >
                {autoWire ? "Auto refresh on, every 2 min" : "Auto refresh off"}
              </button>
              {wireAt && (
                <span className="text-xs ml-auto" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
                  Wire pulled {wireAt}
                </span>
              )}
            </div>

            {wireFailed.length > 0 && (
              <p className="text-xs mb-3" style={{ color: C.dim }}>
                Some feeds did not answer this time: {wireFailed.join(", ")}. The rest came through.
              </p>
            )}

            {picks.length > 0 && (
              <section className="mb-5">
                <p className="text-xs mb-2" style={{ color: C.green, fontFamily: "'IBM Plex Mono', monospace" }}>THE MOVERS</p>
                <div className="space-y-3">
                  {picks.map((p, i) => {
                    const pr = PRESSURE[p.pressure] || PRESSURE.unclear;
                    return (
                      <div key={i} className="rounded-lg overflow-hidden flex" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                        <div style={{ width: 4, background: pr.color, flexShrink: 0 }} />
                        <div className="flex-1 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-base leading-snug" style={{ color: C.text, fontWeight: 600 }}>{p.headline}</h3>
                            <ConfidenceMeter level={p.confidence} color={pr.color} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {(p.tickers || []).map((tk, j) => (
                              <TickerChip key={j} company={{ ticker: tk, name: tk }} starred={watch.some((w) => w.ticker === tk)} onToggle={toggleWatch} />
                            ))}
                            <span className="text-xs px-2 py-0.5 rounded-full" style={{ border: `1px solid ${pr.color}`, color: pr.color, fontFamily: "'IBM Plex Mono', monospace" }}>
                              {pr.mark} {pr.label}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.04)", color: C.dim, border: `1px solid ${C.line}` }}>
                              Market reacted: {p.reacted || "unknown"}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-relaxed" style={{ color: C.text, opacity: 0.85 }}>{p.mechanism}</p>
                          <p className="mt-1 text-xs" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
                            {p.source} {p.age ? `· ${p.age}` : ""}{" "}
                            {p.link && (
                              <a href={p.link} target="_blank" rel="noreferrer" style={{ color: C.soon }}>
                                open source
                              </a>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {!picksLoading && picksNote && picks.length === 0 && (
              <div className="rounded-lg p-5 mb-5" style={{ background: C.panelSoft, border: `1px solid ${C.line}` }}>
                <p className="text-sm" style={{ color: C.text }}>{picksNote}</p>
              </div>
            )}

            <section>
              <p className="text-xs mb-2" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>RAW WIRE, NEWEST FIRST</p>
              {wire.length === 0 && !wireLoading ? (
                <div className="rounded-lg p-8 text-center" style={{ background: C.panelSoft, border: `1px dashed ${C.line}` }}>
                  <p className="text-base" style={{ color: C.text }}>The wire is empty.</p>
                  <p className="text-sm mt-1" style={{ color: C.dim }}>Hit Refresh the wire to pull SEC filings, insider trades, press releases, and news.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {wire.slice(0, 40).map((it, i) => {
                    const k = KINDS[it.kind] || KINDS.news;
                    return (
                      <a
                        key={i}
                        href={it.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block px-3 py-2 rounded-md"
                        style={{ background: C.panelSoft, border: `1px solid ${C.line}`, textDecoration: "none" }}
                      >
                        <span className="text-xs px-1.5 py-0.5 rounded mr-2" style={{ color: k.color, border: `1px solid ${k.color}`, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {k.label}
                        </span>
                        <span className="text-sm" style={{ color: C.text }}>{it.title}</span>
                        <span className="text-xs ml-2" style={{ color: C.dim, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {it.source} {it.age ? `· ${it.age}` : ""}
                        </span>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        <footer className="mt-8 pt-4 text-xs leading-relaxed" style={{ borderTop: `1px solid ${C.line}`, color: C.dim }}>
          Signals and research scorecards only. Not investment advice, no price predictions, no buy sell or hold recommendations. Sub $5 stocks can lose most of their value fast. Free sources lag real events by minutes to hours.
        </footer>
      </div>
    </div>
  );
}
