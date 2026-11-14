/* Storage: one JSON file, atomically rewritten, with a read-only fallback.

   The whole product is personal, so there is no account table: a single learner
   called "me" owns the courses on this machine. What is stored is the blueprint,
   generated lessons (lazily), page views, quiz answers, project ticks and notes. */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { kvGet, kvSet, kvReady, kvPrefix } from "./kv.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/* Where the workspace lives.

   1. A Redis REST endpoint (Upstash / Vercel KV) when one is configured — the
      serverless case. One key holds the whole JSON, pulled when an instance
      starts or its copy goes stale, pushed after every change.
   2. Otherwise a single JSON file. Locally that is `data/store.json`; on a
      serverless host without Redis it degrades to /tmp, which is per-instance
      and wiped on cold start, so courses then only live as long as the
      instance (the app still boots and the sample courses still show). */
const FILE = process.env.STORE_PATH
  || (process.env.VERCEL ? "/tmp/first-bit-store.json" : join(ROOT, "data", "store.json"));
const DEMO_FILE = join(ROOT, "content", "demo-course.json");

const STORE_KEY = process.env.STORE_KEY || `${kvPrefix}:store`;
/* How long an instance may trust its in-memory copy before re-reading Redis.
   Small enough that two warm instances cannot drift for a whole session, large
   enough that a page view does not cost a read. */
const STALE_MS = Number(process.env.STORE_STALE_MS || 700);

const empty = () => ({
  users: [], courses: [], views: [], answers: [], projects: [], notes: {}, reviews: [], seq: 0,
  /* One player per account, keyed by user id: experience, star totals and the
     intake profile follow the person, not the browser. Older single-user files
     carried a bare `player` object; `migratePlayer()` folds it into the map. */
  players: {},
  /* Rate-limit bookkeeping for the public deployment: recent signup stamps per
     IP, and how many generations each user spent today. */
  gates: { signups: [], usage: {} },
});
let state = empty();
let writable = true;

let dirty = false;
let lastPull = 0;

const loadFile = () => {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
  } catch {
    writable = false;
  }
  if (!writable || !existsSync(FILE)) return;
  try {
    state = { ...empty(), ...JSON.parse(readFileSync(FILE, "utf8")) };
  } catch {
    state = empty();
  }
};

function writeFile() {
  try {
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, FILE);
  } catch {
    writable = false;
  }
}

/* Read the shared copy back. Called at boot and again whenever this instance's
   copy might be behind another instance's write. Skipped while a local change
   is still unpushed (that would resurrect the older value) or while a job is
   running here (the job holds references into `state`). */
export async function refreshStore(force = false) {
  if (!kvReady) return false;
  if (!force && (dirty || Date.now() - lastPull < STALE_MS)) return false;
  try {
    const raw = await kvGet(STORE_KEY);
    lastPull = Date.now();
    if (!raw) return false;
    state = { ...empty(), ...JSON.parse(raw) };
    return true;
  } catch (e) {
    console.warn(`[store] remote read failed: ${e.message}`);
    return false;
  }
}

/* Push immediately. The Vercel entry calls this before the response leaves:
   past that point the instance may be frozen, taking an in-flight write with
   it. */
export async function flushNow() {
  if (!dirty) return false;
  if (!kvReady) {
    if (writable) writeFile();
    dirty = false;
    return true;
  }
  const snapshot = JSON.stringify(state);
  dirty = false;
  try {
    await kvSet(STORE_KEY, snapshot);
    lastPull = Date.now();
    return true;
  } catch (e) {
    dirty = true;
    console.warn(`[store] remote write failed: ${e.message}`);
    return false;
  }
}

let timer = null;
function flush() {
  dirty = true;
  if (!kvReady && !writable) return;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (kvReady) void flushNow();
    else writeFile();
  }, kvReady ? 350 : 80);
}

const id = (p) => `${p}_${Date.now().toString(36)}${(state.seq++ % 1296).toString(36)}`;

/* Top-level await: the module never exposes half-loaded state to the handlers
   that import it. On a serverless cold start this is one Redis read (~40ms),
   and on a laptop it is the old synchronous file read. */
if (kvReady) await refreshStore(true);
else loadFile();

/* Courses created before the game layer existed have no `track`, but the intake
   answers they carry do. Backfill on load so old files work without a migration
   script. */
