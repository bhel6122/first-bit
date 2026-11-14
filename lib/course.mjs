/* Course shapes.

   Two documents matter: the blueprint (units → lessons → project) and a lesson
   (whiteboard pages with a spoken script, plus a short quiz). The model is good
   at content and careless about shape, so this file coerces shape and nothing
   else. It is also the gate the server runs after every generation. */

export const SCALES = {
  brief: { label: "精简入门", units: [3, 3], lessons: [5, 7], minutes: 10 },
  standard: { label: "标准学期", units: [4, 4], lessons: [10, 13], minutes: 15 },
  deep: { label: "系统深入", units: [5, 5], lessons: [14, 17], minutes: 18 },
};

export const LEVELS = {
  beginner: "完全零基础，需要从最具体的东西讲起",
  some: "知道一些名词，但一用就卡住",
  guided: "能跟着教程做，独立做就不知道从哪下手",
  independent: "能独立做小项目，想把基础补扎实",
  gap: "整体还行，但有几个知识点一直没真正搞懂",
};

export const FOCUS = {
  concept: "把概念和原理讲透，多问为什么",
  practice: "多动手，边写边讲，以做代学",
  exam: "围绕考试范围，讲题型、考点与易错点",
  project: "以完成一个真实作品为主线",
};

export const GOALS = {
  build: "学完能独立做出东西",
  system: "建立完整的知识体系",
  exam: "通过考试 / 拿到分数",
  work: "解决工作或项目里的具体问题",
};

export const MODES = {
  self: "自由学",
  school: "跟课学",
};

const str = (v, max = 400) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clip = (v, max) => String(v ?? "").trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v : []);

const BLOCK_TYPES = new Set(["text", "bullets", "formula", "code", "compare", "flow", "callout", "table"]);

/* ------------------------------- blocks ------------------------------- */

function normalizeBlock(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type ?? raw.t ?? "").trim().toLowerCase();

  if (type === "text" || type === "quote" || type === "note") {
    const text = clip(raw.text ?? raw.content ?? raw.value, 600);
    return text ? { type: "text", text } : null;
  }
  if (type === "bullets" || type === "list") {
    const items = list(raw.items ?? raw.bullets).map((x) => clip(x, 220)).filter(Boolean).slice(0, 5);
    return items.length ? { type: "bullets", items } : null;
  }
  if (type === "formula" || type === "math") {
    const text = clip(raw.text ?? raw.formula ?? raw.value, 300);
    return text ? { type: "formula", text, caption: clip(raw.caption, 120) } : null;
  }
  if (type === "code") {
    const code = String(raw.code ?? raw.text ?? "").replace(/\t/g, "  ").slice(0, 1400).trim();
    return code ? { type: "code", code, lang: clip(raw.lang, 20) } : null;
  }
  if (type === "compare" || type === "contrast") {
    const half = (h, fallback) => {
      const obj = h && typeof h === "object" ? h : { h: fallback, items: [] };
      return {
        h: clip(obj.h ?? obj.title ?? fallback, 60),
        items: list(obj.items ?? obj.bullets).map((x) => clip(x, 160)).filter(Boolean).slice(0, 4),
      };
    };
    return { type: "compare", left: half(raw.left, "一边"), right: half(raw.right, "另一边") };
  }
  if (type === "flow" || type === "steps") {
    const items = list(raw.items ?? raw.steps).map((x) => clip(typeof x === "string" ? x : x?.text, 90)).filter(Boolean).slice(0, 5);
    return items.length >= 2 ? { type: "flow", items } : null;
  }
  if (type === "callout" || type === "tip") {
    const text = clip(raw.text ?? raw.content, 400);
    const tone = ["key", "warn", "note"].includes(raw.tone) ? raw.tone : "key";
    return text ? { type: "callout", tone, text } : null;
  }
  if (type === "table") {
    const head = list(raw.head ?? raw.header).map((x) => clip(x, 40)).filter(Boolean).slice(0, 3);
    const rows = list(raw.rows).slice(0, 4).map((r) => list(r).map((x) => clip(x, 80)).slice(0, head.length || 3));
    return head.length && rows.length ? { type: "table", head, rows } : null;
  }
  // Unknown type with text is still useful; drop the rest rather than lose the idea.
  const fallback = clip(raw.text ?? raw.content, 400);
  return fallback ? { type: "text", text: fallback } : null;
}

