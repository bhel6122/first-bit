/* Bug puzzles: one broken line, three test cases, and a gate that refuses to
   ship a puzzle unless both halves of the claim are true.

   A bug puzzle is only honest if (a) the broken code really fails a test and
   (b) replacing exactly one line really makes every test pass. The model gets
   both wrong often enough that this file runs the code before anyone sees it,
   and degrades to a "which line is wrong" question when it cannot be saved. */

import vm from "node:vm";
import { chatJSON } from "./llm.mjs";

const TIMEOUT = 800;

/* -------------------------------- sandbox -------------------------------- */

function runInSandbox(code, expr) {
  const ctx = vm.createContext(Object.create(null));
  const opts = { timeout: TIMEOUT, codeGeneration: { strings: false, wasm: false } };
  vm.runInContext(String(code), ctx, opts);
  return vm.runInContext(`(${expr})`, ctx, opts);
}

const same = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

function runAll(code, tests) {
  return tests.map((t) => {
    try {
      return { value: runInSandbox(code, t.call) };
    } catch (e) {
      return { error: String(e?.message ?? e).slice(0, 140) };
    }
  });
}

function replaceLine(code, lineNo, fix) {
  const lines = String(code ?? "").split("\n");
  const i = Number(lineNo) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= lines.length) return null;
  const original = lines[i];
  const indent = (original.match(/^\s*/) ?? [""])[0];
  const replacement = /^\s/.test(fix) ? fix : indent + String(fix).trim();
  if (!replacement.trim() || replacement === original) return null;
  lines[i] = replacement;
  return lines.join("\n");
}

/* ------------------------------- validation ------------------------------- */

export function validateBug(bug) {
  const tests = (Array.isArray(bug?.tests) ? bug.tests : [])
    .filter((t) => t && typeof t.call === "string")
    .slice(0, 4);
  if (!bug?.code || !tests.length || !bug.fix || !bug.brokenLine) {
    return { ok: false, reason: "缺字段" };
  }

  const broken = runAll(bug.code, tests);
  const brokeCount = broken.filter((r, i) => r.error || !same(r.value, tests[i].value)).length;
  if (brokeCount === 0) return { ok: false, reason: "坏代码把所有用例都跑过了，这个 bug 不成立" };

  // Models count lines badly often enough that the reported index is treated as
  // a hint: try it, then its neighbours, and keep whichever line really fixes it.
  const reported = Number(bug.brokenLine);
  const total = bug.code.split("\n").length;
  const candidates = [0, 1, -1, 2, -2, 3, -3]
    .map((d) => reported + d)
    .filter((n, i, arr) => n >= 1 && n <= total && arr.indexOf(n) === i);

  let lastReason = "改完仍然有用法不通过";
  for (const line of candidates) {
    const fixed = replaceLine(bug.code, line, bug.fix);
    if (!fixed) continue;
    const after = runAll(fixed, tests);
    const failed = after.filter((r, i) => r.error || !same(r.value, tests[i].value));
    if (!failed.length) return { ok: true, brokenLine: line, brokenCount: brokeCount };
    lastReason = `改完还有 ${failed.length} 条用例不过（${failed[0].error ?? "结果不对"}）`;
  }

  return { ok: false, reason: lastReason };
}

/* --------------------------------- prompt -------------------------------- */

const SCHEMA = `{
  "scene": "一句场景，说明这段代码在什么页面/接口里坏了",
  "fnName": "函数名",
  "code": "完整可运行的函数源码，5-12 行",
  "brokenLine": 4,
  "fix": "修复后的整行，含缩进",
  "tests": [
    { "call": "fnName(参数)", "value": 期望返回值 }
  ],
  "hint": "一句提示，指出方向但不给答案",
  "why": "一句话解释这个 bug 为什么会发生"
}`;

const RULES = `出题规则（系统会用 node 真的跑一遍，不成立就重来）：
1. 代码是一个纯函数，5-12 行，不涉及文件、网络、随机数、时间、DOM。
2. 只埋 1 个 bug，而且必须是这一讲正在讲的那类错误。常用类型：赋值写成比较（= 与 ===）、循环边界差一、数组方法返回值用错（map 以为是原地修改、filter 忘了赋值）、字符串与数字比较、默认参数用了可变对象、闭包变量共享。
3. 给 3 条测试用例，其中至少 1 条能暴露这个 bug；用例的参数和期望值必须是 JSON 能表达的字面量，不能有函数或 Date。
4. "brokenLine" 是坏行从 1 开始的行号；"fix" 是替换后的完整一行（写成同样缩进）。
5. 坏代码必须真的跑挂至少一条用例，改完必须全过——这是硬性要求。
6. 提示要指向机制（例如"想想这个判断到底在赋值还是比较"），不要直接写出正确代码。
7. 全部用简体中文描述，代码内的标识符用英文。`;

