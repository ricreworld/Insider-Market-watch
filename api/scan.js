// Serverless function that answers scan prompts with whichever free AI
// brain is reachable, falling through a chain so a single exhausted free
// tier never leaves the app dead. Order:
//   1. Gemini, three models in turn (GEMINI_API_KEY, free, web search).
//      Falling to the lighter models stretches the free daily quota far,
//      since gemini-2.5-flash-lite has a much larger free allowance.
//   2. Groq (GROQ_API_KEY, free, no card at console.groq.com). Fast and
//      generous, but no live web search, so reads lean on model knowledge.
//   3. Anthropic (ANTHROPIC_API_KEY, paid, web search) as the last resort.
// Keys live only in server environment variables, never in the browser.

// Let this function run up to 60s. Gemini with web-search grounding on a
// multi-ticker prompt routinely takes 15-40s; the default 10s serverless
// limit was cutting it off, which looked like "no AI read returned".
export const config = { maxDuration: 60 };

// The dated models (gemini-2.5-flash etc.) are retired for new Google
// accounts. The "-latest" aliases stay valid as Google rotates versions,
// and confirmed working with current auth keys. Falls through fuller ->
// lighter (bigger quota) -> 2.0 so a busy or quota-capped model still
// lands on a working one.
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

async function callGeminiModel(apiKey, model, prompt, tokens) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          maxOutputTokens: tokens + 512,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  const data = await r.json();
  if (!r.ok) {
    const msg = (data.error && data.error.message) || `Gemini ${model} error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  const candidate = (data.candidates || [])[0];
  const text = (((candidate || {}).content || {}).parts || [])
    .map((p) => p.text || "")
    .join("\n");
  if (!text) throw new Error(`Gemini ${model} returned no text`);
  return { content: [{ type: "text", text }], provider: `gemini:${model}` };
}

// Try each Gemini model until one answers. A 429 (quota) on one model
// still lets a lighter model with its own allowance succeed.
async function callGemini(apiKey, prompt, tokens) {
  let last;
  for (const model of GEMINI_MODELS) {
    try {
      return await callGeminiModel(apiKey, model, prompt, tokens);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("all Gemini models failed");
}

// Groq is OpenAI-compatible. No web search, so the prompt's own context
// carries the weight; fine for reading well-known names, weaker on fresh
// breaking specifics.
async function callGroq(apiKey, prompt, tokens) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: tokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error((data.error && data.error.message) || `Groq error ${r.status}`);
  }
  const text = (((data.choices || [])[0] || {}).message || {}).content || "";
  if (!text) throw new Error("Groq returned no text");
  return { content: [{ type: "text", text }], provider: "groq" };
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
  const groqKey = process.env.GROQ_API_KEY;
  const antKey = process.env.ANTHROPIC_API_KEY;
  if (!gemKey && !groqKey && !antKey) {
    res.status(500).json({
      error:
        "AI scans need an API key on the server. Add GEMINI_API_KEY or GROQ_API_KEY (both free) or ANTHROPIC_API_KEY (paid). The Live wire, dip screen, watchlist, and live watcher all work without one.",
    });
    return;
  }

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 256), 2000);
  const errors = [];

  // Free brains first, in order.
  if (gemKey) {
    try {
      res.status(200).json(await callGemini(gemKey, prompt, tokens));
      return;
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }
  if (groqKey) {
    try {
      res.status(200).json(await callGroq(groqKey, prompt, tokens));
      return;
    } catch (e) {
      errors.push(`Groq: ${e.message}`);
    }
  }
  if (antKey) {
    try {
      const { status, data } = await callAnthropic(antKey, prompt, tokens);
      res.status(status).json(data);
      return;
    } catch (e) {
      errors.push(`Anthropic: ${e.message}`);
    }
  }

  // Everything configured was tried and failed.
  res.status(502).json({
    error:
      `Every AI brain was exhausted or errored (${errors.join(" | ")}). ` +
      "Free daily limits reset overnight. To add more free headroom now, set GROQ_API_KEY, free with no card at console.groq.com.",
  });
}
