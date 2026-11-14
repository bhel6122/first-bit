/* The tutor that follows you into a fight.

   The classroom already has an ask box — it knows which page you are on. Inside
   the game there is no page; there is a question you are about to guess at, a
   broken line you cannot read, a test case that keeps failing. So this dock
   takes a `focus()` function instead: called at send time, it returns whatever
   the learner is looking at right then, in plain text. The tutor sees that plus
   the nearest board and is told not to hand over the answer.

   It lives on <body> so it can float over the pixel panels; the router sweeps
   `.px-tutor-dock` on navigation (see app.js). */

import { api, esc, fmt } from "./core.js";

const QUICK = [
  ["这题在考什么", "这题到底在考哪个知识点？先说考什么，别给答案。"],
  ["给我一个提示", "给我一个能往下走的提示，但不要直接告诉我答案。"],
  ["我错在哪", "帮我看看我的思路偏在哪一步，指出来我自己改。"],
];

export function tutorDock(opts) {
  const dock = document.createElement("div");
  dock.className = "px-tutor-dock";
  dock.innerHTML = `
    <button class="px-tutor-fab" type="button" aria-expanded="false">
      <span class="face" aria-hidden="true">?</span>
      <span>问导师</span>
    </button>
    <div class="px-tutor-panel" hidden>
      <div class="px-tutor-head">
        <span class="px-kicker">AI 导师</span>
        <span class="px-tiny">看得见你这一屏</span>
        <span style="flex:1"></span>
        <button class="px-tutor-x" type="button" aria-label="收起">×</button>
      </div>
      <div class="px-tutor-log"></div>
      <div class="px-tutor-quick">
        ${QUICK.map(([label, q]) => `<button class="px-chip" type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("")}
      </div>
      <div class="px-tutor-input">
        <textarea rows="1" maxlength="400" placeholder="卡在哪一步？直接问，比如：这个循环为什么少算一个"></textarea>
        <button class="px-btn primary sm" type="button" data-send>发送</button>
      </div>
    </div>`;

  document.body.appendChild(dock);

  const fab = dock.querySelector(".px-tutor-fab");
  const panel = dock.querySelector(".px-tutor-panel");
  const log = dock.querySelector(".px-tutor-log");
  const box = dock.querySelector("textarea");
  const sendBtn = dock.querySelector("[data-send]");

  let busy = false;
  let opened = false;
  const history = [];
  /* Everything about the context can be a function: a fight changes question
     every round, and the tutor must see the current one, not the first. */
  const val = (v) => (typeof v === "function" ? v() : v);

  const paint = () => {
    log.innerHTML = history.length
      ? history
          .map((m) =>
            m.role === "me"
              ? `<div class="px-tutor-msg me">${esc(m.text)}</div>`
              : m.role === "typing"
                ? `<div class="px-tutor-msg bot typing">导师正在看…</div>`
                : `<div class="px-tutor-msg bot">${fmt(m.text)}</div>`,
          )
          .join("")
      : `<div class="px-tutor-msg bot intro">${esc(
          opts.intro ?? "我是这门课的导师。你把卡住的那一步发给我，我先帮你看清它在考什么，再给你一个能自己往下走的提示。",
        )}</div>`;
    log.scrollTop = log.scrollHeight;
  };

  const open = (withQuestion) => {
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    dock.classList.add("open");
    opened = true;
    if (withQuestion) {
      box.value = withQuestion;
      box.focus();
      box.style.height = "auto";
      box.style.height = `${Math.min(88, box.scrollHeight)}px`;
      return;
    }
    if (!history.length) paint();
    box.focus();
  };

  const close = () => {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    dock.classList.remove("open");
    opened = false;
  };

  async function ask(text) {
    const question = String(text ?? "").trim();
    if (!question || busy) return;
    busy = true;
    sendBtn.disabled = true;
    history.push({ role: "me", text: question });
    history.push({ role: "typing" });
    paint();
    box.value = "";
    box.style.height = "auto";
    try {
      const res = await api(`/api/course/${encodeURIComponent(opts.courseId)}/tutor`, {
        method: "POST",
        body: {
          question,
          unitId: val(opts.unitId) ?? "",
          lessonId: val(opts.lessonId) ?? "",
          page: val(opts.page) ?? 0,
          mode: val(opts.mode) ?? "answer",
          /* Read the screen at send time, not at mount time: by round three the
             learner is on a different question than the one they opened with. */
          focus: val(opts.focus) || "",
        },
      });
      history[history.length - 1] = { role: "bot", text: res.answer };
    } catch (e) {
      history[history.length - 1] = { role: "bot", text: e.message };
    }
    paint();
    busy = false;
    sendBtn.disabled = false;
  }

  fab.onclick = () => (opened ? close() : open());
  dock.querySelector(".px-tutor-x").onclick = close;
  sendBtn.onclick = () => ask(box.value);
  dock.querySelectorAll("[data-q]").forEach((b) => {
    b.onclick = () => ask(b.dataset.q);
  });

  box.addEventListener("keydown", (e) => {
    /* The fight listens for a/b/c/d on document; typing a question would pick
       an option. Stop the key here so the textarea keeps its letters. */
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(box.value);
    }
    if (e.key === "Escape") close();
  });
  box.addEventListener("input", () => {
    box.style.height = "auto";
    box.style.height = `${Math.min(88, box.scrollHeight)}px`;
  });

  paint();

  return {
    ask,
    open,
    close,
    destroy: () => dock.remove(),
    isOpen: () => opened,
  };
}
