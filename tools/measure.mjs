/* Objective numbers for the before/after table. Reads the seeded demo course
   only — no network, no model — so it can be re-run at any time and compared.

   Usage: node tools/measure.mjs <outfile> */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const raw = JSON.parse(readFileSync("content/demo-course.json", "utf8"));
const course = raw.course;
const lessons = Object.values(course.lessons ?? {});

const pos = [0, 0, 0];
let quizN = 0;
let correctLen = 0;
let distractorLen = 0;
let distractorN = 0;
let longestIsCorrect = 0;
let dupStem = 0;

const stems = new Map();

for (const L of lessons) {
  for (const q of L.quiz ?? []) {
    const i = q.options.findIndex((o) => o.correct);
    if (i < 0) continue;
    quizN++;
    if (i < 3) pos[i]++;
    const lens = q.options.map((o) => o.text.length);
    correctLen += lens[i];
    if (lens[i] === Math.max(...lens)) longestIsCorrect++;
    q.options.forEach((o, k) => {
      if (k !== i) {
        distractorLen += o.text.length;
        distractorN++;
      }
    });
    /* Options that open with the same few characters read as one blur. */
    const head = q.options.map((o) => o.text.slice(0, 4)).sort().join("|");
    stems.set(head, (stems.get(head) ?? 0) + 1);
  }
}

for (const n of stems.values()) if (n > 1) dupStem += n;

const pages = lessons.flatMap((L) => L.pages ?? []);
const steps = pages.flatMap((p) => p.steps ?? []);
const blocks = pages.flatMap((p) => p.blocks ?? []);
const stepChars = steps.map((s) => (s.say ?? "").length);

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

const out = {
  measuredAt: new Date().toISOString(),
  course: course.title,
  lessons: lessons.length,
  quiz: {
    questions: quizN,
    correctAtPosition: pos,
    correctFirstPct: quizN ? Math.round((pos[0] / quizN) * 100) : 0,
    /* A learner who always taps the first option scores this. */
    alwaysFirstOptionScore: quizN ? Math.round((pos[0] / quizN) * 100) : 0,
    correctIsLongest: longestIsCorrect,
    avgCharsCorrect: quizN ? Math.round(correctLen / quizN) : 0,
    avgCharsDistractor: distractorN ? Math.round(distractorLen / distractorN) : 0,
    optionsSharingOpening: dupStem,
  },
  board: {
    pages: pages.length,
    pagesPerLesson: +(pages.length / lessons.length).toFixed(1),
    blocksPerPage: +(blocks.length / pages.length).toFixed(1),
    stepsPerPage: +(steps.length / pages.length).toFixed(1),
    avgStepChars: avg(stepChars),
    minStepChars: Math.min(...stepChars),
    maxStepChars: Math.max(...stepChars),
  },
};

const file = process.argv[2] || "report/metrics.json";
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
