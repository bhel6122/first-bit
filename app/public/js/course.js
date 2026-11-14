/* Course home: units, lessons, projects, unit tests, progress. */

import {
  state, api, loadConfig, esc, fmt, fmtMinutes, navigate, icon, toast, topbar,
  modal, openQuiz, unitKicker,
} from "./core.js";
import { t } from "./i18n.js";
import { renderIslandCourse } from "./island.js";

export async function renderCourse(app, courseId) {
  await loadConfig();
  let data;
  try {
    data = await api(`/api/course/${courseId}`);
  } catch (e) {
    app.innerHTML = `${topbar("home")}<main class="page"><div class="empty"><h3>找不到这门课</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/">回到我的课程</a></div></main>`;
    return;
  }

  const course = data.course;
  if (!course.confirmed) {
    navigate(`/build/${course.id}`);
    return;
  }
  /* Two different products share this route. A course you built yourself is an
     island you return to; a course you follow is a syllabus you work through.
     Same data, different page — see island.js. */
  if (course.mode !== "school") {
    return renderIslandCourse(app, course);
  }
  state.course = course;

  const lessons = course.units.flatMap((u) => u.lessons);
  const first = lessons[0]?.id;
  const resume = course.lastLesson || first;
  const stat = course.stats;
  const accuracy = stat.quizTotal ? Math.round((stat.quizCorrect / stat.quizTotal) * 100) : null;

  app.innerHTML = `${topbar("home")}
  <main class="page">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <a class="btn btn-quiet btn-sm" href="#/">${icon("back", 14)} 我的课程</a>
      <span class="chip ${course.mode === "school" ? "warn" : "accent"}">${course.mode === "school" ? "跟课学" : "自由学课程"}</span>
      ${course.demo ? `<span class="chip">示例课程 · 无需模型也能体验</span>` : ""}
    </div>

    <section class="course-hero">
      <div class="eyebrow">${course.demo ? "DEMO COURSE" : "YOUR COURSE"} · ${stat.units} UNITS · ${stat.lessons} LESSONS</div>
      <h1>${esc(course.title)}</h1>
      <p class="course-promise">${esc(course.promise || course.subtitle || "")}</p>
      ${course.audience ? `<p class="tiny muted" style="margin-top:8px;max-width:680px">适合：${esc(course.audience)}</p>` : ""}
      <div class="meta-row">
        <span class="chip">${icon("layers", 12)} ${stat.units} 个单元</span>
        <span class="chip">${icon("book", 12)} ${stat.lessons} 讲</span>
        <span class="chip">${icon("clock", 12)} 约 ${fmtMinutes(stat.minutes)}</span>
        <span class="chip">${icon("grid", 12)} ${stat.projects} 个项目</span>
        ${stat.generated < stat.lessons ? `<span class="chip">${stat.generated} 讲已生成</span>` : ""}
        ${course.review?.due ? `<button class="chip accent" id="review-now" style="cursor:pointer" title="答错的题按 1→3→7→14→30 天间隔安排复习">${icon("bulb", 12)} 今日复习 ${course.review.due} 题</button>` : ""}
      </div>
      <div class="progress-wrap">
        <div class="progress-bar">
          <div class="label"><span>学习进度</span><span>${stat.done} / ${stat.lessons} 讲 · ${course.progress}%</span></div>
          <div class="bar"><i style="width:${course.progress}%"></i></div>
        </div>
        ${course.mode !== "school"
          ? `<a class="btn btn-primary" href="#/map/${course.id}">
              进入闯关地图 ${icon("arrow", 15)}
             </a>
             <a class="btn btn-ghost btn-sm" href="#/lesson/${course.id}/${resume}">直接看板书</a>`
          : `<a class="btn btn-primary" href="#/lesson/${course.id}/${resume}">
              ${stat.done === 0 ? "开始第一讲" : "继续学习"} ${icon("arrow", 15)}
             </a>`}
      </div>
    </section>

    <div class="course-layout">
      <div>
        ${course.units.map((u, ui) => unitSection(course, u, ui)).join("")}

        <div class="intro-card" style="margin-top:6px">
          <div class="quote">“先能讲出来，才算真的会。”</div>
          <p>每一讲最后都有三道情境题。答错不是扣分，是把你送回讲这个知识点的那一页。课程不会因为答错而卡住。</p>
        </div>
      </div>

      <aside class="aside-col">
        <div class="aside-card">
          <h4>学习统计</h4>
          <div class="stat-row"><span>已完成讲次</span><b>${stat.done} / ${stat.lessons}</b></div>
          <div class="stat-row"><span>练习题正确率</span><b>${accuracy === null ? "—" : `${accuracy}%`}</b></div>
          <div class="stat-row"><span>课堂时长</span><b>${Math.round(stat.seconds / 60)} 分</b></div>
          <div class="stat-row"><span>完成项目</span><b>${stat.projectsDone} / ${stat.projects}</b></div>
          <p class="note" style="margin-top:10px">${stat.done === 0 ? "还没有开始。点开第一讲，老师会开口讲，板书跟着写。" : stat.done === stat.lessons ? "全部讲次都学完了。可以回头做单元测试，或者重看任意一节。" : "建议按顺序学：后一讲默认前一讲已经掌握。"}</p>
        </div>

        ${data.materials?.length
          ? `<div class="aside-card"><h4>课程资料</h4>${data.materials.map((m) => `<div class="stat-row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${esc(m.name)}</span><b style="font-size:12px;color:var(--muted)">${Math.round((m.chars || 0) / 1000)}k</b></div>`).join("")}<p class="note" style="margin-top:8px">大纲和术语按这些材料生成。</p></div>`
          : ""}

        <div class="aside-card">
          <h4>课程管理</h4>
          <p class="note">大纲可以随时回来改。已经生成的讲次会保留；改了标题的讲次可以重新生成内容。</p>
          <button class="btn btn-ghost btn-sm" id="edit-outline" style="width:100%;margin-top:10px">${icon("note", 13)} 修改大纲</button>
          <button class="danger-link" id="delete-course">删除这门课</button>
        </div>
      </aside>
    </div>
  </main>`;

  bindCourse(app, course);
}

