/* Assembly puzzles — build the thing instead of picking the answer.

   Two shapes, because two different things are worth testing:
     order — the lines are all there, the sequence is not. Rebuild it.
     match — the pieces are all there, the coupling is not. Wire it up.

   A multiple-choice question can only ask "do you recognise it". These ask "can
   you put it together", which is the thing that actually fails at 2am.

   The answer key never leaves the server. The browser gets shuffled pieces and
   an id; it has to come back and ask whether the arrangement holds. */

import { chatJSON } from "./llm.mjs";

const clip = (v, max = 120) => String(v ?? "").trim().slice(0, max);

const SYSTEM =
  "你把一讲内容变成一道动手题：要么让人把打乱的行排回正确顺序，要么让人把左右两列连起来。" +
  "你只输出 JSON，不解释。";

function userPrompt({ track, courseTitle, unitTitle, lesson, digest, complaint, forceMatch }) {
  const prefer = track === "ui" ? "B" : "A";
  const header = `课程：《${courseTitle}》— 单元《${unitTitle}》
这一讲：《${lesson?.title ?? ""}》
学完应该会：${lesson?.summary ?? ""}

板书要点：
${clip(digest, 1500) || "（这一讲还没有板书，按标题猜内容）"}
`;

  if (forceMatch) {
    return `${header}
请把这一讲变成一道术语连线题：左边是这一讲出现的术语，右边是它在这份板书里的意思。

规则：
- 3-5 个术语，必须是这一讲板书里真实出现过的（选择器、属性名、命令、概念名）。
- 每个解释**必须以这个术语开头**，后面接一句话说清"它是干什么的"。
  例：{"term":"媒体查询","meaning":"媒体查询：按设备特性套用不同样式"}
      {"term":"flex-direction","meaning":"flex-direction：决定主轴方向，row 横排、column 竖排"}
  这是硬要求：解释串里要出现这个术语本身，否则这道题会被判为错位打回。
- 解释总长 8-34 字，说清作用，不要把术语原样重复两遍。
- 每个解释只能对上它自己的术语，不要把"设置圆角"这种会同时适用于两个术语的话写进去。
- 术语之间要真的不同（不要同时给 border-radius 和 圆角 两个同义项）。

只返回这个结构：
{"type":"match","title":"10 字内，动词开头","terms":[{"term":"术语","meaning":"它在这份板书里的意思"},{"term":"术语","meaning":"..."},{"term":"术语","meaning":"..."}],"hint":"一句话提示，不许说答案","why":"两句话：最容易混的是哪两个"}
${complaint ? `\n上一版不合格：${complaint}。请重出。` : ""}`;
  }

  return `${header}
请把这一讲变成一道拼装题，二选一：

A. order 顺序题：给一段正确顺序的代码或标记，4-7 行，打乱后让学习者排回去。
   - 只选顺序真正决定结果的内容：HTML 的嵌套结构、一段 JS 的语句顺序、一组命令或操作的先后。
   - 不要拿一组 CSS 声明来排序。属性之间的先后不影响渲染，那样的题排对了也是假的。
     如果这一讲的核心是 CSS，就改出 match。
   - 每行 6-70 个字符，一行只放一个标签或一条语句，不要空行，不要行号，不要注释行。
   - 打乱后必须明显不成立；每一行都必须参与构建，不能有可有可无的行。
   - 拼起来必须本身合法：HTML 的每个开标签都要有对应的闭标签（写 3 个 <div> 就要写 3 个 </div>），
     JS 必须能通过语法解析。缺一行就是无解的题，会被打回。

B. match 连线题：左右两列各 3-5 项，一一对应。
   - 左右必须属于同一个维度，能形成"这一项决定那一项"的判断。
     好：属性 ↔ 它造成的渲染结果；手段 ↔ 它解决的问题；概念 ↔ 它描述的现象。
     坏：左边讲字体、右边讲颜色——不同维度，只能瞎猜，不许出这种。
   - 出成"术语 ↔ 它在这份板书里的意思"：左边是术语，右边是这个术语的解释（4-24 字）。
   - 每个解释只能对上它自己的术语，不能同时适用于两项。
   - 术语之间要真的不同，不要同时给 border-radius 和 圆角 两个同义项。

优先选 ${prefer === "B" ? "B" : "A"}；如果这一讲确实不适合，换另一种。

只返回下面两种结构之一：
{"type":"order","title":"10 字内，动词开头","lang":"js|css|html|text","lines":["正确顺序的第 1 行","第 2 行"],"hint":"一句话提示，不许说答案","why":"两句话：为什么必须是这个顺序"}
{"type":"match","title":"10 字内，动词开头","terms":[{"term":"术语","meaning":"它在这份板书里的意思"},{"term":"术语","meaning":"..."},{"term":"术语","meaning":"..."}],"hint":"一句话提示","why":"两句话：最容易混的是哪两个"}

连线题里，每个术语只和它自己的解释配成一对，所以左右不会错位。
${complaint ? `\n上一版不合格：${complaint}。请重新出，严格按上面的结构返回。` : ""}`;
}

