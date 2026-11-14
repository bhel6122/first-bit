/* Pixel furniture: characters, monsters, the HUD, and 8-bit beeps.

   Everything is drawn inline as SVG on a 24×24 grid with crispEdges, so there
   are no image files to ship and it stays sharp at any size. Sound is generated
   with Web Audio — two oscillators, no assets. */

import { t, langSwitch } from "./i18n.js";


import { TRACKS } from "./inventory.js";
import { esc } from "./core.js";

const INK = "#1f2124";
const SKIN = "#f2c9a0";
const HAIR = "#2b2b2b";

const px = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

export function sprite(track = "frontend", mood = "idle", size = 64) {
  const t = TRACKS[track] ?? TRACKS.frontend;
  const armY = mood === "up" ? 8 : 12;
  const parts = [
    px(6, 22, 12, 2, "rgba(31,33,36,0.14)"),
    px(8, 4, 8, 7, SKIN),
    px(8, 3, 8, 2, HAIR),
    px(9, 7, 1, 2, INK),
    px(14, 7, 1, 2, INK),
    px(7, 11, 10, 7, t.color),
    px(5, 12, 2, 5, SKIN),
    px(17, armY, 2, 5, SKIN),
    px(8, 18, 3, 4, INK),
    px(13, 18, 3, 4, INK),
  ];

  if (track === "frontend") {
    parts.push(px(11, 13, 2, 2, "#ffffff"), px(15, 13, 1, 1, "#ffffff"));
  } else if (track === "backend") {
    parts.push(px(11, 13, 2, 5, INK), px(13, 14, 1, 1, t.color), px(12, 16, 2, 1, "#ffffff"));
  } else {
    parts.push(px(18, mood === "up" ? 6 : 10, 3, 3, "#ef9f27"), px(19, mood === "up" ? 5 : 9, 1, 1, "#d4537e"));
  }

  if (mood === "up") parts.push(px(3, 8, 2, 2, "#ef9f27"), px(19, 3, 2, 2, "#ef9f27"));

  return `<svg class="sprite ${mood === "idle" ? "px-float" : "px-pop"}" width="${size}" height="${size}" viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true">${parts.join("")}</svg>`;
}

export function monster(kind = "quiz", size = 64) {
  const big = kind === "boss";
  const body = big ? "#4b2a5e" : "#5b3a72";
  const parts = [
    px(5, 20, 14, 2, "rgba(31,33,36,0.14)"),
    px(6, 7, 12, 12, body),
    px(7, 5, 3, 2, body),
    px(14, 5, 3, 2, body),
    px(8, 2, 2, 3, body),
    px(14, 2, 2, 3, body),
    px(9, 10, 2, 2, "#fffdf4"),
    px(13, 10, 2, 2, "#fffdf4"),
    px(9, 10, 2, 2, "#fffdf4"),
    px(9, 15, 6, 1, "#2b2b2b"),
  ];
  if (big) parts.push(px(4, 9, 2, 6, body), px(18, 9, 2, 6, body));
  return `<svg class="monster" width="${size}" height="${size}" viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true">${parts.join("")}</svg>`;
}

export const stars = (n) => "★".repeat(Math.max(0, Math.min(3, n))) + "☆".repeat(3 - Math.max(0, Math.min(3, n)));

export function hud(player = {}, extra = "", label = "闯关") {
  const pct = Math.max(0, Math.min(100, Math.round(((player.into ?? 0) / (player.next || 100)) * 100)));
  return `<header class="px-hud">
    <a class="px-home" href="#/" title="${esc(t("回到课程书架"))}">${esc(t("← 首页"))}</a>
    <span class="px-crumb">FIRST-BIT · ${esc(t(label))}</span>
    <span class="spacer"></span>
    ${extra}
    <span class="px-level">
      <span class="px-badge">LV.${player.level ?? 1} ${esc(t(player.title ?? "学徒"))}</span>
      <span class="px-bar"><i style="width:${pct}%"></i></span>
      <span>${player.xp ?? 0} XP</span>
    </span>
    <span class="px-badge">${esc(t("★ {n}", { n: player.stars ?? 0 }))}</span>
    ${langSwitch()}
  </header>`;
}

/* -------------------------------- sound --------------------------------- */

let ctx = null;
const soundOn = () => localStorage.getItem("px-sound") !== "off";

export function toggleSound() {
  const next = localStorage.getItem("px-sound") === "off" ? "on" : "off";
  localStorage.setItem("px-sound", next);
  return next === "on";
}

export function soundEnabled() {
  return soundOn();
}

export function beep(kind = "tap") {
  if (!soundOn()) return;
  try {
    ctx = ctx ?? new (window.AudioContext ?? window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    const seq = {
      tap: [[520, 0.05]],
      ok: [[660, 0.06], [880, 0.08]],
      bad: [[180, 0.12], [140, 0.12]],
      win: [[660, 0.07], [880, 0.07], [1180, 0.14]],
      level: [[520, 0.06], [660, 0.06], [880, 0.06], [1180, 0.16]],
    }[kind] ?? [[520, 0.05]];

    let at = ctx.currentTime;
    for (const [freq, dur] of seq) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.035, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur);
      at += dur * 0.9;
    }
  } catch {
    /* audio is a bonus, never a blocker */
  }
}

/* -------------------------------- helpers -------------------------------- */

export const el = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const pctText = (n) => `${Math.round(Number(n) || 0)}%`;

export function mountPage(app, inner) {
  app.innerHTML = inner;
  document.documentElement.classList.add("px-mode");
}

export function unmountPage() {
  document.documentElement.classList.remove("px-mode");
}
