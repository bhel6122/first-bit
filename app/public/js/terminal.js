/* The fault terminal: one broken line, real execution, real test results.

   The code runs in a Web Worker built from a blob, so a runaway loop dies with
   terminate() and the page never freezes. The server already proved this puzzle
   is solvable before it was cached; what happens here is the learner proving it
   to themselves. */

import { api, toast, esc } from "./core.js";
import { hud, sprite, beep, stars } from "./pixel.js";
import { tutorDock } from "./tutor.js";

const MAX_TRIES = 5;

let T = null;

export async function renderTerminal(app, courseId, unitId) {
  const player = await api("/api/player").catch(() => ({}));
  let course;
  try {
    course = (await api(`/api/course/${courseId}`)).course;
  } catch (e) {
    app.innerHTML = shellError(e.message);
    return;
  }
  const unit = (course.units ?? []).find((u) => u.id === unitId);
  const track = course.track ?? "frontend";

  app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
    <div class="px-kicker">故障终端 · ${esc(unit?.title ?? "")}</div>
    <p class="px-sub px-blink" style="margin-top:10px">终端自检中，正在读这一区域的代码…</p>
    <p class="px-tiny" style="margin-top:8px">第一次进来要现出一道题，大约十几秒。</p></div></main>`;

  let payload;
  try {
    payload = await api(`/api/course/${encodeURIComponent(courseId)}/terminal/${encodeURIComponent(unitId)}`);
  } catch (e) {
    app.innerHTML = shellError(e.message);
    return;
  }

  T = {
    courseId, unitId, track, player,
    bug: payload.bug, unitTitle: unit?.title ?? "",
    tries: 0, solved: Boolean(payload.progress?.solved), code: payload.bug.code, mode: "edit",
  };

  render(app);
  attachTutor();
}

/* The tutor gets the whole fault: the scene, the code, the line he is about to
   edit and the test cases printed on screen. Handing over the fixed line would
   end the level, so the prompt forbids it. */
function attachTutor() {
  tutorDock({
    courseId: T.courseId,
    unitId: T.unitId,
    mode: "answer",
    intro: "我是这一关的导师。把你不确定的地方发我——我会先告诉你这一行/这条用例在验什么，改法你自己写。",
    focus: () => {
      const b = T.bug ?? {};
      if (b.kind === "pick") {
        return [
          `场景：${b.scene ?? ""}`,
          `问题：${b.question ?? ""}`,
          (b.options ?? []).map((o, i) => `${"ABCD"[i] ?? i + 1}. ${o}`).join("\n"),
          "这是设计走查选择题。",
        ].join("\n");
      }
      const lines = String(b.code ?? "").split("\n").length;
      return [
        `场景：${b.scene ?? ""}`,
        `代码 ${lines} 行，第 ${b.brokenLine ?? "?"} 行写错了，只能改这一行：`,
        String(b.code ?? ""),
        `他当前的改法：${T.fixDraft ? T.fixDraft : "（还没动）"}`,
        `测试用例：\n${(b.tests ?? []).map((t, i) => `${i + 1}. ${t.call} → ${JSON.stringify(t.value)}`).join("\n")}`,
        `已经运行 ${T.tries} 次。`,
      ].join("\n");
    },
  });
}

const shellError = (msg) => `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
  <div class="px-kicker">终端没启动</div><p class="px-sub">${esc(msg)}</p>
  <a class="px-btn" href="#/" style="margin-top:12px">回首页</a></div></main>`;

function render(app) {
  const b = T.bug;
  const lines = String(b.code ?? "").split("\n");
  const badLine = Number(b.brokenLine) || 0;

  if (b.kind === "pick") return renderPick(app);

  app.innerHTML = `${hud(T.player, `<span class="px-tiny">${esc(T.unitTitle)}</span>`)}
  <main class="px-wrap" style="padding-top:18px">
    <div class="px-panel">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="px-kicker">故障终端</span>
        <span class="spacer" style="flex:1"></span>
        <span class="px-tiny">剩余尝试 ${Math.max(0, MAX_TRIES - T.tries)} / ${MAX_TRIES}</span>
      </div>
      <p class="px-sub" style="margin:10px 0 12px">${esc(b.scene ?? "")}</p>

      <div class="px-code">
        ${lines
          .map((text, i) => {
            const no = i + 1;
            const cls = T.solved && no === badLine ? "ln good" : no === badLine ? "ln bad" : "ln";
            return `<div class="${cls}"><span class="no">${no}</span><span>${esc(text) || " "}</span></div>`;
          })
          .join("")}
      </div>

      <div style="margin-top:14px">
        <label class="px-tiny" style="display:block;margin-bottom:6px">把第 ${badLine} 行改成</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="px-input" id="fix" style="flex:1;min-width:220px" value="${esc(T.fixDraft ?? lines[badLine - 1] ?? "")}" spellcheck="false">
          <button class="px-btn primary" id="run">运行</button>
        </div>
        <p class="px-tiny" style="margin-top:8px">按 Ctrl+Enter 也能跑。只改这一行，别动别的。</p>
      </div>

      <div class="px-tests" id="tests"></div>
      <div id="verdict"></div>
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap">
        <a class="px-btn ghost sm" href="#/map/${encodeURIComponent(T.courseId)}">回地图</a>
        <span style="flex:1"></span>
        <button class="px-btn ghost sm" id="hint">要个提示</button>
      </div>
      <div id="hint-body"></div>
    </div>
  </main>`;

  /* Show the contract before the first run: "修好" means these exact calls
     returning these exact values, and hiding them until afterwards would make
     the first attempt a guess. */
  const testBox = app.querySelector("#tests");
  if (testBox) {
    testBox.innerHTML = (b.tests ?? [])
      .map((t, i) => `<span class="px-test ${T.solved ? "ok" : ""}">用例 ${i + 1} · ${esc(String(t.call).slice(0, 46))} → ${esc(JSON.stringify(t.value))}</span>`)
      .join("");
  }

  const input = app.querySelector("#fix");
  input.onkeydown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(app);
    T.fixDraft = input.value;
  };
  input.oninput = () => (T.fixDraft = input.value);
  app.querySelector("#run").onclick = () => {
    T.fixDraft = input.value;
    run(app);
  };
  app.querySelector("#hint").onclick = () => {
    const body = app.querySelector("#hint-body");
    body.innerHTML = `<div class="px-feedback" style="margin-top:10px"><b>提示</b><div style="margin-top:4px">${esc(b.hint || "看看这一行在判断什么，你写的是不是它想表达的意思。")}</div></div>`;
    app.querySelector("#hint").disabled = true;
  };
}

/* ------------------------------- execution ------------------------------- */

function patchedCode() {
  const lines = String(T.bug.code ?? "").split("\n");
  const i = (Number(T.bug.brokenLine) || 0) - 1;
  const original = lines[i] ?? "";
  const indent = (original.match(/^\s*/) ?? [""])[0];
  const value = String(T.fixDraft ?? "").trim();
  const replacement = /^\s/.test(String(T.fixDraft ?? "")) ? String(T.fixDraft) : indent + value;
  lines[i] = replacement;
  return lines.join("\n");
}

const plain = (v) => {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
};

const WORKER_SRC = `function plain(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return String(v); } }
self.onmessage = function (e) {
  var code = e.data.code, tests = e.data.tests, out = [];
  for (var i = 0; i < tests.length; i++) {
    try {
      var fn = new Function(code + "\\n;return (" + tests[i].call + ");");
      out.push({ value: plain(fn()) });
    } catch (err) {
      out.push({ error: String((err && err.message) || err) });
    }
  }
  self.postMessage(out);
};`;

function runTests(code, tests) {
  /* No Worker (old browser, or a test harness) — run inline. The catch is that a
     runaway loop can freeze the tab, so this path is only the fallback. */
  if (typeof Worker === "undefined") {
    return Promise.resolve(
      tests.map((t) => {
        try {
          const fn = new Function(`${code}\n;return (${t.call});`);
          return { value: plain(fn()) };
        } catch (err) {
          return { error: String(err?.message ?? err) };
        }
      }),
    );
  }

  return new Promise((resolve) => {
    let worker;
    let url;
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
      worker = new Worker(url);
    } catch (e) {
      resolve(tests.map(() => ({ error: "这个浏览器跑不了 Worker" })));
      return;
    }

    const timer = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(tests.map(() => ({ error: "跑太久了，可能是死循环" })));
    }, 1200);

    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(e.data ?? []);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(tests.map(() => ({ error: "代码没能解析" })));
    };
    worker.postMessage({ code, tests });
  });
}

const same = (a, b) => {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

async function run(app) {
  const btn = app.querySelector("#run");
  btn.disabled = true;
  const tests = T.bug.tests ?? [];
  const results = await runTests(patchedCode(), tests);
  btn.disabled = false;
  T.tries += 1;

  const passed = results.every((r, i) => !r.error && same(r.value, tests[i].value));
  app.querySelector("#tests").innerHTML = results
    .map((r, i) => {
      const ok = !r.error && same(r.value, tests[i].value);
      const detail = r.error ? `出错：${esc(r.error).slice(0, 40)}` : ok ? `通过` : `期望 ${JSON.stringify(tests[i].value)}，实际 ${JSON.stringify(r.value)}`;
      return `<span class="px-test ${ok ? "ok" : "bad"}">用例 ${i + 1} ${ok ? "✓" : "✗"} · ${detail}</span>`;
    })
    .join("");

  if (passed) {
    beep("win");
    T.solved = true;
    app.querySelector("#verdict").innerHTML = `<div class="px-feedback good" style="margin-top:12px">
      <b>全绿了。</b><div style="margin-top:4px">${esc(T.bug.why ?? "改对了。")}</div></div>`;
    await settle(app, true);
    render(app);
    return;
  }

  beep("bad");
  app.querySelector(".px-code")?.classList.add("px-shake");
  const triesLeft = MAX_TRIES - T.tries;
  let note = `还不对。${triesLeft > 0 ? `还能试 ${triesLeft} 次。` : ""}`;
  if (T.tries === 3 && T.bug.hint) note += `<div style="margin-top:4px">提示：${esc(T.bug.hint)}</div>`;
  if (triesLeft <= 0) {
    T.fixDraft = T.bug.fix;
    note = `<div style="margin-top:4px">答案贴进去了：<code>${esc(T.bug.fix)}</code>。点一下运行，这一关算过。</div>`;
    app.querySelector("#fix").value = T.bug.fix;
  }
  app.querySelector("#verdict").innerHTML = `<div class="px-feedback bad" style="margin-top:12px"><b>用例没过</b><div>${note}</div></div>`;
}

/* --------------------------------- pick --------------------------------- */

function renderPick(app) {
  const b = T.bug;
  app.innerHTML = `${hud(T.player, `<span class="px-tiny">${esc(T.unitTitle)}</span>`)}
  <main class="px-wrap" style="padding-top:18px">
    <div class="px-panel">
      <div class="px-kicker">故障终端 · 设计走查</div>
      <p class="px-sub" style="margin:10px 0 12px">${esc(b.scene ?? "")}</p>
      ${b.code ? `<div class="px-code">${String(b.code).split("\n").map((t, i) => `<div class="ln"><span class="no">${i + 1}</span><span>${esc(t) || " "}</span></div>`).join("")}</div>` : ""}
      <p class="px-qtext" style="font-size:15px;margin:14px 0 0">${esc(b.question ?? "")}</p>
      <div class="px-options" id="opts">
        ${(b.options ?? []).map((o, i) => `<button class="px-opt" data-o="${i}"><span class="k">${"ABCD"[i] ?? i + 1}</span><span>${esc(o)}</span></button>`).join("")}
      </div>
      <div id="verdict"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <a class="px-btn ghost sm" href="#/map/${encodeURIComponent(T.courseId)}">回地图</a>
      </div>
    </div>
  </main>`;

  app.querySelectorAll("[data-o]").forEach((btn) => {
    btn.onclick = async () => {
      const i = Number(btn.dataset.o);
      const ok = i === Number(b.answer);
      app.querySelectorAll("[data-o]").forEach((x, k) => {
        x.disabled = true;
        if (k === Number(b.answer)) x.classList.add("correct");
        else if (k === i && !ok) x.classList.add("wrong");
      });
      beep(ok ? "ok" : "bad");
      app.querySelector("#verdict").innerHTML = `<div class="px-feedback ${ok ? "good" : "bad"}" style="margin-top:12px">
        <b>${ok ? "看对了" : "不是这处"}</b><div style="margin-top:4px">${esc(b.why ?? "")}</div></div>`;
      await settle(app, ok);
    };
  });
}

/* -------------------------------- settle -------------------------------- */

async function settle(app, solved) {
  try {
    const out = await api(`/api/course/${encodeURIComponent(T.courseId)}/terminal/${encodeURIComponent(T.unitId)}`, {
      method: "POST",
      body: { solved, attempts: T.tries || 1 },
    });
    const back = document.createElement("div");
    back.className = "px-modal-back";
    back.innerHTML = `<div class="px-modal">
      <div class="px-kicker">${solved ? "终端恢复" : "还没修好"}</div>
      <h2 class="px-title" style="margin-top:8px">${solved ? (T.tries <= 1 ? "一次就修好了。" : `修好了，用了 ${T.tries} 次。`) : "再想想这一行在做什么。"}</h2>
      <div style="display:flex;gap:12px;align-items:center;margin:8px 0">
        ${sprite(T.track, solved ? "up" : "idle", 52)}
        <div class="px-stars" style="font-size:18px">${stars(solved ? 3 : 0)}</div>
      </div>
      <div class="px-result-xp">
        ${solved ? `<span>+${out.xp ?? 0} XP · 当前 LV.${out.player?.level ?? T.player?.level ?? 1}</span>` : `<span>失败不扣经验，可以再试。</span>`}
      </div>
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        ${solved ? "" : `<button class="px-btn primary" id="again">再试一次</button>`}
        <a class="px-btn ${solved ? "primary" : "ghost"}" href="#/map/${encodeURIComponent(T.courseId)}">回地图</a>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.querySelector("#again")?.addEventListener("click", () => {
      back.remove();
      if (T.bug.kind === "pick") {
        render(app);
        return;
      }
      T.tries = 0;
      T.fixDraft = null;
      render(app);
      back.remove();
    });
  } catch (e) {
    toast(e.message, "error");
  }
}
