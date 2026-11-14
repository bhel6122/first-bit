/* Home, the four-step intake, and the editable blueprint. */

import {
  state, api, loadConfig, esc, fmtMinutes, navigate, icon, toast, topbar,
  showJob, readFileAsText, modal, fmt,
} from "./core.js";
import { t } from "./i18n.js";

/* ---------------------------------- home ---------------------------------- */

const EXAMPLES = [
  "用 6 周搞懂 HTTP 缓存",
  "线性代数：从直觉到计算",
  "SQL 从会写到会优化",
  "博弈论入门：看懂策略",
];

export async function renderHome(app) {
  await loadConfig();
  const c = state.config;
  const online = c?.model?.configured && c?.model?.reachable;
  const courses = c?.courses ?? [];
  const intake = state.intake;

  app.innerHTML = `${topbar("home")}
  <main class="desk">
    <section class="desk-left">
      <div class="desk-kicker">FIRST-BIT · 点题单</div>
      <h1 class="desk-title">让学习的开始<br>不再犹豫</h1>
      <p class="desk-note">不必再花时间挑选学习路线，只需要输入学习主题，即刻为你生成可行的学习路线和课程。让学习不再停留在“不知从何做起”这一步。</p>

      <div class="modes" role="tablist">
        <button data-mode="self" class="${intake.mode === "self" ? "active" : ""}">${icon("compass", 14)} 自由学</button>
        <button data-mode="school" class="${intake.mode === "school" ? "active" : ""}">${icon("school", 14)} 跟课学</button>
      </div>

      ${intake.mode === "self" ? `<div class="brief" id="game-entry">
        <div class="brief-label">自由学 · 闯关地图</div>
        <p style="font-size:13.5px;line-height:1.85;color:var(--muted);margin-bottom:14px">
          想学软件开发但不知道学什么？先答 18 道兴趣题，然后找到你的专属探险路线吧！
        </p>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn btn-primary" id="to-world">进入闯关世界 ${icon("arrow", 15)}</button>
        </div>
        <p class="tiny" style="color:var(--faint);margin-top:6px">约 3 分钟问卷 · 结果可以改</p>
      </div>` : ""}

      <form class="brief" id="composer" ${intake.mode === "self" ? 'style="display:none"' : ""}>
        <label class="brief-label" for="topic-input">${intake.mode === "school" ? "要跟的课" : "想学的主题"}</label>
        <input id="topic-input" autocomplete="off" maxlength="80"
          placeholder="${intake.mode === "school" ? "课程名，例如：高等数学（上）" : "例如：用 6 周搞懂 HTTP 缓存"}"
          value="${esc(intake.topic)}">

        <div class="brief-row">
          <button class="btn btn-quiet btn-sm" type="button" id="toggle-upload">${icon("upload", 14)} ${intake.mode === "school" ? "添加学校材料" : "附上资料"}</button>
          <span class="brief-hint">${intake.mode === "school" ? "大纲 / 课件 / 作业" : "没有也行，从零搭"}</span>
        </div>

        <div class="upload-mini ${intake.mode === "school" ? "show" : ""}" id="upload-mini">
          <div class="dropzone" id="dropzone">
            ${icon("upload", 20)}
            <div style="margin-top:6px"><b>把大纲 / 课件拖到这里</b>，或点击选择文件</div>
            <div class="tiny" style="margin-top:4px">支持 txt · md · html · csv · PDF；PPT 请复制文字粘贴</div>
          </div>
          <input type="file" id="file-input" multiple accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.pdf" hidden>
          <div class="file-pills" id="file-pills"></div>
        </div>

        <button class="btn btn-primary brief-submit" type="submit">起草这门课 ${icon("arrow", 15)}</button>
      </form>

      ${intake.mode === "school"
        ? `<div class="examples">
        ${EXAMPLES.map((x) => `<button class="example-chip" data-example="${esc(x)}">${esc(x)}</button>`).join("")}
      </div>`
        : `<p class="tiny" style="color:var(--faint);margin-top:14px">已经有想学的主题，也可以从书架里接着上次的课往下学。</p>`}
    </section>

    <section class="desk-right">
      <header class="shelf-head">
        <div>
          <h2>课程书架</h2>
          <p>${courses.length ? `${courses.length} 门 · 接着上次的地方往下学` : "还是空的。左边点一个题就能开课。"}</p>
        </div>
        ${courses.length ? `<a class="btn btn-ghost btn-sm" href="#/create">${icon("plus", 14)} 新建</a>` : ""}
      </header>

      <div class="shelf">
        ${courses.length ? courses.map(shelfRow).join("") : `<div class="shelf-empty">还没有课程。<br>在左边写下一个主题，四步就能开始。</div>`}
      </div>

      <footer class="desk-meta">
        <span class="dot ${online ? "on" : ""}"></span>
        <span>${online ? `模型 ${esc(c.model.model)} · 一份草案约 20-40 秒` : "演示模式：内置课程可完整体验，接上 API Key 就能生成自己的课"}</span>
      </footer>
    </section>
  </main>`;

  paintFilePills();

  app.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      state.intake.mode = btn.dataset.mode;
      renderHome(app);
    };
  });

  const toWorld = app.querySelector("#to-world");
  if (toWorld) toWorld.onclick = () => navigate("/world");

  app.querySelector("#toggle-upload").onclick = () => app.querySelector("#upload-mini").classList.toggle("show");

  const fileInput = app.querySelector("#file-input");
  const drop = app.querySelector("#dropzone");
  app.querySelector("#toggle-upload").addEventListener("click", () => {});
  drop.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    await addFiles([...fileInput.files]);
    fileInput.value = "";
  };
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("hot");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("hot");
    }),
  );
  drop.addEventListener("drop", async (e) => {
    await addFiles([...e.dataTransfer.files]);
  });

  app.querySelector("#composer").onsubmit = (e) => {
    e.preventDefault();
    const topic = app.querySelector("#topic-input").value.trim();
    if (topic.length < 2) {
      toast("先写一个想学的主题，两个字以上。", "error");
      app.querySelector("#topic-input").focus();
      return;
    }
    state.intake.topic = topic;
    state.intake.step = 2;
    navigate("/create");
  };

  app.querySelectorAll("[data-example]").forEach((btn) => {
    btn.onclick = () => {
      state.intake.topic = btn.dataset.example;
      state.intake.mode = "self";
      state.intake.step = 2;
      navigate("/create");
    };
  });
}

