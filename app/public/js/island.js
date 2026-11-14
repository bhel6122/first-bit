/* The free-study course home, as an island rather than a syllabus.

   A self-built course is not a term you sit through — it is a place you keep
   coming back to. So this page is drawn like a game map: a wooden sign with the
   course name, the character and their level, then one landmark card per unit
   with its lessons as a trail of stops. The school-mode course keeps the
   editorial page (units, projects, rubric, statistics); the two modes should
   not look like the same product.

   Everything here is presentation plus navigation. The actual fights, terminals
   and boards stay in map.js / battle.js / terminal.js — this page just gets you
   to them without a syllabus in between. */

import { api, esc, icon, navigate, toast, loadConfig, state } from "./core.js";
import { hud, sprite, stars, beep, mountPage } from "./pixel.js";
import { t } from "./i18n.js";

const TRACK_NAME = { frontend: "前端", backend: "后端", ui: "设计" };

/* A 16×20 grid tree, the same pixel language as the characters. */
const tree = () => `<svg class="pxi-tree" viewBox="0 0 16 20" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="6" y="14" width="4" height="6" fill="#7a5230"/>
  <rect x="2" y="9" width="12" height="6" fill="#4f7a34"/>
  <rect x="4" y="4" width="8" height="7" fill="#5e8f3d"/>
  <rect x="6" y="1" width="4" height="5" fill="#6da046"/>
</svg>`;

