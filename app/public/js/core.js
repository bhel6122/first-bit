import { t, langSwitch } from "./i18n.js";

/* Shared shell: state, API, icons, top bar, job overlay, quiz runner. */

export const state = {
  config: null,
  /* undefined means "not asked yet"; null means "asked, nobody is signed in".
     The router uses that difference to avoid flashing the login page at a
     returning visitor while /api/auth/me is still in flight. */
  user: undefined,
  intake: {
    step: 1,
    mode: "self",
    topic: "",
    materials: [],
    answers: {
      level: "some",
      focus: "concept",
      goal: "system",
      scale: "standard",
      /* Content language follows the UI on first load, then belongs to the learner. */
      lang: document.documentElement.lang === "en" ? "en" : "zh",
      goalText: "",
    },
  },
  course: null,
  draft: null,
  lesson: null,
};

/* ---------------------------------- api ---------------------------------- */

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON means the server died; the message below is still useful */
  }
  if (!res.ok) {
    /* The session expired or was revoked on another device. Remember it once,
       here, so every caller does not have to handle the same case. Auth routes
       are exempt: there a 401 means "wrong password", not "signed out". */
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      state.user = null;
      if (!location.hash.startsWith("#/login")) location.hash = "/login";
    }
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function loadSession(force = false) {
  if (state.user !== undefined && !force) return state.user;
  try {
    const d = await api("/api/auth/me");
    state.user = d.user ?? null;
    state.me = d.player ?? null;
  } catch {
    state.user = null;
  }
  return state.user;
}

export async function loadConfig(force = false) {
  if (state.config && !force) return state.config;
  try {
    state.config = await api("/api/config");
  } catch {
    state.config = { provider: "服务未就绪", model: { configured: false }, courses: [] };
  }
  return state.config;
}

/* -------------------------------- helpers -------------------------------- */

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmt = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="code-inline">$1</code>');

export const fmtMinutes = (n) => {
  const m = Math.max(0, Math.round(Number(n) || 0));
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`;
};

export const navigate = (path) => {
  if (location.hash === `#${path}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = path;
};

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* --------------------------------- icons --------------------------------- */

const PATHS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  spark: '<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v16H6.5A2.5 2.5 0 004 21.5z"/><path d="M4 19a2 2 0 012-2h14"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13l5-5 5 5M5 4h14"/>',
  refresh: '<path d="M4 12a8 8 0 0113.7-5.7L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.7L4 16M4 20v-4h4"/>',
  note: '<path d="M6 3h9l5 5v13H6z"/><path d="M15 3v5h5M9 12h7M9 16h5"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  school: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M6 11v6c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5.9 1.2.9 2h5.2c0-.8.3-1.5.9-2A6 6 0 0012 3z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  sound: '<path d="M4 10v4h3l4 3V7L7 10z"/><path d="M15 9.5a4 4 0 010 5M17.5 7a7 7 0 010 10"/>',
  mute: '<path d="M4 10v4h3l4 3V7L7 10z"/><path d="M15 10l4 4M19 10l-4 4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 114.2 1.9c-.8.7-1.7 1.2-1.7 2.3"/><path d="M12 17h.01"/>',
  user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6"/>',
};

