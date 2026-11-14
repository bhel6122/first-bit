/* The world map: one island per unit, one landmark per lesson, a terminal shack
   and a boss castle at the end of each island.

   The map is drawn once in a 1000-wide virtual space: terrain is an SVG built
   out of a coarse 25px grid (chunky on purpose — that is what reads as pixel
   art rather than a chart), and the landmarks are HTML buttons pinned by
   percentage so they stay crisp, focusable and clickable. */

import { api, navigate, toast, esc, fmtMinutes } from "./core.js";
import { sprite, hud, beep, stars } from "./pixel.js";
import { TRACKS } from "./inventory.js";
import { COURSE_KEY } from "./world.js";

const W = 1000;
const CELL = 25;
const COL_X = [248, 500, 752];
const ROW_H = 152;
const HEAD = 98;
const TAIL = 76;

/* Deterministic noise: the same course always draws the same island, so the map
   does not shuffle under the learner between visits. */
const hash = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const TERRAIN = [
  { land: "#dfe8d3", shore: "#efe7c9", patch: "#c8d8b8" },
  { land: "#e9dfc6", shore: "#f4ecd6", patch: "#d8c9a4" },
  { land: "#dedcd3", shore: "#eceadd", patch: "#c9c7ba" },
  { land: "#d8e3e0", shore: "#e7efec", patch: "#c0d0cc" },
];

/* -------------------------------- layout -------------------------------- */

function layout(course) {
  const units = course.units ?? [];
  const nodes = [];
  const regions = [];
  let y = 82;

  units.forEach((unit, ui) => {
    const items = [
      ...(unit.lessons ?? []).map((l, li) => ({ kind: "lesson", id: l.id, key: l.id, lesson: l, li, unitId: unit.id })),
      { kind: "terminal", id: unit.id, key: `t:${unit.id}`, unitId: unit.id, unit },
      { kind: "boss", id: unit.id, key: `b:${unit.id}`, unitId: unit.id, unit },
    ];

    const rows = Math.ceil(items.length / 3);
    items.forEach((it, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const c = row % 2 === 0 ? col : 2 - col;
      const seed = ui * 61 + i * 17 + 5;
      nodes.push({
        ...it,
        regionIndex: ui,
        x: COL_X[c] + (hash(seed) - 0.5) * 74,
        y: y + HEAD + row * ROW_H + (hash(seed + 2) - 0.5) * 38,
      });
    });

    const h = HEAD + (rows - 1) * ROW_H + TAIL;
    regions.push({
      ui, unit, top: y, h, signY: y + 30,
      cx: 500, cy: y + h / 2, rx: 462, ry: h / 2 + 16,
    });
    y += h + 74;
  });

  return { nodes, regions, height: y + 34 };
}

/* -------------------------------- terrain -------------------------------- */

function landmass(region, index) {
  const t = TERRAIN[index % TERRAIN.length];
  const { cx, cy, rx, ry } = region;
  const land = [];
  const shore = [];
  const step = CELL;
  const x0 = Math.floor((cx - rx - step * 3) / step) * step;
  const y0 = Math.floor((cy - ry - step * 3) / step) * step;

  for (let y = y0; y <= cy + ry + step * 3; y += step) {
    for (let x = x0; x <= cx + rx + step * 3; x += step) {
      const dx = (x + step / 2 - cx) / rx;
      const dy = (y + step / 2 - cy) / ry;
      const d = dx * dx + dy * dy;
      // A small wobble on the radius keeps the coast from looking like an ellipse.
      const j = (hash(x * 0.29 + y * 0.17 + index * 47) - 0.5) * 0.14;
      if (d < 1 + j * 0.6) land.push([x, y]);
      else if (d < 1.09 + j) shore.push([x, y]);
    }
  }

  const rects = (cells, fill, inset = 0) =>
    cells
      .map(([x, y]) => `<rect x="${x + inset}" y="${y + inset}" width="${step - inset * 2}" height="${step - inset * 2}" fill="${fill}"/>`)
      .join("");

  const texture = land
    .filter((_, k) => hash(k * 3.7 + index * 11) > 0.86)
    .map(([x, y]) => `<rect x="${x + 7}" y="${y + 7}" width="${step - 14}" height="${step - 14}" fill="${t.patch}" opacity="0.6"/>`)
    .join("");

  return rects(shore, t.shore) + rects(land, t.land) + texture;
}