function shelfRow(c, i) {
  const badge = !c.confirmed
    ? `<span class="tag tag-draft">草案 · 待确认</span>`
    : c.demo ? `<span class="tag">示例</span>` : "";
  const mode = c.mode === "school" ? "跟课学" : "自由学";
  const meta = !c.confirmed
    ? `${mode} · ${c.stats.lessons} 讲 · 大纲已生成，还没确认`
    : `${mode} · ${c.stats.done}/${c.stats.lessons} 讲 · ${c.progress}%`;
  return `<a class="shelf-row${c.confirmed ? "" : " draft"}" href="#/${c.confirmed ? "course" : "build"}/${c.id}">
    <span class="row-no">${String(i + 1).padStart(2, "0")}</span>
    <span class="row-main">
      <span class="row-title">${esc(c.title)}</span>
      <span class="row-sub">${esc(c.subtitle || c.promise || "")}</span>
      <span class="row-meta">${meta} ${badge}</span>
    </span>
    <span class="row-gauge">
      <span class="row-pct">${c.confirmed ? c.progress + "%" : "—"}</span>
      <span class="row-bar"><i style="width:${c.confirmed ? c.progress : 0}%"></i></span>
    </span>
    <span class="row-arrow">${icon("arrow", 15)}</span>
  </a>`;
}

