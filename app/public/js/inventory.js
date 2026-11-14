/* The inventory: 18 items, six dimensions, three directions.

   Structure follows Holland's RIASEC (via the O*NET Interest Profiler, which is
   Creative Commons licensed and explicitly allows adaptation). Item wording is
   rewritten for study activities rather than work activities, in Chinese — so
   this is an adaptation, not a validated Chinese version of the instrument.
   The direction mapping follows Acerado & Rabago (2014), who surveyed computing
   practitioners: application developers scored R-I-C, UI designers A-S-E,
   operations S-C-I. Frontend is our own extension (A + R + C) and is labelled
   as such in the UI. Nothing here is a verdict; it picks a starting point. */

export const LIKERT = [
  { v: 1, label: "完全不想" },
  { v: 2, label: "不太想" },
  { v: 3, label: "说不清" },
  { v: 4, label: "想试试" },
  { v: 5, label: "很想试" },
];

export const DIMS = {
  R: { name: "动手", code: "R", en: "Realistic", phrase: "东西坏了你更想拆开修，而不是先查半天资料" },
  I: { name: "探究", code: "I", en: "Investigative", phrase: "你想知道事情为什么这样运作，而不只是怎么用" },
  A: { name: "艺术", code: "A", en: "Artistic", phrase: "你在意成品看起来、用起来是什么感觉" },
  S: { name: "助人", code: "S", en: "Social", phrase: "你会先想别人用起来会卡在哪一步" },
  E: { name: "推动", code: "E", en: "Enterprising", phrase: "你愿意把东西推出去，让别人接受它" },
  C: { name: "秩序", code: "C", en: "Conventional", phrase: "你受不了混乱，喜欢把东西收拾到有秩序" },
};

const Q = {
  R: [
    "亲手把一段代码跑起来，看着页面出效果",
    "拆开一个能用的网站，弄清它的零件怎么拼的",
    "反复调试，直到报错消失",
  ],
  I: [
    "追问「为什么这样写更快」",
    "读文档或源码，把一个机制搞明白",
    "比较几种做法，挑出更优的那个",
  ],
  A: [
    "调颜色、间距、字体，让界面好看",
    "给一个产品想有记忆点的视觉风格",
    "用动效或插画表达一个概念",
  ],
  S: [
    "看别人怎么用产品，找出他们卡住的地方",
    "把技术讲给完全不懂的人听",
    "和同伴一起把想法讨论清楚",
  ],
  E: [
    "说服别人接受你的方案",
    "主导一个小项目，定计划、催进度",
    "把作品包装成能拿出去展示的东西",
  ],
  C: [
    "把代码整理得结构清晰、命名统一",
    "按规范写测试和文档",
    "管数据和配置，让系统稳定可维护",
  ],
};

/* Interleaved so the six dimensions do not arrive in blocks — otherwise the
   pattern is visible by the second screen and answers get gamed. */
const ORDER = ["R", "I", "A", "S", "E", "C"];

export const ITEMS = Array.from({ length: 3 }, (_, row) =>
  ORDER.map((dim) => ({ id: `${dim}${row + 1}`, dim, text: Q[dim][row] })),
)
  .flat()
  .map((item, i) => ({ ...item, index: i, segment: Math.floor(i / 6) }));

export const SEGMENTS = [
  { title: "第一段 · 入门大厅", line: "门开着，里面有三条路。先说你想不想。" },
  { title: "第二段 · 工坊", line: "桌上有半成品、有零件、也有别人留下的图纸。" },
  { title: "第三段 · 夜航", line: "灯只剩一盏。你打算用它照哪里。" },
];

