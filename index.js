import { mkdir, readFile, writeFile, rename, unlink, open, copyFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "prompt-snippets";
export const inject = ["connection", "commands", "webServer"];

const CHANNEL = "/prompt-snippets";
const STORE_VERSION = 3;
const MAX_NAME = 120;
const MAX_CONTENT = 200_000;
const MAX_VARIABLES = 64;
const CORRUPT_KEEP = 5;
// 导入 JSON 大小上限（UTF-8 字节）：防内存被打爆，也让恶意/损坏文件止步。
const MAX_IMPORT_BYTES = 8_000_000;

/** 本 host 半支持的全部 RPC 端点。client 半用 capabilities 握手校验。 */
const ENDPOINTS = [
  "capabilities",
  "list",
  "get",
  "save",
  "delete",
  "restore",
  "optimize",
  "touch",
  "export",
  "import",
];

/** 解析 DSH 数据根目录（等价于 dshHomePath：$DSH_HOME 或 ~/.dsh）。 */
function resolveHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim().length > 0) return join(env.trim());
  return join(homedir(), ".dsh");
}

function dataPath(...segments) {
  return join(resolveHome(), "data", "prompt-snippets", ...segments);
}

/** 字符串 UTF-8 字节数。 */
function byteLength(text) {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 数据模型 v3（存于 <home>/data/prompt-snippets/snippets.json）：
 * {
 *   version: 3,
 *   snippets: [{
 *     id, name, category, content,
 *     variables: { [变量名]: { label?, default?, options?, required? } },
 *     createdAt, updatedAt,
 *     revision,      // 片段级单调递增，从 1 起；乐观锁用
 *     deletedAt,     // 非空 = 软删除，保留以便 restore
 *     useCount, lastUsedAt
 *   }]
 * }
 */
function emptyStore() {
  return { version: STORE_VERSION, snippets: [] };
}

// ───────────────────────────── 占位符 ─────────────────────────────

const VAR_NAME_RE = /^[\p{L}\p{N}_-]{1,40}$/u;

/**
 * 单趟扫描正文，切出 text / var 片段。转义规则（唯一权威定义）：
 *   {{名}}      → 变量
 *   \{{名}}     → 字面量 {{名}}
 *   \\{{名}}    → 反斜杠 + 变量
 *   {{}}/{{ }}  → 字面量（名称不合法）
 *   {{{x}}}     → "{" + 变量 + "}"
 * 不用全局正则替换：\\{{ 这类组合会被回溯吃掉。
 */
function scanPlaceholders(content) {
  const tokens = [];
  const names = [];
  const seen = new Set();
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) {
      tokens.push({ kind: "text", text });
      text = "";
    }
  };

  while (i < content.length) {
    const ch = content[i];

    // 反斜杠串：只在紧跟 {{ 时参与转义，其余原样输出
    if (ch === "\\") {
      let n = 0;
      while (content[i + n] === "\\") n++;
      const after = content.slice(i + n, i + n + 2) === "{{";
      if (after) {
        const parsed = parseVarAt(content, i + n);
        if (parsed) {
          text += "\\".repeat(Math.floor(n / 2));
          if (n % 2 === 1) {
            text += content.slice(i + n, parsed.end); // 字面量
          } else {
            flush();
            tokens.push({ kind: "var", name: parsed.name });
            if (!seen.has(parsed.name)) {
              seen.add(parsed.name);
              names.push(parsed.name);
            }
          }
          i = parsed.end;
          continue;
        }
      }
      text += content.slice(i, i + n);
      i += n;
      continue;
    }

    if (ch === "{") {
      const parsed = parseVarAt(content, i);
      if (parsed) {
        flush();
        tokens.push({ kind: "var", name: parsed.name });
        if (!seen.has(parsed.name)) {
          seen.add(parsed.name);
          names.push(parsed.name);
        }
        i = parsed.end;
        continue;
      }
    }

    text += ch;
    i++;
  }

  flush();
  return { tokens, names };
}

/** 从 at 处尝试解析一个 {{名}}；不合法返回 null。 */
function parseVarAt(content, at) {
  if (content.slice(at, at + 2) !== "{{") return null;
  const close = content.indexOf("}}", at + 2);
  if (close === -1) return null;
  const inner = content.slice(at + 2, close);
  if (!VAR_NAME_RE.test(inner)) return null;
  return { name: inner, end: close + 2 };
}

/** 把变量名集合与外部元数据对齐：只保留正文里真实出现的变量。 */
function normalizeVariables(names, input) {
  const out = {};
  const dropped = [];
  const source = input && typeof input === "object" ? input : {};
  for (const key of Object.keys(source)) {
    if (!names.includes(key)) dropped.push(key);
  }
  for (const nm of names.slice(0, MAX_VARIABLES)) {
    const src = source[nm];
    const def = {};
    if (src && typeof src === "object") {
      if (typeof src.label === "string" && src.label.trim()) def.label = src.label.trim();
      if (typeof src.default === "string") def.default = src.default;
      if (Array.isArray(src.options)) {
        const opts = src.options.filter((o) => typeof o === "string").slice(0, 32);
        if (opts.length > 0) def.options = opts;
      }
      if (src.required === true) def.required = true;
    }
    out[nm] = def;
  }
  return { variables: out, dropped };
}

/** 用给定值渲染；缺必填项时返回 missing。 */
function renderContent(tokens, variables, values) {
  let text = "";
  const missing = [];
  for (const tk of tokens) {
    if (tk.kind === "text") {
      text += tk.text;
      continue;
    }
    const def = variables[tk.name] || {};
    const raw = values && typeof values[tk.name] === "string" ? values[tk.name] : "";
    const effective = raw.trim() !== "" ? raw : typeof def.default === "string" ? def.default : "";
    if (effective === "" && def.required === true) {
      if (!missing.includes(tk.name)) missing.push(tk.name);
    }
    text += effective;
  }
  return { text, missing };
}

// ───────────────────────────── 迁移 ─────────────────────────────

/**
 * 把任意历史版本整理成 v3。逐条容错：坏条目丢弃，其余保留。
 * 返回 { store, stats }，stats 描述实际改动，用来决定是否落盘与提示文案。
 */