/* PDFs are parsed on the server (pdfjs); the file itself is posted raw. */
async function extractPdf(file) {
  const res = await fetch(`/api/pdf-text?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: file,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* server died mid-upload; fall through to the generic message */
  }
  if (!res.ok) throw new Error(data.error || `解析 ${file.name} 失败`);
  return data;
}

async function addFiles(files) {
  const accepted = /\.(txt|md|markdown|html?|csv|json|pdf)$/i;
  for (const f of files.slice(0, 5)) {
    if (!accepted.test(f.name)) {
      toast(`${f.name} 暂时读不了，请转成 txt / md / PDF，或直接粘贴文字。`, "error");
      continue;
    }
    try {
      let text;
      if (/\.pdf$/i.test(f.name)) {
        const d = await extractPdf(f);
        text = d.text;
        toast(`${f.name} 已解析：${d.pages} 页，约 ${Math.round(d.chars / 1000)}k 字`);
      } else {
        text = (await readFileAsText(f)).slice(0, 120_000);
      }
      if (text.trim().length < 10) {
        toast(`${f.name} 里没有可读文字。`, "error");
        continue;
      }
      state.intake.materials = [
        ...state.intake.materials.filter((m) => m.name !== f.name),
        { name: f.name, text },
      ].slice(0, 5);
    } catch (e) {
      toast(e.message, "error");
    }
  }
  await loadConfig(false);
  const pills = document.getElementById("file-pills");
  paintFilePills(pills);
}

function paintFilePills(el = document.getElementById("file-pills")) {
  if (!el) return;
  el.innerHTML = state.intake.materials
    .map(
      (m, i) => {
        const size = m.text.length >= 1000 ? `${Math.round(m.text.length / 1000)}k 字` : `${m.text.length} 字`;
        return `<span class="file-pill">${icon("file", 13)} ${esc(m.name)}
        <span class="tiny muted">${size}</span>
        <button data-rm-file="${i}" title="移除">×</button></span>`;
      },
    )
    .join("");
  el.querySelectorAll("[data-rm-file]").forEach((btn) => {
    btn.onclick = () => {
      state.intake.materials.splice(Number(btn.dataset.rmFile), 1);
      paintFilePills();
    };
  });
}

/* --------------------------------- create --------------------------------- */

/* Every descriptor states something a learner could check against their own
   experience ("did I ever finish one alone?") instead of a feeling ("一用就卡住").
   The earlier copy mixed the learner's level with the course's promise, which
   made two options true at once and left the choice to vibes. */
const LEVEL_OPTS = [
  { k: "beginner", t: "完全零基础", d: "没学过这门课，也没做过相关练习" },
  { k: "some", t: "看过，没练过", d: "读过教材或文章，没独立做完过一道题" },
  { k: "guided", t: "跟着能做，独立卡住", d: "照示例能走完，离开示例写不出下一步" },
  { k: "independent", t: "独立做完整过", d: "自己完成过一个作品，但说不清边界情况" },
  { k: "gap", t: "只差几个点", d: "能说出具体卡住的是哪 1-3 个知识点" },
];

const FOCUS_OPTS = [
  { k: "concept", t: "讲透原理", d: "每个结论都给推导，练习以解释为主" },
  { k: "practice", t: "动手实战", d: "每讲都有要写的代码，讲完就能跑起来" },
  { k: "exam", t: "考试导向", d: "按考点排序，配真题和易错点" },
  { k: "project", t: "项目作品", d: "全课围绕一个作品，每讲加一块" },
];

const GOAL_OPTS = [
  { k: "build", t: "从零做出一个作品", d: "结课时能从空目录做出能跑的东西" },
  { k: "system", t: "能讲清整门课", d: "结课时能不看资料画出这门课的概念图" },
  { k: "exam", t: "考试拿分", d: "结课时能限时做完一套真题并达标" },
  { k: "work", t: "解决手上的问题", d: "结课时能处理你带来的那个具体问题" },
];

const SCALE_OPTS = [
  { k: "brief", t: "精简入门", d: "3 单元 · 6 讲 · 约 2 小时" },
  { k: "standard", t: "标准学期", d: "4 单元 · 12 讲 · 约 3 小时" },
  { k: "deep", t: "系统深入", d: "5 单元 · 15 讲 · 约 5 小时" },
];

/* Course content language is a property of the course, not of the interface: an
   English reader may still want a Chinese course, and a Chinese reader may be
   building material for someone else. So it is asked here, once, at creation. */
const LANG_OPTS = [
  { k: "zh", t: "中文", d: "板书、讲解和题目都用中文" },
  { k: "en", t: "English", d: "Board, narration and questions in English" },
];

export async function renderCreate(app) {
  await loadConfig();
  const intake = state.intake;
  // Freestyle lives on the map now; this page is the syllabus-driven flow only.
  if (intake.mode === "self") intake.mode = "school";
  const step = intake.step === 2 ? 2 : 1;

  app.innerHTML = `${topbar("create")}
  <main class="page narrow">
    <div class="steps">
      <span class="step ${step === 1 ? "active" : "done"}"><b>${step === 1 ? 1 : icon("check", 10, 3)}</b>选择模式</span>
      <span class="step-sep"></span>
      <span class="step ${step === 2 ? "active" : ""}"><b>2</b>你的情况</span>
      <span class="step-sep"></span>
      <span class="step"><b>3</b>修改大纲</span>
      <span class="step-sep"></span>
      <span class="step"><b>4</b>开始学习</span>
    </div>

    ${step === 1 ? stepOne(intake) : stepTwo(intake)}
  </main>`;

  if (step === 1) bindStepOne(app);
  else bindStepTwo(app);
}

function stepOne(intake) {
  return `<div class="form-head">
    <div class="eyebrow">STEP 1 · MODE</div>
    <h1>先决定这门课从哪来。</h1>
    <p>没有资料也能从零搭；有教学大纲或课件，就按你学校的内容和术语来。</p>
  </div>
  <div class="panel" style="padding:22px">
    <div class="mode-cards">
      <button class="mode-card ${intake.mode === "self" ? "active" : ""}" data-mode="self">
        <div class="mc-top"><h3>自由学</h3><span class="radio-dot"></span></div>
        <p>直接输入想学的主题。适合转行、补基础、准备面试，或者单纯好奇。</p>
      </button>
      <button class="mode-card ${intake.mode === "school" ? "active" : ""}" data-mode="school">
        <div class="mc-top"><h3>跟课学</h3><span class="radio-dot"></span></div>
        <p>上传教学大纲、课件、作业，按学校的进度和术语建课。也可以之后导入 LMS 材料。</p>
      </button>
    </div>

    <div class="field">
      <label for="create-topic">${intake.mode === "school" ? "课程名" : "你想学什么"}<span class="hint">一句话就够</span></label>
      <input class="input" id="create-topic" maxlength="80" placeholder="${intake.mode === "school" ? "例如：高等数学（上）" : "例如：用 6 周搞懂 HTTP 缓存"}" value="${esc(intake.topic)}">
    </div>

    <div class="field">
      <label>${intake.mode === "school" ? "课程资料" : "手上已有的资料"}<span class="hint">${intake.mode === "school" ? "至少一份，或把大纲文字粘在下面" : "可选，有就按资料来"}</span></label>
      <div class="dropzone" id="create-drop">
        ${icon("upload", 20)}
        <div style="margin-top:6px"><b>拖入文件</b>，或点击选择（txt / md / html / csv / PDF）</div>
        <div class="tiny" style="margin-top:4px">最多 5 份。PPT 请把文字复制出来粘贴；扫描版 PDF 读不出文字。</div>
      </div>
      <input type="file" id="create-file" multiple accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.pdf" hidden>
      <div class="file-pills" id="file-pills"></div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="paste-toggle">${icon("note", 13)} 直接粘贴大纲</button>
        ${intake.mode === "school" ? `<button class="btn btn-quiet btn-sm" id="load-sample">载入一份示例大纲</button>` : ""}
      </div>
      <div id="paste-box" hidden style="margin-top:10px">
        <textarea class="textarea" id="paste-text" style="min-height:110px" placeholder="把教学大纲、周次安排或课件要点粘在这里…"></textarea>
        <button class="btn btn-ghost btn-sm" id="paste-add" style="margin-top:8px">${icon("plus", 13)} 加入为材料</button>
      </div>
    </div>

    <div class="form-actions">
      <a class="btn btn-quiet" href="#/">返回</a>
      <span class="spacer"></span>
      <button class="btn btn-primary btn-lg" id="to-step2">继续 · 告诉 AI 你的情况 ${icon("arrow", 15)}</button>
    </div>
  </div>`;
}

function bindStepOne(app) {
  const intake = state.intake;

  app.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.mode === "self") {
        state.intake.mode = "self";
        navigate("/world");
        return;
      }
      intake.mode = btn.dataset.mode;
      renderCreate(app);
    };
  });

  const topic = app.querySelector("#create-topic");
  topic.oninput = () => {
    intake.topic = topic.value;
  };

  const fileInput = app.querySelector("#create-file");
  const drop = app.querySelector("#create-drop");
  drop.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    await addFiles([...fileInput.files]);
    paintFilePills();
    fileInput.value = "";
  };
  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("hot");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("hot");
    }),
  );
  drop.addEventListener("drop", async (e) => {
    await addFiles([...e.dataTransfer.files]);
    paintFilePills();
  });
  paintFilePills();

  app.querySelector("#paste-toggle").onclick = () => {
    const box = app.querySelector("#paste-box");
    box.hidden = !box.hidden;
  };
  app.querySelector("#paste-add").onclick = () => {
    const text = app.querySelector("#paste-text").value.trim();
    if (text.length < 20) return toast("粘贴的内容太短了，至少一段。", "error");
    intake.materials = [...intake.materials.filter((m) => m.name !== "粘贴的内容"), { name: "粘贴的内容", text }].slice(0, 5);
    app.querySelector("#paste-text").value = "";
    paintFilePills();
    toast("已加入材料");
  };

  const sample = app.querySelector("#load-sample");
  if (sample) {
    sample.onclick = async () => {
      try {
        const s = await api("/api/sample");
        intake.materials = [...intake.materials.filter((m) => m.name !== s.name), { name: s.name, text: s.text }].slice(0, 5);
        if (!intake.topic) intake.topic = s.name.replace(/[_-]/g, " ");
        paintFilePills();
        toast("示例大纲已载入");
      } catch (e) {
        toast(e.message, "error");
      }
    };
  }

  app.querySelector("#to-step2").onclick = () => {
    if (intake.topic.trim().length < 2) {
      toast("先写一个课程名或主题。", "error");
      topic.focus();
      return;
    }
    if (intake.mode === "school" && !intake.materials.length && intake.topic.trim().length < 4) {
      toast("跟课学需要至少一份材料，或者写清课程名。", "error");
      return;
    }
    intake.step = 2;
    renderCreate(app);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

/* A recommendation the learner can accept without thinking, and override without
   arguing: asked in one screen, answered in one tap. Only the questions that can
   actually be inferred from an earlier answer get one — the level is not
   something a system should guess at. */
function recommend(q, a = {}) {
  const level = a.level ?? "some";
  const focus = a.focus ?? "concept";
  if (q === 2) {
    if (level === "gap") return { k: "concept", why: "你说卡住的是具体几个点，先把那几个点的原理拆开" };
    if (level === "beginner") return { k: "practice", why: "零基础先上手跑通一次，比先看推导更容易建立感觉" };
    return { k: "concept", why: "多数人卡住是因为原理没打通，而不是练得少" };
  }
  if (q === 3) {
    if (focus === "exam") return { k: "exam", why: "你选了考试导向，目标按分数衡量" };
    if (focus === "project") return { k: "build", why: "你选了项目作品，目标就是把它做出来" };
    if (focus === "practice") return { k: "build", why: "动手练到最后应该能独立做出东西" };
    return { k: "system", why: "讲透原理的终点是能自己复述整门课" };
  }
  if (q === 4) {
    if (level === "beginner") return { k: "brief", why: "零基础先走完一条短路径，再决定要不要加深" };
    return { k: "standard", why: "12 讲是能覆盖一门课主干、又不至于半途而废的规模" };
  }
  if (q === 5) return { k: a.lang ?? "zh", why: "和你现在的界面语言一致" };
  return null;
}

function optionGroup(q, key, opts, selected, rec = null) {
  const TITLES = ["你目前的基础处于什么水平？", "这门课应该更偏哪一边？", "你希望学完达到什么？", "你希望课程有多大规模？", "课程内容用什么语言？"];
  const recLabel = rec ? opts.find((o) => o.k === rec.k)?.t : null;
  return `<div class="q-block">
    <div class="q-title"><span class="qn">${q}</span><h3>${TITLES[q - 1]}</h3></div>
    ${
      rec && recLabel
        ? `<p class="q-rec">推荐 <b>${esc(recLabel)}</b> — ${esc(rec.why)}</p>`
        : ""
    }
    <div class="opts">
      ${opts
        .map(
          (o) => `<button class="opt ${selected === o.k ? "active" : ""} ${rec && rec.k === o.k ? "rec" : ""}" data-answer="${key}" data-value="${o.k}">
            <strong>${esc(o.t)}${rec && rec.k === o.k ? `<span class="opt-badge">推荐</span>` : ""}</strong><span>${esc(o.d)}</span>
          </button>`,
        )
        .join("")}
    </div>
  </div>`;
}

function stepTwo(intake) {
  const a = intake.answers;
  const scale = SCALE_OPTS.find((x) => x.k === a.scale);
  return `<div class="form-head">
    <div class="eyebrow">STEP 2 · YOUR STARTING POINT</div>
    <h1>五个问题，决定这门课怎么讲。</h1>
    <p>同一门「概率论」，零基础的人要具体例子，考研的人要题型。你的答案决定从哪讲起、讲到多深、练什么。每题都有推荐答案，不同意再改。</p>
  </div>

  <div class="panel" style="padding:20px 22px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <span class="chip accent">${intake.mode === "school" ? "跟课学" : "自由学"}</span>
    <strong style="font-size:14px">${esc(intake.topic)}</strong>
    ${intake.materials.length ? `<span class="chip">${intake.materials.length} 份材料</span>` : `<span class="tiny muted">无材料 · AI 从零搭</span>`}
    <span class="chip">${(a.lang ?? "zh") === "en" ? "English" : "中文"}</span>
    <span class="spacer" style="flex:1"></span>
    <button class="btn btn-quiet btn-sm" id="back-step1">修改主题 / 材料</button>
  </div>

  <div class="panel">
    ${optionGroup(1, "level", LEVEL_OPTS, a.level, recommend(1, a))}
    ${optionGroup(2, "focus", FOCUS_OPTS, a.focus, recommend(2, a))}
    ${optionGroup(3, "goal", GOAL_OPTS, a.goal, recommend(3, a))}
    ${optionGroup(4, "scale", SCALE_OPTS, a.scale, recommend(4, a))}
    ${optionGroup(5, "lang", LANG_OPTS, a.lang ?? "zh", recommend(5, a))}

    <div class="field" style="margin-top:24px;border-top:1px solid var(--line-2);padding-top:20px">
      <label for="goal-text">用你自己的话说说目标<span class="hint">可选，但很有用</span></label>
      <textarea class="textarea" id="goal-text" maxlength="300" style="min-height:80px" placeholder="例如：下个月面试后端，缓存这块总被问住；或者：期末想从 70 分到 85 分。">${esc(a.goalText)}</textarea>
    </div>

    <div class="form-actions">
      <button class="btn btn-quiet" id="back-step1b">${icon("back", 14)} 上一步</button>
      <span class="spacer"></span>
      <span class="tiny muted" style="margin-right:6px">${scale?.d ?? ""}</span>
      <button class="btn btn-primary btn-lg" id="generate">${icon("spark", 15)} 生成课程大纲</button>
    </div>
  </div>

  <p class="tiny muted" style="text-align:center;margin-top:14px">下一步只是草案。单元、讲次、项目都能改，改完确认才会开始写课。</p>`;
}

function bindStepTwo(app) {
  const intake = state.intake;

  app.querySelectorAll("[data-answer]").forEach((btn) => {
    btn.onclick = () => {
      intake.answers[btn.dataset.answer] = btn.dataset.value;
      renderCreate(app);
    };
  });

  const goalText = app.querySelector("#goal-text");
  goalText.oninput = () => {
    intake.answers.goalText = goalText.value;
  };

  const back = () => {
    intake.step = 1;
    renderCreate(app);
  };
  app.querySelector("#back-step1").onclick = back;
  app.querySelector("#back-step1b").onclick = back;

  app.querySelector("#generate").onclick = async () => {
    if (!intake.topic.trim()) return toast("主题丢了，请返回上一步填写。", "error");
    if (!state.config?.model?.configured) {
      const ok = confirm(t("当前没有配置模型，无法生成新课程。\n\n可以先体验内置示例课程。要现在试试内置课程吗？"));
      if (ok) navigate("/course/demo");
      return;
    }
    const btn = app.querySelector("#generate");
    btn.disabled = true;

    const result = await showJob({
      title: "正在搭你的课程草案",
      sub: "先读懂你的基础，再决定从哪里开始",
      labels: ["读懂基础与目标", "拆解知识结构", "安排单元与项目", "核对讲次顺序"],
      start: () =>
        api("/api/outline", {
          method: "POST",
          body: {
            mode: intake.mode,
            answers: { ...intake.answers, topic: intake.topic },
            materials: intake.materials,
          },
        }),
      note: "生成需要 20-40 秒。草案出来后你可以逐条修改，确认后才开始写每一讲。",
    });

    btn.disabled = false;
    if (!result?.courseId) return;
    await loadConfig(true);
    navigate(`/build/${result.courseId}`);
  };
}

/* -------------------------------- blueprint -------------------------------- */

export async function renderBuild(app, courseId) {
  const btnBack = `<a class="btn btn-quiet" href="#/">返回</a>`;
  let data;
  try {
    data = await api(`/api/course/${courseId}`);
  } catch (e) {
    app.innerHTML = `${topbar("create")}<main class="page narrow"><div class="empty"><h3>找不到这门课</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/create">重新建一门</a></div></main>`;
    return;
  }

  const course = data.course;
  const editing = state.editMode === course.id;
  if (course.confirmed && !editing) {
    navigate(`/course/${course.id}`);
    return;
  }

  if (!state.draft || state.draft.__courseId !== course.id) {
    state.draft = {
      __courseId: course.id,
      title: course.title,
      subtitle: course.subtitle,
      promise: course.promise,
      audience: course.audience,
      units: course.units.map((u) => ({
        id: u.id,
        title: u.title,
        goal: u.goal,
        lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, prereq: l.prereq ?? "", summary: l.summary, minutes: l.minutes })),
        project: {
          title: u.project.title,
          brief: u.project.brief,
          deliverables: [...(u.project.deliverables ?? [])],
          rubric: [...(u.project.rubric ?? [])],
        },
      })),
    };
  }

  renderBuildBody(app, course);
}