/* ------------------------------- normalising ------------------------------- */

/* Models like to emit "1. const x = 1;" even when told not to, and to wrap a
   whole function into one line. Both break the puzzle, so both are rejected
   rather than silently repaired — a silently repaired line makes the ordering
   ambiguous, and an ambiguous puzzle is worse than no puzzle. */
function readLines(v) {
  const out = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const s = String(raw ?? "")
      .replace(/^\s*\d+[.)、]\s+/, "")
      .replace(/\t/g, "  ")
      .replace(/^\s+/, "");
    const t = s.replace(/\s+$/, "");
    if (!t.trim()) continue;
    if (t.length > 90) return { error: "有一行太长，说明没有分行" };
    out.push(t);
  }
  return { lines: out };
}

function readItems(v, max = 5) {
  const out = (Array.isArray(v) ? v : [])
    .map((x) => clip(x, 40).replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, max);
  return out;
}

const isPerm = (a, n) => Array.isArray(a) && a.length === n && new Set(a).size === n && a.every((x) => Number.isInteger(x) && x >= 0 && x < n);

/* An unsolvable puzzle is worse than no puzzle. A model will happily hand back a
   set of HTML lines with `</header>` but no `<header>`, and the learner then
   spends ten minutes failing at something no ordering can fix. So the assembled
   result has to pass a structural check before it is ever shown. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function wellFormed(lang, lines) {
  const code = lines.join("\n");

  if (lang === "html") {
    const stack = [];
    for (const m of code.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)) {
      const tag = m[2].toLowerCase();
      if (VOID_TAGS.has(tag) || m[3]) continue;
      if (m[1]) {
        if (stack.pop() !== tag) return false;
      } else {
        stack.push(tag);
      }
    }
    return stack.length === 0;
  }

  if (lang === "js") {
    try {
      new Function(code);
      return true;
    } catch {
      return false;
    }
  }

  if (lang === "css") {
    let depth = 0;
    for (const ch of code) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  return true;
}

function shuffleIdx(n) {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Never hand back the solved order: a learner who gets the right sequence by
   accident learns nothing and feels cheated. */
function scramble(n) {
  if (n < 2) return [...Array(n).keys()];
  for (let k = 0; k < 12; k++) {
    const p = shuffleIdx(n);
    if (p.some((v, i) => v !== i)) return p;
  }
  return [...Array(n).keys()].reverse();
}

/* "媒体查询：按设备特性套用不同样式" -> "按设备特性套用不同样式" */
function stripPrefix(term, meaning) {
  const at = meaning.indexOf(term);
  const rest = at === 0 ? meaning.slice(term.length) : meaning.slice(0, at) + meaning.slice(at + term.length);
  return rest.replace(/^[：:，,、；;\s—–-]+/, "").trim();
}

/* ------------------------------ make puzzles ------------------------------ */

