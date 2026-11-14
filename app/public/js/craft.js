/* Assembly puzzles, as a screen.

   order — the lines are there, the sequence is not. Pick a line, drop it where
           it belongs; or tap one line then another to swap them.
   match — two columns, no wiring. Tap a piece on the left, then its partner on
           the right, and a wire appears between them.

   The server only ever returns a count ("three of five positions are right"),
   never which ones. You get a temperature, not a map — that is the difference
   between this and a quiz you can brute-force by elimination. */

import { api, toast, esc } from "./core.js";
import { hud, stars, beep, mountPage } from "./pixel.js";
import { tutorDock } from "./tutor.js";
import { t } from "./i18n.js";

let C = null;
let resizer = null;

export async function renderCraft(app, courseId, lessonId) {
  const player = await api("/api/player").catch(() => ({}));
  let course;
  let payload;
  try {
    course = (await api(`/api/course/${encodeURIComponent(courseId)}`)).course;
    payload = await api(`/api/course/${encodeURIComponent(courseId)}/craft/${encodeURIComponent(lessonId)}`);
  } catch (e) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">${esc(t("进不去"))}</div>
      <p class="px-sub">${esc(e.message)}</p>
      <a class="px-btn" href="#/course/${encodeURIComponent(courseId)}" style="margin-top:12px">${esc(t("回到课程"))}</a>
    </div></main>`;
    return;
  }

  const craft = payload.craft;
  C = {
    courseId,
    lessonId,
    course,
    track: course.track ?? player.track ?? "frontend",
    player,
    craft,
    progress: payload.progress ?? null,
    links: craft.type === "match" ? craft.left.map(() => -1) : [],
    picked: null,
    locked: false,
    tries: 0,
    hint: false,
    solved: Boolean(payload.progress?.solved),
  };

  paint(app);
  mountTutor();
}

function focusText() {
  const k = C.craft;
  if (k.type === "match") {
    const done = C.links.filter((j) => j >= 0).length;
    return [
      `任务：${k.title}（连线题，左边是概念/属性，右边是效果/场景）`,
      `左：${k.left.join(" / ")}`,
      `右：${k.right.join(" / ")}`,
      `已经连了 ${done} / ${k.left.length} 条。`,
      C.tries ? `已经提交过 ${C.tries} 次，都没全对。` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  const rows = [...document.querySelectorAll("#lines .px-line")].map((r, i) => `${i + 1}. ${r.dataset.text ?? r.innerText.trim()}`);
  return [
    `任务：${k.title}（排序题，把这些行排成正确顺序）`,
    `当前顺序：`,
    rows.join("\n"),
    C.tries ? `已经提交过 ${C.tries} 次，都没排对。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mountTutor() {
  tutorDock({
    courseId: C.courseId,
    lessonId: () => C.lessonId,
    mode: "answer",
    intro: t("我是这一关的导师。你把现在的排列发我，我告诉你该先怀疑哪一处、这一关在考什么——但不会替你把顺序排出来。"),
    focus: focusText,
  });
}

/* --------------------------------- paint --------------------------------- */

function paint(app) {
  const k = C.craft;
  const st = C.progress?.stars ?? 0;
  const isMatch = k.type === "match";

  mountPage(
    app,
    `${hud(C.player, `<span class="px-tiny">${esc(t("拼装"))} · ${esc(k.lessonTitle ?? "")}</span>`, isMatch ? "接线台" : "装配台")}
    <main class="px-wrap px-craft">
      <div class="px-craft-head">
        <div>
          <div class="px-craft-crumb">
            <a class="px-craft-back" href="#/course/${encodeURIComponent(C.courseId)}">← 回岛屿</a>
            <span class="px-kicker">${esc(t(isMatch ? "接线题" : "排序题"))} · ${esc(C.course.title)}</span>
          </div>
          <h1 class="px-h1">${esc(k.title)}</h1>
          <p class="px-sub">${
            isMatch
              ? esc(t("点左边一项，再点右边和它对应的那一项，线就会连上。连错可以再点一次断开。"))
              : esc(t("把行拖到正确位置；也可以先点一行、再点另一行，两行直接对调。"))
          }</p>
        </div>
        <div class="px-craft-badge">
          ${st ? `<span class="px-craft-stars">${stars(st)}</span>` : ""}
          <span class="px-chip">${k.total} ${esc(t(isMatch ? "对" : "行"))}</span>
        </div>
      </div>

      ${
        isMatch
          ? `<div class="px-craft-match" id="match">
              <svg class="px-wire" id="wire" aria-hidden="true"></svg>
              <div class="px-col px-col-left">
                ${k.left.map((t, i) => `<button class="px-node" data-side="l" data-i="${i}" type="button">${esc(t)}</button>`).join("")}
              </div>
              <div class="px-col px-col-right">
                ${k.right.map((t, i) => `<button class="px-node" data-side="r" data-i="${i}" type="button">${esc(t)}</button>`).join("")}
              </div>
            </div>`
          : `<div class="px-craft-lines" id="lines" data-lang="${esc(k.lang ?? "text")}">
              ${k.lines
                .map(
                  (t, i) => `<div class="px-line" data-id="${i}" data-text="${esc(t)}">
                    <span class="px-line-no">${i + 1}</span>
                    <code>${esc(t)}</code>
                    <span class="px-line-grip" aria-hidden="true">⠿</span>
                  </div>`,
                )
                .join("")}
            </div>`
      }

      <div class="px-craft-foot">
        <button class="px-btn primary" id="submit" type="button">${esc(t(C.solved ? "再检查一次" : "提交"))}</button>
        <button class="px-btn" id="hint" type="button">${esc(t("看提示"))}</button>
        ${isMatch ? `<button class="px-btn" id="reset" type="button">${esc(t("全部断开"))}</button>` : ""}
        <span class="px-craft-count" id="count"></span>
      </div>

      <div class="px-craft-hint" id="hint-box" hidden>${esc(k.hint || t("这一题没有额外提示，回板书那一页看看。"))}</div>
      <section class="px-craft-verdict" id="verdict" hidden></section>
    </main>`,
  );

  if (isMatch) bindMatch(app);
  else bindOrder(app);
  bindCommon(app);

  if (resizer) resizer.abort();
  resizer = new AbortController();
  window.addEventListener("resize", () => {
    if (!document.body.contains(app)) return;
    if (C.craft.type === "match") drawWires(app);
  }, { signal: resizer.signal });
}

/* -------------------------------- ordering -------------------------------- */

function renumber(list) {
  [...list.querySelectorAll(".px-line")].forEach((row, i) => {
    const no = row.querySelector(".px-line-no");
    if (no) no.textContent = String(i + 1);
  });
}

function bindOrder(app) {
  const list = app.querySelector("#lines");
  if (!list) return;
  let drag = null;

  const pick = (row) => {
    if (C.locked) return;
    const prev = list.querySelector(".px-line.picked");
    if (prev === row) {
      row.classList.remove("picked");
      return;
    }
    if (prev) {
      /* Swap by placeholder: moving one of two adjacent siblings directly is a
         special case that is easy to get wrong; a marker makes it one path. */
      const marker = document.createElement("div");
      prev.before(marker);
      row.before(prev);
      marker.replaceWith(row);
      prev.classList.remove("picked");
      renumber(list);
      beep("tap");
      return;
    }
    row.classList.add("picked");
    beep("tap");
  };

  list.addEventListener("pointerdown", (e) => {
    if (C.locked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const row = e.target.closest(".px-line");
    if (!row) return;
    const rect = row.getBoundingClientRect();
    drag = { row, offY: e.clientY - rect.top, x0: e.clientX, y0: e.clientY, rect, moved: false, ghost: null };
    try {
      list.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a convenience; releasing outside the list is then handled by pointercancel */
    }
  });

  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < 6 && Math.abs(e.clientX - drag.x0) < 6) return;
      drag.moved = true;
      const { row, rect } = drag;
      const ghost = document.createElement("div");
      ghost.className = "px-line-ghost";
      ghost.style.height = `${rect.height}px`;
      row.after(ghost);
      row.classList.add("dragging");
      row.style.width = `${rect.width}px`;
      row.style.height = `${rect.height}px`;
      row.style.left = `${rect.left}px`;
      row.style.top = `${rect.top}px`;
      drag.ghost = ghost;
    }
    e.preventDefault();
    drag.row.style.top = `${e.clientY - drag.offY}px`;

    /* Drop slot = first row whose midpoint is below the pointer. */
    let target = null;
    for (const other of list.querySelectorAll(".px-line")) {
      if (other === drag.row) continue;
      const r = other.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        target = other;
        break;
      }
    }
    if (target) target.before(drag.ghost);
    else list.append(drag.ghost);
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      pick(d.row);
      return;
    }
    d.row.remove();
    if (d.ghost.isConnected) d.ghost.replaceWith(d.row);
    else list.append(d.row);
    d.row.classList.remove("dragging");
    d.row.style.cssText = "";
    renumber(list);
    beep("tap");
  };

  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);

  /* Assigned, not added: `app` survives every repaint, so addEventListener here
     would stack one more handler per visit and move a line twice per keypress. */
  app.onkeydown = (e) => {
    const cur = list.querySelector(".px-line.picked");
    if (!cur || C.locked) return;
    if (e.target?.tagName === "TEXTAREA" || e.target?.tagName === "INPUT") return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const sib = e.key === "ArrowUp" ? cur.previousElementSibling : cur.nextElementSibling;
    if (!sib || !sib.classList.contains("px-line")) return;
    if (e.key === "ArrowUp") sib.before(cur);
    else sib.after(cur);
    renumber(list);
    beep("tap");
  };
}

