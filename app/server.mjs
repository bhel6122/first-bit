/* first-bit server. Zero dependencies: node:http, one JSON file, and the
   modules next door. Generation is a job because a blueprint takes 15-40 seconds
   and a silent POST for that long looks like a broken page. */

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { llmState, providerLabel, hasModel } from "../lib/llm.mjs";
import { buildOutline, buildLesson, answerQuestion, diagnoseUnit, explainOutline, suggestTopic, tutorReply } from "../lib/generate.mjs";
import { generateBug } from "../lib/bug.mjs";
import { generateCraft, publicCraft, scoreCraft } from "../lib/craft.mjs";
import { extractPdfText } from "../lib/pdf.mjs";
import { normalizeOutline, checkOutline, quizForLearner, neighbors, lessonMeta, boardText } from "../lib/course.mjs";
import {
  seedDemo, listCourses, rawCourse, createCourse, saveOutline, confirmCourse, removeCourse,
  setLesson, recordPage, recordAnswer, answersFor, toggleProject, projectsDone,
  saveNotes, getNotes, progressFor, unitQuiz, activitySummary, storeInfo, countAll,
  dueReviews, reviewCount, wrongForUnit,
  getPlayer, savePlayerProfile, recordBattle, recordTerminal, cachedTerminal, saveTerminal, gameFor,
  recordCraft, cachedCraft, saveCraft,
  refreshStore, flushNow,
} from "./store.mjs";
import { kvReady, kvGet, kvSet, kvPrefix } from "./kv.mjs";

const PORT = Number(process.env.PORT || 5200);
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const SAMPLES = fileURLToPath(new URL("../content/samples/", import.meta.url));
const seeded = seedDemo();
/* A fresh deployment seeds the sample course; land that write now instead of
   letting the debounce carry it into an instance that may freeze. */
if (seeded && kvReady) await flushNow();

/* -------------------------------- helpers -------------------------------- */

const json = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

const readBody = (req, limit = 1_500_000) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > limit) reject(new Error("内容太长，请只粘贴需要的那一部分。"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求格式不对。"));
      }
    });
  });

