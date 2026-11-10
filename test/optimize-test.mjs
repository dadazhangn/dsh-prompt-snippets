// 用假 llm 服务验证 optimize 路径：正常流、provider/model 缺失、流内报错、取消、空结果。
// 第 8 组走 /snippet 命令 handler，会落盘，所以要隔离 DSH_HOME。
import "./isolate-home.mjs"; // 必须先顶 DSH_HOME 再 import 插件
import { apply } from "../index.js";

const results = [];
const check = (l, p, extra) => results.push(`${p ? "PASS" : "FAIL"}  ${l}${extra ? "  — " + extra : ""}`);

let handler = null;
let cmd = null;
let fakeLlm = null;
let fakeModel = null;

apply({
  connection: { register(_o, _c, fn) { handler = fn; } },
  commands: { register(d) { cmd = d; } },
  get(name) {
    if (name === "llm") return fakeLlm;
    if (name === "agentDefaultModel") return fakeModel;
    return undefined;
  },
});

// optimize 的 {content} 分支不碰磁盘；第 8 组命令会落盘，由 isolate-home 兜住。

function makeStream(chunks) {
  return async function* () { for (const c of chunks) yield c; };
}

async function runOptimize() {
  return handler("optimize", { content: "原始提示词 {{占位}}" }, undefined);
}

// 1) 无 llm 服务
fakeLlm = null;
let r = await runOptimize();
check("无 llm 服务时优雅报错", r.ok === false && r.error.code === "unavailable", r.error?.message);

// 2) 有 llm 但无默认模型
fakeLlm = { stream: makeStream([]) };
fakeModel = null;
r = await runOptimize();
check("无默认模型时优雅报错", r.ok === false && r.error.code === "unavailable", r.error?.message);

// 3) currentSelection 抛错
fakeModel = { currentSelection() { throw new Error("boom"); } };
r = await runOptimize();
check("currentSelection 抛错时优雅报错", r.ok === false && r.error.code === "unavailable", r.error?.message);

// 4) 正常流
fakeModel = { currentSelection: () => ({ provider: "p", model: "m" }) };
let captured = null;
fakeLlm = {
  stream(opts) { captured = opts; return makeStream([
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "优化后" },
    { type: "text-delta", index: 0, text: "的提示词 {{占位}}" },
    { type: "block-end", index: 0, block: { type: "text", text: "优化后的提示词 {{占位}}" } },
    { type: "usage", usage: { input: 1, output: 2 } },
    { type: "finish", reason: { kind: "stop" } },
  ])(); },
};
r = await runOptimize();
check("正常流返回 optimized", r.ok === true && r.value.optimized === "优化后的提示词 {{占位}}", r.value?.optimized);
check("透传 provider/model", captured?.provider === "p" && captured?.model === "m");
check("带 system 指令", typeof captured?.system === "string" && captured.system.includes("{{占位符}}"));
check("带 maxTokens", captured?.maxTokens === 600);
check("消息为 request-user-input 形状", captured?.messages?.[0]?.role === "user" && captured.messages[0].content[0].type === "text");

// 4b) 推理模型路径：resolveModelInfo 返回最低 effort，应透传 reasoningEffort 并提高 maxTokens
fakeModel = { currentSelection: () => ({ provider: "p", model: "m" }) };
let rCaptured = null;
fakeLlm = {
  resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "low", name: "低", description: "" }, { id: "high", name: "高", description: "" }] } }),
  stream(opts) { rCaptured = opts; return makeStream([
    { type: "reasoning-delta", index: 0, text: "思考过程" },
    { type: "text-delta", index: 0, text: "优化后的提示词 {{占位}}" },
    { type: "finish", reason: { kind: "stop" } },
  ])(); },
};
r = await runOptimize();
check("推理模型仍返回 optimized", r.ok === true && r.value.optimized === "优化后的提示词 {{占位}}", r.value?.optimized);
check("推理模型透传最低 reasoningEffort", rCaptured?.reasoningEffort === "low", JSON.stringify(rCaptured?.reasoningEffort));
check("推理模型提高 maxTokens", rCaptured?.maxTokens === 1600, String(rCaptured?.maxTokens));

// 模型达到输出上限时，即使已经产出正文，也不能把半截结果当成成功。
fakeLlm = { stream: makeStream([
  { type: "text-delta", text: "半截优化结果 {{占位}}" },
  { type: "finish", reason: { kind: "max-tokens" } },
]) };
r = await runOptimize();
check("输出达到上限时拒绝半截结果", r.ok === false && r.error.code === "output-limit", r.error?.code);