const tree = (x, y) => `
  <rect x="${x - 1}" y="${y + 3}" width="3" height="5" fill="#8a6a45"/>
  <rect x="${x - 6}" y="${y - 2}" width="12" height="5" fill="#5d8a52"/>
  <rect x="${x - 4}" y="${y - 6}" width="8" height="4" fill="#6d9a60"/>
  <rect x="${x - 2}" y="${y - 9}" width="4" height="3" fill="#7dab6e"/>`;

const rock = (x, y) => `
  <rect x="${x - 5}" y="${y}" width="10" height="5" fill="#c4bda9"/>
  <rect x="${x - 3}" y="${y - 3}" width="6" height="3" fill="#d2ccba"/>
  <rect x="${x + 1}" y="${y + 1}" width="3" height="2" fill="#a9a291"/>`;

const tuft = (x, y) => `
  <rect x="${x - 4}" y="${y}" width="2" height="4" fill="#9fb98d"/>
  <rect x="${x - 1}" y="${y - 2}" width="2" height="6" fill="#8fae7e"/>
  <rect x="${x + 2}" y="${y}" width="2" height="4" fill="#9fb98d"/>`;

/* A stepped peak: reads as a mountain at 25px without being a smooth triangle. */
const peak = (x, y) => `
  <rect x="${x - 10}" y="${y + 5}" width="20" height="4" fill="#bcb9ad"/>
  <rect x="${x - 7}" y="${y + 2}" width="14" height="3" fill="#c9c6ba"/>
  <rect x="${x - 4}" y="${y - 1}" width="8" height="3" fill="#d5d2c6"/>
  <rect x="${x - 2}" y="${y - 4}" width="4" height="3" fill="#e6e3d6"/>
  <rect x="${x - 1}" y="${y - 1}" width="3" height="2" fill="#f6f4ea"/>`;

const cactus = (x, y) => `
  <rect x="${x - 1}" y="${y - 7}" width="3" height="11" fill="#6d9a60"/>
  <rect x="${x - 5}" y="${y - 3}" width="3" height="4" fill="#6d9a60"/>
  <rect x="${x - 5}" y="${y - 3}" width="4" height="2" fill="#6d9a60"/>
  <rect x="${x + 2}" y="${y - 5}" width="3" height="5" fill="#5d8a52"/>
  <rect x="${x + 1}" y="${y - 5}" width="4" height="2" fill="#5d8a52"/>`;

const dune = (x, y) => `
  <rect x="${x - 12}" y="${y}" width="24" height="3" fill="#ddcfae"/>
  <rect x="${x - 8}" y="${y - 3}" width="16" height="3" fill="#e5d9bb"/>`;

const pond = (x, y) => `
  <rect x="${x - 13}" y="${y - 5}" width="26" height="12" fill="#9dc0d2"/>
  <rect x="${x - 10}" y="${y - 7}" width="20" height="3" fill="#9dc0d2"/>
  <rect x="${x - 8}" y="${y - 4}" width="8" height="2" fill="#c3dde8"/>
  <rect x="${x + 1}" y="${y + 1}" width="6" height="2" fill="#c3dde8"/>`;

const reeds = (x, y) => `
  <rect x="${x - 4}" y="${y - 4}" width="1" height="8" fill="#8fae7e"/>
  <rect x="${x}" y="${y - 6}" width="1" height="10" fill="#7d9c6c"/>
  <rect x="${x + 3}" y="${y - 3}" width="1" height="7" fill="#8fae7e"/>`;

