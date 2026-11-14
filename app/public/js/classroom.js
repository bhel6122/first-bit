/* The whiteboard classroom.

   One page at a time. Each page carries blocks and a script; every script step
   reveals part of the board, so the writing grows with the voice instead of
   appearing all at once. Speech is the browser's own synthesis — no audio files,
   no network, and it pauses the moment the learner types a question. */

import {
  state, api, esc, fmt, fmtMinutes, navigate, icon, toast, modal, openQuiz, download,
  showJob, unitKicker, loadConfig,
} from "./core.js";
import { t } from "./i18n.js";

let P = null;

const KIND_LABEL = {
  concept: "概念",
  formula: "推导",
  code: "代码",
  compare: "对比",
  flow: "流程",
  summary: "收束",
  demo: "演示",
  title: "开场",
};

const BLOCK_ICON = { key: "bulb", warn: "bulb", note: "book" };

/* --------------------------------- entry --------------------------------- */

export async function renderLesson(app, courseId, lessonId) {
  let data;
  try {
    data = await api(`/api/course/${courseId}/lesson/${lessonId}`);
  } catch (e) {
    app.innerHTML = `<div class="classroom"><div class="lessonbar"><button class="icon-btn" data-home>${icon("back", 16)}</button><div class="lessonbar-title"><h2>找不到这一讲</h2></div></div>
      <div style="padding:60px;text-align:center"><p class="muted">${esc(e.message)}</p><button class="btn btn-primary" data-home style="margin-top:14px">回到课程</button></div></div>`;
    app.querySelectorAll("[data-home]").forEach((b) => (b.onclick = () => navigate(`/course/${courseId}`)));
    return;
  }

  if (!data.generated) {
    renderSkeleton(app, data, courseId);
    const need = state.config?.model?.configured;
    if (!need) {
      app.querySelector("#gen-slot").innerHTML = `<div class="gen-failed">当前是演示模式，不能生成新的讲次。可以体验内置示例课程，或配置模型后再来。</div>
        <div class="job-actions"><button class="btn btn-primary btn-sm" data-demo>去看示例课程</button><button class="btn btn-ghost btn-sm" data-home>返回课程</button></div>`;
      app.querySelector("[data-demo]")?.addEventListener("click", () => navigate("/course/demo"));
      app.querySelectorAll("[data-home]").forEach((b) => (b.onclick = () => navigate(`/course/${courseId}`)));
      return;
    }

    const result = await showJob({
      title: "正在写这一讲",
      sub: `《${data.meta.title}》`,
      labels: ["梳理这一讲的脉络", "写板书", "配讲解词", "出三道练习题"],
      start: () => api(`/api/course/${courseId}/lesson/${lessonId}`, { method: "POST" }),
      note: "第一次打开需要 20-40 秒。之后再进来会直接读已生成的内容；不满意可以重新生成。",
    });

    if (!result) {
      navigate(`/course/${courseId}`);
      return;
    }
    try {
      data = await api(`/api/course/${courseId}/lesson/${lessonId}`);
    } catch (e) {
      toast(e.message, "error");
      navigate(`/course/${courseId}`);
      return;
    }
    if (!data.generated) {
      toast("生成没有完成，请再试一次。", "error");
      navigate(`/course/${courseId}`);
      return;
    }
  }

  boot(app, courseId, lessonId, data);
}

function shellHead(data, courseId) {
  const unit = data.unit;
  const meta = data.meta ?? data.lesson;
  const index = data.neighbors?.index ?? 0;
  const total = data.neighbors?.total ?? 0;
  return `<div class="lessonbar">
    <button class="icon-btn" data-back title="回到课程">${icon("back", 16)}</button>
    <div class="lessonbar-title">
      <small>${unitKicker(unit?.index ?? 0)} · ${esc(unit?.title ?? "")}${total ? ` · 第 ${index + 1}/${total} 讲` : ""}</small>
      <h2>${esc(meta?.title ?? "这一讲")}</h2>
    </div>
    <span class="spacer"></span>
    <span class="chip hide-sm" data-voice-chip>${icon("sound", 12)} 自动开讲</span>
    <button class="btn btn-quiet btn-sm" data-quick title="不看板书，直接做这一讲的题（Q）">${icon("spark", 14)} 快速答题</button>
    <button class="btn btn-ghost btn-sm" data-notes>${icon("note", 14)} 板书笔记</button>
    <button class="icon-btn" data-regen title="重新生成这一讲">${icon("refresh", 15)}</button>
  </div>`;
}

