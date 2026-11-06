// 用极简 React 替身跑 client.js，验证渲染逻辑、搜索过滤、删除撤销这些纯逻辑。
// 不是真实 DOM 测试，但能抓住 hook 误用、undefined 引用、过滤/分组算错。

const calls = [];
const results = [];
const check = (label, pass, extra) =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  — " + extra : ""}`);

// —— 极简 React：每次 render 顺序取用 hook 槽位 ——
let slots = [];
let cursor = 0;
let effects = [];
let pendingRender = null;

function useState(init) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
  const set = (v) => {
    slots[i] = typeof v === "function" ? v(slots[i]) : v;
    if (pendingRender) pendingRender();
  };
  return [slots[i], set];
}
function useMemo(fn) {
  return fn();
}
function useRef(init) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = { current: init };
  return slots[i];
}
function useEffect(fn) {
  const i = cursor++;
  effects.push({ i, fn });
}
function rerender(Component, props) {
  cursor = 0;
  effects = [];
  return Component(props);
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9) }),
  useState,
  useEffect,
  useMemo,
  useRef,
};

// —— 模块 loader 替身 ——
let plugin = null;
global.window = {
  __ModuleLoader__: { load: ({ id, factory }) => { plugin = factory(requireStub); } },
  innerWidth: 1400,
  innerHeight: 900,
};
const requireStub = (spec) => {
  if (spec === "react") return React;
  throw new Error("未预期的 require: " + spec);
};
global.localStorage = {
  _v: {},
  getItem(k) { return this._v[k] ?? null; },
  setItem(k, v) { this._v[k] = v; },
};
const headTags = [];
global.document = {
  addEventListener() {},
  removeEventListener() {},
  getElementById() { return null; },
  createElement(tag) {
    return { tagName: tag, dataset: {}, textContent: "", remove() { headTags.splice(headTags.indexOf(this), 1); } };
  },
  head: { appendChild(el) { headTags.push(el); } },
};
global.setTimeout = (fn) => fn();

// —— 载入 client.js ——
const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../client.js", import.meta.url), "utf8");
// 测试替身不模拟流式 fetch：显式关掉全局 fetch，让 optimize 走 rpc 回退路径，
// 否则 Node 18+ 的全局 fetch 会把相对 URL "/api/..." 报成 "Failed to parse URL"。
global.fetch = undefined;
// 在 window 存在的环境下执行
new Function("window", "localStorage", "document", "setTimeout", "require", src)(
  global.window,
  global.localStorage,
  global.document,
  global.setTimeout,
  undefined
);
check("client.js 成功注册 factory", !!plugin);
check("插件声明 inject", Array.isArray(plugin.inject) && plugin.inject.includes("slots"));

// —— 抓出 slot 注册与组件 ——
let registered = null;
const fakeRpc = {
  call: (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 2, snippets: DATA } });
    if (endpoint === "delete") {
      return Promise.resolve({ ok: true, value: { version: 2, snippets: DATA.filter((s) => s.id !== payload.id) } });
    }
    if (endpoint === "restore") return Promise.resolve({ ok: true, value: { version: 2, snippets: DATA } });
    if (endpoint === "optimize") return Promise.resolve({ ok: true, value: { optimized: "优化后的文本" } });
    if (endpoint === "touch") return Promise.resolve({ ok: true, value: {} });
    if (endpoint === "export") {
      return Promise.resolve({
        ok: true,
        value: { json: "{}", count: DATA.length, path: "C:\\fake\\exports\\snippets.json" },
      });
    }
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  },
};
const injected = [];
const effectsRun = [];
const ctx = {
  connection: { rpc: fakeRpc },
  effect(cb, label) { const dispose = cb(); effectsRun.push({ label, dispose }); return dispose; },
  slots: {
    inject(key, cb) { injected.push(key); cb(); },
    register(options, Component) { registered = { options, Component }; return () => {}; },
  },
};

const DATA = [
  { id: "1", name: "代码审查", category: "开发", content: "请审查这段代码 {{代码}}", createdAt: 1, updatedAt: 1, deletedAt: null },
  { id: "2", name: "周报", category: "写作", content: "总结本周工作 {{要点}}", createdAt: 2, updatedAt: 2, deletedAt: null },
  { id: "3", name: "无分类项", category: null, content: "hello world", createdAt: 3, updatedAt: 3, deletedAt: null },
];

plugin.apply(ctx);
check("注册到 conversation.input.right", registered?.options?.name === "conversation.input.right");
check("slot id 正确", registered?.options?.id === "prompt-snippets");
check("inject 带出 rpc", typeof registered?.options?.inject === "function");

// —— §2.6 主题：样式注入 ——
check("通过 ctx.effect 挂载了样式表", effectsRun.some((e) => e.label === "prompt-snippets theme"));
const styleTag = headTags[0];
check("样式标签注入到 document.head", !!styleTag && styleTag.tagName === "style");
check("样式表带插件归属标记", styleTag?.dataset?.plugin === "dsh-prompt-snippets");
const cssText = styleTag?.textContent || "";
// 滚动条交给 ui-theme 的全局 scrollbar.css：自己再写会与 scrollbar-color 打架
check("不重复声明滚动条规则", !cssText.includes("::-webkit-scrollbar") && !cssText.includes("scrollbar-color"));
check("hover 底色从前景派生（浅深都可见）", cssText.includes(".ps-item:hover") && cssText.includes("color-mix") && cssText.includes("label-primary"));
check("样式表含焦点环规则", cssText.includes("focus-visible"));
check("样式表含 warn 派生底色", cssText.includes("color-mix") && cssText.includes(".ps-warn"));
// 清理函数真的摘掉标签
effectsRun.find((e) => e.label === "prompt-snippets theme")?.dispose?.();
check("dispose 后样式标签被移除", headTags.length === 0);

