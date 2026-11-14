/* The only place that talks to a model.

   Everything is OpenAI-compatible: GLM, DeepSeek, Qwen and the rest all speak
   /chat/completions with response_format json_object. Transport concerns live
   here — timeout, one retry, a short down-window, and salving JSON out of prose.
   Callers get an object or an error they can show. */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* `.env.local` is the local file. `env.local` is the same content without the
   leading dot, because some upload pipelines drop dotfiles — the deployed copy
   reads whichever one survived. Real environment variables always win. */
function loadEnv() {
  for (const rel of ["../.env.local", "../env.local"]) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const value = m[2].replace(/^["']|["']$/g, "").trim();
      if (!(m[1] in process.env) && value) process.env[m[1]] = value;
    }
  }
}
loadEnv();

const KEY = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90_000);

let downUntil = 0;
const DOWN_MS = 3 * 60 * 1000;

export const llmState = () => ({
  configured: Boolean(KEY),
  reachable: Date.now() >= downUntil,
  retryIn: Math.max(0, Math.round((downUntil - Date.now()) / 1000)),
  model: KEY ? MODEL : null,
  base: KEY ? BASE : null,
});

export const providerLabel = () => {
  if (!KEY) return "演示模式 · 内置课程";
  return Date.now() >= downUntil ? MODEL : `${MODEL}（暂不可达）`;
};

export const hasModel = () => Boolean(KEY) && Date.now() >= downUntil;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One JSON object out of the model, or a thrown Error with a readable message. */
export async function chatJSON(system, user, { temperature = 0.4, maxTokens = 3200, timeout = TIMEOUT_MS } = {}) {
  if (!KEY) throw new Error("NO_MODEL");
  if (Date.now() < downUntil) throw new Error("MODEL_DOWN");

  let lastError;
  let finalUser = user;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
        body: JSON.stringify({
          model: MODEL,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: finalUser },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`模型返回 ${res.status}：${body.slice(0, 180)}`);
        // 429 and 5xx are worth one more try; a bad key is not.
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          lastError = err;
          await sleep(1200 + Math.random() * 800);
          continue;
        }
        if (res.status === 401 || res.status === 403) downUntil = Date.now() + DOWN_MS;
        throw err;
      }

      const data = await res.json();
      return parseJSON(data.choices?.[0]?.message?.content ?? "");
    } catch (e) {
      lastError = e;
      if (e.name === "AbortError") {
        throw new Error(`模型超时（${Math.round(timeout / 1000)} 秒）。可以再试一次，或换一个更快的模型。`);
      }
      const isParse = typeof e?.message === "string" && (e.message.startsWith("模型没有返回") || e.message.startsWith("模型返回了空"));
      // HTTP-level errors (4xx/5xx already retried above) propagate as-is.
      if (!isParse && e.message?.startsWith("模型返回")) throw e;
      if (isParse && attempt === 0) {
        // The model answered, just not in valid JSON. Ask again with the
        // defect spelled out — a blind resend tends to repeat the same typo.
        finalUser = `${user}

【重要】你上一次的输出不是合法 JSON（引号或冒号有语法错误）。请重新输出完整 JSON，并逐字检查：
- 每个键后面必须有冒号，例如 { "type": "code" }；
- 字符串值必须成对双引号，不要漏写或多写引号；
- 不要输出注释、markdown 或 JSON 以外的任何文字。`;
        await sleep(600);
        continue;
      }
      if (attempt === 0) {
        await sleep(900);
        continue;
      }
      // A parse failure means the model answered badly — it is still reachable,
      // so no down-window: the next request may well be fine.
      if (isParse) throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Fetch failed twice: stop dialing for a few minutes so the UI stays responsive.
  downUntil = Date.now() + DOWN_MS;
  throw new Error(`连不上模型服务：${lastError?.message ?? "network error"}`);
}

function parseJSON(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("模型返回了空内容。");

  const candidates = [raw];
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) candidates.push(raw.slice(a, b + 1));

  const stripCommas = (t) => t.replace(/,\s*([}\]])/g, "$1");
  const colonFix = (t) => fixMissingColons(escapeRawControls(t));
  for (const candidate of candidates) {
    for (const body of [
      candidate,
      stripCommas(candidate),
      escapeRawControls(candidate),
      fixLooseQuotes(candidate),
      stripCommas(escapeRawControls(candidate)),
      stripCommas(fixLooseQuotes(candidate)),
      fixMissingColons(candidate),
      colonFix(candidate),
      stripCommas(colonFix(candidate)),
      fixLooseQuotes(colonFix(candidate)),
    ]) {
      try {
        const value = JSON.parse(body);
        if (value && typeof value === "object") return value;
      } catch {
        /* try the next shape */
      }
    }
  }
  dumpFailure(raw);
  throw new Error(`模型没有返回 JSON（${raw.length} 字符）：…${raw.slice(-100)}`);
}

/* Keep the raw text of the last parse failure so the exact defect can be
   inspected instead of guessed at. */
function dumpFailure(raw) {
  try {
    const file = fileURLToPath(new URL("../data/last-parse-failure.txt", import.meta.url));
    mkdirSync(fileURLToPath(new URL("../data", import.meta.url)), { recursive: true });
    writeFileSync(file, raw);
  } catch { /* diagnostics must never break the request */ }
}

/* Small models sometimes drop the colon between a key and its value —
   glm-4-plus has been seen writing { "type "text" } (the ": " became a bare
   space and a quote went missing). Three shapes, all repaired:
     { " "type"     ->  { "type"          (stray empty-key quote pair)
     "key "value"   ->  "key": "value"    (colon and a quote missing)
     "key" "value"  ->  "key": "value"    (just the colon missing)   */
function fixMissingColons(text) {
  const C = /([,{\[]\s*)"\s*"\s*(?=[A-Za-z_])/g;
  const A = /"([A-Za-z_][\w-]*)\s+"([A-Za-z_][\w-]*)"(\s*[,\n}\]])/g;
  const B = /"([A-Za-z_][\w-]*)"\s*"([A-Za-z_][\w-]*)"(\s*[,\n}\]])/g;
  return text
    .replace(C, '$1"')
    .replace(A, '"$1": "$2"$3')
    .replace(B, '"$1": "$2"$3');
}

/* A raw " inside a string value (the model quoting a term) makes the whole
   document unparseable. A quote only ends the string if what follows is a
   structural character, so escape the ones followed by ordinary text. */
function fixLooseQuotes(text) {
  const STRUCT = /[}\],:\s]/;
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      const next = text[i + 1] ?? "";
      if (next === "" || STRUCT.test(next)) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

/* Small models happily put raw newlines inside string values (a multi-line
   code block, say). That is invalid JSON, but the intent is obvious, so we
   escape control characters that appear inside string literals. */
function escapeRawControls(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString && ch === "\\") {
      out += ch + (text[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}