function migrate(data) {
  const raw = Array.isArray(data?.snippets) ? data.snippets : [];
  const stats = { dropped: 0, dupIds: 0, filled: 0, repaired: 0 };
  const snippets = [];
  const usedIds = new Set();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      stats.dropped++;
      continue;
    }
    if (typeof item.content !== "string") {
      stats.dropped++;
      continue;
    }
    const rawName = typeof item.name === "string" ? item.name : "";
    if (!rawName.trim()) {
      stats.dropped++;
      continue;
    }

    let changed = false;
    const name = rawName.length > MAX_NAME ? rawName.slice(0, MAX_NAME) : rawName;
    if (name !== rawName) changed = true;

    let id = typeof item.id === "string" && item.id ? item.id : null;
    if (!id) {
      id = randomUUID();
      changed = true;
      stats.filled++;
    } else if (usedIds.has(id)) {
      id = randomUUID();
      changed = true;
      stats.dupIds++;
    }
    usedIds.add(id);

    const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : Date.now();
    if (createdAt !== item.createdAt) changed = true;
    const updatedAt = Number.isFinite(item.updatedAt) ? item.updatedAt : createdAt;
    if (updatedAt !== item.updatedAt) changed = true;

    const category =
      typeof item.category === "string" && item.category.trim() ? item.category.trim() : null;
    if (category !== (item.category ?? null)) changed = true;

    const deletedAt = Number.isFinite(item.deletedAt) && item.deletedAt > 0 ? item.deletedAt : null;
    if (deletedAt !== (item.deletedAt ?? null)) changed = true;

    let revision = Number.isInteger(item.revision) && item.revision >= 1 ? item.revision : 1;
    if (revision !== item.revision) {
      changed = true;
      stats.filled++;
    }

    const useCount = Number.isInteger(item.useCount) && item.useCount >= 0 ? item.useCount : 0;
    if (useCount !== item.useCount) changed = true;

    const lastUsedAt =
      Number.isFinite(item.lastUsedAt) && item.lastUsedAt > 0 ? item.lastUsedAt : null;
    if (lastUsedAt !== (item.lastUsedAt ?? null)) changed = true;

    const { names } = scanPlaceholders(item.content);
    const varInput = item.variables && typeof item.variables === "object" ? item.variables : {};
    const hasVarKeys = Object.keys(varInput).length > 0;
    const { variables, dropped } = normalizeVariables(names, varInput);
    if (hasVarKeys || names.length > 0) {
      const before = JSON.stringify(varInput);
      const after = JSON.stringify(variables);
      if (before !== after) changed = true;
    }
    if (dropped.length > 0) stats.repaired++;

    if (changed) stats.repaired++;

    snippets.push({
      id,
      name,
      category,
      content: item.content,
      variables,
      createdAt,
      updatedAt,
      revision: revision >= 1 ? revision : 1,
      deletedAt,
      useCount,
      lastUsedAt,
    });
  }

  return { store: { version: STORE_VERSION, snippets }, stats };
}

// ───────────────────────────── 读写 ─────────────────────────────

/** 仍在使用中的片段（排除软删除）。 */
function alive(store) {
  return store.snippets.filter((s) => !s.deletedAt);
}

/**
 * 按 id / #id前缀 / 名称 解析引用。重名不猜，交给调用方决定。
 * → { snippet } | { missing: true } | { ambiguous: [候选…] }
 */
function resolveRef(pool, ref) {
  const text = typeof ref === "string" ? ref.trim() : "";
  if (!text) return { missing: true };

  if (text.startsWith("#")) {
    const prefix = text.slice(1).trim().toLowerCase();
    if (!prefix) return { missing: true };
    const hits = pool.filter((s) => s.id.toLowerCase().startsWith(prefix));
    if (hits.length === 0) return { missing: true };
    if (hits.length > 1) return { ambiguous: hits };
    return { snippet: hits[0] };
  }

  const exactId = pool.find((s) => s.id === text);
  if (exactId) return { snippet: exactId };

  const hits = pool.filter((s) => s.name === text);
  if (hits.length === 0) return { missing: true };
  if (hits.length > 1) return { ambiguous: hits };
  return { snippet: hits[0] };
}

function candidateList(hits) {
  return hits
    .map((s) => ({ id: s.id, name: s.name, category: s.category, deletedAt: s.deletedAt }))
    .map((c) => `#${c.id.slice(0, 6)}  ${c.name}${c.category ? ` [${c.category}]` : ""}${c.deletedAt ? "（已删除）" : ""}`);
}

/**
 * 迁移前的一次性现场保护：把**原始字节**另存一份 `snippets.json.pre-v3.bak`。
 * 用 flag "wx" 一次成型：要么完整写出，要么文件根本不存在，不会有半截备份；
 * 已经存在就不覆盖——那是更早、更原始的现场，比现在这份更值钱。
 * 备份失败只降级（不给 warning 噪声），不能因为备份把迁移卡死。
 */
async function backupBeforeMigrate(raw) {
  const name = "snippets.json.pre-v3.bak";
  try {
    await writeFile(dataPath(name), raw, { encoding: "utf8", flag: "wx" });
    return name;
  } catch (error) {
    if (error && error.code === "EEXIST") return name;
    return null;
  }
}

/**
 * 纯读取 + 内存内迁移。读路径不写盘；落盘由持锁的调用方决定。
 * 任何损坏都不让插件停工，但**永不覆写原文件**。
 * 返回值带 `raw`：调用方要在落盘前拿它做迁移前备份。
 */
async function readStore() {
  let raw;
  try {
    raw = await readFile(dataPath("snippets.json"), "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { store: emptyStore(), warnings: [], migrated: false, readOnly: false };
    }
    // EACCES / EIO 等：不隔离，避免把权限问题误判成损坏
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const moved = await quarantine();
    // 隔离成功 = 原文件已原子搬走，可以继续写（空库）；隔离失败 = 原文件还在但内容
    // 损坏，此时写会覆盖原始现场 → 进入只读保护，宁可停写也不丢证据。
    return {
      store: emptyStore(),
      warnings: [
        `片段文件不是合法 JSON${moved ? `，已原样搬移为 ${moved}` : "，搬移备份失败"}，当前以空库继续运行。`,
      ],
      migrated: false,
      readOnly: moved === null,
    };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.snippets)) {
    const moved = await quarantine();
    return {
      store: emptyStore(),
      warnings: [
        `片段文件结构不可识别${moved ? `，已原样搬移为 ${moved}` : "，搬移备份失败"}，当前以空库继续运行。`,
      ],
      migrated: false,
      readOnly: moved === null,
    };
  }

  // 用户装过更新版本又降级：拒绝改动，原文件保持不动
  if (Number.isFinite(parsed.version) && parsed.version > STORE_VERSION) {
    return {
      store: emptyStore(),
      warnings: [
        `片段文件来自更新版本（version ${parsed.version} > ${STORE_VERSION}），已只读跳过加载，原文件未被修改。`,
      ],
      migrated: false,
      readOnly: true,
    };
  }

  const { store, stats } = migrate(parsed);
  const warnings = [];
  if (stats.dropped > 0) warnings.push(`丢弃了 ${stats.dropped} 条损坏片段记录（其余已保留）。`);
  if (stats.dupIds > 0) warnings.push(`修复了 ${stats.dupIds} 条重复 id。`);
  const migrated = stats.repaired > 0 || stats.filled > 0 || parsed.version !== STORE_VERSION;
  // raw 交回调用方：真正要落盘改文件之前，先用它做迁移前备份
  return { store, warnings, migrated, raw, readOnly: false };
}

