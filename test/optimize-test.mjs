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