function outlineStats(draft) {
  const lessons = draft.units.flatMap((u) => u.lessons);
  return {
    units: draft.units.length,
    lessons: lessons.length,
    minutes: lessons.reduce((n, l) => n + (Number(l.minutes) || 0), 0),
    projects: draft.units.length,
  };
}

function renderBuildBody(app, course) {
  const draft = state.draft;
  const s = outlineStats(draft);

  app.innerHTML = `${topbar("create")}
  <main class="page">
    <div class="steps">
      <span class="step done"><b>${icon("check", 10, 3)}</b>选择模式</span>
      <span class="step-sep"></span>
      <span class="step done"><b>${icon("check", 10, 3)}</b>你的情况</span>
      <span class="step-sep"></span>
      <span class="step active"><b>3</b>修改大纲</span>
      <span class="step-sep"></span>
      <span class="step"><b>4</b>开始学习</span>
    </div>

    <div class="form-head" style="margin-bottom:20px">
      <div class="eyebrow">STEP 3 · COURSE BLUEPRINT</div>
      <h1 style="margin-bottom:6px">草案不是固定的，先改到顺眼。</h1>
      <p>${course.confirmed ? "这是一门已经在学的课。改动只影响大纲和未生成的讲次，已经学过的记录会保留。" : "已经会的讲次直接删掉；看不懂的标题点行尾的问号，问完可以一键改；标题、顺序、项目都能改，改完再确认。"}</p>
    </div>

    <div class="build-grid">
      <div>
        <div class="panel" style="padding:24px 24px 20px;margin-bottom:14px">
          <input class="outline-title-input" data-field="title" value="${esc(draft.title)}" maxlength="90" aria-label="课程标题">
          <input class="outline-sub-input" data-field="subtitle" value="${esc(draft.subtitle)}" maxlength="160" placeholder="一句话说明这门课的不同" aria-label="课程副标题">
          <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
            <span class="chip accent">${course.mode === "school" ? "跟课学" : "自由学"}</span>
            <span class="chip">${s.units} 单元</span>
            <span class="chip">${s.lessons} 讲</span>
            <span class="chip">${fmtMinutes(s.minutes)}</span>
          </div>
          <div class="field" style="margin-top:16px;margin-bottom:0">
            <label for="promise">学完能做到什么<span class="hint">会显示在课程首页</span></label>
            <input class="input" id="promise" data-field="promise" value="${esc(draft.promise)}" maxlength="120">
          </div>
        </div>

        <div id="units">${draft.units.map(unitCard).join("")}</div>

        <button class="btn btn-ghost" data-act="add-unit" style="width:100%;height:44px;border-style:dashed">${icon("plus", 15)} 增加一个单元</button>
      </div>

      <aside class="side-card">
        <h4>这份草案</h4>
        <div class="summary-row"><span>单元</span><b>${s.units}</b></div>
        <div class="summary-row"><span>讲次</span><b>${s.lessons}</b></div>
        <div class="summary-row"><span>预计时长</span><b>${fmtMinutes(s.minutes)}</b></div>
        <div class="summary-row"><span>项目式学习</span><b>${s.projects}</b></div>
        <div class="summary-note">确认后，每一讲会在你第一次打开时现场生成板书与讲解。之后仍可回来改大纲，已生成的讲次会保留。</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <span class="saved-dot" data-save-state>已保存</span>
          <button class="btn btn-quiet btn-sm" data-act="save-now">${icon("refresh", 13)} 保存</button>
        </div>
        <button class="btn btn-primary" id="confirm" style="width:100%">${course.confirmed ? "保存大纲，回到课程" : "确认大纲，开始建课"} ${icon("arrow", 15)}</button>
        <button class="btn btn-quiet btn-sm" id="discard" style="width:100%;margin-top:8px">放弃这门课</button>
      </aside>
    </div>
  </main>`;

  bindBuild(app, course);
}