export function boardText(page) {
  const parts = [page.title];
  for (const b of page.blocks ?? []) {
    if (b.type === "text") parts.push(b.text);
    else if (b.type === "bullets") parts.push(b.items.join("；"));
    else if (b.type === "formula") parts.push(`${b.text}${b.caption ? `（${b.caption}）` : ""}`);
    else if (b.type === "code") parts.push(b.code);
    else if (b.type === "compare") parts.push(`${b.left.h}：${b.left.items.join("、")} / ${b.right.h}：${b.right.items.join("、")}`);
    else if (b.type === "flow") parts.push(b.items.join(" → "));
    else if (b.type === "callout") parts.push(b.text);
    else if (b.type === "table") parts.push([b.head.join(" | "), ...b.rows.map((r) => r.join(" | "))].join(" / "));
  }
  return parts.filter(Boolean).join("。");
}

/* ------------------------------- lessons ------------------------------- */

function normalizePage(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const blocks = list(raw.blocks).map(normalizeBlock).filter(Boolean).slice(0, 6);
  if (!blocks.length) return null;

  const title = clip(raw.title ?? raw.heading, 80) || `第 ${index + 1} 页`;

  let steps = list(raw.steps).map((s) => ({
    say: clip(s?.say ?? s?.text ?? s?.note, 500),
    reveal: Number(s?.reveal ?? s?.show),
  })).filter((s) => s.say);

  // A page with no script is a wall of text. Derive a minimal script from the
  // board rather than refusing a page the model otherwise got right.
  if (!steps.length) {
    steps = blocks.map((b, i) => ({ say: clip(boardText({ title: i === 0 ? title : "", blocks: [b] }), 220), reveal: i + 1 }));
  }

  let cursor = 1;
  steps = steps.map((s) => {
    const reveal = Number.isInteger(s.reveal) ? Math.max(cursor, Math.min(blocks.length, s.reveal)) : cursor;
    cursor = reveal;
    return { say: s.say, reveal };
  });
  steps[steps.length - 1].reveal = blocks.length;

  return {
    id: clip(raw.id, 20) || `p${index + 1}`,
    title,
    kind: clip(raw.kind, 24) || "concept",
    blocks,
    steps,
  };
}

const VERDICTS = new Set(["correct", "misconception", "distractor"]);

/* The model writes the right answer first far more often than not — on the
   seeded course it was 30 of 36 questions — which turns every quiz into "tap
   the first option". Shuffling has to be *stable*: a review card, a saved
   answer and a re-render all have to agree on which slot holds which option,
   so the order is derived from the question text rather than from Math.random. */