const FALLBACK_BUGS = {
  frontend: {
    kind: "code",
    scene: "作品集页面的「已就绪」计数总是把所有条目都算进去",
    fnName: "readyCount",
    code: `function readyCount(items) {
  let n = 0
  for (const it of items) {
    if (it.ready = true) n++
  }
  return n
}`,
    brokenLine: 4,
    fix: "    if (it.ready === true) n++",
    tests: [
      { call: "readyCount([{ ready: true }, { ready: false }, { ready: true }])", value: 2 },
      { call: "readyCount([])", value: 0 },
      { call: "readyCount([{ ready: false }])", value: 0 },
    ],
    hint: "这个判断每次都在改写 it.ready，而不是在比较——一个等号两个等号差很多",
    why: "赋值表达式的值恒为 true，所以每一项都会被算进去",
  },
  backend: {
    kind: "code",
    scene: "购物车接口算总价时偶尔报错，且总是多算一件",
    fnName: "total",
    code: `function total(items) {
  let sum = 0
  for (let i = 0; i <= items.length; i++) {
    sum += items[i].price
  }
  return sum
}`,
    brokenLine: 3,
    fix: "  for (let i = 0; i < items.length; i++) {",
    tests: [
      { call: "total([{ price: 3 }, { price: 5 }])", value: 8 },
      { call: "total([])", value: 0 },
      { call: "total([{ price: 10 }])", value: 10 },
    ],
    hint: "循环条件里的等号让下标多走了一步，最后一步读到的是 undefined",
    why: "i <= length 会访问数组末尾之外的元素",
  },
  ui: {
    kind: "pick",
    scene: "设计稿走查：卡片内边距不符合 8px 栅格",
    question: "一个卡片左右内边距标了 14px，上下 16px。按 8px 栅格规范，最应该改成哪一组？",
    options: ["左右 16px，上下 16px", "左右 12px，上下 12px", "保持 14px，只改上下", "左右 8px，上下 16px"],
    answer: 0,
    why: "8px 栅格下所有间距取 8 的倍数，14px 不在栅格上，16px 是最近的合规值",
    hint: "先看规范的基本单位是多少，再看哪个数离它最近",
  },
};

/* --------------------------------- prompt -------------------------------- */

export async function generateBug({ track = "frontend", unitTitle = "", lessonTitle = "", courseTitle = "" } = {}) {
  if (track === "ui") return { ...FALLBACK_BUGS.ui, source: "canned" };

  const system =
    "你在给一个编程学习平台出「修 Bug」题。你写的代码会被 node 真的执行，坏代码必须跑挂测试，修复后必须全过。你只输出 JSON。";

  const user = `课程：《${courseTitle || "编程入门"}》· 单元《${unitTitle || "基础"}》· 刚学完《${lessonTitle || "基本写法"}》
方向：${track === "backend" ? "后端" : "前端"}

请出一道修 Bug 题。

${RULES}

只返回这个 JSON：
${SCHEMA}`;

  let complaint = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chatJSON(system, complaint ? `${user}\n\n上一次的题有问题：${complaint}\n请重出一道，确保改完能全部通过。` : user, {
        temperature: attempt === 0 ? 0.5 : 0.35,
        maxTokens: 1400,
      });
      const bug = normalizeBug(raw);
      const check = validateBug(bug);
      if (check.ok) {
        // The validator may have moved the line; the UI highlights what it proved.
        return { ...bug, brokenLine: check.brokenLine, kind: "code", brokenCount: check.brokenCount, source: "model" };
      }
      complaint = check.reason;
      if (process.env.BUG_DEBUG) {
        console.log(`[bug ] ${track} attempt ${attempt + 1}: ${check.reason}`);
        console.log(bug.code);
        console.log(`line ${bug.brokenLine} -> ${bug.fix}`);
        console.log(JSON.stringify(bug.tests));
      }
      // A puzzle whose tests do not hold cannot be judged, so it never ships:
      // after two attempts the canned, pre-verified puzzle takes over.
    } catch (e) {
      complaint = String(e?.message ?? e);
      if (attempt === 1) break;
    }
  }

  const canned = FALLBACK_BUGS[track] ?? FALLBACK_BUGS.frontend;
  return { ...canned, source: "fallback" };
}

function normalizeBug(raw = {}) {
  const tests = (Array.isArray(raw.tests) ? raw.tests : [])
    .map((t) => ({
      call: String(t?.call ?? t?.input ?? "").trim(),
      value: t?.value ?? t?.expect ?? t?.expected,
    }))
    .filter((t) => t.call && t.value !== undefined)
    .slice(0, 4);

  return {
    scene: String(raw.scene ?? "一段代码出了问题").slice(0, 120),
    fnName: String(raw.fnName ?? "").slice(0, 40),
    code: String(raw.code ?? "").replace(/\t/g, "  ").slice(0, 1200).trim(),
    brokenLine: Number(raw.brokenLine ?? raw.line ?? 0),
    fix: String(raw.fix ?? "").slice(0, 200),
    tests,
    hint: String(raw.hint ?? "").slice(0, 160),
    why: String(raw.why ?? "").slice(0, 200),
  };
}