function nearRoute(x, y, points, min) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len = vx * vx + vy * vy || 1;
    let t = ((x - a.x) * vx + (y - a.y) * vy) / len;
    t = Math.max(0, Math.min(1, t));
    const dx = x - (a.x + vx * t);
    const dy = y - (a.y + vy * t);
    if (dx * dx + dy * dy < min * min) return true;
  }
  return false;
}

const BIOMES = [
  // meadow: woods and grass
  (k, x, y) => (k > 0.55 ? tree(x, y) : k > 0.3 ? tuft(x, y) : rock(x, y)),
  // dunes: sand ridges and cacti
  (k, x, y) => (k > 0.62 ? cactus(x, y) : k > 0.32 ? dune(x, y) : rock(x, y)),
  // highland: peaks
  (k, x, y) => (k > 0.5 ? peak(x, y) : k > 0.28 ? rock(x, y) : tuft(x, y)),
  // wetland: ponds and reeds
  (k, x, y) => (k > 0.66 ? tree(x, y) : k > 0.34 ? reeds(x, y) : rock(x, y)),
];

function decorations(region, route) {
  const out = [];
  const base = region.ui * 31 + 11;
  const pick = BIOMES[region.ui % BIOMES.length];

  if (region.ui % 4 === 3) {
    const px = region.cx - region.rx * 0.34;
    const py = region.cy + region.ry * 0.2;
    if (!nearRoute(px, py, route, 84)) out.push(pond(px, py));
  }

  for (let i = 0; i < 66; i++) {
    const a = hash(base + i * 3.3) * Math.PI * 2;
    const r = Math.sqrt(hash(base + i * 7.1)) * 0.93;
    const x = region.cx + Math.cos(a) * region.rx * r;
    const y = region.cy + Math.sin(a) * region.ry * r;
    if (nearRoute(x, y, route, 56)) continue;
    out.push(pick(hash(base + i * 11.7), x, y));
  }
  return out.join("");
}

/* A smooth trail through the landmarks, so the route bends instead of zig-zagging. */
function curve(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const o = points[i - 1];
    const mx = (o.x + p.x) / 2;
    const my = (o.y + p.y) / 2;
    d += ` Q ${o.x} ${o.y} ${mx} ${my}`;
    if (i === points.length - 1) d += ` L ${p.x} ${p.y}`;
  }
  return d;
}

/* -------------------------------- markers -------------------------------- */

function castleIcon(state) {
  const body = state === "clear" ? "#4f8f6a" : state === "locked" ? "#b5b1a2" : "#a67c46";
  const dark = state === "clear" ? "#37704f" : state === "locked" ? "#9c9888" : "#835f33";
  const flag = state === "clear" ? "#b42318" : state === "locked" ? "#c2bdae" : "#b42318";
  return `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="2" y="10" width="4" height="11" fill="${body}"/>
    <rect x="18" y="10" width="4" height="11" fill="${body}"/>
    <rect x="6" y="13" width="12" height="8" fill="${body}"/>
    <rect x="2" y="7" width="2" height="3" fill="${dark}"/>
    <rect x="4" y="7" width="2" height="3" fill="${body}"/>
    <rect x="18" y="7" width="2" height="3" fill="${body}"/>
    <rect x="20" y="7" width="2" height="3" fill="${dark}"/>
    <rect x="10" y="16" width="4" height="5" fill="#3b3730"/>
    <rect x="11" y="17" width="2" height="2" fill="${dark}"/>
    <rect x="7" y="10" width="2" height="2" fill="${dark}"/>
    <rect x="15" y="10" width="2" height="2" fill="${dark}"/>
    <rect x="11" y="2" width="1" height="6" fill="${dark}"/>
    <rect x="12" y="2" width="5" height="3" fill="${flag}"/>
  </svg>`;
}