function renderSkeleton(app, data, courseId) {
  app.innerHTML = `<div class="classroom">
    ${shellHead(data, courseId)}
    <div class="class-layout">
      <div class="stage-wrap">
        <div class="gen-stage">
          <div class="gen-card" id="gen-slot">
            <div class="job-orb">${icon("spark", 20)}</div>
            <h3>这一讲还没有内容</h3>
            <p>第一次打开时，会现场生成板书、讲解词和三道练习题。</p>
            <div class="gen-note">生成过程中可以切走，任务会在后台继续。</div>
          </div>
        </div>
      </div>
      <aside class="side-panel" style="display:grid;place-items:center">
        <div class="tiny muted" style="padding:20px;text-align:center;line-height:1.8">生成完成后，这里会出现<br>逐句讲解稿和随时提问的入口。</div>
      </aside>
    </div>
  </div>`;
  app.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => navigate(`/course/${courseId}`)));
  app.querySelectorAll("[data-notes]").forEach((b) => (b.onclick = () => toast("这一讲还没生成内容。")));
  app.querySelectorAll("[data-regen]").forEach((b) => (b.onclick = () => toast("先等这一讲生成完。")));
  app.querySelectorAll("[data-quick]").forEach((b) => (b.onclick = () => toast("这一讲还没出题，等它生成完。")));
}

/* ---------------------------------- boot ---------------------------------- */

