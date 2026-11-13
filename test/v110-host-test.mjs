// v1.1.0 host 端全量测试。覆盖：迁移矩阵、存储可靠性、双轨匹配、
// 占位符扫描/渲染、--cat 收口、导入导出、touch 批量、能力握手。
import { TEST_HOME } from "./isolate-home.mjs"; // 必须先顶 DSH_HOME 再 import 插件
import { apply } from "../index.js";
import { readFile, writeFile, readdir, mkdir, stat, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const results = [];
let group = "";
const setGroup = (g) => { group = g; results.push(`\n── ${g} ──`); };
const check = (label, pass, extra) =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? "  — " + extra : ""}`);

// ── 假 ctx：只提供用到的三个服务 ──
let handler = null;
let commandDef = null;
const fakeLlm = { mode: "ok" };
apply({
  connection: { register(_o, _c, fn) { handler = fn; } },
  commands: { register(def) { commandDef = def; } },
  effect(fn) { try { fn(); } catch (_) {} },
  get(key) {
    if (key === "llm") {
      if (fakeLlm.mode === "none") return undefined;
      return {
        async *stream(opts) {
          if (fakeLlm.mode === "throw") throw new Error("模型炸了");
          if (fakeLlm.mode === "empty") return;
          const src = opts?.messages?.[0]?.content?.[0]?.text ?? "";
          if (fakeLlm.mode === "dropvar") { yield { type: "text-delta", text: "优化后没有占位符" }; return; }
          // 正常模式：保留输入里所有 {{占位符}}，证明校验能通过
          const vars = [...src.matchAll(/\{\{([^{}]+)\}\}/gu)].map((m) => m[1]);
          yield { type: "text-delta", text: `你是资深审查员。请审查：${vars.map((v) => `{{${v}}}`).join(" ")}` };
        },
      };
    }
    if (key === "agentDefaultModel") {
      if (fakeLlm.mode === "none") return undefined;
      return { currentSelection: () => ({ provider: "p", model: "m" }) };
    }
    return undefined;
  },
});

const HOME = TEST_HOME;
const DIR = join(HOME, "data", "prompt-snippets");
const FILE = join(DIR, "snippets.json");
const BAK = join(DIR, "snippets.json.bak");
await mkdir(DIR, { recursive: true });

const read = async () => JSON.parse(await readFile(FILE, "utf8"));
const reset = async (data) => {
  try {
    for (const f of await readdir(DIR)) {
      if (f !== "." && f !== "..") await writeFile(join(DIR, f), "", "utf8").catch(() => {});
    }
  } catch (_) {}
  const { unlink } = await import("node:fs/promises");
  for (const f of await readdir(DIR)) await unlink(join(DIR, f)).catch(() => {});
  if (data !== null) await writeFile(FILE, typeof data === "string" ? data : JSON.stringify(data), "utf8");
};
const cmd = (line) => commandDef.handler({ rawInput: line, signal: undefined });
const call = (ep, payload) => handler(ep, payload, undefined);

// ══════════════ 1. 能力握手 ══════════════
setGroup("1. 能力握手");
{
  const r = await call("capabilities", {});
  check("capabilities 返回 ok", r.ok === true);
  check("列出全部端点", Array.isArray(r.value?.endpoints) && r.value.endpoints.includes("restore"), r.value?.endpoints?.join(","));
  check("storeVersion = 4", r.value?.storeVersion === 4, String(r.value?.storeVersion));
  check("channel 正确", r.value?.channel === "/prompt-snippets", r.value?.channel);
}

// ══════════════ 2. 迁移矩阵 ══════════════
setGroup("2. 迁移矩阵");

// 2.1 无文件
await reset(null);
{
  const r = await call("list", {});
  check("无文件 → 首次预置模板包", r.ok === true && r.value.snippets.length === 8, String(r.value.snippets.length));
  check("模板包含代码审查", r.value.snippets.some((s) => s.name === "代码审查"));
  check("模板包含 Git 提交信息", r.value.snippets.some((s) => s.name === "Git 提交信息"));
  check("模板包含动态变量", r.value.snippets.some((s) => /\{\{date\}\}/.test(s.content) || /\{\{time\}\}/.test(s.content)));
  // 模板已落盘：再次读取（文件已存在）不应再注入第二份
  const r2 = await call("list", {});
  check("再次读取不重复注入", r2.value.snippets.length === 8, String(r2.value.snippets.length));
}

// 2.2 v1 真实生产形态（无 id / 无 deletedAt / 无 revision）
await reset({
  version: 1,
  snippets: [
    { id: "keep-me", name: "老片段", category: "旧类", content: "老内容", createdAt: 1000, updatedAt: 2000 },
    { name: "无id片段", content: "内容B", createdAt: 1500 },
  ],
});
{
  const r = await call("list", {});
  const a = r.value.snippets.find((s) => s.name === "老片段");
  const b = r.value.snippets.find((s) => s.name === "无id片段");
  check("v1 两片段都读出", r.value.snippets.length === 2);
  check("已有 id 保持不变", a?.id === "keep-me", a?.id);
  check("缺 id 自动补齐", typeof b?.id === "string" && b.id.length === 36, b?.id);
  check("createdAt 保持不变", a?.createdAt === 1000 && a?.updatedAt === 2000, `${a?.createdAt}/${a?.updatedAt}`);
  check("category 保留", a?.category === "旧类", a?.category);
  check("deletedAt 补 null", a?.deletedAt === null && b?.deletedAt === null);
  check("revision 补 1", a?.revision === 1 && b?.revision === 1, `${a?.revision}/${b?.revision}`);
  check("useCount 补 0", a?.useCount === 0 && b?.useCount === 0);
  check("lastUsedAt 补 null", a?.lastUsedAt === null);
  check("variables 补空对象", JSON.stringify(a?.variables) === "{}", JSON.stringify(a?.variables));
  const disk = await read();
  check("磁盘升到 version 4", disk.version === 4, String(disk.version));
  // 迁移前的现场必须是**原始 v1 字节**，不是迁移后的结果
  const preName = (await readdir(DIR)).find((f) => f === "snippets.json.pre-v4.bak");
  check("迁移前留了 pre-v4 备份", !!preName, preName || "(无)");
  if (preName) {
    const pre = JSON.parse(await readFile(join(DIR, preName), "utf8"));
    check("pre-v4 备份是原始 v1 内容", pre.version === 1 && pre.snippets.length === 2, `v${pre.version}/${pre.snippets?.length}`);
    check("pre-v4 备份保留原始字段（无 revision）", pre.snippets.every((s) => s.revision === undefined));
  }
}

// 2.3 脏数据：缺 name / content 非字符串 / 非对象
await reset({
  version: 2,
  snippets: [
    { id: "a", name: "", content: "x" },
    { id: "b", content: "没有名字" },
    { id: "c", name: "内容非法", content: 123 },
    null,
    "字符串条目",
    { id: "d", name: "好条目", content: "有效内容" },
  ],
});
{
  const r = await call("list", {});
  check("只保留 1 条有效", r.value.snippets.length === 1, String(r.value.snippets.length));
  check("丢弃 5 条并给出 warning", typeof r.value.warning === "string" && r.value.warning.includes("丢弃了 5 条"), r.value.warning);
}

// 2.4 重复 id
await reset({
  version: 2,
  snippets: [
    { id: "dup", name: "甲", content: "1" },
    { id: "dup", name: "乙", content: "2" },
  ],
});
{
  const r = await call("list", {});
  const ids = r.value.snippets.map((s) => s.id);
  check("重复 id 被修复（全唯一）", new Set(ids).size === 2, ids.join(","));
  check("修复后给出 warning", typeof r.value.warning === "string" && r.value.warning.includes("重复 id"), r.value.warning);
}

// 2.4b 不安全 id 在迁移时重建，安全的旧格式 id 保留
await reset({
  version: 4,
  snippets: [
    { id: "keep-me", name: "旧格式安全 id", content: "旧内容" },
    { id: "../../pwned", name: "路径穿越 id", content: "原内容" },
  ],
});
{
  const r = await call("list", {});
  const safe = r.value.snippets.find((s) => s.name === "旧格式安全 id");
  const repaired = r.value.snippets.find((s) => s.name === "路径穿越 id");
  check("安全旧格式 id 保持兼容", safe?.id === "keep-me", safe?.id);
  check("路径穿越 id 迁移为安全 id", repaired?.id !== "../../pwned" && /^[\w-]{1,128}$/u.test(repaired?.id || ""), repaired?.id);
  let escapedHistoryExists = true;
  try {
    await stat(join(TEST_HOME, "data", "pwned.json"));
  } catch (error) {
    escapedHistoryExists = error?.code !== "ENOENT";
  }
  check("迁移路径穿越 id 没有在 history 外生成文件", !escapedHistoryExists);
  const unsafeHistory = await call("history", { id: "../../pwned" });
  check("history 拒绝路径穿越 id", unsafeHistory.ok === false && unsafeHistory.error.code === "bad-request", JSON.stringify(unsafeHistory));
}

// 2.5 deletedAt 是字符串 "0"
await reset({
  version: 2,
  snippets: [{ id: "x", name: "串零", content: "c", deletedAt: "0" }],
});
{
  const r = await call("list", {});
  check('deletedAt="0" 归一为 null（视为未删除）', r.value.snippets.length === 1 && r.value.snippets[0].deletedAt === null);
}

// 2.6 revision 是 0 / 负数
await reset({
  version: 4,
  snippets: [
    { id: "r0", name: "零", content: "c", revision: 0 },
    { id: "rn", name: "负", content: "c", revision: -5 },
  ],
});
{
  const r = await call("list", {});
  const r0 = r.value.snippets.find((s) => s.id === "r0");
  const rn = r.value.snippets.find((s) => s.id === "rn");
  check("revision=0 归一到 1", r0?.revision === 1, String(r0?.revision));
  check("revision=-5 归一到 1", rn?.revision === 1, String(rn?.revision));
}

// 2.7 variables 有正文中不存在的键
await reset({
  version: 4,
  snippets: [{ id: "v1", name: "变量", content: "{{真实}}", variables: { 真实: { required: true }, 幽灵: {} } }],
});
{
  const r = await call("list", {});
  const v = r.value.snippets[0].variables;
  check("保留正文里真实出现的变量", !!v["真实"] && v["真实"].required === true, JSON.stringify(v));
  check("丢弃正文里不存在的变量键", !("幽灵" in v), JSON.stringify(v));
}

// 2.8 未来版本：拒绝加载且不动原文件
await reset({ version: 9, snippets: [{ id: "z", name: "未来", content: "很新" }] });
{
  const before = await readFile(FILE, "utf8");
  const r = await call("list", {});
  const after = await readFile(FILE, "utf8");
  check("未来版本 list 仍成功", r.ok === true);
  check("未来版本返回空库", r.value.snippets.length === 0);
  check("未来版本带 readOnly 标记", r.value.readOnly === true, JSON.stringify(r.value));
  check("提示来自更新版本", typeof r.value.warning === "string" && r.value.warning.includes("更新版本"), r.value.warning);
  check("原文件字节未改动", before === after);
  // 只读保护：写端点必须拒绝，不能把 version 9 覆盖成空库
  const wr = await call("save", { name: "新", content: "x" });
  check("未来版本 save 被拒绝", wr.ok === false && wr.error && wr.error.code === "read-only", JSON.stringify(wr.error));
  check("save 拒绝后原文件仍未动", (await readFile(FILE, "utf8")) === before);
}

// 2.9 迁移幂等：连跑两次不重复改写
await reset({
  version: 2,
  snippets: [{ id: "m", name: "幂等", content: "c" }],
});
{
  await call("list", {});
  const s1 = await stat(FILE);
  await new Promise((r) => setTimeout(r, 30));
  await call("list", {});
  const s2 = await stat(FILE);
  check("第二次 list 不产生写入（幂等）", s1.mtimeMs === s2.mtimeMs, `${s1.mtimeMs} vs ${s2.mtimeMs}`);
}

// 2.10 迁移前备份的边界：已有备份不覆盖 / 无需迁移就不产生备份
{
  const hasBak = async () => (await readdir(DIR)).includes("snippets.json.pre-v4.bak");

  // a) 已是**完整**的 v3（含全部字段）：不该凭空造备份
  //    注意：手写的最小 v3 记录缺 revision/variables 等，会被当成待修复 → 合法地产生备份，
  //    所以基线必须取一条真实保存后的规范输出。
  await reset(null);
  await call("save", { name: "基线", content: "hello" });
  const canonical = await read();
  check("基线是完整的 v4 记录", canonical.version === 4 && canonical.snippets[0].revision === 1, JSON.stringify(Object.keys(canonical.snippets[0])));
  await reset(canonical);
  await call("list", {});
  check("无需迁移时不产生 pre-v4 备份", !(await hasBak()));

  // b) 已有备份 + 再次从旧版本迁移：原备份字节必须一字不动
  await reset({ version: 2, snippets: [{ id: "y", name: "二次", content: "c2" }] });
  await writeFile(join(DIR, "snippets.json.pre-v4.bak"), "SENTINEL", "utf8");
  await call("list", {});
  const kept = await readFile(join(DIR, "snippets.json.pre-v4.bak"), "utf8");
  check("已有 pre-v4 备份不被覆盖", kept === "SENTINEL", kept.slice(0, 20));

  // c) 无文件（ENOENT 空库）：raw 是 undefined，不该造备份
  await reset(null);
  await call("list", {});
  check("空库首次读取不产生 pre-v4 备份", !(await hasBak()));
}

// ══════════════ 3. 存储可靠性 ══════════════
setGroup("3. 存储可靠性");

// 3.1 损坏文件：rename 隔离，字节完全一致
await reset("{ 这不是 JSON ");
{
  const original = await readFile(FILE, "utf8");
  const r = await call("list", {});
  const files = await readdir(DIR);
  const corrupt = files.filter((f) => f.startsWith("snippets.corrupt-"));
  check("损坏文件 list 仍成功", r.ok === true);
  check("生成了 corrupt 备份", corrupt.length === 1, corrupt.join(","));
  const saved = await readFile(join(DIR, corrupt[0]), "utf8");
  check("备份与原文件逐字节相同", saved === original, `${saved.length} vs ${original.length}`);
  check("主文件已被搬移（不存在）", !files.includes("snippets.json"), files.join(","));
  check("返回里带提示", typeof r.value.warning === "string" && r.value.warning.length > 0, r.value.warning);
}

// 3.2 结构非法（snippets 不是数组）
await reset(JSON.stringify({ version: 4, snippets: "不是数组" }));
{
  const r = await call("list", {});
  const files = await readdir(DIR);
  check("结构非法也自愈", r.ok === true && r.value.snippets.length === 0);
  check("结构非法也搬移备份", files.some((f) => f.startsWith("snippets.corrupt-")));
}

// 3.3 .bak 轮换：第二次写入后 .bak = 第一次的内容
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "第一", content: "c1" });
  const first = await readFile(FILE, "utf8");
  await call("save", { name: "第二", content: "c2" });
  const bakExists = await stat(BAK).then(() => true).catch(() => false);
  check("写入后存在 .bak", bakExists);
  const bak = await readFile(BAK, "utf8");
  check(".bak 内容是上一次成功写入的完整 JSON", bak === first, `bak=${bak.length} first=${first.length}`);
  const bakParsed = JSON.parse(bak);
  check(".bak 可解析且只含第一", bakParsed.snippets.length === 1 && bakParsed.snippets[0].name === "第一");
  const backups = await call("backups", {});
  check("备份列表端点发现轮换备份", backups.ok && backups.value.backups.some((item) => item.name === "snippets.json.bak"));
  const selectedBackup = backups.value.backups.find((item) => item.name === "snippets.json.bak");
  check("备份列表带有对应内容的 SHA-256 指纹", selectedBackup.sourceHash === createHash("sha256").update(bak, "utf8").digest("hex"));
  const beforeRestore = await readFile(FILE, "utf8");
  const missingHash = await call("restore-backup", { name: selectedBackup.name });
  const invalidHash = await call("restore-backup", { name: selectedBackup.name, expectedSourceHash: "invalid" });
  check("恢复备份必须携带有效指纹", !missingHash.ok && missingHash.error.code === "bad-request" && !invalidHash.ok && invalidHash.error.code === "bad-request");
  check("指纹缺失或不合法时不修改当前库和备份", await readFile(FILE, "utf8") === beforeRestore && await readFile(BAK, "utf8") === bak);
  const restored = await call("restore-backup", { name: selectedBackup.name, expectedSourceHash: selectedBackup.sourceHash });
  check("恢复备份成功并返回恢复来源", restored.ok && restored.value.restoredBackup === "snippets.json.bak", restored.error?.message);
  check("恢复后数据来自备份", (await read()).snippets.map((s) => s.name).join(",") === "第一");
  check("恢复前当前库已进入轮换备份", await readFile(BAK, "utf8") === beforeRestore);
  const restoredSnippet = (await read()).snippets[0];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let pendingTouchCallback = null;
  globalThis.setTimeout = (fn) => {
    pendingTouchCallback = fn;
    return { unref() {} };
  };
  globalThis.clearTimeout = () => {};
  await call("touch", { ids: [restoredSnippet.id] });
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  const nextBackup = (await call("backups", {})).value.backups.find((item) => item.name === "snippets.json.bak");
  const restoredAgain = await call("restore-backup", { name: nextBackup.name, expectedSourceHash: nextBackup.sourceHash });
  pendingTouchCallback?.();
  await new Promise((resolve) => realSetTimeout(resolve, 20));
  const afterPendingTouchRestore = (await read()).snippets[0];
  check("恢复备份丢弃尚未落盘的旧库使用计数", restoredAgain.ok && afterPendingTouchRestore.useCount === restoredSnippet.useCount);
  await writeFile(join(DIR, "snippets.json.bak.2"), JSON.stringify({
    version: 1,
    snippets: [{ name: "旧格式恢复", content: "迁移后恢复" }],
  }), "utf8");
  const legacyBackup = (await call("backups", {})).value.backups.find((item) => item.name === "snippets.json.bak.2");
  const legacyRestore = await call("restore-backup", { name: legacyBackup.name, expectedSourceHash: legacyBackup.sourceHash });
  check("旧格式备份恢复时迁移到当前版本", legacyRestore.ok && (await read()).version === 4, legacyRestore.error?.message);
  check("旧格式备份内容恢复", (await read()).snippets[0]?.name === "旧格式恢复");
  const beforeBadRestore = await readFile(FILE, "utf8");
  await writeFile(join(DIR, "snippets.json.bak.3"), "{invalid", "utf8");
  const invalidBackup = await call("restore-backup", { name: "snippets.json.bak.3", expectedSourceHash: createHash("sha256").update("{invalid").digest("hex") });
  check("损坏备份被排除在可恢复列表之外", !(await call("backups", {})).value.backups.some((item) => item.name === "snippets.json.bak.3"));
  check("拒绝恢复损坏备份", invalidBackup.ok === false && invalidBackup.error.code === "bad-request");
  check("损坏备份恢复失败时当前库保持不变", await readFile(FILE, "utf8") === beforeBadRestore);
  await writeFile(join(DIR, "snippets.json.bak.4"), " ".repeat(8_000_001), "utf8");
  const backupsWithOversized = await call("backups", {});
  check("超大备份不会进入可恢复列表", !backupsWithOversized.value.backups.some((item) => item.name === "snippets.json.bak.4"));
  const oversizedRestore = await call("restore-backup", { name: "snippets.json.bak.4", expectedSourceHash: selectedBackup.sourceHash });
  check("超大备份在读取前被拒绝", oversizedRestore.ok === false && oversizedRestore.error.code === "bad-request" && oversizedRestore.error.message.includes("过大"));
  const unsafeRestore = await call("restore-backup", { name: "..\\outside.json" });
  check("拒绝越界备份名", unsafeRestore.ok === false && unsafeRestore.error.code === "bad-request");
}

// 选中到确认之间发生轮换时，不能把同名文件中的另一份快照恢复进去。
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "第一", content: "c1" });
  await call("save", { name: "第二", content: "c2" });
  const selectedBackup = (await call("backups", {})).value.backups.find((item) => item.name === "snippets.json.bak");
  await call("save", { name: "第三", content: "c3" });
  const currentRaw = await readFile(FILE, "utf8");
  const currentBackup = await readFile(BAK, "utf8");
  const staleRestore = await call("restore-backup", { name: selectedBackup.name, expectedSourceHash: selectedBackup.sourceHash });
  check("选中后发生备份轮换时拒绝恢复另一份快照", !staleRestore.ok && staleRestore.error.code === "conflict");
  check("备份指纹冲突时当前库和备份均不改写", await readFile(FILE, "utf8") === currentRaw && await readFile(BAK, "utf8") === currentBackup);
  const missingBackup = await call("restore-backup", { name: "snippets.json.bak.7", expectedSourceHash: selectedBackup.sourceHash });
  check("已消失的备份要求刷新并重新选择", !missingBackup.ok && missingBackup.error.code === "conflict");
  const refreshedBackup = (await call("backups", {})).value.backups.find((item) => item.name === selectedBackup.name);
  check("刷新后的备份指纹反映轮换后的内容", refreshedBackup.sourceHash !== selectedBackup.sourceHash);
  const freshRestore = await call("restore-backup", { name: refreshedBackup.name, expectedSourceHash: refreshedBackup.sourceHash });
  check("重新选择后可恢复当前备份快照", freshRestore.ok && (await read()).snippets.map((item) => item.name).join(",") === "第一,第二");
}

// 3.4 无临时文件残留
{
  const files = await readdir(DIR);
  const tmp = files.filter((f) => f.endsWith(".tmp"));
  check("无 .tmp 残留", tmp.length === 0, tmp.join(","));
}

// 3.5 corrupt 文件最多保留 5 份
await reset(null);
{
  for (let i = 0; i < 8; i++) {
    await writeFile(FILE, `{ 坏${i} `, "utf8");
    await call("list", {});
  }
  const files = await readdir(DIR);
  const corrupt = files.filter((f) => f.startsWith("snippets.corrupt-"));
  check("corrupt 最多保留 5 份", corrupt.length <= 5, String(corrupt.length));
}

// 3.6 并发 50 条不丢
await reset({ version: 4, snippets: [] });
{
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => call("save", { name: `并发${i}`, content: `内容${i}` }))
  );
  const store = await read();
  check("并发 50 条全部落盘", store.snippets.length === 50, String(store.snippets.length));
  check("无重名覆盖", new Set(store.snippets.map((s) => s.name)).size === 50);
  check("id 全唯一", new Set(store.snippets.map((s) => s.id)).size === 50);
}

// ══════════════ 4. 双轨匹配 ══════════════
setGroup("4. 双轨匹配");
await reset({ version: 4, snippets: [] });
{
  const s1 = (await call("save", { name: "唯一", content: "c" })).value.snippet;
  check("按名称删除唯一命中", (await call("delete", { ref: "唯一" })).ok === true);
  check("按 #前缀恢复", (await call("restore", { ref: `#${s1.id.slice(0, 6)}` })).ok === true);

  // 造重名：先建 3 个不同名，再直接改盘造同名（绕过 nameTaken）
  const t = [];
  for (const n of ["周报A", "周报B", "周报C"]) {
    t.push((await call("save", { name: n, content: "c" })).value.snippet);
  }
  const store = await read();
  for (const rec of store.snippets) {
    if (rec.id === t[0].id || rec.id === t[1].id || rec.id === t[2].id) rec.name = "周报";
  }
  await reset(store);

  const dup = await call("delete", { ref: "周报" });
  check("重名删除报 conflict", dup.ok === false && dup.error.code === "conflict", dup.error?.code);
  check("conflict 带 conflict=name", dup.error?.details?.conflict === "name", JSON.stringify(dup.error?.details));
  check("conflict 文案列出候选", dup.error.message.includes("#"), dup.error?.message?.slice(0, 80));
  const stillThere = await call("list", {});
  check("重名时一条都没删", stillThere.value.snippets.filter((s) => s.name === "周报").length === 3);

  const byPrefix = await call("delete", { ref: `#${t[1].id.slice(0, 6)}` });
  check("按 #前缀可精确删除重名之一", byPrefix.ok === true, byPrefix.error?.message);

  // 名称唯一性冲突
  await reset({ version: 4, snippets: [] });
  await call("save", { name: "占位名", content: "a" });
  const other = (await call("save", { name: "另一个", content: "b" })).value.snippet;
  const collide = await call("save", { id: other.id, name: "占位名", content: "c" });
  check("改名撞名报 conflict", collide.ok === false && collide.error.code === "conflict", collide.error?.code);

  // 已删除片段的名字可被复用
  await reset({ version: 4, snippets: [] });
  const d1 = (await call("save", { name: "可复用", content: "v1" })).value.snippet;
  await call("delete", { id: d1.id });
  const d2 = await call("save", { name: "可复用", content: "v2" });
  check("已删除片段的名字可以复用", d2.ok === true && d2.created === true, `ok=${d2.ok} created=${d2.created} err=${d2.error?.message}`);

  // 恢复时撞名
  const r2 = await call("restore", { id: d1.id });
  check("恢复时撞名报 conflict", r2.ok === false && r2.error.code === "conflict", r2.error?.code);
  check("恢复撞名提示先改名", r2.error.message.includes("改名"), r2.error?.message);
}