function terminalIcon(state) {
  const screen = state === "clear" ? "#7fd6a8" : state === "locked" ? "#c9c7bb" : "#9fd0e8";
  return `<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="3" y="4" width="18" height="13" fill="#1f2124"/>
    <rect x="5" y="6" width="14" height="9" fill="${screen}"/>
    <rect x="9" y="17" width="6" height="2" fill="#1f2124"/>
    <rect x="7" y="19" width="10" height="2" fill="#1f2124"/>
    <rect x="11" y="6" width="1" height="9" fill="#1f2124" opacity="0.7"/>
    <rect x="12" y="9" width="3" height="1" fill="#1f2124" opacity="0.7"/>
    <rect x="9" y="11" width="2" height="1" fill="#1f2124" opacity="0.7"/>
  </svg>`;
}

/* ------------------------------- the page ------------------------------- */

export async function renderMap(app, courseId) {
  let data;
  let player;
  try {
    [data, player] = await Promise.all([api(`/api/course/${courseId}`), api("/api/player").catch(() => ({}))]);
  } catch (e) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">找不到这门课</div><p class="px-sub">${esc(e.message)}</p>
      <a class="px-btn" href="#/" style="margin-top:14px">回首页</a></div></main>`;
    return;
  }

  const course = data.course;
  const game = course.game ?? { stars: {}, cleared: [], terminals: {} };
  const cleared = new Set(game.cleared ?? []);
  const track = course.track ?? "frontend";
  const role = TRACKS[track]?.role ?? "学习者";
  const units = course.units ?? [];

  if (!units.length) {
    app.innerHTML = `<main class="px-wrap" style="padding-top:40px"><div class="px-panel">
      <div class="px-kicker">地图还是空的</div><p class="px-sub">这门课还没有生成单元。</p>
      <a class="px-btn" href="#/course/${encodeURIComponent(courseId)}" style="margin-top:14px">看课程大纲</a></div></main>`;
    return;
  }

  const { nodes, regions, height } = layout(course);
  const flat = units.flatMap((u) => u.lessons.map((l) => ({ ...l, unitId: u.id })));
  const currentId = flat.find((l) => !cleared.has(l.id))?.id ?? null;
  localStorage.setItem(COURSE_KEY, courseId);

  const route = nodes.map((n) => ({ x: n.x, y: n.y }));
  const curIdx = Math.max(0, nodes.findIndex((n) => n.kind === "lesson" && n.id === currentId));

  const ctx = {
    cleared, currentId, track, height, game,
    nodeOf: (unitId) => nodes.filter((n) => n.unitId === unitId),
    unitAllClear: (unitId) => {
      const lessons = units.find((u) => u.id === unitId)?.lessons ?? [];
      return lessons.length > 0 && lessons.every((l) => cleared.has(l.id));
    },
    terminalSolved: (unitId) => Boolean(game.terminals?.[unitId]?.solved),
    /* A terminal is practice, not a gate: it opens as soon as the region is
       reachable, not after every lesson in it is cleared. Waiting for the whole
       island made it invisible for most of the run. */
    regionReached: (unitId) => {
      const idx = units.findIndex((u) => u.id === unitId);
      if (idx <= 0) return true;
      return units.slice(0, idx).every((u) => (u.lessons ?? []).every((l) => cleared.has(l.id)));
    },
  };

  const done = Math.round((cleared.size / Math.max(1, flat.length)) * 100);
  /* The terminals sit off the trail, so the page also offers the nearest open one
     as a plain button — otherwise they are easy to walk right past. */
  const openTerminal = nodes.find((n) => n.kind === "terminal" && stateOf(n, ctx) === "current");

  app.innerHTML = `${hud(player, `<span class="px-tiny">${esc(course.title)}</span>`)}
  <main class="px-wrap wide" style="padding-top:18px">
    <div class="pxw-head">
      <div style="flex:1;min-width:220px">
        <div class="px-kicker">${role} · ${units.length} 个区域 · ${flat.length} 讲</div>
        <h1 class="px-title" style="font-size:20px;margin:4px 0 2px">${esc(course.title)}</h1>
        <p class="px-sub" style="font-size:12px">${esc(course.promise || course.subtitle || "点亮的关卡才能往前走。")}</p>
      </div>
      <div class="pxw-meter">
        <div class="px-tiny">地图进度 ${done}%</div>
        <div class="pxw-meter-bar"><i style="width:${done}%"></i></div>
        <div class="px-tiny">已通关 ${cleared.size} / ${flat.length} · 星 ${player.stars ?? 0}</div>
      </div>
    </div>

    <div class="pxw-frame">
      <div class="pxw-scroll">
        <div class="pxw-world" style="aspect-ratio:${W} / ${height}">
          ${worldSvg(nodes, regions, route, curIdx, height)}
          ${regions.map((r) => regionSign(r, height, cleared)).join("")}
          ${nodes.map((n) => nodeHtml(n, ctx, units)).join("")}
        </div>
      </div>
      <div class="pxw-compass" aria-hidden="true">
        <span>N</span>
        <svg viewBox="0 0 24 24" shape-rendering="crispEdges">
          <rect x="11" y="3" width="2" height="18" fill="#b9b19a"/>
          <rect x="3" y="11" width="18" height="2" fill="#b9b19a"/>
          <polygon points="12,4 15,12 12,10 9,12" fill="#b42318"/>
          <polygon points="12,20 15,12 12,14 9,12" fill="#1f2124"/>
        </svg>
        <span>S</span>
      </div>
    </div>

    <div class="pxw-legend">
      <span><i class="lg clear"></i>已通关</span>
      <span><i class="lg current"></i>现在这里</span>
      <span><i class="lg locked"></i>未解锁</span>
      <span><i class="lg boss"></i>区域 Boss</span>
      <span><i class="lg terminal"></i>故障终端</span>
      <span class="px-tiny" style="margin-left:auto">点亮一格，路才通到下一格</span>
    </div>

    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
      ${openTerminal ? `<a class="px-btn primary" href="#/terminal/${encodeURIComponent(course.id)}/${encodeURIComponent(openTerminal.unitId)}" data-skip>故障终端 · 去修第 ${openTerminal.regionIndex + 1} 区的 bug</a>` : ""}
      <a class="px-btn ghost" href="#/course/${encodeURIComponent(course.id)}">课程大纲与项目</a>
      <a class="px-btn ghost" href="#/world/new">重测兴趣 · 换一门课</a>
      <span style="flex:1"></span>
      <span class="px-tiny">点地标看这一关，可以跳过板书直接挑战。</span>
    </div>
  </main>`;

  app.querySelectorAll("[data-node]").forEach((btn) => {
    btn.onclick = () => {
      const node = nodes.find((n) => n.key === btn.dataset.node);
      if (!node) return;
      if (btn.dataset.state === "locked") {
        toast("前一个地标还没点亮，路暂时通不过去。", "error");
        beep("bad");
        return;
      }
      beep("tap");
      if (node.kind === "lesson") openSheet(node, ctx, units, courseId);
      else if (node.kind === "terminal") openTerminalSheet(node, ctx, courseId);
      else navigate(`/battle/${encodeURIComponent(courseId)}/u:${encodeURIComponent(node.unitId)}`);
    };
  });
}

/* -------------------------------- pieces -------------------------------- */

function worldSvg(nodes, regions, route, curIdx, height) {
  const waves = Array.from({ length: 90 }, (_, i) => {
    const x = hash(i * 2.1) * W;
    const y = hash(i * 5.7) * height;
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="12" height="2" fill="#b7cdd8" opacity="0.75"/>`;
  }).join("");

  const walked = route.slice(0, Math.max(1, curIdx + 1));

  return `<svg class="pxw-bg" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" aria-hidden="true">
    <rect width="${W}" height="${height}" fill="#c7dbe4"/>
    ${waves}
    ${regions.map((r, i) => landmass(r, i)).join("")}
    ${regions.map((r) => decorations(r, route)).join("")}
    <path d="${curve(route)}" fill="none" stroke="#c9b48a" stroke-width="21" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>
    <path d="${curve(route)}" fill="none" stroke="#f0e5c6" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${curve(route)}" fill="none" stroke="#b19a6d" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>
    <path d="${curve(walked)}" fill="none" stroke="#cf8b1f" stroke-width="7" stroke-dasharray="5 9" stroke-linecap="round"/>
  </svg>`;
}

