/* Sign in and sign up. One page, two modes.

   There is no email step on purpose: an email flow needs a provider, a domain
   and a deliverability story, none of which this project has. What accounts buy
   here is narrow and worth it anyway — your courses, notes and progress belong
   to you and are invisible to the next person who opens the link. */

import { state, api, esc, icon } from "./core.js";
import { langSwitch } from "./i18n.js";

export async function renderLogin(app) {
  const registering = location.hash.includes("register");

  app.innerHTML = `
  <main class="auth">
    <section class="auth-say">
      <div class="desk-kicker">FIRST-BIT · 课程工坊</div>
      <h1 class="desk-title">让学习的开始<br>不再犹豫</h1>
      <p class="desk-note">不必再花时间挑选学习路线，只需要输入学习主题，即刻为你生成可行的学习路线和课程。让学习不再停留在“不知从何做起”这一步。</p>
    </section>

    <section class="auth-card">
      <div class="auth-lang">${langSwitch()}</div>
      <h2>${registering ? "建一个账号" : "登录"}</h2>
      <p class="auth-sub">${registering ? "用户名会显示在顶栏，之后改不了。" : "接着上次的课往下走。"}</p>

      <form id="auth-form" autocomplete="on">
        <label class="auth-field">
          <span>用户名</span>
          <input id="auth-name" name="username" autocomplete="username" maxlength="16"
                 placeholder="${registering ? "3–16 位，字母数字下划线或中文" : "你的用户名"}" required>
        </label>
        <label class="auth-field">
          <span>密码</span>
          <input id="auth-pass" name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}"
                 maxlength="72" placeholder="${registering ? "至少 6 位" : "你的密码"}" required>
        </label>
        ${registering ? `<label class="auth-field">
          <span>再输一次</span>
          <input id="auth-pass2" type="password" autocomplete="new-password" maxlength="72" placeholder="确认密码" required>
        </label>` : ""}

        <p class="auth-error" id="auth-error" role="alert"></p>
        <button class="btn btn-primary auth-submit" type="submit" id="auth-go">
          ${registering ? "注册并开始" : "登录"} ${icon("arrow", 15)}
        </button>
      </form>

      <p class="auth-switch">
        ${registering
          ? `已经有账号？<a href="#/login">去登录</a>`
          : `第一次来？<a href="#/login/register">建一个账号</a>`}
      </p>
    </section>
  </main>`;

  const form = app.querySelector("#auth-form");
  const errbox = app.querySelector("#auth-error");
  const go = app.querySelector("#auth-go");
  const pass = app.querySelector("#auth-pass");
  const pass2 = app.querySelector("#auth-pass2");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errbox.textContent = "";
    const name = app.querySelector("#auth-name").value.trim();
    const password = pass.value;

    if (!name || !password) return (errbox.textContent = "用户名和密码都要填。");
    if (registering && pass2 && pass2.value !== password) {
      return (errbox.textContent = "两次输入的密码不一样。");
    }

    go.disabled = true;
    go.textContent = registering ? "正在建账号…" : "正在登录…";
    try {
      const d = await api(registering ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: { name, password },
      });
      state.user = d.user ?? null;
      /* Full reload instead of a hash change: config, courses and player state
         all belong to the account that just signed in. */
      location.hash = "/";
      location.reload();
    } catch (err) {
      errbox.textContent = err.message || "没成功，再试一次。";
      go.disabled = false;
      go.innerHTML = `${registering ? "注册并开始" : "登录"} ${icon("arrow", 15)}`;
    }
  });

  app.querySelector("#auth-name")?.focus();
}