function boot(app, courseId, lessonId, data) {
  if (!data.lesson?.pages?.length) {
    toast("这一讲的内容是空的，请重新生成。", "error");
    navigate(`/course/${courseId}`);
    return;
  }

  app.innerHTML = `<div class="classroom">
    ${shellHead(data, courseId)}
    <div class="class-layout">
      <div class="stage-wrap">
        <div class="stage"><div class="board" id="board"></div></div>
        <div class="board-caption"><span class="cap-mark">旁白</span><span class="cap-text" id="cap-text"></span></div>
        <div class="board-controls">
          <div class="dots" id="dots"></div>
          <div class="controls-center">
            <button class="ctrl" data-prev-page title="上一页（←）">${icon("left", 16)}</button>
            <button class="ctrl play" data-play title="播放 / 暂停（空格）">${icon("play", 17)}</button>
            <button class="ctrl" data-next-page title="下一页（→）">${icon("right", 16)}</button>
          </div>
          <div class="speed">
            语速
            <select id="rate" aria-label="语速">
              <option value="0.85">0.85×</option>
              <option value="1" selected>1.0×</option>
              <option value="1.15">1.15×</option>
              <option value="1.3">1.3×</option>
            </select>
            <button class="ctrl" id="mute" title="旁白开关" style="width:30px;height:30px">${icon("sound", 14)}</button>
          </div>
        </div>
        <div class="stage-hint" id="stage-hint">空格 播放 / 暂停 · ← → 翻页 · Q 直接做题 · 右侧随时提问</div>
      </div>

      <aside class="side-panel">
        <div class="panel-tabs">
          <button data-tab="transcript" class="active">讲解</button>
          <button data-tab="chat">追问</button>
          <span class="spacer"></span>
          <span class="tiny muted" id="page-count" style="padding-top:11px"></span>
        </div>
        <div id="panel-body" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>
        <div class="ask-box">
          <div class="ask-quick">
            <button class="ask-chip" id="repitch" type="button" title="让导师换一种说法，把这一页重讲一次">${icon("bulb", 12)} 这一页没听懂 · 换个说法重讲</button>
          </div>
          <div class="ask-inner">
            <textarea id="ask-input" placeholder="例如：这里为什么要除以 n？" maxlength="500"></textarea>
            <button id="mic" title="语音提问">${icon("mic", 15)}</button>
            <button id="send" class="send" title="发送">${icon("send", 15)}</button>
          </div>
          <div class="ask-hint"><span>Enter 发送 · Shift+Enter 换行</span><span id="ask-note">不打断播放</span></div>
        </div>
      </aside>
    </div>
  </div>`;

  const pages = data.lesson.pages;
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  let voices = [];
  const pickVoices = () => {
    try {
      voices = synth?.getVoices?.() ?? [];
    } catch {
      voices = [];
    }
  };
  pickVoices();
  if (synth) {
    synth.onvoiceschanged = () => {
      pickVoices();
      if (!P) return;
      const hasZh = voices.some((v) => /^zh/i.test(v.lang));
      P.voiceOn = Boolean(synth) && (hasZh || voices.length === 0);
      updateControls();
    };
  }

  const voiceFor = () => {
    const zh = voices.filter((v) => /^zh/i.test(v.lang));
    return (
      zh.find((v) => /Xiaoxiao|Huihui|Yaoyao|Tingting|Natural|Online/i.test(v.name)) ??
      zh.find((v) => /CN|Hans/i.test(v.lang)) ??
      zh[0] ??
      null
    );
  };

  P = {
    cid: courseId,
    lid: lessonId,
    data,
    page: 0,
    step: 0,
    reveal: 0,
    playing: false,
    muted: false,
    voiceOn: Boolean(synth) && (voices.some((v) => /^zh/i.test(v.lang)) || voices.length === 0),
    rate: 1,
    token: 0,
    timer: null,
    touched: false,
    finished: false,
    pageEnter: Date.now(),
    chat: [],
    tab: "transcript",
    destroyed: false,
  };
  state.player = P;

  const $ = (sel) => app.querySelector(sel);
  const board = $("#board");
  const capText = $("#cap-text");
  const dots = $("#dots");
  const panelBody = $("#panel-body");
  const stageHint = $("#stage-hint");
  const playBtn = $("[data-play]");
  const pageCount = $("#page-count");

  /* ------------------------------- rendering ------------------------------- */

  function renderBoard() {
    const page = pages[P.page];
    P.step = 0;
    P.reveal = page.steps[0]?.reveal ?? page.blocks.length;
    board.classList.add("started");
    board.innerHTML = `<div class="board-inner">
      <div class="board-kicker">${unitKicker(data.unit?.index ?? 0)}<i></i>${esc(KIND_LABEL[page.kind] ?? "板书")} · 第 ${P.page + 1} 页</div>
      <h1>${esc(page.title)}<span class="rule"></span></h1>
      <div class="blocks ${page.blocks.length > 4 ? "dense" : ""}">
        ${page.blocks.map(blockHTML).join("")}
      </div>
    </div>`;
    if (!P.touched && !P.playing) {
      const start = document.createElement("button");
      start.className = "board-start";
      start.innerHTML = `${icon("play", 15)} 开始讲解`;
      start.onclick = () => togglePlay();
      board.appendChild(start);
    }
    requestAnimationFrame(() => paintReveal(P.reveal));
    setCaption(page.steps[0]?.say ?? "", false);
    updateDots();
    updateTranscriptHighlight();
    pageCount.textContent = `${P.page + 1} / ${pages.length}`;
  }

  function hideStart() {
    board.querySelector(".board-start")?.remove();
  }

  function paintReveal(n) {
    board.querySelectorAll(".blk").forEach((el, i) => el.classList.toggle("on", i < n));
  }

  function setCaption(text, animate = true) {
    if (!animate) {
      capText.textContent = text;
      return;
    }
    capText.style.opacity = "0";
    setTimeout(() => {
      capText.textContent = text;
      capText.style.opacity = "1";
    }, 80);
  }

  function updateDots() {
    dots.innerHTML = pages
      .map((_, i) => `<button class="${i === P.page ? "active" : i < P.page ? "seen" : ""}" data-dot="${i}" title="第 ${i + 1} 页"></button>`)
      .join("");
    dots.querySelectorAll("[data-dot]").forEach((b) => {
      b.onclick = () => goPage(Number(b.dataset.dot), P.playing);
    });
  }

  function updateControls() {
    playBtn.innerHTML = P.playing ? icon("pause", 17) : icon("play", 17);
    playBtn.title = P.playing ? "暂停（空格）" : "播放（空格）";
    app.querySelector("[data-prev-page]").disabled = P.page === 0;
    app.querySelector("[data-next-page]").disabled = P.page === pages.length - 1;
    app.querySelector("#mute").innerHTML = P.muted || !P.voiceOn ? icon("mute", 14) : icon("sound", 14);
  }

  function panelTranscript() {
    panelBody.innerHTML = `<div class="transcript" id="transcript">
      ${pages
        .map(
          (page, pi) => `<div style="margin-bottom:6px">
            <div class="tiny muted" style="padding:8px 10px 2px;letter-spacing:.04em">第 ${pi + 1} 页 · ${esc(page.title)}</div>
            ${page.steps
              .map(
                (s, si) => `<div class="transcript-step ${pi === P.page && si === P.step ? "current" : ""}" data-goto="${pi}:${si}">
                  <span class="n">${si + 1}</span><p>${esc(s.say)}</p>
                </div>`,
              )
              .join("")}
          </div>`,
        )
        .join("")}
    </div>`;
    panelBody.querySelectorAll("[data-goto]").forEach((el) => {
      el.onclick = () => {
        const [pi, si] = el.dataset.goto.split(":").map(Number);
        jumpTo(pi, si);
      };
    });
    scrollCurrentStep();
  }

  function panelChat() {
    panelBody.innerHTML = `<div class="chat" id="chat">
      ${P.chat.length ? "" : `<div class="chat-empty">这一页哪里没讲清楚？<br>直接问，助教会贴着当前板书回答。<br><span class="tiny">也可以按麦克风用说的。</span></div>`}
      ${P.chat
        .map((m) => {
          if (m.role === "user") return `<div class="msg user">${esc(m.text)}</div>`;
          if (m.typing) return `<div class="msg bot typing">正在看当前这一页…</div>`;
          return `<div class="msg bot">${fmt(m.text)}${m.page ? `<button class="jump" data-jump="${m.page}">${icon("book", 11)} 看第 ${m.page} 页</button>` : ""}</div>`;
        })
        .join("")}
    </div>`;
    panelBody.querySelectorAll("[data-jump]").forEach((b) => {
      b.onclick = () => goPage(Number(b.dataset.jump) - 1, false);
    });
    const chat = panelBody.querySelector("#chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  function renderPanel() {
    if (P.tab === "chat") panelChat();
    else panelTranscript();
  }

  function updateTranscriptHighlight() {
    panelBody.querySelectorAll(".transcript-step").forEach((el) => {
      const [pi, si] = el.dataset.goto.split(":").map(Number);
      el.classList.toggle("current", pi === P.page && si === P.step);
    });
    scrollCurrentStep();
  }

  function scrollCurrentStep() {
    const el = panelBody.querySelector(".transcript-step.current");
    if (el) el.scrollIntoView({ block: "nearest" });
  }

  /* -------------------------------- playback -------------------------------- */

  function speakStep() {
    if (!P.playing) return;
    const page = pages[P.page];
    const step = page.steps[P.step];
    if (!step) return;

    P.reveal = Math.max(P.reveal, step.reveal);
    paintReveal(P.reveal);
    setCaption(step.say);
    updateTranscriptHighlight();

    const token = ++P.token;
    clearTimeout(P.timer);

    if (!P.voiceOn || P.muted) {
      const ms = Math.max(2400, Math.min(14000, step.say.replace(/\s/g, "").length * 165));
      P.timer = setTimeout(() => advance(token), ms);
      return;
    }

    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(step.say);
      utter.lang = "zh-CN";
      utter.rate = P.rate;
      utter.pitch = 1.02;
      const v = voiceFor();
      if (v) utter.voice = v;
      let done = false;
      utter.onend = () => {
        if (done) return;
        done = true;
        advance(token);
      };
      // A voice that fails must not fast-forward the whole page: fall back to a
      // timed read for this step, then keep going silently.
      // Pausing calls synth.cancel(), which many browsers report here as
      // "interrupted"/"canceled". That is our own pause, not a broken voice —
      // if we disabled speech on it, resuming would play silently forever.
      utter.onerror = (ev) => {
        if (done) return;
        if (ev?.error === "interrupted" || ev?.error === "canceled" || ev?.error === "cancelled") return;
        done = true;
        P.voiceOn = false;
        updateControls();
        const ms = Math.max(2400, Math.min(14000, step.say.replace(/\s/g, "").length * 165));
        P.timer = setTimeout(() => advance(token), ms);
      };
      // Some Chrome builds leave the speech queue in a paused state after
      // cancel(); resume() clears it so the next speak() actually sounds.
      try {
        synth.resume();
      } catch {
        /* resume not supported here; speak() below still gets a chance */
      }
      synth.speak(utter);
    } catch {
      P.timer = setTimeout(() => advance(token), Math.max(2400, step.say.length * 160));
    }
  }

  function advance(token) {
    if (token !== P.token || !P.playing || P.destroyed) return;
    const page = pages[P.page];
    if (P.step < page.steps.length - 1) {
      P.step++;
      speakStep();
      return;
    }
    if (P.page < pages.length - 1) {
      P.timer = setTimeout(() => {
        if (P.playing) goPage(P.page + 1, true);
      }, 650);
      return;
    }
    P.playing = false;
    P.finished = true;
    updateControls();
    finishHint();
  }

  function stopSpeech() {
    P.token++;
    clearTimeout(P.timer);
    try {
      synth?.cancel();
    } catch {
      /* nothing to cancel */
    }
  }

  function togglePlay() {
    if (P.playing) {
      P.playing = false;
      stopSpeech();
      updateControls();
      return;
    }
    hideStart();
    if (P.finished) {
      goPage(0, true);
      return;
    }
    P.playing = true;
    P.touched = true;
    updateControls();
    speakStep();
  }

  function goPage(i, play = false) {
    if (i < 0 || i >= pages.length) return;
    recordPage();
    stopSpeech();
    P.page = i;
    P.step = 0;
    P.finished = false;
    P.playing = Boolean(play);
    P.touched = Boolean(play);
    P.pageEnter = Date.now();
    renderBoard();
    updateControls();
    stageHint.innerHTML = `空格 播放 / 暂停 · ← → 翻页 · Q 直接做题 · 右侧随时提问`;
    if (play) setTimeout(() => { if (P.playing) speakStep(); }, 240);
  }

  function jumpTo(pi, si) {
    const wasPlaying = P.playing;
    stopSpeech();
    P.playing = false;
    P.page = pi;
    P.touched = true;
    P.reveal = pages[pi].steps[si]?.reveal ?? pages[pi].blocks.length;
    P.finished = false;
    P.pageEnter = Date.now();
    board.classList.add("started");
    board.innerHTML = `<div class="board-inner">
      <div class="board-kicker">${unitKicker(data.unit?.index ?? 0)}<i></i>${esc(KIND_LABEL[pages[pi].kind] ?? "板书")} · 第 ${pi + 1} 页</div>
      <h1>${esc(pages[pi].title)}<span class="rule"></span></h1>
      <div class="blocks ${pages[pi].blocks.length > 4 ? "dense" : ""}">${pages[pi].blocks.map(blockHTML).join("")}</div>
    </div>`;
    requestAnimationFrame(() => paintReveal(P.reveal));
    P.step = si;
    setCaption(pages[pi].steps[si]?.say ?? "");
    updateDots();
    updateTranscriptHighlight();
    pageCount.textContent = `${pi + 1} / ${pages.length}`;
    updateControls();
    if (wasPlaying) {
      P.playing = true;
      speakStep();
    }
  }

  function finishHint() {
    const hasQuiz = P.data.lesson.quiz?.length;
    stageHint.innerHTML = `<button class="btn btn-primary btn-sm" data-quiz>${hasQuiz ? `完成本讲 · 做 ${P.data.lesson.quiz.length} 道题` : "完成本讲"} ${icon("arrow", 14)}</button>
      <button class="btn btn-quiet btn-sm" data-replay>再听一遍</button>`;
    stageHint.querySelector("[data-quiz]").onclick = () => (P.data.lesson.quiz?.length ? startQuiz() : completeWithoutQuiz());
    stageHint.querySelector("[data-replay]").onclick = () => goPage(0, true);
  }

  /* -------------------------------- progress -------------------------------- */

  function recordPage(complete = false) {
    const seconds = Math.round((Date.now() - P.pageEnter) / 1000);
    P.pageEnter = Date.now();
    if (seconds < 1 && !complete) return;
    api(`/api/course/${P.cid}/lesson/${P.lid}/page`, {
      method: "POST",
      body: { page: P.page + 1, seconds, complete },
    }).catch(() => {});
  }

  function beacon() {
    if (!P || P.destroyed) return;
    const seconds = Math.round((Date.now() - P.pageEnter) / 1000);
    if (seconds < 1) return;
    try {
      navigator.sendBeacon(
        `/api/course/${P.cid}/lesson/${P.lid}/page`,
        new Blob([JSON.stringify({ page: P.page + 1, seconds })], { type: "application/json" }),
      );
    } catch {
      /* the page is going away; nothing useful to do */
    }
  }
  window.addEventListener("pagehide", beacon);

  /* ---------------------------------- quiz ---------------------------------- */

  /* Skipping the board is allowed on purpose. Someone who already knows this
     material should be able to find out in thirty seconds, and a learner who
     only wants to test themselves should not have to sit through the narration
     first. Finishing the quiz still marks the lesson complete. */
  function quickQuiz() {
    const qs = P.data.lesson.quiz ?? [];
    if (!qs.length) {
      toast("这一讲还没出题，等它生成完再试。");
      return;
    }
    startQuiz();
  }

  function startQuiz() {
    stopSpeech();
    P.playing = false;
    updateControls();
    const qs = P.data.lesson.quiz.map((q) => ({ ...q }));
    openQuiz({
      kicker: `${unitKicker(data.unit?.index ?? 0)} · 本讲练习`,
      title: data.lesson.title,
      questions: qs,
      answer: (q, idx) =>
        api(`/api/course/${P.cid}/lesson/${P.lid}/answer`, { method: "POST", body: { qid: q.id, option: idx } }),
      assist: (q) =>
        api(`/api/course/${P.cid}/lesson/${P.lid}/ask`, {
          method: "POST",
          body: { question: `我不理解这道题：「${q.q}」。请给一个提示，先不要直接说答案。`, page: P.page + 1 },
        }),
      onJump: (q, page) => goPage((page || 1) - 1, false),
      finish: async (score, total) => {
        try {
          await api(`/api/course/${P.cid}/lesson/${P.lid}/complete`, {
            method: "POST",
            body: { seconds: Math.round((Date.now() - P.pageEnter) / 1000) },
          });
        } catch {
          /* progress is a courtesy; never block the result screen */
        }
        await refreshConfig();
        const next = P.data.neighbors?.next;
        const actions = [];
        if (next) {
          actions.push({
            label: `下一讲：${next.title}`,
            primary: true,
            onClick: () => navigate(`/lesson/${P.cid}/${next.id}`),
          });
        }
        actions.push({ label: "回到课程", primary: !next, onClick: () => navigate(`/course/${P.cid}`) });
        return {
          heading: score === total ? "这一讲讲透了" : score >= total * 0.66 ? "基本掌握，还有一个点要补" : "回到板书上再看一遍",
          detail:
            score === total
              ? "三道题都答对了。板书可以导出成笔记，方便课后复盘。"
              : "答错的那道题已经标记，回到对应页再听一遍，收益最大。",
          actions,
        };
      },
    });
  }

  async function completeWithoutQuiz() {
    try {
      await api(`/api/course/${P.cid}/lesson/${P.lid}/complete`, {
        method: "POST",
        body: { seconds: Math.round((Date.now() - P.pageEnter) / 1000) },
      });
      await refreshConfig();
    } catch {
      /* ignore */
    }
    const next = P.data.neighbors?.next;
    const overlay = modal(`<div class="result-card">
      <div class="eyebrow">LESSON COMPLETE</div>
      <div class="result-score" style="font-size:40px">${icon("check", 42, 2)}</div>
      <h3>这一讲学完了</h3>
      <p>${next ? `下一讲是《${esc(next.title)}》，会默认这一讲已经掌握。` : "这是最后一讲，可以回到课程做单元测试。"}</p>
      <div class="quiz-actions" style="justify-content:center;margin-top:18px">
        ${next ? `<button class="btn btn-primary" data-next>下一讲 ${icon("arrow", 14)}</button>` : ""}
        <button class="btn btn-ghost" data-course>回到课程</button>
      </div>
    </div>`);
    overlay.querySelector("[data-course]").onclick = () => navigate(`/course/${P.cid}`);
    const nb = overlay.querySelector("[data-next]");
    if (nb) nb.onclick = () => navigate(`/lesson/${P.cid}/${next.id}`);
  }

  /* ---------------------------------- notes ---------------------------------- */

  function buildNotes() {
    const d = P.data;
    let md = `# ${d.lesson.title}\n\n> ${d.course.title} · ${d.unit.title}\n\n`;
    d.lesson.pages.forEach((page, i) => {
      md += `## ${i + 1}. ${page.title}\n\n`;
      for (const b of page.blocks) {
        if (b.type === "text") md += `${b.text}\n\n`;
        else if (b.type === "bullets") md += b.items.map((x) => `- ${x}`).join("\n") + "\n\n";
        else if (b.type === "formula") md += `**${b.text}**${b.caption ? ` — ${b.caption}` : ""}\n\n`;
        else if (b.type === "code") md += "```\n" + b.code + "\n```\n\n";
        else if (b.type === "compare") {
          md += `**${b.left.h}**：${b.left.items.join("；")}\n\n**${b.right.h}**：${b.right.items.join("；")}\n\n`;
        } else if (b.type === "flow") md += `流程：${b.items.join(" → ")}\n\n`;
        else if (b.type === "callout") md += `> ${b.text}\n\n`;
        else if (b.type === "table") {
          md += `| ${b.head.join(" | ")} |\n| ${b.head.map(() => "---").join(" | ")} |\n`;
          md += b.rows.map((r) => `| ${r.join(" | ")} |`).join("\n") + "\n\n";
        }
      }
      md += `**讲解**\n\n${page.steps.map((s) => `> ${s.say}`).join("\n>\n")}\n\n`;
    });
    md += `\n---\n\n由 first-bit 生成 · ${new Date().toLocaleDateString("zh-CN")}\n`;
    return md;
  }

  async function openNotes() {
    let saved = { markdown: "" };
    try {
      saved = await api(`/api/course/${P.cid}/lesson/${P.lid}/notes`);
    } catch {
      /* generate from the board instead */
    }
    const initial = saved.markdown?.trim() ? saved.markdown : buildNotes();

    const overlay = document.createElement("div");
    overlay.className = "drawer-backdrop";
    overlay.innerHTML = `<div class="drawer">
      <div class="drawer-head">
        <div>
          <h3>板书笔记</h3>
          <div class="tiny muted">可以改，再导出或保存</div>
        </div>
        <span class="spacer"></span>
        <button class="icon-btn" data-close>${icon("close", 16)}</button>
      </div>
      <div class="drawer-body"><textarea id="notes-text" spellcheck="false"></textarea></div>
      <div class="drawer-foot">
        <span class="tiny muted" data-notes-state>${saved.updatedAt ? `上次保存：${new Date(saved.updatedAt).toLocaleString("zh-CN")}` : "还未保存"}</span>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" data-copy>复制</button>
        <button class="btn btn-ghost btn-sm" data-download>${icon("download", 13)} .md</button>
        <button class="btn btn-primary btn-sm" data-save>保存</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector("#notes-text");
    ta.value = initial;
    overlay.querySelector("[data-close]").onclick = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const save = async () => {
      try {
        await api(`/api/course/${P.cid}/lesson/${P.lid}/notes`, { method: "POST", body: { markdown: ta.value } });
        overlay.querySelector("[data-notes-state]").textContent = "已保存";
        toast("笔记已保存");
      } catch (e) {
        toast(e.message, "error");
      }
    };
    overlay.querySelector("[data-save]").onclick = save;
    overlay.querySelector("[data-download]").onclick = () => {
      download(`${P.data.lesson.title}-板书笔记.md`, ta.value);
    };
    overlay.querySelector("[data-copy]").onclick = async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast("已复制到剪贴板");
      } catch {
        ta.select();
        document.execCommand("copy");
        toast("已复制");
      }
    };
  }

  /* ---------------------------------- asking --------------------------------- */

  /* What the learner is looking at, so a re-pitch talks about this page's
     narration rather than the whole lesson. */
  function pageFocus() {
    const p = P.data.lesson.pages?.[P.page];
    if (!p) return "";
    const board = (p.blocks ?? [])
      .map((b) => b.text || (b.items ?? []).join(" / ") || b.code || (b.left?.h ? `${b.left.h} vs ${b.right?.h}` : ""))
      .filter(Boolean)
      .join("\n");
    const said = (p.steps ?? []).map((s) => s.say).join("\n");
    return `这一页板书《${p.title}》\n${board}\n\n我刚听到的讲解：\n${said}`;
  }

  async function sendAsk(override = {}) {
    const input = $("#ask-input");
    const mode = override.mode ?? "answer";
    const text = (override.text ?? input.value).trim();
    if (!text) return;
    if (P.playing) togglePlay();
    input.value = "";
    P.tab = "chat";
    setTab("chat");
    P.chat.push({ role: "user", text: mode === "repitch" ? "这一页没听懂，重讲" : text });
    P.chat.push({ role: "bot", typing: true });
    renderPanel();
    try {
      const res = await api(`/api/course/${P.cid}/lesson/${P.lid}/ask`, {
        method: "POST",
        body: { question: text, page: P.page + 1, mode, focus: mode === "repitch" ? pageFocus() : "" },
      });
      P.chat[P.chat.length - 1] = { role: "bot", text: res.answer, page: res.page };
    } catch (e) {
      P.chat[P.chat.length - 1] = { role: "bot", text: e.message };
    }
    if (P.tab === "chat") renderPanel();
  }

  function setTab(tab) {
    P.tab = tab;
    app.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    renderPanel();
  }

  /* The 讲解 / 追问 pills carried no handler at all: asking a question called
     setTab("chat") in code, so the panel switched but the pills were dead —
     once you had asked something there was no way back to the transcript. */
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  /* ------------------------------- generation ------------------------------- */

  async function regenerate() {
    if (!confirm(t("重新生成这一讲？当前的板书内容会被替换，笔记和练习记录会保留。"))) return;
    stopSpeech();
    P.playing = false;
    const result = await showJob({
      title: "重写这一讲",
      sub: `《${data.lesson.title}》`,
      labels: ["重新梳理脉络", "重写板书", "重新配讲解", "出新练习题"],
      start: () => api(`/api/course/${P.cid}/lesson/${P.lid}?force=1`, { method: "POST" }),
      note: "旧内容会被新内容替换。如果新的不如旧的，只能再生成一次。",
    });
    if (!result) return;
    try {
      const fresh = await api(`/api/course/${P.cid}/lesson/${P.lid}`);
      boot(app, courseId, lessonId, fresh);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* --------------------------------- bindings -------------------------------- */

  app.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => navigate(`/course/${courseId}`)));
  app.querySelector("[data-notes]").onclick = openNotes;
  app.querySelector("[data-regen]").onclick = regenerate;
  app.querySelectorAll("[data-quick]").forEach((b) => (b.onclick = quickQuiz));


  playBtn.onclick = togglePlay;
  app.querySelector("[data-prev-page]").onclick = () => goPage(P.page - 1, P.playing);
  app.querySelector("[data-next-page]").onclick = () => goPage(P.page + 1, P.playing);

  app.querySelector("#rate").onchange = (e) => {
    P.rate = Number(e.target.value) || 1;
    if (P.playing) {
      stopSpeech();
      P.playing = true;
      // cancel() and speak() in the same task can drop the utterance in Chrome;
      // give the queue one turn to settle.
      setTimeout(() => {
        if (P.playing) speakStep();
      }, 80);
    }
  };

  app.querySelector("#mute").onclick = () => {
    P.muted = !P.muted;
    if (P.muted) stopSpeech();
    updateControls();
    if (P.playing) {
      setTimeout(() => {
        if (P.playing) speakStep();
      }, 80);
    }
  };

  const askInput = $("#ask-input");
  askInput.addEventListener("focus", () => {
    if (P.playing) togglePlay();
    $("#ask-note").textContent = "已暂停讲解";
  });
  askInput.addEventListener("input", () => {
    askInput.style.height = "46px";
    askInput.style.height = `${Math.min(132, askInput.scrollHeight)}px`;
  });
  askInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendAsk();
    }
  });
  $("#send").onclick = () => sendAsk();

  /* One click, no typing: the learner who is lost is the one least able to
     phrase a question. The current page and its narration travel as `focus`,
     so the repitch is about what they just heard. */
  const repitch = $("#repitch");
  if (repitch) {
    repitch.onclick = () => sendAsk({ mode: "repitch", text: "这一页我没听懂，请换一种说法重讲。" });
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#mic");
  if (!SR) {
    mic.title = "这个浏览器不支持语音识别，可以打字提问";
    mic.style.opacity = "0.4";
  } else {
    let rec = null;
    mic.onclick = () => {
      if (rec) {
        rec.stop();
        rec = null;
        return;
      }
      rec = new SR();
      rec.lang = "zh-CN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      mic.classList.add("listening");
      $("#ask-note").textContent = "在听…";
      rec.onresult = (ev) => {
        const text = ev.results?.[0]?.[0]?.transcript ?? "";
        askInput.value = text;
        if (text) sendAsk();
      };
      rec.onend = () => {
        mic.classList.remove("listening");
        $("#ask-note").textContent = "不打断播放";
        rec = null;
      };
      rec.onerror = () => {
        mic.classList.remove("listening");
        $("#ask-note").textContent = "没听清，再试一次";
        rec = null;
      };
      rec.start();
    };
  }

  const onKey = (e) => {
    if (document.querySelector(".modal-backdrop, .drawer-backdrop, .job-overlay")) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goPage(P.page + 1, P.playing);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPage(P.page - 1, P.playing);
    } else if (e.key === "q" || e.key === "Q") {
      e.preventDefault();
      quickQuiz();
    }
  };
  document.addEventListener("keydown", onKey);

  P.cleanup = () => {
    if (P.destroyed) return;
    P.destroyed = true;
    stopSpeech();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("pagehide", beacon);
    recordPage();
    if (synth) synth.onvoiceschanged = null;
  };

  renderBoard();
  updateControls();
  renderPanel();

  const jump = sessionStorage.getItem(`jump:${courseId}:${lessonId}`);
  if (jump) {
    sessionStorage.removeItem(`jump:${courseId}:${lessonId}`);
    const p = Number(jump);
    if (Number.isInteger(p) && p >= 1 && p <= pages.length) goPage(p - 1, false);
  }

  if (!P.voiceOn) {
    const chip = app.querySelector("[data-voice-chip]");
    if (chip) chip.innerHTML = `${icon("mute", 12)} 无语音 · 自动节奏`;
  }
}

/* ------------------------------- one block ------------------------------- */

function blockHTML(b, i) {
  const attrs = `class="blk blk-${b.type}" data-blk="${i}"`;
  if (b.type === "text") return `<div ${attrs}><p class="blk-text">${fmt(b.text)}</p></div>`;
  if (b.type === "bullets") return `<div ${attrs}><ul class="blk-bullets">${b.items.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></div>`;
  if (b.type === "formula")
    return `<div ${attrs}><div class="blk-formula">${esc(b.text)}${b.caption ? `<div class="cap">${esc(b.caption)}</div>` : ""}</div></div>`;
  if (b.type === "code")
    return `<div ${attrs}><div class="blk-code"><pre>${esc(b.code)}</pre></div></div>`;
  if (b.type === "compare")
    return `<div ${attrs}><div class="blk-compare">
      <div><h4>${esc(b.left.h)}</h4><ul>${b.left.items.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></div>
      <div><h4>${esc(b.right.h)}</h4><ul>${b.right.items.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul></div>
    </div></div>`;
  if (b.type === "flow")
    return `<div ${attrs}><div class="blk-flow">${b.items.map((x, k) => `${k ? "<i>→</i>" : ""}<span>${fmt(x)}</span>`).join("")}</div></div>`;
  if (b.type === "callout")
    return `<div ${attrs}><div class="blk-callout ${b.tone}"><span style="flex:none;margin-top:1px">${icon(BLOCK_ICON[b.tone] ?? "bulb", 14)}</span><span>${fmt(b.text)}</span></div></div>`;
  if (b.type === "table")
    return `<div ${attrs}><div class="blk-table"><table><thead><tr>${b.head.map((h) => `<th>${fmt(h)}</th>`).join("")}</tr></thead>
      <tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${fmt(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  return `<div ${attrs}><p class="blk-text">${fmt(b.text ?? "")}</p></div>`;
}

async function refreshConfig() {
  try {
    await loadConfig(true);
  } catch {
    /* the header chip is cosmetic */
  }
}