function makeOrder({ title, lang, lines, hint, why }) {
  const n = lines.length;
  const perm = scramble(n); // perm[newPos] = original index
  const shuffled = perm.map((i) => lines[i]);
  const answer = [...Array(n).keys()].map((orig) => perm.indexOf(orig));
  return {
    type: "order",
    title: clip(title, 24) || "把这段排回正确顺序",
    lang: ["js", "css", "html", "text"].includes(lang) ? lang : "text",
    lines: shuffled,
    answer,
    hint: clip(hint, 60),
    why: clip(why, 220),
  };
}

function makeMatch({ title, left, right, pairs, hint, why }) {
  const m = right.length;
  const perm = scramble(m); // perm[newPos] = original right index
  const shuffledRight = perm.map((i) => right[i]);
  const inv = [];
  perm.forEach((orig, nw) => (inv[orig] = nw));
  const remapped = pairs.map((orig) => inv[orig]);
  return {
    type: "match",
    title: clip(title, 24) || "把两边连起来",
    left,
    right: shuffledRight,
    pairs: remapped,
    hint: clip(hint, 60),
    why: clip(why, 220),
  };
}

/* `only` lets the caller demand a shape. The last attempt of a generation run is
   forced to `match` because its validity check is cheap and exact (is it a
   permutation?), while an ordering puzzle can fail structurally in ways that only
   surface once assembled. Better a slightly easier puzzle than an empty level. */
export function normalizeCraft(raw, only = null) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type === "match" ? "match" : raw.type === "order" ? "order" : null;
  if (only && type !== only) return null;

  if (type === "order") {
    const { lines, error } = readLines(raw.lines);
    if (error) return null;
    if (lines.length < 4 || lines.length > 7) return null;
    if (new Set(lines).size !== lines.length) return null;
    const lang = ["js", "css", "html", "text"].includes(raw.lang) ? raw.lang : "text";
    if (!wellFormed(lang, lines)) return null;
    /* A block of CSS declarations in any order renders identically, so "sort these
       properties" has no right answer — it just looks like one. Reject the shape
       even when the model ignores the instruction. */
    if (lang === "css") {
      const declarations = lines.filter((l) => /^[a-zA-Z-]+\s*:\s*\S/.test(l.trim())).length;
      if (declarations >= Math.ceil(lines.length * 0.5)) return null;
    }
    return makeOrder({ title: raw.title, lang, lines, hint: raw.hint, why: raw.why });
  }

  if (type === "match") {
    /* A term and its own explanation. The coupling is carried by the shape of the
       data, not by an index the model has to get right — three attempts at "here
       are two lists, now tell me how they pair up" produced plausible-looking
       pairings that were half wrong (`整数尺寸 ↔ 无圆角`). This way the pairs are
       correct by construction and only the wording can be weak. */
    /* The model will produce a term and an explanation that do not belong
       together — not because it cannot tell them apart, but because it is writing
       two lists in its head and they drift by one position. Requiring the
       explanation to name its own term gives us a machine-checkable anchor: if the
       pair is misaligned the text will not contain the term, and the whole puzzle
       is regenerated. The prefix is stripped before display. */
    const terms = (Array.isArray(raw.terms) ? raw.terms : [])
      .filter((t) => t && typeof t === "object" && t.term && t.meaning)
      .map((t) => {
        const term = clip(t.term, 24).replace(/\s+/g, " ").trim();
        let meaning = clip(t.meaning, 60).replace(/\s+/g, " ").trim();
        return { term, meaning };
      })
      .filter((t) => t.term.length >= 2 && t.meaning.length >= 6)
      .filter((t) => t.meaning.includes(t.term))
      .map((t) => ({ term: t.term, meaning: stripPrefix(t.term, t.meaning) }))
      .filter((t) => t.meaning.length >= 4)
      .slice(0, 5);

    if (terms.length < 3) return null;
    if (new Set(terms.map((t) => t.term)).size !== terms.length) return null;
    if (new Set(terms.map((t) => t.meaning)).size !== terms.length) return null;

    const left = terms.map((t) => t.term);
    const right = terms.map((t) => t.meaning);
    return makeMatch({ title: raw.title, left, right, pairs: left.map((_, i) => i), hint: raw.hint, why: raw.why });
  }

  return null;
}

/* ------------------------------- generation ------------------------------- */