/* --------------------------------- match --------------------------------- */

function drawWires(app) {
  const wrap = app.querySelector("#match");
  const wire = app.querySelector("#wire");
  if (!wrap || !wire) return;
  const lefts = [...wrap.querySelectorAll('[data-side="l"]')];
  const rights = [...wrap.querySelectorAll('[data-side="r"]')];
  const box = wrap.getBoundingClientRect();
  if (!box.width) return;
  wire.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  wire.innerHTML = C.links
    .map((j, i) => {
      if (j < 0 || !lefts[i] || !rights[j]) return "";
      const a = lefts[i].getBoundingClientRect();
      const b = rights[j].getBoundingClientRect();
      const x1 = a.right - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      const mx = (x1 + x2) / 2;
      return `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}" />`;
    })
    .join("");
}

function bindMatch(app) {
  const wrap = app.querySelector("#match");
  if (!wrap) return;

  const paintNodes = () => {
    wrap.querySelectorAll(".px-node").forEach((n) => {
      const side = n.dataset.side;
      const i = Number(n.dataset.i);
      const on = side === "l" ? C.links[i] >= 0 : C.links.includes(i);
      n.classList.toggle("linked", on);
      n.classList.toggle("picked", side === "l" && C.picked === i);
    });
  };

  wrap.addEventListener("click", (e) => {
    const n = e.target.closest(".px-node");
    if (!n || C.locked) return;
    const side = n.dataset.side;
    const i = Number(n.dataset.i);

    if (side === "l") {
      if (C.picked === i) {
        C.links[i] = -1;
        C.picked = null;
      } else {
        C.picked = i;
      }
    } else {
      if (C.picked == null) {
        toast(t("先点左边一项，再点右边。"), "info");
        return;
      }
      /* One wire per piece: taking a partner away from another line is intended,
         not an error — otherwise the puzzle deadlocks once one pair is wrong. */
      C.links = C.links.map((j, k) => (k !== C.picked && j === i ? -1 : j));
      C.links[C.picked] = i;
      C.picked = null;
    }
    beep("tap");
    paintNodes();
    drawWires(app);
    updateCount(app);
  });

  requestAnimationFrame(() => {
    drawWires(app);
    paintNodes();
  });
}