export async function renderIslandCourse(app, course) {
  const player = await api("/api/player").catch(() => ({}));
  const track = course.track ?? player.track ?? "frontend";
  const game = course.game ?? { stars: {}, cleared: [], terminals: {} };

  const lessons = course.units.flatMap((u) => u.lessons);
  const clearedOf = (list) => list.filter((l) => (game.stars?.[l.id] ?? 0) > 0 || l.complete).length;
  const resume = course.lastLesson ?? lessons[0]?.id ?? "";
  const totalStars = Object.values(game.stars ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

  mountPage(
    app,
    `${hud(player, `<span class="px-tiny">${t("自由学")} · ${esc(t(TRACK_NAME[track] ?? ""))}</span>`, "冒险手帐")}
    <div class="pxi">
      <div class="pxi-banner">
        <div class="pxi-sky">
          <span class="pxi-cloud" style="left:12%"></span>
          <span class="pxi-cloud" style="left:68%;top:26px"></span>
          <span class="pxi-water"></span>
        </div>
        <div class="pxi-ground">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8]
            .map((i) => `<span class="pxi-tree-slot" style="left:${3 + i * 11.6}%">${tree()}</span>`)
            .join("")}
        </div>
        <a class="pxi-back" href="#/">${icon("back", 13)} ${t("课程书架")}</a>
        <div class="pxi-plaque">
          <span class="pxi-plaque-k">${t("知识大冒险")}</span>
          <h1>${esc(course.title)}</h1>
        </div>
      </div>

      <div class="pxi-body">
        <section class="pxi-hero">
          <div class="pxi-hero-who">
            ${sprite(track, "idle", 56)}
            <div>
              <div class="pxi-hero-name">${esc(t(player.title ?? "学徒"))} <span class="pxi-tag">LV.${player.level ?? 1}</span></div>
              <div class="pxi-hero-sub">${esc(course.promise || course.subtitle || "")}</div>
            </div>
          </div>
          <div class="pxi-hero-stats">
            <div class="pxi-stat"><b>${clearedOf(lessons)}</b><span>${t("/ {n} 讲", { n: lessons.length })}</span></div>
            <div class="pxi-stat"><b>${totalStars}</b><span>${t("颗星")}</span></div>
            <div class="pxi-stat"><b>${player.xp ?? 0}</b><span>XP</span></div>
          </div>
          <div class="pxi-hero-act">
            <a class="pxi-btn primary" href="#/map/${encodeURIComponent(course.id)}">${t("打开大地图")} ${icon("arrow", 13)}</a>
            <a class="pxi-btn" href="#/lesson/${encodeURIComponent(course.id)}/${encodeURIComponent(resume)}">${t("继续上一讲")}</a>
          </div>
        </section>

        <div class="pxi-units">
          ${course.units.map((u, ui) => unitCard(course, u, ui, game)).join("")}
        </div>

        <footer class="pxi-foot">
          <span class="pxi-tiny">${course.demo ? t("这是示例课程，不需要模型也能玩。") : t("讲次和地图是同一份进度，在哪边过关都算。")}</span>
          <span style="flex:1"></span>
          <button class="pxi-mini" data-outline>${icon("note", 12)} ${t("改大纲")}</button>
          <button class="pxi-mini danger" data-delete>${icon("trash", 12)} ${t("删除")}</button>
        </footer>
      </div>
    </div>`,
  );

  bind(app, course);
}

function unitCard(course, unit, ui, game) {
  const ls = unit.lessons ?? [];
  const done = ls.filter((l) => (game.stars?.[l.id] ?? 0) > 0 || l.complete).length;
  const term = game.terminals?.[unit.id];
  const bossStars = game.stars?.[`u:${unit.id}`] ?? 0;
  const pct = ls.length ? Math.round((done / ls.length) * 100) : 0;

  return `<article class="pxi-unit">
    <header class="pxi-unit-head">
      <span class="pxi-landmark" aria-hidden="true">${landmark(ui)}</span>
      <div class="pxi-unit-title">
        <span class="pxi-tiny">${t("第 {n} 区", { n: String(ui + 1).padStart(2, "0") })}</span>
        <h3>${esc(unit.title)}</h3>
        ${unit.goal ? `<p>${esc(unit.goal)}</p>` : ""}
      </div>
      <div class="pxi-unit-meter">
        <span class="pxi-tiny">${done}/${ls.length}</span>
        <span class="pxi-meter"><i style="width:${pct}%"></i></span>
      </div>
    </header>

    <div class="pxi-trail">
      ${ls
        .map((l, li) => {
          const st = game.stars?.[l.id] ?? 0;
          const cls = st > 0 || l.complete ? "done" : l.started ? "walking" : "";
          const built = game.builds?.[l.id]?.solved;
          return `<div class="pxi-stop ${cls}">
            <span class="pxi-dot">${st > 0 || l.complete ? icon("check", 10, 3) : li + 1}</span>
            <button class="pxi-stop-body" data-lesson="${l.id}" title="${t("看这一讲的板书")}">
              <b>${esc(l.title)}</b>
              <small>${esc(l.summary || (l.generated ? t("板书已生成，点开继续。") : t("第一次打开时现场生成板书与讲解。")))}</small>
            </button>
            <span class="pxi-stop-side">
              <span class="pxi-stars">${stars(st)}</span>
              ${
                l.generated
                  ? `<button class="pxi-fight build ${built ? "done" : ""}" data-craft="${l.id}" title="${t("把打乱的行排回去、把概念连起来")}">${built ? t("已拼") : t("拼装")}</button>
                     <button class="pxi-fight" data-fight="${l.id}" title="${t("不看板书直接答题")}">${t("挑战")}</button>`
                  : `<span class="pxi-tiny">${t("未生成")}</span>`
              }
            </span>
          </div>`;
        })
        .join("")}
    </div>

    <footer class="pxi-unit-foot">
      <button class="pxi-mini" data-boss="u:${unit.id}">
        ${icon("bulb", 12)} ${t("区域守关者")} ${bossStars ? `· ${stars(bossStars)}` : ""}
      </button>
      <button class="pxi-mini" data-terminal="${unit.id}">
        ${icon("grid", 12)} ${t("故障终端")} ${term?.solved ? `· ${t("已修复")}` : ""}
      </button>
      <span style="flex:1"></span>
      <span class="pxi-tiny">${esc(unit.project?.title ?? "")}</span>
    </footer>
  </article>`;
}

/* A different silhouette per unit so the four regions do not read as the same
   card four times. 12×12 grid, same pixel language as the sprites. */
function landmark(i) {
  const shapes = [
    // stone idol
    `<rect x="3" y="9" width="6" height="2"/><rect x="2" y="8" width="2" height="3"/><rect x="8" y="8" width="2" height="3"/><rect x="4" y="5" width="4" height="3"/>`,
    // fountain
    `<rect x="5" y="7" width="2" height="4"/><rect x="2" y="9" width="8" height="2"/><rect x="4" y="3" width="4" height="1"/><rect x="6" y="4" width="1" height="3"/>`,
    // gate
    `<rect x="2" y="4" width="1" height="7"/><rect x="9" y="4" width="1" height="7"/><rect x="2" y="3" width="8" height="1"/>`,
    // tower
    `<rect x="4" y="4" width="4" height="7"/><rect x="3" y="2" width="6" height="2"/><rect x="5" y="6" width="2" height="2"/>`,
  ];
  return `<svg viewBox="0 0 12 12" width="34" height="34" shape-rendering="crispEdges" fill="currentColor">${shapes[i % shapes.length]}</svg>`;
}

function bind(app, course) {
  app.querySelectorAll("[data-lesson]").forEach((btn) => {
    btn.onclick = () => {
      beep("tap");
      navigate(`/lesson/${course.id}/${btn.dataset.lesson}`);
    };
  });
  app.querySelectorAll("[data-fight]").forEach((btn) => {
    btn.onclick = () => {
      beep("tap");
      navigate(`/battle/${course.id}/${btn.dataset.fight}`);
    };
  });
  app.querySelectorAll("[data-craft]").forEach((btn) => {
    btn.onclick = () => {
      beep("tap");
      navigate(`/craft/${course.id}/${btn.dataset.craft}`);
    };
  });
  app.querySelectorAll("[data-boss]").forEach((btn) => {
    btn.onclick = () => {
      beep("tap");
      navigate(`/battle/${course.id}/${encodeURIComponent(btn.dataset.boss)}`);
    };
  });
  app.querySelectorAll("[data-terminal]").forEach((btn) => {
    btn.onclick = () => {
      beep("tap");
      navigate(`/terminal/${course.id}/${btn.dataset.terminal}`);
    };
  });

  const outline = app.querySelector("[data-outline]");
  if (outline) {
    outline.onclick = async () => {
      state.draft = null;
      try {
        const data = await api(`/api/course/${course.id}`);
        const c = data.course;
        state.draft = {
          __courseId: c.id,
          title: c.title, subtitle: c.subtitle, promise: c.promise, audience: c.audience,
          units: c.units.map((u) => ({
            id: u.id, title: u.title, goal: u.goal,
            lessons: u.lessons.map((l) => ({ id: l.id, title: l.title, prereq: l.prereq ?? "", summary: l.summary, minutes: l.minutes })),
            project: {
              title: u.project.title, brief: u.project.brief,
              deliverables: [...(u.project.deliverables ?? [])], rubric: [...(u.project.rubric ?? [])],
            },
          })),
        };
        state.editMode = course.id;
        navigate(`/build/${course.id}`);
      } catch (e) {
        toast(e.message, "error");
      }
    };
  }

  const del = app.querySelector("[data-delete]");
  if (del) {
    del.onclick = async () => {
      if (!confirm(t("删除「{name}」？进度、笔记和已生成的讲次都会一起消失。", { name: course.title }))) return;
      try {
        await api(`/api/course/${course.id}`, { method: "DELETE" });
        await loadConfig(true);
        navigate("/");
      } catch (e) {
        toast(e.message, "error");
      }
    };
  }
}
