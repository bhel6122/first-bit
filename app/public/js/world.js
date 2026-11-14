/* The freestyle entrance: a short inventory, a profile, then a course.

   Three segments of six items, so the questionnaire reads as a game beat rather
   than a form. Answers live in localStorage until the profile is saved, which
   means closing the tab mid-way does not cost the learner their progress. */

import { api, showJob, navigate, toast, esc } from "./core.js";
import {
  ITEMS, SEGMENTS, LIKERT, DIMS, TRACKS, TRACK_ORDER, EXPERIENCE, WEEKLY,
  scoreProfile, interpretation, scaleForWeekly, levelForExperience, INVENTORY_NOTE,
} from "./inventory.js";
import { sprite, hud, beep } from "./pixel.js";

const KEY = "px-inventory-v1";
export const COURSE_KEY = "px-world-course";

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
const save = (data) => localStorage.setItem(KEY, JSON.stringify(data));

let draft = { answers: {}, segment: 0, did: [], weekly: "3to6", topic: "", asked: false };

/* Set only for the current navigation: the questionnaire is a one-off door, not
   a room the learner has to walk through again every time they open the map. */
let forceIntro = false;

export async function renderWorld(app, { reset = false } = {}) {
  draft = { ...draft, ...load() };
  if (reset) forceIntro = true;

  const [player, config] = await Promise.all([
    api("/api/player").catch(() => ({})),
    api("/api/config").catch(() => ({ courses: [] })),
  ]);

  if (!forceIntro) {
    /* Already has a world course: land on its map instead of asking everything
       again — otherwise every visit would generate a duplicate course. */
    const games = (config.courses ?? []).filter((c) => c.mode !== "school" && c.track && c.confirmed);
    if (games.length) {
      const saved = localStorage.getItem(COURSE_KEY);
      const pick = games.find((c) => c.id === saved) ?? games[0];
      localStorage.setItem(COURSE_KEY, pick.id);
      app.innerHTML = `<main class="px-wrap" style="padding-top:60px"><div class="px-panel">
        <div class="px-kicker">正在进入世界</div>
        <p class="px-sub px-blink" style="margin-top:6px">接着上次的地图走：${esc(pick.title)}</p></div></main>`;
      return navigate(`/map/${encodeURIComponent(pick.id)}`);
    }
    if (player.profile?.scores) return renderResult(app, player, { saved: true });
  }

  forceIntro = false;
  renderIntro(app, player);
}

function renderIntro(app, player = {}) {
  app.innerHTML = `${hud(player, "", "兴趣问卷")}
  <main class="px-wrap" style="padding-top:28px">
    <div class="px-panel">
      <div class="px-kicker">FREELAB · 兴趣定线</div>
      <h1 class="px-title">先说你喜欢什么，<br>再决定这学期学什么。</h1>
      <p class="px-sub">十八道题，没有正确答案，只问你想不想做。答完会给你一个方向和一个角色，然后照这个方向编一门课，课学完是能看见进度的一条地图。</p>

      <div style="display:flex;gap:12px;align-items:center;margin:22px 0 6px">
        ${sprite("frontend", "idle", 56)}
        ${sprite("backend", "idle", 56)}
        ${sprite("ui", "idle", 56)}
        <div class="px-tiny" style="margin-left:6px">三个角色，对应三条线。<br>答完才知道你拿到哪个。</div>
      </div>

      <div class="px-field">
        <label>怎么走</label>
        <div class="px-sub" style="line-height:2">
          1 · 三段问卷，每段六题，中途可以退出去吃饭<br>
          2 · 得到兴趣画像和推荐方向，你可以改<br>
          3 · 选一个主题，生成课程，进入闯关地图
        </div>
      </div>

      <p class="px-tiny" style="margin-top:20px;line-height:1.8">${INVENTORY_NOTE}</p>

      <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap">
        <button class="px-btn primary" id="start">开始答题</button>
        ${draft.answers && Object.keys(draft.answers).length ? `<button class="px-btn ghost" id="resume">接着上次（已答 ${Object.keys(draft.answers).length} 题）</button>` : ""}
        <a class="px-btn ghost" href="#/">回首页</a>
      </div>
    </div>
  </main>`;

  app.querySelector("#start").onclick = () => {
    draft = { answers: {}, segment: 0, did: [], weekly: "3to6", topic: "", asked: false };
    save(draft);
    beep("tap");
    renderQuestions(app, player);
  };
  const resume = app.querySelector("#resume");
  if (resume) resume.onclick = () => renderQuestions(app, player);
}