function regionSign(region, height, cleared) {
  const unit = region.unit;
  const lessons = unit.lessons ?? [];
  const got = lessons.filter((l) => cleared.has(l.id)).length;
  return `<div class="pxw-sign" style="left:50%;top:${((region.signY / height) * 100).toFixed(3)}%">
    <span class="no">R${String(region.ui + 1).padStart(2, "0")}</span>
    <b>${esc(unit.title)}</b>
    <span class="st">${got}/${lessons.length} 讲</span>
  </div>`;
}

function nodeHtml(node, ctx, units) {
  const state = stateOf(node, ctx);
  const pos = `left:${((node.x / W) * 100).toFixed(3)}%;top:${((node.y / ctx.height) * 100).toFixed(3)}%`;
  const unitNo = node.regionIndex + 1;

  if (node.kind === "lesson") {
    const title = String(node.lesson.title ?? "");
    const short = title.length > 10 ? `${title.slice(0, 10)}…` : title;
    const star = ctx.game.stars?.[node.id];
    return `<button class="pxw-node lesson ${state}" style="${pos}" data-node="${esc(node.key)}" data-state="${state}" title="${esc(title)}">
      ${state === "current" ? `<span class="pxw-hero">${sprite(ctx.track, "idle", 34)}</span>` : ""}
      <span class="mk"><span class="no">${String(node.li + 1).padStart(2, "0")}</span></span>
      <span class="nm">${esc(short)}</span>
      ${star ? `<span class="pxw-star">${stars(star)}</span>` : ""}
    </button>`;
  }

  if (node.kind === "terminal") {
    return `<button class="pxw-node terminal ${state}" style="${pos}" data-node="${esc(node.key)}" data-state="${state}" title="故障终端 · 改一行真代码，跑测试用例">
      <span class="mk">${terminalIcon(state)}</span>
      ${state === "current" ? `<span class="pxw-flag">可修</span>` : ""}
      <span class="nm">故障终端</span>
    </button>`;
  }

  const label = `第 ${unitNo} 区 Boss`;
  return `<button class="pxw-node boss ${state}" style="${pos}" data-node="${esc(node.key)}" data-state="${state}" title="${esc(label)}">
    <span class="mk">${castleIcon(state)}</span>
    <span class="nm">${esc(label)}</span>
  </button>`;
}