function backfillTrack() {
  let changed = false;
  for (const c of state.courses) {
    if (!c.track && c.answers?.track) {
      c.track = c.answers.track;
      changed = true;
    }
    if (!c.game) {
      c.game = { stars: {}, cleared: [], attempts: {}, terminals: {}, builds: {} };
      changed = true;
    }
    if (!c.game.builds) {
      c.game.builds = {};
      changed = true;
    }
  }
  if (changed) flush();
}
backfillTrack();

/* -------------------------------- seeding -------------------------------- */

export function seedDemo() {
  if (!existsSync(DEMO_FILE)) return 0;
  try {
    const raw = JSON.parse(readFileSync(DEMO_FILE, "utf8"));
    const course = raw.course ?? raw;
    if (!course?.id) return 0;
    const at = state.courses.findIndex((c) => c.id === course.id);
    if (at >= 0) return 0;
    state.courses.push({ ...course, demo: true });
    flush();
    return 1;
  } catch (e) {
    console.warn(`[seed ] demo course not loaded: ${e.message}`);
    return 0;
  }
}

/* -------------------------------- courses -------------------------------- */

export const rawCourse = (courseId) => state.courses.find((c) => c.id === courseId) ?? null;

/* Ownership check for every route that takes a course id. The sample course has
   no owner and is readable by anyone; anything created by a user belongs to
   exactly one account. */
export const ownedCourse = (courseId, owner) => {
  const course = rawCourse(courseId);
  if (!course) return null;
  if (course.owner == null) return course;
  return course.owner === owner ? course : null;
};

function courseCard(course, learner) {
  const p = progressFor(course, learner);
  return {
    id: course.id,
    title: course.title,
    subtitle: course.subtitle,
    promise: course.promise,
    mode: course.mode,
    track: course.track ?? null,
    confirmed: Boolean(course.confirmed),
    demo: Boolean(course.demo),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    stats: p.stats,
    progress: p.percent,
    lastLesson: p.lastLesson,
  };
}

export const listCourses = (learner = "me") =>
  state.courses
    .filter((c) => c.owner == null || c.owner === learner)
    .map((c) => courseCard(c, learner))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed));