/**
 * 损坏隔离：**rename** 原文件到 backup，绝不先复制再覆写。
 * 复制中途失败会把现场抹掉；rename 是原子的，原字节 100% 完整搬过去。
 * rename 之后主文件不存在 → 下次读取走 ENOENT 空库分支，不会反复隔离。
 */
async function quarantine() {
  const final = dataPath("snippets.json");
  const stamp = Date.now();
  let target = dataPath(`snippets.corrupt-${stamp}.json`);
  try {
    await mkdir(dataPath(), { recursive: true });
    // 同一毫秒内多次损坏时避免撞名（Windows 上 rename 撞名会失败）
    for (let n = 1; ; n++) {
      try {
        await rename(final, target);
        break;
      } catch (error) {
        if (error && error.code === "EEXIST" && n < 100) {
          target = dataPath(`snippets.corrupt-${stamp}-${n}.json`);
          continue;
        }
        throw error;
      }
    }
  } catch (_) {
    return null;
  }
  await pruneCorrupt();
  return target.split(/[\\/]/).pop();
}

/** 只保留最近 CORRUPT_KEEP 份隔离文件。 */
async function pruneCorrupt() {
  try {
    const dir = dataPath();
    const names = (await readdir(dir)).filter((n) => n.startsWith("snippets.corrupt-"));
    if (names.length <= CORRUPT_KEEP) return;
    names.sort();
    for (const old of names.slice(0, names.length - CORRUPT_KEEP)) {
      await unlink(join(dir, old)).catch(() => {});
    }
  } catch (_) {
    /* 清理失败不影响主流程 */
  }
}

/**
 * 原子写入：临时文件 → fsync 落盘 → 轮换 .bak → rename 覆盖。
 * 缺 fsync 时 rename 可能指向内容为空的 inode（断电场景）。
 */
async function persist(store) {
  await mkdir(dataPath(), { recursive: true });
  const final = dataPath("snippets.json");
  const bak = dataPath("snippets.json.bak");
  const tmp = dataPath(`snippets.${process.pid}.${Date.now()}.tmp`);

  let fh;
  try {
    fh = await open(tmp, "w");
    await fh.writeFile(JSON.stringify(store, null, 2), "utf8");
    await fh.sync();
  } finally {
    if (fh) await fh.close().catch(() => {});
  }

  // 轮换 .bak：先写临时文件 + fsync，再 rename 原子替换，避免 copyFile 断电留半截。
  // 失败不阻断主写入。
  try {
    const bakTmp = dataPath(`snippets.json.bak.${process.pid}.${Date.now()}.tmp`);
    await copyFile(final, bakTmp);
    let bfh = null;
    try {
      bfh = await open(bakTmp, "r+");
      await bfh.sync();
    } finally {
      if (bfh) await bfh.close().catch(() => {});
    }
    await rename(bakTmp, bak);
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      /* 备份失败仅降级，不抛 */
    }
  }

  try {
    await rename(tmp, final);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

/**
 * 写入串行化：read → 修改 → persist 必须整体持有。
 * 否则两次并发保存会各自读到同一份旧数据，后写的把先写的覆盖掉。
 */
let queue = Promise.resolve();
function withLock(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function view(store, warnings, readOnly) {
  const value = { version: store.version, snippets: alive(store) };
  if (readOnly) value.readOnly = true;
  if (warnings && warnings.length > 0) value.warning = warnings.join("\n");
  return { ok: true, value };
}

/**
 * 持锁：读 → 迁移前备份 → 迁移落盘 → mutator 修改 → 需要时落盘。
 * 备份必须在 persist 之前——persist 会 rename 覆盖原文，那之后就再也取不到原始字节了。
 */
async function transact(mutator) {
  return withLock(async () => {
    const { store, warnings, migrated, raw, readOnly } = await readStore();
    // 只读保护：数据文件来自更新版本或隔离失败。任何写端点都要拒绝，
    // 否则 persist 会把 version 99 / 损坏现场覆盖成空库。
    if (readOnly) {
      return {
        ok: false,
        error: {
          code: "read-only",
          message: warnings[0] || "片段库处于只读状态，已拒绝写入。",
        },
      };
    }
    if (migrated) {
      if (raw !== undefined) await backupBeforeMigrate(raw);
      await persist(store);
    }
    const result = await mutator(store);
    if (result && result.ok && result.changed) await persist(store);
    if (result && result.ok && warnings.length > 0) {
      result.value.warning = warnings.join("\n");
    }
    return result;
  });
}

/** 持锁读 → 需要迁移就先备份再落盘。读类端点与命令都走这里，保证迁移只发生一次。 */
async function readAndMigrate() {
  return withLock(async () => {
    const { store, warnings, migrated, raw, readOnly } = await readStore();
    if (migrated) {
      if (raw !== undefined) await backupBeforeMigrate(raw);
      await persist(store);
    }
    return { store, warnings, readOnly };
  });
}

function fail(code, message, details) {
  return { ok: false, error: { code, message, details: details || {} } };
}

function conflictError(kind, message, current) {
  return fail("conflict", message, {
    conflict: kind,
    current: current
      ? { id: current.id, revision: current.revision, name: current.name, deletedAt: current.deletedAt }
      : null,
  });
}

// ───────────────────────────── 优化 ─────────────────────────────

const OPTIMIZE_SYSTEM = [
  "你是一位专业的提示词工程专家。请优化用户提供的提示词，让它更清晰、更具体、更有效。",
  "",
  "规则：",
  "1. 保留原意与核心目标，不改变任务本质。",
  "2. 若原提示词缺少必要的上下文、约束或输出格式要求，请合理补充。",
  "3. 保留 {{占位符}} 原样不动，不要替换或删除。",
  "4. 直接输出优化后的提示词正文，不要任何解释、前言、客套话，也不要包裹在 markdown 代码块里。",
].join("\n");

/**
 * 模型可用性探测。capabilities 与 optimize 共用同一判定，
 * 面板才能提前把 ✨ 置灰，而不是等用户点了才报错。
 */
function optimizeAvailability(ctx) {
  const llm = ctx.get("llm");
  if (!llm) return { available: false, reason: "当前环境没有可用的模型服务", provider: null, model: null };
  const defaultModel = ctx.get("agentDefaultModel");
  let provider;
  let model;
  if (defaultModel) {
    try {
      const sel = defaultModel.currentSelection();
      provider = sel && sel.provider;
      model = sel && sel.model;
    } catch (_) {
      /* 读取失败则退回未配置 */
    }
  }
  if (!provider || !model) {
    return { available: false, reason: "未配置默认模型，无法优化", provider: null, model: null };
  }
  return { available: true, reason: null, provider, model };
}

async function optimize(ctx, content, signal) {
  const avail = optimizeAvailability(ctx);
  if (!avail.available) return fail("unavailable", avail.reason);
  const llm = ctx.get("llm");
  const provider = avail.provider;
  const model = avail.model;

  let text = "";
  try {
    for await (const chunk of llm.stream({
      provider,
      model,
      system: OPTIMIZE_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: content }] }],
      maxTokens: 2000,
      ...(signal ? { signal } : {}),
    })) {
      if (chunk && chunk.type === "text-delta") text += chunk.text;
    }
  } catch (error) {
    if (signal && signal.aborted) return fail("aborted", "优化已取消");
    return fail("internal", error instanceof Error ? error.message : String(error));
  }

  const optimized = text.trim();
  if (!optimized) return fail("internal", "优化结果为空");

  // 提示词不保证守规矩，必须代码校验占位符有没有被吃掉
  const before = scanPlaceholders(content).names;
  const after = new Set(scanPlaceholders(optimized).names);
  const lost = before.filter((n) => !after.has(n));
  if (lost.length > 0) {
    return fail(
      "internal",
      `优化结果丢失了占位符 ${lost.map((n) => `{{${n}}}`).join("、")}，请再试一次。`
    );
  }

  const truncated = optimized.length > MAX_CONTENT;
  return {
    ok: true,
    value: { optimized, original: content, truncated },
  };
}

