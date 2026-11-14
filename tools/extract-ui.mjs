/* Pull every Chinese UI string out of app/public/js/*.js so the dictionary can be
   written against the exact bytes that get rendered.

   Only short strings are collected: a label is a label. Anything long is course
   prose — lesson titles, quiz explanations — and is not ours to translate; it is
   generated in the language the course was written in. */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("app/public/js");
const MAX = 200;

/* Screens that already call t() at the call site. Their strings never reach the
   DOM pass, so listing them as "untranslated" would be noise. */
const MIGRATED = new Set(["i18n.js", "craft.js", "island.js"]);

const CJK = /[\u4e00-\u9fa5]/;

const out = new Map();

function add(raw, kind, file) {
  let s = raw.replace(/\s+/g, " ").trim();
  if (!s || !CJK.test(s)) return;
  if (s.length > MAX) return;
  /* Template and markup fragments: >text</div><p class=, ${icon(, , 14)} — these
     are artefacts of cutting a template at its punctuation, not strings. */
  if (/[<>]|\$\{|^[,)]|^\s*[,)]/.test(s)) return;
  if (/^(icon|esc|t)\(/.test(s)) return;
  /* A template literal that swallowed a block of code. No UI copy contains a
     statement terminator or an arrow, so this is a safe way to drop it. */
  if (/\};|=>|\bfunction\b|\bconst\b|\bdocument\./.test(s)) return;
  if (!out.has(s)) out.set(s, { kind, file, n: 0 });
  out.get(s).n += 1;
}

for (const name of (await readdir(DIR)).sort()) {
  if (!name.endsWith(".js")) continue;
  if (MIGRATED.has(name)) continue;
  const src = await readFile(path.join(DIR, name), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // >text< inside template literals
  for (const m of code.matchAll(/>([^<>{}]+)</g)) add(m[1], "text", name);
  // plain string literals
  for (const m of code.matchAll(/"([^"\\\n]*[\u4e00-\u9fa5][^"\\\n]*)"/g)) add(m[1], "str", name);
  // template literal chunks without interpolation
  for (const m of code.matchAll(/`([^`$]*[\u4e00-\u9fa5][^`$]*)`/g)) add(m[1], "tpl", name);
  // text-bearing attributes
  for (const m of code.matchAll(/(?:title|placeholder|aria-label)="([^"]*[\u4e00-\u9fa5][^"]*)"/g)) add(m[1], "attr", name);
  // toasts / confirms / alerts
  for (const m of code.matchAll(/(?:toast|confirm|alert)\(\s*(?:`|")([^`"$]*[\u4e00-\u9fa5][^`"$]*)/g)) add(m[1], "msg", name);
}

const list = [...out.entries()].sort((a, b) => b[1].n - a[1].n);
await writeFile(path.resolve("tools/ui-strings.json"), JSON.stringify(list.map(([s, m]) => ({ s, ...m })), null, 1));

console.log(`${list.length} strings`);
for (const [s, m] of list) console.log(`${String(m.n).padStart(3)} ${m.kind.padEnd(4)} ${s}`);
