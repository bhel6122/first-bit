#!/usr/bin/env node
/* Reproduction for the 讲解 / 追问 pill bug.
 *
 * The pills could not be tested by a bare click: with no handler, clicking
 * 追问 does nothing, so the panel never leaves 讲解 and the bug is invisible.
 * The real user path is: type a question, send (sendAsk switches to the chat
 * panel in code), then try to click back to 讲解.
 *
 *   node tools/test-tabs.mjs <courseId> <lessonId> [baseUrl]
 *
 * The ask itself may fail (no model key, offline) — irrelevant: the panel is
 * already on 追问 by then, which is the state the bug lives in. Asserts that
 * clicking 讲解 actually returns to the transcript.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const COURSE = process.argv[2];
const LESSON = process.argv[3];
const BASE = process.argv[4] || process.env.BASE || "http://127.0.0.1:4173/";
if (!COURSE || !LESSON) throw new Error("usage: node tools/test-tabs.mjs <courseId> <lessonId> [baseUrl]");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9353;
const profile = mkdtempSync(path.join(tmpdir(), "wb-tabs-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let ws;
try {
  let target;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error("Chrome 没有起来");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((res, rej) => pending.set(i, { res, rej }));
  };
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url: `${BASE}?t=${Date.now()}#/lesson/${COURSE}/${LESSON}` });
  await sleep(2600);

  /* Which panel is in front? The transcript renders .transcript-step rows; the
     chat renders bubbles (.chat-*). */
  const which = `(window.__which = () => {
    const t = document.querySelectorAll("#panel-body .transcript-step").length;
    const c = document.querySelectorAll("#panel-body .msg, #panel-body .chat-empty").length;
    const active = document.querySelector("[data-tab].active")?.dataset.tab || null;
    return JSON.stringify({ transcript: t, chat: c, active });
  })()`;

  const before = JSON.parse(await ev(which));

  /* User path: ask something (this is what forces the panel to 追问). */
  await ev(`(() => {
    const input = document.querySelector("#ask-input");
    input.value = "这一页是什么意思？";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#send").click();
  })()`);
  await sleep(1800);
  const inChat = JSON.parse(await ev(which));

  /* The failing step: click back to 讲解. */
  await ev(`document.querySelector('[data-tab="transcript"]').click()`);
  await sleep(900);
  const after = JSON.parse(await ev(which));

  const back = after.active === "transcript" && after.transcript > 0 && after.chat === 0;
  console.log(
    JSON.stringify(
      {
        ok: back,
        wired: back,
        before,
        inChat,
        afterClickingJiangjie: after,
      },
      null,
      2,
    ),
  );
  if (!back) {
    console.log("\n点「讲解」回不去——面板仍停在追问页");
    process.exitCode = 1;
  } else {
    console.log("\n点「讲解」正常回到讲解页");
  }
} catch (e) {
  console.error("ERR", e.message);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