// ══════════════ 5. revision 乐观锁 ══════════════
setGroup("5. revision 乐观锁");
await reset({ version: 4, snippets: [] });
{
  const s = (await call("save", { name: "锁", content: "v1" })).value.snippet;
  check("新建 revision=1", s.revision === 1, String(s.revision));
  const u1 = await call("save", { id: s.id, name: "锁", content: "v2", expectedRevision: 1 });
  check("revision 匹配时更新成功", u1.ok === true);
  check("更新后 revision=2", u1.value.snippet.revision === 2, String(u1.value.snippet.revision));  const u2 = await call("save", { id: s.id, name: "锁", content: "v3", expectedRevision: 1 });
  check("revision 过期时报 conflict", u2.ok === false && u2.error.code === "conflict", u2.error?.code);
  check("conflict 带 conflict=revision", u2.error?.details?.conflict === "revision");
  check("conflict 返回当前 revision", u2.error?.details?.current?.revision === 2, String(u2.error?.details?.current?.revision));
  const u3 = await call("save", { id: s.id, name: "锁", content: "v3", expectedRevision: 1, force: true });
  check("force 跳过 revision 检查", u3.ok === true && u3.value.snippet.revision === 3, u3.error?.message);
  const gone = await call("save", { id: "不存在", name: "x", content: "y" });
  check("id 不存在报 not-found（不静默新建）", gone.ok === false && gone.error.code === "not-found", gone.error?.code);
}