function updateCount(app) {
  const el = app.querySelector("#count");
  if (!el) return;
  if (C.craft.type === "match") {
    const n = C.links.filter((j) => j >= 0).length;
    el.textContent = t("已连 {n} / {m}", { n, m: C.craft.left.length });
  } else {
    el.textContent = t("{n} 行，拖到你觉得对的顺序", { n: C.craft.lines.length });
  }
}

/* -------------------------------- submit --------------------------------- */

function bindCommon(app) {
  const hintBtn = app.querySelector("#hint");
  if (hintBtn) {
    hintBtn.onclick = () => {
      const box = app.querySelector("#hint-box");
      box.hidden = !box.hidden;
      hintBtn.textContent = t(box.hidden ? "看提示" : "收起提示");
    };
  }

  const reset = app.querySelector("#reset");
  if (reset) {
    reset.onclick = () => {
      if (C.locked) return;
      C.links = C.craft.left.map(() => -1);
      C.picked = null;
      app.querySelectorAll(".px-node").forEach((n) => n.classList.remove("linked", "picked"));
      drawWires(app);
      updateCount(app);
    };
  }

  app.querySelector("#submit").onclick = () => submit(app);
  updateCount(app);
}

async function submit(app) {
  if (C.locked) return;
  const k = C.craft;
  let body;

  if (k.type === "match") {
    const unlinked = C.links.filter((j) => j < 0).length;
    if (unlinked) {
      toast(t("还有 {n} 项没连上。", { n: unlinked }), "info");
      return;
    }
    body = { pairs: C.links };
  } else {
    const order = [...app.querySelectorAll("#lines .px-line")].map((r) => Number(r.dataset.id));
    body = { order };
  }

  C.locked = true;
  const btn = app.querySelector("#submit");
  btn.disabled = true;
  btn.textContent = t("判定中…");

  let res;
  try {
    res = await api(`/api/course/${encodeURIComponent(C.courseId)}/craft/${encodeURIComponent(C.lessonId)}`, {
      method: "POST",
      body,
    });
  } catch (e) {
    toast(e.message, "error");
    btn.disabled = false;
    btn.textContent = t("提交");
    C.locked = false;
    return;
  }

  C.tries += 1;
  btn.disabled = false;
  btn.textContent = t("再试一次");
  C.locked = false;

  if (res.ok) {
    C.solved = true;
    beep("win");
    if (res.player) C.player = res.player;
    showWin(app, res);
  } else {
    beep("bad");
    showMiss(app, res);
  }
}