export function createCourse(outline, meta = {}) {
  const course = {
    id: id("c"),
    ...outline,
    /* Who may read and edit this course. `null` means the sample course that
       ships with the repo: visible to everyone, read-only in practice. */
    owner: meta.owner ?? null,
    confirmed: false,
    mode: meta.mode ?? "self",
    /* The course keeps its own content language; the UI language is separate. */
    lang: meta.answers?.lang === "en" ? "en" : "zh",
    track: meta.track ?? null,
    game: { stars: {}, cleared: [], attempts: {}, terminals: {}, builds: {} },
    terminals: {},
    crafts: {},
    answers: meta.answers ?? {},
    materials: (meta.materials ?? []).map((m) => ({ name: m.name, chars: String(m.text ?? "").length })),
    demo: false,
    lessons: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.courses.push(course);
  flush();
  return course;
}

export function saveOutline(courseId, outline) {
  const course = rawCourse(courseId);
  if (!course) return null;

  const keep = new Set(outline.units.flatMap((u) => u.lessons.map((l) => l.id)));
  const lessons = {};
  for (const [lid, data] of Object.entries(course.lessons ?? {})) {
    if (keep.has(lid)) lessons[lid] = data;
  }

  Object.assign(course, outline, {
    lessons,
    confirmed: course.confirmed,
    updatedAt: new Date().toISOString(),
  });
  flush();
  return course;
}

export function confirmCourse(courseId) {
  const course = rawCourse(courseId);
  if (!course) return null;
  course.confirmed = true;
  course.updatedAt = new Date().toISOString();
  flush();
  return course;
}

export function removeCourse(courseId) {
  const before = state.courses.length;
  state.courses = state.courses.filter((c) => c.id !== courseId);
  state.views = state.views.filter((v) => v.courseId !== courseId);
  state.answers = state.answers.filter((a) => a.courseId !== courseId);
  state.projects = state.projects.filter((p) => p.courseId !== courseId);
  state.reviews = state.reviews.filter((r) => r.courseId !== courseId);
  for (const key of Object.keys(state.notes)) {
    if (key.startsWith(`${courseId}:`)) delete state.notes[key];
  }
  flush();
  return before !== state.courses.length;
}

/* -------------------------------- lessons -------------------------------- */

export const getLesson = (course, lessonId) => course?.lessons?.[lessonId] ?? null;

export function setLesson(courseId, lessonId, data) {
  const course = rawCourse(courseId);
  if (!course) return null;
  course.lessons = { ...(course.lessons ?? {}), [lessonId]: data };
  course.updatedAt = new Date().toISOString();
  flush();
  return course.lessons[lessonId];
}

/* ------------------------------- activity ------------------------------- */

const MAX_ROWS = 20000;

export function recordPage({ courseId, lessonId, learner = "me", page, seconds = 0, complete = false }) {
  state.views.push({
    courseId, lessonId, learner, page,
    seconds: Math.max(0, Math.min(3600, Math.round(seconds || 0))),
    complete: Boolean(complete),
    at: Date.now(),
  });
  if (state.views.length > MAX_ROWS) state.views.splice(0, state.views.length - MAX_ROWS);
  flush();
}

export function recordAnswer({ courseId, lessonId, learner = "me", qid, option, correct }) {
  // One row per question per learner keeps the unit score honest after retries.
  state.answers = state.answers.filter(
    (a) => !(a.courseId === courseId && a.lessonId === lessonId && a.learner === learner && a.qid === qid),
  );
  state.answers.push({ courseId, lessonId, learner, qid, option, correct: Boolean(correct), at: Date.now() });

  // Wrong answers become review cards, right answers push the next review
  // further out — a zero-dependency SM-2: 1 → 3 → 7 → 14 → 30 days.
  const at = state.reviews.findIndex(
    (r) => r.courseId === courseId && r.lessonId === lessonId && r.learner === learner && r.qid === qid,
  );
  const day = 86400_000;
  if (correct) {
    if (at >= 0) {
      const card = state.reviews[at];
      card.streak = (card.streak ?? 0) + 1;
      card.interval = Math.min(30, [1, 3, 7, 14, 30][Math.min(card.streak, 4)]);
      card.due = Date.now() + card.interval * day;
      card.correctAt = Date.now();
    }
  } else if (at >= 0) {
    const card = state.reviews[at];
    card.streak = 0;
    card.interval = 1;
    card.due = Date.now() + day;
    card.wrongAt = Date.now();
  } else {
    state.reviews.push({
      courseId, lessonId, learner, qid,
      streak: 0, interval: 1, due: Date.now() + day,
      wrongAt: Date.now(), createdAt: Date.now(),
    });
  }
  flush();
}

/* Questions whose review card is due, with the text the learner needs. */
export function dueReviews(courseId, learner = "me") {
  const course = rawCourse(courseId);
  if (!course) return { due: 0, questions: [] };
  const now = Date.now();
  const questions = [];
  for (const r of state.reviews) {
    if (r.courseId !== courseId || r.learner !== learner || r.due > now) continue;
    const lesson = course.lessons?.[r.lessonId];
    const q = (lesson?.quiz ?? []).find((x) => x.id === r.qid);
    if (!q) continue;
    questions.push({
      lessonId: r.lessonId,
      lessonTitle: lesson.title,
      qid: r.qid,
      q: q.q,
      options: q.options.map((o) => o.text),
      streak: r.streak ?? 0,
      dueIn: Math.max(0, Math.round((r.due - now) / 3600000)),
    });
  }
  return { due: questions.length, questions };
}

export const reviewCount = (courseId, learner = "me") =>
  state.reviews.filter((r) => r.courseId === courseId && r.learner === learner && r.due <= Date.now()).length;

/* Wrong answer rows with the picked option text — input for unit diagnosis. */
export function wrongForUnit(course, unitId, learner = "me") {
  const unit = (course.units ?? []).find((u) => u.id === unitId);
  if (!unit) return [];
  const rows = [];
  for (const a of state.answers) {
    if (a.courseId !== course.id || a.learner !== learner || a.correct) continue;
    const l = unit.lessons.find((x) => x.id === a.lessonId);
    if (!l) continue;
    const data = course.lessons?.[a.lessonId];
    const q = (data?.quiz ?? []).find((x) => x.id === a.qid);
    if (!q) continue;
    rows.push({
      lessonId: a.lessonId,
      lessonTitle: l.title,
      qid: a.qid,
      q: q.q,
      picked: q.options[a.option]?.text ?? String(a.option),
      correctText: q.options.find((o) => o.correct)?.text ?? "",
      explain: q.explain ?? "",
      page: q.page,
    });
  }
  return rows;
}

export const answersFor = (courseId, lessonId, learner = "me") =>
  state.answers.filter((a) => a.courseId === courseId && a.lessonId === lessonId && a.learner === learner);

export function toggleProject({ courseId, unitId, learner = "me", done }) {
  const at = state.projects.findIndex((p) => p.courseId === courseId && p.unitId === unitId && p.learner === learner);
  if (at >= 0) state.projects[at].done = Boolean(done);
  else state.projects.push({ courseId, unitId, learner, done: Boolean(done), at: Date.now() });
  flush();
}

export const projectsDone = (courseId, learner = "me") =>
  new Set(state.projects.filter((p) => p.courseId === courseId && p.learner === learner && p.done).map((p) => p.unitId));

/* --------------------------------- notes --------------------------------- */

export const noteKey = (courseId, lessonId, learner = "me") => `${courseId}:${lessonId}:${learner}`;

export function saveNotes(courseId, lessonId, markdown, learner = "me") {
  state.notes[noteKey(courseId, lessonId, learner)] = { markdown, updatedAt: new Date().toISOString() };
  flush();
  return state.notes[noteKey(courseId, lessonId, learner)];
}

export const getNotes = (courseId, lessonId, learner = "me") =>
  state.notes[noteKey(courseId, lessonId, learner)] ?? null;

/* -------------------------------- progress -------------------------------- */

export function lessonProgress(course, lessonId, learner = "me") {
  const rows = state.views.filter((v) => v.courseId === course.id && v.lessonId === lessonId && v.learner === learner);
  const answers = answersFor(course.id, lessonId, learner);
  const quiz = course.lessons?.[lessonId]?.quiz ?? [];
  const pages = course.lessons?.[lessonId]?.pages?.length ?? 0;
  const seen = new Set(rows.map((r) => r.page).filter((n) => Number.isInteger(n)));
  return {
    pages,
    seen: seen.size,
    furthest: rows.length ? Math.max(...rows.map((r) => r.page)) : 0,
    seconds: rows.reduce((n, r) => n + r.seconds, 0),
    complete: rows.some((r) => r.complete),
    answered: answers.length,
    correct: answers.filter((a) => a.correct).length,
    quizTotal: quiz.length,
  };
}

export function progressFor(course, learner = "me") {
  const units = course.units ?? [];
  const lessons = units.flatMap((u) => u.lessons);
  const perLesson = {};
  let done = 0;
  let seconds = 0;
  let quizTotal = 0;
  let quizCorrect = 0;
  let last = null;

  for (const l of lessons) {
    const p = lessonProgress(course, l.id, learner);
    perLesson[l.id] = p;
    if (p.complete) done++;
    seconds += p.seconds;
    quizTotal += p.quizTotal;
    quizCorrect += p.correct;
    if (p.furthest > 0 || p.complete) last = l.id;
  }

  const generated = lessons.filter((l) => Boolean(course.lessons?.[l.id])).length;
  const percent = lessons.length ? Math.round((done / lessons.length) * 100) : 0;

  return {
    perLesson,
    lastLesson: last ?? lessons[0]?.id ?? null,
    percent,
    stats: {
      units: units.length,
      lessons: lessons.length,
      minutes: lessons.reduce((n, l) => n + (l.minutes || 12), 0),
      generated,
      done,
      seconds,
      quizTotal,
      quizCorrect,
      projects: units.length,
      projectsDone: projectsDone(course.id, learner).size,
    },
  };
}

/** Questions for a unit test, gathered from the lessons the learner generated. */
export function unitQuiz(course, unitId, learner = "me") {
  const unit = (course.units ?? []).find((u) => u.id === unitId);
  if (!unit) return null;
  const questions = [];
  for (const l of unit.lessons) {
    const data = course.lessons?.[l.id];
    if (!data) continue;
    for (const q of data.quiz ?? []) {
      questions.push({
        lessonId: l.id,
        lessonTitle: l.title,
        qid: q.id,
        q: q.q,
        options: q.options.map((o) => o.text),
      });
    }
  }
  const answered = state.answers.filter(
    (a) => a.courseId === course.id && a.learner === learner && unit.lessons.some((l) => l.id === a.lessonId),
  );
  return {
    unit: { id: unit.id, title: unit.title },
    questions,
    answered: answered.length,
    correct: answered.filter((a) => a.correct).length,
  };
}

export function activitySummary(course, learner = "me") {
  const views = state.views.filter((v) => v.courseId === course.id && v.learner === learner);
  return {
    views: views.length,
    seconds: views.reduce((n, v) => n + v.seconds, 0),
    answers: state.answers.filter((a) => a.courseId === course.id && a.learner === learner).length,
  };
}

export const storeInfo = () => (kvReady
  ? { path: `redis:${STORE_KEY}`, writable: true, engine: "redis" }
  : { path: FILE, writable, engine: "json" });
export const countAll = () => ({ courses: state.courses.length, views: state.views.length, answers: state.answers.length });

/* --------------------------------- users --------------------------------- */

/* Accounts live in the same JSON document as everything else: one file, one
   key in Redis, one atomic write. No join, no migration, and the whole
   workspace still restores from a single backup. */

export const userById = (uid) => state.users.find((u) => u.id === uid) ?? null;

export const userByName = (name) =>
  state.users.find((u) => u.nameLower === String(name ?? "").trim().toLowerCase()) ?? null;

export const countUsers = () => state.users.length;

export function addUser({ name, salt, hash, role = "user" }) {
  const now = new Date().toISOString();
  const user = {
    id: id("u"),
    name: String(name).trim(),
    nameLower: String(name).trim().toLowerCase(),
    salt,
    hash,
    role: role === "admin" ? "admin" : "user",
    /* Bumping this invalidates every session cookie already handed out, which
       is the only way to revoke a stateless session. */
    ver: 1,
    createdAt: now,
    lastSeen: now,
  };
  state.users.push(user);
  flush();
  return user;
}

export function touchUser(uid) {
  const u = userById(uid);
  if (!u) return null;
  /* Written at most once an hour: this is a "last seen" hint, not an audit log,
     and every touch would otherwise cost a Redis write. */
  const now = Date.now();
  if (now - Date.parse(u.lastSeen ?? 0) < 3600_000) return u;
  u.lastSeen = new Date(now).toISOString();
  flush();
  return u;
}

export function setPassword(uid, { salt, hash }) {
  const u = userById(uid);
  if (!u) return null;
  Object.assign(u, { salt, hash, ver: (u.ver ?? 1) + 1 });
  flush();
  return u;
}

/* The first account to exist adopts the courses written before accounts did.
   Without this a fresh deploy would leave the owner-less history visible to
   every visitor instead of to the person who made it. */
export function claimOrphans(uid) {
  let claimed = 0;
  for (const c of state.courses) {
    if (c.owner == null && !c.demo) {
      c.owner = uid;
      claimed++;
    }
  }
  if (state.player && !state.players[uid]) {
    state.players[uid] = { ...state.player };
    delete state.player;
    claimed++;
  }
  if (claimed) flush();
  return claimed;
}

/* --------------------------------- admin ---------------------------------- */

/* Who may open the console. The role lives on the account and is read fresh on
   every request, so promoting somebody takes effect on their next click rather
   than on their next login — there is no role claim inside the session cookie.

   The first account to register is the administrator. It is a blunt rule, but
   an empty deployment needs exactly one account that can open the door, and a
   "set ADMIN_EMAIL somewhere" step is one more thing to get wrong at 2am. */
export const isAdmin = (u) => u?.role === "admin";

export const adminCount = () => state.users.filter((u) => u.role === "admin").length;

/* A store that predates roles has accounts but no administrator, which would
   lock everyone out of the console for good. Promote the oldest account on
   load; once any role exists this is a no-op. */
export function ensureAdmin() {
  if (!state.users.length) return 0;
  if (state.users.some((u) => u.role === "admin")) return 0;
  const oldest = [...state.users].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  )[0];
  oldest.role = "admin";
  console.log(`[admin] promoted "${oldest.name}" — first account on record`);
  flush();
  return 1;
}
ensureAdmin();