// ══════════════ 6. 占位符 ══════════════
setGroup("6. 占位符");
await reset({ version: 4, snippets: [] });
{
  const cases = [
    ["{{标题}}", ["标题"], "基本变量"],
    ["\\{{标题}}", [], "反斜杠转义成字面量"],
    ["\\\\{{标题}}", ["标题"], "双反斜杠 = 反斜杠 + 变量"],
    ["{{}}", [], "空名不算变量"],
    ["{{ }}", [], "空格名不算变量"],
    ["{{{x}}}", ["x"], "三花括号 = { + 变量 + }"],
    ["{{标题}}{{标题}}", ["标题"], "同名只记录一次"],
    ["{{a}}{{b}}", ["a", "b"], "多个不同变量"],
    ["中文{{中文变量}}结尾", ["中文变量"], "中文变量名"],
    ["{{super-long-name_over-40}}", ["super-long-name_over-40"], "允许的字符集"],
  ];
  for (const [content, expect, label] of cases) {
    const r = await call("save", { name: `ph-${label}`, content });
    const vars = r.ok ? r.value.snippet.variables : {};
    const keys = Object.keys(vars);
    const ok = keys.length === expect.length && expect.every((e) => keys.includes(e));
    check(`扫描：${label}`, ok, `期望 [${expect}] 实际 [${keys}]`);
  }

  // 保存时丢弃正文中不存在的变量键
  const withGhost = await call("save", {
    name: "幽灵键",
    content: "只有 {{真实}}",
    variables: { 真实: { required: true }, 幽灵: { default: "x" } },
  });
  check("保存时丢弃幽灵变量键", !("幽灵" in withGhost.value.snippet.variables), JSON.stringify(withGhost.value.snippet.variables));
}

