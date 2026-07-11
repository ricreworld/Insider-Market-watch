// The raw wire. Pulls free, fast, PUBLIC sources server side, because
// the browser cannot reach them directly due to CORS. This is the legal
// version of the inside scoop: information seconds after it becomes
// public, not before. SEC 8-K filings are material corporate events,
// Form 4 filings are executives disclosing their own buys and sells,
// and press release wires carry company statements before most news
// sites rewrite them.

const FEEDS = [
  {
    source: "SEC 8-K wire",
    kind: "filing",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom",
  },
  {
    source: "SEC Form 4 wire",
    kind: "insider",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=40&output=atom",
  },
  {
    source: "CNBC",
    kind: "news",
    url: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
  },
  {
    source: "MarketWatch",
    kind: "news",
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
  },
  {
    source: "PR Newswire",
    kind: "pr",
    url: "https://www.prnewswire.com/rss/news-releases-list.rss",
  },
  {
    source: "GlobeNewswire",
    kind: "pr",
    url: "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
  },
];

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function decode(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks
    .slice(0, 15)
    .map((b) => {
      const linkAttr = b.match(/<link[^>]*href="([^"]+)"/i);
      const published = tagText(b, "pubDate") || tagText(b, "updated") || tagText(b, "published");
      const when = new Date(published);
      return {
        source: feed.source,
        kind: feed.kind,
        title: decode(tagText(b, "title")),
        link: linkAttr ? decode(linkAttr[1]) : decode(tagText(b, "link")),
        at: isNaN(when.getTime()) ? null : when.toISOString(),
      };
    })
    .filter((it) => it.title);
}

// Free ticker intelligence, no AI needed. The SEC publishes a free file
// mapping every registered company to its ticker. EDGAR feed titles
// carry the company's CIK number, so filings can be tagged with their
// ticker directly. Cached for a day between requests.
let tickerMapPromise = null;
let tickerMapAt = 0;

async function getTickerMap(userAgent) {
  const now = Date.now();
  if (!tickerMapPromise || now - tickerMapAt > 24 * 60 * 60 * 1000) {
    tickerMapAt = now;
    tickerMapPromise = fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return null;
        const byCik = {};
        for (const k of Object.keys(data)) {
          const row = data[k];
          byCik[String(row.cik_str).padStart(10, "0")] = row.ticker;
        }
        return byCik;
      })
      .catch(() => null);
  }
  const map = await tickerMapPromise;
  if (!map) tickerMapPromise = null; // failed, retry on the next request
  return map;
}

// Press releases usually name their own ticker, like (NASDAQ: ABCD).
const EXCHANGE_RE = /\(\s*(?:NYSE American|NYSE|NASDAQ|Nasdaq|AMEX|CBOE|OTCQB|OTCQX|OTCMKTS|OTC)\s*:\s*([A-Za-z.\-]{1,6})\s*\)/i;

function tagTickers(items, cikMap) {
  for (const it of items) {
    const cik = (it.title.match(/\((\d{10})\)/) || [])[1];
    if (cik && cikMap && cikMap[cik]) it.ticker = cikMap[cik];
    if (!it.ticker) {
      const m = it.title.match(EXCHANGE_RE);
      if (m) it.ticker = m[1].toUpperCase();
    }
    // EDGAR titles carry CIK numbers and role labels; hide that noise.
    it.title = it.title
      .replace(/\s*\(\d{10}\)\s*(\((?:Filer|Issuer|Reporting|Reporting Owner|Subject)\))?/gi, "")
      .trim();
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  // The SEC asks automated tools to identify themselves with a contact.
  // Set SEC_CONTACT_EMAIL in your environment; it is polite and keeps
  // EDGAR from blocking the requests.
  const contact = process.env.SEC_CONTACT_EMAIL || "";
  const userAgent = `MarketPulse personal research dashboard ${contact}`.trim();

  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const r = await fetch(feed.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": userAgent,
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          },
        });
        if (!r.ok) throw new Error(`status ${r.status}`);
        return parseFeed(await r.text(), feed);
      } finally {
        clearTimeout(timer);
      }
    })
  );

  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
  const failed = results
    .map((r, i) => (r.status === "rejected" ? FEEDS[i].source : null))
    .filter(Boolean);

  tagTickers(items, await getTickerMap(userAgent));

  // Newest first. Items with no readable date sink to the bottom.
  items.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  res.status(200).json({
    items: items.slice(0, 80),
    failed,
    fetchedAt: new Date().toISOString(),
  });
}