fakeLlm = { stream: makeStream([
  { type: "text-delta", text: "不完整结果 {{占位}}" },
  { type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT", message: "请求过于频繁" } } },
]) };
r = await runOptimize();
check("终止错误时拒绝部分结果", r.ok === false && r.error.code === "internal" && r.error.message === "请求过于频繁", r.error?.message);

fakeLlm = { stream: makeStream([
  { type: "text-delta", text: "不完整结果 {{占位}}" },
  { type: "finish", reason: { kind: "aborted", failure: { code: "ABORTED", message: "已取消" } } },
]) };
r = await runOptimize();
check("终止取消时拒绝部分结果", r.ok === false && r.error.code === "aborted", r.error?.code);

let streamRoute = null;
apply({
  connection: {
    register() {},
    fetch: { register(route) { streamRoute = route; return () => {}; } },
  },
  commands: { register() {} },
  effect(fn) { fn(); },
  get(name) {
    if (name === "llm") return fakeLlm;
    if (name === "agentDefaultModel") return fakeModel;
    return undefined;
  },
});
const makeStreamRequest = () => new Request("http://localhost/api/prompt-snippets/optimize-stream", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: "原始提示词 {{占位}}" }),
});
let overLimitStreamCalls = 0;
fakeLlm = { stream: async function* () { overLimitStreamCalls++; } };
const oversizedContent = "x".repeat(200_001);
r = await handler("optimize", { content: oversizedContent }, undefined);
check("RPC 优化拒绝超长输入", r.ok === false && r.error.code === "bad-request", r.error?.message);
const oversizedResponse = await streamRoute.fetch(new Request("http://localhost/api/prompt-snippets/optimize-stream", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ content: oversizedContent }),
}));
const oversizedMessages = (await oversizedResponse.text()).trim().split("\n").map(JSON.parse);
check("流式优化拒绝超长输入", oversizedMessages.at(-1)?.code === "bad-request" && overLimitStreamCalls === 0, JSON.stringify(oversizedMessages));

fakeLlm = { stream: makeStream([
  { type: "text-delta", text: "半截优化结果 {{占位}}" },
  { type: "finish", reason: { kind: "max-tokens" } },
]) };
const streamMessages = (await (await streamRoute.fetch(makeStreamRequest())).text()).trim().split("\n").map(JSON.parse);
check("流式输出达到上限时返回错误", streamMessages.at(-1)?.code === "output-limit", JSON.stringify(streamMessages.at(-1)));

fakeLlm = { stream: makeStream([
  { type: "text-delta", text: "不完整结果 {{占位}}" },
  { type: "finish", reason: { kind: "error", failure: { code: "RATE_LIMIT", message: "请求过于频繁" } } },
]) };
const failedStreamMessages = (await (await streamRoute.fetch(makeStreamRequest())).text()).trim().split("\n").map(JSON.parse);
check("流式终止错误返回 error", failedStreamMessages.at(-1)?.type === "error" && failedStreamMessages.at(-1)?.message === "请求过于频繁", JSON.stringify(failedStreamMessages.at(-1)));

// 5) 流内抛错
fakeLlm = { stream: async function* () { throw new Error("网络炸了"); } };
r = await runOptimize();
check("流内报错转为 internal", r.ok === false && r.error.code === "internal" && r.error.message.includes("网络炸了"), r.error?.message);

// 6) 取消
fakeLlm = {
  stream: async function* () {
    const e = new Error("aborted");
    throw e;
  },
};
const ac = new AbortController();
ac.abort();
r = await handler("optimize", { content: "x" }, ac.signal);
check("取消时返回 aborted", r.ok === false && r.error.code === "aborted", r.error?.code);

// 7) 空结果
fakeLlm = { stream: makeStream([{ type: "text-delta", index: 0, text: "   " }, { type: "finish", reason: { kind: "stop" } }]) };
r = await runOptimize();
check("空结果报 internal", r.ok === false && r.error.code === "internal", r.error?.message);

// 8) /snippet optimize 命令
fakeLlm = { stream: makeStream([{ type: "text-delta", index: 0, text: "命令优化结果" }]) };
fakeModel = { currentSelection: () => ({ provider: "p", model: "m" }) };
await cmd.handler({ rawInput: "add 优化目标 待优化的片段", signal: undefined });
const rc = await cmd.handler({ rawInput: "optimize 优化目标", signal: undefined });
check("命令 optimize 成功", rc.kind === "success" && rc.text.includes("命令优化结果"), rc.text?.split("\n")[0]);
const rc2 = await cmd.handler({ rawInput: "optimize 不存在的名字", signal: undefined });
check("命令 optimize 找不到时错误", rc2.kind === "error", rc2.text);
const rc3 = await cmd.handler({ rawInput: "optimize", signal: undefined });
check("命令 optimize 缺名字时提示用法", rc3.kind === "error" && rc3.text.includes("用法"), rc3.text);

console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