// ══════════════ 7. optimize ══════════════
setGroup("7. optimize");
await reset({ version: 4, snippets: [] });
{
  fakeLlm.mode = "none";
  const noLlm = await call("optimize", { content: "原提示词" });
  check("无 llm 服务返回 unavailable", noLlm.ok === false && noLlm.error.code === "unavailable", noLlm.error?.code);

  fakeLlm.mode = "ok";
  const okr = await call("optimize", { content: "请审查 {{代码}}" });
  check("正常优化返回 optimized", okr.ok === true && typeof okr.value.optimized === "string", okr.error?.message);
  check("同时返回 original", okr.value?.original === "请审查 {{代码}}");
  check("truncated=false", okr.value?.truncated === false);

  fakeLlm.mode = "dropvar";
  const dropped = await call("optimize", { content: "请审查 {{代码}}" });
  check("优化结果丢失占位符时报错", dropped.ok === false && dropped.error.code === "internal", dropped.error?.code);
  check("报错指出丢了哪个占位符", dropped.error.message.includes("{{代码}}"), dropped.error?.message);

  fakeLlm.mode = "empty";
  const empty = await call("optimize", { content: "x" });
  check("优化结果为空时报错", empty.ok === false && empty.error.message.includes("为空"), empty.error?.message);

  fakeLlm.mode = "throw";
  const boom = await call("optimize", { content: "x" });
  check("模型抛错时降级为 internal", boom.ok === false && boom.error.code === "internal", boom.error?.code);

  fakeLlm.mode = "ok";
  const bad = await call("optimize", { content: "   " });
  check("空内容报 bad-request", bad.ok === false && bad.error.code === "bad-request", bad.error?.code);

  // 按 id 优化
  const s = (await call("save", { name: "按id优化", content: "请审查 {{代码}}" })).value.snippet;
  const byId = await call("optimize", { id: s.id });
  check("支持按 id 优化", byId.ok === true, byId.error?.message);
}

