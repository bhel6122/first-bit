/* Router. Hash-based so the app is one static shell plus JSON endpoints. */

import { state, loadSession } from "./core.js";
import { bindLangSwitch, translateDom, watchDom, t } from "./i18n.js";
import { renderLogin } from "./login.js";
import { renderAdmin } from "./admin.js";
import { renderHome, renderCreate, renderBuild } from "./home.js";
import { renderCourse } from "./course.js";
import { renderLesson } from "./classroom.js";
import { renderWorld } from "./world.js";
import { renderMap } from "./map.js";
import { renderBattle, clearBattleKeys } from "./battle.js";
import { renderTerminal } from "./terminal.js";
import { renderCraft } from "./craft.js";

const app = document.getElementById("app");

function cleanup() {
  try {
    state.player?.cleanup?.();
  } catch {
    /* a torn-down player must never block navigation */
  }
  state.player = null;
  clearBattleKeys();
  document.documentElement.classList.remove("px-mode");
  /* Result sheets live on <body> so they can float over the page, which means the
     router has to sweep them itself — otherwise they survive into the next page. */
  document.querySelectorAll(".px-modal-back").forEach((n) => n.remove());
  /* The tutor dock floats on <body> too, and it is page-specific. */
  document.querySelectorAll(".px-tutor-dock").forEach((n) => n.remove());
  document.body.style.overflow = "";
}

async function route() {
  cleanup();
  const raw = location.hash.replace(/^#/, "") || "/";
  const path = raw.split("?")[0];
  const parts = path.split("/").filter(Boolean);
  window.scrollTo({ top: 0 });

  try {
    /* Nobody sees a shelf until we know whose shelf it is. The check happens
       before any route renders, so a signed-out visitor never sees a flash of
       someone else's course list. */
    if (parts[0] === "login") {
      if (await loadSession()) {
        location.hash = "/";
        return;
      }
      return await renderLogin(app);
    }
    if (!(await loadSession())) {
      location.hash = "/login";
      return;
    }

    if (!parts.length) return await renderHome(app);
    if (parts[0] === "create") return await renderCreate(app);
    /* The console is gated twice on purpose: here so a normal learner is simply
       sent home, and again on every API call, because the URL is guessable. */
    if (parts[0] === "admin") {
      if (state.user?.role !== "admin") {
        location.hash = "/";
        return;
      }
      return await renderAdmin(app);
    }
    if (parts[0] === "build" && parts[1]) return await renderBuild(app, decodeURIComponent(parts[1]));
    if (parts[0] === "course" && parts[1]) return await renderCourse(app, decodeURIComponent(parts[1]));
    if (parts[0] === "lesson" && parts[1] && parts[2])
      return await renderLesson(app, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));

    /* --- the game side --- */
    if (parts[0] === "world") return await renderWorld(app, { reset: parts[1] === "new" });
    if (parts[0] === "map" && parts[1]) {
      document.documentElement.classList.add("px-mode");
      return await renderMap(app, decodeURIComponent(parts[1]));
    }
    if (parts[0] === "battle" && parts[1] && parts[2]) {
      document.documentElement.classList.add("px-mode");
      return await renderBattle(app, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    }
    if (parts[0] === "terminal" && parts[1] && parts[2]) {
      document.documentElement.classList.add("px-mode");
      return await renderTerminal(app, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    }
    if (parts[0] === "craft" && parts[1] && parts[2]) {
      document.documentElement.classList.add("px-mode");
      return await renderCraft(app, decodeURIComponent(parts[1]), decodeURIComponent(parts[2]));
    }

    location.hash = "/";
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div style="min-height:100vh;display:grid;place-items:center;padding:24px">
      <div style="max-width:520px;text-align:center">
        <div class="eyebrow">SOMETHING BROKE</div>
        <h1 style="font-family:var(--serif);font-size:30px;margin:10px 0">页面没加载出来</h1>
        <p style="color:var(--muted);font-size:14px;line-height:1.7">${String(e.message ?? e)}</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="location.hash='/'">回到首页</button>
      </div></div>`;
  }
}

bindLangSwitch();
watchDom();

/* Screens are template strings painted once per route, then patched by later
   async work. Translate once the paint is done; the observer covers the patches. */
async function paint() {
  await route();
  translateDom();
  document.title = t("first-bit · 课程工坊");
}

window.addEventListener("hashchange", paint);
paint();