// ───────────────────────────── 写入端点 ─────────────────────────────

/** 同一活跃集合内重名检查（排除自己）。 */
function nameTaken(store, name, selfId) {
  return alive(store).find((s) => s.name === name && s.id !== selfId) ?? null;
}

async function saveSnippet(payload) {
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const content = typeof payload?.content === "string" ? payload.content : null;
  const targetId = typeof payload?.id === "string" && payload.id ? payload.id : null;
  const hasCategoryField = !!payload && typeof payload === "object" && "category" in payload;
  const category =
    typeof payload?.category === "string" && payload.category.trim() ? payload.category.trim() : null;
  const keepCategory = payload?.keepCategory === true || !hasCategoryField;
  const force = payload?.force === true;
  const expectedRevision =
    Number.isInteger(payload?.expectedRevision) && payload.expectedRevision >= 0
      ? payload.expectedRevision
      : null;
  const rawRef = typeof payload?.ref === "string" ? payload.ref : null;

  if (!name) return fail("bad-request", "片段名称不能为空");
  if (name.length > MAX_NAME) return fail("bad-request", `片段名称不能超过 ${MAX_NAME} 个字符`);
  if (content === null) return fail("bad-request", "片段内容必须是字符串");
  if (content.length > MAX_CONTENT) return fail("bad-request", "片段内容过长");

  const { names } = scanPlaceholders(content);
  const { variables, dropped } = normalizeVariables(names, payload?.variables);

  return transact((store) => {
    const now = Date.now();
    let existing = null;

    if (targetId) {
      existing = store.snippets.find((s) => s.id === targetId) ?? null;
      if (!existing) return fail("not-found", "未找到该片段");
      if (existing.deletedAt) {
        return conflictError("deleted", "该片段已被删除，请先恢复再编辑。", existing);
      }
    } else if (rawRef) {
      const found = resolveRef(alive(store), rawRef);
      if (found.missing) return fail("not-found", `未找到片段「${rawRef}」。`);
      if (found.ambiguous) {
        return conflictError(
          "name",
          `有 ${found.ambiguous.length} 个片段都叫「${rawRef}」，无法确定改哪一个。`,
          found.ambiguous[0]
        );
      }
      existing = found.snippet;
    } else {
      // 仅按名称更新：与 v1 行为一致
      existing = alive(store).find((s) => s.name === name) ?? null;
      if (!existing) {
        const dup = alive(store).filter((s) => s.name === name);
        if (dup.length > 1) {
          return conflictError("name", `有 ${dup.length} 个片段都叫「${name}」，无法确定改哪一个。`, dup[0]);
        }
      }
    }

    if (existing) {
      if (!force && expectedRevision !== null && existing.revision !== expectedRevision) {
        return conflictError(
          "revision",
          `该片段已被他处修改（当前 revision ${existing.revision}，你基于 ${expectedRevision}）。`,
          existing
        );
      }
      const other = nameTaken(store, name, existing.id);
      if (other) {
        return conflictError("name", `已有另一个片段叫「${name}」。`, other);
      }
      existing.name = name;
      existing.content = content;
      existing.variables = variables;
      if (!keepCategory) existing.category = category;
      existing.updatedAt = now;
      existing.revision += 1;
      const result = {
        ok: true,
        changed: true,
        created: false,
        value: { ...view(store).value, snippet: existing },
      };
      if (dropped.length > 0) result.value.dropNotice = dropped;
      return result;
    }

    const other = nameTaken(store, name, null);
    if (other) {
      return conflictError("name", `已有另一个片段叫「${name}」。`, other);
    }

    const record = {
      id: randomUUID(),
      name,
      category,
      content,
      variables,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      deletedAt: null,
      useCount: 0,
      lastUsedAt: null,
    };
    store.snippets.push(record);
    return {
      ok: true,
      changed: true,
      created: true,
      value: { ...view(store).value, snippet: record },
    };
  });
}

async function deleteSnippet(payload) {
  const id = typeof payload?.id === "string" && payload.id ? payload.id : null;
  const ref = typeof payload?.ref === "string" && payload.ref.trim() ? payload.ref.trim() : null;
  const expectedRevision =
    Number.isInteger(payload?.expectedRevision) && payload.expectedRevision >= 0
      ? payload.expectedRevision
      : null;
  if (!id && !ref) return fail("bad-request", "需要提供 id 或名称");

  return transact((store) => {
    let target = null;
    if (id) {
      target = store.snippets.find((s) => s.id === id && !s.deletedAt) ?? null;
      if (!target) return fail("not-found", "未找到该片段");
    } else {
      const found = resolveRef(alive(store), ref);
      if (found.missing) return fail("not-found", `未找到片段「${ref}」。`);
      if (found.ambiguous) {
        return conflictError(
          "name",
          `有 ${found.ambiguous.length} 个片段都叫「${ref}」，无法确定删哪一个。\n请指定其中一个：\n${candidateList(
            found.ambiguous
          ).join("\n")}`,
          found.ambiguous[0]
        );
      }
      target = found.snippet;
    }
    if (expectedRevision !== null && target.revision !== expectedRevision) {
      return conflictError(
        "revision",
        `该片段已被他处修改（当前 revision ${target.revision}）。`,
        target
      );
    }
    target.deletedAt = Date.now();
    target.updatedAt = target.deletedAt;
    target.revision += 1;
    return {
      ok: true,
      changed: true,
      value: { ...view(store).value, deleted: { id: target.id, name: target.name } },
    };
  });
}