/* Writing a pair and judging a pair are different jobs, and the second one is
   much easier. Left to itself the model produces a term with somebody else's
   explanation (and will happily bolt the term onto the front to satisfy the text
   anchor). So every pairing gets audited item by item before it ships. */
async function auditPairs(terms) {
  if (!terms.length) return false;
  const raw = await chatJSON(
    "你在审校一道连线题：检查每一组里的解释是不是真的在解释那个术语。你只输出 JSON。",
    `逐条判断：下面的解释，是不是在解释它前面那个术语？

${terms.map((t, i) => `${i + 1}. 术语：${t.term}
   解释：${t.meaning}`).join("\n")}

判断标准：解释说得浅、说得不完整都可以算对；但如果它描述的是另一个术语、或者只是把这个术语换个说法，算错。
只返回 {"ok":[true,false,...]}，数组长度必须是 ${terms.length}，顺序和上面一致。`,
    { temperature: 0.1, maxTokens: 400 },
  );
  const ok = Array.isArray(raw?.ok) ? raw.ok : [];
  return ok.length === terms.length && ok.every((v) => v === true);
}

export async function generateCraft({ track = "frontend", courseTitle = "", unitTitle = "", lesson = null, digest = "" }) {
  let complaint = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const forceMatch = attempt === 2;
    const raw = await chatJSON(SYSTEM, userPrompt({ track, courseTitle, unitTitle, lesson, digest, complaint, forceMatch }), {
      temperature: forceMatch ? 0.5 : 0.65,
      maxTokens: 1800,
    });
    const made = normalizeCraft(raw, forceMatch ? "match" : null);
    if (made) {
      if (made.type !== "match") return made;
      const paired = made.left.map((term, i) => ({ term, meaning: made.right[made.pairs[i]] }));
      if (await auditPairs(paired)) return made;
      complaint = "有几条解释在解释别的术语，或者只是把术语换个说法";
      console.warn("[craft] audit rejected pairs for", lessonIdOf(lesson));
      continue;
    }
    complaint = forceMatch
      ? "左右不是一一对应，或者两项以上能连到同一项"
      : "行数必须在 4-7 之间、每行不超过 70 字、配对不是一一对应，或者拼起来不合法（HTML 开闭标签数量不等 / JS 语法错）";
    console.warn("[craft] rejected attempt", attempt + 1, "for", lessonIdOf(lesson), String(raw?.type), String(raw?.lines?.length ?? raw?.left?.length ?? "-"));
  }
  const err = new Error("CRAFT_FAILED");
  err.userMessage = "这一次没能出出可用的拼装题，再试一次就好。";
  throw err;
}

const lessonIdOf = (lesson) => (lesson && (lesson.id || lesson.title)) || "?";

/* -------------------------------- public view ------------------------------ */

/* Strip the key before it crosses the wire. */
export function publicCraft(build, extra = {}) {
  if (!build) return null;
  const base = { type: build.type, title: build.title, hint: build.hint ?? "", why: build.why ?? "" };
  return build.type === "match"
    ? { ...base, left: build.left, right: build.right, total: build.left.length, ...extra }
    : { ...base, lang: build.lang, lines: build.lines, total: build.lines.length, ...extra };
}

/* Score an answer without ever echoing the key. `hits` is deliberately a count
   and not a map: telling someone which rows are already right turns the puzzle
   into a guessing game played one row at a time. */
export function scoreCraft(build, body = {}) {
  if (!build) return { ok: false, hits: 0, total: 0 };

  if (build.type === "match") {
    const total = build.left.length;
    const given = Array.isArray(body.pairs) ? body.pairs : [];
    let hits = 0;
    for (let i = 0; i < total; i++) if (Number(given[i]) === build.pairs[i]) hits++;
    return { ok: hits === total, hits, total };
  }

  const total = build.lines.length;
  const given = Array.isArray(body.order) ? body.order : [];
  let hits = 0;
  for (let i = 0; i < total; i++) if (Number(given[i]) === build.answer[i]) hits++;
  return { ok: hits === total, hits, total };
}