function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleOptions(options, seed = "") {
  const out = options.slice();
  const rnd = mulberry32(hash32(String(seed)));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* Put the correct option at `target`, shuffling the wrong ones around it. Doing
   it per question at random still leaves the distribution lumpy; assigning the
   three questions of a lesson three *different* slots makes it exactly uniform
   over a course without ever varying between two requests. */
export function placeCorrect(options, target, seed = "") {
  const correct = options.find((o) => o.correct);
  if (!correct) return options.slice();
  const rest = shuffleOptions(options.filter((o) => !o.correct), seed);
  const at = Math.max(0, Math.min(rest.length, target));
  rest.splice(at, 0, correct);
  return rest;
}

function normalizeOptions(raw) {
  const options = list(raw).map((o) => {
    const text = clip(o?.text ?? o?.value, 240);
    if (!text) return null;
    const verdict = String(o?.verdict ?? "").toLowerCase();
    const opt = { text };
    if (o?.correct === true || verdict === "correct") opt.correct = true;
    else if (verdict === "misconception" || o?.misconception) opt.distractor = true;
    else opt.distractor = true;
    return opt;
  }).filter(Boolean);

  // Exactly one correct answer. If the model marked none, the first option is the
  // only defensible guess; if it marked several, keep the first and demote the rest.
  const firstCorrect = options.findIndex((o) => o.correct);
  options.forEach((o, i) => {
    if (i === firstCorrect) o.correct = true;
    else delete o.correct;
  });

  while (options.length > 3) {
    const i = options.map((o, k) => (o.distractor ? k : -1)).filter((k) => k >= 0).pop();
    if (i === undefined) break;
    options.splice(i, 1);
  }
  return options;
}

function normalizeQuiz(rawQ, pageCount) {
  const q = {
    q: clip(rawQ?.q ?? rawQ?.question, 400),
    options: normalizeOptions(rawQ?.options),
    explain: clip(rawQ?.explain ?? rawQ?.explanation, 600),
    page: Math.max(1, Math.min(pageCount, Number(rawQ?.page ?? rawQ?.slide) || 1)),
  };
  if (!q.q || q.options.length !== 3) return null;
  return q;
}

/* Exactly one of each slot per lesson: three questions, three positions. */
function slotPlan(seed, n) {
  const base = [0, 1, 2];
  const rnd = mulberry32(hash32(seed));
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return Array.from({ length: n }, (_, i) => base[i % 3]);
}

export function normalizeLesson(raw, fallbackTitle = "本讲") {
  const pages = list(raw?.pages).map(normalizePage).filter(Boolean).slice(0, 8);
  const quiz = list(raw?.quiz)
    .map((q, i) => ({ id: `q${i + 1}`, ...normalizeQuiz(q, pages.length) }))
    .filter(Boolean)
    .slice(0, 3);

  const plan = slotPlan(`${fallbackTitle}|${quiz.map((q) => q.q).join("|")}`, quiz.length);
  quiz.forEach((q, i) => {
    q.options = placeCorrect(q.options, plan[i], q.q);
  });

  return {
    title: clip(raw?.title, 80) || fallbackTitle,
    pages,
    quiz,
    generatedAt: new Date().toISOString(),
  };
}

export function checkLesson(lesson) {
  const errors = [];
  const warnings = [];
  if (!lesson || !Array.isArray(lesson.pages) || lesson.pages.length < 3) errors.push("板书页少于 3 页");
  if (lesson?.pages?.length > 8) warnings.push("板书页超过 8 页，可能讲不完");

  for (const [i, p] of (lesson?.pages ?? []).entries()) {
    if (!p.steps?.length) errors.push(`第 ${i + 1} 页没有讲解词`);
    if (p.steps?.length === 1) warnings.push(`第 ${i + 1} 页只有一段讲解，节奏偏快`);
    if (p.blocks?.length < 2) warnings.push(`第 ${i + 1} 页板书太少`);
  }
  if ((lesson?.quiz?.length ?? 0) < 3) warnings.push("练习题不足 3 道");

  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------- outline ------------------------------- */

const DEFAULT_PROJECT = (unitTitle) => ({
  title: `综合项目：${unitTitle.replace(/^第.+?单元[:：]?\s*/, "")}`,
  brief: "把本单元的知识用在一个真实的小作品里：先写清楚要解决什么问题，再动手做，最后用一段话说明你的取舍。",
  deliverables: ["可运行的成果或可查看的文档", "一页设计说明：做了什么、为什么这样做"],
  rubric: [
    { criterion: "能正确用上本单元的核心方法", weight: 50 },
    { criterion: "说明了取舍与边界", weight: 30 },
    { criterion: "交付物完整、可复现", weight: 20 },
  ],
});

export function normalizeOutline(raw, { topic = "", scale = "standard", mode = "self", keepIds = false } = {}) {
  const unitsRaw = list(raw?.units).slice(0, 6);

  // Editing the blueprint must not renumber what the learner already studied:
  // deleting lesson 2 of unit 1 cannot turn lesson 3 into lesson 2 and hand it
  // lesson 3's pages. So stable ids are kept, and new rows get fresh ones.
  const usedUnits = new Set(unitsRaw.map((u) => u?.id).filter((x) => /^u[\w-]{1,12}$/.test(String(x ?? ""))));
  let unitSeq = 0;
  const nextUnitId = () => {
    while (usedUnits.has(`u${unitSeq + 1}`)) unitSeq++;
    const v = `u${unitSeq + 1}`;
    usedUnits.add(v);
    return v;
  };

  const units = unitsRaw.map((u, ui) => {
    const unitTitle = clip(u?.title, 80) || `第 ${ui + 1} 单元`;
    const uid = keepIds && /^u[\w-]{1,12}$/.test(String(u?.id ?? "")) && unitsRaw.filter((x) => x?.id === u?.id).length === 1
      ? String(u.id)
      : nextUnitId();
    const lessonsRaw = list(u?.lessons).slice(0, 5);
    const usedLessons = new Set(lessonsRaw.map((l) => l?.id).filter((x) => /^u[\w-]{1,20}$/.test(String(x ?? ""))));
    let lessonSeq = 0;
    const lessons = lessonsRaw.map((l, li) => {
      let lid;
      if (keepIds && /^u[\w-]{1,20}$/.test(String(l?.id ?? "")) && !usedLessons.has(`__seen_${l.id}`)) {
        lid = String(l.id);
        usedLessons.add(`__seen_${l.id}`);
      } else {
        while (usedLessons.has(`${uid}l${lessonSeq + 1}`)) lessonSeq++;
        lid = `${uid}l${lessonSeq + 1}`;
        usedLessons.add(lid);
      }
      return {
        id: lid,
        title: clip(typeof l === "string" ? l : l?.title, 90) || `第 ${li + 1} 讲`,
        summary: clip(l?.summary ?? l?.goal, 160),
        // Prerequisite edge (borrowed from prerequisite-graph learning tools):
        // which earlier lesson this one builds on. Only meaningful if the model
        // or the learner fills it; validation happens in checkOutline.
        prereq: clip(typeof l === "object" ? l?.prereq ?? l?.buildsOn : "", 90),
        minutes: Math.max(6, Math.min(30, Number(l?.minutes) || SCALES[scale]?.minutes || 12)),
        kind: "lesson",
      };
    });

    const p = u?.project;
    const project = {
      title: clip(p?.title, 90) || DEFAULT_PROJECT(unitTitle).title,
      brief: clip(p?.brief, 500) || DEFAULT_PROJECT(unitTitle).brief,
      deliverables: list(p?.deliverables).map((x) => clip(x, 160)).filter(Boolean).slice(0, 4),
      rubric: list(p?.rubric).map((r) => ({
        criterion: clip(r?.criterion ?? r, 120),
        weight: Math.max(5, Math.min(100, Number(r?.weight) || 30)),
      })).filter((r) => r.criterion).slice(0, 4),
    };
    if (!project.deliverables.length) project.deliverables = DEFAULT_PROJECT(unitTitle).deliverables;
    if (!project.rubric.length) project.rubric = DEFAULT_PROJECT(unitTitle).rubric;

    return { id: `u${ui + 1}`, title: unitTitle, goal: clip(u?.goal, 260), lessons, project };
  });

  const total = units.reduce((n, u) => n + u.lessons.length, 0);
  return {
    title: clip(raw?.title, 90) || (topic ? `${topic}：系统课程` : "我的专属课程"),
    subtitle: clip(raw?.subtitle, 160) || (topic ? `围绕「${clip(topic, 40)}」从零搭起来` : ""),
    promise: clip(raw?.promise, 120) || `${units.length} 个单元 · ${total} 讲`,
    audience: clip(raw?.audience, 200),
    mode,
    scale,
    units,
  };
}

export function checkOutline(outline, { scale = "standard", strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const spec = SCALES[scale] ?? SCALES.standard;
  const units = outline?.units ?? [];
  const total = units.reduce((n, u) => n + u.lessons.length, 0);

  if (units.length < 2) errors.push("至少需要 2 个单元");
  if (units.length > 6) errors.push("单元太多（最多 6 个）");
  if (total < 3) errors.push("整门课至少需要 3 讲");
  // A generated outline must hit the requested scale — the model was told the
  // exact numbers. A learner editing their own outline is allowed to trim.
  const short = `课程只有 ${total} 讲，「${spec.label}」要求 ${spec.lessons[0]}-${spec.lessons[1]} 讲`;
  if (total < spec.lessons[0]) {
    if (strict) errors.push(short);
    else warnings.push(`${short}（不影响保存）`);
  }
  if (total > spec.lessons[1]) warnings.push(`课程有 ${total} 讲，比「${spec.label}」多`);

  // Titles like "缓存机制概述" or "性能优化最佳实践" are placeholders: they do
  // not tell the learner what question the lesson answers. Two of them is a
  // pattern, and a generation with a pattern gets rewritten.
  /* English courses need their own banned list — the Chinese one simply never
     matches, which would let "Introduction to X" through unchallenged. */
  const GENERIC =
    /(概述|简介|介绍|导论|入门|基础|进阶|详解|最佳实践|案例分析|实战|综合|总结|原理|机制|方法|技巧|什么是|有哪些|的种类|的关键|的挑战|的问题|探讨|初探|解析|实践)|\b(overview|introduction|intro|basics|fundamentals|advanced|deep dive|best practices|case study|in practice|principles|mechanisms?|concepts|getting started|a guide to)\b/i;
  const genericLessons = [];

  const titles = new Set();
  // Prerequisite chain, in reading order: each lesson's prereq must name a
  // lesson that comes BEFORE it. A forward or dangling edge means the model
  // invented a dependency the path cannot honor — strict mode rewrites it.
  const seenTitles = [];
  let dangling = 0;
  let missing = 0;
  for (const u of units) {
    if (!u.title || u.title.length < 2) errors.push("有单元没有标题");
    if (!u.lessons.length) errors.push(`「${u.title}」没有讲次`);
    if (u.lessons.length > 5) warnings.push(`「${u.title}」讲次偏多`);
    for (const l of u.lessons) {
      const key = l.title.trim();
      if (key.length < 2) errors.push("有讲次没有标题");
      if (titles.has(key)) warnings.push(`讲次标题重复：「${key}」`);
      titles.add(key);

      const prereq = String(l.prereq ?? "").trim();
      if (prereq) {
        // The model sometimes shortens titles; accept an exact match or a
        // prefix of at least 6 characters, otherwise the edge is dangling.
        const hit = seenTitles.some((t) => t === prereq || (prereq.length >= 6 && (t.startsWith(prereq) || prereq.startsWith(t))));
        if (!hit) dangling++;
      } else if (seenTitles.length) {
        missing++;
      }
      seenTitles.push(key);
      if (GENERIC.test(key)) genericLessons.push(key);
    }
    if (GENERIC.test(u.title)) warnings.push(`单元标题偏泛：「${u.title}」`);
  }

  if (dangling) {
    const msg = `有 ${dangling} 讲的前置（prereq）指向不存在的讲次，路径走不通`;
    if (strict && dangling > 1) errors.push(msg);
    else warnings.push(`${msg}（已忽略）`);
  }
  if (strict && missing > Math.ceil(total * 0.5)) {
    errors.push(`全课 ${total} 讲里 ${missing} 讲没有标前置讲次。除了第一讲，每一讲都要写它建立在哪一讲之上。`);
  }

  if (genericLessons.length > 2) {
    errors.push(`有 ${genericLessons.length} 个讲次标题太泛（${genericLessons.slice(0, 3).join("、")}）。每个标题必须说清这一讲解决的具体问题。`);
  } else if (genericLessons.length) {
    warnings.push(`讲次标题偏泛：${genericLessons.join("、")}`);
  }

  return { ok: errors.length === 0, errors, warnings, stats: courseStats(outline) };
}

export function courseStats(outline) {
  const units = outline?.units ?? [];
  const lessons = units.reduce((n, u) => n + u.lessons.length, 0);
  const minutes = units.reduce((n, u) => n + u.lessons.reduce((m, l) => m + (l.minutes || 12), 0), 0);
  return { units: units.length, lessons, minutes, projects: units.length };
}

/** Leaderboard-free learner view: no answers, no explanations until answered. */
export function quizForLearner(lesson) {
  return (lesson?.quiz ?? []).map((q) => ({
    id: q.id,
    q: q.q,
    options: q.options.map((o) => o.text),
  }));
}

export function lessonMeta(course, lessonId) {
  for (const u of course.units ?? []) {
    const l = u.lessons.find((x) => x.id === lessonId);
    if (l) return { unit: u, lesson: l };
  }
  return null;
}

export function neighbors(course, lessonId) {
  const flat = (course.units ?? []).flatMap((u) => u.lessons.map((l) => ({ unit: u, lesson: l })));
  const i = flat.findIndex((x) => x.lesson.id === lessonId);
  return { prev: i > 0 ? flat[i - 1].lesson : null, next: i >= 0 && i < flat.length - 1 ? flat[i + 1].lesson : null, index: i, total: flat.length };
}