function unitSection(course, unit, ui) {
  return `<section class="unit-section">
    <div class="unit-header">
      <div class="unit-num">${String(ui + 1).padStart(2, "0")}</div>
      <div style="min-width:0">
        <h3>${esc(unit.title)}</h3>
        ${unit.goal ? `<p>${esc(unit.goal)}</p>` : ""}
      </div>
      <span class="spacer"></span>
      <span class="chip">${unit.lessons.length} 讲</span>
    </div>

    <div class="lesson-list">
      ${unit.lessons
        .map((l, li) => {
          const cls = l.complete ? "done" : l.started ? "started" : "";
          return `<div class="lesson-item ${cls}" data-lesson="${l.id}">
            <span class="lesson-state">${l.complete ? icon("check", 13, 3) : String(li + 1).padStart(2, "0")}</span>
            <div class="lesson-main">
              <h4>${esc(l.title)}</h4>
              <p>${l.prereq ? `<span style="color:var(--faint)">前置 ${esc(l.prereq)} · </span>` : ""}${esc(l.summary || (l.generated ? "板书课已生成，点开继续。" : "第一次打开时生成板书与讲解，约 20-40 秒。"))}</p>
            </div>
            <div class="lesson-side">
              ${l.quizTotal ? `<span class="mini-score">${l.correct}/${l.quizTotal}</span>` : ""}
              <span>${l.minutes} 分</span>
              ${l.generated ? `<button class="mini-fight" data-fight="${l.id}" title="不看板书，直接答题">挑战</button>` : ""}
              ${icon("right", 14)}
            </div>
          </div>`;
        })
        .join("")}
    </div>

    <div class="unit-foot">
      <button class="mini project ${unit.project.done ? "done" : ""}" data-project="${unit.id}">
        ${unit.project.done ? icon("check", 13, 3) : icon("layers", 13)}
        ${unit.project.done ? "项目已完成" : "项目式学习"} · ${esc(unit.project.title)}
      </button>
      <button class="mini" data-test="${unit.id}">
        ${icon("bulb", 13)} 单元测试${unit.test.total ? ` · ${unit.test.answered}/${unit.test.total}` : ""}
      </button>
      ${unit.test.answered > unit.test.correct ? `<button class="mini" data-diagnose="${unit.id}">${icon("compass", 13)} 诊断薄弱点</button>` : ""}
    </div>
  </section>`;
}

