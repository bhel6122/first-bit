/* The console: accounts on one tab, courses on the other.

   Scope is deliberately boring — create, read, rename, delete. Nothing here
   generates: copying an existing course takes a click, asking the model for a
   new one takes a minute, and an operator should never be that minute away
   from the thing they meant to fix.

   Every action re-renders from the server's answer instead of patching the DOM
   in place. Two tabs open on one store would otherwise drift apart, and a
   stale "delete" button is the kind of bug that costs an account. */

import { state, api, esc, icon, toast, topbar, modal } from "./core.js";

const ROLE_LABEL = { admin: "管理员", user: "学习者" };

const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function renderAdmin(app) {
  app.innerHTML = `${topbar("admin")}
  <main class="adm">
    <header class="adm-head">
      <div>
        <div class="desk-kicker">FIRST-BIT · 控制台</div>
        <h1 class="adm-title">管理</h1>
      </div>
      <div class="adm-tabs" role="tablist">
        <button type="button" data-tab="users" class="active">${icon("user", 14)} 用户</button>
        <button type="button" data-tab="courses">${icon("book", 14)} 课程</button>
      </div>
    </header>
    <section class="adm-stats" id="adm-stats"></section>
    <section class="adm-body" id="adm-body"><p class="adm-empty">正在读取…</p></section>
  </main>`;

  const body = app.querySelector("#adm-body");
  const stats = app.querySelector("#adm-stats");
  const tabs = [...app.querySelectorAll("[data-tab]")];

  let data = null;
  /* `#/admin/courses` opens straight on the second tab — handy when sending
     somebody a link to a course problem. */
  let tab = location.hash.includes("/courses") ? "courses" : "users";

  const load = async () => {
    data = await api("/api/admin/overview");
    paintStats();
    paintBody();
  };

  function paintStats() {
    const s = data?.stats ?? {};
    const cells = [
      ["账号", s.users ?? 0, `${s.admins ?? 0} 个管理员`],
      ["课程", s.courses ?? 0, `${s.lessons ?? 0} 讲已生成`],
      ["答题记录", s.answers ?? 0, `${s.views ?? 0} 条阅读`],
      ["今日生成", s.usageToday ?? 0, data?.store?.engine === "redis" ? "数据：Redis" : "数据：本地文件"],
    ];
    stats.innerHTML = cells
      .map(([label, value, note]) => `<div class="adm-stat">
        <span class="adm-stat-label">${esc(label)}</span>
        <strong>${Number(value)}</strong>
        <span class="adm-stat-note">${esc(note)}</span>
      </div>`)
      .join("");
  }

  function paintBody() {
    tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    body.innerHTML = tab === "users" ? usersTable() : coursesTable();
    if (tab === "users") wireUsers();
    else wireCourses();
  }

  /* --------------------------------- users --------------------------------- */

  const usersTable = () => {
    const rows = data?.users ?? [];
    if (!rows.length) return `<p class="adm-empty">还没有账号。</p>`;
    return `<div class="adm-bar">
        <span class="adm-count">${rows.length} 个账号</span>
        <button class="btn btn-primary btn-sm" id="new-user">${icon("user", 14)} 新建账号</button>
      </div>
      <div class="adm-scroll"><table class="adm-table">
        <thead><tr>
          <th>账号</th><th>角色</th><th>注册</th><th>课程</th><th>课时</th><th>答题</th><th>今日</th><th class="adm-ops">操作</th>
        </tr></thead>
        <tbody>${rows
          .map((u) => `<tr>
            <td>
              <span class="adm-name">${esc(u.name)}</span>
              ${u.id === state.user?.id ? `<span class="adm-tag">你</span>` : ""}
            </td>
            <td><span class="adm-role ${u.role === "admin" ? "is-admin" : ""}">${esc(ROLE_LABEL[u.role] ?? u.role)}</span></td>
            <td class="adm-dim">${when(u.createdAt)}</td>
            <td class="adm-num">${u.courses}</td>
            <td class="adm-num">${u.lessons}</td>
            <td class="adm-num">${u.answers}</td>
            <td class="adm-num ${u.usedToday ? "" : "adm-dim"}">${u.usedToday}</td>
            <td class="adm-ops">
              <button class="adm-link" data-edit="${u.id}">改</button>
              <button class="adm-link" data-role="${u.id}">${u.role === "admin" ? "取消管理员" : "设管理员"}</button>
              <button class="adm-link danger" data-del="${u.id}">删除</button>
            </td>
          </tr>`)
          .join("")}</tbody>
      </table></div>`;
  };

  function wireUsers() {
    body.querySelector("#new-user")?.addEventListener("click", () => userDialog(null));

    body.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => userDialog(data.users.find((u) => u.id === b.dataset.edit))),
    );

    body.querySelectorAll("[data-role]").forEach((b) =>
      b.addEventListener("click", async () => {
        const u = data.users.find((x) => x.id === b.dataset.role);
        if (!u) return;
        const next = u.role === "admin" ? "user" : "admin";
        if (next === "user" && !confirm(`取消「${u.name}」的管理员权限？`)) return;
        try {
          data.users = (await api(`/api/admin/users/${encodeURIComponent(u.id)}`, {
            method: "PATCH",
            body: { role: next },
          })).users;
          paintBody();
          toast(next === "admin" ? `「${u.name}」现在是管理员` : `「${u.name}」已取消管理员`, "ok");
        } catch (e) {
          toast(e.message, "bad");
        }
      }),
    );

    body.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const u = data.users.find((x) => x.id === b.dataset.del);
        if (!u) return;
        const ok = await ask({
          title: `删除「${u.name}」？`,
          detail: `这个账号名下 ${u.courses} 门课程、${u.answers} 条答题记录会一起删掉，无法恢复。`,
          confirm: "删除账号",
        });
        if (!ok) return;
        try {
          const d = await api(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
          data.users = d.users;
          data.courses = d.courses;
          paintStats();
          paintBody();
          toast("账号已删除", "ok");
        } catch (e) {
          toast(e.message, "bad");
        }
      }),
    );
  }

  function userDialog(user) {
    const creating = !user;
    const overlay = modal(`<div class="modal-head">
        <div>
          <div class="modal-kicker">${creating ? "新建账号" : "编辑账号"}</div>
          <h2>${creating ? "给一个人开个座位" : esc(user.name)}</h2>
        </div>
      </div>
      <div class="adm-form">
        <label>用户名<input id="f-name" maxlength="16" value="${creating ? "" : esc(user.name)}" placeholder="3–16 位字母、数字、下划线或中文"></label>
        <label>密码<input id="f-pass" type="password" maxlength="72" placeholder="${creating ? "至少 6 位" : "留空则不修改"}"></label>
        <label class="adm-check"><input id="f-admin" type="checkbox" ${user?.role === "admin" ? "checked" : ""}> 管理员（可以进这个页面）</label>
        <p class="adm-err" id="f-err"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-quiet" data-cancel>取消</button>
        <button class="btn btn-primary" data-save>${creating ? "创建" : "保存"}</button>
      </div>`);

    const err = overlay.querySelector("#f-err");
    const nameEl = overlay.querySelector("#f-name");
    const passEl = overlay.querySelector("#f-pass");
    const adminEl = overlay.querySelector("#f-admin");
    overlay.querySelector("[data-cancel]").addEventListener("click", () => overlay.remove());
    nameEl.focus();

    overlay.querySelector("[data-save]").addEventListener("click", async () => {
      err.textContent = "";
      const name = nameEl.value.trim();
      const password = passEl.value;
      const role = adminEl.checked ? "admin" : "user";
      if (!name) return (err.textContent = "用户名不能为空。");
      if (creating && password.length < 6) return (err.textContent = "密码至少 6 位。");
      if (!creating && password && password.length < 6) return (err.textContent = "密码至少 6 位。");

      const btn = overlay.querySelector("[data-save]");
      btn.disabled = true;
      try {
        if (creating) {
          const d = await api("/api/admin/users", { method: "POST", body: { name, password, role } });
          data.users = d.users;
        } else {
          const patch = { name, role };
          if (password) patch.password = password;
          data.users = (await api(`/api/admin/users/${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: patch,
          })).users;
        }
        overlay.remove();
        paintStats();
        paintBody();
        toast(creating ? "账号已创建" : "已保存", "ok");
      } catch (e) {
        /* The server owns the rules (name taken, last admin, short password);
           repeating them here would mean keeping two copies of the truth. */
        err.textContent = e.message;
        btn.disabled = false;
      }
    });
  }

  /* -------------------------------- courses -------------------------------- */

  const coursesTable = () => {
    const rows = data?.courses ?? [];
    if (!rows.length) return `<p class="adm-empty">还没有课程。</p>`;
    return `<div class="adm-bar">
        <span class="adm-count">${rows.length} 门课程</span>
      </div>
      <div class="adm-scroll"><table class="adm-table">
        <thead><tr>
          <th>课程</th><th>归属</th><th>单元</th><th>课时</th><th>已生成</th><th>更新</th><th class="adm-ops">操作</th>
        </tr></thead>
        <tbody>${rows
          .map((c) => `<tr>
            <td>
              <span class="adm-name">${esc(c.title)}</span>
              ${c.demo ? `<span class="adm-tag">示例</span>` : ""}
              ${c.confirmed ? "" : `<span class="adm-tag warn">未确认</span>`}
            </td>
            <td class="${c.owner ? "" : "adm-dim"}">${esc(c.ownerName)}</td>
            <td class="adm-num">${c.units}</td>
            <td class="adm-num">${c.lessons}</td>
            <td class="adm-num">${c.generated}/${c.lessons}</td>
            <td class="adm-dim">${when(c.updatedAt)}</td>
            <td class="adm-ops">
              <button class="adm-link" data-look="${c.id}">查看</button>
              <button class="adm-link" data-edit="${c.id}">改</button>
              <button class="adm-link" data-copy="${c.id}">复制</button>
              <button class="adm-link danger" data-del="${c.id}">删除</button>
            </td>
          </tr>`)
          .join("")}</tbody>
      </table></div>`;
  };

  function wireCourses() {
    body.querySelectorAll("[data-look]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          lookCourse(await api(`/api/admin/courses/${encodeURIComponent(b.dataset.look)}`));
        } catch (e) {
          toast(e.message, "bad");
        }
      }),
    );

    body.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = data.courses.find((x) => x.id === b.dataset.edit);
        if (c) courseDialog(c);
      }),
    );

    body.querySelectorAll("[data-copy]").forEach((b) =>
      b.addEventListener("click", () => {
        const c = data.courses.find((x) => x.id === b.dataset.copy);
        if (c) copyDialog(c);
      }),
    );

    body.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const c = data.courses.find((x) => x.id === b.dataset.del);
        if (!c) return;
        const ok = await ask({
          title: `删除《${c.title}》？`,
          detail: `归属：${c.ownerName}。已生成的 ${c.generated} 讲内容、答题记录和笔记会一起删掉。`,
          confirm: "删除课程",
        });
        if (!ok) return;
        try {
          const d = await api(`/api/admin/courses/${encodeURIComponent(c.id)}`, { method: "DELETE" });
          data.courses = d.courses;
          data.users = d.users;
          paintStats();
          paintBody();
          toast("课程已删除", "ok");
        } catch (e) {
          toast(e.message, "bad");
        }
      }),
    );
  }

  function ownerOptions(selected) {
    return `<option value="">（无归属 · 公共）</option>${(data.users ?? [])
      .map((u) => `<option value="${esc(u.id)}" ${u.id === selected ? "selected" : ""}>${esc(u.name)}</option>`)
      .join("")}`;
  }

  function courseDialog(course) {
    const overlay = modal(`<div class="modal-head">
        <div>
          <div class="modal-kicker">编辑课程</div>
          <h2>${esc(course.title)}</h2>
        </div>
      </div>
      <div class="adm-form">
        <label>标题<input id="f-title" maxlength="120" value="${esc(course.title)}"></label>
        <label>副标题<input id="f-sub" maxlength="200" value="${esc(course.subtitle ?? "")}"></label>
        <label>归属<select id="f-owner">${ownerOptions(course.owner)}</select></label>
        <label class="adm-check"><input id="f-demo" type="checkbox" ${course.demo ? "checked" : ""}> 标记为公共示例（所有人可见）</label>
        <p class="adm-err" id="f-err"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-quiet" data-cancel>取消</button>
        <button class="btn btn-primary" data-save>保存</button>
      </div>`);

    const err = overlay.querySelector("#f-err");
    overlay.querySelector("[data-cancel]").addEventListener("click", () => overlay.remove());
    overlay.querySelector("[data-save]").addEventListener("click", async () => {
      err.textContent = "";
      const title = overlay.querySelector("#f-title").value.trim();
      if (!title) return (err.textContent = "标题不能为空。");
      const btn = overlay.querySelector("[data-save]");
      btn.disabled = true;
      try {
        const d = await api(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
          method: "PATCH",
          body: {
            title,
            subtitle: overlay.querySelector("#f-sub").value.trim(),
            owner: overlay.querySelector("#f-owner").value,
            demo: overlay.querySelector("#f-demo").checked,
          },
        });
        data.courses = d.courses;
        overlay.remove();
        paintBody();
        toast("课程已更新", "ok");
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    });
  }

  function copyDialog(course) {
    const overlay = modal(`<div class="modal-head">
        <div>
          <div class="modal-kicker">复制课程</div>
          <h2>${esc(course.title)}</h2>
        </div>
      </div>
      <div class="adm-form">
        <p class="adm-hint">复制会带上全部单元、课时和已生成的内容，但不带任何人的进度。</p>
        <label>新标题<input id="f-title" maxlength="120" value="${esc(`${course.title}（副本）`)}"></label>
        <label>归属<select id="f-owner">${ownerOptions(course.owner)}</select></label>
        <p class="adm-err" id="f-err"></p>
      </div>
      <div class="modal-actions">
        <button class="btn btn-quiet" data-cancel>取消</button>
        <button class="btn btn-primary" data-save>复制</button>
      </div>`);

    const err = overlay.querySelector("#f-err");
    overlay.querySelector("[data-cancel]").addEventListener("click", () => overlay.remove());
    overlay.querySelector("[data-save]").addEventListener("click", async () => {
      err.textContent = "";
      const btn = overlay.querySelector("[data-save]");
      btn.disabled = true;
      try {
        const d = await api("/api/admin/courses", {
          method: "POST",
          body: {
            from: course.id,
            title: overlay.querySelector("#f-title").value.trim() || null,
            owner: overlay.querySelector("#f-owner").value || null,
          },
        });
        data.courses = d.courses;
        overlay.remove();
        paintBody();
        toast("已复制", "ok");
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    });
  }

  function lookCourse(detail) {
    const units = (detail.units ?? [])
      .map(
        (u) => `<div class="adm-unit">
          <div class="adm-unit-title">${esc(u.title)}</div>
          <ol class="adm-lessons">${u.lessons
            .map(
              (l) =>
                `<li class="${l.generated ? "on" : ""}">${esc(l.title)}${l.generated ? "" : `<span class="adm-tag">未生成</span>`}</li>`,
            )
            .join("")}</ol>
        </div>`,
      )
      .join("");

    const overlay = modal(`<div class="modal-head">
        <div>
          <div class="modal-kicker">${esc(detail.ownerName)}</div>
          <h2>${esc(detail.title)}</h2>
        </div>
      </div>
      <div class="adm-outline">
        <p class="adm-hint">${esc(detail.subtitle || detail.promise || "")}</p>
        ${units || `<p class="adm-empty">这门课还没有单元。</p>`}
      </div>
      <div class="modal-actions">
        <button class="btn btn-quiet" data-cancel>关闭</button>
      </div>`);
    overlay.querySelector("[data-cancel]").addEventListener("click", () => overlay.remove());
  }

  /* A yes/no that looks like the rest of the console instead of `confirm()`. */
  function ask({ title, detail, confirm }) {
    return new Promise((resolve) => {
      const overlay = modal(`<div class="modal-head">
          <div><div class="modal-kicker">不可撤销</div><h2>${esc(title)}</h2></div>
        </div>
        <p class="adm-hint">${esc(detail)}</p>
        <div class="modal-actions">
          <button class="btn btn-quiet" data-no>取消</button>
          <button class="btn btn-primary btn-danger" data-yes>${esc(confirm)}</button>
        </div>`);
      overlay.querySelector("[data-no]").addEventListener("click", () => {
        overlay.remove();
        resolve(false);
      });
      overlay.querySelector("[data-yes]").addEventListener("click", () => {
        overlay.remove();
        resolve(true);
      });
      overlay.addEventListener("mousedown", (e) => {
        if (e.target === overlay) resolve(false);
      });
    });
  }

  tabs.forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      paintBody();
    }),
  );

  await load();
}