function showMiss(app, res) {
  const box = app.querySelector("#verdict");
  const pct = res.total ? Math.round((res.hits / res.total) * 100) : 0;
  box.hidden = false;
  box.className = "px-craft-verdict miss";
  box.innerHTML = `
    <div class="px-craft-miss-head">
      <b>${esc(t("还对不上"))}</b>
      <span>${res.hits} / ${res.total} ${esc(t(C.craft.type === "match" ? "对连对了" : "个位置对了"))}</span>
    </div>
    <div class="px-craft-meter"><i style="width:${pct}%"></i></div>
    <p class="px-sub">${esc(
      t(
        res.hits === 0
          ? "一处都没对，先别急着改，回板书看看这条规则到底在保证什么。"
          : res.hits === res.total - 1
            ? "只剩一处。把已经确定的部分先固定住，剩下的那一个多半是被它挤掉的。"
            : "别整段重排，先只动你最没把握的那一处，再提交一次。",
      ),
    )}</p>`;
  box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function showWin(app, res) {
  const box = app.querySelector("#verdict");
  box.hidden = false;
  box.className = "px-craft-verdict win";
  const nxt = nextLesson(C.course, C.lessonId);
  box.innerHTML = `
    <div class="px-craft-win-head">
      <b>${esc(t(C.craft.type === "match" ? "全接通了" : "能跑了"))}</b>
      <span class="px-craft-stars">${stars(res.stars || 3)}</span>
      ${res.xp ? `<span class="px-chip">+${res.xp} XP</span>` : ""}
    </div>
    ${C.craft.why ? `<p class="px-craft-why">${esc(C.craft.why)}</p>` : ""}
    <div class="px-craft-after">
      <a class="px-btn primary" href="#/lesson/${encodeURIComponent(C.courseId)}/${encodeURIComponent(C.lessonId)}">${esc(t("回讲次看板书"))}</a>
      ${nxt ? `<a class="px-btn" href="#/craft/${encodeURIComponent(C.courseId)}/${encodeURIComponent(nxt.id)}">${esc(t("下一讲：{name}", { name: nxt.title }))} →</a>` : ""}
      <a class="px-btn" href="#/course/${encodeURIComponent(C.courseId)}">${esc(t("回岛屿"))}</a>
    </div>`;
  box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  const sub = app.querySelector("#submit");
  if (sub) sub.textContent = "再检查一次";
}

function nextLesson(course, lessonId) {
  const all = (course.units ?? []).flatMap((u) => u.lessons ?? []);
  const i = all.findIndex((l) => l.id === lessonId);
  return i >= 0 ? all[i + 1] ?? null : null;
}