function bindCourse(app, course) {
  app.querySelectorAll("[data-lesson]").forEach((row) => {
    row.onclick = (e) => {
      // The fight shortcut lives inside the row; it must not also open the board.
      if (e.target.closest("[data-fight]")) return;
      navigate(`/lesson/${course.id}/${row.dataset.lesson}`);
    };
  });

  app.querySelectorAll("[data-fight]").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      navigate(`/battle/${course.id}/${btn.dataset.fight}`);
    };
  });

  app.querySelectorAll("[data-project]").forEach((btn) => {
    btn.onclick = () => openProject(app, course, btn.dataset.project);
  });

  app.querySelectorAll("[data-test]").forEach((btn) => {
    btn.onclick = () => openTest(app, course, btn.dataset.test);
  });

  app.querySelectorAll("[data-diagnose]").forEach((btn) => {
    btn.onclick = () => openDiagnose(app, course, btn.dataset.diagnose);
  });

  const reviewBtn = app.querySelector("#review-now");
  if (reviewBtn) reviewBtn.onclick = () => openReview(app, course);

  app.querySelector("#edit-outline").onclick = () => {
    // A confirmed course can still edit its blueprint; renderBuild allows it.
    state.draft = null;
    api(`/api/course/${course.id}`).then((data) => {
      const c = data.course;
      state.draft = {
        __courseId: c.id,
        title: c.title, subtitle: c.subtitle, promise: c.promise, audience: c.audience,
        units: c.units.map((u) => ({
          id: u.id, title: u.title, goal: u.goal,
          lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, prereq: l.prereq ?? "", summary: l.summary, minutes: l.minutes })),
          project: { title: u.project.title, brief: u.project.brief, deliverables: [...(u.project.deliverables ?? [])], rubric: [...(u.project.rubric ?? [])] },
        })),
      };
      state.editMode = course.id;
      navigate(`/build/${course.id}`);
    });
  };

  app.querySelector("#delete-course").onclick = async () => {
    if (!confirm(t("删除「{name}」？进度、笔记和已生成的讲次都会一并删除。", { name: course.title }))) return;
    try {
      await api(`/api/course/${course.id}`, { method: "DELETE" });
      await loadConfig(true);
      navigate("/");
    } catch (e) {
      toast(e.message, "error");
    }
  };
}

/* --------------------------------- project --------------------------------- */

