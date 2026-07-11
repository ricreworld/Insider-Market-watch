// Serverless function that proxies scan prompts to the Anthropic API.
// The API key lives only here, in the ANTHROPIC_API_KEY environment
// variable, and never reaches the browser. The request shape matches
// what the app used before: claude-sonnet-4-6, max_tokens 1000, with
// the web search tool enabled.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
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

  try {
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
    res.status(response.status).json(data);
  } catch (e) {
    res.status(502).json({ error: "Could not reach the Anthropic API" });
  }
}
