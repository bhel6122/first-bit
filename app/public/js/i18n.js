/* UI language, kept deliberately separate from course content.

   Keys are the Chinese strings themselves. A semantic key namespace reads better
   in a dictionary file but makes every call site unreadable — `t("回岛屿")` says
   what it is; `t("course.back")` needs a lookup to know. Missing entries fall back
   to Chinese instead of printing a key, so a gap degrades into mixed language
   rather than into `craft.submit`.

   Course content — boards, questions, narration — is not translated here. It is
   generated in the language the course was created with.

   Two paths reach the same table. Screens written after the switch use `t()` at
   the call site. Screens written before it are translated after they render, by
   walking text nodes — see translateDom(). The dictionary is generated from the
   rendered strings themselves (tools/build-i18n.mjs), so both paths share it. */

import DOM_EN from "./lang/en.js";

const HAND = {
  /* ---- shell ---- */
  我的课程: "My courses",
  闯关地图: "Adventure map",
  跟课学: "Courses",
  课程工坊: "Course studio",
  "演示模式 · 内置课程": "Demo · built-in course",
  首页: "Home",
  课程书架: "Shelf",
  "回到课程书架": "Back to your shelf",
  "← 首页": "← Home",

  /* ---- island course page ---- */
  自由学: "Self-study",
  冒险手帐: "Journal",
  知识大冒险: "THE ADVENTURE",
  打开大地图: "Open map",
  继续上一讲: "Continue",
  "颗星": "stars",
  "第 {n} 区": "Region {n}",
  挑战: "Fight",
  拼装: "Build",
  已拼: "Built",
  未生成: "Not built",
  区域守关者: "Region boss",
  故障终端: "Terminal",
  已修复: "Fixed",
  改大纲: "Edit outline",
  删除: "Delete",
  "/ {n} 讲": "/ {n} lessons",
  "这是示例课程，不需要模型也能玩。": "This is the demo course — it runs without a model.",
  "讲次和地图是同一份进度，在哪边过关都算。": "Lessons and the map share one progress record.",
  "板书已生成，点开继续。": "Board is ready — open to continue.",
  "第一次打开时现场生成板书与讲解。": "The board is generated the first time you open it.",
  看这一讲的板书: "See this lesson's board",
  "把打乱的行排回去、把概念连起来": "Reorder the scrambled lines and wire up the concepts",
  不看板书直接答题: "No board — straight to the questions",

  /* ---- craft ---- */
  排序题: "Ordering",
  接线题: "Matching",
  装配台: "Assembly",
  接线台: "Wiring",
  提交: "Submit",
  再检查一次: "Check again",
  看提示: "Hint",
  收起提示: "Hide hint",
  全部断开: "Clear all",
  "判定中…": "Checking…",
  再试一次: "Try again",
  还对不上: "Not yet",
  全接通了: "All wired",
  能跑了: "It runs",
  回讲次看板书: "Back to the board",
  回岛屿: "Back to island",
  "下一讲：{name}": "Next: {name}",
  "先点左边一项，再点右边。": "Pick a term on the left first.",
  "还有 {n} 项没连上。": "{n} still unconnected.",
  "已连 {n} / {m}": "{n} / {m} wired",
  "{n} 行，拖到你觉得对的顺序": "{n} lines — drag them into order",
  "把行拖到正确位置；也可以先点一行、再点另一行，两行直接对调。":
    "Drag a line where it belongs, or tap one line then another to swap them.",
  "点左边一项，再点右边和它对应的那一项，线就会连上。连错可以再点一次断开。":
    "Tap a term, then tap the explanation that belongs to it. Tap again to undo.",
  "{n} / {m} 对连对了": "{n} / {m} pairs correct",
  "{n} / {m} 个位置对了": "{n} / {m} positions correct",
  "一处都没对，先别急着改，回板书看看这条规则到底在保证什么。":
    "Nothing lined up yet. Go back to the board and ask what this rule is protecting.",
  "只剩一处。把已经确定的部分先固定住，剩下的那一个多半是被它挤掉的。":
    "One left. Lock what you know is right — the last piece is usually what displaced it.",
  "别整段重排，先只动你最没把握的那一处，再提交一次。":
    "Don't reshuffle everything. Move the one you're least sure about, then submit.",
  "这一题没有额外提示，回板书那一页看看。": "No extra hint here — the board has the answer.",
  "进不去": "Can't open this",
  回到课程: "Back to course",

  /* ---- tracks ---- */
  前端: "Frontend",
  后端: "Backend",
  设计: "Design",

  /* ---- island details ---- */
  "删除「{name}」？进度、笔记和已生成的讲次都会一起消失。":
    "Delete “{name}”? Its progress, notes and generated lessons go with it.",

  /* ---- shared bits ---- */
  学徒: "Apprentice",
  闯关: "Adventure",
  战斗: "Battle",
  终端: "Terminal",
  大地图: "Map",
  对: "pairs",
  "行": "lines",
  "对连对了": "pairs correct",
  "个位置对了": "positions correct",
  "★ {n}": "★ {n}",

  /* ---- tutor ---- */
  问导师: "Ask tutor",
  "我是这一关的导师。你把现在的排列发我，我告诉你该先怀疑哪一处、这一关在考什么——但不会替你把顺序排出来。":
    "I'm your tutor for this one. Send me your current arrangement and I'll tell you what this level is testing — but I won't order it for you.",

  /* ---- native dialogs (window.confirm) — never pass through the DOM ----
     These are called with t() at the call site, so the {name} hole is filled
     after the translation is picked. */
  "删除「{name}」？进度、笔记和已生成的讲次都会一并删除。":
    "Delete “{name}”? Progress, notes and generated lessons go with it.",
  "删除「{name}」及其中的讲次？": "Delete “{name}” and the lessons inside it?",
};

