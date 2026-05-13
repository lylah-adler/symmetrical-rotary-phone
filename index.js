// HeyGen API proxy — deployable on Railway.
//
// Reads:
//   HEYGEN_API_KEY  — required, your HeyGen API key (sk_V2_...)
//   CONTROL_TOKEN   — required, a shared secret. Every request to this
//                     service must include `Authorization: Bearer <CONTROL_TOKEN>`.
//                     This prevents random people on the internet from draining
//                     your HeyGen credits if they find your Railway URL.
//   PORT            — optional, defaults to 3000. Railway sets this automatically.
//
// Endpoints:
//   GET  /healthz              — liveness check (no auth)
//   GET  /avatars              — list HeyGen avatars
//   GET  /voices               — list HeyGen voices
//   POST /video                — generate a video (body: see README)
//   GET  /video/:id            — poll video status
//   POST /photo-avatar         — generate a photo avatar from a text prompt (Avatar IV)
//   GET  /photo-avatar/:id     — poll photo-avatar generation status
//   POST /heygen/*             — escape hatch: raw passthrough to https://api.heygen.com/*
//   POST /command              — natural-language command endpoint. Body: { command: "..." }.
//                                Returns a hint of which endpoint to call. Stubbed by default;
//                                wire to an LLM if you want it to dispatch automatically.

import express from "express";

const HEYGEN_BASE = "https://api.heygen.com";
const PORT = process.env.PORT || 3000;
const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN;

if (!HEYGEN_API_KEY) {
  console.error("FATAL: HEYGEN_API_KEY env var is not set. Set it in Railway → Variables.");
  process.exit(1);
}
if (!CONTROL_TOKEN) {
  console.error(
    "FATAL: CONTROL_TOKEN env var is not set. Pick any random string and set it in Railway → Variables. " +
      "Callers must send it as `Authorization: Bearer <token>`."
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "10mb" }));

// ---- auth middleware ---------------------------------------------------------

function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token !== CONTROL_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// ---- helpers -----------------------------------------------------------------

async function heygen(path, { method = "GET", body, query } = {}) {
  const url = new URL(HEYGEN_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      "X-Api-Key": HEYGEN_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

function relay(res, upstream) {
  res.status(upstream.status).json(upstream.data);
}

// ---- routes ------------------------------------------------------------------

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "heygen-railway", time: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.json({
    service: "heygen-railway",
    endpoints: [
      "GET  /healthz",
      "GET  /avatars",
      "GET  /voices",
      "POST /video",
      "GET  /video/:id",
      "POST /photo-avatar",
      "GET  /photo-avatar/:id",
      "POST /heygen/*",
      "POST /command",
    ],
    auth: "Authorization: Bearer <CONTROL_TOKEN>",
  });
});

app.get("/avatars", requireAuth, async (_req, res, next) => {
  try {
    relay(res, await heygen("/v2/avatars"));
  } catch (err) {
    next(err);
  }
});

app.get("/voices", requireAuth, async (_req, res, next) => {
  try {
    relay(res, await heygen("/v2/voices"));
  } catch (err) {
    next(err);
  }
});

// Generate a video. Body shape mirrors HeyGen's /v2/video/generate.
// Minimum useful body:
//   {
//     "avatar_id": "...",
//     "voice_id":  "...",
//     "text":      "Hello world",   // shorthand — we'll build the full payload
//     "aspect_ratio": "16:9"        // optional, default 16:9
//   }
// Or pass the full HeyGen payload under `raw: { ... }` to bypass the helper.
app.post("/video", requireAuth, async (req, res, next) => {
  try {
    const { raw, avatar_id, voice_id, text, aspect_ratio, dimension, background, test } = req.body || {};

    let payload;
    if (raw && typeof raw === "object") {
      payload = raw;
    } else {
      if (!avatar_id || !voice_id || !text) {
        return res.status(400).json({
          error: "missing_fields",
          required: ["avatar_id", "voice_id", "text"],
          hint: "Or send { raw: <full HeyGen payload> } to bypass.",
        });
      }
      payload = {
        video_inputs: [
          {
            character: {
              type: "avatar",
              avatar_id,
              avatar_style: "normal",
            },
            voice: {
              type: "text",
              input_text: text,
              voice_id,
            },
            background: background || { type: "color", value: "#FFFFFF" },
          },
        ],
        aspect_ratio: aspect_ratio || "16:9",
        test: typeof test === "boolean" ? test : false,
      };
      if (dimension) payload.dimension = dimension;
    }

    relay(res, await heygen("/v2/video/generate", { method: "POST", body: payload }));
  } catch (err) {
    next(err);
  }
});

app.get("/video/:id", requireAuth, async (req, res, next) => {
  try {
    relay(res, await heygen("/v1/video_status.get", { query: { video_id: req.params.id } }));
  } catch (err) {
    next(err);
  }
});

// Photo avatar (Avatar IV) — generate from a text prompt.
app.post("/photo-avatar", requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !body.prompt) {
      return res.status(400).json({
        error: "missing_fields",
        required: ["name", "prompt"],
        optional: ["age", "gender", "ethnicity", "orientation", "pose", "style", "appearance"],
      });
    }
    relay(res, await heygen("/v2/photo_avatar/photo/generate", { method: "POST", body }));
  } catch (err) {
    next(err);
  }
});

app.get("/photo-avatar/:id", requireAuth, async (req, res, next) => {
  try {
    relay(res, await heygen(`/v2/photo_avatar/generation/${encodeURIComponent(req.params.id)}`));
  } catch (err) {
    next(err);
  }
});

// Raw passthrough — POST /heygen/v2/whatever forwards to https://api.heygen.com/v2/whatever
// Useful for endpoints not wrapped above. Always uses your HEYGEN_API_KEY.
app.all("/heygen/*", requireAuth, async (req, res, next) => {
  try {
    const upstreamPath = "/" + req.params[0];
    relay(
      res,
      await heygen(upstreamPath, {
        method: req.method,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
        query: req.query,
      })
    );
  } catch (err) {
    next(err);
  }
});

// Natural-language command endpoint. Default behavior: echo the command back with
// a hint of which structured endpoint to call. If you want full NL dispatch, wire
// this to your LLM of choice and translate `command` → a structured call.
app.post("/command", requireAuth, async (req, res) => {
  const { command } = req.body || {};
  if (!command || typeof command !== "string") {
    return res.status(400).json({ error: "missing_fields", required: ["command"] });
  }

  const lower = command.toLowerCase();
  let hint;
  if (/list.*avatar|show.*avatar|which avatars/.test(lower)) hint = "GET /avatars";
  else if (/list.*voice|show.*voice|which voices/.test(lower)) hint = "GET /voices";
  else if (/status|check video|how is.*video/.test(lower)) hint = "GET /video/:id";
  else if (/photo avatar|create avatar|new avatar/.test(lower)) hint = "POST /photo-avatar";
  else if (/video|generate|make/.test(lower)) hint = "POST /video";
  else hint = "(unrecognized — call one of the structured endpoints directly)";

  res.json({
    received: command,
    suggested_endpoint: hint,
    note: "This endpoint is a stub. Wire it to an LLM if you want full natural-language dispatch.",
  });
});

// ---- error handler -----------------------------------------------------------

app.use((err, _req, res, _next) => {
  console.error("ERROR:", err);
  res.status(500).json({ error: "internal_error", message: err?.message || String(err) });
});

app.listen(PORT, () => {
  console.log(`heygen-railway listening on :${PORT}`);
});