/* ------------------------------- questions ------------------------------- */

function renderQuestions(app, player = {}) {
  const seg = Math.max(0, Math.min(2, Number(draft.segment) || 0));
  const items = ITEMS.filter((it) => it.segment === seg);
  const meta = SEGMENTS[seg];
  const done = items.every((it) => draft.answers[it.id]);

  app.innerHTML = `${hud(player, "", "兴趣问卷")}
  <main class="px-wrap" style="padding-top:22px">
    <div class="px-seg">
      ${[0, 1, 2].map((i) => `<i class="${i < seg ? "on" : i === seg ? "half" : ""}"></i>`).join("")}
    </div>
    <div class="px-kicker">${esc(meta.title)} · ${seg + 1} / 3</div>
    <h1 class="px-title" style="font-size:19px">${esc(meta.line)}</h1>

    <div id="qlist">
      ${items
        .map(
          (it) => `<div class="px-panel px-question" data-q="${it.id}">
            <div class="px-qtext">${esc(it.text)}</div>
            <div class="px-likert">
              ${LIKERT.map(
                (l) => `<button data-v="${l.v}" class="${Number(draft.answers[it.id]) === l.v ? "on" : ""}">
                  <span class="k">${l.v}</span>${esc(l.label)}
                </button>`,
              ).join("")}
            </div>
          </div>`,
        )
        .join("")}
    </div>

    <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
      ${seg > 0 ? `<button class="px-btn ghost" id="back">上一段</button>` : `<a class="px-btn ghost" href="#/">先不答了</a>`}
      <span style="flex:1"></span>
      <button class="px-btn primary" id="next" ${done ? "" : "disabled"}>${seg < 2 ? "下一段" : "最后两步"} →</button>
    </div>
    <p class="px-tiny" style="margin-top:12px">答完这一段才能继续。进度自动存，关掉页面也不丢。</p>
  </main>`;

  app.querySelectorAll("[data-q]").forEach((card) => {
    card.querySelectorAll("[data-v]").forEach((btn) => {
      btn.onclick = () => {
        draft.answers[card.dataset.q] = Number(btn.dataset.v);
        save(draft);
        card.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", b === btn));
        beep("tap");
        const complete = ITEMS.filter((it) => it.segment === seg).every((it) => draft.answers[it.id]);
        app.querySelector("#next").disabled = !complete;
      };
    });
  });

  app.querySelector("#next").onclick = () => {
    if (seg < 2) {
      draft.segment = seg + 1;
      save(draft);
      renderQuestions(app, player);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    renderSetup(app, player);
  };

  const back = app.querySelector("#back");
  if (back) back.onclick = () => {
    draft.segment = seg - 1;
    save(draft);
    renderQuestions(app, player);
  };
}

/* --------------------------- experience + time --------------------------- */

function renderSetup(app, player = {}) {
  app.innerHTML = `${hud(player, "", "兴趣问卷")}
  <main class="px-wrap" style="padding-top:22px">
    <div class="px-seg">${[0, 1, 2].map(() => `<i class="on"></i>`).join("")}</div>
    <div class="px-kicker">最后两步 · 这两题决定课多长</div>
    <h1 class="px-title" style="font-size:19px">你以前碰过这些东西吗？</h1>
    <p class="px-sub">做过就不推同一条路——那是在浪费你的时间。可以多选。</p>

    <div id="exp" style="display:grid;gap:8px;margin:16px 0 24px">
      ${EXPERIENCE.map(
        (o) => `<button class="px-topic ${draft.did.includes(o.k) ? "on" : ""}" data-k="${o.k}">
          <span style="flex:1"><span class="t">${esc(o.t)}</span><span class="w" style="display:block">${esc(o.d)}</span></span>
        </button>`,
      ).join("")}
    </div>

    <div class="px-kicker">每周能投入多久</div>
    <div class="px-quick" id="weekly" style="margin-top:10px">
      ${WEEKLY.map(
        (w) => `<button class="px-chip ${draft.weekly === w.k ? "on" : ""}" data-k="${w.k}">${esc(w.t)} · ${esc(w.d)}</button>`,
      ).join("")}
    </div>

    <div style="display:flex;gap:10px;margin-top:26px">
      <button class="px-btn ghost" id="back">上一段</button>
      <span style="flex:1"></span>
      <button class="px-btn primary" id="go">看我的方向 →</button>
    </div>
  </main>`;

  app.querySelectorAll("[data-k]").forEach((btn) => {
    if (!btn.closest("#exp")) return;
    btn.onclick = () => {
      const k = btn.dataset.k;
      if (k === "none") draft.did = ["none"];
      else draft.did = [...draft.did.filter((x) => x !== "none" && x !== k), k];
      save(draft);
      app.querySelectorAll("#exp [data-k]").forEach((b) => b.classList.toggle("on", draft.did.includes(b.dataset.k)));
      beep("tap");
    };
  });

  app.querySelectorAll("#weekly [data-k]").forEach((btn) => {
    btn.onclick = () => {
      draft.weekly = btn.dataset.k;
      save(draft);
      app.querySelectorAll("#weekly [data-k]").forEach((b) => b.classList.toggle("on", b === btn));
      beep("tap");
    };
  });

  app.querySelector("#back").onclick = () => {
    draft.segment = 2;
    save(draft);
    renderQuestions(app, player);
  };

  app.querySelector("#go").onclick = async () => {
    const profile = scoreProfile({ answers: draft.answers, did: draft.did, weekly: draft.weekly });
    draft.profile = profile;
    draft.track = profile.track;
    save(draft);
    await api("/api/player/profile", {
      method: "POST",
      body: {
        scores: profile.scores,
        fit: profile.fit,
        track: profile.track,
        mixed: profile.mixed,
        answers: { did: draft.did, weekly: draft.weekly, codes: profile.codes },
      },
    }).catch(() => {});
    beep("win");
    renderResult(app, { profile, track: profile.track, ...(await api("/api/player").catch(() => ({}))) }, { saved: false });
  };
}

/* -------------------------------- result -------------------------------- */

/* Saved profiles only carry the six scores and the three fits — the per-item
   answers are gone, so the codes are re-derived from the scores. */
function profileFromSaved(player = {}) {
  const p = player.profile ?? {};
  const scores = p.scores ?? { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  const fit = p.fit ?? {};
  const order = [...TRACK_ORDER].sort((a, b) => (fit[b] ?? 0) - (fit[a] ?? 0));
  const codes = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d);
  const track = player.track ?? order[0] ?? "frontend";
  const second = order[1];
  const mixed = (fit[track] ?? 0) - (fit[second] ?? 0) <= 10 && (fit[second] ?? 0) >= 45 ? second : null;
  return { scores, fit, order, track, mixed, codes, weekly: p.answers?.weekly ?? draft.weekly };
}

function renderResult(app, player = {}, { saved = false } = {}) {
  const profile = saved ? profileFromSaved(player) : draft.profile ?? profileFromSaved(player);
  const track = draft.track ?? player.track ?? profile.track;
  const t = TRACKS[track];
  const mixed = profile.mixed;
  // A saved profile can land here with no draft, so pin the choice before any
  // button tries to read it.
  draft = { ...draft, track, profile };

  app.innerHTML = `${hud(player, "", "兴趣问卷")}
  <main class="px-wrap wide" style="padding-top:22px">
    <div class="px-panel">
      <div class="px-kicker">你的兴趣画像 · ${saved ? "上次测的" : "刚刚测的"}</div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px;align-items:center" class="px-result-grid">
        <div>${radar(profile.scores)}</div>
        <div>
          <div class="px-codes"><span class="px-code-big">${profile.codes.join(" · ")}</span>
            <span class="px-tiny">前两码</span></div>
          <p class="px-sub" style="line-height:1.8">${esc(interpretation(profile))}</p>
        </div>
      </div>
    </div>

    <div class="px-kicker" style="margin:22px 0 8px">选一条路 · 点一下就换</div>
    <div class="px-track-grid">
      ${TRACK_ORDER.map((key) => {
        const tk = TRACKS[key];
        return `<button class="px-track ${key === track ? "on" : ""}" data-track="${key}">
          ${key === mixed ? `<span class="mixed">混合</span>` : ""}
          ${sprite(key, "idle", 56)}
          <div class="role">${tk.role}</div>
          <div class="pct">${tk.label} · 匹配 ${profile.fit[key]}%</div>
          <div class="px-tiny" style="margin-top:6px;line-height:1.6">${esc(tk.tagline)}</div>
        </button>`;
      }).join("")}
    </div>

    <div class="px-panel">
      <div class="px-kicker">这门课讲什么 · 选一个，或者让 AI 照你的画像现编</div>
      <div class="px-topics" id="topics">
        ${t.presets
          .map(
            (p, i) => `<button class="px-topic ${(draft.topic || t.presets[0].topic) === p.topic ? "on" : ""}" data-topic="${esc(p.topic)}">
              <span style="flex:1"><span class="t">${esc(p.topic)}</span><span class="w" style="display:block">${esc(p.why)}</span></span>
            </button>`,
          )
          .join("")}
        <button class="px-topic" id="ai-topic">
          <span style="flex:1"><span class="t">让 AI 按我的画像现编一个</span><span class="w" id="ai-why" style="display:block">会多花十几秒，编不出来就退回上面三个</span></span>
        </button>
      </div>

      <div class="px-field">
        <label>这门课更偏哪边</label>
        <div class="px-quick" id="focus">
          ${[
            ["concept", "把原理讲透"],
            ["practice", "多动手"],
            ["project", "做一个作品"],
          ].map(([k, label]) => `<button class="px-chip ${k === "practice" ? "on" : ""}" data-k="${k}">${label}</button>`).join("")}
        </div>
      </div>

      <div class="px-field">
        <label>学完想做到什么</label>
        <div class="px-quick" id="goal">
          ${[
            ["build", "能独立做东西"],
            ["system", "建立体系"],
            ["work", "解决手头的问题"],
          ].map(([k, label]) => `<button class="px-chip ${k === "build" ? "on" : ""}" data-k="${k}">${label}</button>`).join("")}
        </div>
      </div>

      <p class="px-tiny" style="margin-top:14px;line-height:1.8">
        按你填的每周 ${esc(WEEKLY.find((w) => w.k === draft.weekly)?.t ?? "3-6 小时")}，课程规模是「${esc(scaleLabel(scaleForWeekly(draft.weekly)))}」，地图上会有 ${scaleUnits(scaleForWeekly(draft.weekly))} 个区域。
      </p>

      <div style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap">
        <button class="px-btn primary" id="gen">生成我的课程 →</button>
        <button class="px-btn ghost" id="retake">重新测一次</button>
        <a class="px-btn ghost" href="#/">回首页</a>
      </div>
    </div>
  </main>`;

  app.querySelectorAll("[data-track]").forEach((btn) => {
    btn.onclick = () => {
      draft.track = btn.dataset.track;
      if (!draft.topic) draft.topic = TRACKS[draft.track].presets[0].topic;
      save(draft);
      beep("tap");
      renderResult(app, player, { saved });
    };
  });

  app.querySelectorAll("[data-topic]").forEach((btn) => {
    btn.onclick = () => {
      draft.topic = btn.dataset.topic;
      save(draft);
      app.querySelectorAll("[data-topic]").forEach((b) => b.classList.toggle("on", b === btn));
      beep("tap");
    };
  });

  app.querySelector("#ai-topic").onclick = async (e) => {
    const btn = e.currentTarget;
    const why = app.querySelector("#ai-why");
    why.textContent = "正在按你的画像现编…";
    btn.disabled = true;
    try {
      const res = await api("/api/game/topic", {
        method: "POST",
        body: { track: draft.track, codes: profile.codes, weekly: WEEKLY.find((w) => w.k === draft.weekly)?.t ?? "", experience: draft.did.join(",") },
      });
      if (!res.topic) throw new Error(res.reason || "没编出来");
      draft.topic = res.topic;
      save(draft);
      const node = document.createElement("button");
      node.className = "px-topic on";
      node.dataset.topic = res.topic;
      node.innerHTML = `<span style="flex:1"><span class="t">${esc(res.topic)}</span><span class="w" style="display:block">${esc(res.reason || "按你的兴趣画像现编")}</span></span>`;
      node.onclick = () => {
        draft.topic = res.topic;
        save(draft);
        app.querySelectorAll("[data-topic]").forEach((b) => b.classList.toggle("on", b === node));
      };
      app.querySelector("#topics").prepend(node);
      app.querySelectorAll("[data-topic]").forEach((b) => b.classList.toggle("on", b === node));
      why.textContent = "现编好了，不满意可以再点一次或者选上面三个";
    } catch (err) {
      why.textContent = err.message;
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };

  app.querySelector("#focus").querySelectorAll("[data-k]").forEach((b) => {
    b.onclick = () => {
      draft.focus = b.dataset.k;
      save(draft);
      app.querySelectorAll("#focus [data-k]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  app.querySelector("#goal").querySelectorAll("[data-k]").forEach((b) => {
    b.onclick = () => {
      draft.goal = b.dataset.k;
      save(draft);
      app.querySelectorAll("#goal [data-k]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });

  app.querySelector("#retake").onclick = () => {
    draft = { answers: {}, segment: 0, did: [], weekly: "3to6", topic: "", asked: false };
    save(draft);
    renderIntro(app, player);
  };

  app.querySelector("#gen").onclick = async () => {
    const topic = draft.topic || TRACKS[draft.track].presets[0].topic;
    const scale = scaleForWeekly(draft.weekly);
    const answers = {
      topic,
      level: levelForExperience(draft.did),
      focus: draft.focus ?? "practice",
      goal: draft.goal ?? "build",
      scale,
      track: draft.track,
    };

    const result = await showJob({
      title: "正在编你的课",
      sub: `方向「${TRACKS[draft.track].role}」 · ${scaleLabel(scale)}`,
      labels: ["读你的兴趣画像", "设计课程骨架", "检查讲次与前置", "写回课程库"],
      start: () => api("/api/outline", { method: "POST", body: { mode: "self", track: draft.track, answers } }),
      note: "生成需要 20-40 秒。大纲出来后可以逐条改，确认后才开始写每一讲。",
    });

    if (result?.courseId) {
      draft.asked = false;
      save(draft);
      localStorage.setItem(COURSE_KEY, result.courseId);
      await navigate(`/build/${result.courseId}`);
    }
  };
}

const scaleLabel = (s) => ({ brief: "精简入门 · 6 讲", standard: "标准学期 · 12 讲", deep: "系统深入 · 15 讲" })[s] ?? "标准学期 · 12 讲";
const scaleUnits = (s) => ({ brief: 3, standard: 4, deep: 5 })[s] ?? 4;

/* --------------------------------- radar --------------------------------- */

export function radar(scores = {}) {
  const cx = 120;
  const cy = 112;
  const R = 74;
  const order = ["R", "I", "A", "S", "E", "C"];
  const angle = (i) => ((-90 + i * 60) * Math.PI) / 180;
  const at = (i, r) => [cx + Math.cos(angle(i)) * r, cy + Math.sin(angle(i)) * r];

  const ring = (k) => order.map((_, i) => at(i, R * k).join(",")).join(" ");
  const valuePts = order.map((d, i) => at(i, Math.max(6, (Number(scores[d]) || 0) / 100 * R)).join(",")).join(" ");

  return `<svg class="px-radar" viewBox="0 0 240 232" role="img" aria-label="六维兴趣雷达图">
    ${[0.33, 0.66, 1].map((k) => `<polygon points="${ring(k)}" fill="none" stroke="#d8d2bd" stroke-width="1"/>`).join("")}
    ${order.map((_, i) => {
      const [x, y] = at(i, R);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#e5e1d2" stroke-width="1"/>`;
    }).join("")}
    <polygon points="${valuePts}" fill="rgba(29,158,117,0.20)" stroke="#1d9e75" stroke-width="2"/>
    ${order.map((d, i) => {
      const [x, y] = at(i, R + 16);
      const s = Number(scores[d]) || 0;
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-size="10" fill="#5f5e5a">${d} ${s}</text>`;
    }).join("")}
    ${order.map((d, i) => {
      const [x, y] = at(i, Math.max(6, (Number(scores[d]) || 0) / 100 * R));
      return `<rect x="${x - 2}" y="${y - 2}" width="4" height="4" fill="#1d9e75"/>`;
    }).join("")}
  </svg>`;
}