function unitCard(unit, ui) {
  return `<section class="unit-card" data-unit-card="${ui}">
    <div class="unit-head">
      <div class="unit-index">${String(ui + 1).padStart(2, "0")}</div>
      <div class="unit-fields">
        <input class="unit-title-input" data-field="unit.title" data-u="${ui}" value="${esc(unit.title)}" maxlength="80" aria-label="单元标题">
        <input class="unit-goal-input" data-field="unit.goal" data-u="${ui}" value="${esc(unit.goal)}" maxlength="260" placeholder="这个单元要解决的核心问题" aria-label="单元目标">
      </div>
      <div class="row-tools">
        <button class="icon-btn" data-act="ask-unit" data-u="${ui}" title="看不懂这个单元？直接问">${icon("help", 15)}</button>
        <button class="icon-btn" data-act="up-unit" data-u="${ui}" title="上移">${icon("up", 15)}</button>
        <button class="icon-btn" data-act="down-unit" data-u="${ui}" title="下移">${icon("down", 15)}</button>
        <button class="icon-btn danger" data-act="del-unit" data-u="${ui}" title="删除单元">${icon("trash", 15)}</button>
      </div>
    </div>

    <div style="margin-top:10px">
      ${unit.lessons
        .map(
          (l, li) => `<div class="lesson-row">
            <span class="lesson-no">${ui + 1}.${li + 1}</span>
            <input class="lesson-title-input" data-field="lesson.title" data-u="${ui}" data-l="${li}" value="${esc(l.title)}" maxlength="90" aria-label="讲次标题">
            <input class="lesson-mins" type="number" min="6" max="30" data-field="lesson.minutes" data-u="${ui}" data-l="${li}" value="${Number(l.minutes) || 12}" aria-label="分钟">
            <span class="tiny muted">分</span>
            <div class="row-tools">
              <button class="icon-btn" data-act="ask-lesson" data-u="${ui}" data-l="${li}" title="看不懂这一讲？直接问">${icon("help", 14)}</button>
              <button class="icon-btn" data-act="up-lesson" data-u="${ui}" data-l="${li}" title="上移">${icon("up", 14)}</button>
              <button class="icon-btn" data-act="down-lesson" data-u="${ui}" data-l="${li}" title="下移">${icon("down", 14)}</button>
              <button class="icon-btn danger" data-act="del-lesson" data-u="${ui}" data-l="${li}" title="删除">${icon("trash", 14)}</button>
            </div>
          </div>`,
        )
        .join("")}
      <button class="add-lesson" data-act="add-lesson" data-u="${ui}">${icon("plus", 13)} 加一讲</button>
    </div>

    <details class="project-edit">
      <summary>${icon("layers", 13)} 项目式学习 · <b>${esc(unit.project.title)}</b></summary>
      <div class="field" style="margin-bottom:10px">
        <input class="input" data-field="project.title" data-u="${ui}" value="${esc(unit.project.title)}" maxlength="90" placeholder="项目名" aria-label="项目名">
      </div>
      <div class="field" style="margin-bottom:10px">
        <textarea class="textarea" data-field="project.brief" data-u="${ui}" maxlength="500" placeholder="做什么、为什么值得做" aria-label="项目说明">${esc(unit.project.brief)}</textarea>
      </div>
      <div class="field" style="margin-bottom:0">
        <label style="font-size:12px;color:var(--muted);font-weight:500">交付物（一行一个）</label>
        <textarea class="textarea" data-field="project.deliverables" data-u="${ui}" style="min-height:60px" aria-label="交付物">${esc((unit.project.deliverables ?? []).join("\n"))}</textarea>
      </div>
      <div class="tiny muted" style="margin-top:8px">评分：${(unit.project.rubric ?? []).map((r) => `${esc(r.criterion)} ${r.weight}%`).join(" · ") || "确认时自动补全"}</div>
    </details>
  </section>`;
}