// 模拟平台 locale 服务：注册字典、绑定 t、提供 subscribe
const clientSrc = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const zhDict = {};
const zhMatch = clientSrc.match(/const zh = \{([\s\S]*?)\n    \};/);
if (zhMatch) {
  for (const line of zhMatch[1].split("\n")) {
    const kv = line.trim().match(/^"([^"]+)":\s*"([^"]*)",?$/);
    if (kv) zhDict[kv[1]] = kv[2];
  }
}
const fakeLocale = {
  register() { /* no-op */ },
  bind() {
    return (key, params) => {
      const template = zhDict[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
    };
  },
  subscribe() { return () => {}; },
};

const props = { ...registered.options.inject(), inputActions: null, t: fakeLocale.bind("prompt-snippets"), localeSubscribe: fakeLocale.subscribe };
let tree = rerender(registered.Component, props);
check("首屏渲染出 dock 容器", tree?.type === "div");
const btn = tree.children.find((c) => c && c.props && c.props.id === "ps-button");
check("渲染出片段库按钮", !!btn && btn.children.includes("📋 片段库"));

// —— 绑定 inputActions 并展开面板 ——
const inserted = [];
props.inputActions = {
  captureInsertion: () => ({ from: 0, to: 0 }),
  insertText: (t) => { inserted.push(t); return true; },
};
await registered.Component(props); // 触发 effect 里的 load
const listEffects = effects.map((e) => e.fn);
// 手动跑首次 useEffect（load）并等待 promise
const loadFn = listEffects[0];
if (typeof loadFn === "function") loadFn();
await new Promise((r) => setImmediate(r));
check("挂载时调用了 list", calls.some((c) => c.endpoint === "list"));
check("请求走了正确 channel", calls.every((c) => c.channel === "/prompt-snippets"));

// 展开面板
const toggleBtn = rerender(registered.Component, props).children.find((c) => c?.props?.id === "ps-button");
toggleBtn.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
await new Promise((r) => setImmediate(r));
tree = rerender(registered.Component, props);
const panel = tree.children.find((c) => c?.props?.id === "ps-panel");
check("点击后渲染出面板", !!panel);

const flat = (node) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (typeof n === "string" || typeof n === "number") { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
};
const panelText = flat(panel).filter((x) => typeof x === "string");
check("面板显示三个片段名", ["代码审查", "周报", "无分类项"].every((n) => panelText.includes(n)), panelText.join("|"));
check("有分类分组标题", panelText.includes("开发") && panelText.includes("写作"));
check("渲染了搜索框", flat(panel).some((x) => x?.props?.placeholder?.includes("搜索")));

// —— 搜索过滤 ——
const findInput = (t) => flat(t).find((x) => x?.props && typeof x.props.placeholder === "string" && x.props.placeholder.includes("搜索"));
let input = findInput(rerender(registered.Component, props));
input.props.onChange({ target: { value: "代码" } });
tree = rerender(registered.Component, props);
input = findInput(tree);
check("搜索后只剩命中项", input.props.value === "代码");
const p2 = tree.children.find((c) => c?.props?.id === "ps-panel");
const t2 = flat(p2).filter((x) => typeof x === "string");
// 名称被高亮拆成 mark("代码") + "审查"，完整字符串不再存在，改验证高亮节点与残留文本
const marks2 = flat(p2).filter((x) => x?.type === "mark");
check("过滤结果正确（含代码审查）", t2.includes("审查") && marks2.length >= 1 && marks2.some((m) => m.children?.includes("代码")));
check("过滤结果正确（不含周报）", !t2.includes("周报"));

// 搜分类名也能命中
input.props.onChange({ target: { value: "写作" } });
tree = rerender(registered.Component, props);
const t3 = flat(tree.children.find((c) => c?.props?.id === "ps-panel")).filter((x) => typeof x === "string");
check("按分类名搜索命中周报", t3.includes("周报") && !t3.includes("代码审查"));

// 搜正文
findInput(tree).props.onChange({ target: { value: "hello" } });
tree = rerender(registered.Component, props);
const t4 = flat(tree.children.find((c) => c?.props?.id === "ps-panel")).filter((x) => typeof x === "string");
check("按正文搜索命中无分类项", t4.includes("无分类项"));

// 无命中
findInput(tree).props.onChange({ target: { value: "zzz不存在" } });
tree = rerender(registered.Component, props);
const t5 = flat(tree.children.find((c) => c?.props?.id === "ps-panel")).filter((x) => typeof x === "string");
check("无命中给出提示", t5.some((x) => x.includes("没有匹配")));

// 清空恢复
findInput(tree).props.onChange({ target: { value: "" } });
tree = rerender(registered.Component, props);
const t6 = flat(tree.children.find((c) => c?.props?.id === "ps-panel")).filter((x) => typeof x === "string");
check("清空后全部回来", ["代码审查", "周报", "无分类项"].every((n) => t6.includes(n)));

// —— 点击插入：无变量的直接插 ──
const findRowBtn = (tree, label) =>
  flat(tree.children.find((c) => c?.props?.id === "ps-panel")).find(
    (x) => x?.props?.onClick && Array.isArray(x.children) && x.children.includes(label)
  );
let plainBtn = findRowBtn(tree, "无分类项");
const beforeTouch0 = calls.filter((c) => c.endpoint === "touch").length;
plainBtn.props.onClick();
check("无变量片段直接调用 insertText", inserted.length === 1, String(inserted.length));
check("直插的是原文", inserted[0] === "hello world");
const touch0 = calls.filter((c) => c.endpoint === "touch").slice(-1)[0];
check("直插后发 touch", calls.filter((c) => c.endpoint === "touch").length === beforeTouch0 + 1);
check("直插 touch 带片段 id", touch0?.payload?.ids?.[0] === "3", JSON.stringify(touch0?.payload));

// 插入成功会关面板，后续步骤要重新打开
const reopen = () => {
  let t = rerender(registered.Component, props);
  if (!t.children.find((c) => c?.props?.id === "ps-panel")) {
    const b = t.children.find((c) => c?.props?.id === "ps-button");
    b.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    t = rerender(registered.Component, props);
  }
  return t;
};

// —— §2.5：有变量无元数据 → 弹表单，不直插 ──
tree = reopen();
inserted.length = 0;
findRowBtn(tree, "代码审查").props.onClick();
check("有变量无元数据时不直插", inserted.length === 0, inserted.join("|"));
tree = rerender(registered.Component, props);
let panelT = flat(tree.children.find((c) => c?.props?.id === "ps-panel")).filter((x) => typeof x === "string");
check("弹出了占位符表单", panelT.some((x) => x.includes("填写「代码审查」的占位符")), panelT.join("|"));
check("表单里有变量输入框", flat(tree).some((x) => x?.props?.placeholder === "" && (x?.props?.className === "ps-input" || x?.props?.className === "ps-textarea")));

// ══════════ §2.5 表单：必填禁用、填值后插入、保留占位符插入 ══════════
{
  // 构造：必填变量 + 有默认值的非必填变量
  const SAMPLE = {
    id: "req",
    name: "带必填",
    category: "开发",
    content: "请审查 {{代码}}，关注 {{关注点}}。",
    variables: { 代码: { required: true }, 关注点: { default: "正确性" } },
    revision: 3,
    deletedAt: null,
  };
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 3, snippets: [SAMPLE] } });
    if (endpoint === "save") {
      return Promise.resolve({ ok: true, value: { version: 3, snippets: [{ ...SAMPLE, revision: 4 }] } });
    }
    if (endpoint === "get") return Promise.resolve({ ok: true, value: { snippet: { ...SAMPLE, name: "服务器版", revision: 9 } } });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };
  // 重置 ui 状态：关面板再开，触发 load 拿新数据
  let t = rerender(registered.Component, props);
  const btn = t.children.find((c) => c?.props?.id === "ps-button");
  if (t.children.find((c) => c?.props?.id === "ps-panel")) btn.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  t = rerender(registered.Component, props);
  const openPanel = () => {
    let x = rerender(registered.Component, props);
    if (!x.children.find((c) => c?.props?.id === "ps-panel")) {
      x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
      x = rerender(registered.Component, props);
    }
    return x;
  };
  const panelOf = (x) => x.children.find((c) => c?.props?.id === "ps-panel");
  const allNodes = (x) => flat(x);
  const findBtnByText = (x, txt) => allNodes(x).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === txt);

  // 先确保拿到新数据：关面板 → 再开，开关会触发 load()
  t = openPanel();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  const row = findBtnByText(t, "带必填");
  check("新数据已载入", !!row, flat(panelOf(t)).filter((x) => typeof x === "string").join("|"));
  inserted.length = 0;
  row.props.onClick();
  t = rerender(registered.Component, props);
  let pTxt = flat(panelOf(t)).filter((x) => typeof x === "string");
  check("必填变量弹表单不直插", inserted.length === 0 && pTxt.some((x) => x.includes("填写「带必填」")));

  // 插入按钮在必填未填时应禁用
  let insBtn = findBtnByText(t, "插入");
  check("必填空着时插入按钮禁用", insBtn?.props?.disabled === true);

  // 填必填项（「代码」因变量名含「代码」渲染为 textarea，「关注点」仍是单行 input）
  const inputs = allNodes(panelOf(t)).filter(
    (n) => n?.props?.className === "ps-input" || n?.props?.className === "ps-textarea"
  );
  check("表单为每个变量渲染一个输入框", inputs.length === 2, String(inputs.length));
  inputs[0].props.onChange({ target: { value: "这段代码" } });
  t = rerender(registered.Component, props);
  insBtn = findBtnByText(t, "插入");
  check("填了必填后插入按钮可用", insBtn?.props?.disabled === false);
  insBtn.props.onClick();
  check("表单提交后插入渲染结果", inserted[0] === "请审查 这段代码，关注 正确性。", inserted[0]);
  check("插入后关闭面板", !panelOf(rerender(registered.Component, props)));

  // 保留占位符插入
  inserted.length = 0;
  t = openPanel();
  findBtnByText(t, "带必填").props.onClick();
  t = rerender(registered.Component, props);
  findBtnByText(t, "保留占位符插入").props.onClick();
  check("保留占位符插入原文", inserted[0] === "请审查 {{代码}}，关注 {{关注点}}。", inserted[0]);

  // ══════════ §2.4 行内编辑 ══════════
  inserted.length = 0;
  t = openPanel();
  const editBtn = allNodes(panelOf(t)).find((n) => n?.props?.["aria-label"] === "编辑「带必填」");
  check("列表行有编辑按钮", !!editBtn);
  editBtn.props.onClick();
  t = rerender(registered.Component, props);
  let eTxt = flat(panelOf(t)).filter((x) => typeof x === "string");
  check("展开行内编辑器", eTxt.includes("名称") && eTxt.includes("正文（用 {{变量名}} 标记占位符，\\{{ 输出字面量）"));
  check("编辑器带出原值", allNodes(panelOf(t)).some((n) => n?.props?.value === "带必填"));
  check("编辑器列出变量", eTxt.includes("{{代码}}") && eTxt.includes("{{关注点}}"));
  // 编辑器里现在有多个 checkbox（收藏置顶 + 每个变量的必填），必须按「checked 为 true」定位
  // 必填的那个，否则会误取到收藏置顶那个未勾选的。
  const reqBox = allNodes(panelOf(t)).find((n) => n?.props?.type === "checkbox" && n?.props?.checked === true);
  check("必填勾选框反映原状态", reqBox?.props?.checked === true);

  // 改名后保存，payload 必须带 id + expectedRevision
  const nameInput = allNodes(panelOf(t)).find((n) => n?.props?.className === "ps-input" && n?.props?.value === "带必填");
  nameInput.props.onChange({ target: { value: "改名后" } });
  t = rerender(registered.Component, props);
  const saveBtn = findBtnByText(t, "保存");
  calls.length = 0;
  saveBtn.props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  const saveCall = calls.find((c) => c.endpoint === "save");
  check("保存走 save 端点", !!saveCall);
  check("保存带 id", saveCall?.payload?.id === "req");
  check("保存带 expectedRevision 做乐观锁", saveCall?.payload?.expectedRevision === 3, String(saveCall?.payload?.expectedRevision));
  check("保存带上新名称", saveCall?.payload?.name === "改名后");
  check("保存后编辑器收起", !flat(panelOf(t)).filter((x) => typeof x === "string").includes("名称"));
}