async function restoreSnippet(payload) {
  const id = typeof payload?.id === "string" && payload.id ? payload.id : null;
  const ref = typeof payload?.ref === "string" && payload.ref.trim() ? payload.ref.trim() : null;
  if (!id && !ref) return fail("bad-request", "需要提供 id 或名称");

  return transact((store) => {
    const pool = store.snippets.filter((s) => s.deletedAt);
    let target = null;
    if (id) {
      target = pool.find((s) => s.id === id) ?? null;
      if (!target) return fail("not-found", "未找到该已删除片段");
    } else {
      const found = resolveRef(pool, ref);
      if (found.missing) return fail("not-found", `没有已删除的片段叫「${ref}」。`);
      if (found.ambiguous) {
        return conflictError(
          "name",
          `有 ${found.ambiguous.length} 个已删除片段叫「${ref}」，无法确定恢复哪一个。\n${candidateList(
            found.ambiguous
          ).join("\n")}`,
          found.ambiguous[0]
        );
      }
      target = found.snippet;
    }

    // 名称被新片段占用时不自动加后缀 —— 自动改名会让用户找不到东西
    const other = nameTaken(store, target.name, target.id);
    if (other) {
      return conflictError(
        "name",
        `已有一个在用片段叫「${target.name}」（#${other.id.slice(0, 6)}），恢复会重名。请先给它改名。`,
        other
      );
    }

    target.deletedAt = null;
    target.updatedAt = Date.now();
    target.revision += 1;
    return {
      ok: true,
      changed: true,
      value: { ...view(store).value, restored: { id: target.id, name: target.name } },
    };
  });
}

// ─────────────────── 使用次数：延迟批量写 ───────────────────

const TOUCH_DELAY_MS = 5000;
const TOUCH_BATCH = 20;

let pendingTouch = new Map();
let pendingCount = 0;
let touchTimer = null;

function scheduleFlush() {
  if (touchTimer) return;
  touchTimer = setTimeout(() => {
    touchTimer = null;
    void flushTouch();
  }, TOUCH_DELAY_MS);
  if (typeof touchTimer.unref === "function") touchTimer.unref();
}

async function flushTouch() {
  if (pendingTouch.size === 0) return;
  const batch = pendingTouch;
  pendingTouch = new Map();
  pendingCount = 0;
  try {
    await transact((store) => {
      let changed = false;
      for (const [id, delta] of batch) {
        const target = store.snippets.find((s) => s.id === id);
        if (!target) continue;
        target.useCount = (Number.isInteger(target.useCount) ? target.useCount : 0) + delta.count;
        target.lastUsedAt = delta.lastAt;
        changed = true;
      }
      if (!changed) return { ok: true, changed: false, value: { version: store.version, snippets: [] } };
      return {
        ok: true,
        changed: true,
        value: { version: store.version, snippets: alive(store) },
      };
    });
  } catch (_) {
    /* 统计丢几次可接受，绝不能因此报错给用户 */
  }
}

function touchIds(ids) {
  if (!Array.isArray(ids)) return;
  const now = Date.now();
  let added = 0;
  for (const id of ids) {
    if (typeof id !== "string" || !id) continue;
    const cur = pendingTouch.get(id) || { count: 0, lastAt: now };
    cur.count += 1;
    cur.lastAt = now;
    pendingTouch.set(id, cur);
    added += 1;
  }
  if (added === 0) return;
  pendingCount += added;
  if (pendingCount >= TOUCH_BATCH) {
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    void flushTouch();
  } else {
    scheduleFlush();
  }
}

// ───────────────────────────── 导入 / 导出 ─────────────────────────────

const EXPORT_FORMAT = "dsh-prompt-snippets";

function buildExport(store, ids) {
  const pool = alive(store);
  const picked =
    Array.isArray(ids) && ids.length > 0 ? pool.filter((s) => ids.includes(s.id)) : pool;
  return {
    format: EXPORT_FORMAT,
    version: STORE_VERSION,
    exportedAt: Date.now(),
    snippets: picked.map((s) => ({
      name: s.name,
      category: s.category,
      content: s.content,
      variables: s.variables,
    })),
  };
}

/** 接受三种输入：本插件导出格式 / 裸数组 / 完整 store 文件。 */
function parseImport(raw) {
  let data;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch (_) {
      return { error: "导入内容不是合法 JSON" };
    }
  } else {
    data = raw;
  }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.snippets) ? data.snippets : null;
  if (!list) return { error: "导入内容里没有 snippets 数组" };

  const out = [];
  let dropped = 0;
  // 同文件内按名称去重：同名片段只保留最后一条（后者覆盖前者），
  // 否则「A,A」会生成两条同名记录，之后按名称匹配就变成歧义。
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") {
      dropped++;
      continue;
    }
    const nm = typeof item.name === "string" ? item.name.trim().slice(0, MAX_NAME) : "";
    if (!nm || typeof item.content !== "string" || item.content.length > MAX_CONTENT) {
      dropped++;
      continue;
    }
    const { names } = scanPlaceholders(item.content);
    const { variables } = normalizeVariables(names, item.variables);
    const record = {
      name: nm,
      category: typeof item.category === "string" && item.category.trim() ? item.category.trim() : null,
      content: item.content,
      variables,
    };
    // 后者覆盖前者：从 out 里拿掉旧的那条，同名的进不了「seen 已处理」的陷阱
    if (seen.has(nm)) {
      const idx = out.findIndex((r) => r.name === nm);
      if (idx >= 0) out.splice(idx, 1);
      dropped++;
    }
    seen.add(nm);
    out.push(record);
  }
  return { snippets: out, dropped };
}