// ══════════════ 8. --cat 收口 ══════════════
setGroup("8. --cat 收口");
await reset({ version: 4, snippets: [] });
{
  const t1 = await cmd("add 报表 生成本周周报 --cat=写作");
  check("行尾 --cat= 被识别", t1.kind === "success" && t1.text.includes("写作"), t1.text);
  const s1 = (await call("list", {})).value.snippets.find((s) => s.name === "报表");
  check("分类正确落库", s1?.category === "写作", s1?.category);
  check("正文不含 --cat=", !s1?.content.includes("--cat"), s1?.content);

  const t2 = await cmd("add 报表2 生成本周周报 --cat 写作");
  const s2 = (await call("list", {})).value.snippets.find((s) => s.name === "报表2");
  check("行尾 --cat 空格形式被识别", s2?.category === "写作", s2?.category);
  check("正文干净", s2?.content === "生成本周周报", s2?.content);

  // 正文中间的 --cat 原样保留（旧版会吞掉正文）
  const t3 = await cmd("add 编译 运行 gcc -c main.c 看看报错");
  const s3 = (await call("list", {})).value.snippets.find((s) => s.name === "编译");
  check("正文中间的 -c 不被吞", s3?.content === "运行 gcc -c main.c 看看报错", s3?.content);
  check("此时无分类", s3?.category === null, s3?.category);

  const t4 = await cmd("add 说明 用法是 --cat 空格 分类");
  const s4 = (await call("list", {})).value.snippets.find((s) => s.name === "说明");
  check("正文里的 --cat 原样保留", s4?.content === "用法是 --cat 空格 分类", s4?.content);
  check("并给出提示", t4.text.includes("按字面保留"), t4.text);

  // -- 终止符
  const t5 = await cmd("add 终止 结尾是 -- --cat");
  const s5 = (await call("list", {})).value.snippets.find((s) => s.name === "终止");
  check("-- 之后全按字面", s5?.content === "结尾是 --cat", s5?.content);

  // 目录里最后一个 token 是 --cat 单独出现 → 显式清空分类
  await cmd("add 清空 正文 --cat=旧类");
  const t6 = await cmd("add 清空 正文 --cat");
  const s6 = (await call("list", {})).value.snippets.find((s) => s.name === "清空");
  check("裸 --cat 结尾 = 显式清空分类", s6?.category === null, s6?.category);
}