/* PDFs arrive as raw bytes, not JSON. */
const readRaw = (req, limit = 26_000_000) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("PDF 太大（超过 25MB）。拆成几份，或只传需要的章节。"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => reject(new Error("上传中断了，再试一次。")));
  });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function serveStatic(res, urlPath) {
  const name = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (name.includes("..")) return false;
  try {
    const body = await readFile(join(PUBLIC, name));
    /* no-cache (not no-store): the browser may keep the file but must
       revalidate on every load, so a redeploy shows up on plain reload
       instead of serving a stale copy of home.js from the heuristic cache. */
    res.writeHead(200, {
      "content-type": MIME[extname(name)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------- jobs ---------------------------------- */

/* Serverless hosts freeze an instance once its handler promise resolves, not
   when the response is sent. So a job may keep going after its POST answered —
   the entry point simply refuses to resolve until the work is done (see
   `drainJobs`), which is the same trick `waitUntil` uses. `SYNC_JOBS=1` is the
   blunt alternative: answer only once the generation finished. */
const SYNC_JOBS = process.env.SYNC_JOBS === "1";

const jobs = new Map();
const active = new Map();
let running = 0;
let lastSnapshot = 0;

const jobSnapshot = (job) => ({
  id: job.id, kind: job.kind, state: job.state, phase: job.phase, label: job.label,
  pct: job.pct, result: job.result, error: job.error,
  startedAt: job.startedAt, finishedAt: job.finishedAt ?? null,
});

/* Two warm instances cannot see each other's memory: the POST may be answered
   by one and the poll by another. Snapshots go to Redis so polling survives
   that (and a cold start between the two). */
async function saveJob(job) {
  if (!kvReady) return;
  try {
    await kvSet(`${kvPrefix}:job:${job.id}`, JSON.stringify(jobSnapshot(job)), 1800);
  } catch { /* the job still completes; only the poll snapshot is lost */ }
}

async function loadJob(id) {
  if (!kvReady) return null;
  try {
    const raw = await kvGet(`${kvPrefix}:job:${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function runJob(kind, key, work) {
  if (key && active.has(key)) return jobs.get(active.get(key));

  const id = `j${Date.now().toString(36)}${(jobs.size % 97).toString(36)}`;
  const job = {
    id, kind, state: "running", phase: "start", label: "准备中", pct: 4,
    result: null, error: null, startedAt: Date.now(),
  };
  jobs.set(id, job);
  if (key) active.set(key, id);
  running++;
  void saveJob(job);

  const phase = (name, label, pct) => {
    job.phase = name;
    job.label = label;
    if (Number.isFinite(pct)) job.pct = pct;
    /* Polls may land on another instance; a throttled snapshot per phase is
       what keeps the progress bar moving there. */
    if (Date.now() - lastSnapshot > 900) {
      lastSnapshot = Date.now();
      void saveJob(job);
    }
  };

  const done = work(phase)
    .then((result) => {
      job.result = result;
      job.state = "done";
      job.pct = 100;
      job.label = "完成";
    })
    .catch((e) => {
      job.state = "error";
      job.error = e.userMessage || e.message || "生成失败";
      console.error(`[job  ] ${kind}: ${job.error}`);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      running--;
      if (key) active.delete(key);
      void saveJob(job);
      setTimeout(() => jobs.delete(id), 30 * 60 * 1000).unref?.();
    });

  if (SYNC_JOBS) await done;
  return job;
}

/* Hold the invocation open until the generations started here have finished,
   then land whatever they wrote. Returns false if the ceiling was hit. */
export async function drainJobs(maxMs = 270_000) {
  const until = Date.now() + maxMs;
  while (running > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await flushNow();
  return running === 0;
}

/* -------------------------------- views -------------------------------- */

function courseView(course, learner = "me") {
  const p = progressFor(course, learner);
  const done = projectsDone(course.id, learner);
  const nextLesson = p.lastLesson
    ? (course.units.flatMap((u) => u.lessons).find((l) => l.id === p.lastLesson) ?? null)
    : null;

  return {
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    promise: course.promise,
    audience: course.audience,
    /* Content language, not interface language — the page shows a badge so nobody
       wonders why an English course answers in Chinese. */
    lang: course.lang ?? course.answers?.lang ?? "zh",
    mode: course.mode,
    track: course.track ?? null,
    scale: course.scale,
    game: (() => {
      const g = gameFor(course);
      return {
        stars: g.stars ?? {},
        cleared: g.cleared ?? [],
        terminals: g.terminals ?? {},
        builds: g.builds ?? {},
      };
    })(),
    confirmed: Boolean(course.confirmed),
    demo: Boolean(course.demo),
    materials: course.materials ?? [],
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    units: (course.units ?? []).map((u) => ({
      id: u.id,
      title: u.title,
      goal: u.goal,
      project: { ...u.project, done: done.has(u.id) },
      test: (() => {
        const t = unitQuiz(course, u.id, learner);
        return { total: t?.questions.length ?? 0, answered: t?.answered ?? 0, correct: t?.correct ?? 0 };
      })(),
      lessons: u.lessons.map((l) => {
        const lp = p.perLesson[l.id] ?? {};
        return {
          id: l.id,
          title: l.title,
          summary: l.summary,
          prereq: l.prereq ?? "",
          minutes: l.minutes,
          generated: Boolean(course.lessons?.[l.id]),
          pages: lp.pages ?? 0,
          started: (lp.furthest ?? 0) > 0,
          complete: Boolean(lp.complete),
          correct: lp.correct ?? 0,
          quizTotal: lp.quizTotal ?? 0,
        };
      }),
    })),
    stats: p.stats,
    progress: p.percent,
    review: { due: reviewCount(course.id, learner) },
    lastLesson: nextLesson?.id ?? null,
    nextLesson: nextLesson ? { id: nextLesson.id, title: nextLesson.title } : null,
  };
}

/* -------------------------------- routes -------------------------------- */

/* One request handler, two hosts: a long-running server (`npm start`) and a
   serverless function (`api/index.mjs`). Keeping it a plain (req, res) function
   is what makes the same code run on both without a rewrite. */
export async function handler(req, res) {
  /* Another instance may have written since this one last read. */
  await refreshStore();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (req.method === "GET" && path === "/healthz") {
      return json(res, 200, { ok: true, model: llmState(), store: storeInfo(), counts: countAll(), uptime: Math.round(process.uptime()) });
    }

    if (req.method === "GET" && path === "/api/config") {
      return json(res, 200, {
        provider: providerLabel(),
        model: llmState(),
        courses: listCourses("me"),
      });
    }

    /* --------------------------------- pdf ---------------------------------- */

    if (req.method === "POST" && path === "/api/pdf-text") {
      const name = String(url.searchParams.get("name") ?? "材料.pdf").slice(0, 80);
      const buf = await readRaw(req);
      if (!buf.length) return json(res, 400, { error: "没有收到文件内容。" });
      if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
        return json(res, 400, { error: "这不是 PDF 文件。" });
      }
      try {
        const { pages, text } = await extractPdfText(new Uint8Array(buf));
        return json(res, 200, { name, pages, chars: text.length, text: text.slice(0, 120_000) });
      } catch (e) {
        return json(res, 422, { error: e.userMessage || "PDF 解析失败，可以把文字复制出来粘贴。" });
      }
    }

    if (req.method === "GET" && path === "/api/sample") {
      try {
        const files = (await readdir(SAMPLES)).filter((f) => /\.(md|txt)$/.test(f));
        const file = files[0];
        if (!file) return json(res, 404, { error: "没有示例材料" });
        const text = await readFile(join(SAMPLES, file), "utf8");
        return json(res, 200, { name: file.replace(/\.(md|txt)$/, ""), text });
      } catch {
        return json(res, 404, { error: "没有示例材料" });
      }
    }

    /* -------------------------------- create -------------------------------- */

    if (req.method === "POST" && path === "/api/outline") {
      const body = await readBody(req);
      const mode = body.mode === "school" ? "school" : "self";
      const answers = body.answers ?? {};
      const track = ["frontend", "backend", "ui"].includes(body.track) ? body.track : null;
      const materials = (Array.isArray(body.materials) ? body.materials : [])
        .map((m) => ({ name: String(m?.name ?? "材料").slice(0, 80), text: String(m?.text ?? "") }))
        .filter((m) => m.text.trim().length > 0)
        .slice(0, 5);

      if (!String(answers.topic ?? "").trim()) return json(res, 400, { error: "先告诉我你想学什么。" });
      if (mode === "school" && !materials.length && String(answers.topic).length < 4) {
        return json(res, 400, { error: "跟课学需要至少一份材料，或者写清课程名。" });
      }

      const job = await runJob("outline", null, async (phase) => {
        const { outline, report, stats, chosen, alternatives } = await buildOutline({ answers: { ...answers, track }, mode, materials }, phase);
        const course = createCourse(outline, { mode, answers, materials, track });
        /* Kept in the job payload: which shape won, and by how much, is the only
           way to tell later whether the double draft was worth its cost. */
        console.log(`[outline] chose ${chosen} of ${alternatives.map((a) => `${a.shape}:${a.score}`).join(" ")}`);
        return { courseId: course.id, report, stats, chosen, alternatives };
      });

      return json(res, 200, { jobId: job.id });
    }

    if (req.method === "GET" && path.startsWith("/api/jobs/")) {
      const jobId = path.split("/").pop();
      const job = jobs.get(jobId) ?? (await loadJob(jobId));
      if (!job) return json(res, 404, { error: "任务不存在或已过期" });
      return json(res, 200, {
        id: job.id,
        state: job.state,
        phase: job.phase,
        label: job.label,
        pct: job.pct,
        result: job.result,
        error: job.error,
        seconds: Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000),
      });
    }

    /* -------------------------------- course -------------------------------- */

    if (req.method === "GET" && path === "/api/courses") {
      return json(res, 200, listCourses("me"));
    }

    if (req.method === "GET" && path.startsWith("/api/course/") && path.split("/").length === 4) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      return json(res, 200, { course: courseView(course), materials: course.materials ?? [] });
    }

    if (req.method === "PATCH" && /^\/api\/course\/[^/]+\/outline$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      const body = await readBody(req);

      const outline = normalizeOutline(
        {
          title: body.title,
          subtitle: body.subtitle,
          promise: body.promise,
          audience: body.audience,
          units: body.units,
        },
        { topic: course.title, scale: course.scale ?? "standard", mode: course.mode, keepIds: true },
      );
      const report = checkOutline(outline, { scale: course.scale ?? "standard" });
      if (!report.ok) return json(res, 400, { error: report.errors[0], report });

      saveOutline(courseId, outline);
      return json(res, 200, { ok: true, course: courseView(rawCourse(courseId)), report });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/outline\/ask$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });

      const { question, unitId, lessonId = "" } = await readBody(req, 60_000);
      const text = String(question ?? "").trim();
      if (!text) return json(res, 400, { error: "问题不能为空" });
      const unit = (course.units ?? []).find((u) => u.id === String(unitId));
      if (!unit) return json(res, 400, { error: "没有这个单元" });
      const lesson = lessonId ? unit.lessons.find((l) => l.id === String(lessonId)) : null;
      if (lessonId && !lesson) return json(res, 400, { error: "没有这一讲" });

      const result = await explainOutline({ course, unit, lesson, question: text });
      return json(res, 200, result);
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/confirm$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = confirmCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      return json(res, 200, { ok: true, course: courseView(course) });
    }

    if (req.method === "DELETE" && /^\/api\/course\/[^/]+$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      return removeCourse(courseId) ? json(res, 200, { ok: true }) : json(res, 404, { error: "没有这门课" });
    }

    /* -------------------------------- lesson -------------------------------- */

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      const found = course ? lessonMeta(course, lessonId) : null;
      if (!found) return json(res, 404, { error: "没有这一讲" });

      const force = url.searchParams.get("force") === "1";
      if (!force && course.lessons?.[lessonId]) {
        return json(res, 200, { cached: true, lessonId });
      }

      const job = await runJob("lesson", `${courseId}:${lessonId}`, async (phase) => {
        // Carry the previous lesson's board forward so this one continues it
        // instead of restating the same ground.
        const prev = neighbors(course, lessonId).prev;
        const prevData = prev ? course.lessons?.[prev.id] ?? null : null;
        const { lesson, report, grounding, groundingBefore } = await buildLesson(course, found.unit, found.lesson, phase, prevData);
        setLesson(courseId, lessonId, lesson);
        /* How many ungrounded concepts survived the repair pass is the only
           signal that the audit did anything; keep it in the job payload. */
        if (grounding?.length) console.log(`[ground] ${lessonId} ${groundingBefore} -> ${grounding.length}`);
        return {
          lessonId, title: lesson.title, pages: lesson.pages.length, quiz: lesson.quiz.length, report,
          grounding: (grounding ?? []).map((g) => ({ page: g.page, term: g.term })),
          groundingBefore,
        };
      });
      return json(res, 200, { jobId: job.id });
    }

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/lesson\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      const found = course ? lessonMeta(course, lessonId) : null;
      if (!found) return json(res, 404, { error: "没有这一讲" });
      const data = course.lessons?.[lessonId];
      if (!data) {
        return json(res, 200, {
          generated: false,
          lesson: null,
          meta: found.lesson,
          unit: { id: found.unit.id, title: found.unit.title, goal: found.unit.goal, index: course.units.indexOf(found.unit) },
          course: { id: course.id, title: course.title },
          neighbors: neighbors(course, lessonId),
        });
      }

      const answers = answersFor(courseId, lessonId, "me");
      return json(res, 200, {
        generated: true,
        lesson: {
          title: data.title,
          pages: data.pages,
          generatedAt: data.generatedAt,
          quiz: quizForLearner(data), // no correct flags leave the server
        },
        answered: answers.map((a) => ({ qid: a.qid, option: a.option, correct: a.correct })),
        neighbors: neighbors(course, lessonId),
        progress: progressFor(course, "me").perLesson[lessonId],
        meta: found.lesson,
        unit: { id: found.unit.id, title: found.unit.title, goal: found.unit.goal },
        course: { id: course.id, title: course.title },
      });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/ask$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      const found = course ? lessonMeta(course, lessonId) : null;
      const data = course?.lessons?.[lessonId];
      if (!found || !data) return json(res, 404, { error: "这一讲还没生成" });

      const { question, page = 1, mode = "answer", focus = "" } = await readBody(req, 60_000);
      /* A re-pitch is triggered by a button, not by typing, so there may be no
         question — just "that page did not land". */
      const text =
        String(question ?? "").trim() ||
        (mode === "repitch" ? "这一页我没听懂，请换一种说法重讲。" : "");
      if (!text) return json(res, 400, { error: "问题不能为空" });

      const at = Math.max(1, Math.min(data.pages.length, Number(page) || 1));

      /* Re-pitching is a different job from answering: it steps back and changes
         register, which the tutor prompt already knows how to do. */
      if (mode === "repitch") {
        try {
          const answer = await tutorReply({
            course,
            unit: found.unit,
            lesson: data,
            page: at,
            focus: String(focus ?? "").slice(0, 4000),
            question: text,
            mode: "repitch",
          });
          /* The reply is about the page the learner is looking at, so the jump
             target is that page — the model's own page guess drifts. */
          return json(res, 200, { ...answer, page: at });
        } catch (e) {
          return json(res, 503, { error: e.userMessage || "导师这会儿没接上模型" });
        }
      }

      const answer = await answerQuestion({
        course, unit: found.unit, lesson: data,
        page: at,
        question: text,
      });
      return json(res, 200, answer);
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/answer$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      const data = course?.lessons?.[lessonId];
      if (!data) return json(res, 404, { error: "这一讲还没生成" });

      const { qid, option } = await readBody(req, 60_000);
      const q = (data.quiz ?? []).find((x) => x.id === qid);
      if (!q) return json(res, 400, { error: "没有这道题" });
      const chosen = q.options[Number(option)];
      if (!chosen) return json(res, 400, { error: "选项不存在" });

      const correctIndex = q.options.findIndex((o) => o.correct);
      recordAnswer({ courseId, lessonId, qid, option: Number(option), correct: chosen.correct === true });
      const p = progressFor(course, "me");

      return json(res, 200, {
        correct: chosen.correct === true,
        correctIndex,
        explain: q.explain,
        page: q.page,
        progress: p.perLesson[lessonId],
        courseProgress: p.percent,
      });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/page$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course?.lessons?.[lessonId]) return json(res, 404, { error: "这一讲还没生成" });
      const { page, seconds = 0, complete = false } = await readBody(req, 60_000);
      const total = course.lessons[lessonId].pages.length;
      if (!Number.isInteger(page) || page < 1 || page > total) return json(res, 400, { error: "页码不对" });
      recordPage({ courseId, lessonId, page, seconds, complete });
      return json(res, 200, { ok: true, progress: progressFor(course, "me").perLesson[lessonId] });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/complete$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course?.lessons?.[lessonId]) return json(res, 404, { error: "这一讲还没生成" });
      const { seconds = 0 } = await readBody(req, 60_000);
      recordPage({ courseId, lessonId, page: course.lessons[lessonId].pages.length, seconds, complete: true });
      const p = progressFor(course, "me");
      return json(res, 200, {
        ok: true,
        progress: p.percent,
        next: neighbors(course, lessonId).next,
      });
    }

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/notes$/.test(path)) {
      const parts = path.split("/");
      const notes = getNotes(decodeURIComponent(parts[3]), decodeURIComponent(parts[5]));
      return json(res, 200, notes ?? { markdown: "", updatedAt: null });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/lesson\/[^/]+\/notes$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const { markdown = "" } = await readBody(req);
      return json(res, 200, { ok: true, notes: saveNotes(courseId, lessonId, String(markdown).slice(0, 60_000)) });
    }

    /* -------------------------------- project -------------------------------- */

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/project\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const unitId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course?.units?.some((u) => u.id === unitId)) return json(res, 404, { error: "没有这个单元" });
      const { done } = await readBody(req, 60_000);
      toggleProject({ courseId, unitId, done });
      return json(res, 200, { ok: true, course: courseView(course) });
    }

    /* --------------------------------- tests --------------------------------- */

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/unit\/[^/]+\/test$/.test(path)) {
      const parts = path.split("/");
      const course = rawCourse(decodeURIComponent(parts[3]));
      if (!course) return json(res, 404, { error: "没有这门课" });
      const test = unitQuiz(course, decodeURIComponent(parts[5]));
      return test ? json(res, 200, test) : json(res, 404, { error: "没有这个单元" });
    }

    /* -------------------------------- review -------------------------------- */

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/review$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      return json(res, 200, dueReviews(courseId));
    }

    /* ------------------------------- diagnose ------------------------------- */

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/unit\/[^/]+\/diagnose$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const unitId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      const unit = (course.units ?? []).find((u) => u.id === unitId);
      if (!unit) return json(res, 404, { error: "没有这个单元" });

      const wrong = wrongForUnit(course, unitId);
      const t = unitQuiz(course, unitId);
      const p = progressFor(course, "me");
      const stats = {
        done: unit.lessons.filter((l) => p.perLesson[l.id]?.complete).length,
        total: unit.lessons.length,
        correct: t?.correct ?? 0,
        totalQuestions: t?.questions.length ?? 0,
      };
      const diagnosis = await diagnoseUnit({ course, unit, wrong, stats });
      return json(res, 200, { ...diagnosis, wrongCount: wrong.length, stats });
    }

    /* --------------------------------- game --------------------------------- */

    if (req.method === "GET" && path === "/api/player") {
      return json(res, 200, getPlayer());
    }

    if (req.method === "POST" && path === "/api/player/profile") {
      const body = await readBody(req, 200_000);
      const track = ["frontend", "backend", "ui"].includes(body.track) ? body.track : null;
      const mixed = ["frontend", "backend", "ui"].includes(body.mixed) ? body.mixed : null;
      return json(res, 200, savePlayerProfile({
        scores: body.scores && typeof body.scores === "object" ? body.scores : null,
        fit: body.fit && typeof body.fit === "object" ? body.fit : null,
        track, mixed, answers: body.answers ?? null,
      }));
    }

    if (req.method === "POST" && path === "/api/game/topic") {
      const { track = "frontend", codes = [], weekly = "", experience = "" } = await readBody(req, 60_000);
      try {
        const pick = await suggestTopic({ track, codes, weekly, experience });
        if (!pick.topic) throw new Error("empty topic");
        return json(res, 200, pick);
      } catch {
        return json(res, 200, { topic: null, reason: "现编没成功，先选一个预置主题吧。", offline: true });
      }
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/battle\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      // "u:<unitId>" is a region boss; anything else must be a generated lesson.
      const isBossKey = lessonId.startsWith("u:");
      const known = isBossKey
        ? (course.units ?? []).some((u) => u.id === lessonId.slice(2))
        : Boolean(course.lessons?.[lessonId]);
      if (!known) return json(res, 404, { error: "这一讲还没生成" });

      const body = await readBody(req, 200_000);
      const rounds = Array.isArray(body.rounds) ? body.rounds.slice(0, 20) : [];
      const hearts = Math.max(0, Math.min(9, Number(body.heartsLeft ?? 0)));
      const total = Math.max(1, rounds.length);
      const firstCorrect = rounds.filter((r) => r && r.firstCorrect).length;
      const failed = hearts <= 0;
      const stars = failed ? 0 : firstCorrect >= total ? 3 : firstCorrect >= total - 2 ? 2 : 1;
      const prev = Number(gameFor(course).stars?.[lessonId]) || 0;
      const xp = failed || prev > 0 ? 0 : 10 * firstCorrect + 30 + (stars === 3 ? 15 : stars === 2 ? 8 : 3);

      if (failed) return json(res, 200, { ok: false, stars: 0, xp: 0, player: getPlayer(), firstClear: false });
      const out = recordBattle(courseId, lessonId, { stars, xp });
      return json(res, 200, { ok: true, xp, ...out });
    }

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/terminal\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const unitId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });
      const unit = (course.units ?? []).find((u) => u.id === unitId);
      if (!unit) return json(res, 404, { error: "没有这个区域" });

      const cached = cachedTerminal(courseId, unitId);
      if (cached) {
        return json(res, 200, { bug: cached, progress: gameFor(course).terminals?.[unitId] ?? null });
      }

      const last = unit.lessons[unit.lessons.length - 1];
      const bug = await generateBug({
        track: course.track ?? "frontend",
        courseTitle: course.title,
        unitTitle: unit.title,
        lessonTitle: last?.title ?? unit.title,
      });
      saveTerminal(courseId, unitId, bug);
      return json(res, 200, { bug, progress: null });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/terminal\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const unitId = decodeURIComponent(parts[5]);
      if (!rawCourse(courseId)) return json(res, 404, { error: "没有这门课" });

      const { solved = false, attempts = 0 } = await readBody(req, 60_000);
      const tries = Math.max(0, Math.min(99, Number(attempts) || 0));
      const xp = solved ? 60 + (tries <= 1 ? 40 : 0) : 0;
      const out = recordTerminal(courseId, unitId, { solved: Boolean(solved), xp, attempts: tries });
      return json(res, 200, { ...out, xp: out?.firstSolve ? xp : 0 });
    }

    /* ------------------------------ craft (build) ------------------------------ */

    /* Two more ways to be wrong than multiple choice offers: a sequence that does
       not run, and a wiring that does not hold. Generated once per lesson and
       cached, because re-rolling the puzzle after every reload would let a
       learner grind until an easy one came up. */

    if (req.method === "GET" && /^\/api\/course\/[^/]+\/craft\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });

      const units = course.units ?? [];
      const unit = units.find((u) => u.lessons.some((l) => l.id === lessonId)) ?? null;
      const lesson = unit?.lessons.find((l) => l.id === lessonId) ?? null;
      if (!lesson) return json(res, 404, { error: "没有这一讲" });

      const progress = gameFor(course).builds?.[lessonId] ?? null;
      const cached = cachedCraft(courseId, lessonId);
      if (cached) {
        return json(res, 200, { craft: publicCraft(cached, { lessonId, lessonTitle: lesson.title }), progress });
      }
      if (!hasModel()) {
        return json(res, 503, { error: "这个环境没有配置模型，这一讲的拼装题还没生成。", progress });
      }

      const data = course.lessons?.[lessonId] ?? null;
      const digest = (data?.pages ?? [])
        .map((p, i) => `第 ${i + 1} 页《${p.title}》：${boardText(p).slice(0, 260)}`)
        .join("\n");
      const build = await generateCraft({
        track: course.track ?? "frontend",
        courseTitle: course.title,
        unitTitle: unit?.title ?? "",
        lesson: { id: lesson.id, title: lesson.title, summary: lesson.summary ?? "" },
        digest,
      });
      saveCraft(courseId, lessonId, build);
      return json(res, 200, { craft: publicCraft(build, { lessonId, lessonTitle: lesson.title }), progress: null });
    }

    if (req.method === "POST" && /^\/api\/course\/[^/]+\/craft\/[^/]+$/.test(path)) {
      const parts = path.split("/");
      const courseId = decodeURIComponent(parts[3]);
      const lessonId = decodeURIComponent(parts[5]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });

      const cached = cachedCraft(courseId, lessonId);
      if (!cached) return json(res, 404, { error: "这一讲的拼装题还没出好，刷新一下试试。" });

      const body = await readBody(req, 60_000);
      const score = scoreCraft(cached, body);
      const prev = gameFor(course).builds?.[lessonId] ?? null;
      const tries = (prev?.attempts ?? 0) + 1;
      const stars = score.ok ? (tries <= 1 ? 3 : tries <= 3 ? 2 : 1) : 0;
      const xp = score.ok ? 20 + (stars === 3 ? 10 : 0) : 0;
      const out = recordCraft(courseId, lessonId, { solved: score.ok, stars, xp });

      return json(res, 200, {
        ok: score.ok,
        hits: score.hits,
        total: score.total,
        stars: out?.build?.stars ?? 0,
        xp: out?.firstSolve ? xp : 0,
        firstSolve: Boolean(out?.firstSolve),
        player: out?.player,
        why: score.ok ? cached.why : "",
      });
    }

    /* -------------------------------- tutor --------------------------------- */

    /* One endpoint for every screen where someone is stuck mid-task: a fight, a
       broken terminal, a quick check. The caller sends whatever it is looking at
       as plain text (`focus`); the server picks the nearest generated board to
       ground the answer, and never hands over an answer key. */
    if (req.method === "POST" && /^\/api\/course\/[^/]+\/tutor$/.test(path)) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      if (!course) return json(res, 404, { error: "没有这门课" });

      const body = await readBody(req, 300_000);
      /* A re-pitch is triggered by a button, not by typing: there is no
         question, just "that page did not land". Give it a stand-in question so
         the rest of the pipeline stays one shape. */
      const mode = body.mode === "repitch" ? "repitch" : body.mode === "learn" ? "learn" : "answer";
      const text =
        String(body.question ?? "").trim() ||
        (mode === "repitch" ? "这一页我没听懂，请换一种说法重讲。" : "");
      if (!text) return json(res, 400, { error: "问题不能为空" });

      const lessonId = String(body.lessonId ?? "");
      const unitId = String(body.unitId ?? "");
      const units = course.units ?? [];
      const unit =
        units.find((u) => u.id === unitId) ?? units.find((u) => u.lessons.some((l) => l.id === lessonId)) ?? null;

      /* An ungenerated lesson has no board to quote, so fall back to the last
         board in the same region — close enough to ground the answer instead of
         failing on a technicality. */
      let lesson = lessonId ? course.lessons?.[lessonId] ?? null : null;
      if (!lesson && unit) {
        lesson = [...unit.lessons].reverse().map((l) => course.lessons?.[l.id]).find(Boolean) ?? null;
      }
      if (!lesson) lesson = Object.values(course.lessons ?? {}).pop() ?? null;

      const answer = await tutorReply({
        course,
        unit,
        lesson,
        page: Math.max(0, Number(body.page) || 0),
        focus: String(body.focus ?? "").slice(0, 4000),
        question: text,
        mode,
      });
      return json(res, 200, answer);
    }

    if (req.method === "GET" && path.startsWith("/api/course/")) {
      const courseId = decodeURIComponent(path.split("/")[3]);
      const course = rawCourse(courseId);
      return course ? json(res, 200, courseView(course)) : json(res, 404, { error: "没有这门课" });
    }

    if (path.startsWith("/api/")) return json(res, 404, { error: "接口不存在" });

    if (req.method === "GET" && !(await serveStatic(res, path))) {
      const served = await serveStatic(res, "/");
      if (!served) json(res, 404, { error: "not found" });
    }
  } catch (e) {
    console.error("[500]", req.method, path, e.message);
    json(res, 500, { error: e.userMessage || e.message || "服务器出错了" });
  }
}

export default handler;

/* Bind all interfaces: the published service sits behind a reverse proxy that
   reaches in from another container, so 127.0.0.1 makes it unreachable. Pass
   HOST=127.0.0.1 explicitly if you want a strictly local run.
   On Vercel the platform owns the socket — we only export the handler. */
const HOST = process.env.HOST || "0.0.0.0";

if (!process.env.VERCEL) {
  const server = createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`[store ] ${storeInfo().engine} · ${storeInfo().path}${storeInfo().writable ? "" : " (read-only)"}`);
    console.log(`[seed  ] ${seeded} demo course(s), ${countAll().courses} total`);
    console.log(`[model ] ${providerLabel()}`);
    console.log(`[ready ] http://localhost:${PORT} (bind ${HOST})`);
  });
}