export const icon = (name, size = 16, stroke = 1.7) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ""}</svg>`;

/* --------------------------------- toast --------------------------------- */

let toastTimer = null;
export function toast(message, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = `toast ${type}`;
  }, 3200);
}

/* --------------------------------- topbar --------------------------------- */

export function topbar(active = "") {
  const model = state.config?.model ?? {};
  const online = Boolean(model.configured && model.reachable);
  return `<header class="topbar">
    <a class="brand" href="#/">
      <span class="brand-mark">${icon("book", 16, 2)}</span>
      <span>first-bit<small>课程工坊</small></span>
    </a>
    <nav>
      <a href="#/" class="${active === "home" ? "active" : ""}">${esc(t("我的课程"))}</a>
      <a href="#/world" class="${active === "world" ? "active" : ""}">${esc(t("闯关地图"))}</a>
      <a href="#/create" class="${active === "create" ? "active" : ""}">${esc(t("跟课学"))}</a>
    </nav>
    <div class="topbar-right">
      <span class="provider ${online ? "" : "offline"}" title="${esc(model.model ?? "")}">
        <i></i>${online ? esc(model.model) : esc(t("演示模式 · 内置课程"))}
      </span>
      ${langSwitch()}
      ${state.user
        ? `<span class="who" title="${esc(state.user.name)}">
             <span class="who-avatar">${icon("user", 12, 1.9)}</span>
             <span class="who-name">${esc(state.user.name)}</span>
           </span>
           <button class="who-out" type="button" onclick="window.__fbSignOut()" title="退出登录">${esc(t("退出"))}</button>`
        : ""}
    </div>
  </header>`;
}

/* Signing out is a top-bar concern that every page shares, so it lives on the
   window rather than in each renderer's event list. The reload is deliberate:
   courses, notes and xp all belonged to the account that just left. */
window.__fbSignOut = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* a dead session is the same as a signed-out one */
  }
  state.user = null;
  location.hash = "/login";
  location.reload();
};

/* ------------------------------- job overlay ------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs a server job and shows a four-step progress card.
 * `start` posts whatever it needs and resolves with { jobId }.
 * Resolves null when the learner closes a failed job.
 */
export async function showJob({ title, sub, labels, start, note }) {
  const overlay = document.createElement("div");
  overlay.className = "job-overlay";
  document.body.appendChild(overlay);

  const stepsHTML = labels
    .map((label, i) => `<div class="job-step" data-i="${i}"><span class="dot"></span><span>${esc(label)}</span></div>`)
    .join("");

  overlay.innerHTML = `<div class="job-card">
    <div class="job-orb">${icon("spark", 21)}</div>
    <h3>${esc(title)}</h3>
    <p class="job-sub" data-sub>${esc(sub)}</p>
    <div class="job-bar"><i style="width:4%"></i></div>
    <div class="job-steps">${stepsHTML}</div>
    <div data-error></div>
    <p class="gen-note">${esc(note ?? "生成需要 20-40 秒。大纲和每一讲之后都可以改，不会锁死。")}</p>
    <div class="job-actions" data-actions hidden></div>
  </div>`;

  const bar = overlay.querySelector(".job-bar i");
  const subEl = overlay.querySelector("[data-sub]");
  const errEl = overlay.querySelector("[data-error]");
  const actions = overlay.querySelector("[data-actions]");
  const stepEls = [...overlay.querySelectorAll(".job-step")];

  let closed = false;
  const close = (value) => {
    closed = true;
    overlay.remove();
    return value;
  };

  const paint = (pct, label) => {
    bar.style.width = `${clamp(pct, 4, 100)}%`;
    if (label) subEl.textContent = label;
    const active = clamp(Math.floor((pct / 100) * labels.length), 0, labels.length - 1);
    stepEls.forEach((el, i) => {
      el.classList.toggle("done", i < active || pct >= 100);
      el.classList.toggle("active", i === active && pct < 100);
      el.querySelector(".dot").innerHTML = i < active || pct >= 100 ? icon("check", 9, 3) : "";
    });
  };

  const fail = (message) => {
    errEl.innerHTML = `<div class="job-error">${esc(message)}</div>`;
    actions.hidden = false;
    actions.innerHTML = `<button class="btn btn-primary btn-sm" data-retry>再试一次</button><button class="btn btn-ghost btn-sm" data-close>先回去</button>`;
    actions.querySelector("[data-retry]").onclick = () => {
      errEl.innerHTML = "";
      actions.hidden = true;
      stepsHTML && stepEls.forEach((el) => el.classList.remove("done", "active"));
      run();
    };
    actions.querySelector("[data-close]").onclick = () => close(null);
  };

  const run = async () => {
    paint(4, "把请求发给课程设计师");
    try {
      const { jobId } = await start();
      if (!jobId) {
        return close({ cached: true });
      }
      const deadline = Date.now() + 5 * 60 * 1000;
      while (!closed && Date.now() < deadline) {
        await sleep(1000);
        if (closed) return null;
        let job;
        try {
          job = await api(`/api/jobs/${jobId}`);
        } catch (e) {
          fail(e.message);
          return null;
        }
        paint(job.pct ?? 5, job.label);
        if (job.state === "done") {
          paint(100, "完成");
          await sleep(420);
          return close(job.result ?? {});
        }
        if (job.state === "error") {
          fail(job.error || "生成失败");
          return null;
        }
      }
      fail("等了太久，任务可能卡住了。可以再试一次。");
      return null;
    } catch (e) {
      fail(e.message);
      return null;
    }
  };

  return run();
}

/* --------------------------------- modal --------------------------------- */

export function modal(html) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  return overlay;
}

/* ---------------------------------- quiz ---------------------------------- */

/**
 * One quiz runner for both lesson checks and unit tests.
 * answer(q, index) -> { correct, correctIndex, explain, page }
 * assist(q) -> { answer, page }   (optional, "让助教讲讲")
 * finish(score, total, close) -> { heading, detail, actions:[{label, primary, onClick}] }
 */
export function openQuiz({ title, kicker, questions, answer, assist, onJump, finish, onClose }) {
  let i = 0;
  let score = 0;
  let busy = false;

  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  document.body.appendChild(overlay);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  document.addEventListener("keydown", onKey);

  const shell = (inner) => {
    overlay.innerHTML = `<div class="modal">${inner}</div>`;
  };

  const head = (q, idx) => `<div class="modal-head">
    <div>
      <div class="eyebrow">${esc(kicker ?? "练习")}</div>
      <h3>${esc(title ?? "检查一下")}</h3>
    </div>
    <span class="spacer"></span>
    <span class="tiny muted">${idx + 1} / ${questions.length}</span>
    <div class="quiz-progress">${questions
      .map((x, k) => `<i class="${k === i ? "on" : x._res ? (x._res.correct ? "ok" : "") : ""}"></i>`)
      .join("")}</div>
    <button class="icon-btn" data-close>${icon("close", 16)}</button>
  </div>`;

  function renderQuestion() {
    const q = questions[i];
    const res = q._res;
    const letters = ["A", "B", "C", "D"];

    shell(`${head(q, i)}
      <p class="quiz-q">${fmt(q.q)}</p>
      <div data-options>${q.options
        .map((text, k) => {
          let cls = "quiz-option";
          if (res) {
            if (k === res.correctIndex) cls += " correct";
            else if (k === q._selected) cls += " wrong";
            else cls += " dim";
          }
          return `<button class="${cls}" data-opt="${k}" ${res ? "disabled" : ""}>
            <span class="key">${res && k === res.correctIndex ? icon("check", 12, 3) : letters[k] ?? k + 1}</span>
            <span>${fmt(text)}</span>
          </button>`;
        })
        .join("")}</div>
      ${res
        ? `<div class="quiz-feedback ${res.correct ? "good" : "bad"}">
             <b>${res.correct ? "答对了" : "这里容易想岔"}</b>
             ${fmt(res.explain || "")}
             ${!res.correct && onJump && res.page ? `<div><button class="btn btn-ghost btn-sm" data-jump style="margin-top:9px">${icon("back", 13)} 回到第 ${res.page} 页</button></div>` : ""}
           </div>`
        : `<div class="quiz-assistant">
             <button class="btn btn-quiet btn-sm" data-hint>${icon("bulb", 14)} 不会，让助教提示一下</button>
             <div data-hint-body></div>
           </div>`}
      <div class="quiz-actions">
        <span class="tiny muted">${res ? (res.correct ? "继续，下一题会稍难一点。" : "先弄懂，再往下走。") : "选一个最接近你想法的答案。"}</span>
        <span class="spacer"></span>
        ${i > 0 ? `<button class="btn btn-quiet btn-sm" data-prev>上一题</button>` : ""}
        <button class="btn btn-primary" data-next ${res ? "" : "disabled"}>${i === questions.length - 1 ? "查看结果" : "下一题"} ${icon("arrow", 14)}</button>
      </div>`);

    overlay.querySelector("[data-close]").onclick = close;
    overlay.querySelectorAll("[data-opt]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        const k = Number(btn.dataset.opt);
        q._selected = k;
        try {
          const res = await answer(q, k);
          q._res = res;
          if (res.correct) score++;
          renderQuestion();
        } catch (e) {
          toast(e.message, "error");
        } finally {
          busy = false;
        }
      };
    });

    overlay.querySelector("[data-next]").onclick = async () => {
      if (i < questions.length - 1) {
        i++;
        renderQuestion();
        return;
      }
      showResult();
    };

    const prev = overlay.querySelector("[data-prev]");
    if (prev) prev.onclick = () => {
      i = Math.max(0, i - 1);
      renderQuestion();
    };

    const jump = overlay.querySelector("[data-jump]");
    if (jump) jump.onclick = () => {
      const page = q._res?.page;
      close();
      onJump(q, page);
    };

    const hint = overlay.querySelector("[data-hint]");
    if (hint) hint.onclick = async () => {
      if (busy) return;
      busy = true;
      const body = overlay.querySelector("[data-hint-body]");
      hint.innerHTML = "助教正在看这道题…";
      try {
        const res = await assist(q);
        body.innerHTML = `<div class="assistant-answer">${fmt(res.answer)}${res.page ? ` <button class="btn btn-quiet btn-sm" data-hint-jump style="margin-top:6px">看第 ${res.page} 页</button>` : ""}</div>`;
        hint.style.display = "none";
        const hj = body.querySelector("[data-hint-jump]");
        if (hj) hj.onclick = () => {
          close();
          onJump?.(q, res.page);
        };
      } catch (e) {
        body.innerHTML = `<div class="assistant-answer">${esc(e.message)}</div>`;
        hint.style.display = "none";
      } finally {
        busy = false;
      }
    };
  }

  async function showResult() {
    const total = questions.length;
    const pct = total ? score / total : 0;
    const fallback = {
      heading: pct === 1 ? "这一讲讲透了" : pct >= 0.66 ? "基本掌握了" : "还有几个点要回看",
      detail:
        pct === 1
          ? "全部正确。可以进入下一讲，或者把板书导出成笔记。"
          : pct >= 0.66
            ? "大部分理解到位。错的那道题对应的板书值得再看一遍。"
            : "建议回到讲错的那一页重新听一遍，再来做一次。",
      actions: [{ label: "关闭", primary: true, onClick: close }],
    };
    let custom = fallback;
    if (finish) {
      try {
        custom = (await finish(score, total, close)) ?? fallback;
      } catch {
        custom = fallback;
      }
    }
    const actions = (custom.actions ?? fallback.actions)
      .map((a, k) => `<button class="btn ${a.primary ? "btn-primary" : "btn-ghost"}" data-act="${k}">${esc(a.label)}</button>`)
      .join("");

    shell(`<div class="result-card">
      <div class="eyebrow">${esc(kicker ?? "练习")}</div>
      <div class="result-score">${score}<small> / ${total}</small></div>
      <h3>${esc(custom.heading ?? fallback.heading)}</h3>
      <p>${fmt(custom.detail ?? fallback.detail)}</p>
      <div class="quiz-actions" style="justify-content:center;margin-top:20px">${actions}</div>
    </div>`);

    overlay.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = () => {
        const a = (custom.actions ?? fallback.actions)[Number(btn.dataset.act)];
        if (!a) return;
        if (a.close !== false) close();
        a.onClick?.(close);
      };
    });
  }

  renderQuestion();
}

/* ------------------------------ misc helpers ------------------------------ */

export const unitKicker = (unitIndex) => `UNIT ${String(unitIndex + 1).padStart(2, "0")}`;

export const download = (filename, text, mime = "text/markdown;charset=utf-8") => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`读不了 ${file.name}`));
    reader.readAsText(file);
  });
