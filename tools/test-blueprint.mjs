#!/usr/bin/env node
/* Click-through test for the blueprint editor.
 *
 * Written after `增加一个单元` turned out to render, style correctly and do
 * nothing at all: the click delegate only listens for `[data-act]`, and the
 * button carried an id instead. A screenshot can't catch that — the button looks
 * fine. Only pressing it can.
 *
 *   node tools/test-blueprint.mjs <courseId> [baseUrl]
 *
 * Refuses to run against the live site: it adds rows to the draft.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const COURSE = process.argv[2];
const BASE = process.argv[3] || process.env.BASE || "http://127.0.0.1:4173/";
if (!COURSE) throw new Error("usage: node tools/test-blueprint.mjs <courseId> [baseUrl]");
if (!/127\.0\.0\.1|localhost/.test(BASE)) throw new Error("this test mutates the draft; point it at a local server");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9337;
const profile = mkdtempSync(path.join(tmpdir(), "wb-test-"));

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
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  }
  if (m.method === "Runtime.exceptionThrown") {
    logs.push("EXCEPTION " + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
  }
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

const evalJs = async (expression, awaitPromise = true) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluate failed");
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

await send("Page.navigate", { url: `${BASE}?t=${Date.now()}#/build/${COURSE}` });
await sleep(1800);

const ready = await evalJs(`!!document.querySelector(".unit-card")`);
if (!ready) {
  console.log(JSON.stringify({ ok: false, why: "blueprint page did not render", logs }, null, 2));
  ws.close();
  chrome.kill();
  process.exit(1);
}

const result = await evalJs(`(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  /* The button may exist but be wired wrong — that is exactly the bug this test
     was written for. Find it either way and record which selector matched, so a
     failure says "it is there, it just does nothing" instead of "not found". */
  const btn = document.querySelector('[data-act="add-unit"]') || document.querySelector("#add-unit");
  out.buttonFound = !!btn;
  out.wired = !!document.querySelector('[data-act="add-unit"]');
  if (!btn) return out;

  out.unitsBefore = document.querySelectorAll(".unit-card").length;
  out.lessonsUnit1Before = document.querySelectorAll('.add-lesson[data-u="0"]').length
    ? document.querySelectorAll('[data-unit-card="0"] .lesson-row').length : 0;

  btn.click();
  // saveNow() + full re-render + a PATCH round trip
  for (let i = 0; i < 40; i++) {
    await wait(150);
    if (document.querySelectorAll(".unit-card").length > out.unitsBefore) break;
  }
  out.unitsAfter = document.querySelectorAll(".unit-card").length;

  const last = document.querySelectorAll(".unit-card")[out.unitsBefore];
  out.newUnitTitle = last ? last.querySelector('[data-field="unit.title"]').value : null;
  out.newUnitRows = last ? last.querySelectorAll(".lesson-row").length : 0;
  out.focused = document.activeElement?.getAttribute("data-field") || null;

  // same for a lesson inside the last unit
  const idx = out.unitsAfter - 1;
  const addLesson = document.querySelector('.add-lesson[data-u="' + idx + '"]');
  out.lessonButtonFound = !!addLesson;
  if (addLesson) {
    const before = document.querySelectorAll('[data-unit-card="' + idx + '"] .lesson-row').length;
    addLesson.click();
    for (let i = 0; i < 40; i++) {
      await wait(150);
      if (document.querySelectorAll('[data-unit-card="' + idx + '"] .lesson-row').length > before) break;
    }
    out.lessonsBefore = before;
    out.lessonsAfter = document.querySelectorAll('[data-unit-card="' + idx + '"] .lesson-row').length;
  }
  return out;
})()`);

const ok =
  result.wired &&
  result.buttonFound &&
  result.unitsAfter === result.unitsBefore + 1 &&
  result.newUnitTitle === "新的单元" &&
  result.newUnitRows === 1 &&
  result.lessonsAfter === result.lessonsBefore + 1 &&
  !logs.length;

console.log(JSON.stringify({ ok, ...result, consoleErrors: logs }, null, 2));

ws.close();
chrome.kill();
process.exit(ok ? 0 : 1);