function stateOf(node, ctx) {
  if (node.kind === "lesson") {
    if (ctx.cleared.has(node.id)) return "clear";
    if (node.id === ctx.currentId) return "current";
    return "locked";
  }
  if (node.kind === "terminal") {
    if (ctx.terminalSolved(node.unitId)) return "clear";
    return ctx.regionReached(node.unitId) ? "current" : "locked";
  }
  if (ctx.cleared.has(`u:${node.unitId}`)) return "clear";
  return ctx.unitAllClear(node.unitId) ? "current" : "locked";
}

/* ------------------------------ level sheet ------------------------------ */

/* One sheet for every lesson: read it, or go straight into the fight. Skipping
   the board is the point — a learner who already knows the material should not
   have to sit through a lecture to prove it. */
function openSheet(node, ctx, units, courseId) {
  const lesson = node.lesson;
  const done = ctx.cleared.has(lesson.id);
  const unit = units.find((u) => u.id === node.unitId);

  const back = document.createElement("div");
  back.className = "px-sheet-back";
  back.innerHTML = `<div class="px-sheet">
    <div class="px-kicker">第 ${node.regionIndex + 1} 区 · 第 ${node.li + 1} 讲${done ? " · 已通关" : ""}</div>
    <h3 class="px-title" style="font-size:19px;margin:6px 0 4px">${esc(lesson.title)}</h3>
    <p class="px-sub">${esc(unit?.title ?? "")} · ${fmtMinutes(lesson.minutes ?? 12)} · ${lesson.quizTotal ? `${lesson.quizTotal} 道题` : "3 道题"}${lesson.prereq ? ` · 前置：${esc(lesson.prereq)}` : ""}</p>
    <p class="px-tiny" style="margin-top:12px;line-height:1.9">
      ${done ? "这一关打过了，再打一次可以刷星，星星只升不降。" : lesson.generated ? "可以直接挑战，不用先看板书。答错时会就地展开讲这道题的那一页。" : "这一讲还没生成板书，第一次进来要先生成内容，题目跟着一起出。"}
    </p>
    <div class="px-sheet-acts">
      ${lesson.generated || done
        ? `<button class="px-btn primary" id="fight">${done ? "再打一次" : "直接挑战"}</button>`
        : `<button class="px-btn" disabled title="还没生成题目">直接挑战</button>`}
      <button class="px-btn ghost" id="read">${lesson.generated ? "先看板书" : "生成板书并阅读"}</button>
      <span style="flex:1"></span>
      <button class="px-btn ghost" id="close">取消</button>
    </div>
  </div>`;

  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("mousedown", (e) => {
    if (e.target === back) close();
  });
  back.querySelector("#close").onclick = close;
  back.querySelector("#read").onclick = () => navigate(`/lesson/${encodeURIComponent(courseId)}/${encodeURIComponent(lesson.id)}`);
  const fight = back.querySelector("#fight");
  if (fight) fight.onclick = () => navigate(`/battle/${encodeURIComponent(courseId)}/${encodeURIComponent(lesson.id)}`);
}

