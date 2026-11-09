import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const begin = source.indexOf("      const streamOptimize = async");
const end = source.indexOf("\n      const optimize =", begin);
assert(begin >= 0 && end > begin);

let review;
const runStream = new Function("fetch", "setReview", "setOptimizing", "t", "msgOf", "rpc", "CHANNEL", source.slice(begin, end) + "\nreturn streamOptimize;");
const setReview = (next) => { review = typeof next === "function" ? next(review) : next; };
const encoder = new TextEncoder();
function responseFrom(messages) {
  const data = encoder.encode(messages.map((message) => JSON.stringify(message) + "\n").join(""));
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= data.length) return controller.close();
      controller.enqueue(data.slice(offset, offset + 1));
      offset++;
    },
  }));
}
const translate = (key, values) => key === "error.optimizeHttp"
  ? `HTTP ${values.status}`
  : key;
const noRpc = { call: async () => { throw new Error("unexpected RPC call"); } };
const stream = runStream(async () => responseFrom([
  { type: "delta", text: "中文" },
  { type: "done", optimized: "中文", truncated: false },
]), setReview, () => {}, translate, (error) => error.message, noRpc, "test-channel");

review = { busy: true, optimized: "" };
await stream({ content: "输入" }, 0);
assert.equal(review.optimized, "中文");
assert.equal(review.busy, false);
assert.equal(review.error, null);

const limited = runStream(async () => responseFrom([
  { type: "delta", text: "半截" },
  { type: "error", code: "output-limit", message: "输出达到上限" },
]), setReview, () => {}, translate, (error) => error.message, noRpc, "test-channel");
review = { busy: true, optimized: "" };
await limited({ content: "输入" }, 0);
assert.equal(review.incomplete, true);
assert.equal(review.error, "输出达到上限");

for (const status of [404, 405]) {
  let rpcCall;
  const fallback = runStream(
    async () => new Response("route not found", { status }),
    setReview,
    () => {},
    translate,
    (error) => error.message,
    { call: async (...args) => {
      rpcCall = args;
      return { ok: true, value: { optimized: "RPC 结果", truncated: false } };
    } },
    "test-channel",
  );
  review = { busy: true, optimized: "" };
  await fallback({ content: "输入" }, 2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(rpcCall, ["test-channel", "optimize", { content: "输入" }, undefined]);
  assert.equal(review.optimized, "RPC 结果");
  assert.equal(review.retries, 2);
  assert.equal(review.busy, false);
}

const serverError = runStream(
  async () => new Response("server error", { status: 500 }),
  setReview,
  () => {},
  translate,
  (error) => error.message,
  noRpc,
  "test-channel",
);
review = { busy: true, optimized: "" };
await serverError({ content: "输入" }, 0);
assert.equal(review.incomplete, true);
assert.equal(review.error, "HTTP 500");

let component;
globalThis.document = { addEventListener() {}, removeEventListener() {} };
let slots = [];
let cursor = 0;
let pendingEffect = null;
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useMemo: (fn) => fn(),
  useEffect(fn, deps) {
    const index = cursor++;
    const prev = slots[index];
    if (prev && deps?.every((dep, i) => Object.is(dep, prev.deps[i]))) return;
    pendingEffect ??= [];
    pendingEffect.push(() => {
      prev?.dispose?.();
      slots[index] = { deps, dispose: fn() };
    });
  },
};
let subscriptions = 0;
const localeSubscribe = () => { subscriptions++; return () => { subscriptions--; }; };
const win = {
  innerWidth: 1400, innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
  __ModuleLoader__: { load({ factory }) {
    const plugin = factory((id) => {
      assert.equal(id, "react");
      return React;
    });
    plugin.apply({
      connection: { rpc: {} },
      effect() {},
      slots: { inject(_key, fn) { fn(); }, register(_options, fn) { component = fn; } },
    });
  } },
};
new Function("window", source)(win);
const props = { inputActions: null, rpc: { call: () => Promise.resolve({ ok: true, value: { snippets: [] } }) }, t: (key) => key, localeSubscribe };
for (let i = 0; i < 10; i++) {
  cursor = 0;
  pendingEffect = [];
  component(props);
  pendingEffect.forEach((effect) => effect());
}
assert.equal(subscriptions, 1);
for (const slot of slots) slot?.dispose?.();
assert.equal(subscriptions, 0);
console.log("stream-client-test: 3/3 passed");
