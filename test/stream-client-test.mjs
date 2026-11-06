import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const begin = source.indexOf("      const streamOptimize = async");
const end = source.indexOf("\n      const optimize =", begin);
assert(begin >= 0 && end > begin);

let review;
const runStream = new Function("fetch", "setReview", "setOptimizing", "t", "msgOf", source.slice(begin, end) + "\nreturn streamOptimize;");
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
const stream = runStream(async () => responseFrom([
  { type: "delta", text: "中文" },
  { type: "done", optimized: "中文", truncated: false },
]), setReview, () => {}, (key) => key, (error) => error.message);

review = { busy: true, optimized: "" };
await stream({ content: "输入" }, 0);
assert.equal(review.optimized, "中文");
assert.equal(review.busy, false);
assert.equal(review.error, null);

const limited = runStream(async () => responseFrom([
  { type: "delta", text: "半截" },
  { type: "error", code: "output-limit", message: "输出达到上限" },
]), setReview, () => {}, (key) => key, (error) => error.message);
review = { busy: true, optimized: "" };
await limited({ content: "输入" }, 0);
assert.equal(review.incomplete, true);
assert.equal(review.error, "输出达到上限");

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