/* The console needs one row per account, with the numbers an operator actually
   asks about: how much this person made, and how much of today's quota is
   gone. */
export function listUsers() {
  return state.users
    .map((u) => {
      const courses = state.courses.filter((c) => c.owner === u.id);
      const lessons = courses.reduce((n, c) => n + Object.keys(c.lessons ?? {}).length, 0);
      return {
        id: u.id,
        name: u.name,
        role: u.role ?? "user",
        createdAt: u.createdAt ?? null,
        lastSeen: u.lastSeen ?? null,
        courses: courses.length,
        lessons,
        answers: state.answers.filter((a) => a.learner === u.id).length,
        xp: Math.max(0, Math.round(Number(state.players?.[u.id]?.xp) || 0)),
        usedToday: usageOf(u.id).used,
      };
    })
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}

export function renameUser(uid, name) {
  const u = userById(uid);
  if (!u) return null;
  u.name = String(name).trim();
  u.nameLower = u.name.toLowerCase();
  flush();
  return u;
}

export function setRole(uid, role) {
  const u = userById(uid);
  if (!u) return null;
  u.role = role === "admin" ? "admin" : "user";
  flush();
  return u;
}

/* Deleting an account also deletes what it made. Anything else would leave
   courses pointing at an owner id that no longer exists — invisible to every
   shelf, still counted in the admin list, undeletable through the UI. */
