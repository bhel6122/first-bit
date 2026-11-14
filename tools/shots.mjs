/* Headless screenshots through CDP, with the UI language forced before any app
   script runs — localStorage is the only place the switch lives, so it has to be
   set in an init script rather than by clicking the button between pages.

   Usage: node tools/shots.mjs <lang> <outdir> [hash...] */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const BASE = process.env.BASE || "http://127.0.0.1:4173/";
const lang = process.argv[2] || "en";
const outDir = path.resolve(process.argv[3] || `shots/${lang}`);
const routes = process.argv.slice(4);
if (!routes.length) routes.push("/");

const profile = path.resolve(".chrome-shot-profile");
await rm(profile, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* chrome is still coming up */
    }
    await sleep(250);
  }
  throw new Error("chrome did not expose a page target");
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};

function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `try { localStorage.setItem("ui-lang", ${JSON.stringify(lang)}); } catch {}`,
});

for (const route of routes) {
  /* "create!to-step2" navigates to #/create, then clicks #to-step2 — a cheap way
     to screenshot a step that only exists after an interaction. */
  const [hash, clickSel] = route.split("!");
  /* A cache-busting query forces a full reload: a hash-only change keeps the
     previous page alive and every click then lands on stale DOM. */
  const url = BASE + "?r=" + Date.now() + "#" + hash;
  await send("Page.navigate", { url });
  await sleep(1500);
  if (clickSel) {
    /* Selectors joined by "+" are clicked in order, which is how the states that
       only exist after an interaction get audited: a submitted puzzle, a battle
       that was already answered, a terminal that already ran. */
    const picks = clickSel.split("+").map((s) => (s.startsWith("#") || s.startsWith(".") ? s : "#" + s));
    await send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[data-mode="self"]')?.click();
        await wait(400);
        const t = document.querySelector("#topic-input");
        if (t) { t.value = "HTTP caching"; t.dispatchEvent(new Event("input", { bubbles: true })); }
        await wait(200);
        for (const sel of ${JSON.stringify(picks)}) {
          const el = document.querySelector(sel);
          if (el) el.click();
          await wait(700);
        }
      })()`,
    });
    await sleep(1400);
  }
  const name = route.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "home";
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));

  /* Leftover Chinese is the only way to see a hole in the dictionary. Report the
     element too, otherwise a stray string tells you nothing about where to look. */
  const probe = await send("Runtime.evaluate", {
    expression: `(() => {
      const CJK = /[\\u4e00-\\u9fa5]/;
      const SKIP = "pre,code,.board-inner,.transcript,.chat,[data-no-i18n]";
      const label = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
        (typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
          : "");
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        const n = walk.currentNode;
        const s = n.nodeValue.trim();
        if (!s || !CJK.test(s)) continue;
        const p = n.parentElement;
        if (!p || p.closest(SKIP)) continue;
        out.push("text " + label(p) + " :: " + s.slice(0, 50));
      }
      for (const a of ["title", "placeholder", "aria-label", "alt"]) {
        for (const el of document.querySelectorAll("[" + a + "]")) {
          if (el.closest(SKIP)) continue;
          const v = el.getAttribute(a) || "";
          if (CJK.test(v)) out.push(a + " " + label(el) + " :: " + v.slice(0, 50));
        }
      }
      for (const el of document.querySelectorAll("input[type=submit],input[type=button]")) {
        const v = el.value || "";
        if (CJK.test(v)) out.push("value " + label(el) + " :: " + v.slice(0, 50));
      }
      return JSON.stringify([...new Set(out)]);
    })()`,
    returnByValue: true,
  });
  const leftover = JSON.parse(probe.result.value || "[]");
  if (!leftover.length) console.log(`${route.padEnd(22)} clean`);
  else {
    console.log(`${route.padEnd(22)} ${leftover.length} zh left`);
    for (const s of leftover) console.log("    - " + s);
  }
}

ws.close();
chrome.kill();
process.exit(0);