async function importSnippets(payload) {
  const rawBytes = typeof payload?.rawBytes === "number" && payload.rawBytes >= 0
    ? payload.rawBytes
    : payload?.json != null
    ? byteLength(payload.json)
    : 0;
  if (rawBytes > MAX_IMPORT_BYTES) {
    return fail("bad-request", `导入内容过大（${rawBytes} 字节，上限 ${MAX_IMPORT_BYTES} 字节）`);
  }
  const parsed = parseImport(payload?.json);
  if (parsed.error) return fail("bad-request", parsed.error);
  const mode = payload?.mode === "replace" ? "replace" : "merge";
  const dryRun = payload?.dryRun === true;

  return transact((store) => {
    const plan = { added: 0, updated: 0, skipped: 0, deleted: 0, conflicts: [], dropped: parsed.dropped || 0 };
    const now = Date.now();
    // merge：只在活跃片段里按名称匹配，命中即跳过（不覆盖）。
    // replace：以名称为锚复用现有记录（含已软删除的），命中即覆盖并复活；
    //          未命中的活跃片段在末尾统一软删除——保留垃圾桶，误操作还能 restore。
    //          复用记录而不是「全删再新建」是为了让 id 稳定、revision 连续递增，
    //          外部（如面板草稿的 expectedRevision）不会因为一次导入而集体失效。
    const pool = mode === "replace" ? store.snippets.slice() : alive(store);
    const matched = new Set();

    for (const item of parsed.snippets) {
      const exist = pool.find((s) => s.name === item.name && !matched.has(s.id)) ?? null;
      if (exist) {
        if (mode === "merge") {
          plan.skipped++;
          plan.conflicts.push({ name: item.name, reason: "name" });
          continue;
        }
        matched.add(exist.id);
        plan.updated++;
        if (!dryRun) {
          exist.content = item.content;
          exist.variables = item.variables;
          exist.category = item.category;
          exist.updatedAt = now;
          if (exist.deletedAt !== null && exist.deletedAt !== undefined) exist.deletedAt = null;
          exist.revision += 1;
        }
      } else {
        plan.added++;
        if (!dryRun) {
          const fresh = {
            id: randomUUID(),
            name: item.name,
            category: item.category,
            content: item.content,
            variables: item.variables,
            createdAt: now,
            updatedAt: now,
            revision: 1,
            deletedAt: null,
            useCount: 0,
            lastUsedAt: null,
          };
          store.snippets.push(fresh);
          matched.add(fresh.id);
        }
      }
    }

    // replace 收尾：这一批里没出现过的活跃片段全部软删除。
    // dry-run 也要算 deleted 数，但不动数据，让用户预演时就知道会清掉几条。
    if (mode === "replace") {
      let deleted = 0;
      for (const s of store.snippets) {
        if (matched.has(s.id)) continue;
        if (s.deletedAt !== null && s.deletedAt !== undefined) continue;
        deleted++;
        if (!dryRun) {
          s.deletedAt = now;
          s.updatedAt = now;
          s.revision += 1;
        }
      }
      plan.deleted = deleted;
    }

    if (dryRun) {
      return { ok: true, changed: false, value: { plan, dryRun: true, ...view(store).value } };
    }
    if (plan.added === 0 && plan.updated === 0 && plan.skipped === 0 && plan.deleted === 0) {
      return { ok: true, changed: false, value: { plan, ...view(store).value } };
    }
    return { ok: true, changed: true, value: { plan, ...view(store).value } };
  });
}

// ─────────────────── 命令参数：--cat 只认行尾 ───────────────────

/**
 * 严格行尾判定，正文中间的 --cat 原样保留。
 *   add <名称> <正文…> --cat=<分类>     → 取分类
 *   add <名称> <正文…> --cat <分类>     → 仅当 --cat 是倒数第二个 token
 *   add <名称> <正文…> -- --cat         → "--" 之后全按字面，可写结尾的 --cat
 */
function parseAddArgs(rest) {
  let tokens = rest.slice();
  let category = null;
  let hasCategory = false;
  let notice = null;

  const dashDash = tokens.indexOf("--");
  let head;
  let tail;
  if (dashDash !== -1) {
    head = tokens.slice(0, dashDash);
    tail = tokens.slice(dashDash + 1);
  } else {
    head = tokens.slice();
    tail = null;
  }

  const last = head.length > 0 ? head[head.length - 1] : null;
  if (last !== null && (last.startsWith("--cat=") || last.startsWith("-c="))) {
    const eq = last.indexOf("=");
    category = last.slice(eq + 1).trim() || null;
    hasCategory = true;
    head.pop();
  } else if (head.length >= 2) {
    const prev = head[head.length - 2];
    if (prev === "--cat" || prev === "-c") {
      category = head[head.length - 1].trim() || null;
      hasCategory = true;
      head.length -= 2;
    }
  }
  if (!hasCategory && head.length >= 1) {
    const lastTok = head[head.length - 1];
    if (lastTok === "--cat" || lastTok === "-c") {
      hasCategory = true;
      category = null;
      head.pop();
    }
  }

  const contentTokens = tail === null ? head : head.concat(tail);

  if (!hasCategory) {
    const hit = contentTokens.find((t) => t === "--cat" || t === "-c" || t.startsWith("--cat=") || t.startsWith("-c="));
    if (hit) {
      notice = `正文里的「${hit}」已按字面保留。要设置分类请写在行尾（--cat=分类），或先用 -- 结束选项。`;
    }
  }

  return { name: contentTokens[0] ?? "", content: contentTokens.slice(1).join(" "), category, hasCategory, notice };
}

// ───────────────────────────── 分派 ─────────────────────────────