// ══════════ 动态变量 {{date}}/{{time}}/{{datetime}} ══════════
{
  const DYN = {
    id: "dyn",
    name: "日报",
    category: "写作",
    content: "今天是 {{date}} {{time}}，请总结：{{要点}}",
    variables: {},
    revision: 1,
    deletedAt: null,
  };
  const ONLY_DYN = {
    id: "onlydyn",
    name: "纯日期",
    category: null,
    content: "{{datetime}}",
    variables: {},
    revision: 1,
    deletedAt: null,
  };
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 4, snippets: [DYN, ONLY_DYN] } });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };
  const tick = () => new Promise((r) => setImmediate(r));
  // 关→开强制触发 load()，拿新数据
  let t = rerender(registered.Component, props);
  if (t.children.find((c) => c?.props?.id === "ps-panel")) {
    t.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    t = rerender(registered.Component, props);
  }
  t.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  await tick();
  t = rerender(registered.Component, props);
  const pnl = () => t.children.find((c) => c?.props?.id === "ps-panel");
  const dynBtn = flat(pnl()).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.includes("日报"));
  inserted.length = 0;
  dynBtn.props.onClick();
  // 日报含动态变量 date/time + 用户变量「要点」→ 应弹表单（要点无元数据）
  t = rerender(registered.Component, props);
  let dynTxt = flat(pnl()).filter((x) => typeof x === "string");
  check("动态变量 + 用户变量 → 弹表单", dynTxt.some((x) => x.includes("填写「日报」的占位符")), dynTxt.join("|"));
  // 表单里不列动态变量，只列「要点」
  check("表单不列 date/time 动态变量", !dynTxt.some((x) => x.includes("{{date}}") || x.includes("{{time}}")), dynTxt.join("|"));
  check("表单列出用户变量要点", dynTxt.some((x) => x.includes("要点")));

  // 纯动态变量片段 → 直插（不弹表单），内容被实时替换
  // 先关面板再开以刷新
  t = rerender(registered.Component, props);
  if (t.children.find((c) => c?.props?.id === "ps-panel")) {
    t.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    t = rerender(registered.Component, props);
  }
  if (!t.children.find((c) => c?.props?.id === "ps-panel")) {
    t.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    t = rerender(registered.Component, props);
  }
  const onlyBtn = flat(t.children.find((c) => c?.props?.id === "ps-panel")).find(
    (n) => n?.props?.onClick && Array.isArray(n.children) && n.children.includes("纯日期")
  );
  inserted.length = 0;
  onlyBtn.props.onClick();
  check("纯动态变量 → 直插不弹表单", inserted.length === 1, inserted.join("|"));
  check("datetime 被实时替换为时间戳", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(inserted[0]), inserted[0]);
  check("纯动态变量直插后发 touch", calls.some((c) => c.endpoint === "touch" && c.payload?.ids?.[0] === "onlydyn"));
}

{
  const S1 = {
    id: "a",
    name: "甲",
    category: null,
    content: "内容甲",
    variables: {},
    revision: 2,
    deletedAt: null,
  };
  const S2 = { id: "b", name: "乙", category: null, content: "内容乙", variables: {}, revision: 5, deletedAt: null };
  let store = [S1, S2];
  let saveMode = "conflict";
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 3, snippets: store.slice() } });
    if (endpoint === "get") {
      const s = store.find((x) => x.id === payload.id);
      return Promise.resolve(s ? { ok: true, value: { snippet: { ...s, name: "服务器名", revision: 77 } } } : { ok: false, error: { code: "not-found", message: "没了" } });
    }
    if (endpoint === "save") {
      if (saveMode === "conflict" && payload.force !== true) {
        return Promise.resolve({
          ok: false,
          error: { code: "conflict", message: `该片段已被他处修改（当前 revision 9，你基于 ${payload.expectedRevision}）。` },
          value: { snippet: { ...S1, revision: 9 } },
        });
      }
      return Promise.resolve({ ok: true, value: { version: 3, snippets: store.slice() } });
    }
    if (endpoint === "delete") {
      store = store.filter((x) => x.id !== payload.id);
      return Promise.resolve({ ok: true, value: { version: 3, snippets: store.slice() } });
    }
    if (endpoint === "restore") {
      return Promise.resolve({ ok: true, value: { version: 3, snippets: [S1, S2] } });
    }
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };

  const clickToggle = (x) =>
    x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  // 开关一次才会重新 load() 拿到新假数据
  const openPanel = () => {
    let x = rerender(registered.Component, props);
    if (x.children.find((c) => c?.props?.id === "ps-panel")) {
      clickToggle(x);
      x = rerender(registered.Component, props);
    }
    clickToggle(x);
    return rerender(registered.Component, props);
  };
  const panelOf = (x) => x.children.find((c) => c?.props?.id === "ps-panel");
  const findBtnByText = (x, txt) =>
    flat(x).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.length === 1 && n.children[0] === txt);
  const findIcon = (x, label) => flat(x).find((n) => n?.props?.["aria-label"] === label);

  let t = openPanel();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  check("切换假数据后列表已更新", !!findIcon(t, "编辑「甲」"), flat(panelOf(t)).filter((x) => typeof x === "string").join("|"));

  // —— 冲突：编辑后保存，服务端 revision 变了 ——
  findIcon(t, "编辑「甲」").props.onClick();
  t = rerender(registered.Component, props);
  flat(panelOf(t)).find((n) => n?.props?.className === "ps-input" && n?.props?.value === "甲").props.onChange({ target: { value: "甲改" } });
  t = rerender(registered.Component, props);
  findBtnByText(t, "保存").props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  let cTxt = flat(panelOf(t)).filter((x) => typeof x === "string");
  check("冲突时显示横幅", cTxt.some((x) => x.includes("已被他处修改")), cTxt.join("|"));
  check("冲突时出现覆盖按钮", !!findBtnByText(t, "覆盖"));
  check("冲突时出现重新载入按钮", !!findBtnByText(t, "重新载入"));
  check("冲突时草稿仍在", flat(panelOf(t)).some((n) => n?.props?.value === "甲改"));

  // 覆盖：payload 必须带 force
  calls.length = 0;
  findBtnByText(t, "覆盖").props.onClick();
  await new Promise((r) => setImmediate(r));
  const forced = calls.find((c) => c.endpoint === "save");
  check("覆盖带 force=true", forced?.payload?.force === true);
  check("覆盖不再带 expectedRevision", forced?.payload?.expectedRevision === undefined);

  // 重新载入：草稿换成服务器版本
  t = openPanel();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  if (!findIcon(t, "编辑「甲」")) {
    // 上一步覆盖成功后列表可能已刷新；重新载入分支单独构造
    findIcon(t, "编辑「甲改」")?.props.onClick();
  } else {
    findIcon(t, "编辑「甲」").props.onClick();
  }
  t = rerender(registered.Component, props);
  flat(panelOf(t)).find((n) => n?.props?.className === "ps-input" && typeof n?.props?.value === "string" && n.props.value.length > 0).props.onChange({ target: { value: "本地乱改" } });
  t = rerender(registered.Component, props);
  calls.length = 0;
  // 让下一次 save 仍冲突
  saveMode = "conflict";
  findBtnByText(t, "保存").props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  findBtnByText(t, "重新载入").props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  check("重新载入拉服务器版本", flat(panelOf(t)).some((n) => n?.props?.value === "服务器名"));
  check("重新载入清掉冲突横幅", !flat(panelOf(t)).filter((x) => typeof x === "string").some((x) => x.includes("已被他处修改")));

  // —— 脏草稿：外部点击不关面板 ——
  {
    const outside = [];
    const realAdd = document.addEventListener;
    document.addEventListener = (type, fn) => { if (type === "mousedown") outside.push(fn); };
    rerender(registered.Component, props);
    document.addEventListener = realAdd;
    // 触发 doc 上的 mousedown 拦截器（此刻有脏草稿）
    outside.forEach((fn) => fn({ target: { nodeType: 1 } }));
    t = rerender(registered.Component, props);
    check("脏草稿时外部点击不关面板", !!panelOf(t));
  }

  // —— 取消：未改动时一次就关；脏草稿要点两次 ——
  {
    // 此刻草稿是刚 reload 回来的，dirty=false → 点一次就应当关闭
    const c1 = findBtnByText(t, "取消");
    check("取消按钮初始文案", !!c1 && c1.children[0] === "取消");
    c1.props.onClick();
    t = rerender(registered.Component, props);
    check("未改动的草稿一次取消即关闭", !flat(panelOf(t)).filter((x) => typeof x === "string").includes("名称"));
  }
  // 重新打开编辑并制造脏草稿
  findIcon(t, "编辑「甲」").props.onClick();
  t = rerender(registered.Component, props);
  flat(panelOf(t)).find((n) => n?.props?.className === "ps-input" && n?.props?.value === "甲").props.onChange({ target: { value: "甲脏" } });
  t = rerender(registered.Component, props);
  const cancelBtn = findBtnByText(t, "取消");
  check("取消按钮初始文案", !!cancelBtn);
  cancelBtn.props.onClick();
  t = rerender(registered.Component, props);
  check("脏草稿首次取消变确认", !!findBtnByText(t, "确认放弃"));
  check("给出二次确认提示", flat(panelOf(t)).filter((x) => typeof x === "string").some((x) => x.includes("再点一次")));
  findBtnByText(t, "确认放弃").props.onClick();
  t = rerender(registered.Component, props);
  check("二次确认后编辑器收起", !flat(panelOf(t)).filter((x) => typeof x === "string").includes("名称"));

  // —— 新建 ——
  t = openPanel();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  const addBtn = findBtnByText(t, "＋ 新建");
  check("列表底部有新建按钮", !!addBtn);
  addBtn.props.onClick();
  t = rerender(registered.Component, props);
  check("新建打开空编辑器", flat(panelOf(t)).filter((x) => typeof x === "string").includes("名称"));
  calls.length = 0;
  findBtnByText(t, "保存").props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  check("空名称不发请求", !calls.some((c) => c.endpoint === "save"));
  check("空名称给出提示", flat(panelOf(t)).filter((x) => typeof x === "string").some((x) => x.includes("名称不能为空")));

  // —— 多条撤销 ——
  t = openPanel();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  const delA = findIcon(t, "删除「甲」") || findIcon(t, "删除「甲改」");
  delA.props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  findIcon(t, "删除「乙」").props.onClick();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  let uTxt = flat(panelOf(t)).filter((x) => typeof x === "string");
  check("撤销条显示多条计数", uTxt.some((x) => x.includes("已删除 2 条")), uTxt.join("|"));
  check("每条都给了独立撤销入口", uTxt.filter((x) => x.startsWith("↩ ")).length === 2, String(uTxt.filter((x) => x.startsWith("↩ ")).length));
  check("有全部撤销按钮", !!findBtnByText(t, "全部撤销"));
  calls.length = 0;
  findBtnByText(t, "全部撤销").props.onClick();
  await new Promise((r) => setImmediate(r));
  check("全部撤销逐条调 restore", calls.filter((c) => c.endpoint === "restore").length === 2, String(calls.filter((c) => c.endpoint === "restore").length));
}