/* Hand-written entries win: they were written against the string, whereas the
   generated ones were written against the source fragment the extractor saw. */
const EN = { ...DOM_EN, ...HAND };

/* Strings that a static table cannot hold: the label is assembled at runtime
   around a number ("第 03 区", "12 讲", "3 / 12 讲"). Ordered — first match wins. */
const RULES = [
  [/^第 (\d+) 区$/, "Region $1"],
  [/^第 (\d+) 页$/, "Page $1"],
  [/^(\d+) \/ (\d+) 讲$/, "$1 / $2 lessons"],
  [/^(\d+)\/(\d+) 讲$/, "$1/$2 lessons"],
  [/^(\d+) 讲$/, "$1 lessons"],
  [/^(\d+) 分钟$/, "$1 min"],
  [/^(\d+) 颗星$/, "$1 stars"],
  [/^连击 ×(\d+)$/, "Combo ×$1"],
  [/^已连 (\d+) \/ (\d+)$/, "$1 / $2 wired"],
  [/^(\d+) \/ (\d+) 对连对了$/, "$1 / $2 pairs correct"],
  [/^(\d+) \/ (\d+) 个位置对了$/, "$1 / $2 positions correct"],
  [/^地图进度 (\d+)%$/, "Map progress $1%"],
  [/^(.+?) · (\d+) 个区域 · (\d+) 讲$/, "$1 · $2 regions · $3 lessons"],
  [/^第 (\d+) 区 · 第 (\d+) 讲$/, "Region $1 · Lesson $2"],
  [/^第 (\d+) 区 · 第 (\d+) 讲 · 已通关$/, "Region $1 · Lesson $2 · Cleared"],
  [/^(UNIT \d+) · (.+) · 第 (\d+)\/(\d+) 讲$/, "$1 · $2 · Lesson $3/$4"],
  [/^(\d+) 门 · 接着上次的地方往下学$/, "$1 courses · pick up where you left off"],
  [/^模型 (.+) · 一份草案约 20-40 秒$/, "Model $1 · ~20-40s per draft"],
  [/^自由学 · (\d+)\/(\d+) 讲 · (\d+)%$/, "Self-study · $1/$2 lessons · $3%"],
  [/^跟课学 · (\d+)\/(\d+) 讲 · (\d+)%$/, "Courses · $1/$2 lessons · $3%"],
  [/^自由学 · (\d+) 讲 · 大纲已生成，还没确认$/, "Self-study · $1 lessons · outline drafted, not confirmed"],
  [/^跟课学 · (\d+) 讲 · 大纲已生成，还没确认$/, "Courses · $1 lessons · outline drafted, not confirmed"],
  [/^(UNIT \d+) · (.+) · 第 (\d+) 页$/, "$1 · $2 · Page $3"],
  [/^第 (\d+) 页 · (.+)$/, "Page $1 · $2"],
  [/^第 (\d+) 区 Boss$/, "Region $1 Boss"],
  [/^已通关 (\d+)\s*\/\s*(\d+) · 星 (\d+)$/, "Cleared $1/$2 · $3 stars"],
  /* The role name is one dictionary word inside a composed label, so the
     replacement is a function rather than a template string. */
  [
    /^(界面工匠|机房守夜人|色板旅人) · (.+)$/,
    (m, role, rest) => `${EN[role] ?? role} · ${rest}`,
  ],

  /* ---- sentences assembled from a number or a title ----------------------
     These never reach the dictionary: the rendered text is "第 3 回合 · 剩余
     5 颗心", while the source is a template with ${} holes. Extend this table
     whenever the audit (tools/shots.mjs) reports a formula-shaped leftover. */

  /* battle */
  [/^第 (\d+)\/(\d+) 回合 · 剩余 (\d+) 颗心$/, "Round $1/$2 · $3 hearts left"],
  [/^第 (\d+) \/ (\d+) 回合$/, "Round $1 / $2"],
  [/^题目：(.+)$/, "Question: $1"],
  [/^升级了：LV\.(\d+) → LV\.(\d+)$/, "Level up: LV.$1 → LV.$2"],
  [/^当前 LV\.(\d+) · (\d+) XP$/, "Now LV.$1 · $2 XP"],
  [/^下一回合 →$/, "Next round →"],
  [/^开始挑战 →$/, "Start →"],

  /* classroom */
  [/^看第 (\d+) 页$/, "See page $1"],
  [/^(.+) · 本讲练习$/, "$1 · Practice"],
  [/^下一讲：(.+)$/, "Next: $1"],

  /* bug terminal */
  [/^场景：(.+)$/, "Scenario: $1"],
  [/^问题：(.+)$/, "Task: $1"],
  [
    /^代码 (\d+) 行，第 (.+?) 行写错了，只能改这一行：$/,
    "$1 lines of code — line $2 is wrong, and you may only edit that line:",
  ],
  [/^用例 (\d+) (✓|✗) · (.+)$/, (m, i, s, rest) => `Case ${i} ${s} · ${translateTail(rest)}`],
  [/^用例 (\d+) · (.+)$/, (m, i, rest) => `Case ${i} · ${translateTail(rest)}`],
  [/^期望 (.+?)，实际 (.+)$/, "Expected $1, got $2"],
  [/^已经运行 (\d+) 次。$/, "You have run it $1 times."],
  [/^剩余尝试 (\d+) \/ (\d+)$/, "$1 / $2 attempts left"],
  [/^把第 (\d+) 行改成$/, "Rewrite line $1 as"],
  [/^提示：(.+)$/, "Hint: $1"],
  [/^出错：(.+)$/, "Error: $1"],
  [/^还不对。(.+)$/, (m, rest) => `Not yet. ${translateTail(rest)}`],
  [/^还能试 (\d+) 次。$/, "$1 attempts left."],

  /* map / island */
  [/^第 (\d+) 区 · 故障终端$/, "Region $1 · Bug terminal"],
  [/^故障终端 · 去修第 (\d+) 区的 bug$/, "Bug terminal · fix the bug in region $1"],
  [/^(\d+) 道题$/, "$1 questions"],

  /* bookshelf / course list */
  [/^解析 (.+) 失败$/, "Couldn't read $1"],
  [/^(.+) 已解析：(\d+) 页，约 (\d+)k 字$/, "$1 parsed: $2 pages, ~$3k characters"],
  [/^(.+) 里没有可读文字。$/, "No readable text in $1."],
  [/^(\d+)k 字$/, "$1k characters"],
  [/^(\d+) 字$/, "$1 characters"],

  /* course page */
  [/^前置 (.+) ·$/, "Prereq $1 ·"],
  [/^(.+) · 单元测试$/, "$1 · Unit test"],
  [/^今日复习 · (\d+) 道到期错题$/, "Review · $1 due mistakes"],

  /* misc */
  [/^请求失败（(\d+)）$/, "Request failed ($1)"],
  [
    /^所以你最该先补的是「(.+?)」。$/,
    (m, gap) => `So “${translateTail(gap)}” is the gap to close first.`,
  ],
  [
    /^所以建议先按「(.+?)」这条路走。$/,
    (m, role) => `So start down the “${EN[role] ?? role}” path.`,
  ],
  [
    /^两条路都够格，所以先走「(.+?)」，另一个方向留作副手。$/,
    (m, role) => `Both fit — start with “${EN[role] ?? role}” and keep the other as a side track.`,
  ],
  /* The track name is a dictionary word inside the label. */
  [
    /^方向「(.+?)」 · (.+)$/,
    (m, role, rest) => `Track “${EN[role] ?? role}” · ${rest}`,
  ],
];