// ══════════════ 9. 命令族 ══════════════
setGroup("9. 命令族");
await reset({ version: 4, snippets: [] });
{
  const l0 = await cmd("");
  check("空参数 → 引导语", l0.kind === "success" && l0.text.includes("还没有"), l0.text);
  await cmd("add 甲 内容甲 --cat=类A");
  await cmd("add 乙 内容{{变}}");
  const l1 = await cmd("list");
  check("list 列出 2 条", l1.text.includes("已保存 2 个片段"), l1.text);
  check("list 标出分类", l1.text.includes("[类A]"), l1.text);
  check("list 标出变量", l1.text.includes("{变}"), l1.text);

  const sh = await cmd("show 甲");
  check("show 输出正文", sh.kind === "success" && sh.text.includes("内容甲"), sh.text);
  check("show 输出短 id", /#[0-9a-f]{6}/.test(sh.text), sh.text.slice(0, 20));

  const mv = await cmd("mv 甲 丙");
  check("mv 改名成功", mv.kind === "success" && mv.text.includes("丙"), mv.text);
  const afterMv = (await call("list", {})).value.snippets;
  check("改名后旧名消失", !afterMv.some((s) => s.name === "甲"));
  check("改名后新名存在", afterMv.some((s) => s.name === "丙"));
  check("改名保留分类", afterMv.find((s) => s.name === "丙")?.category === "类A");

  const rm = await cmd("rm 丙");
  check("rm 成功", rm.kind === "success" && rm.text.includes("已删除"), rm.text);
  const un = await cmd("undo 丙");
  check("undo 成功", un.kind === "success" && un.text.includes("已恢复"), un.text);

  const bad = await cmd("nonsense");
  check("未知子命令报错且给用法", bad.kind === "error" && bad.text.includes("用法"), bad.text);
  const noName = await cmd("rm");
  check("rm 缺参数给用法", noName.kind === "error" && noName.text.includes("用法"), noName.text);

  // optimize 命令
  fakeLlm.mode = "ok";
  const opt = await cmd("optimize 乙");
  check("optimize 命令成功", opt.kind === "success" && opt.text.includes("优化结果"), opt.text);
  const optMissing = await cmd("optimize 不存在");
  check("optimize 找不到时报错", optMissing.kind === "error", optMissing.text);
}

// ══════════════ 10. 导入导出 ══════════════
setGroup("10. 导入导出");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "导出甲", category: "类A", content: "内容{{v}}" });
  await call("save", { name: "导出乙", content: "纯文本" });

  const ex = await call("export", {});
  check("export 成功", ex.ok === true);
  check("export 计数正确", ex.value.count === 2, String(ex.value.count));
  const parsed = JSON.parse(ex.value.json);
  check("导出格式标记", parsed.format === "dsh-prompt-snippets", parsed.format);
  check("导出不含 id", !("id" in parsed.snippets[0]), JSON.stringify(parsed.snippets[0]));
  check("导出不含 useCount", !("useCount" in parsed.snippets[0]));
  check("导出含 variables", !!parsed.snippets.find((s) => s.name === "导出甲")?.variables);

  // 按 ids 导出
  const one = (await call("list", {})).value.snippets.find((s) => s.name === "导出乙");
  const ex1 = await call("export", { ids: [one.id] });
  check("按 ids 导出只含 1 条", ex1.value.count === 1, String(ex1.value.count));

  const exportsDir = join(DIR, "exports");
  await mkdir(exportsDir, { recursive: true });
  const allFile = join(exportsDir, "snippets.json");
  const filteredFile = join(exportsDir, "snippets-filtered.json");
  await writeFile(allFile, "keep full export", "utf8");
  await writeFile(filteredFile, "keep filtered export", "utf8");
  const failedFilteredWrite = await call("export", { ids: ["missing-id"], write: "" });
  check("空子集失败时不改写任何导出文件", failedFilteredWrite.ok === false && await readFile(allFile, "utf8") === "keep full export" && await readFile(filteredFile, "utf8") === "keep filtered export");
  const fullWrite = await call("export", { write: "" });
  check("空文件名全量导出使用 snippets.json", fullWrite.ok === true && fullWrite.value.path === allFile, fullWrite.value?.path);
  const fullContents = await readFile(allFile, "utf8");
  const filteredWrite = await call("export", { ids: [one.id], write: "" });
  check("空文件名筛选导出使用独立文件", filteredWrite.ok === true && filteredWrite.value.path === filteredFile, filteredWrite.value?.path);
  check("筛选导出没有覆盖全量备份", await readFile(allFile, "utf8") === fullContents);
  for (const [label, payload] of [
    ["null", { ids: null }],
    ["非数组", { ids: "bad-id" }],
    ["空数组", { ids: [] }],
    ["空白 ID", { ids: ["  "] }],
    ["混合类型", { ids: [one.id, 1] }],
  ]) {
    const invalid = await call("export", payload);
    check(`筛选导出拒绝${label}`, invalid.ok === false && invalid.error.code === "bad-request", JSON.stringify(invalid.error));
  }
  const missingIds = await call("export", { ids: ["missing-id"], write: "" });
  check("无匹配片段时拒绝筛选导出", missingIds.ok === false && missingIds.error.message.includes("没有可导出的匹配片段"), JSON.stringify(missingIds.error));
  check("无匹配子集仍不覆盖已有文件", await readFile(allFile, "utf8") === fullContents && JSON.parse(await readFile(filteredFile, "utf8")).snippets.length === 1);

  // dryRun 导入
  await reset({ version: 4, snippets: [] });
  const dry = await call("import", { json: ex.value.json, mode: "merge", dryRun: true });
  check("dryRun 返回 plan", dry.ok === true && dry.value.plan.added === 2, JSON.stringify(dry.value?.plan));
  const afterDry = (await call("list", {})).value.snippets;
  check("dryRun 不落盘", afterDry.length === 0, String(afterDry.length));

  // 真导入 merge
  const imp = await call("import", { json: ex.value.json, mode: "merge" });
  check("import merge 成功", imp.ok === true, imp.error?.message);
  check("新增 2 条", imp.value.plan.added === 2, JSON.stringify(imp.value.plan));
  const imported = (await call("list", {})).value.snippets;
  check("导入后库里有 2 条", imported.length === 2, String(imported.length));
  check("导入保留 variables", Object.keys(imported.find((s) => s.name === "导出甲")?.variables || {}).includes("v"));

  // 再次 merge 应跳过同名
  const again = await call("import", { json: ex.value.json, mode: "merge" });
  check("重复 merge 全部跳过", again.value.plan.skipped === 2 && again.value.plan.added === 0, JSON.stringify(again.value.plan));

  // 坏 JSON
  const bad = await call("import", { json: "{ 不是 JSON", mode: "merge" });
  check("非法 JSON 报 bad-request", bad.ok === false && bad.error.code === "bad-request", bad.error?.code);
  const noList = await call("import", { json: JSON.stringify({ foo: 1 }), mode: "merge" });
  check("没有 snippets 数组报 bad-request", noList.ok === false, noList.error?.code);

  // 裸数组也能导入
  const arr = await call("import", { json: JSON.stringify([{ name: "裸数组", content: "c" }]), mode: "merge" });
  check("接受裸数组", arr.ok === true && arr.value.plan.added === 1, arr.error?.message);
}

// ══════════════ 11. touch 批量 ══════════════
setGroup("11. touch 批量");
await reset({ version: 4, snippets: [] });
{
  const s = (await call("save", { name: "计数", content: "c" })).value.snippet;
  const t1 = await call("touch", { ids: [s.id] });
  check("touch 返回 ok", t1.ok === true);
  const beforeFlush = (await read()).snippets.find((x) => x.id === s.id);
  check("未落盘时磁盘 useCount 仍为 0（延迟写）", beforeFlush.useCount === 0, String(beforeFlush.useCount));

  // 累计 20 次触发立即 flush
  for (let i = 0; i < 20; i++) await call("touch", { ids: [s.id] });
  await new Promise((r) => setTimeout(r, 60));
  const after = (await read()).snippets.find((x) => x.id === s.id);
  check("累计 20 次后落盘", after.useCount >= 20, String(after.useCount));
  check("lastUsedAt 已写入", typeof after.lastUsedAt === "number" && after.lastUsedAt > 0, String(after.lastUsedAt));

  const bad = await call("touch", { ids: "不是数组" });
  check("ids 非数组时不报错", bad.ok === true);
}

