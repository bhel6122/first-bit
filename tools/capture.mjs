/* Report-grade screenshots: same CDP driver as shots.mjs, but at 2x and able to
   clip to a single element, so a before/after pair shows one control changing
   instead of a whole page that also changed for other reasons.

   Usage:
     node tools/capture.mjs <outdir> "name=<hash>" "name=<hash>@<selector>" ...

   A route may carry "!sel" to click something first, exactly like shots.mjs. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const BASE = process.env.BASE || "http://127.0.0.1:4173/";
const lang = process.env.LANG_UI || "zh";
const outDir = path.resolve(process.argv[2] || "report/shots");
const specs = process.argv.slice(3);
if (!specs.length) throw new Error("no capture specs");

/* A fresh profile per run: deleting the old one tripped the sandbox's bulk
   delete guard, and reusing it makes Chrome restore the previous session. */
const profile = path.join(tmpdir(), `wb-capture-${Date.now()}`);
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
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 960,
  deviceScaleFactor: 2,
  mobile: false,
});
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `try { localStorage.setItem("ui-lang", ${JSON.stringify(lang)}); } catch {}`,
});

for (const spec of specs) {
  const eq = spec.indexOf("=");
  const name = spec.slice(0, eq);
  let route = spec.slice(eq + 1);
  let selector = "";
  const at = route.lastIndexOf("@");
  if (at >= 0) {
    selector = route.slice(at + 1);
    route = route.slice(0, at);
  }
  const [hash, clicks] = route.split("!");

  await send("Page.navigate", { url: `${BASE}?r=${Date.now()}#${hash}` });
  await sleep(1700);

  if (clicks) {
    /* Attribute selectors start with "[", and prefixing those with "#" would
       produce an invalid selector and silently click nothing. */
    const picks = clicks
      .split("+")
      .map((s) => (s.startsWith("#") || s.startsWith(".") || s.startsWith("[") ? s : "#" + s));
    await send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        /* The first render lands after loadConfig(), so the input may not exist
           yet. Wait for it, then type, then click — and retry the click once if
           the form refused because the topic had not registered. */
        for (let i = 0; i < 20 && !document.querySelector("#create-topic, #topic-input"); i++) await wait(150);
        const t = document.querySelector("#create-topic, #topic-input");
        if (t) {
          t.value = "HTTP 缓存";
          t.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await wait(500);
        for (const sel of ${JSON.stringify(picks)}) {
          const el = document.querySelector(sel);
          if (el) el.click();
          await wait(900);
          if (document.querySelector("#create-topic, #topic-input") && !document.querySelector(".q-title")) {
            const again = document.querySelector("#create-topic, #topic-input");
            again.value = "HTTP 缓存";
            again.dispatchEvent(new Event("input", { bubbles: true }));
            await wait(400);
            document.querySelector(sel)?.click();
            await wait(900);
          }
        }
      })()`,
    });
    await sleep(1200);
  }

  let clip;
  if (selector) {
    /* Bring it into view first: getBoundingClientRect is viewport-relative, so an
       element below the fold gets clipped out and the crop comes back blank. */
    await send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center" })`,
    });
    await sleep(300);
    const box = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        /* Page.captureScreenshot clips in document coordinates, but
           getBoundingClientRect is viewport-relative — without the scroll offset
           anything below the fold crops to blank white. */
        return JSON.stringify({ x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height });
      })()`,
      returnByValue: true,
    });
    const raw = box.result.value;
    if (!raw) {
      console.log(`${name.padEnd(28)} MISSING ${selector}`);
      continue;
    }
    const r = JSON.parse(raw);
    const pad = 12;
    clip = {
      x: Math.max(0, r.x - pad),
      y: Math.max(0, r.y - pad),
      width: r.width + pad * 2,
      height: r.height + pad * 2,
      scale: 1,
    };
  }

  const shot = await send("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
  const file = path.join(outDir, `${name}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));

  /* The measured box is the only objective way to say "it got bigger". */
  if (selector) {
    const size = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        const r = el.getBoundingClientRect();
        return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) });
      })()`,
      returnByValue: true,
    });
    console.log(`${name.padEnd(28)} ${selector} ${size.result.value}`);
  } else {
    console.log(`${name.padEnd(28)} ok`);
  }
}

ws.close();
chrome.kill();
process.exit(0);