function bindBuild(app, course) {
  const draft = state.draft;
  const view = app.querySelector("main");
  let timer = null;
  let saving = false;
  let pending = false;

  const stateEl = () => view.querySelector("[data-save-state]");
  const mark = (text, cls = "") => {
    const el = stateEl();
    if (!el) return;
    el.className = `saved-dot ${cls}`;
    el.textContent = text;
  };

  const collect = () => ({
    title: draft.title,
    subtitle: draft.subtitle,
    promise: draft.promise,
    audience: draft.audience,
    units: draft.units.map((u) => ({
      id: u.id || undefined,
      title: u.title,
      goal: u.goal,
      lessons: u.lessons.map((l) => ({ id: l.id || undefined, title: l.title, prereq: l.prereq ?? "", summary: l.summary, minutes: Number(l.minutes) || 12 })),
      project: u.project,
    })),
  });

  async function saveNow() {
    clearTimeout(timer);
    if (saving) {
      pending = true;
      return null;
    }
    saving = true;
    mark("保存中…", "dirty");
    try {
      const res = await api(`/api/course/${course.id}/outline`, { method: "PATCH", body: collect() });
      // The server may have assigned ids to new rows; adopt them so generated
      // lessons stay attached when the learner adds a lesson and then confirms.
      const units = res.course.units;
      if (units.length === draft.units.length) {
        units.forEach((u, ui) => {
          if (!draft.units[ui]) return;
          draft.units[ui].id = u.id;
          u.lessons.forEach((l, li) => {
            if (draft.units[ui].lessons[li]) draft.units[ui].lessons[li].id = l.id;
          });
        });
      }
      mark("已保存");
      return res;
    } catch (e) {
      mark("未保存", "dirty");
      toast(e.message, "error");
      return null;
    } finally {
      saving = false;
      if (pending) {
        pending = false;
        saveNow();
      }
    }
  }

  const queueSave = () => {
    mark("有改动…", "dirty");
    clearTimeout(timer);
    timer = setTimeout(saveNow, 900);
  };

  view.addEventListener("input", (e) => {
    const el = e.target;
    const field = el.dataset.field;
    if (!field) return;
    const u = Number(el.dataset.u);
    const l = Number(el.dataset.l);

    if (field === "title") draft.title = el.value;
    else if (field === "subtitle") draft.subtitle = el.value;
    else if (field === "promise") draft.promise = el.value;
    else if (field === "unit.title") draft.units[u].title = el.value;
    else if (field === "unit.goal") draft.units[u].goal = el.value;
    else if (field === "lesson.title") draft.units[u].lessons[l].title = el.value;
    else if (field === "lesson.minutes") draft.units[u].lessons[l].minutes = Number(el.value) || 12;
    else if (field === "project.title") draft.units[u].project.title = el.value;
    else if (field === "project.brief") draft.units[u].project.brief = el.value;
    else if (field === "project.deliverables") {
      draft.units[u].project.deliverables = el.value.split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
    }
    const unitsEl = view.querySelector("#units");
    if (field === "lesson.minutes") {
      const badge = app.querySelector(".side-card .summary-row:nth-child(4) b");
      if (badge) badge.textContent = fmtMinutes(outlineStats(draft).minutes);
    }
    if (unitsEl) {
      // Keep the unit/project summary label in sync without re-rendering inputs.
      if (field === "project.title") {
        const sum = app.querySelector(`[data-unit-card="${u}"] summary b`);
        if (sum) sum.textContent = el.value;
      }
    }
    queueSave();
  });

  const rerender = async (focus) => {
    await saveNow();
    const y = window.scrollY;
    renderBuildBody(app, course);
    // Re-rendering replaces the whole page, so the view snaps back to the top.
    // Adding a unit or a lesson at the bottom would otherwise look like nothing
    // happened — put the learner back on the row they just created.
    const card = focus?.unit != null ? app.querySelector(`[data-unit-card="${focus.unit}"]`) : null;
    if (!card) {
      window.scrollTo(0, y);
      return;
    }
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    const input = card.querySelector(focus.lesson != null ? `[data-field="lesson.title"][data-l="${focus.lesson}"]` : '[data-field="unit.title"]');
    if (input) {
      input.focus();
      input.select();
    }
  };

  view.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const u = Number(btn.dataset.u);
    const l = Number(btn.dataset.l);

    if (act === "save-now") {
      await saveNow();
      toast("已保存");
      return;
    }
    if (act === "ask-lesson" || act === "ask-unit") {
      // Flush unsaved edits first: the question is answered against the saved
      // outline, and new rows only get their ids on save.
      await saveNow();
      const fresh = state.draft.units[u];
      if (!fresh) return;
      openOutlineAsk(app, course, u, act === "ask-lesson" ? l : null, rerender);
      return;
    }
    if (act === "add-unit") {
      if (draft.units.length >= 6) return toast("最多 6 个单元。", "error");
      draft.units.push({
        id: null,
        title: "新的单元",
        goal: "",
        lessons: [{ id: null, title: "新的讲次", summary: "", minutes: 12 }],
        project: {
          title: "综合项目",
          brief: "用本单元的知识做一个小作品，并说明你的取舍。",
          deliverables: ["可运行的成果或可查看的文档", "一页设计说明"],
          rubric: [
            { criterion: "能正确用上本单元的核心方法", weight: 60 },
            { criterion: "说明了取舍与边界", weight: 40 },
          ],
        },
      });
      await rerender({ unit: draft.units.length - 1 });
      return;
    }
    if (act === "del-unit") {
      if (draft.units.length <= 1) return toast("至少保留一个单元。", "error");
      if (!confirm(t("删除「{name}」及其中的讲次？", { name: draft.units[u].title }))) return;
      draft.units.splice(u, 1);
      await rerender();
      return;
    }
    if (act === "up-unit" || act === "down-unit") {
      const to = act === "up-unit" ? u - 1 : u + 1;
      if (to < 0 || to >= draft.units.length) return;
      [draft.units[u], draft.units[to]] = [draft.units[to], draft.units[u]];
      await rerender();
      return;
    }
    if (act === "add-lesson") {
      if (draft.units[u].lessons.length >= 5) return toast("每个单元最多 5 讲。", "error");
      draft.units[u].lessons.push({ id: null, title: "新的讲次", summary: "", minutes: 12 });
      await rerender({ unit: u, lesson: draft.units[u].lessons.length - 1 });
      return;
    }
    if (act === "del-lesson") {
      if (draft.units[u].lessons.length <= 1) return toast("每个单元至少保留一讲。", "error");
      draft.units[u].lessons.splice(l, 1);
      await rerender();
      return;
    }
    if (act === "up-lesson" || act === "down-lesson") {
      const to = act === "up-lesson" ? l - 1 : l + 1;
      if (to < 0 || to >= draft.units[u].lessons.length) return;
      [draft.units[u].lessons[l], draft.units[u].lessons[to]] = [draft.units[u].lessons[to], draft.units[u].lessons[l]];
      await rerender();
    }
  });

  view.querySelector("#confirm").onclick = async (e) => {
    const btn = e.currentTarget;
    if (outlineStats(draft).lessons < 3) return toast("系统课程至少需要三讲。可以再加一讲，或返回上一步改成精简规模。", "error");
    btn.disabled = true;
    btn.textContent = "保存中…";
    const saved = await saveNow();
    if (!saved) {
      btn.disabled = false;
      btn.innerHTML = `确认大纲，开始建课`;
      return;
    }
    try {
      if (!course.confirmed) await api(`/api/course/${course.id}/confirm`, { method: "POST" });
      state.editMode = null;
      await loadConfig(true);
      // A freestyle course is played on the map; the syllabus page is still one click away.
      navigate(course.mode !== "school" && course.track ? `/map/${course.id}` : `/course/${course.id}`);
    } catch (err) {
      toast(err.message, "error");
      btn.disabled = false;
      btn.innerHTML = course.confirmed ? "保存大纲，回到课程" : "确认大纲，开始建课";
    }
  };

  view.querySelector("#discard").onclick = async () => {
    if (!confirm(t("放弃这门课？大纲会被删除。"))) return;
    try {
      await api(`/api/course/${course.id}`, { method: "DELETE" });
      state.draft = null;
      state.editMode = null;
      await loadConfig(true);
      navigate("/");
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

/* --------------------------- asking about a title --------------------------- */

/* A title the learner cannot read is a hint, not a wall: ask about it, get an
   explanation, and — if the question shows the outline itself is at fault —
   apply a suggested rewrite with one click. */

const QUICK_QUESTIONS = [
  "这个标题到底在讲什么？",
  "为什么这门课需要这一讲？",
  "标题能不能换个更直白的说法？",
];

function openOutlineAsk(app, course, ui, li, rerender) {
  const draft = state.draft;
  const unit = draft.units[ui];
  if (!unit) return;
  const lesson = li == null ? null : unit.lessons[li];
  const targetTitle = lesson ? lesson.title : unit.title;

  const overlay = modal(`<div class="modal-head">
      <div>
        <div class="eyebrow">OUTLINE QUESTION · ${lesson ? `讲次 ${ui + 1}.${li + 1}` : `单元 ${ui + 1}`}</div>
        <h3 style="margin-top:2px">${esc(targetTitle)}</h3>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" data-close>${icon("close", 16)}</button>
    </div>
    <p class="tiny muted" style="margin-bottom:10px">看不懂的标题直接问。答案会讲清楚它教什么、为什么排在这里；如果标题本身写得绕，会给出更直白的改法，一键替换。</p>
    <div class="oa-suggest">
      ${QUICK_QUESTIONS.map((q) => `<button class="example-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
    </div>
    <div class="ask-box oa-input-box">
      <div class="ask-inner">
        <textarea id="oa-input" placeholder="例如：标题里的这个词是什么意思？为什么放在第一讲？" maxlength="300"></textarea>
        <button class="send" id="oa-send" title="发送">${icon("send", 15)}</button>
      </div>
    </div>
    <div id="oa-body"></div>`);

  const body = overlay.querySelector("#oa-body");
  const input = overlay.querySelector("#oa-input");
  overlay.querySelector("[data-close]").onclick = () => overlay.remove();
  overlay.querySelectorAll("[data-q]").forEach((chip) => {
    chip.onclick = () => {
      input.value = chip.dataset.q;
      send();
    };
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  overlay.querySelector("#oa-send").onclick = () => send();

  function findNode(id) {
    for (const u of draft.units) {
      if (u.id === id) return { type: "unit", node: u, where: `单元《${u.title}》` };
      for (const l of u.lessons) {
        if (l.id === id) return { type: "lesson", node: l, where: `讲次《${l.title}》` };
      }
    }
    return null;
  }

  async function send(preset) {
    const text = String(preset ?? input.value ?? "").trim();
    if (!text) {
      toast("先写下你的问题。", "error");
      return;
    }
    // The question is answered against the saved outline; flush local edits first.
    input.value = text;
    body.innerHTML = `<div style="padding:18px 0;text-align:center;color:var(--muted);font-size:13px">顾问正在看整份大纲…（约 5-15 秒）</div>`;
    try {
      const res = await api(`/api/course/${course.id}/outline/ask`, {
        method: "POST",
        body: { question: text, unitId: unit.id, lessonId: lesson?.id ?? "" },
      });
      renderResult(res);
    } catch (e) {
      body.innerHTML = `<div class="assistant-answer" style="margin-top:14px">${esc(e.message)}</div>`;
    }
  }

  function renderResult(res) {
    const changes = res.changes ?? [];
    body.innerHTML = `<div class="assistant-answer" style="margin-top:14px">${fmt(res.answer)}</div>
      ${changes.length
        ? `<div class="eyebrow" style="margin:18px 0 10px">建议这样改</div>
           ${changes
             .map((c, k) => {
               const hit = findNode(c.target);
               return `<div class="oa-change">
                 <div class="oa-where">${esc(hit?.where ?? c.target)}</div>
                 ${c.title ? `<div class="oa-new">标题改为 <b>「${esc(c.title)}」</b></div>` : ""}
                 ${c.summary ? `<div class="oa-new">这一讲的收获：${esc(c.summary)}</div>` : ""}
                 ${c.reason ? `<div class="tiny muted" style="margin-top:6px">${esc(c.reason)}</div>` : ""}
                 <div class="oa-change-actions">
                   <button class="btn btn-primary btn-sm" data-apply="${k}">用这个改法</button>
                   <button class="btn btn-quiet btn-sm" data-skip="${k}">先不改</button>
                 </div>
               </div>`;
             })
             .join("")}`
        : `<p class="tiny muted" style="margin-top:12px">大纲本身没问题。如果还是觉得别扭，可以直接在标题输入框里手动改。</p>`}`;

    body.querySelectorAll("[data-apply]").forEach((btn) => {
      btn.onclick = async () => {
        const c = changes[Number(btn.dataset.apply)];
        const hit = c ? findNode(c.target) : null;
        if (!hit) {
          toast("这一行已经不在草案里了，刷新后再试。", "error");
          return;
        }
        if (c.title) hit.node.title = c.title;
        if (c.summary && hit.type === "lesson") hit.node.summary = c.summary;
        overlay.remove();
        await rerender();
        toast("标题已按建议修改，自动保存中。");
      };
    });
    body.querySelectorAll("[data-skip]").forEach((btn) => {
      btn.onclick = () => {
        const card = btn.closest(".oa-change");
        if (card) card.style.opacity = "0.45";
        btn.disabled = true;
      };
    });
  }
}