// —— §3.3 导出按钮 ——
{
  // 前面的块把 fakeRpc.call 换成了只认 list/save/get 的版本，这里恢复成全量替身
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 3, snippets: DATA } });
    if (endpoint === "export") {
      return Promise.resolve({
        ok: true,
        value: { json: "{}", count: DATA.length, path: "C:\\fake\\exports\\snippets.json" },
      });
    }
    if (endpoint === "import") {
      return Promise.resolve({
        ok: true,
        value: { path: payload.path, changed: true, plan: { added: 2, updated: 0, skipped: 0, dropped: 0, conflicts: [] } },
      });
    }
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };
  const btnToggle = () => {
    let t = rerender(registered.Component, props);
    const b = t.children.find((c) => c?.props?.id === "ps-button");
    b?.props?.onClick?.({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    return rerender(registered.Component, props);
  };
  let t = rerender(registered.Component, props);
  if (t.children.find((c) => c?.props?.id === "ps-panel")) t = btnToggle(); // 先关
  t = btnToggle(); // 再开 → 触发 load 拿 DATA
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);

  // 上一块留下了一个空的「新建」编辑器（editing.id === null），它占据底部 addRow 的位置。
  // 草稿为空 → 一次取消即可收起，不用二次确认。
  {
    const p = t.children.find((c) => c?.props?.id === "ps-panel");
    const cancel = flat(p).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.join("") === "取消");
    if (cancel) {
      cancel.props.onClick();
      await new Promise((r) => setImmediate(r));
      t = rerender(registered.Component, props);
    }
  }

  const panel0 = t.children.find((c) => c?.props?.id === "ps-panel");
  const exportBtn = flat(panel0).find((n) => n?.props?.className === "ps-ghost" && flat(n).includes("⬇ 导出"));
  check("面板渲染出导出按钮", !!exportBtn);
  check("导出按钮标题说明落盘位置", String(exportBtn?.props?.title || "").includes("exports/"));
  check("有片段时导出按钮可用", exportBtn?.props?.disabled === false, String(exportBtn?.props?.disabled));

  const before = calls.filter((c) => c.endpoint === "export").length;
  exportBtn?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  const expCalls = calls.filter((c) => c.endpoint === "export");
  check("点击导出调用 export 端点", expCalls.length === before + 1, String(expCalls.length));
  check("导出请求带 write 触发落盘", expCalls.at(-1)?.payload?.write === "", JSON.stringify(expCalls.at(-1)?.payload));
  check("导出请求带 reveal 一键打开", expCalls.at(-1)?.payload?.reveal === true, JSON.stringify(expCalls.at(-1)?.payload));

  const t2 = rerender(registered.Component, props);
  const p2 = t2.children.find((c) => c?.props?.id === "ps-panel");
  const pathText = flat(p2).find(
    (n) => n?.props?.style?.fontFamily?.includes("monospace") && flat(n).some((x) => String(x).includes(".json"))
  );
  check("导出成功后显示落盘路径", !!pathText, flat(p2).filter((x) => typeof x === "string").join("|"));
  // 落盘路径旁有「打开」按钮，点击它发 revealPath 而不是重新 write（不覆盖导出文件）
  const openBtn = flat(p2).find((n) => n?.props?.onClick && flat(n).includes("打开"));
  check("导出路径旁有「打开」按钮", !!openBtn);
  openBtn?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  const revealCall = calls.filter((c) => c.endpoint === "export" && c.payload?.revealPath);
  check("点打开发 revealPath 请求", revealCall.length >= 1, JSON.stringify(revealCall.at(-1)?.payload));
  check("点打开不重复 write（不覆盖导出文件）", revealCall.at(-1)?.payload?.write === undefined, JSON.stringify(revealCall.at(-1)?.payload));
}

// —— §3.3 导出失败降级 ——
{
  const realCall = fakeRpc.call;
  fakeRpc.call = (channel, endpoint, payload) =>
    endpoint === "export"
      ? Promise.resolve({ ok: false, error: { code: "internal", message: "写入导出文件失败：EACCES" } })
      : realCall(channel, endpoint, payload);
  const t = rerender(registered.Component, props);
  const p = t.children.find((c) => c?.props?.id === "ps-panel");
  const btn = flat(p).find((n) => n?.props?.className === "ps-ghost" && flat(n).includes("⬇ 导出"));
  btn?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  const t2 = rerender(registered.Component, props);
  const texts = flat(t2).filter((x) => typeof x === "string");
  check("导出失败显示错误文案", texts.some((s) => s.includes("写入导出文件失败")), texts.join("|").slice(0, 200));
  fakeRpc.call = realCall;
}

// —— §3.3 导入 UI ——
{
  let t = rerender(registered.Component, props);
  const p0 = t.children.find((c) => c?.props?.id === "ps-panel");
  const importToggle = flat(p0).find((n) => n?.props?.className === "ps-ghost" && flat(n).includes("⬆ 导入"));
  check("面板渲染出导入按钮", !!importToggle);
  check("导入表单默认收起", !flat(p0).some((n) => n?.props?.placeholder?.includes("exports/snippets.json")));

  importToggle?.props?.onClick?.();
  t = rerender(registered.Component, props);
  let p = t.children.find((c) => c?.props?.id === "ps-panel");
  const pathInput = flat(p).find((n) => n?.props?.placeholder?.includes("exports/snippets.json"));
  check("点击导入展开路径输入框", !!pathInput);
  check("导入有替换模式勾选框", flat(p).some((n) => n?.props?.type === "checkbox"));

  // 空路径不发请求
  const before = calls.filter((c) => c.endpoint === "import").length;
  const submitBtn = flat(p).find(
    (n) => n?.props?.className === "ps-primary" && Array.isArray(n.children) && n.children.join("") === "导入"
  );
  check("导入表单有确认按钮", !!submitBtn);
  submitBtn?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  check("空路径不发 import 请求", calls.filter((c) => c.endpoint === "import").length === before);
  t = rerender(registered.Component, props);
  check(
    "空路径给出提示",
    flat(t).filter((x) => typeof x === "string").some((s) => s.includes("请填写要导入"))
  );

  // 填路径后提交
  pathInput?.props?.onChange?.({ target: { value: "C:\\tmp\\snippets.json" } });
  t = rerender(registered.Component, props);
  p = t.children.find((c) => c?.props?.id === "ps-panel");
  const checkbox = flat(p).find((n) => n?.props?.type === "checkbox");
  checkbox?.props?.onChange?.({ target: { checked: true } });
  t = rerender(registered.Component, props);
  p = t.children.find((c) => c?.props?.id === "ps-panel");
  const submit2 = flat(p).find(
    (n) => n?.props?.className === "ps-primary" && Array.isArray(n.children) && n.children.join("") === "导入"
  );
  submit2?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  const impCall = calls.filter((c) => c.endpoint === "import").at(-1);
  check("提交时调用 import 端点", !!impCall);
  check("导入请求带 path", impCall?.payload?.path === "C:\\tmp\\snippets.json", JSON.stringify(impCall?.payload));
  check("导入请求带 replace 模式", impCall?.payload?.mode === "replace", JSON.stringify(impCall?.payload));

  t = rerender(registered.Component, props);
  const texts = flat(t).filter((x) => typeof x === "string");
  check("导入成功后提示新增条数", texts.some((s) => s.includes("导入 2 条")), texts.join("|").slice(0, 200));
  const p3 = t.children.find((c) => c?.props?.id === "ps-panel");
  check("导入成功后表单收起", !flat(p3).some((n) => n?.props?.placeholder?.includes("exports/snippets.json")));
  check("导入成功后重新拉列表", calls.filter((c) => c.endpoint === "list").length > 0);
}