export function removeUser(uid) {
  const u = userById(uid);
  if (!u) return false;
  for (const c of [...state.courses]) {
    if (c.owner === uid) removeCourse(c.id);
  }
  state.users = state.users.filter((x) => x.id !== uid);
  state.views = state.views.filter((v) => v.learner !== uid);
  state.answers = state.answers.filter((a) => a.learner !== uid);
  state.projects = state.projects.filter((p) => p.learner !== uid);
  state.reviews = state.reviews.filter((r) => r.learner !== uid);
  for (const key of Object.keys(state.notes)) {
    if (key.endsWith(`:${uid}`)) delete state.notes[key];
  }
  delete state.players?.[uid];
  delete state.gates?.usage?.[uid];
  flush();
  return true;
}

/* ------------------------------ admin: courses ---------------------------- */

export function listAllCourses() {
  return state.courses
    .map((c) => {
      const owner = c.owner ? userById(c.owner) : null;
      const lessons = (c.units ?? []).flatMap((u) => u.lessons ?? []);
      return {
        id: c.id,
        title: c.title,
        subtitle: c.subtitle ?? "",
        owner: c.owner ?? null,
        ownerName: owner?.name ?? (c.demo ? "内置示例" : "无归属"),
        demo: Boolean(c.demo),
        confirmed: Boolean(c.confirmed),
        mode: c.mode ?? "self",
        lang: c.lang ?? "zh",
        track: c.track ?? null,
        units: (c.units ?? []).length,
        lessons: lessons.length,
        generated: Object.keys(c.lessons ?? {}).length,
        createdAt: c.createdAt ?? null,
        updatedAt: c.updatedAt ?? null,
      };
    })
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

/* The console reads a course outline, not the rendered lessons: a generated
   lesson is 6–10k of prose and the list would be unusable. */
export function courseOutlineForAdmin(courseId) {
  const c = rawCourse(courseId);
  if (!c) return null;
  const owner = c.owner ? userById(c.owner) : null;
  return {
    id: c.id,
    title: c.title,
    subtitle: c.subtitle ?? "",
    promise: c.promise ?? "",
    owner: c.owner ?? null,
    ownerName: owner?.name ?? (c.demo ? "内置示例" : "无归属"),
    demo: Boolean(c.demo),
    confirmed: Boolean(c.confirmed),
    mode: c.mode ?? "self",
    lang: c.lang ?? "zh",
    createdAt: c.createdAt ?? null,
    updatedAt: c.updatedAt ?? null,
    units: (c.units ?? []).map((u) => ({
      id: u.id,
      title: u.title,
      lessons: (u.lessons ?? []).map((l) => ({
        id: l.id,
        title: l.title,
        generated: Boolean(c.lessons?.[l.id]),
      })),
    })),
  };
}

const ADMIN_COURSE_FIELDS = new Set(["title", "subtitle", "promise", "owner", "demo"]);

export function updateCourseMeta(courseId, patch = {}) {
  const c = rawCourse(courseId);
  if (!c) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (!ADMIN_COURSE_FIELDS.has(k)) continue;
    if (k === "demo") c.demo = Boolean(v);
    else if (k === "owner") c.owner = v ? String(v) : null;
    else c[k] = String(v ?? "").slice(0, 300);
  }
  c.updatedAt = new Date().toISOString();
  flush();
  return c;
}