function openProject(app, course, unitId) {
  const unit = course.units.find((u) => u.id === unitId);
  if (!unit) return;
  const p = unit.project;

  const overlay = modal(`<div class="modal-head">
      <div>
        <div class="eyebrow">PROJECT · ${esc(unit.title)}</div>
        <h3 style="margin-top:2px">${esc(p.title)}</h3>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" data-close>${icon("close", 16)}</button>
    </div>
    <p style="font-size:14px;line-height:1.75;color:var(--ink-2)">${esc(p.brief)}</p>
    <div style="margin-top:18px">
      <div class="eyebrow" style="margin-bottom:8px">交付物</div>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:7px">
        ${(p.deliverables ?? []).map((d) => `<li style="display:flex;gap:8px;font-size:13px;color:var(--ink-2)"><span style="color:var(--accent)">${icon("check", 13, 2.5)}</span>${esc(d)}</li>`).join("")}
      </ul>
    </div>
    <div style="margin-top:18px">
      <div class="eyebrow" style="margin-bottom:8px">怎么算做好</div>
      ${(p.rubric ?? []).map((r) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="flex:1;font-size:12.5px;color:var(--ink-2)">${esc(r.criterion)}</span>
        <span class="bar" style="width:96px"><i style="width:${r.weight}%"></i></span>
        <span class="mono tiny muted" style="width:34px;text-align:right">${r.weight}%</span>
      </div>`).join("")}
    </div>
    <div class="quiz-actions">
      <span class="tiny muted">项目不强制提交，做完自己打勾即可。</span>
      <span class="spacer"></span>
      <button class="btn ${p.done ? "btn-ghost" : "btn-primary"}" data-toggle>${p.done ? "取消完成标记" : "标记为已完成"}</button>
    </div>`);

  overlay.querySelector("[data-close]").onclick = () => overlay.remove();
  overlay.querySelector("[data-toggle]").onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      await api(`/api/course/${course.id}/project/${unit.id}`, { method: "POST", body: { done: !p.done } });
      overlay.remove();
      await renderCourse(app, course.id);
    } catch (err) {
      toast(err.message, "error");
      e.currentTarget.disabled = false;
    }
  };
}

/* -------------------------------- unit test -------------------------------- */

async function openTest(app, course, unitId) {
  const unit = course.units.find((u) => u.id === unitId);
  let test;
  try {
    test = await api(`/api/course/${course.id}/unit/${unitId}/test`);
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  if (!test.questions.length) {
    toast("这个单元还没有生成练习题。先打开一讲，生成后再来。", "error");
    return;
  }

  const questions = test.questions.map((q) => ({ ...q }));

  openQuiz({
    kicker: `${unitKicker(course.units.indexOf(unit))} · UNIT TEST`,
    title: `${unit.title} · 单元测试`,
    questions,
    answer: (q, idx) =>
      api(`/api/course/${course.id}/lesson/${q.lessonId}/answer`, { method: "POST", body: { qid: q.qid, option: idx } }),
    assist: (q) =>
      api(`/api/course/${course.id}/lesson/${q.lessonId}/ask`, {
        method: "POST",
        body: { question: `我不确定这道题：「${q.q}」。请给一个提示，先不要直接说答案。`, page: 1 },
      }),
    onJump: (q, page) => {
      if (page) sessionStorage.setItem(`jump:${course.id}:${q.lessonId}`, String(page));
      navigate(`/lesson/${course.id}/${q.lessonId}`);
    },
    finish: (score, total, close) => ({
      heading: score === total ? "这个单元通了" : score >= total * 0.66 ? "大体掌握" : "建议回看几讲",
      detail:
        score === total
          ? "全部答对。可以去下一个单元，或者把某一讲的板书导出成笔记。"
          : "错题已经记下来。点「诊断薄弱点」可以看到断在哪一讲；答错的题会按间隔自动安排复习。",
      actions: score === total
        ? [
            { label: "回到课程", primary: true, onClick: () => renderCourse(app, course.id) },
            { label: "关闭", close: false, onClick: close },
          ]
        : [
            { label: "诊断薄弱点", primary: true, onClick: () => { close(); openDiagnose(app, course, unit.id); } },
            { label: "回到课程", onClick: () => renderCourse(app, course.id) },
            { label: "关闭", close: false, onClick: close },
          ],
    }),
    onClose: () => renderCourse(app, course.id),
  });
}

/* ------------------------------ spaced review ------------------------------ */

/* Due wrong answers, in the same quiz runner. Answering right pushes the next
   review out (1 → 3 → 7 → 14 → 30 days); wrong resets it to tomorrow. */
async function openReview(app, course) {
  let data;
  try {
    data = await api(`/api/course/${course.id}/review`);
  } catch (e) {
    toast(e.message, "error");
    return;
  }
  if (!data.questions.length) {
    toast("现在没有到期的错题。先去学几讲、做做题。");
    return;
  }

  const questions = data.questions.map((q) => ({ ...q }));

  openQuiz({
    kicker: "SPACED REVIEW · 错题间隔复习",
    title: `今日复习 · ${data.due} 道到期错题`,
    questions,
    answer: (q, idx) =>
      api(`/api/course/${course.id}/lesson/${q.lessonId}/answer`, { method: "POST", body: { qid: q.qid, option: idx } }),
    assist: (q) =>
      api(`/api/course/${course.id}/lesson/${q.lessonId}/ask`, {
        method: "POST",
        body: { question: `我又忘了这道题：「${q.q}」。请给我一个提示，先不要直接说答案。`, page: 1 },
      }),
    onJump: (q, page) => {
      if (page) sessionStorage.setItem(`jump:${course.id}:${q.lessonId}`, String(page));
      navigate(`/lesson/${course.id}/${q.lessonId}`);
    },
    finish: (score, total, close) => ({
      heading: score === total ? "这批错题清零了" : "还剩几道没拿下",
      detail:
        score === total
          ? "答对的题已经推后到更远的日期，明天不会再出现。"
          : "没答对的题明天还会再出现；答对的部分已经推后。错题反复出现不是坏事——那就是你真正的断点。",
      actions: [
        { label: "回到课程", primary: true, onClick: () => renderCourse(app, course.id) },
        { label: "关闭", close: false, onClick: close },
      ],
    }),
    onClose: () => renderCourse(app, course.id),
  });
}

/* -------------------------------- diagnosis -------------------------------- */

/* The wrong answers — including which misconception the learner picked — go
   to the model, which names the lessons where the path actually broke. */
async function openDiagnose(app, course, unitId) {
  const unit = course.units.find((u) => u.id === unitId);
  if (!unit) return;

  const overlay = modal(`<div class="modal-head">
      <div>
        <div class="eyebrow">DIAGNOSIS · ${esc(unit.title)}</div>
        <h3 style="margin-top:2px">哪里断了，回哪里补</h3>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" data-close>${icon("close", 16)}</button>
    </div>
    <div style="padding:22px 0;text-align:center;color:var(--muted);font-size:13px">
      正在读你的错题和选错的那个选项…（约 10-20 秒）
    </div>`);
  overlay.querySelector("[data-close]").onclick = () => overlay.remove();

  let d;
  try {
    d = await api(`/api/course/${course.id}/unit/${unitId}/diagnose`, { method: "POST", body: {} });
  } catch (e) {
    overlay.remove();
    toast(e.message, "error");
    return;
  }

  overlay.querySelector(".modal").innerHTML = `<div class="modal-head">
      <div>
        <div class="eyebrow">DIAGNOSIS · ${esc(unit.title)} · ${d.source === "model" ? "AI 诊断" : "本地诊断"}</div>
        <h3 style="margin-top:2px">哪里断了，回哪里补</h3>
      </div>
      <span class="spacer"></span>
      <button class="icon-btn" data-close>${icon("close", 16)}</button>
    </div>
    <p style="font-size:14px;line-height:1.75;color:var(--ink-2)">${esc(d.advice)}</p>
    ${d.weakLessons?.length ? `
    <div style="margin-top:18px">
      <div class="eyebrow" style="margin-bottom:10px">薄弱讲次（按严重程度）</div>
      ${d.weakLessons.map((w) => `
        <button class="diag-lesson" data-jump="${esc(w.lessonId)}">
          <span class="diag-title">${esc(w.lessonTitle || w.lessonId)}</span>
          <span class="diag-reason">${esc(w.reason)}</span>
          <span class="row-arrow">${icon("arrow", 15)}</span>
        </button>`).join("")}
    </div>` : `<p style="margin-top:16px" class="muted">这个单元还没有错题记录，先做完单元测试再来看。</p>`}
    ${d.plan ? `<div style="margin-top:14px" class="tiny muted">下一步：${esc(d.plan)}</div>` : ""}
    <div class="quiz-actions">
      <span class="tiny muted">错题已自动进入间隔复习（1 → 3 → 7 → 14 → 30 天）。</span>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-close2>回到课程</button>
    </div>`;

  overlay.querySelector("[data-close]").onclick = () => overlay.remove();
  overlay.querySelector("[data-close2]").onclick = () => {
    overlay.remove();
    renderCourse(app, course.id);
  };
  overlay.querySelectorAll("[data-jump]").forEach((btn) => {
    btn.onclick = () => {
      overlay.remove();
      navigate(`/lesson/${course.id}/${btn.dataset.jump}`);
    };
  });
}