// ══════════════ 12. 参数校验 ══════════════
setGroup("12. 参数校验");
await reset({ version: 4, snippets: [] });
{
  check("空名称被拒", (await call("save", { name: "", content: "x" })).error?.code === "bad-request");
  check("超长名称被拒", (await call("save", { name: "x".repeat(200), content: "x" })).error?.code === "bad-request");
  check("非字符串内容被拒", (await call("save", { name: "ok", content: 123 })).error?.code === "bad-request");
  check("空 content 允许（非 null）", (await call("save", { name: "空正文", content: "" })).ok === true);
  check("未知 endpoint 报 not-found", (await call("nope", {})).error?.code === "not-found");
  const unknownMsg = (await call("nope", {})).error?.message;
  check("未知 endpoint 提示重启", unknownMsg.includes("重启"), unknownMsg);
  check("delete 缺 id/ref 报 bad-request", (await call("delete", {})).error?.code === "bad-request");
  check("restore 缺 id/ref 报 bad-request", (await call("restore", {})).error?.code === "bad-request");
  check("get 缺 id 报 bad-request", (await call("get", {})).error?.code === "bad-request");
  check("get 不存在报 not-found", (await call("get", { id: "无" })).error?.code === "not-found");
}

// ══════════════ 内置模板恢复 ══════════════
setGroup("内置模板恢复预演与确认");
{
  await reset(null);
  const seeded = await call("list", {});
  check("首次预置的 8 条模板带稳定 builtinId", seeded.value.snippets.length === 8 && seeded.value.snippets.every((snippet) => /^dsh\.prompt-snippets\.[a-z0-9-]+$/u.test(snippet.builtinId || "")));

  const target = seeded.value.snippets.find((snippet) => snippet.name === "代码审查");
  await call("delete", { id: target.id });
  const preview = await call("builtin-restore", { dryRun: true });
  check("预演只报告恢复删除项且不写库", preview.ok && preview.value.plan.restored === 1 && preview.value.plan.added === 0 && (await read()).snippets.find((snippet) => snippet.id === target.id).deletedAt !== null);
  const restored = await call("builtin-restore", { expectedStoreHash: preview.value.storeHash });
  const restoredStore = await read();
  const restoredTarget = restoredStore.snippets.find((snippet) => snippet.id === target.id);
  check("确认恢复保留原 ID 与正文并清除删除状态", restored.ok && restoredTarget.id === target.id && restoredTarget.content === target.content && restoredTarget.deletedAt === null);
  check("恢复已有模板递增 revision", restoredTarget.revision === target.revision + 2, String(restoredTarget.revision));
  const repeatPreview = await call("builtin-restore", { dryRun: true });
  check("重复预演幂等且不再新增或恢复", repeatPreview.value.plan.added === 0 && repeatPreview.value.plan.restored === 0 && repeatPreview.value.plan.present === 8);
  const repeat = await call("builtin-restore", { expectedStoreHash: repeatPreview.value.storeHash });
  check("重复确认不改变现有数据", repeat.ok && repeat.value.snippets.length === 8 && repeat.value.snippets.find((snippet) => snippet.id === target.id).revision === restoredTarget.revision);
  const deletedTemplate = repeat.value.snippets.find((snippet) => snippet.name === "周报");
  await call("delete", { id: deletedTemplate.id });
  await call("save", { name: "周报", content: "用户新建的同名片段" });
  const deletedConflictPreview = await call("builtin-restore", { dryRun: true });
  check("被删除的内置模板遇到活跃同名片段时预演为冲突", deletedConflictPreview.value.plan.conflicts.some((item) => item.name === "周报") && deletedConflictPreview.value.plan.restored === 0);
  const deletedConflict = await call("builtin-restore", { expectedStoreHash: deletedConflictPreview.value.storeHash });
  check("确认时不复活造成重名的内置模板", deletedConflict.ok && deletedConflict.value.snippets.filter((snippet) => snippet.name === "周报" && !snippet.deletedAt).length === 1);

  const edited = await read();
  const editedTarget = edited.snippets.find((snippet) => snippet.id === target.id);
  editedTarget.content = "用户改写的内置模板";
  editedTarget.useCount = 17;
  await writeFile(FILE, JSON.stringify(edited), "utf8");
  const editedPreview = await call("builtin-restore", { dryRun: true });
  const editedRestore = await call("builtin-restore", { expectedStoreHash: editedPreview.value.storeHash });
  const afterEditedRestore = (await read()).snippets.find((snippet) => snippet.id === target.id);
  check("已识别但被改名改写的内置模板原样保留", editedRestore.ok && afterEditedRestore.name === editedTarget.name && afterEditedRestore.content === editedTarget.content && afterEditedRestore.useCount === 17);

  const legacy = await read();
  for (const snippet of legacy.snippets) delete snippet.builtinId;
  await writeFile(FILE, JSON.stringify(legacy), "utf8");
  const legacyPreview = await call("builtin-restore", { dryRun: true });
  check("仅精确匹配官方定义的旧模板可被识别", legacyPreview.value.plan.adopted === 6 && legacyPreview.value.plan.conflicts.length === 2);
  const legacyRestore = await call("builtin-restore", { expectedStoreHash: legacyPreview.value.storeHash });
  check("旧版已改写模板冲突不覆盖，其他精确匹配项可认领", legacyRestore.ok && legacyRestore.value.snippets.find((snippet) => snippet.id === target.id).builtinId === undefined && legacyRestore.value.snippets.filter((snippet) => snippet.builtinId).length === 6);

  const ambiguousLegacy = await read();
  const duplicateWeekly = { ...ambiguousLegacy.snippets.find((snippet) => snippet.name === "周报"), id: "custom-weekly", builtinId: undefined };
  ambiguousLegacy.snippets.push(duplicateWeekly);
  await writeFile(FILE, JSON.stringify(ambiguousLegacy), "utf8");
  const ambiguousPreview = await call("builtin-restore", { dryRun: true });
  check("重名旧记录即使正文吻合也不自动认领", ambiguousPreview.value.plan.conflicts.some((item) => item.name === "周报"));

  await reset({ version: 4, snippets: [{ id: "custom", name: "代码审查", content: "用户自建内容", variables: {}, deletedAt: null }] });
  const customPreview = await call("builtin-restore", { dryRun: true });
  check("同名自建片段列为冲突并跳过", customPreview.value.plan.conflicts.some((item) => item.name === "代码审查"));
  const customRestore = await call("builtin-restore", { expectedStoreHash: customPreview.value.storeHash });
  const customStore = await read();
  check("恢复不覆盖同名自建片段并补齐其他模板", customRestore.ok && customStore.snippets.find((snippet) => snippet.id === "custom").content === "用户自建内容" && customStore.snippets.length === 8);

  const stalePreview = await call("builtin-restore", { dryRun: true });
  await call("save", { name: "预演后新增", content: "变化" });
  const staleConfirm = await call("builtin-restore", { expectedStoreHash: stalePreview.value.storeHash });
  check("预演后片段库变化会阻止恢复", staleConfirm.ok === false && staleConfirm.error.code === "conflict");
  const missingFingerprint = await call("builtin-restore", {});
  check("确认请求缺少预演指纹时拒绝写入", missingFingerprint.ok === false && missingFingerprint.error.code === "bad-request");

  await reset({ version: 99, snippets: [] });
  const readonlyPreview = await call("builtin-restore", { dryRun: true });
  const readonlyConfirm = await call("builtin-restore", { expectedStoreHash: readonlyPreview.value.storeHash });
  check("只读库可预演但确认恢复被拒绝", readonlyPreview.ok && readonlyPreview.value.readOnly === true && readonlyConfirm.ok === false && readonlyConfirm.error.code === "read-only");

  await reset(null);
  await call("list", {});
  const collidingDeletedBuiltins = await read();
  const renamedBuiltin = collidingDeletedBuiltins.snippets.find((snippet) => snippet.builtinId === "dsh.prompt-snippets.code-review");
  const deletedWeeklyBuiltin = collidingDeletedBuiltins.snippets.find((snippet) => snippet.builtinId === "dsh.prompt-snippets.weekly-report");
  renamedBuiltin.name = "周报";
  renamedBuiltin.deletedAt = Date.now();
  deletedWeeklyBuiltin.deletedAt = Date.now();
  await writeFile(FILE, JSON.stringify(collidingDeletedBuiltins), "utf8");
  const collidingPreview = await call("builtin-restore", { dryRun: true });
  check("同批次内置恢复按顺序拦截改名导致的名称冲突", collidingPreview.value.plan.restored === 1 && collidingPreview.value.plan.conflicts.some((item) => item.name === "周报"));
  const collidingRestore = await call("builtin-restore", { expectedStoreHash: collidingPreview.value.storeHash });
  check("同批次恢复确认后活跃名称仍唯一", collidingRestore.ok && collidingRestore.value.snippets.filter((snippet) => snippet.name === "周报" && !snippet.deletedAt).length === 1);
}