/* Making a course for somebody else means copying one that already exists:
   the alternative is waiting a minute for the model, which is exactly the
   thing an operator does not want to do from a console. */
export function cloneCourse(courseId, { owner = null, title = null } = {}) {
  const src = rawCourse(courseId);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  const now = new Date().toISOString();
  Object.assign(copy, {
    id: id("c"),
    title: title ? String(title).slice(0, 120) : `${src.title}（副本）`,
    owner: owner ?? null,
    demo: false,
    game: { stars: {}, cleared: [], attempts: {}, terminals: {}, builds: {} },
    terminals: {},
    crafts: {},
    createdAt: now,
    updatedAt: now,
  });
  /* A copy starts with the lessons but not with anybody's history: stars,
     wrong answers and notes all key off the old course id anyway. */
  state.courses.push(copy);
  flush();
  return copy;
}

/* --------------------------------- gates --------------------------------- */

/* Three counters, all in the same document so they survive a cold start:
   signups per IP in a sliding window, generations per account per day, and the
   site-wide daily total that keeps a shared model key from running away. */

/* Quota days roll over at Beijing midnight, not UTC: a learner who runs out at
   7am local should not get a fresh allowance at 8am because the host is UTC. */
const dayKey = (t = Date.now()) => new Date(t + 8 * 3600_000).toISOString().slice(0, 10);