export const TRACKS = {
  frontend: {
    key: "frontend",
    label: "前端",
    role: "界面工匠",
    tagline: "看得见的成品，改一行就能看到变化",
    weights: { R: 0.25, I: 0.15, A: 0.3, S: 0.1, E: 0.05, C: 0.15 },
    color: "#1d9e75",
    dark: "#0f6e56",
    soft: "#e1f5ee",
    presets: [
      { topic: "从零做一个像素风个人主页", why: "一个小作品装下布局、样式和交互" },
      { topic: "用 HTML+CSS 复刻一个你天天用的界面", why: "对着真实产品练还原度" },
      { topic: "让页面动起来：CSS 动画实战", why: "把审美变成能跑的代码" },
    ],
  },
  backend: {
    key: "backend",
    label: "后端",
    role: "机房守夜人",
    tagline: "别人看不见的那层，由你保证它不塌",
    weights: { R: 0.25, I: 0.35, A: 0.02, S: 0.03, E: 0.05, C: 0.3 },
    color: "#185fa5",
    dark: "#0c447c",
    soft: "#e6f1fb",
    presets: [
      { topic: "给一个小网站搭 API：从请求到数据", why: "走通一次完整的请求链路" },
      { topic: "用 JSON 文件做一个能存数据的小服务", why: "不依赖数据库也能理解持久化" },
      { topic: "登录是怎么实现的：会话与权限入门", why: "最常被问到、也最容易做错的一块" },
    ],
  },
  ui: {
    key: "ui",
    label: "UI 设计",
    role: "色板旅人",
    tagline: "同样的功能，你决定它看起来值多少钱",
    weights: { R: 0.05, I: 0.15, A: 0.4, S: 0.2, E: 0.15, C: 0.05 },
    color: "#d85a30",
    dark: "#993c1d",
    soft: "#faece7",
    presets: [
      { topic: "给一款工具 App 重做视觉规范", why: "从零建立一套可复用的规则" },
      { topic: "从草图到高保真：一个界面的完整设计流程", why: "走完设计与交付的全过程" },
      { topic: "信息架构：让用户三步找到想要的东西", why: "结构对了，界面才不靠猜" },
    ],
  },
};

export const TRACK_ORDER = ["frontend", "backend", "ui"];

export const EXPERIENCE = [
  { k: "frontend", t: "做过网页或界面", d: "写过 HTML/CSS，或改过别人的页面" },
  { k: "backend", t: "碰过接口或数据", d: "调过 API，或写过读写数据的脚本" },
  { k: "ui", t: "做过视觉或排版", d: "画过稿、做过海报，或调过设计规范" },
  { k: "none", t: "都没做过", d: "基本从零开始，这样最好" },
];

export const WEEKLY = [
  { k: "lt3", t: "不到 3 小时", d: "6 讲，三个区域", scale: "brief" },
  { k: "3to6", t: "3-6 小时", d: "12 讲，四个区域", scale: "standard" },
  { k: "gt6", t: "6 小时以上", d: "15 讲，五个区域", scale: "deep" },
];

/* "Did you already build something like this?" lowers the fit rather than
   hiding the direction: recommending what someone already knows wastes the
   course, but hiding it pretends the interest is not there. */
const DISCOUNT = 0.75;

export function scoreProfile({ answers = {}, did = [], weekly = "3to6" } = {}) {
  const sums = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  for (const item of ITEMS) {
    const v = Number(answers[item.id]);
    sums[item.dim] += Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 3;
  }

  const scores = {};
  for (const dim of Object.keys(sums)) scores[dim] = Math.round(((sums[dim] - 3) / 12) * 100);

  const fit = {};
  for (const key of TRACK_ORDER) {
    const w = TRACKS[key].weights;
    const raw = Object.entries(w).reduce((sum, [dim, weight]) => sum + weight * scores[dim], 0);
    fit[key] = Math.max(0, Math.round(raw * (did.includes(key) ? DISCOUNT : 1)));
  }

  const order = [...TRACK_ORDER].sort((a, b) => fit[b] - fit[a]);
  const track = order[0];
  const second = order[1];
  const mixed = fit[track] - fit[second] <= 10 && fit[second] >= 45 ? second : null;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const codes = ranked.slice(0, 2).map(([d]) => d);

  return { scores, fit, order, track, mixed, codes, sums, weekly };
}

export function interpretation(profile) {
  const [first, second] = profile.codes;
  const a = DIMS[first];
  const b = DIMS[second];
  const role = TRACKS[profile.track].role;
  const tail = profile.mixed
    ? `两条路都够格，所以先走「${role}」，另一个方向留作副手。`
    : `所以建议先按「${role}」这条路走。`;
  return `${a.phrase}；${b.phrase}。你的 ${first}（${a.name}）和 ${second}（${b.name}）最靠前，${tail}`;
}

export const scaleForWeekly = (weekly) => WEEKLY.find((w) => w.k === weekly)?.scale ?? "standard";

export const levelForExperience = (did = []) => {
  if (!did.length || did.includes("none")) return "beginner";
  return did.length >= 2 ? "guided" : "some";
};

/* The 60-item O*NET instrument takes 10-20 minutes; this is a 18-item
   adaptation and the result screen says so in as many words. */
export const INVENTORY_NOTE =
  "按 O*NET 兴趣量表（RIASEC 六维）结构改编的 18 题版本，不是官方验证量表。结果是兴趣起点，不是能力判定。";
