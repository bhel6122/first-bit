/* One-off: re-place the correct option on lessons that were generated before
   the slot planner existed. Only `quiz[].options` is touched — ids, pages,
   crafts and progress stay exactly as they were.

   Usage: node tools/migrate-quiz-slots.mjs */

import { readFileSync, writeFileSync } from "node:fs";
import { normalizeLesson } from "../lib/course.mjs";

const FILES = ["content/demo-course.json", "data/store.json"];

for (const file of FILES) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.log(`${file}  skipped (missing)`);
    continue;
  }
  const courses = doc.course ? [doc.course] : (doc.courses ?? []);
  let questions = 0;
  let moved = 0;

  for (const course of courses) {
    for (const [lid, lesson] of Object.entries(course.lessons ?? {})) {
      if (!lesson?.quiz?.length) continue;
      const before = lesson.quiz.map((q) => q.options.findIndex((o) => o.correct));
      const out = normalizeLesson({ title: lesson.title, pages: lesson.pages, quiz: lesson.quiz }, lesson.title);
      if (out.quiz.length !== lesson.quiz.length) continue;
      lesson.quiz = out.quiz;
      const after = lesson.quiz.map((q) => q.options.findIndex((o) => o.correct));
      questions += after.length;
      moved += after.filter((v, i) => v !== before[i]).length;
      void lid;
    }
  }

  writeFileSync(file, JSON.stringify(doc, null, 1));
  console.log(`${file}  ${questions} questions, ${moved} moved`);
}