/* The terminal is the one node that is not a quiz, so it gets its own sheet:
   what it is, what it costs, and one button into it. */
function openTerminalSheet(node, ctx, courseId) {
  const unit = node.unit;
  const solved = ctx.terminalSolved(node.unitId);
  const back = document.createElement("div");
  back.className = "px-sheet-back";
  back.innerHTML = `<div class="px-sheet">
    <div class="px-kicker">第 ${node.regionIndex + 1} 区 · 故障终端</div>
    <h3 class="px-title" style="font-size:19px;margin:6px 0 4px">${esc(unit?.title ?? "这一区")}：线上报错了</h3>
    <p class="px-sub">终端里放着一段能跑的代码，只坏了一行。把它改对，用例一条条变绿就算修好。</p>
    <ul class="px-tiny" style="margin:12px 0 0;padding-left:18px;line-height:2">
      <li>真代码、真运行，测试在浏览器里跑，不是选择题</li>
      <li>5 次尝试：第 3 次失败给提示，第 5 次直接给答案</li>
      <li>失败不扣心、不卡关——终端是练手，不是关卡屏障</li>
    </ul>
    <div class="px-sheet-acts">
      <button class="px-btn primary" id="go">${solved ? "再打开看看" : "开始检修"}</button>
      <span style="flex:1"></span>
      <button class="px-btn ghost" id="close">取消</button>
    </div>
  </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("mousedown", (e) => {
    if (e.target === back) close();
  });
  back.querySelector("#close").onclick = close;
  back.querySelector("#go").onclick = () => navigate(`/terminal/${encodeURIComponent(courseId)}/${encodeURIComponent(node.unitId)}`);
}