/* Nodes whose text is content, not chrome: a course board that happens to
   contain the word 挑战 must keep its own wording. */
const KEEP = "script, style, pre, code, textarea, input, .board-inner, .transcript, .chat, [data-no-i18n]";

let current = localStorage.getItem("ui-lang") === "en" ? "en" : "zh";

export const lang = () => current;

export function setLang(next) {
  current = next === "en" ? "en" : "zh";
  localStorage.setItem("ui-lang", current);
  document.documentElement.lang = current === "en" ? "en" : "zh-CN";
}

/* Collapse whitespace before lookup: templates wrap labels across lines, so the
   rendered text is "评估\n  这一讲" where the dictionary holds "评估 这一讲". */
const keyOf = (s) => s.replace(/\s+/g, " ").trim();

/* One pass over the table, then a recursive guard: a rule that captures a tail
   can hand it back here, so "Case 1 ✗ · 期望 2，实际 3" gets its inner sentence
   translated too instead of leaving half a line in Chinese. */
function translateKey(key) {
  const direct = EN[key];
  if (direct !== undefined && direct !== key) return direct;
  for (const [re, rep] of RULES) {
    if (!re.test(key)) continue;
    const next = key.replace(re, rep);
    if (next !== key) return next;
  }
  return null;
}

/* Exported for the rules that need to translate a captured tail. */
export const translateTail = (s) => translateKey(keyOf(s)) ?? s;