export function noteSignup(ip, windowMs) {
  const now = Date.now();
  const gates = (state.gates ??= { signups: [], usage: {} });
  gates.signups = (gates.signups ?? []).filter((s) => now - s.at < windowMs);
  gates.signups.push({ ip: String(ip ?? "?"), at: now });
  if (gates.signups.length > 500) gates.signups.splice(0, gates.signups.length - 500);
  flush();
  return gates.signups.filter((s) => s.ip === String(ip ?? "?")).length;
}

/* Both counters roll over at UTC midnight. Checking and spending are two
   separate calls on purpose: a refused request must not consume quota, or a
   learner who retries once burns their own allowance on nothing. */
function gateState() {
  const gates = (state.gates ??= { signups: [], usage: {} });
  const day = dayKey();
  if (gates.day !== day) {
    /* Yesterday's counters are dead weight; drop them on the first request of
       a new day instead of accumulating forever. */
    gates.day = day;
    gates.usage = {};
  }
  return gates;
}

export function usageOf(uid) {
  const g = gateState();
  return {
    used: g.usage[uid] ?? 0,
    total: Object.values(g.usage).reduce((n, v) => n + v, 0),
  };
}

export function spendGeneration(uid) {
  const g = gateState();
  g.usage[uid] = (g.usage[uid] ?? 0) + 1;
  flush();
  return usageOf(uid);
}

/* --------------------------------- player -------------------------------- */

/* Level n costs 100 + 50(n-1); totals are cumulative so xp is never rewritten. */
const needFor = (level) => 100 + 50 * (Math.max(1, level) - 1);
const totalFor = (level) => {
  let t = 0;
  for (let k = 1; k < level; k++) t += needFor(k);
  return t;
};

export const levelFor = (xp) => {
  let level = 1;
  let rest = Math.max(0, Math.round(Number(xp) || 0));
  while (level < 99 && rest >= needFor(level)) {
    rest -= needFor(level);
    level++;
  }
  return level;
};

const TITLES = ["学徒", "工匠", "匠师", "大师", "传奇"];
const titleFor = (level) => TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 5))];

export function totalStars(learner = "me") {
  let n = 0;
  for (const c of state.courses) {
    if (c.owner != null && c.owner !== learner) continue;
    for (const v of Object.values(c.game?.stars ?? {})) n += Number(v) || 0;
  }
  return n;
}

/* The player record is created on first write, so a fresh account costs nothing
   until it earns its first point. */
const playerOf = (learner) => (state.players[learner] ??= {
  xp: 0, profile: null, track: null, mixed: null, createdAt: null, updatedAt: null,
});

export function getPlayer(learner = "me") {
  const p = state.players[learner] ?? {};
  const xp = Math.max(0, Math.round(Number(p.xp) || 0));
  const level = levelFor(xp);
  const base = totalFor(level);
  return {
    xp, level, title: titleFor(level), stars: totalStars(learner),
    into: xp - base, next: needFor(level),
    profile: p.profile ?? null,
    track: p.track ?? null,
    mixed: p.mixed ?? null,
  };
}

export function savePlayerProfile(learner, { scores = null, fit = null, track = null, mixed = null, answers = null } = {}) {
  const now = new Date().toISOString();
  const prev = playerOf(learner);
  state.players[learner] = {
    ...prev,
    xp: Math.max(0, Number(prev.xp) || 0),
    profile: { scores, fit, answers },
    track: track ?? prev.track ?? null,
    mixed: mixed ?? null,
    createdAt: prev.createdAt ?? now,
    updatedAt: now,
  };
  flush();
  return getPlayer(learner);
}