// —— §3.3 导入失败降级 ——
{
  const realCall = fakeRpc.call;
  fakeRpc.call = (channel, endpoint, payload) =>
    endpoint === "import"
      ? Promise.resolve({ ok: false, error: { code: "bad-request", message: "读不到导入文件「x.json」：ENOENT" } })
      : realCall(channel, endpoint, payload);
  let t = rerender(registered.Component, props);
  let p = t.children.find((c) => c?.props?.id === "ps-panel");
  const toggle = flat(p).find((n) => n?.props?.className === "ps-ghost" && flat(n).includes("⬆ 导入"));
  toggle?.props?.onClick?.();
  t = rerender(registered.Component, props);
  p = t.children.find((c) => c?.props?.id === "ps-panel");
  flat(p).find((n) => n?.props?.placeholder?.includes("exports/snippets.json"))?.props?.onChange?.({
    target: { value: "x.json" },
  });
  t = rerender(registered.Component, props);
  p = t.children.find((c) => c?.props?.id === "ps-panel");
  flat(p)
    .find((n) => n?.props?.className === "ps-primary" && Array.isArray(n.children) && n.children.join("") === "导入")
    ?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  t = rerender(registered.Component, props);
  check(
    "导入失败显示错误文案",
    flat(t).filter((x) => typeof x === "string").some((s) => s.includes("读不到导入文件"))
  );
  fakeRpc.call = realCall;
}