// ══════════════ 13. 保留分类语义 ══════════════
setGroup("13. 保留分类语义");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "保类", content: "c1", category: "原类" });
  await call("save", { name: "保类", content: "c2" });
  const keep = (await call("list", {})).value.snippets.find((s) => s.name === "保类");
  check("不带 category 字段时保留原分类", keep.category === "原类" && keep.content === "c2", `${keep.category}/${keep.content}`);

  await call("save", { name: "保类", content: "c3", category: "" });
  const cleared = (await call("list", {})).value.snippets.find((s) => s.name === "保类");
  check("显式空 category 清空分类", cleared.category === null, String(cleared.category));
}

// ══════════════ 14. v1.3 标签 / 收藏 / 版本历史 ══════════════
setGroup("14. v1.3 标签 / 收藏 / 版本历史");
await reset({ version: 4, snippets: [] });
{
  // 新建带 tags + pinned
  const created = await call("save", { name: "带标签", content: "内容", tags: ["代码", " 代码 ", "审查"], pinned: true });
  const s0 = created.value.snippet;
  check("新建带标签去重并 trim", JSON.stringify(s0.tags) === JSON.stringify(["代码", "审查"]), JSON.stringify(s0.tags));
  check("新建收藏置顶", s0.pinned === true && typeof s0.pinnedAt === "number", String(s0.pinnedAt));

  // 不带 tags/pinned 字段 → 保留（keep 语义）
  await call("save", { name: "带标签", content: "内容2", expectedRevision: s0.revision });
  let cur = (await call("list", {})).value.snippets.find((s) => s.name === "带标签");
  check("更新不带 tags 保留原标签", JSON.stringify(cur.tags) === JSON.stringify(["代码", "审查"]), JSON.stringify(cur.tags));
  check("更新不带 pinned 保留收藏", cur.pinned === true);

  // 显式清空 tags / 取消收藏
  await call("save", { name: "带标签", content: "内容3", tags: [], pinned: false, expectedRevision: cur.revision });
  cur = (await call("list", {})).value.snippets.find((s) => s.name === "带标签");
  check("显式空 tags 清空", JSON.stringify(cur.tags) === JSON.stringify([]), JSON.stringify(cur.tags));
  check("显式 pinned=false 取消收藏", cur.pinned === false && cur.pinnedAt === null, String(cur.pinnedAt));

  // 版本历史：每次更新都留档上一版
  const hist = await call("history", { id: cur.id });
  check("history 返回数组", Array.isArray(hist.value.history), String(hist.value.history?.length));
  check("历史按版本保留（≥2 版）", hist.value.history.length >= 2, String(hist.value.history.length));
  check("历史含被覆盖的内容", hist.value.history.some((v) => v.content === "内容2"), JSON.stringify(hist.value.history.map((v) => v.content)));
  check("历史记录带 revision", hist.value.history.every((v) => typeof v.revision === "number"));
  const historyFiles = await readdir(join(TEST_HOME, "data", "prompt-snippets", "history"));
  check("原子历史写入没有遗留临时文件", historyFiles.includes(`${cur.id}.json`) && historyFiles.every((file) => !file.endsWith(".tmp")), historyFiles.join(","));

  // history 端点缺 id 报错
  const noId = await call("history", {});
  check("history 缺 id 报 bad-request", noId.ok === false && noId.error.code === "bad-request");

  // 命令：pin / unpin / tag
  await call("save", { name: "命令测试", content: "x" });
  const pinR = await cmd("pin 命令测试");
  check("命令 pin 成功", pinR.kind === "success" && pinR.text.includes("已收藏"), pinR.text);
  const unpinR = await cmd("unpin 命令测试");
  check("命令 unpin 成功", unpinR.kind === "success" && unpinR.text.includes("取消收藏"), unpinR.text);
  const tagR = await cmd("tag 命令测试 甲、乙 丙");
  check("命令 tag 成功", tagR.kind === "success" && tagR.text.includes("甲"), tagR.text);
  const tagged = (await call("list", {})).value.snippets.find((s) => s.name === "命令测试");
  check("tag 命令落盘（顿号/空格分隔）", JSON.stringify(tagged.tags) === JSON.stringify(["甲", "乙", "丙"]), JSON.stringify(tagged.tags));

  // list 命令输出含 ★ 与标签
  await call("save", { name: "置顶项", content: "y", pinned: true, tags: ["重要"] });
  const listText = (await cmd("list")).text;
  check("list 输出收藏标记", listText.includes("★置顶项"), listText.split("\n").find((l) => l.includes("置顶项")));
  check("list 输出标签", listText.includes("(重要)"));
}

// ══════════════ 输出 ══════════════
console.log(results.join("\n"));
const fails = results.filter((x) => x.startsWith("FAIL"));
const passes = results.filter((x) => x.startsWith("PASS"));
console.log(`\n${passes.length}/${passes.length + fails.length} passed`);
if (fails.length) {
  console.log("\n失败明细：\n" + fails.join("\n"));
  process.exitCode = 1;
}
