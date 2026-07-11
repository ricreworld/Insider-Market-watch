// Serverless function that answers scan prompts with whichever AI brain
// is configured. Two are supported. Gemini (GEMINI_API_KEY, free tier at
// aistudio.google.com) is tried first when present, so daily use costs
// nothing. The Anthropic API (ANTHROPIC_API_KEY, paid) is the fallback,
// so paid credit is only spent when the free brain is unavailable. Keys
// live only in server environment variables and never reach the browser.

async function callGemini(apiKey, prompt, tokens) {
  const r = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        // Grounding with Google Search, the Gemini version of web search.
        tools: [{ google_search: {} }],
        generationConfig: {
          // Headroom on top of the requested budget because Gemini can
          // spend part of the output allowance before the JSON finishes.
          maxOutputTokens: tokens + 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  const data = await r.json();
  if (!r.ok) {
    throw new Error((data.error && data.error.message) || `Gemini error ${r.status}`);
  }
  const candidate = (data.candidates || [])[0];
  const text = (((candidate || {}).content || {}).parts || [])
    .map((p) => p.text || "")
    .join("\n");
  if (!text) throw new Error("Gemini returned no text");
  // Normalized to the same shape the frontend already parses.
  return { content: [{ type: "text", text }], provider: "gemini" };
}

async function callAnthropic(apiKey, prompt, tokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: tokens,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  const data = await response.json();
  return { status: response.status, data };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const gemKey = process.env.GEMINI_API_KEY;
  const antKey = process.env.ANTHROPIC_API_KEY;
  if (!gemKey && !antKey) {
    res.status(500).json({
      error:
        "AI scans need an API key on the server. Add GEMINI_API_KEY, free from aistudio.google.com, or ANTHROPIC_API_KEY, paid. The Live wire, watchlist, and live watcher all work without one.",
    });
    return;
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Quick scans stay at 1000 tokens. The deep dive and daily brief ask
  // for more room, clamped here so the browser can never request an
  // unbounded amount.
  const tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 256), 2000);

  // Free brain first. Paid brain only as backup.
  if (gemKey) {
    try {
      res.status(200).json(await callGemini(gemKey, prompt, tokens));
      return;
    } catch (e) {
      if (!antKey) {
        res.status(502).json({ error: `The free Google brain failed: ${e.message}` });
        return;
      }
    }
  }

  try {
    const { status, data } = await callAnthropic(antKey, prompt, tokens);
    res.status(status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Could not reach the Anthropic API" });
  }
}