// ══════════ §3.1 优化闭环：三态对比视图 ══════════
{
  // 关掉可能开着的编辑器/表单，回到干净面板
  const closeAll = () => {
    let t = rerender(registered.Component, props);
    const panel = () => t.children.find((c) => c?.props?.id === "ps-panel");
    const cancel = flat(panel()).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.join("") === "取消");
    if (cancel) { cancel.props.onClick(); t = rerender(registered.Component, props); }
    return t;
  };
  const openPanel = () => {
    let t = rerender(registered.Component, props);
    if (!t.children.find((c) => c?.props?.id === "ps-panel")) {
      t.children.find((c) => c?.props?.id === "ps-button").props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) },
      });
      t = rerender(registered.Component, props);
    }
    return t;
  };
  // 只有「关 → 开」才会触发 load()：前面的段可能留下了别的假数据，必须先强制重拉
  const reloadPanel = async () => {
    let t = rerender(registered.Component, props);
    if (t.children.find((c) => c?.props?.id === "ps-panel")) {
      t.children.find((c) => c?.props?.id === "ps-button").props.onClick({
        currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) },
      });
      t = rerender(registered.Component, props);
    }
    t = openPanel();
    await new Promise((r) => setImmediate(r));
    return rerender(registered.Component, props);
  };
  const panelOf = (t) => t.children.find((c) => c?.props?.id === "ps-panel");
  const byText = (t, txt) =>
    flat(panelOf(t)).find((n) => n?.props?.onClick && Array.isArray(n.children) && n.children.join("") === txt);
  const textsOf = (t) => flat(panelOf(t)).filter((x) => typeof x === "string");
  const starBtn = (t) =>
    flat(panelOf(t)).find((n) => n?.props?.className === "ps-icon" && Array.isArray(n.children) && n.children.join("") === "✨");
  const textareaOf = (t) => flat(panelOf(t)).find((n) => n?.type === "textarea");
  const waitTick = () => new Promise((r) => setImmediate(r));

  const OPT = {
    id: "opt",
    name: "优化样本",
    category: "开发",
    content: "请审查 {{代码}}，关注 {{关注点}}。",
    variables: {},
    revision: 5,
    deletedAt: null,
  };

  // 可编程 host 替身：optimize / save / capabilities 都能按用例改写
  let optReply = { ok: true, value: { optimized: "审查 {{代码}}，重点看 {{关注点}}。", truncated: false } };
  let saveReply = { ok: true, value: { version: 3, snippets: [OPT] } };
  let capReply = { ok: true, value: { optimize: { available: true, reason: null } } };
  fakeRpc.call = (channel, endpoint, payload, signal) => {
    calls.push({ channel, endpoint, payload, signal });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 3, snippets: [OPT] } });
    if (endpoint === "capabilities") return Promise.resolve(capReply);
    if (endpoint === "optimize") return Promise.resolve(typeof optReply === "function" ? optReply() : optReply);
    if (endpoint === "save") return Promise.resolve(saveReply);
    if (endpoint === "touch") return Promise.resolve({ ok: true, value: {} });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };

  // —— 成功路径 ——
  let t = closeAll();
  t = await reloadPanel();
  // 面板刚打开时 list 还在飞：等一拍再取按钮，否则拿到的是上一轮数据/空列表
  await waitTick();
  t = rerender(registered.Component, props);
  inserted.length = 0;
  const star = starBtn(t);
  check("✨ 按钮默认可用", !!star && star.props.disabled === false, star && String(star.props.disabled));
  if (!star) {
    console.log("DBG 面板存在:", !!panelOf(t));
    console.log("DBG 文案:", textsOf(t).join(" | ").slice(0, 400));
    console.log(
      "DBG ps-icon:",
      flat(t).filter((n) => n?.props?.className === "ps-icon").map((n) => JSON.stringify(n.children.join(""))).join(" , ")
    );
    console.log("DBG 最后一轮 list 返回: ", JSON.stringify(calls.filter((c) => c.endpoint === "list").slice(-1)[0]));
  }
  star.props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  let p = panelOf(t);
  let txt = textsOf(t);
  check("点了 ✨ 不会直接插入（旧行为已废）", inserted.length === 0, inserted.join("|"));
  check("弹出对比视图：原文栏", txt.includes("原文") && txt.some((s) => s.includes("请审查 {{代码}}")));
  // 优化后是可编辑 textarea：内容在 value prop，标签含「可编辑」
  const optArea = textareaOf(t);
  check("弹出对比视图：优化后是可编辑文本框", txt.includes("优化后（可编辑）") && !!optArea, String(optArea?.props?.value));
  check("优化后文本框预填优化结果", String(optArea?.props?.value).includes("重点看 {{关注点}}"), String(optArea?.props?.value));
  check("对比视图显示字节数", txt.some((s) => /字节 \d+ → \d+/.test(s)), txt.find((s) => s.includes("字节")));
  check("占位符保全打勾", txt.some((s) => s.includes("{{代码}}") && s.includes("已保留 ✓")), txt.join("|").slice(0, 160));
  check("占位符齐全时「替换片段正文」可用", byText(t, "替换片段正文")?.props?.disabled === false);

  // —— 编辑优化结果：改了 textarea 后，字节数/插入/替换都跟着变 ——
  optArea.props.onChange({ target: { value: "审查 {{代码}}，重点看 {{关注点}}。加一句。" } });
  await waitTick();
  t = rerender(registered.Component, props);
  check("编辑后字节数实时更新", textsOf(t).some((s) => /字节 \d+ → \d+/.test(s) && !s.includes("→ 46")), textsOf(t).find((s) => s.includes("字节")));
  check("编辑后仍可替换", byText(t, "替换片段正文")?.props?.disabled === false);

  // 插入优化版：走同一条 insertText，成功后收起
  inserted.length = 0;
  const beforeTouch1 = calls.filter((c) => c.endpoint === "touch").length;
  byText(t, "插入优化版").props.onClick();
  await waitTick();
  check("插入优化版插入的是编辑后文本", inserted[0] === "审查 {{代码}}，重点看 {{关注点}}。加一句。", String(inserted[0]));
  const touch1 = calls.filter((c) => c.endpoint === "touch").slice(-1)[0];
  check("插入优化版后发 touch", calls.filter((c) => c.endpoint === "touch").length === beforeTouch1 + 1, JSON.stringify(touch1));
  check("touch 带片段 id", touch1?.payload?.ids?.[0] === "opt", JSON.stringify(touch1?.payload));
  t = rerender(registered.Component, props);
  check("插入后对比视图收起", !textsOf(t).some((s) => s.includes("优化后")));

  // —— 保留原文插入 ——
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  inserted.length = 0;
  const beforeTouch2 = calls.filter((c) => c.endpoint === "touch").length;
  byText(t, "保留原文插入").props.onClick();
  await waitTick();
  check("保留原文插入插的是原文", inserted[0] === OPT.content, String(inserted[0]));
  const touch2 = calls.filter((c) => c.endpoint === "touch").slice(-1)[0];
  check("保留原文插入后发 touch", calls.filter((c) => c.endpoint === "touch").length === beforeTouch2 + 1);
  check("保留原文 touch 带片段 id", touch2?.payload?.ids?.[0] === "opt");
  t = rerender(registered.Component, props);
  check("保留原文后对比视图收起", !textsOf(t).some((s) => s.includes("优化后")));

  // —— 占位符丢失：禁用替换，并点名丢了哪个 ——
  optReply = { ok: true, value: { optimized: "审查代码，重点看关注点。", truncated: false } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  txt = textsOf(t);
  check("占位符丢失时点名变量", txt.some((s) => s.includes("占位符丢失") && s.includes("{{代码}}")), txt.join("|").slice(0, 160));
  check("占位符丢失时禁用「替换片段正文」", byText(t, "替换片段正文")?.props?.disabled === true);
  check("禁用原因写在 title 里", String(byText(t, "替换片段正文")?.props?.title || "").includes("丢失"), byText(t, "替换片段正文")?.props?.title);
  // 关闭对比视图
  byText(t, "✕").props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  check("✕ 收起对比视图", !textsOf(t).some((s) => s.includes("优化后")));
  check("✕ 只收对比视图，面板还在", !!panelOf(t));

  // —— 超长：禁用替换并说明 ——
  // 客户端现在按实时字节数重算（不再信任 host 的 truncated 标记），必须真给一条超 200000 字节的
  optReply = { ok: true, value: { optimized: "请审查 {{代码}}，关注 {{关注点}}。" + "x".repeat(200_010), truncated: true } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  txt = textsOf(t);
  check("超长时提示超出上限", txt.some((s) => s.includes("超出长度上限")), txt.join("|").slice(0, 160));
  check("超长时禁用「替换片段正文」", byText(t, "替换片段正文")?.props?.disabled === true);

  // —— 编辑把超长删短后，禁用自动解除 ——
  textareaOf(t).props.onChange({ target: { value: "审查 {{代码}} 并关注 {{关注点}}。" } });
  await waitTick();
  t = rerender(registered.Component, props);
  check("编辑删短后解除超长禁用", byText(t, "替换片段正文")?.props?.disabled === false);
  byText(t, "✕").props.onClick();
  await waitTick();

  // —— 替换片段正文：唯一落盘动作，必须带 expectedRevision ——
  optReply = { ok: true, value: { optimized: "审查 {{代码}} 并关注 {{关注点}}。", truncated: false } };
  saveReply = { ok: true, value: { version: 3, snippets: [{ ...OPT, content: "审查 {{代码}} 并关注 {{关注点}}。", revision: 6 }] } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  const beforeSave = calls.filter((c) => c.endpoint === "save").length;
  byText(t, "替换片段正文").props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  const saveCall = calls.filter((c) => c.endpoint === "save").slice(-1)[0];
  check("替换正文发出 save", calls.filter((c) => c.endpoint === "save").length === beforeSave + 1);
  check("save 带 id 与 expectedRevision", saveCall?.payload?.id === "opt" && saveCall?.payload?.expectedRevision === 5, JSON.stringify(saveCall?.payload));
  check("save 带优化后的内容", String(saveCall?.payload?.content).includes("并关注"), saveCall?.payload?.content);
  check("save 用 keepCategory 保分类", saveCall?.payload?.keepCategory === true);
  // notice 会被 2.6s 定时器清掉，而测试里的 setTimeout 是同步执行的替身，
  // 所以这里断言「落盘后对比视图收起」——这才是用户能看到的状态变化。
  check("替换成功后对比视图收起", !textsOf(t).some((s) => s.includes("优化后")), textsOf(t).join("|").slice(0, 160));

  // —— revision 冲突：只给「覆盖」或「放弃」 ——
  saveReply = { ok: false, error: { code: "conflict", message: "该片段已被其他窗口修改" } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  byText(t, "替换片段正文").props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  txt = textsOf(t);
  check("冲突时显示后端原因", txt.some((s) => s.includes("该片段已被其他窗口修改")), txt.join("|").slice(0, 160));
  const forceBtn = byText(t, "用优化版覆盖");
  check("冲突时提供「用优化版覆盖」", !!forceBtn);
  check("冲突时不提供合并选项", !byText(t, "合并"));
  forceBtn.props.onClick();
  await waitTick();
  const forceCall = calls.filter((c) => c.endpoint === "save").slice(-1)[0];
  check("覆盖时带 force 且不带 expectedRevision", forceCall?.payload?.force === true && forceCall?.payload?.expectedRevision === undefined, JSON.stringify(forceCall?.payload));

  // —— 再试：上限 3 次后禁用 ——
  saveReply = { ok: true, value: { version: 3, snippets: [OPT] } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  for (let i = 0; i < 3; i++) {
    t = rerender(registered.Component, props);
    const retry = byText(t, "再试");
    check(`第 ${i + 1} 次「再试」可用`, !!retry && retry.props.disabled === false);
    retry.props.onClick();
    await waitTick();
  }
  t = rerender(registered.Component, props);
  check("重试 3 次后按钮置灰", byText(t, "已重试 3 次")?.props?.disabled === true);
  check("重试计数写进对比视图", textsOf(t).some((s) => s.includes("已重试 3 次")), textsOf(t).join("|").slice(0, 160));
  byText(t, "✕").props.onClick();
  await waitTick();

  // —— 失败与取消 ——
  optReply = { ok: false, error: { code: "internal", message: "优化结果为空" } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  check("优化失败显示原因", textsOf(t).some((s) => s.includes("优化结果为空")), textsOf(t).join("|").slice(0, 160));
  check("失败时「插入优化版」禁用", byText(t, "插入优化版")?.props?.disabled === true);
  byText(t, "✕").props.onClick();
  await waitTick();

  optReply = { ok: false, error: { code: "aborted", message: "优化已取消" } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  check("用户取消时静默收起（不当错误报）", !textsOf(t).some((s) => s.includes("优化后")));
  check("取消不写错误横幅", !textsOf(t).some((s) => s.includes("优化已取消")), textsOf(t).join("|").slice(0, 160));

  // —— Escape 分层：先收对比视图，再收面板 ——
  optReply = { ok: true, value: { optimized: "审查 {{代码}} 并关注 {{关注点}}。", truncated: false } };
  t = await reloadPanel();
  starBtn(t).props.onClick();
  await waitTick();
  t = rerender(registered.Component, props);
  const search = flat(panelOf(t)).find((n) => n?.props?.placeholder?.includes("搜索"));
  search.props.onKeyDown({ key: "Escape" });
  t = rerender(registered.Component, props);
  check("Escape 第一层只收对比视图", !textsOf(t).some((s) => s.includes("优化后")) && !!panelOf(t));
  const search2 = flat(panelOf(t)).find((n) => n?.props?.placeholder?.includes("搜索"));
  search2.props.onKeyDown({ key: "Escape" });
  t = rerender(registered.Component, props);
  check("Escape 第二层收起面板", !panelOf(t));

  // —— 无默认模型：✨ 直接置灰，title 说明原因 ——
  capReply = { ok: true, value: { optimize: { available: false, reason: "未配置默认模型，无法优化" } } };
  t = await reloadPanel();
  const capEffect = effects.map((e) => e.fn).find((fn) => fn.toString().includes("capabilities"));
  capEffect();
  await waitTick();
  t = rerender(registered.Component, props);
  const star2 = starBtn(t);
  check("无模型时 ✨ 置灰", star2?.props?.disabled === true);
  check("无模型时 title 说明原因", String(star2?.props?.title || "").includes("未配置默认模型"), star2?.props?.title);
}

// —— §2.6 验收：无硬编码色值 ——
{
  const colorProps = [];
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    const st = node.props?.style;
    if (st) {
      for (const [k, v] of Object.entries(st)) {
        if (typeof v !== "string") continue;
        if (!/^(color|background|background-color|border|borderTop|borderBottom|borderColor|boxShadow|outline)$/.test(k)) continue;
        colorProps.push({ k, v });
      }
    }
    (node.children || []).forEach(collect);
  };
  collect(registered.Component(props));
  const offenders = colorProps.filter(
    (p) => !/var\(--dsw-/.test(p.v) && !/^(transparent|inherit|none|0)$/.test(p.v) && !/^(1px solid |0 )/.test(p.v)
  );
  check("所有内联颜色都来自主题 token", offenders.length === 0, offenders.map((o) => `${o.k}=${o.v}`).join("; "));
}

// —— §2.6 验收：320px 窄屏不溢出 ——
// 注意：此刻面板是打开的，再点 ps-btn 会 toggle 关掉它。
// 直接改视口，靠组件自己的 resize effect 把面板拉回可视区。
{
  const originW = window.innerWidth;
  const originH = window.innerHeight;
  window.innerWidth = 320;
  window.innerHeight = 640;
  rerender(registered.Component, props);
  // 触发 resize 监听（组件在 open 时注册过）
  const resizeEffect = effects.find((e) => e.fn.toString().includes("resize"));
  const handlers = [];
  const realAdd = window.addEventListener;
  window.addEventListener = (type, fn) => { if (type === "resize") handlers.push(fn); };
  resizeEffect?.fn?.();
  window.addEventListener = realAdd;
  handlers.forEach((fn) => fn());
  const t7 = rerender(registered.Component, props);
  const panelEl = flat(t7).find((x) => x?.props?.id === "ps-panel");
  check("窄屏下仍渲染面板", !!panelEl);
  const w = panelEl?.props?.style?.width || "";
  const h = panelEl?.props?.style?.maxHeight || "";
  check("窄屏宽度用 min() 收窄", w.includes("min(") && w.includes("100vw"), w);
  check("窄屏高度用 min() 收窄", h.includes("min(") && h.includes("100vh"), h);
  // clampPos：面板不能越出视口左右边界（窄屏 w≈304，GAP=8 → left 只能落在 [8,8]）
  const left = parseFloat(panelEl?.props?.style?.left);
  const vw = 320;
  const gap = 8;
  const panelW = Math.min(340, vw - gap * 2); // 304
  check(
    "窄屏下面板不溢出视口",
    Number.isFinite(left) && left >= gap && left + panelW <= vw - gap + 0.5,
    `left=${panelEl?.props?.style?.left} panelW=${panelW}`
  );
  window.innerWidth = originW;
  window.innerHeight = originH;
}

// —— §3.2 搜索增强：高亮 / 命中计数 / 键盘导航 / 空态新建 ——
{
  // 恢复完整替身（前面的块改过 fakeRpc.call），数据仍用模块级 DATA
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 3, snippets: DATA } });
    if (endpoint === "touch") return Promise.resolve({ ok: true, value: {} });
    if (endpoint === "save") {
      return Promise.resolve({ ok: true, value: { version: 3, snippets: DATA } });
    }
    if (endpoint === "optimize") return Promise.resolve({ ok: true, value: { optimized: "优化后" } });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };

  const inputOf = (x) =>
    flat(x).find((n) => n?.props && typeof n.props.placeholder === "string" && n.props.placeholder.includes("搜索"));
  const marksOf = (x) => flat(x).filter((n) => n?.type === "mark");
  const textsOf = (x) => flat(x).filter((n) => typeof n === "string");
  const tick = () => new Promise((r) => setImmediate(r));
  // 关→开强制触发 load()，并等待 list promise 落地
  const reload32 = async () => {
    let x = rerender(registered.Component, props);
    if (x.children.find((c) => c?.props?.id === "ps-panel")) {
      x.children
        .find((c) => c?.props?.id === "ps-button")
        .props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
      x = rerender(registered.Component, props);
    }
    x.children
      .find((c) => c?.props?.id === "ps-button")
      .props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    await tick();
    return rerender(registered.Component, props);
  };

  // 1) 高亮：搜索「无分类」→ 名称「无分类项」里「无分类」被 mark 包住（该片段无变量，可直插，供后续 Enter 用例）
  let x = await reload32();
  inputOf(x).props.onChange({ target: { value: "无分类" } });
  x = rerender(registered.Component, props);
  let marks = marksOf(x);
  check("§3.2 命中词用 mark 高亮", marks.length >= 1 && marks.some((m) => m.children?.includes("无分类")), marks.map((m) => String(m.children)).join("|"));

  // 2) 命中计数：默认无选中显示 -/N
  const countText = textsOf(x).find((s) => /^[-0-9]+\/\d+$/.test(s));
  check("§3.2 命中计数显示 -/N", countText === "-/1", countText);

  // 3) 键盘 ArrowDown 选中第一项 → 计数变 1/1
  inputOf(x).props.onKeyDown({ key: "ArrowDown", preventDefault: () => {} });
  x = rerender(registered.Component, props);
  const countText2 = textsOf(x).find((s) => /^\d+\/\d+$/.test(s));
  check("§3.2 ↓ 选中后计数 1/1", countText2 === "1/1", countText2);

  // 4) 选中态样式落到 item
  const itemBtn = flat(x).find((n) => n?.props?.className === "ps-item" && n?.props?.style?.background);
  check("§3.2 选中项有 itemSelected 背景", !!itemBtn);

  // 5) Enter 插入选中项（关面板 + touch）
  const beforeTouch = calls.filter((c) => c.endpoint === "touch").length;
  inputOf(x).props.onKeyDown({ key: "Enter", preventDefault: () => {} });
  x = rerender(registered.Component, props);
  check("§3.2 Enter 插入选中项（面板关）", !x.children.find((c) => c?.props?.id === "ps-panel"));
  check("§3.2 Enter 插入触发了 touch", calls.filter((c) => c.endpoint === "touch").length === beforeTouch + 1);

  // 6) 空态「新建这个片段」：搜一个不存在的词，点新建 → 编辑器出现且名称预填
  x = await reload32();
  inputOf(x).props.onChange({ target: { value: "zzz不存在" } });
  x = rerender(registered.Component, props);
  const newBtn = flat(x).find(
    (n) => n?.props?.onClick && Array.isArray(n.children) && n.children.some((c) => typeof c === "string" && c.includes("＋ 新建"))
  );
  check("§3.2 空态有新建按钮", !!newBtn);
  newBtn?.props?.onClick?.();
  await tick();
  x = rerender(registered.Component, props);
  // 编辑器出现（名称输入框 + 内容 textarea）
  const hasEditor = flat(x).some((n) => n?.props?.className === "ps-textarea") && flat(x).some((n) => n?.props?.className === "ps-input" && n?.props?.placeholder === "片段名称");
  check("§3.2 点新建展开编辑器", hasEditor);

  // 7) Esc 优先退出编辑态再清 query，而不是直接关面板
  inputOf(x).props.onKeyDown({ key: "Escape", preventDefault: () => {} });
  x = rerender(registered.Component, props);
  check("§3.2 Esc 先退编辑态（面板仍在）", !!x.children.find((c) => c?.props?.id === "ps-panel"));
}

// ── §3.3.1 窗口尺寸可拖拽调整（八个方向把手） ──
{
  // 复位尺寸/位置状态，避免受前面用例污染
  localStorage._v["dsh-prompt-snippets-panel-size"] = null;
  localStorage._v["dsh-prompt-snippets-panel-pos"] = null;
  // 关面板再开，确保拿到干净的默认尺寸
  let x = rerender(registered.Component, props);
  if (x.children.find((c) => c?.props?.id === "ps-panel")) {
    x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    x = rerender(registered.Component, props);
  }
  x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  x = rerender(registered.Component, props);

  const panelOf = (t) => t.children.find((c) => c?.props?.id === "ps-panel");
  const handles = flat(x).filter((n) => /^(ns|ew|nwse|nesw)-resize$/.test(n?.props?.style?.cursor));
  check("面板渲染出七个方向调整把手（右上角留给关闭按钮）", handles.length === 7, String(handles.length));
  // 右上角不再有 resize 把手，避免挡住关闭按钮
  check("右上角无 nesw-resize 把手", !flat(x).some((n) => n?.props?.style?.cursor === "nesw-resize" && n?.props?.style?.right === 0 && n?.props?.style?.top === 0));

  // 默认尺寸：无自定义时沿用 min(380px, calc(100vw-16px)) 收窄
  const p0 = panelOf(x);
  check("默认宽度用 min() 收窄", (p0?.props?.style?.width || "").includes("min("), p0?.props?.style?.width);

  // 取 SE 把手（右下角 = 第二个 nwse-resize，NW 是第一个）模拟向右下放大
  const seHandle = handles.filter((n) => n?.props?.style?.cursor === "nwse-resize").at(-1);
  // 先触发 mousedown 设置 resizing 状态，再 rerender 让 effect 出现
  seHandle.props.onMouseDown({ button: 0, clientX: 100, clientY: 100, preventDefault: () => {}, stopPropagation: () => {} });
  x = rerender(registered.Component, props);
  // harness 不自动跑 effect：手动执行 resize-drag 那个 effect 挂上 document 监听
  const realAdd = document.addEventListener;
  const moves = [];
  const ups = [];
  document.addEventListener = (type, fn) => {
    if (type === "mousemove") moves.push(fn);
    else if (type === "mouseup") ups.push(fn);
  };
  const resizeEffect = effects.find((e) => e.fn.toString().includes("resizing"));
  resizeEffect?.fn?.();
  document.addEventListener = realAdd;
  // 拖到 +80 宽 +120 高（se 方向）
  moves.forEach((fn) => fn({ clientX: 180, clientY: 220 }));
  x = rerender(registered.Component, props);
  const p1 = panelOf(x);
  check("se 拖拽后宽度变为自定义 px", p1?.props?.style?.width === "460px", String(p1?.props?.style?.width));
  check("se 拖拽后高度变为自定义 px", p1?.props?.style?.height === "560px", String(p1?.props?.style?.height));

  ups.forEach((fn) => fn({ clientX: 180, clientY: 220 }));
  x = rerender(registered.Component, props);
  check("松手后尺寸写入 localStorage", (JSON.parse(localStorage._v["dsh-prompt-snippets-panel-size"] || "{}") || {}).w === 460);

  // 关→开：自定义尺寸被读回
  x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  x = rerender(registered.Component, props);
  x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
  x = rerender(registered.Component, props);
  const p2 = panelOf(x);
  check("重开后读回自定义尺寸", p2?.props?.style?.width === "460px", String(p2?.props?.style?.width));
}

// ── v1.3 标签 / 收藏 / 视图切换 / 版本历史 ──
{
  const V13_DATA = [
    { id: "a", name: "甲", category: "开发", content: "内容甲", pinned: true, tags: ["常用", "代码"], revision: 1, lastUsedAt: 30, updatedAt: 30, deletedAt: null },
    { id: "b", name: "乙", category: "写作", content: "内容乙", pinned: false, tags: [], revision: 1, lastUsedAt: 100, updatedAt: 100, deletedAt: null },
    { id: "c", name: "丙", category: "开发", content: "内容丙", pinned: false, tags: ["审查"], revision: 1, lastUsedAt: 5, updatedAt: 5, deletedAt: null },
  ];
  const realCall = fakeRpc.call;
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 4, snippets: V13_DATA } });
    if (endpoint === "history") return Promise.resolve({ ok: true, value: { id: payload.id, history: [{ name: "旧", content: "旧内容", revision: 0, at: 123 }] } });
    if (endpoint === "touch") return Promise.resolve({ ok: true, value: {} });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };
  const reload13 = async () => {
    let x = rerender(registered.Component, props);
    if (x.children.find((c) => c?.props?.id === "ps-panel")) {
      x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
      x = rerender(registered.Component, props);
    }
    x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    await new Promise((r) => setImmediate(r));
    return rerender(registered.Component, props);
  };
  const panelOf13 = (t) => t.children.find((c) => c?.props?.id === "ps-panel");
  const textsOf13 = (t) => flat(t).filter((x) => typeof x === "string");
  const findViewBtn = (t, txt) => flat(t).find((n) => n?.props?.className === "ps-view" && Array.isArray(n.children) && n.children.some((c) => c === txt));

  let x = await reload13();
  const viewBtns = flat(x).filter((n) => n?.props?.className === "ps-view");
  check("v1.3 视图栏渲染三个按钮", viewBtns.length === 3, String(viewBtns.length));

  // 行内：收藏星 + 标签 chip
  const star = flat(x).find((n) => n?.props?.style?.color === "var(--dsw-alias-state-warn-primary)" && typeof n?.props?.onClick !== "function" && n?.children?.includes?.("★ "));
  check("v1.3 收藏片段显示 ★", !!star, flat(x).filter((n) => n?.children?.includes?.("★")).length ? "has-star" : "no-star");
  const chips = flat(x).filter((n) => n?.props?.style?.maxWidth === "90px" && n?.props?.style?.borderRadius === "999px");
  check("v1.3 标签以 chip 渲染", chips.length >= 3, String(chips.length));

  // 视图切换：收藏
  findViewBtn(x, "★ 收藏")?.props?.onClick?.();
  x = rerender(registered.Component, props);
  let t13 = textsOf13(x);
  check("v1.3 收藏视图只显示置顶项", t13.includes("甲") && !t13.includes("乙") && !t13.includes("丙"), t13.filter((s) => s.length < 5).join("|"));

  // 视图切换：最近使用（按 lastUsedAt 降序）
  findViewBtn(x, "最近使用")?.props?.onClick?.();
  x = rerender(registered.Component, props);
  const items = flat(panelOf13(x)).filter((n) => n?.props?.className === "ps-item");
  const order = items.map((n) => (n.children || []).filter((c) => typeof c === "string").join(""));
  check("v1.3 最近使用按 lastUsedAt 降序", order.length === 3 && order[0] === "乙" && order[2] === "丙", order.join(","));

  // 视图切换回全部
  findViewBtn(x, "全部")?.props?.onClick?.();
  x = rerender(registered.Component, props);

  // 版本历史面板
  const histBtn = flat(x).find((n) => n?.props?.["aria-label"] === "历史「甲」");
  check("v1.3 行内有历史按钮", !!histBtn);
  histBtn?.props?.onClick?.();
  await new Promise((r) => setImmediate(r));
  x = rerender(registered.Component, props);
  const histTexts = textsOf13(x);
  check("v1.3 历史面板渲染标题", histTexts.includes("历史版本 ·「甲」"));
  check("v1.3 历史面板列出旧版本内容", histTexts.includes("旧内容"));
  const histCalls = calls.filter((c) => c.endpoint === "history");
  check("v1.3 历史走 history 端点", histCalls.length >= 1 && histCalls[0].payload.id === "a");

  fakeRpc.call = realCall;
}

