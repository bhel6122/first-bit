#!/usr/bin/env node
/* Runtime dead-control probe — the half a static audit cannot do.
 *
 * A static check can't tell you whether a button does anything: the 讲解 / 追问
 * pills carried `data-tab`, `dataset.tab` *was* read (to paint the active pill),
 * and still no click handler existed. The only honest question is "is there a
 * click listener that can reach this element", so this asks Chrome itself.
 *
 * For every visible <button> on a route it fails when:
 *   - element.onclick is null, AND
 *   - no ancestor (or the element) has a click listener attached
 *     (checked via DOMDebugger.getEventListeners, so delegated handlers count)
 *
 *   node tools/test-controls.mjs <courseId> <lessonId> [baseUrl]
 *
 * Read-only: it never clicks anything.
 *
 * Known blind spot: a handler bound on `document` is reachable by every button,
 * but `closest()` walks elements only, so `document` can never be matched from
 * inside the page. Those buttons are therefore listed separately instead of
 * being called dead — the language switch is one, and it is proven by a real
 * click in tools/test-lang.mjs. Anything else that lands in that bucket has to
 * earn its place there explicitly.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const COURSE = process.argv[2];
const LESSON = process.argv[3];
const BASE = process.argv[4] || process.env.BASE || "http://127.0.0.1:4173/";
if (!COURSE) throw new Error("usage: node tools/test-controls.mjs <courseId> <lessonId> [baseUrl]");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9341;
const profile = mkdtempSync(path.join(tmpdir(), "wb-controls-"));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,960",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* still booting */
    }
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
};

await send("Page.enable");
await send("Runtime.enable");
await send("DOM.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

const evalJs = async (expression, byValue = true) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: byValue, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return byValue ? r.result.value : r.result;
};

/* Mark every element that has a click listener attached directly to it, so the
   in-page filter can just ask `closest("[data-wb-wired]")`. Returns whether the
   document itself carries a click listener — that one cannot be attributed to a
   button from inside the page. */
async function markWiredAncestors() {
  const arr = await evalJs(
    `(() => {
      const seen = new Set();
      const out = [];
      for (const b of document.querySelectorAll("button")) {
        for (let el = b; el; el = el.parentElement) {
          if (seen.has(el)) continue;
          seen.add(el);
          out.push(el);
        }
        /* A delegated handler on document is common (the language switch binds
           there), and document is not part of the parentElement chain. */
        if (!seen.has(document)) {
          seen.add(document);
          out.push(document);
        }
      }
      return out;
    })()`,
    false,
  );
  if (!arr.objectId) return { docWired: false };

  const props = await send("Runtime.getProperties", { objectId: arr.objectId, ownProperties: true });
  let docWired = false;
  for (const p of props.result) {
    if (!/^\d+$/.test(p.name) || !p.value?.objectId) continue;
    const listeners = await send("DOMDebugger.getEventListeners", { objectId: p.value.objectId, depth: 0 });
    if (!listeners.listeners?.some((l) => l.type === "click")) continue;
    const marked = await send("Runtime.callFunctionOn", {
      objectId: p.value.objectId,
      functionDeclaration:
        "function(){ if (this === document || this.nodeType === 9) return true; this.setAttribute('data-wb-wired','1'); return false; }",
      returnByValue: true,
    });
    if (marked.result?.value === true) docWired = true;
  }
  return { docWired };
}

/* Buttons whose handler lives on document. Each entry has to be proven by a real
   click somewhere else; today only the language switch qualifies
   (tools/test-lang.mjs). Keeping this list explicit means a new button cannot
   silently inherit the exemption. */
const DOC_DELEGATED = [".lang-switch"];

const report = [];
const routes = [
  ["/", "首页"],
  [`/build/${COURSE}`, "大纲编辑"],
  [`/course/${COURSE}`, "课程页"],
  [`/lesson/${COURSE}/${LESSON}`, "课堂页"],
];

for (const [hash, label] of routes) {
  await send("Page.navigate", { url: `${BASE}?c=${Date.now()}#${hash}` });
  await sleep(2200);
  await evalJs(`document.querySelectorAll("[data-wb-wired]").forEach((el) => el.removeAttribute("data-wb-wired"))`);
  const { docWired } = await markWiredAncestors();

  const { dead, delegated } = await evalJs(`(() => {
    const EXEMPT = ${JSON.stringify(DOC_DELEGATED)};
    const dead = [], delegated = [];
    for (const b of document.querySelectorAll("button")) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (b.disabled) continue;
      if (b.onclick) continue;
      if (b.closest("[data-wb-wired]")) continue;
      const row = {
        text: (b.textContent || "").trim().slice(0, 18),
        cls: b.className.toString().slice(0, 30),
        tab: b.dataset.tab || null,
      };
      if (${docWired} && EXEMPT.some((sel) => b.matches(sel))) delegated.push(row);
      else dead.push(row);
    }
    return { dead, delegated };
  })()`);

  const total = await evalJs(`[...document.querySelectorAll("button")].filter((b) => {
    const r = b.getBoundingClientRect(); return r.width && r.height;
  }).length`);

  report.push({ route: hash, label, total, dead });
  console.log(
    `${label.padEnd(6)} ${hash.padEnd(28)} 可见按钮 ${String(total).padStart(2)}  死按钮 ${dead.length}` +
      (delegated.length ? `  委托 ${delegated.length}` : ""),
  );
  for (const d of dead) console.log(`    ✗ 「${d.text}」 .${d.cls}${d.tab ? ` [data-tab=${d.tab}]` : ""}`);
  for (const d of delegated) console.log(`    ~ 「${d.text}」 .${d.cls} 经 document 委托，由 test-lang 真点击验证`);
  await evalJs(`document.querySelectorAll("[data-wb-wired]").forEach((el) => el.removeAttribute("data-wb-wired"))`);
}

const deadTotal = report.reduce((n, r) => n + r.dead.length, 0);
console.log(deadTotal ? `\n${deadTotal} 个按钮点不动` : "\n所有可见按钮都接上了点击处理");

ws.close();
chrome.kill();
process.exit(deadTotal ? 1 : 0);