async function dispatch(ctx, endpoint, payload, signal) {
  switch (endpoint) {
    case "capabilities": {
      const avail = optimizeAvailability(ctx);
      return {
        ok: true,
        value: {
          protocol: STORE_VERSION,
          storeVersion: STORE_VERSION,
          endpoints: ENDPOINTS,
          channel: CHANNEL,
          // 面板据此提前把 ✨ 置灰，并把 reason 挂到 title 上
          optimize: { available: avail.available, reason: avail.reason },
        },
      };
    }

    case "list": {
      const { store, warnings, readOnly } = await readAndMigrate();
      return view(store, warnings, readOnly);
    }

    case "get": {
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) return fail("bad-request", "需要提供 id");
      const { store, warnings, readOnly } = await readAndMigrate();
      const found = store.snippets.find((s) => s.id === id) ?? null;
      if (!found) return fail("not-found", "未找到该片段");
      return {
        ok: true,
        value: { snippet: found, readOnly: readOnly || undefined, warning: warnings.join("\n") || undefined },
      };
    }

    case "save":
      return saveSnippet(payload);

    case "delete":
      return deleteSnippet(payload);

    case "restore":
      return restoreSnippet(payload);

    case "touch":
      touchIds(payload?.ids);
      return { ok: true, value: {} };

    case "optimize": {
      let content = typeof payload?.content === "string" ? payload.content : "";
      if (!content.trim() && typeof payload?.id === "string" && payload.id) {
        const { store } = await readAndMigrate();
        const found = store.snippets.find((s) => s.id === payload.id);
        if (found) content = found.content;
      }
      if (!content.trim()) return fail("bad-request", "片段内容不能为空");
      return await optimize(ctx, content, signal);
    }

    case "export": {
      const { store, warnings } = await readAndMigrate();
      const device = buildExport(store, payload?.ids);
      const json = JSON.stringify(device, null, 2);
      // payload.write = 文件名（字符串）时，落盘到数据目录的 exports/ 并回传路径。
      // 面板没有文件选择器，走这条路把文件实实在在交到用户手上。
      if (typeof payload?.write === "string") {
        const fileName = safeExportName(payload.write);
        if (fileName === null) return fail("bad-request", "导出文件名不合法");
        const target = dataPath("exports", fileName);
        try {
          await mkdir(dataPath("exports"), { recursive: true });
          await writeFile(target, json, { encoding: "utf8", flag: "w" });
        } catch (error) {
          return fail("internal", `写入导出文件失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return {
          ok: true,
          value: { json, count: device.snippets.length, path: target, warning: warnings.join("\n") || undefined },
        };
      }
      return {
        ok: true,
        value: {
          json,
          count: device.snippets.length,
          warning: warnings.join("\n") || undefined,
        },
      };
    }

    case "import": {
      // 两种入口：
      //   payload.json = 已读到的文本（命令侧读完再传）
      //   payload.path = 文件路径（面板侧拿不到文件系统，交给 host 读）
      // path 省略 exports/ 前缀与 .json 后缀时回落到数据目录的 exports/。
      let raw = payload?.json;
      let usedPath = null;
      if (typeof payload?.path === "string" && payload.path.trim() !== "") {
        const target = payload.path.trim();
        usedPath = target;
        try {
          raw = await readFile(target, "utf8");
        } catch (_) {
          const guess = dataPath("exports", target.toLowerCase().endsWith(".json") ? target : `${target}.json`);
          try {
            raw = await readFile(guess, "utf8");
            usedPath = guess;
          } catch (error) {
            return fail(
              "bad-request",
              `读不到导入文件「${target}」：${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
      const result = await importSnippets({ ...payload, json: raw, rawBytes: raw !== undefined ? byteLength(raw) : 0 });
      if (result.ok && usedPath) {
        return { ok: true, value: { ...result.value, path: usedPath } };
      }
      return result;
    }

    default:
      return fail(
        "not-found",
        `未知操作：${String(endpoint)}（host 端可能仍是旧代码，请重启 DSH）`
      );
  }
}

const ADD_USAGE = "/snippet add <名称> <内容> [--cat=<分类>]";
const USAGE = `${ADD_USAGE} | list | show <名称> | rm <名称|#id> | undo <名称|#id> | mv <名称> <新名称> | optimize <名称> | export [文件名] | import <文件路径> [--replace] [--dry]`;

/** 导出文件名不能带路径分隔符，也不能是 `.`/`..`，避免写出数据目录。 */
function safeExportName(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const base = text === "" ? "snippets" : text;
  if (base.includes("/") || base.includes("\\") || base === "." || base === "..") return null;
  const withExt = base.toLowerCase().endsWith(".json") ? base : `${base}.json`;
  // 只留安全字符，避免 Windows 保留名/控制字符
  if (!/^[^<>:"|?*\u0000-\u001f]{1,80}$/u.test(withExt)) return null;
  return withExt;
}

export function apply(ctx) {
  // 不能用 ctx.connection.rpc.handle()：它内部用 connection 插件自己的 fiber
  // ctx 作为 owner 去读 owner.webServer，而 webServer 是 connection 的兄弟
  // entry（不在其祖先链上），属性访问会抛错导致路由未注册、请求落 405。
  // 正确做法：本插件 inject webServer，并把 owner 显式传成本插件的 ctx。
  ctx.connection.register(ctx, CHANNEL, async (endpoint, payload, signal) => {
    try {
      return await dispatch(ctx, endpoint, payload, signal);
    } catch (error) {
      return fail("internal", error instanceof Error ? error.message : String(error));
    }
  });

  // 进程退出前把待写的使用次数落盘（最坏丢 5 秒统计）
  try {
    ctx.effect(() => () => {
      if (touchTimer) clearTimeout(touchTimer);
      touchTimer = null;
      void flushTouch();
    });
  } catch (_) {
    /* 无 effect 能力时忽略 */
  }

  ctx.commands.register({
    name: "snippet",
    description: "管理提示词片段：保存、列出、查看、删除、恢复、改名、AI 优化、导入导出",
    input: {
      hint: "add <名称> <内容> [--cat=<分类>] | list | show <名称> | rm <名称> | undo <名称> | mv <名称> <新名> | optimize <名称> | export [文件名] | import <文件> [--replace] [--dry]",
    },
    async handler({ rawInput, signal }) {
      const args = (rawInput ?? "").trim();
      const [verb, ...rest] = args.split(/\s+/);

      switch (verb) {
        case "":
        case "list": {
          const { store, warnings } = await readAndMigrate();
          const items = alive(store);
          const head = warnings.length > 0 ? `⚠ ${warnings.join("\n⚠ ")}\n` : "";
          if (items.length === 0) {
            return {
              kind: "success",
              text: `${head}还没有保存任何片段。用 /snippet add <名称> <内容> 保存一个。`,
            };
          }
          const lines = items.map((s, i) => {
            const vars = scanPlaceholders(s.content).names;
            const varTag = vars.length > 0 ? ` {${vars.join(", ")}}` : "";
            return `${i + 1}. ${s.name}${s.category ? ` [${s.category}]` : ""}${varTag}`;
          });
          return { kind: "success", text: `${head}已保存 ${items.length} 个片段：\n${lines.join("\n")}` };
        }

        case "show": {
          const ref = rest.join(" ").trim();
          if (!ref) return { kind: "error", text: "用法：/snippet show <名称|#id>" };
          const { store } = await readAndMigrate();
          const found = resolveRef(alive(store), ref);
          if (found.missing) return { kind: "error", text: `未找到片段「${ref}」。` };
          if (found.ambiguous) {
            return {
              kind: "error",
              text: `有 ${found.ambiguous.length} 个片段都叫「${ref}」：\n${candidateList(found.ambiguous).join("\n")}`,
            };
          }
          const s = found.snippet;
          const vars = Object.entries(s.variables || {});
          const varText =
            vars.length === 0
              ? ""
              : `\n\n变量：\n${vars
                  .map(
                    ([k, v]) =>
                      `  {{${k}}}${v.required ? "（必填）" : ""}${typeof v.default === "string" && v.default ? ` 默认「${v.default}」` : ""}${
                        Array.isArray(v.options) ? ` 选项 ${v.options.join(" / ")}` : ""
                      }`
                  )
                  .join("\n")}`;
          return {
            kind: "success",
            text: `#${s.id.slice(0, 6)}  ${s.name}${s.category ? ` [${s.category}]` : ""}  rev ${s.revision}\n\n${s.content}${varText}`,
          };
        }

        case "add":
        case "save": {
          const parsed = parseAddArgs(rest);
          if (!parsed.name || !parsed.content) {
            return { kind: "error", text: `用法：${ADD_USAGE}` };
          }
          const result = await saveSnippet({
            name: parsed.name,
            content: parsed.content,
            category: parsed.category,
            keepCategory: !parsed.hasCategory,
          });
          if (!result.ok) return { kind: "error", text: result.error.message };
          const cat = parsed.hasCategory && parsed.category ? `（分类：${parsed.category}）` : "";
          const note = parsed.notice ? `\n提示：${parsed.notice}` : "";
          return {
            kind: "success",
            text: `已${result.created ? "保存" : "更新"}片段「${parsed.name}」${cat}。${note}`,
          };
        }

        case "rm":
        case "delete": {
          const ref = rest.join(" ").trim();
          if (!ref) return { kind: "error", text: "用法：/snippet rm <名称|#id>" };
          const result = await deleteSnippet({ ref });
          if (!result.ok) return { kind: "error", text: result.error.message };
          const name = result.value.deleted ? result.value.deleted.name : ref;
          return {
            kind: "success",
            text: `已删除片段「${name}」。用 /snippet undo ${name} 可以恢复。`,
          };
        }

        case "undo":
        case "restore": {
          const ref = rest.join(" ").trim();
          if (!ref) return { kind: "error", text: "用法：/snippet undo <名称|#id>" };
          const result = await restoreSnippet({ ref });
          if (!result.ok) return { kind: "error", text: result.error.message };
          return { kind: "success", text: `已恢复片段「${result.value.restored.name}」。` };
        }

        case "mv":
        case "rename": {
          const ref = rest[0];
          const newName = rest.slice(1).join(" ").trim();
          if (!ref || !newName) return { kind: "error", text: "用法：/snippet mv <名称|#id> <新名称>" };
          if (newName.length > MAX_NAME) {
            return { kind: "error", text: `片段名称不能超过 ${MAX_NAME} 个字符` };
          }
          const { store } = await readAndMigrate();
          const found = resolveRef(alive(store), ref);
          if (found.missing) return { kind: "error", text: `未找到片段「${ref}」。` };
          if (found.ambiguous) {
            return {
              kind: "error",
              text: `有 ${found.ambiguous.length} 个片段都叫「${ref}」，无法确定改哪一个：\n${candidateList(
                found.ambiguous
              ).join("\n")}`,
            };
          }
          const target = found.snippet;
          const result = await saveSnippet({
            id: target.id,
            name: newName,
            content: target.content,
            variables: target.variables,
            expectedRevision: target.revision,
          });
          if (!result.ok) return { kind: "error", text: result.error.message };
          return { kind: "success", text: `已把「${target.name}」改名为「${newName}」。` };
        }

        case "optimize":
        case "opt": {
          const ref = rest.join(" ").trim();
          if (!ref) return { kind: "error", text: "用法：/snippet optimize <名称|#id>" };
          const { store } = await readAndMigrate();
          const found = resolveRef(alive(store), ref);
          if (found.missing) return { kind: "error", text: `未找到片段「${ref}」。` };
          if (found.ambiguous) {
            return {
              kind: "error",
              text: `有 ${found.ambiguous.length} 个片段都叫「${ref}」，无法确定优化哪一个：\n${candidateList(
                found.ambiguous
              ).join("\n")}`,
            };
          }
          const result = await optimize(ctx, found.snippet.content, signal);
          if (!result.ok) return { kind: "error", text: `优化失败：${result.error.message}` };
          return {
            kind: "success",
            text: `「${found.snippet.name}」优化结果：\n\n${result.value.optimized}`,
          };
        }

        case "export": {
          const fileName = safeExportName(rest.join(" "));
          if (fileName === null) return { kind: "error", text: "导出文件名不合法（不能含路径分隔符或 Windows 保留字符）。" };
          const result = await dispatch(ctx, "export", { write: fileName }, signal);
          if (!result.ok) return { kind: "error", text: result.error.message };
          const warn = result.value.warning ? `\n⚠ ${result.value.warning}` : "";
          return {
            kind: "success",
            text: `已导出 ${result.value.count} 个片段到：\n${result.value.path}${warn}\n\n用 /snippet import ${fileName} 可在别的机器导入。`,
          };
        }

        case "import": {
          const tokens = rest.filter((t) => !t.startsWith("--"));
          const replace = rest.includes("--replace");
          const dryRun = rest.includes("--dry");
          const target = tokens.join(" ").trim();
          if (!target) return { kind: "error", text: "用法：/snippet import <文件路径> [--replace] [--dry]" };
          const result = await dispatch(
            ctx,
            "import",
            { path: target, mode: replace ? "replace" : "merge", dryRun },
            signal
          );
          if (!result.ok) return { kind: "error", text: result.error.message };
          const p = result.value.plan;
          const lines = [
            `${dryRun ? "预演（未写入）" : "导入完成"}（${replace ? "替换模式" : "合并模式"}）：`,
            `来源：${result.value.path}`,
            `新增 ${p.added}，更新 ${p.updated}，跳过 ${p.skipped}，丢弃 ${p.dropped}`,
          ];
          if (replace && (p.deleted > 0 || dryRun)) {
            lines.push(dryRun ? `将移入垃圾桶 ${p.deleted} 条` : `移入垃圾桶 ${p.deleted} 条（可 /snippet undo 恢复）`);
          }
          if (p.conflicts.length > 0) {
            const names = p.conflicts.slice(0, 10).map((c) => c.name).join("、");
            const more = p.conflicts.length > 10 ? ` 等 ${p.conflicts.length} 个` : "";
            lines.push(`同名跳过：${names}${more}`);
          }
          if (dryRun) lines.push("确认无误后去掉 --dry 再执行一次。");
          return { kind: "success", text: lines.join("\n") };
        }

        default:
          return { kind: "error", text: `未知操作。用法：${USAGE}` };
      }
    },
  });
}