export function addXp(learner, amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  const prev = playerOf(learner);
  state.players[learner] = { ...prev, xp: Math.max(0, Number(prev.xp) || 0) + n };
  flush();
  return getPlayer(learner);
}

/* --------------------------------- game ---------------------------------- */

function gameOf(course) {
  course.game = course.game ?? {};
  course.game.stars = course.game.stars ?? {};
  course.game.cleared = course.game.cleared ?? [];
  course.game.attempts = course.game.attempts ?? {};
  course.game.terminals = course.game.terminals ?? {};
  course.game.builds = course.game.builds ?? {};
  return course.game;
}

export function recordBattle(courseId, lessonId, { stars = 1, xp = 0, cleared = true } = {}) {
  const course = rawCourse(courseId);
  if (!course) return null;
  const g = gameOf(course);
  const prev = Number(g.stars[lessonId]) || 0;
  const best = Math.max(prev, Math.min(3, Math.max(1, Math.round(stars))));
  g.stars[lessonId] = best;
  if (cleared && !g.cleared.includes(lessonId)) g.cleared.push(lessonId);
  g.attempts[lessonId] = (g.attempts[lessonId] ?? 0) + 1;
  course.updatedAt = new Date().toISOString();
  const player = addXp(course.owner ?? "me", xp);
  return { stars: best, firstClear: prev === 0, player, attempts: g.attempts[lessonId] };
}

export function recordTerminal(courseId, unitId, { solved = false, xp = 0, attempts = 0 } = {}) {
  const course = rawCourse(courseId);
  if (!course) return null;
  const g = gameOf(course);
  const prev = g.terminals[unitId] ?? { solved: false, attempts: 0, xp: 0 };
  if (!prev.solved) {
    g.terminals[unitId] = {
      solved: Boolean(solved),
      attempts: Math.max(prev.attempts ?? 0, Number(attempts) || 0),
      xp: Boolean(solved) ? Math.max(prev.xp ?? 0, Math.round(Number(xp) || 0)) : prev.xp ?? 0,
    };
  }
  course.updatedAt = new Date().toISOString();
  const player = prev.solved ? getPlayer(course.owner ?? "me") : addXp(course.owner ?? "me", solved ? xp : 0);
  return { terminal: g.terminals[unitId], player, firstSolve: solved && !prev.solved };
}

export const cachedTerminal = (courseId, unitId) => rawCourse(courseId)?.terminals?.[unitId] ?? null;

export function saveTerminal(courseId, unitId, bug) {
  const course = rawCourse(courseId);
  if (!course) return null;
  course.terminals = { ...(course.terminals ?? {}), [unitId]: bug };
  flush();
  return bug;
}

export const gameFor = (course) =>
  course?.game ?? { stars: {}, cleared: [], attempts: {}, terminals: {}, builds: {} };

/* ----------------------------- assembly puzzles ---------------------------- */

/* The puzzle itself is cached on the course (like terminals) so a region is
   generated once and stays stable across reloads; the score lives under
   game.builds so it never collides with the fight stars on the same lesson id. */

export const cachedCraft = (courseId, lessonId) => rawCourse(courseId)?.crafts?.[lessonId] ?? null;

export function saveCraft(courseId, lessonId, build) {
  const course = rawCourse(courseId);
  if (!course) return null;
  course.crafts = { ...(course.crafts ?? {}), [lessonId]: build };
  flush();
  return build;
}

export function recordCraft(courseId, lessonId, { solved = false, stars = 0, xp = 0 } = {}) {
  const course = rawCourse(courseId);
  if (!course) return null;
  const g = gameOf(course);
  const prev = g.builds[lessonId] ?? { solved: false, stars: 0, attempts: 0, xp: 0 };
  const best = Math.max(Number(prev.stars) || 0, Math.min(3, Math.max(1, Math.round(stars))));
  if (!prev.solved) {
    g.builds[lessonId] = {
      solved: Boolean(solved),
      stars: solved ? best : 0,
      attempts: (prev.attempts ?? 0) + 1,
      xp: solved ? Math.max(prev.xp ?? 0, Math.round(Number(xp) || 0)) : prev.xp ?? 0,
    };
  } else {
    g.builds[lessonId] = { ...prev, attempts: (prev.attempts ?? 0) + 1 };
  }
  course.updatedAt = new Date().toISOString();
  const player = prev.solved ? getPlayer(course.owner ?? "me") : addXp(course.owner ?? "me", solved ? xp : 0);
  return { build: g.builds[lessonId], player, firstSolve: solved && !prev.solved };
}
