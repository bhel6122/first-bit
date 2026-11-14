/* Boss battle: the lesson's three diagnostic questions, plus two chase questions
   pulled from the review queue or earlier lessons in the same region.

   Two rules matter here. A wrong answer costs a heart but never hides the
   explanation — and the page it came from opens inline instead of navigating,
   because leaving the fight to read would break the streak. */

import { api, navigate, toast, esc, fmt } from "./core.js";
import { hud, sprite, monster, beep, stars } from "./pixel.js";
import { TRACKS } from "./inventory.js";
import { tutorDock } from "./tutor.js";

let B = null;

export async function renderBattle(app, courseId, key) {
  const player = await api("/api/player").catch(() => ({}));
  let course;
  try {
    course = (await api(`/api/course/${courseId}`)).course;
  } catch (e) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">进不去</div><p class="px-sub">${esc(e.message)}</p>
      <a class="px-btn" href="#/" style="margin-top:12px">回首页</a></div></main>`;
    return;
  }

  const isBoss = key.startsWith("u:");
  const unitId = isBoss ? key.slice(2) : null;
  const track = course.track ?? "frontend";
  const unit = isBoss ? (course.units ?? []).find((u) => u.id === unitId) : (course.units ?? []).find((u) => u.lessons.some((l) => l.id === key));

  B = {
    courseId, key, isBoss, track,
    courseTitle: course.title,
    unitTitle: unit?.title ?? "",
    lessonTitle: (course.units ?? []).flatMap((u) => u.lessons).find((l) => l.id === key)?.title ?? unit?.title ?? "",
    rounds: [], idx: 0, hearts: isBoss ? 5 : 3, maxHearts: isBoss ? 5 : 3,
    hp: 100, combo: 0, maxCombo: 0, results: [], locked: false, pages: {}, revealed: null, done: false,
  };

  app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
    <div class="px-kicker">正在布阵</div>
    <p class="px-sub px-blink" style="margin-top:8px">把题目搬进战斗…</p></div></main>`;

  try {
    B.rounds = isBoss ? await bossRounds(courseId, unitId) : await lessonRounds(courseId, key, unit);
  } catch (e) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">这一关还没准备好</div><p class="px-sub">${esc(e.message)}</p>
      <a class="px-btn" href="#/map/${encodeURIComponent(courseId)}" style="margin-top:12px">回地图</a></div></main>`;
    return;
  }

  /* Same question pool every attempt, fresh order: memorising the position of
     the right answer is not what this is testing. */
  for (let i = B.rounds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [B.rounds[i], B.rounds[j]] = [B.rounds[j], B.rounds[i]];
  }

  if (!B.rounds.length) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">没有题目</div><p class="px-sub">这一关还没有可用的题目，先把这一讲的板书读完。</p>
      <a class="px-btn" href="#/map/${encodeURIComponent(courseId)}" style="margin-top:12px">回地图</a></div></main>`;
    return;
  }

  paint(app, player);
  attachTutor(player);
}

/* The tutor sees the round that is on screen, including the options and how many
   hearts are left — that is the difference between "explain this topic" and
   "help me not lose this fight". */
