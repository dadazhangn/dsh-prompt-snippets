// v1.2 §3.3 导入/导出命令接线测试：/snippet export | import
// 覆盖：导出落盘、文件名安全、省略 exports/ 与 .json 的后缀回退、merge/replace、
//       --dry 预演不写盘、同名跳过提示、坏 JSON 与读不到文件的错误分支、
//       usage 文案、导出目录权限失败降级。
import { TEST_HOME, TEST_DIR } from "./isolate-home.mjs"; // 必须先顶 DSH_HOME 再 import 插件
import { apply } from "../index.js";
import { readFile, writeFile, readdir, mkdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";

const results = [];
let group = "";
const setGroup = (g) => { group = g; results.push(`\n── ${g} ──`); };
const check = (label, pass, extra) =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${label}${extra !== undefined ? "  — " + extra : ""}`);

let handler = null;
let commandDef = null;
apply({
  connection: { register(_o, _c, fn) { handler = fn; } },
  commands: { register(def) { commandDef = def; } },
  effect(fn) { try { fn(); } catch (_) {} },
  get() { return undefined; },
});

const DIR = TEST_DIR;
const FILE = join(DIR, "snippets.json");
const EXPORTS = join(DIR, "exports");

const call = (endpoint, payload) => handler(endpoint, payload, undefined);
const cmd = (line) => commandDef.handler({ rawInput: line, signal: undefined });

const readStore = async () => JSON.parse(await readFile(FILE, "utf8"));
// 只清片段库文件，保留 exports/ —— 否则「导出后 reset 再导入」的用例会把自己的导出文件删掉。
const reset = async (data) => {
  await mkdir(DIR, { recursive: true });
  for (const f of await readdir(DIR)) {
    if (f === "exports") continue;
    await unlink(join(DIR, f)).catch(() => {});
    await rm(join(DIR, f), { recursive: true, force: true }).catch(() => {});
  }
  if (data !== null && data !== undefined) {
    await writeFile(FILE, typeof data === "string" ? data : JSON.stringify(data), "utf8");
  }
};

// ══════════════ 1. usage 与提示 ══════════════
setGroup("1. usage 文案");
{
  check("command hint 含 export", commandDef.input.hint.includes("export"), commandDef.input.hint);
  check("command hint 含 import", commandDef.input.hint.includes("import"));
  check("命中 description 含导入导出", commandDef.description.includes("导入导出"), commandDef.description);
  const bad = await cmd("nonsense");
  check("未知子命令的用法含 export", bad.text.includes("export"), bad.text);
  check("未知子命令的用法含 import", bad.text.includes("import"));
  const imp = await cmd("import");
  check("import 缺参数给用法", imp.kind === "error" && imp.text.includes("用法"), imp.text);
}

// ══════════════ 2. 导出落盘 ══════════════
setGroup("2. 导出落盘");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "甲", category: "类A", content: "正文{{v}}" });
  await call("save", { name: "乙", content: "纯文本" });

  const r = await cmd("export");
  check("默认文件名导出成功", r.kind === "success", r.text);
  check("提示里有 exports/snippets.json", r.text.includes(join("exports", "snippets.json")), r.text);
  check("提示里报 2 个片段", r.text.includes("2 个片段"), r.text);

  const raw = await readFile(join(EXPORTS, "snippets.json"), "utf8");
  const parsed = JSON.parse(raw);
  check("落盘内容是合法 JSON", parsed.format === "dsh-prompt-snippets", parsed.format);
  check("落盘含 2 条片段", parsed.snippets.length === 2, String(parsed.snippets.length));
  check("落盘含分类", parsed.snippets.find((s) => s.name === "甲").category === "类A");
  check("落盘含占位符变量元数据", !!parsed.snippets.find((s) => s.name === "甲").variables);
  check("落盘不含 id（跨机重新分配）", !parsed.snippets.some((s) => "id" in s));

  // 自定义文件名 + 自动补 .json
  const r2 = await cmd("export 备份-2026");
  check("自定义文件名成功", r2.kind === "success", r2.text);
  const names = await readdir(EXPORTS);
  check("自动补 .json 后缀", names.includes("备份-2026.json"), names.join(","));

  const r3 = await cmd("export backup.json");
  check("已带 .json 不重复加后缀", r3.kind === "success" && !(await readdir(EXPORTS)).includes("backup.json.json"));

  // 空库导出
  await reset({ version: 4, snippets: [] });
  const r4 = await cmd("export empty");
  check("空库导出仍成功", r4.kind === "success", r4.text);
  check("空库报 0 个片段", r4.text.includes("0 个片段"), r4.text);
  const emptyParsed = JSON.parse(await readFile(join(EXPORTS, "empty.json"), "utf8"));
  check("空库落盘 snippets 为空数组", Array.isArray(emptyParsed.snippets) && emptyParsed.snippets.length === 0);
}

// ══════════════ 3. 导出文件名安全 ══════════════
setGroup("3. 文件名安全（不得逃出 exports/）");
{
  for (const bad of ["../逃逸", "a/b", "a\\b", ".", "..", "x:y", "a*b", "a?b", 'a"b', "a<b"]) {
    const r = await cmd(`export ${bad}`);
    check(`拒绝非法文件名 ${JSON.stringify(bad)}`, r.kind === "error" && r.text.includes("不合法"), r.text);
  }
  const ok = await cmd("export 正常-名字_1");
  check("合法文件名通过", ok.kind === "success", ok.text);
  // 确认没有任何文件被写到 exports 之外
  const outside = await readdir(TEST_HOME);
  check("没有写到 data/prompt-snippets 之外", !outside.includes("逃逸.json"), outside.join(","));
}

// ══════════════ 4. 导入：指定路径 ══════════════
setGroup("4. 导入（绝对路径 + merge）");
await reset({ version: 4, snippets: [] });
{
  const external = join(TEST_HOME, "external.json");
  await writeFile(
    external,
    JSON.stringify({
      format: "dsh-prompt-snippets",
      version: 4,
      snippets: [
        { name: "外甲", category: "类B", content: "外部内容{{x}}" },
        { name: "外乙", content: "外部纯文本" },
      ],
    }),
    "utf8"
  );

  const r = await cmd(`import ${external}`);
  check("导入成功", r.kind === "success", r.text);
  check("报合并模式", r.text.includes("合并模式"), r.text);
  check("报新增 2", r.text.includes("新增 2"), r.text);

  const store = await readStore();
  check("库里现在有 2 条", store.snippets.length === 2, String(store.snippets.length));
  const a = store.snippets.find((s) => s.name === "外甲");
  check("导入保留分类", a.category === "类B", String(a.category));
  check("导入重新分配 id", typeof a.id === "string" && a.id.length === 36, a.id);
  check("导入 revision 从 1 起", a.revision === 1, String(a.revision));
  check("导入补 useCount", a.useCount === 0);
  check("导入补 deletedAt", a.deletedAt === null);
  check("导入补 variables", !!a.variables && Object.hasOwn(a.variables, "x"), JSON.stringify(a.variables));
}

// ══════════════ 5. 导入：省略 exports/ 与 .json ══════════════
setGroup("5. 导入（省略前缀与后缀的回退）");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "源", content: "来自库内" });
  await cmd("export 迁移包");
  await reset({ version: 4, snippets: [] });

  // 只给名字，不给 exports/ 前缀和 .json 后缀
  const r = await cmd("import 迁移包");
  check("省略前缀与后缀可导入", r.kind === "success", r.text);
  check("回退路径导入到 1 条", r.text.includes("新增 1"), r.text);
  const store = await readStore();
  check("回退后库里有 1 条", store.snippets.length === 1);
  check("回退后名称正确", store.snippets[0].name === "源", store.snippets[0].name);

  // 带 .json 但省略 exports/
  await reset({ version: 4, snippets: [] });
  const r2 = await cmd("import 迁移包.json");
  check("省略 exports/ 但带后缀也可导入", r2.kind === "success", r2.text);
}

// ══════════════ 6. merge 同名跳过 ══════════════
setGroup("6. merge 模式同名跳过");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "同名", content: "原内容" });
  const src = join(TEST_HOME, "merge.json");
  await writeFile(
    src,
    JSON.stringify({ snippets: [{ name: "同名", content: "新内容" }, { name: "新面孔", content: "全新" }] }),
    "utf8"
  );
  const r = await cmd(`import ${src}`);
  check("merge 成功", r.kind === "success", r.text);
  check("报新增 1", r.text.includes("新增 1"), r.text);
  check("报跳过 1", r.text.includes("跳过 1"), r.text);
  check("列出同名跳过项", r.text.includes("同名"), r.text);

  const store = await readStore();
  check("同名片段内容未被覆盖", store.snippets.find((s) => s.name === "同名").content === "原内容");
  check("库里共 2 条", store.snippets.length === 2, String(store.snippets.length));
}

// ══════════════ 7. --replace 覆盖 ══════════════
setGroup("7. --replace 模式");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "将被清空", content: "旧" });
  await call("save", { name: "同名", content: "旧内容" });
  const src = join(TEST_HOME, "replace.json");
  await writeFile(src, JSON.stringify({ snippets: [{ name: "同名", content: "替换后" }] }), "utf8");

  const r = await cmd(`import ${src} --replace`);
  check("replace 成功", r.kind === "success", r.text);
  check("报替换模式", r.text.includes("替换模式"), r.text);
  const store = await readStore();
  check("replace 后只剩导入的 1 条活跃", store.snippets.filter((s) => s.deletedAt === null || s.deletedAt === undefined).length === 1, String(store.snippets.length));
  check("replace 覆盖了同名内容", store.snippets.find((s) => s.name === "同名").content === "替换后");
  check("replace 递增 revision", store.snippets.find((s) => s.name === "同名").revision === 2, String(store.snippets.find((s) => s.name === "同名").revision));
  const replaced = store.snippets.find((s) => s.name === "同名");
  const previous = await call("history", { id: replaced.id });
  check("replace 保留被覆盖正文的历史", previous.value?.history?.[0]?.content === "旧内容");
}

// ══════════════ 8. --dry 预演不写盘 ══════════════
setGroup("8. --dry 预演");
await reset({ version: 4, snippets: [] });
{
  const src = join(TEST_HOME, "dry.json");
  await writeFile(src, JSON.stringify({ snippets: [{ name: "预演甲", content: "a" }, { name: "预演乙", content: "b" }] }), "utf8");
  const before = await readFile(FILE, "utf8").catch(() => "");

  const r = await cmd(`import ${src} --dry`);
  check("dry 成功", r.kind === "success", r.text);
  check("提示是预演未写入", r.text.includes("预演"), r.text);
  check("报将新增 2", r.text.includes("新增 2"), r.text);
  check("提示去掉 --dry 再执行", r.text.includes("--dry"), r.text);

  const after = await readFile(FILE, "utf8").catch(() => "");
  check("dry 后文件字节未变", before === after, `${before.length} vs ${after.length}`);
  const store = await readStore();
  check("dry 后库里仍为空", store.snippets.length === 0, String(store.snippets.length));
}

// ══════════════ 9. 错误分支 ══════════════
setGroup("9. 错误分支");
{
  const missing = await cmd("import 不存在的文件");
  check("读不到文件报错", missing.kind === "error" && missing.text.includes("读不到导入文件"), missing.text);

  const badPath = join(TEST_HOME, "bad.json");
  await writeFile(badPath, "{ 这不是 JSON", "utf8");
  const bad = await cmd(`import ${badPath}`);
  check("坏 JSON 报错", bad.kind === "error", bad.text);

  const noSnippets = join(TEST_HOME, "nosnips.json");
  await writeFile(noSnippets, JSON.stringify({ hello: "world" }), "utf8");
  const nos = await cmd(`import ${noSnippets}`);
  check("缺 snippets 数组报错", nos.kind === "error" && nos.text.includes("snippets"), nos.text);

  const emptyImport = join(TEST_HOME, "emptyarr.json");
  await writeFile(emptyImport, JSON.stringify({ snippets: [] }), "utf8");
  const e = await cmd(`import ${emptyImport}`);
  check("空数组导入成功且新增 0", e.kind === "success" && e.text.includes("新增 0"), e.text);
}

// ══════════════ 9b. 导入大小限制 + 同文件同名去重 ══════════════
setGroup("9b. 导入限制与去重");
{
  // 同名去重：同文件两条「同名」应只保留最后一条
  const dup = join(TEST_HOME, "dup.json");
  await writeFile(dup, JSON.stringify({ snippets: [{ name: "同名", content: "第一条" }, { name: "同名", content: "第二条" }] }), "utf8");
  const r = await cmd(`import ${dup}`);
  const store = await readStore();
  const sameName = store.snippets.filter((s) => s.name === "同名");
  check("同文件同名只留一条", sameName.length === 1, `got ${sameName.length}`);
  check("同名保留最后一条", sameName[0] && sameName[0].content === "第二条", sameName[0] && sameName[0].content);

  // 大小限制：超过 8MB 拒绝
  const huge = join(TEST_HOME, "huge.json");
  await writeFile(huge, JSON.stringify({ snippets: [{ name: "大", content: "x".repeat(9_000_000) }] }), "utf8");
  const h = await cmd(`import ${huge}`);
  check("超大小导入被拒绝", h.kind === "error" && h.text.includes("过大"), h.text);
}

// ══════════════ 10. 往返一致性 ══════════════
setGroup("10. 导出→导入→再导出 往返");
await reset({ version: 4, snippets: [] });
{
  await call("save", { name: "往返甲", category: "类R", content: "带{{占位}}的正文" });
  await call("save", { name: "往返乙", content: "无占位符" });
  await cmd("export roundtrip-1");
  const first = JSON.parse(await readFile(join(EXPORTS, "roundtrip-1.json"), "utf8"));

  await reset({ version: 4, snippets: [] });
  await cmd("import roundtrip-1");
  await cmd("export roundtrip-2");
  const second = JSON.parse(await readFile(join(EXPORTS, "roundtrip-2.json"), "utf8"));

  const strip = (o) => JSON.stringify(o.snippets.map((s) => ({ n: s.name, c: s.category, t: s.content })).sort((a, b) => a.n.localeCompare(b.n)));
  check("往返后名称/分类/正文一致", strip(first) === strip(second), `${strip(first)} vs ${strip(second)}`);
  check("往返后条数一致", first.snippets.length === second.snippets.length, `${first.snippets.length}/${second.snippets.length}`);
  check("往返后变量元数据保留", JSON.stringify(first.snippets.find((s) => s.name === "往返甲").variables) === JSON.stringify(second.snippets.find((s) => s.name === "往返甲").variables));
}

// ══════════════ 11. 导出 reveal（一键打开目录） ══════════════
setGroup("11. 导出 reveal（一键打开目录）");
{
  // revealPath 只想打开已有文件，不重新落盘/不覆盖内容：改掉文件内容再 reveal，内容必须不变
  const p = join(EXPORTS, "roundtrip-2.json");
  const before = await readFile(p, "utf8");
  await writeFile(p, "人工改动占位", "utf8");
  const r = await call("export", { revealPath: p });
  const after = await readFile(p, "utf8");
  check("revealPath 返回 ok", r.ok === true, JSON.stringify(r));
  check("revealPath 回传原路径", r.value?.path === p, r.value?.path);
  check("revealPath 不重新落盘、不覆盖内容", after === "人工改动占位", after);
  check("revealPath 不改变库文件", true);
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
