/* Feeds a list of rendered strings through the real t() in a real browser, so a
   rule that looks right in the table but never fires in the app gets caught.

   Usage: node tools/check-i18n.mjs */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const BASE = process.env.BASE || "http://127.0.0.1:4173/";
const profile = path.resolve(".chrome-check-profile");
await rm(profile, { recursive: true, force: true });

/* Strings the app actually renders, copied from a live audit. */
const CASES = [
  "第 1 / 5 回合",
  "第 3/8 回合 · 剩余 2 颗心",
  "题目：下面哪个是块级元素",
  "升级了：LV.1 → LV.2",
  "当前 LV.2 · 340 XP",
  "看第 3 页",
  "UNIT 02 · 本讲练习",
  "下一讲：CSS像素风格样式实现",
  "场景：作品集页面的计数总是把所有条目都算进去",
  "问题：修好 readyCount",
  "代码 12 行，第 4 行写错了，只能改这一行：",
  "用例 1 ✗ · 期望 2，实际 3",
  "用例 2 ✓ · 通过",
  "用例 3 · readyCount([]) → 0",
  "期望 2，实际 3",
  "已经运行 3 次。",
  "剩余尝试 5 / 5",
  "把第 4 行改成",
  "提示：先看循环的边界",
  "还不对。还能试 4 次。",
  "第 1 区 · 故障终端",
  "故障终端 · 去修第 1 区的 bug",
  "第 1 区 · 第 2 讲",
  "3 道题",
  "解析 大纲.pdf 失败",
  "大纲.pdf 已解析：12 页，约 8k 字",
  "大纲.pdf 里没有可读文字。",
  "8k 字",
  "320 字",
  "前置 用HTML搭建像素页面骨架 ·",
  "像素风基础 · 单元测试",
  "今日复习 · 3 道到期错题",
  "请求失败（500）",
  "方向「界面工匠」 · 标准学期",
  "所以建议先按「界面工匠」这条路走。",
  "两条路都够格，所以先走「界面工匠」，另一个方向留作副手。",
  "所以你最该先补的是「响应式布局」。",
  "下一回合 →",
  "第 03 区",
  "3 / 12 讲",
  "已通关 2/12 · 星 13",

  /* console and sign-in: counts and sentences assembled around a name */
  "1 个管理员",
  "2 个管理员",
  "1 个账号",
  "2 个账号",
  "1 门课程",
  "3 门课程",
  "1 讲已生成",
  "24 讲已生成",
  "0 条阅读",
  "全部课程",
  "内置示例",
  "无归属",
  "（副本）",
  "删除「{name}」？",
  "取消「{name}」的管理员权限？",
  "删除《{title}》？",
  "这个账号名下 {courses} 门课程、{answers} 条答题记录会一起删掉，无法恢复。",
  "归属：{owner}。已生成的 {n} 讲内容、答题记录和笔记会一起删掉。",
];

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      /* still starting */
    }
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((res, rej) => pending.set(mid, { res, rej }));
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: 'try { localStorage.setItem("ui-lang", "en"); } catch {}',
});
await send("Page.navigate", { url: BASE });
await sleep(1800);

const r = await send("Runtime.evaluate", {
  awaitPromise: true,
  expression: `(async () => {
    const m = await import("/js/i18n.js");
    return JSON.stringify(${JSON.stringify(CASES)}.map((s) => [s, m.t(s)]));
  })()`,
  returnByValue: true,
});

const rows = JSON.parse(r.result.value || "[]");
let bad = 0;
for (const [zh, en] of rows) {
  if (en === zh) {
    bad++;
    console.log("UNCHANGED  " + zh);
  } else {
    console.log("ok  " + zh + "\n    -> " + en.replace(/\n/g, "\\n"));
  }
}
console.log(`\n${rows.length - bad}/${rows.length} translated`);
ws.close();
chrome.kill();
process.exit(bad ? 1 : 0);
