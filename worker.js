// deepai2api — OpenAI-compatible proxy for DeepAI anonymous chat.
// Upstream: POST https://api.deepai.org/hacking_is_a_serious_crime (FormData).
// tryit key is computed locally per request; no account needed.

const UPSTREAM = "https://api.deepai.org/hacking_is_a_serious_crime";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.47 Safari/537.36";
const SALT = "hackers_become_a_little_stinkier_every_time_they_hack";

// Anonymous-verified free models (each self-reported its name, 2026-11-07).
const FREE_MODELS = [
  "standard", "glm-5.3-flash", "deepseek-v4.1-flash", "qwen3.8-flash",
  "gpt-6-luna", "tencent-hy3", "gemma-4", "gpt-oss-120b",
  "llama-3.3-70b-instruct", "llama-3.1-8b-instant", "claude-haiku-5-5",
];

// WebCrypto has no MD5 — compact pure-JS RFC 1321 implementation
// (inputs are short ASCII: UA + rand + hex digests).
function md5Hex(input) {
  const msg = new TextEncoder().encode(input);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  const S = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.trunc(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;

  const rol = (x, c) => (x << c) | (x >>> (32 - c));
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16)      { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D;          g = (3 * i + 5) % 16; }
      else             { F = C ^ (B | ~D);       g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rol(F, S[(i >> 4) * 4 + (i & 3)])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setInt32(0, a0, true); out.setInt32(4, b0, true);
  out.setInt32(8, c0, true); out.setInt32(12, d0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tryitKey(ua) {
  const rand = String(Math.floor(Math.random() * 1e11));
  const inner = md5Hex(ua + rand + SALT);
  const mid = md5Hex(ua + inner);
  return "tryit-" + rand + "-" + md5Hex(ua + mid);
}

function toChatHistory(messages) {
  // Upstream only understands user/assistant turns; fold system into the first user turn.
  const turns = [];
  let sys = "";
  for (const m of messages || []) {
    if (m.role === "system") {
      sys += (sys ? "\n" : "") + String(m.content ?? "");
    } else if (m.role === "user" || m.role === "assistant") {
      turns.push({ role: m.role, content: String(m.content ?? "") });
    }
  }
  if (sys && turns.length && turns[0].role === "user") {
    turns[0] = { role: "user", content: sys + "\n\n" + turns[0].content };
  } else if (sys) {
    turns.unshift({ role: "user", content: sys });
  }
  if (!turns.length) turns.push({ role: "user", content: "hi" });
  return turns;
}

function upstreamBody(messages, model) {
  const p = new URLSearchParams();
  p.set("chat_style", "chat");
  p.set("language", "en");
  p.set("web_access_enabled", "true");
  p.set("sandbox_enabled", "false");
  p.set("chatHistory", JSON.stringify(toChatHistory(messages)));
  p.set("model", model);
  p.set("session_uuid", crypto.randomUUID());
  p.set("sensitivity_request_id", crypto.randomUUID());
  p.set("tool_activity_support", "1");
  p.set("thinking_image_tool_support", "1");
  p.set("hacker_is_stinky", "very_stinky");
  p.set("enabled_tools", '["image_generator","image_editor"]');
  return p;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

function checkAuth(req, env) {
  if (!env.ACCESS_KEY) return true;
  const auth = req.headers.get("Authorization") || "";
  return auth === "Bearer " + env.ACCESS_KEY;
}

function sseChunk(id, model, delta, finish) {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function handleChat(req, env) {
  if (!checkAuth(req, env)) return json({ error: { message: "invalid key" } }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "invalid json" } }, 400);
  }
  const model = FREE_MODELS.includes(body.model) ? body.model : "standard";
  const messages = body.messages || [];
  const stream = !!body.stream;
  const id = "chatcmpl-" + crypto.randomUUID().slice(0, 24);

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "api-key": await tryitKey(UA),
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://deepai.org",
        Referer: "https://deepai.org/chat",
      },
      body: upstreamBody(messages, model),
    });
  } catch (e) {
    return json({ error: { message: "upstream fetch failed: " + e.message } }, 502);
  }

  if (upstream.status !== 200) {
    const detail = (await upstream.text()).slice(0, 300);
    return json({ error: { message: `upstream ${upstream.status}: ${detail}` } }, 502);
  }

  if (!stream) {
    const text = await upstream.text();
    return json({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(sseChunk(id, model, { role: "assistant" })));
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true });
          if (text) controller.enqueue(encoder.encode(sseChunk(id, model, { content: text })));
        }
        controller.enqueue(encoder.encode(sseChunk(id, model, {}, "stop")));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(sseChunk(id, model, { content: `\n[stream error: ${e.message}]` })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "*",
        },
      });
    }
    if (url.pathname === "/v1/models") {
      if (!checkAuth(request, env)) return json({ error: { message: "invalid key" } }, 401);
      return json({
        object: "list",
        data: FREE_MODELS.map((m) => ({
          id: m,
          object: "model",
          created: 1762500000,
          owned_by: "deepai",
        })),
      });
    }
    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (url.pathname === "/") return json({ ok: true, service: "deepai2api" });
    return json({ error: { message: "not found" } }, 404);
  },
};