function lookup(raw) {
  const key = keyOf(raw);
  if (!key) return null;
  return translateKey(key);
}

export function t(zh, vars) {
  let s = current === "en" ? EN[zh] ?? zh : zh;
  if (current === "en" && s === zh) {
    const key = keyOf(zh);
    for (const [re, rep] of RULES) if (re.test(key)) s = key.replace(re, rep);
  }
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

/* Keep the surrounding indentation, replace only the words. */
function swap(node) {
  const next = lookup(node.nodeValue);
  if (next === null) return false;
  const text = node.nodeValue;
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  node.nodeValue = lead + next + tail;
  return true;
}

const ATTRS = ["title", "placeholder", "aria-label", "alt"];

function swapAttr(el, name) {
  const v = el.getAttribute(name);
  if (!v) return;
  const next = lookup(v);
  if (next !== null) el.setAttribute(name, next);
}

export function translateDom(root = document.body) {
  if (current !== "en" || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    swap(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (root.closest?.(KEEP)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (n.parentElement?.closest(KEEP)) continue;
    swap(n);
  }

  const labelled = root.querySelectorAll?.(ATTRS.map((a) => `[${a}]`).join(",")) ?? [];
  for (const el of labelled) for (const a of ATTRS) if (el.hasAttribute(a)) swapAttr(el, a);
  if (root.matches?.(ATTRS.map((a) => `[${a}]`).join(","))) for (const a of ATTRS) swapAttr(root, a);
}

/* Panels are repainted long after the route settles — a generated board, a quiz
   verdict, a terminal result. One observer beats threading t() into every one of
   those update paths, and it is idempotent: the translation never contains a
   dictionary key, so a translated node cannot trigger another pass. */
let observer = null;

export function watchDom() {
  if (observer || current !== "en" || !document.body) return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") {
        swap(r.target);
      } else if (r.type === "childList") {
        for (const n of r.addedNodes) if (n.nodeType === 1 || n.nodeType === 3) translateDom(n);
      } else if (r.type === "attributes" && r.attributeName) {
        swapAttr(r.target, r.attributeName);
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/* For elements written straight into a template: <span data-i18n="提交"></span>. */
export function applyDom(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}

/* One switch, rendered into both the editorial topbar and the pixel HUD. */
export function langSwitch() {
  const next = current === "en" ? "中文" : "EN";
  const label = current === "en" ? "Switch to Chinese" : "切换到英文界面";
  return `<button class="lang-switch" data-lang-toggle type="button" title="${label}" aria-label="${label}">${next}</button>`;
}

/* A full reload is the honest implementation here: every screen is rendered from
   a template string on route change, and re-rendering in place would need each
   page to expose a repaint path it does not have. Language is a rare action. */
export function bindLangSwitch() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-lang-toggle]");
    if (!btn) return;
    setLang(current === "en" ? "zh" : "en");
    location.reload();
  });
}

setLang(current);