function attachTutor(player) {
  tutorDock({
    courseId: B.courseId,
    unitId: () => (B.isBoss ? B.key.slice(2) : ""),
    lessonId: () => B.rounds[B.idx]?.lessonId ?? (B.isBoss ? "" : B.key),
    mode: "answer",
    intro: `我是这一场的导师。卡住就把题目发我，我先帮你看它在考什么，再给一个你自己能往下走的提示——答案还得你自己选。`,
    focus: () => {
      const q = B.rounds[B.idx];
      if (!q) return "";
      return [
        `第 ${B.idx + 1}/${B.rounds.length} 回合 · 剩余 ${Math.max(0, B.hearts)} 颗心`,
        `题目：${q.q}`,
        q.options.map((o, i) => `${"ABCD"[i] ?? i + 1}. ${o}`).join("\n"),
        q.tried ? "（这一题他已经答过一次）" : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}

/* -------------------------------- rounds -------------------------------- */

async function lessonRounds(courseId, lessonId, unit) {
  const data = await api(`/api/course/${encodeURIComponent(courseId)}/lesson/${encodeURIComponent(lessonId)}`);
  if (!data.generated) throw new Error("这一讲还没生成，先回去读板书。");

  B.pages[lessonId] = data.lesson.pages;
  const base = (data.lesson.quiz ?? []).map((q) => ({
    qid: q.id, q: q.q, options: q.options, lessonId, lessonTitle: data.meta?.title ?? B.lessonTitle, tag: "本讲",
  }));

  const chase = [];
  try {
    const rev = await api(`/api/course/${encodeURIComponent(courseId)}/review`);
    for (const r of rev.questions ?? []) {
      if (chase.length >= 2) break;
      if (r.lessonId === lessonId && base.some((b) => b.qid === r.qid)) continue;
      chase.push({ qid: r.qid, q: r.q, options: r.options, lessonId: r.lessonId, lessonTitle: r.lessonTitle, tag: "复习" });
    }
  } catch {
    /* review queue is a bonus */
  }

  if (chase.length < 2 && unit) {
    const others = unit.lessons.filter((l) => l.id !== lessonId).slice(0, 2);
    for (const l of others) {
      if (chase.length >= 2) break;
      try {
        const d = await api(`/api/course/${encodeURIComponent(courseId)}/lesson/${encodeURIComponent(l.id)}`);
        if (!d.generated) continue;
        B.pages[l.id] = d.lesson.pages;
        const q = (d.lesson.quiz ?? [])[chase.length % Math.max(1, (d.lesson.quiz ?? []).length)];
        if (q) chase.push({ qid: q.id, q: q.q, options: q.options, lessonId: l.id, lessonTitle: l.title, tag: "追击" });
      } catch {
        /* a lesson that never generated simply has nothing to chase with */
      }
    }
  }

  return [...base, ...chase.slice(0, 2)];
}

async function bossRounds(courseId, unitId) {
  const test = await api(`/api/course/${encodeURIComponent(courseId)}/unit/${encodeURIComponent(unitId)}/test`);
  const qs = test.questions ?? [];
  if (!qs.length) throw new Error("这个区域还没有足够的题目，先读完几讲。");
  return qs.slice(0, 12).map((q) => ({
    qid: q.qid, q: q.q, options: q.options, lessonId: q.lessonId, lessonTitle: q.lessonTitle, tag: "区域",
  }));
}

/* --------------------------------- paint -------------------------------- */

function paint(app, player) {
  const q = B.rounds[B.idx];
  const roundNo = B.idx + 1;
  const total = B.rounds.length;
  const who = B.isBoss ? "区域守关者" : "回源幽灵";

  app.innerHTML = `${hud(player, `<span class="px-tiny">${esc(B.unitTitle)}</span>`)}
  <main class="px-wrap" style="padding-top:18px">
    <div class="px-battle-top">
      ${monster(B.isBoss ? "boss" : "quiz", B.isBoss ? 72 : 60)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:10px;align-items:baseline">
          <span style="font-size:13px">${esc(who)}</span>
          <span class="px-tiny">LV.${B.isBoss ? 8 : 3}</span>
          <span class="spacer" style="flex:1"></span>
          <span class="px-tiny">第 ${roundNo} / ${total} 回合</span>
        </div>
        <div class="px-hp" style="margin-top:6px">
          <div class="bar"><i style="width:${Math.max(0, B.hp)}%"></i></div>
        </div>
      </div>
    </div>

    <div class="px-panel" style="margin-top:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="px-hearts">${"♥".repeat(Math.max(0, B.hearts))}${"♡".repeat(Math.max(0, B.maxHearts - B.hearts))}</span>
        ${B.combo >= 2 ? `<span class="px-combo px-blink">连击 ×${B.combo}</span>` : ""}
        <span class="spacer" style="flex:1"></span>
        <span class="px-tag">${esc(q.tag)}</span>
        <span class="px-tiny">${esc(q.lessonTitle ?? "")}</span>
      </div>

      <p class="px-qtext" style="font-size:16px;line-height:1.7;margin:14px 0 0">${fmt(q.q)}</p>
      <div class="px-options" id="opts">
        ${q.options
          .map(
            (text, i) => `<button class="px-opt" data-opt="${i}">
              <span class="k">${"ABCD"[i] ?? i + 1}</span>
              <span>${fmt(text)}</span>
            </button>`,
          )
          .join("")}
      </div>
      <div id="fb"></div>
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
        <a class="px-btn ghost sm" href="#/map/${encodeURIComponent(B.courseId)}">撤出去</a>
        <span style="flex:1"></span>
        <span class="px-tiny" id="hint-line">答错可以再答一次，第二次再错才会掉第二颗心。</span>
      </div>
    </div>
  </main>`;

  app.querySelectorAll("[data-opt]").forEach((btn) => {
    btn.onclick = () => pick(app, player, Number(btn.dataset.opt));
  });

  const onKey = (e) => {
    /* The tutor's textarea lives on <body>; typing "a" there must not pick
       option A. */
    const tag = document.activeElement?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    const i = "abcd".indexOf(e.key.toLowerCase());
    if (i >= 0 && i < q.options.length && !B.locked) pick(app, player, i);
  };
  document.onkeydown = onKey;
}

async function pick(app, player, option) {
  if (B.locked) return;
  B.locked = true;
  const q = B.rounds[B.idx];
  const buttons = [...app.querySelectorAll("[data-opt]")];
  buttons.forEach((b) => (b.disabled = true));

  let res;
  try {
    res = await api(`/api/course/${encodeURIComponent(B.courseId)}/lesson/${encodeURIComponent(q.lessonId)}/answer`, {
      method: "POST",
      body: { qid: q.qid, option },
    });
  } catch (e) {
    B.locked = false;
    buttons.forEach((b) => (b.disabled = false));
    toast(e.message, "error");
    return;
  }

  const firstTry = !q.tried;
  q.tried = true;
  const good = res.correct === true;

  buttons.forEach((b, i) => {
    if (i === res.correctIndex) b.classList.add("correct");
    else if (i === option) b.classList.add("wrong");
    else b.classList.add("dim");
  });

  if (good) {
    B.combo += 1;
    B.maxCombo = Math.max(B.maxCombo, B.combo);
    B.hp = Math.max(0, B.hp - Math.ceil(100 / B.rounds.length));
    if (firstTry) B.results.push({ qid: q.qid, firstCorrect: true });
    beep("ok");
  } else {
    B.combo = 0;
    B.hearts -= 1;
    if (firstTry) B.results.push({ qid: q.qid, firstCorrect: false });
    beep("bad");
    app.querySelector(".px-battle-top")?.classList.add("px-shake");
  }

  /* The HUD is not re-rendered on every answer, so the hearts and the monster's
     bar have to be repainted by hand or the state and the screen drift apart. */
  const heartsEl = app.querySelector(".px-hearts");
  if (heartsEl) heartsEl.textContent = "♥".repeat(Math.max(0, B.hearts)) + "♡".repeat(Math.max(0, B.maxHearts - B.hearts));
  const hpBar = app.querySelector(".px-battle-top .bar > i");
  if (hpBar) hpBar.style.width = `${Math.max(0, B.hp)}%`;

  const dead = B.hearts <= 0;
  const fb = app.querySelector("#fb");
  fb.innerHTML = `<div class="px-feedback ${good ? "good" : "bad"}">
    <b>${good ? (firstTry ? "答对了，伤害打满" : "这次对了，但已经不算一次命中") : "这里容易想岔"}</b>
    <div style="margin-top:4px">${fmt(res.explain || "")}</div>
    ${!good && res.page ? `<div style="margin-top:8px"><button class="px-btn ghost sm" id="reveal">回看第 ${res.page} 页</button></div>` : ""}
    <div id="reveal-body"></div>
  </div>`;

  const reveal = app.querySelector("#reveal");
  if (reveal) reveal.onclick = async () => {
    reveal.disabled = true;
    reveal.textContent = "翻页中…";
    const text = await pageText(q.lessonId, res.page);
    app.querySelector("#reveal-body").innerHTML = `<div style="margin-top:10px;border-top:1px dashed var(--px-line);padding-top:8px">${text}</div>`;
    reveal.remove();
  };

  const next = document.createElement("div");
  next.style.cssText = "display:flex;gap:10px;margin-top:12px";
  next.innerHTML = dead
    ? `<span class="px-tiny" style="flex:1">心用完了。</span><button class="px-btn" id="fail">看结果</button>`
    : `<span style="flex:1"></span><button class="px-btn primary" id="next-round">${B.idx + 1 >= B.rounds.length ? "结算这场" : "下一回合"} →</button>`;
  fb.appendChild(next);
  app.querySelector("#hint-line").textContent = "答错的题还能再答一次，但这次的星级已经记下了。";

  const fail = app.querySelector("#fail");
  if (fail) fail.onclick = () => finish(app, player);
  const go = app.querySelector("#next-round");
  if (go) {
    go.onclick = () => {
      if (B.idx + 1 >= B.rounds.length) return finish(app, player);
      B.idx += 1;
      B.locked = false;
      B.revealed = null;
      paint(app, player);
    };
  }
  B.locked = false;
  buttons.forEach((b) => (b.disabled = true));
  if (!good) app.querySelector("#fb")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

async function pageText(lessonId, pageNo) {
  try {
    let pages = B.pages[lessonId];
    if (!pages) {
      const d = await api(`/api/course/${encodeURIComponent(B.courseId)}/lesson/${encodeURIComponent(lessonId)}`);
      pages = d.lesson?.pages ?? [];
      B.pages[lessonId] = pages;
    }
    const page = pages[Math.max(0, (Number(pageNo) || 1) - 1)];
    if (!page) return `<span class="px-tiny">这一页找不到了。</span>`;
    const lines = (page.blocks ?? [])
      .map((b) => (b.type === "text" ? b.text : b.type === "bullets" ? b.items.join("；") : b.type === "callout" ? b.text : b.type === "code" ? `<code>${esc(b.code)}</code>` : ""))
      .filter(Boolean)
      .slice(0, 3);
    return `<div class="px-tiny" style="margin-bottom:4px">第 ${pageNo} 页 · ${esc(page.title ?? "")}</div>
      <div style="font-size:12.5px;line-height:1.75">${lines.map((l) => `<div style="margin-bottom:4px">${fmt(l)}</div>`).join("")}</div>`;
  } catch {
    return `<span class="px-tiny">这一页暂时打不开。</span>`;
  }
}

/* -------------------------------- finish -------------------------------- */

async function finish(app, player) {
  document.onkeydown = null;
  const failed = B.hearts <= 0;
  let out = { ok: false, stars: 0, xp: 0, player };
  if (!failed) {
    try {
      out = await api(`/api/course/${encodeURIComponent(B.courseId)}/battle/${encodeURIComponent(B.key)}`, {
        method: "POST",
        body: { rounds: B.results, heartsLeft: B.hearts },
      });
    } catch (e) {
      toast(e.message, "error");
    }
  }

  const before = player?.level ?? 1;
  const after = out.player?.level ?? before;
  const leveled = after > before;
  beep(failed ? "bad" : leveled ? "level" : "win");

  const back = document.createElement("div");
  back.className = "px-modal-back";
  back.innerHTML = `<div class="px-modal">
    <div class="px-kicker">${failed ? "这场没打完" : B.isBoss ? "区域守关者倒下了" : "这一关通了"}</div>
    <h2 class="px-title" style="margin-top:8px">${failed ? "心用完了，再来一次。" : out.stars === 3 ? "三颗星，一次没错。" : out.stars === 2 ? "过了，但还有两处能补。" : "过了，星不多。"}</h2>
    <div style="display:flex;gap:12px;align-items:center;margin:8px 0">
      ${sprite(B.track, failed ? "idle" : "up", 56)}
      <div>
        <div class="px-stars" style="font-size:18px">${failed ? stars(0) : stars(out.stars ?? 1)}</div>
        <div class="px-tiny">连击纪录 ×${B.maxCombo}</div>
      </div>
    </div>
    <div class="px-result-xp">
      ${failed ? `<span>失败不扣经验，题目顺序会打乱，再打一次就行。</span>` : `
        <span>命中 ${B.results.filter((r) => r.firstCorrect).length}/${B.results.length} 题 · +${out.xp ?? 0} XP</span>
        ${leveled ? `<span style="color:var(--px-warn)">升级了：LV.${before} → LV.${after}</span>` : `<span>当前 LV.${after} · ${out.player?.xp ?? 0} XP</span>`}
      `}
    </div>
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
      ${failed ? `<button class="px-btn primary" id="retry">再打一次</button>` : ""}
      <a class="px-btn ${failed ? "ghost" : "primary"}" href="#/map/${encodeURIComponent(B.courseId)}">回地图</a>
      <a class="px-btn ghost" href="#/">回首页</a>
    </div>
  </div>`;
  document.body.appendChild(back);
  const retry = back.querySelector("#retry");
  if (retry) retry.onclick = () => {
    back.remove();
    renderBattle(document.getElementById("app"), B.courseId, B.key);
  };
}

export function clearBattleKeys() {
  document.onkeydown = null;
}
