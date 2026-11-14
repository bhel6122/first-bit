/* Runs the grounding audit over already-generated lessons, so the "before"
   number is produced by the same instrument as the "after" number.

   Usage: node tools/audit-grounding.mjs <outfile> [lessonCount] */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { auditGrounding } from "../lib/generate.mjs";

const out = process.argv[2] || "report/grounding.json";
const limit = Number(process.argv[3] || 0);

const course = JSON.parse(readFileSync("content/demo-course.json", "utf8")).course;
const order = [];
for (const u of course.units ?? []) for (const l of u.lessons ?? []) order.push({ ...l, unitId: u.id });

const rows = [];
let prev = null;
let total = 0;

for (const item of order) {
  if (limit && rows.length >= limit) break;
  const lesson = course.lessons?.[item.id];
  if (!lesson?.pages?.length) continue;
  const gaps = await auditGrounding({ pages: lesson.pages, prevData: prev, lesson });
  total += gaps.length;
  rows.push({ lessonId: item.id, title: lesson.title, gaps });
  console.log(`${item.id}  ${gaps.length ? gaps.length + " 处" : "0"}  ${lesson.title}`);
  for (const g of gaps) console.log(`    p${g.page} ${g.term} — ${g.why}`);
  prev = lesson;
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ lessons: rows.length, total, rows }, null, 2));
console.log(`\n${rows.length} 讲，共 ${total} 处断链，平均 ${(total / rows.length).toFixed(2)} 处/讲`);
