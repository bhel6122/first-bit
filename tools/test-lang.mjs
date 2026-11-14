#!/usr/bin/env node
/* Real-click proof for the language switch.
 *
 * test-controls.mjs cannot see this button: its handler is bound on `document`,
 * and `closest()` walks elements only, so the document node is unreachable from
 * inside the page. The only honest way to know it works is to click it — which
 * is fine here, because the side effect is a reload and a localStorage key.
 *
 *   node tools/test-lang.mjs [baseUrl]
 *
 * Asserts, on the home route: click → <html lang> flips, the switch label flips,
 * and a known Chinese headline becomes English. Then clicks back and asserts the
 * reverse, so the run leaves no state behind.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.argv[2] || process.env.BASE || "http://127.0.0.1:4173/";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9352;
const profile = mkdtempSync(path.join(tmpdir(), "wb-lang-"));

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

  const read = () =>
    ev(`(() => {
      const btn = document.querySelector(".lang-switch");
      const h = document.querySelector("h1");
      return JSON.stringify({
        lang: document.documentElement.lang,
        label: btn ? btn.textContent.trim() : null,
        headline: h ? h.textContent.trim().slice(0, 40) : null,
      });
    })()`).then((v) => JSON.parse(v));

  const open = async () => {
    await send("Page.navigate", { url: `${BASE}?c=${Date.now()}#/` });
    await sleep(2600);
  };
  const clickSwitch = async () => {
    await ev(`document.querySelector(".lang-switch").click()`);
    await sleep(3000);
  };

  await open();
  const a = await read();
  await clickSwitch();
  const b = await read();
  await clickSwitch();
  const c = await read();

  const problems = [];
  if (!a.label) problems.push("首页没有 .lang-switch");
  if (a.lang !== "zh-CN") problems.push(`起始语言应为 zh-CN，实际 ${a.lang}`);
  if (b.lang !== "en") problems.push(`点击后应为 en，实际 ${b.lang}`);
  if (b.label === a.label) problems.push("点击后按钮文字没变");
  if (b.headline === a.headline) problems.push("点击后页面文案没变——可能只是刷新了");
  if (c.lang !== "zh-CN") problems.push(`点回来应为 zh-CN，实际 ${c.lang}`);

  console.log(JSON.stringify({ zh: a, en: b, back: c }, null, 2));
  if (problems.length) {
    console.log("\n语言切换有问题：");
    for (const p of problems) console.log("  ✗ " + p);
    process.exitCode = 1;
  } else {
    console.log("\n语言切换正常：zh-CN → en → zh-CN，文案随语言改变");
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