// ── v1.3 命令面板：全局快捷唤起 Ctrl+Shift+K / Ctrl+Shift+P ──
{
  const V13P_DATA = [
    { id: "a", name: "甲", category: "开发", content: "内容甲", pinned: true, tags: ["常用"], revision: 1, lastUsedAt: 30, updatedAt: 30, deletedAt: null },
    { id: "b", name: "乙", category: "写作", content: "内容乙", pinned: false, tags: [], revision: 1, lastUsedAt: 100, updatedAt: 100, deletedAt: null },
  ];
  const realCall = fakeRpc.call;
  fakeRpc.call = (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload });
    if (endpoint === "list") return Promise.resolve({ ok: true, value: { version: 4, snippets: V13P_DATA } });
    if (endpoint === "touch") return Promise.resolve({ ok: true, value: {} });
    return Promise.resolve({ ok: false, error: { code: "x", message: "unknown" } });
  };
  const reloadPalette = async () => {
    let x = rerender(registered.Component, props);
    if (x.children.find((c) => c?.props?.id === "ps-panel")) {
      x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
      x = rerender(registered.Component, props);
    }
    x.children.find((c) => c?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 800, right: 200, bottom: 830 }) } });
    await new Promise((r) => setImmediate(r));
    return rerender(registered.Component, props);
  };
  const paletteOf = (t) => flat(t).find((n) => n?.props?.style?.position === "fixed" && n?.props?.style?.inset === 0);
  const textsOfP = (t) => flat(t).filter((x) => typeof x === "string");
  const inputOfP = (t) => flat(t).find((n) => n?.props?.placeholder?.includes("搜索片段"));

  // 收集全局 keydown handler
  const keyHandlers = [];
  const realAdd = document.addEventListener;
  const realRem = document.removeEventListener;
  document.addEventListener = (type, fn) => { if (type === "keydown") keyHandlers.push(fn); };
  document.removeEventListener = () => {};

  let x = await reloadPalette();
  // 触发挂载 keydown effect（reloadPalette 内部 rerender 已重跑 effect，但 test harness 不自动执行 effect）
  // 手动执行所有 effect 来注册 keydown handler
  for (const e of effects) { try { e.fn(); } catch (_) {} }
  // 找到 Ctrl+Shift+K 的 handler
  const openHandler = keyHandlers.find((fn) => fn.toString().includes("shiftKey"));
  check("v1.3 命令面板注册了全局唤起快捷键", typeof openHandler === "function");

  // 模拟 Ctrl+Shift+K（修复后按物理键位 code 判断，Shift 会把 key 变成大写 "K"）
  openHandler?.({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true, preventDefault: () => {} });
  x = rerender(registered.Component, props);
  const overlay = paletteOf(x);
  check("v1.3 命令面板打开后渲染 overlay", !!overlay);
  const pTexts = textsOfP(x);
  check("v1.3 命令面板列出片段（收藏置顶）", pTexts.includes("甲") && pTexts.includes("乙"));

  // 输入过滤
  const pinput = inputOfP(x);
  pinput?.props?.onChange?.({ target: { value: "乙" } });
  x = rerender(registered.Component, props);
  const pTexts2 = textsOfP(x);
  check("v1.3 命令面板支持搜索过滤", pTexts2.includes("乙") && !pTexts2.includes("甲"));

  // Enter 插入第一条
  const pinput2 = inputOfP(x);
  const beforeInserts = inserted.length;
  pinput2?.props?.onKeyDown?.({ key: "Enter", preventDefault: () => {} });
  await new Promise((r) => setImmediate(r));
  check("v1.3 命令面板 Enter 插入命中片段", inserted.length === beforeInserts + 1);

  document.addEventListener = realAdd;
  document.removeEventListener = realRem;
  fakeRpc.call = realCall;
}

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
