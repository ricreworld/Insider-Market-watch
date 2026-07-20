// Local development server for the /api/scan route. In production the
// route runs as a serverless function; this file only exists so
// `npm run dev` works on your own machine. Start it with:
//   npm run dev:api
// It reads ANTHROPIC_API_KEY from .env via node --env-file.
import http from "node:http";
import scanHandler from "./api/scan.js";
import wireHandler from "./api/wire.js";
import buzzHandler from "./api/buzz.js";
import putsHandler from "./api/puts.js";
import dipsHandler from "./api/dips.js";
import insiderHandler from "./api/insider.js";

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Give the plain Node response the small helpers the serverless
  // handler expects, so both environments share the exact same code.
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
  };

  if (req.url === "/api/wire") {
    await wireHandler(req, res);
    return;
  }

  if (req.url === "/api/buzz") {
    await buzzHandler(req, res);
    return;
  }

  if ((req.url || "").split("?")[0] === "/api/puts") {
    await putsHandler(req, res);
    return;
  }

  if ((req.url || "").split("?")[0] === "/api/dips") {
    await dipsHandler(req, res);
    return;
  }

  if ((req.url || "").split("?")[0] === "/api/insider") {
    await insiderHandler(req, res);
    return;
  }

  if (req.url !== "/api/scan") {
    res.status(404).json({ error: "not found" });
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    req.body = body ? JSON.parse(body) : {};
  } catch (e) {
    req.body = {};
  }

  await scanHandler(req, res);
});

server.listen(PORT, () => {
  console.log(`Market Pulse dev API listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Warning: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
  }
});
