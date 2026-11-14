#!/usr/bin/env node
/* Static dead-control audit — the cheap half of the story.
 *
 * What it can see without a browser:
 *   1. <button id="x"> where #x is never selected and no data-act routes it
 *   2. an act === "x" branch with no button emitting data-act="x"
 *
 * What it deliberately does NOT try to guess: whether `data-something` is wired
 * up. That question needs the element to exist, and the tempting static answer is
 * wrong — the 讲解 / 追问 pills carried data-tab and `dataset.tab` *was* read (to
 * paint the active pill) while no click handler existed at all. Use
 * tools/test-controls.mjs for that half: it presses every button and asks whether
 * anything happened.
 *
 *   node tools/audit-buttons.mjs
 */

import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "app/public/js");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
const sources = new Map(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
const all = () => [...sources.values()].join("\n");

let problems = 0;
const report = (msg, sample) => {
  problems++;
  console.log(`✗ ${msg}`);
  if (sample) console.log(`    ${sample.trim().slice(0, 110)}`);
};

for (const [f, src] of sources) {
  const re = /<button([^>]*)>/g;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1];
    if (/\bdata-act=/.test(attrs)) continue; // routed by the click delegate
    const idm = attrs.match(/\bid="([^"]+)"/);
    if (!idm) continue;

    const id = idm[1];
    const line = src.slice(0, m.index).split("\n").length;
    const used = [...sources].some(([g, s]) => {
      const body = g === f ? s.replace(m[0], "") : s;
      return new RegExp(`["'\`]#${id}["'\`\\s,\\]]`).test(body) || body.includes(`getElementById("${id}`) || body.includes(`getElementById('${id}`);
    });
    if (!used) report(`${f}:${line}  <button id="${id}"> 没有任何地方绑定它`, src.split("\n")[line - 1]);
  }

  const routed = new Set();
  const rr = /act === "([a-z-]+)"/g;
  while ((m = rr.exec(src))) routed.add(m[1]);
  for (const act of routed) {
    if (!all().includes(`data-act="${act}"`)) report(`${f}  data-act="${act}" 被处理了，但没有按钮会发出它`);
  }
}

console.log(problems ? `\n${problems} 处问题` : "没有发现死按钮");
process.exit(problems ? 1 : 0);
