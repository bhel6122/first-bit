/* Grounding audit over an already-generated course, using the same instrument
   for the before and the after run so the two numbers are comparable.

   Usage: node tools/audit-course.mjs <demo|courseId> <outfile> */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { auditGrounding } from "../lib/generate.mjs";

const which = process.argv[2] || "demo";
const out = process.argv[3] || "report/grounding.json";

const course =
  which === "demo"
    ? JSON.parse(readFileSync("content/demo-course.json", "utf8")).course
    : (JSON.parse(readFileSync("data/store.json", "utf8")).courses ?? []).find((c) => c.id === which);

if (!course) {
  console.error(`no such course: ${which}`);
  process.exit(1);
}

const order = [];
for (const u of course.units ?? []) for (const l of u.lessons ?? []) order.push(l.id);

const rows = [];
let prev = null;
let total = 0;

for (const id of order) {
  const lesson = course.lessons?.[id];
  if (!lesson?.pages?.length) continue;
  const gaps = await auditGrounding({ pages: lesson.pages, prevData: prev, lesson });
  total += gaps.length;
  rows.push({ lessonId: id, title: lesson.title, gaps });
  console.log(`${id}  ${gaps.length ? gaps.length + " 处" : "0"}  ${lesson.title}`);
  for (const g of gaps) console.log(`    p${g.page} ${g.term} — ${g.why}`);
  prev = lesson;
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ course: course.title, lessons: rows.length, total, rows }, null, 2));
console.log(`\n${course.title}：${rows.length} 讲，共 ${total} 处，平均 ${(total / rows.length).toFixed(2)} 处/讲`);
