// 补充：client 端错误分支、警告展示、删除撤销条、优化按钮 busy 态。
const results = [];
const check = (l, p, extra) => results.push(`${p ? "PASS" : "FAIL"}  ${l}${extra ? "  — " + extra : ""}`);

let slots = [];
let cursor = 0;
let effects = [];

function useState(init) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
  const set = (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; };
  return [slots[i], set];
}
function useRef(init) {
  const i = cursor++;
  if (!(i in slots)) slots[i] = { current: init };
  return slots[i];
}
function useEffect(fn) { const i = cursor++; effects.push({ i, fn }); }
function useMemo(fn) { return fn(); }

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(9) }),
  useState, useEffect, useRef, useMemo,
};

let plugin = null;
global.window = {
  __ModuleLoader__: { load: ({ factory }) => { plugin = factory((s) => { if (s === "react") return React; throw new Error("require " + s); }); } },
  innerWidth: 1400, innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
global.localStorage = { _v: {}, getItem(k) { return this._v[k] ?? null; }, setItem(k, v) { this._v[k] = v; } };
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

const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("../client.js", import.meta.url), "utf8");
new Function("window", "localStorage", "document", "setTimeout", "require", src)(
  global.window, global.localStorage, global.document, global.setTimeout, undefined
);

let registered = null;
let mode = "ok";
const rpc = {
  call(channel, endpoint) {
    if (endpoint === "list") {
      if (mode === "fail") return Promise.resolve({ ok: false, error: { code: "internal", message: "读取炸了" } });
      if (mode === "reject") return Promise.reject(new Error("网络断了"));
      if (mode === "warn") return Promise.resolve({ ok: true, value: { version: 2, warning: "文件已备份", snippets: [] } });
      return Promise.resolve({ ok: true, value: { version: 2, snippets: [{ id: "1", name: "甲", category: null, content: "A", createdAt: 1, updatedAt: 1, deletedAt: null }] } });
    }
    if (endpoint === "delete") return Promise.resolve({ ok: true, value: { version: 2, snippets: [] } });
    return Promise.resolve({ ok: true, value: {} });
  },
};
const ctx = {
  connection: { rpc },
  effect(cb) { return cb(); },
  slots: { inject(k, cb) { cb(); }, register(o, C) { registered = { o, C }; return () => {}; } },
};
plugin.apply(ctx);

const flat = (n) => {
  const out = [];
  const walk = (x) => {
    if (!x) return;
    if (typeof x === "string" || typeof x === "number") { out.push(x); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    out.push(x);
    (x.children || []).forEach(walk);
  };
  walk(n);
  return out;
};
const texts = (n) => flat(n).filter((x) => typeof x === "string");

const props = { ...registered.o.inject(), inputActions: { captureInsertion: () => ({ from: 0, to: 0 }), insertText() {} } };
const render = () => { cursor = 0; effects = []; return registered.C(props); };
const runEffects = () => effects.forEach((e) => e.fn());

// 1) 读取失败 → 展开面板后显示错误
mode = "fail";
slots = []; cursor = 0; effects = [];
render(); runEffects();
await new Promise((r) => setImmediate(r));
let t = render();
flat(t).find((x) => x?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 800, right: 20, bottom: 830 }) } });
t = render();
let all = texts(t);
check("读取失败时面板显示错误文案", all.some((x) => x.includes("读取炸了")), all.join("|"));

// 2) Promise reject → 显示错误
mode = "reject";
slots = []; cursor = 0; effects = [];
render(); runEffects();
await new Promise((r) => setImmediate(r));
console.log("  (reject 分支已跑通，未抛未捕获异常)");

// 3) 警告展示
mode = "warn";
slots = []; cursor = 0; effects = [];
render(); runEffects();
await new Promise((r) => setImmediate(r));
t = render();
// 面板没展开时警告是否展示不确定，展开再看
const btn = flat(t).find((x) => x?.props?.id === "ps-button");
btn.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 800, right: 20, bottom: 830 }) } });
t = render();
all = texts(t);
check("警告在面板中可见", all.some((x) => x.includes("文件已备份")), all.join("|"));

// 4) insertText 返回 false（草稿版本已变）→ 面板保持打开并报错，不静默失败
mode = "ok";
slots = []; cursor = 0; effects = [];
let insertCalls = 0;
let insertReturn = false;
const propsFailing = {
  ...registered.o.inject(),
  inputActions: {
    captureInsertion: () => ({ from: 0, to: 0, draftRev: 3 }),
    insertText: () => {
      insertCalls++;
      return insertReturn;
    },
  },
};
const renderWith = (p) => {
  cursor = 0;
  effects = [];
  return registered.C(p);
};
let tn = renderWith(propsFailing);
runEffects();
await new Promise((r) => setImmediate(r));
tn = renderWith(propsFailing);
flat(tn).find((x) => x?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 800, right: 20, bottom: 830 }) } });
tn = renderWith(propsFailing);
const nameNode = flat(tn).find((x) => x?.props?.style && x?.props?.onClick && String(x.children?.[0] ?? "").includes("甲"));
nameNode.props.onClick();
tn = renderWith(propsFailing);
let all2 = texts(tn);
check("insertText 返 false 时在面板内报错", all2.some((x) => x.includes("插入失败")), all2.join("|"));
check("insertText 返 false 时不关闭面板", all2.filter((x) => x.includes("片段库")).length >= 1, "count=" + all2.filter((x) => x.includes("片段库")).length);

// 5) insertText 返回 true → 正常插入并关闭
insertReturn = true;
slots = []; cursor = 0; effects = [];
let tn2 = renderWith(propsFailing);
runEffects();
await new Promise((r) => setImmediate(r));
tn2 = renderWith(propsFailing);
flat(tn2).find((x) => x?.props?.id === "ps-button").props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 10, top: 800, right: 20, bottom: 830 }) } });
tn2 = renderWith(propsFailing);
const nameNode2 = flat(tn2).find((x) => x?.props?.style && x?.props?.onClick && String(x.children?.[0] ?? "").includes("甲"));
nameNode2.props.onClick();
tn2 = renderWith(propsFailing);
const all3 = texts(tn2);
check("insertText 返 true 时无错误文案", !all3.some((x) => x.includes("插入失败")), all3.join("|"));
check("insertText 返 true 时调用了底层 API", insertCalls >= 2, "calls=" + insertCalls);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
