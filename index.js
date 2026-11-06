import { mkdir, readFile, writeFile, rename, unlink, open, copyFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "prompt-snippets";
export const inject = ["connection", "commands", "webServer"];

const CHANNEL = "/prompt-snippets";
const STORE_VERSION = 4;
const MAX_NAME = 120;
const MAX_CONTENT = 200_000;
const MAX_VARIABLES = 64;
const MAX_TAGS = 32;
const MAX_TAG_LEN = 24;
const CORRUPT_KEEP = 5;
// 版本历史：每个片段单独一份文件，保留最近 N 版。
const HISTORY_KEEP = 20;
const HISTORY_MAX_BYTES = 2_000_000;
// .bak 轮换份数（1..N，轮转保留）
const BAK_ROTATE = 7;
// 导入 JSON 大小上限（UTF-8 字节）：防内存被打爆，也让恶意/损坏文件止步。
const MAX_IMPORT_BYTES = 8_000_000;

// 动态宏变量：插入时由 client 用本地时间实时替换，不落进 variables 元数据、
// 不参与必填/默认值校验。与 client.js 的 DYNAMIC_VAR_NAMES 保持一致。
const DYNAMIC_VAR_NAMES = new Set(["date", "time", "datetime"]);

// 内置模板包：仅首次运行（数据文件尚不存在）时预置，给空库一个冷启动起点。
// 用户删除后不再重灌；已有数据文件（哪怕空）绝不注入，避免覆盖用户选择。
const TEMPLATE_PACK = [
  {
    name: "代码审查",
    category: "开发",
    tags: ["代码", "审查"],
    content: "请审查下面这段代码，重点关注 {{关注点}}，指出潜在 bug、性能问题与可读性改进，并给出修改建议。\n\n```\n{{代码}}\n```",
    variables: {
      关注点: {
        label: "关注点",
        options: ["正确性、边界与命名", "性能与内存", "安全漏洞", "可读性与重构"],
        default: "正确性、边界与命名",
      },
      代码: { label: "待审查代码", required: true },
    },
  },
  {
    name: "Git 提交信息",
    category: "开发",
    tags: ["git", "提交"],
    content: "请根据以下变更，生成一条规范的 git commit message（约定式提交风格，一行标题 + 空行 + 要点式正文）：\n\n{{变更说明}}",
    variables: { 变更说明: { label: "变更说明", required: true } },
  },
  {
    name: "Bug 排查",
    category: "开发",
    tags: ["bug", "排查"],
    content: "我遇到一个问题：{{现象}}。相关环境：{{环境}}。已尝试：{{已尝试}}。请按「现象 → 根因假设 → 验证方法 → 修复方案」逐步分析。",
    variables: {
      现象: { label: "问题现象", required: true },
      环境: { label: "相关环境", default: "操作系统 / 版本 / 依赖" },
      已尝试: { label: "已尝试的方法" },
    },
  },
  {
    name: "周报",
    category: "写作",
    tags: ["周报", "工作"],
    content: "请根据以下要点，帮我整理成一份结构清晰的周报（本周完成 / 进行中 / 下周计划 / 风险与求助）：\n\n{{要点}}",
    variables: { 要点: { label: "工作要点", required: true } },
  },
  {
    name: "翻译润色",
    category: "写作",
    tags: ["翻译", "润色"],
    content: "请把下面的内容翻译成 {{目标语言}}，并润色为自然流畅的表达，保留原意与格式：\n\n{{原文}}",
    variables: {
      目标语言: {
        label: "目标语言",
        options: ["英文", "简体中文", "繁体中文", "日文", "韩文", "法文", "德文"],
        default: "英文",
      },
      原文: { label: "待翻译内容", required: true },
    },
  },
  {
    name: "日报",
    category: "写作",
    tags: ["日报", "工作"],
    content: "今天是 {{date}}，请根据以下要点帮我生成一份工作日报（今日完成 / 明日计划 / 需要协调）：\n\n{{要点}}",
    variables: { 要点: { label: "工作要点", required: true } },
  },
  {
    name: "会议纪要",
    category: "写作",
    tags: ["会议", "纪要"],
    content: "请把下面的会议记录整理成纪要（结论 / 待办与负责人 / 时间点）：\n\n{{记录}}",
    variables: { 记录: { label: "会议记录", required: true } },
  },
  {
    name: "学习计划",
    category: "学习",
    tags: ["学习", "计划"],
    content: "我想在 {{时间}} 内掌握 {{主题}}，目前基础是 {{当前水平}}。请制定一个可执行的学习计划，分阶段列出目标、内容与检验方式。",
    variables: {
      时间: { label: "学习周期", default: "3 个月" },
      主题: { label: "学习主题", required: true },
      当前水平: { label: "当前基础", default: "零基础" },
    },
  },
];

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
  "history",
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
 * 数据模型 v4（存于 <home>/data/prompt-snippets/snippets.json）：
 * {
 *   version: 4,
 *   snippets: [{
 *     id, name, category, content,
 *     variables: { [变量名]: { label?, default?, options?, required? } },
 *     createdAt, updatedAt,
 *     revision,      // 片段级单调递增，从 1 起；乐观锁用
 *     deletedAt,     // 非空 = 软删除，保留以便 restore
 *     useCount, lastUsedAt,
 *     tags: string[],  // 多选切面，与 category（单选层级）并存
 *     pinned: boolean, pinnedAt
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
    // 动态宏变量（date/time/datetime）由 client 插入时实时替换，不进 variables 元数据
    if (DYNAMIC_VAR_NAMES.has(nm)) continue;
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

/** 规范化标签数组：去空、去重、裁剪、上限。 */
function normalizeTags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const t of input) {
    if (typeof t !== "string") continue;
    const tag = t.trim().slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** 用给定值渲染；缺必填项时返回 missing。 */
function _renderContent(tokens, variables, values) {
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

/**
 * 首次运行预置模板：仅当数据文件尚不存在（ENOENT）时调用一次。
 * 返回带模板的空库；调用方负责落盘。之后用户删了也不重灌——
 * 文件一旦存在（哪怕用户清空成 0 条），就不再注入，尊重用户选择。
 */
function seedTemplates() {
  const now = Date.now();
  const snippets = TEMPLATE_PACK.map((t, i) => {
    const { names } = scanPlaceholders(t.content);
    const { variables } = normalizeVariables(names, t.variables || {});
    return {
      id: randomUUID(),
      name: t.name,
      category: t.category,
      content: t.content,
      variables,
      createdAt: now + i,
      updatedAt: now + i,
      revision: 1,
      deletedAt: null,
      useCount: 0,
      lastUsedAt: null,
      tags: normalizeTags(t.tags),
      pinned: false,
      pinnedAt: null,
    };
  });
  return { version: STORE_VERSION, snippets };
}

// ───────────────────────────── 迁移 ─────────────────────────────

/**
 * 把任意历史版本整理成 v4。逐条容错：坏条目丢弃，其余保留。
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

    const revision = Number.isInteger(item.revision) && item.revision >= 1 ? item.revision : 1;
    if (revision !== item.revision) {
      changed = true;
      stats.filled++;
    }

    const useCount = Number.isInteger(item.useCount) && item.useCount >= 0 ? item.useCount : 0;
    if (useCount !== item.useCount) changed = true;

    const lastUsedAt =
      Number.isFinite(item.lastUsedAt) && item.lastUsedAt > 0 ? item.lastUsedAt : null;
    if (lastUsedAt !== (item.lastUsedAt ?? null)) changed = true;

    // v4 新增：标签（多选切面）与收藏（置顶）
    const tags = normalizeTags(item.tags);
    if (JSON.stringify(tags) !== JSON.stringify(Array.isArray(item.tags) ? item.tags : [])) {
      changed = true;
    }
    const pinned = item.pinned === true;
    if (typeof item.pinned !== "undefined" && item.pinned !== true && item.pinned !== false) {
      changed = true;
    }
    const pinnedAt = pinned
      ? Number.isFinite(item.pinnedAt) && item.pinnedAt > 0
        ? item.pinnedAt
        : item.updatedAt
      : null;
    if (pinned && pinnedAt !== (item.pinnedAt ?? null)) changed = true;
    if (item.pinnedAt != null && !pinned) changed = true; // 未收藏却带 pinnedAt → 清掉

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
      tags,
      pinned,
      pinnedAt,
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
 * 迁移前的一次性现场保护：把**原始字节**另存一份 `snippets.json.pre-v4.bak`。
 * 用 flag "wx" 一次成型：要么完整写出，要么文件根本不存在，不会有半截备份；
 * 已经存在就不覆盖——那是更早、更原始的现场，比现在这份更值钱。
 * 备份失败只降级（不给 warning 噪声），不能因为备份把迁移卡死。
 */
async function backupBeforeMigrate(raw) {
  const name = "snippets.json.pre-v4.bak";
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
      // 首次运行：预置内置模板包，给空库一个冷启动起点。
      // 标记 migrated=true 让调用方落盘；此时 raw 为 undefined，不会误触发迁移前备份。
      return { store: seedTemplates(), warnings: [], migrated: true, readOnly: false };
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
    // 先轮换历史链（把当前 .bak 顺移到 .bak.1，更老的逐级后移），
    // 再把新备份 rename 到 .bak。这样 .bak.1..N 记录的是「再上一版」。
    await rotateBackups();
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

/** .bak 轮换：把当前 .bak 顺移为 .bak.1，.bak.1→.bak.2 …，最老的 .bak.N 丢弃。 */
async function rotateBackups() {
  try {
    // 先删最老的一份，腾出位置
    await unlink(dataPath(`snippets.json.bak.${BAK_ROTATE}`)).catch(() => {});
    // 逐级后移：.bak.(N-1) → .bak.N
    for (let n = BAK_ROTATE; n > 1; n--) {
      await rename(dataPath(`snippets.json.bak.${n - 1}`), dataPath(`snippets.json.bak.${n}`)).catch(() => {});
    }
    // 当前 .bak → .bak.1（rename 后 .bak 名空出，等调用方 rename 新备份进来）
    await rename(dataPath("snippets.json.bak"), dataPath("snippets.json.bak.1")).catch(() => {});
  } catch (_) {
    /* 轮换失败仅降级 */
  }
}

// ───────────────────────────── 版本历史 ─────────────────────────────
// 每个片段独立一个文件 <home>/data/prompt-snippets/history/<id>.json，
// 只记录「被替换掉的那一版」，当前版永远在主库；不随导出分发。

function historyPath(id) {
  return dataPath("history", `${id}.json`);
}

/** 记录一次历史版本（prev = 被覆盖的那一版）。保留最近 HISTORY_KEEP 版，超体积丢最旧。 */
async function recordHistory(id, prev) {
  if (!id || !prev || typeof prev.content !== "string") return;
  try {
    await mkdir(dataPath("history"), { recursive: true });
    const file = historyPath(id);
    let list = [];
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(parsed)) list = parsed;
    } catch (_) {
      /* 无历史文件 = 空列表 */
    }
    list.push(prev);
    if (list.length > HISTORY_KEEP) list = list.slice(list.length - HISTORY_KEEP);
    // 单片段历史体积上限：超了就丢最旧，保证历史文件不会无限膨胀
    let payload = JSON.stringify(list);
    while (byteLength(payload) > HISTORY_MAX_BYTES && list.length > 1) {
      list.shift();
      payload = JSON.stringify(list);
    }
    await writeFile(file, payload, "utf8");
  } catch (_) {
    /* 历史写入失败只降级，不影响主流程 */
  }
}

/** 读取某片段的历史版本（新→旧）。读失败/不存在都返回空数组。 */
async function listHistory(id) {
  try {
    const raw = await readFile(historyPath(id), "utf8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
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
    () => undefined,
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
      // 提示词优化不需要长输出，反而会诱导模型扩写到冗长、拖慢生成。
      // 按输入长度自适应：短输入 600、中等 900、长输入 1200 封顶，明显比固定 2000 更快。
      maxTokens: content.length > 1000 ? 1200 : content.length > 200 ? 900 : 600,
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
      `优化结果丢失了占位符 ${lost.map((n) => `{{${n}}}`).join("、")}，请再试一次。`,
    );
  }

  const truncated = optimized.length > MAX_CONTENT;
  return {
    ok: true,
    value: { optimized, original: content, truncated },
  };
}

/**
 * A 方案：流式透传。和 optimize() 共享同一套判定与校验，但不一次性攒齐再返回，
 * 而是边生成边把 text-delta 以 NDJSON 行推给浏览器，textarea 实时刷新。
 * 行协议：{"type":"delta","text":"…"} | {"type":"done","optimized":"…","truncated":bool}
 *        | {"type":"error","code":"…","message":"…"}
 * 取消：request.signal 断开时 ReadableStream 的 cancel 会触发，llm.stream 的 signal 停流。
 */
function optimizeStreamResponse(ctx, content, requestSignal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (obj) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch (_) {
          /* 已关闭/取消，忽略 */
        }
      };
      const avail = optimizeAvailability(ctx);
      if (!avail.available) {
        push({ type: "error", code: "unavailable", message: avail.reason });
        controller.close();
        return;
      }
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
          maxTokens: content.length > 1000 ? 1200 : content.length > 200 ? 900 : 600,
          ...(requestSignal ? { signal: requestSignal } : {}),
        })) {
          if (chunk && chunk.type === "text-delta") {
            text += chunk.text;
            push({ type: "delta", text: chunk.text });
          }
        }
      } catch (error) {
        if (requestSignal && requestSignal.aborted) {
          push({ type: "error", code: "aborted", message: "优化已取消" });
        } else {
          push({ type: "error", code: "internal", message: error instanceof Error ? error.message : String(error) });
        }
        controller.close();
        return;
      }

      const optimized = text.trim();
      if (!optimized) {
        push({ type: "error", code: "internal", message: "优化结果为空" });
        controller.close();
        return;
      }
      const before = scanPlaceholders(content).names;
      const after = new Set(scanPlaceholders(optimized).names);
      const lost = before.filter((n) => !after.has(n));
      if (lost.length > 0) {
        push({
          type: "error",
          code: "internal",
          message: `优化结果丢失了占位符 ${lost.map((n) => `{{${n}}}`).join("、")}，请再试一次。`,
        });
        controller.close();
        return;
      }
      push({ type: "done", optimized, truncated: optimized.length > MAX_CONTENT });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
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
  const tags = normalizeTags(payload?.tags);
  const hasTagsField = !!payload && typeof payload === "object" && "tags" in payload;
  const keepTags = payload?.keepTags === true || !hasTagsField;
  const hasPinnedField = !!payload && typeof payload === "object" && "pinned" in payload;
  const pinned = payload?.pinned === true;
  const keepPinned = payload?.keepPinned === true || !hasPinnedField;

  if (!name) return fail("bad-request", "片段名称不能为空");
  if (name.length > MAX_NAME) return fail("bad-request", `片段名称不能超过 ${MAX_NAME} 个字符`);
  if (content === null) return fail("bad-request", "片段内容必须是字符串");
  if (content.length > MAX_CONTENT) return fail("bad-request", "片段内容过长");

  const { names } = scanPlaceholders(content);
  const { variables, dropped } = normalizeVariables(names, payload?.variables);

  // 在锁内取被覆盖版本的快照，锁外再落历史文件（历史是独立文件，不进主库事务）
  let historySnapshot = null;
  let historyId = null;

  const result = await transact((store) => {
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
          found.ambiguous[0],
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
          existing,
        );
      }
      const other = nameTaken(store, name, existing.id);
      if (other) {
        return conflictError("name", `已有另一个片段叫「${name}」。`, other);
      }
      // 记历史：被覆盖的这一版（name/content/variables 快照）。
      // 只改分类/标签/置顶这类元数据时内容与变量都没动，不该产生一条历史版本，
      // 否则「换了个标签」就多出一次可回退的旧版，历史列表会迅速被噪声塞满。
      const contentChanged = existing.content !== content;
      const variablesChanged = JSON.stringify(existing.variables) !== JSON.stringify(variables);
      if (contentChanged || variablesChanged) {
        historyId = existing.id;
        historySnapshot = {
          name: existing.name,
          content: existing.content,
          variables: existing.variables,
          category: existing.category,
          tags: existing.tags,
          at: existing.updatedAt,
          revision: existing.revision,
        };
      }
      existing.name = name;
      existing.content = content;
      existing.variables = variables;
      if (!keepCategory) existing.category = category;
      if (!keepTags) existing.tags = tags;
      if (!keepPinned) {
        existing.pinned = pinned;
        existing.pinnedAt = pinned ? now : null;
      }
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
      tags,
      pinned,
      pinnedAt: pinned ? now : null,
    };
    store.snippets.push(record);
    return {
      ok: true,
      changed: true,
      created: true,
      value: { ...view(store).value, snippet: record },
    };
  });

  if (result.ok && historySnapshot) {
    await recordHistory(historyId, historySnapshot);
  }
  return result;
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
            found.ambiguous,
          ).join("\n")}`,
          found.ambiguous[0],
        );
      }
      target = found.snippet;
    }
    if (expectedRevision !== null && target.revision !== expectedRevision) {
      return conflictError(
        "revision",
        `该片段已被他处修改（当前 revision ${target.revision}）。`,
        target,
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
            found.ambiguous,
          ).join("\n")}`,
          found.ambiguous[0],
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
        other,
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
      tags: s.tags || [],
      pinned: s.pinned === true,
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
      tags: normalizeTags(item.tags),
      pinned: item.pinned === true,
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
          exist.tags = item.tags || [];
          exist.pinned = item.pinned === true;
          exist.pinnedAt = item.pinned === true ? now : null;
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
            tags: item.tags || [],
            pinned: item.pinned === true,
            pinnedAt: item.pinned === true ? now : null,
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
 * 严格行尾判定，正文中间的 --cat/--tag/--pin 原样保留。
 *   add <名称> <正文…> --cat=<分类>     → 取分类
 *   add <名称> <正文…> --cat <分类>     → 仅当 --cat 是倒数第二个 token
 *   add <名称> <正文…> --tag=a,b       → 标签（逗号分隔，可多个 --tag）
 *   add <名称> <正文…> --pin           → 收藏置顶
 *   add <名称> <正文…> -- --cat         → "--" 之后全按字面，可写结尾的 --cat
 */
function parseAddArgs(rest) {
  const tokens = rest.slice();
  let category = null;
  let hasCategory = false;
  let tags = [];
  let hasTags = false;
  let pinned = false;
  let hasPinned = false;
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

  // 循环消费行尾选项：--pin 无值，--cat/-c 与 --tag/-t 有值（=或空格）
  let consumed = true;
  while (consumed && head.length > 0) {
    consumed = false;
    const last = head[head.length - 1];
    if (last === "--pin" || last === "-p") {
      pinned = true;
      hasPinned = true;
      head.pop();
      consumed = true;
      continue;
    }
    if (last.startsWith("--cat=") || last.startsWith("-c=")) {
      const eq = last.indexOf("=");
      category = last.slice(eq + 1).trim() || null;
      hasCategory = true;
      head.pop();
      consumed = true;
      continue;
    }
    if (last.startsWith("--tag=") || last.startsWith("-t=")) {
      const eq = last.indexOf("=");
      const v = last.slice(eq + 1).trim();
      if (v) {
        tags = tags.concat(v.split(/[,，、]/).map((t) => t.trim()).filter(Boolean));
        hasTags = true;
      }
      head.pop();
      consumed = true;
      continue;
    }
    // 裸 --cat/-c 结尾：显式清空分类（区别于「正文里的 --cat 原样保留」）
    if (last === "--cat" || last === "-c") {
      category = null;
      hasCategory = true;
      head.pop();
      consumed = true;
      continue;
    }
    // 裸 --tag/-t 结尾：显式清空标签
    if (last === "--tag" || last === "-t") {
      tags = [];
      hasTags = true;
      head.pop();
      consumed = true;
      continue;
    }
    if (head.length >= 2) {
      const prev = head[head.length - 2];
      if (prev === "--cat" || prev === "-c") {
        category = head[head.length - 1].trim() || null;
        hasCategory = true;
        head.length -= 2;
        consumed = true;
        continue;
      }
      if (prev === "--tag" || prev === "-t") {
        const v = head[head.length - 1].trim();
        if (v) {
          tags = tags.concat(v.split(/[,，、]/).map((t) => t.trim()).filter(Boolean));
          hasTags = true;
        }
        head.length -= 2;
        consumed = true;
        continue;
      }
    }
  }

  const contentTokens = tail === null ? head : head.concat(tail);

  if (!hasCategory && !hasTags && !hasPinned) {
    const hit = contentTokens.find(
      (t) =>
        t === "--cat" ||
        t === "-c" ||
        t.startsWith("--cat=") ||
        t.startsWith("-c=") ||
        t === "--tag" ||
        t === "-t" ||
        t.startsWith("--tag=") ||
        t.startsWith("-t=") ||
        t === "--pin" ||
        t === "-p",
    );
    if (hit) {
      notice = `正文里的「${hit}」已按字面保留。要设置分类/标签/收藏请写在行尾（--cat=分类 --tag=标签 --pin），或先用 -- 结束选项。`;
    }
  }

  return {
    name: contentTokens[0] ?? "",
    content: contentTokens.slice(1).join(" "),
    category,
    hasCategory,
    tags: tags.slice(0, MAX_TAGS),
    hasTags,
    pinned,
    hasPinned,
    notice,
  };
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

    case "history": {
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) return fail("bad-request", "需要提供 id");
      const list = await listHistory(id);
      return { ok: true, value: { id, history: list } };
    }

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
      // revealPath（面板「打开」按钮）只想用系统文件管理器打开一个已存在的文件，
      // 不重新落盘、不重新生成内容——否则会覆盖掉用户手工改过的导出文件。
      if (typeof payload?.revealPath === "string" && payload.revealPath.trim() !== "") {
        const p = payload.revealPath.trim();
        const { revealed, revealError } = await revealInFileManager(p);
        return { ok: true, value: { path: p, revealed, revealError: revealError || undefined } };
      }
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
        // 请求方要求打开导出文件所在目录时，用系统默认方式 reveal（Windows: explorer /select；
        // macOS: open -R；Linux: xdg-open 目录）。打开失败只降级不报错——用户仍可凭回传的绝对路径手动定位。
        let revealed = false;
        let revealError = null;
        if (payload.reveal === true) {
          ({ revealed, revealError } = await revealInFileManager(target));
        }
        return {
          ok: true,
          value: {
            json,
            count: device.snippets.length,
            path: target,
            dir: dirname(target),
            revealed,
            revealError: revealError || undefined,
            warning: warnings.join("\n") || undefined,
          },
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
              `读不到导入文件「${target}」：${error instanceof Error ? error.message : String(error)}`,
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
        `未知操作：${String(endpoint)}（host 端可能仍是旧代码，请重启 DSH）`,
      );
  }
}

const ADD_USAGE = "/snippet add <名称> <内容> [--cat=<分类>] [--tag=<标签>] [--pin]";
const USAGE = `${ADD_USAGE} | list | show <名称> | rm <名称|#id> | undo <名称|#id> | mv <名称> <新名称> | pin <名称|#id> | unpin <名称|#id> | tag <名称|#id> <标签…> | optimize <名称> | export [文件名] | import <文件路径> [--replace] [--dry]`;

/** 导出文件名不能带路径分隔符，也不能是 `.`/`..`，避免写出数据目录。 */
/**
 * 用系统默认方式在文件管理器里定位一个已存在的文件。
 * win32 → explorer /select,；darwin → open -R；linux 等 → xdg-open 所在目录。
 * 打开失败只降级（revealed=false + revealError），不抛异常。
 */
async function revealInFileManager(filePath) {
  let revealed = false;
  let revealError = null;
  try {
    const { spawn } = await import("node:child_process");
    let cmd;
    let args;
    if (process.platform === "win32") {
      cmd = "explorer.exe";
      args = [`/select,${filePath}`];
    } else if (process.platform === "darwin") {
      cmd = "open";
      args = ["-R", filePath];
    } else {
      cmd = "xdg-open";
      args = [dirname(filePath)];
    }
    await new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => resolve(true));
      // 文件管理器可能立即退出也可能挂起；500ms 兜底，不阻塞导出结果
      setTimeout(() => resolve(true), 500);
    });
    revealed = true;
  } catch (error) {
    revealError = error instanceof Error ? error.message : String(error);
  }
  return { revealed, revealError };
}

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

  // A 方案流式透传路由：通用 channel 是 unary buffered，无法边生成边回传；
  // 走 connection.fetch 的 /api 精确路由，响应 body 用 ReadableStream 逐 chunk 写回。
  if (ctx.connection && typeof ctx.connection.fetch?.register === "function") {
    ctx.effect(() => ctx.connection.fetch.register({
      path: "/api/prompt-snippets/optimize-stream",
      methods: ["POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        let content = "";
        try {
          const body = await request.json();
          content = typeof body?.content === "string" ? body.content : "";
        } catch (_) {
          /* 空 body 或非 JSON 当空内容处理 */
        }
        if (!content.trim()) {
          return new Response(
            JSON.stringify({ type: "error", code: "bad-request", message: "片段内容不能为空" }) + "\n",
            { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } },
          );
        }
        return optimizeStreamResponse(ctx, content, request.signal);
      },
    }), "prompt-snippets optimize-stream route");
  }

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
      hint: "add <名称> <内容> [--cat=<分类>] [--tag=<标签>] [--pin] | list | show <名称> | rm <名称> | undo <名称> | mv <名称> <新名> | pin <名称> | unpin <名称> | tag <名称> <标签> | optimize <名称> | export [文件名] | import <文件> [--replace] [--dry]",
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
            const tags = Array.isArray(s.tags) && s.tags.length > 0 ? ` (${s.tags.join("、")})` : "";
            const pin = s.pinned ? "★" : "";
            return `${i + 1}. ${pin}${s.name}${s.category ? ` [${s.category}]` : ""}${tags}${varTag}`;
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
          const tagText =
            Array.isArray(s.tags) && s.tags.length > 0 ? `\n标签：${s.tags.join("、")}` : "";
          const pinText = s.pinned ? "（已收藏）" : "";
          const varText =
            vars.length === 0
              ? ""
              : `\n\n变量：\n${vars
                .map(
                  ([k, v]) =>
                    `  {{${k}}}${v.required ? "（必填）" : ""}${typeof v.default === "string" && v.default ? ` 默认「${v.default}」` : ""}${
                      Array.isArray(v.options) ? ` 选项 ${v.options.join(" / ")}` : ""
                    }`,
                )
                .join("\n")}`;
          return {
            kind: "success",
            text: `#${s.id.slice(0, 6)}  ${s.name}${s.category ? ` [${s.category}]` : ""}${pinText}  rev ${s.revision}${tagText}\n\n${s.content}${varText}`,
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
            tags: parsed.tags,
            keepTags: !parsed.hasTags,
            pinned: parsed.pinned,
            keepPinned: !parsed.hasPinned,
          });
          if (!result.ok) return { kind: "error", text: result.error.message };
          const cat = parsed.hasCategory && parsed.category ? `（分类：${parsed.category}）` : "";
          const tag = parsed.hasTags && parsed.tags.length ? `（标签：${parsed.tags.join("、")}）` : "";
          const pin = parsed.hasPinned && parsed.pinned ? "（已收藏）" : "";
          const note = parsed.notice ? `\n提示：${parsed.notice}` : "";
          return {
            kind: "success",
            text: `已${result.created ? "保存" : "更新"}片段「${parsed.name}」${cat}${tag}${pin}。${note}`,
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
                found.ambiguous,
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

        case "pin":
        case "unpin": {
          const ref = rest.join(" ").trim();
          if (!ref) return { kind: "error", text: `用法：/snippet ${verb} <名称|#id>` };
          const { store } = await readAndMigrate();
          const found = resolveRef(alive(store), ref);
          if (found.missing) return { kind: "error", text: `未找到片段「${ref}」。` };
          if (found.ambiguous) {
            return {
              kind: "error",
              text: `有 ${found.ambiguous.length} 个片段都叫「${ref}」，无法确定：\n${candidateList(found.ambiguous).join("\n")}`,
            };
          }
          const target = found.snippet;
          const wantPin = verb === "pin";
          const result = await saveSnippet({
            id: target.id,
            name: target.name,
            content: target.content,
            variables: target.variables,
            keepCategory: true,
            keepTags: true,
            pinned: wantPin,
            keepPinned: false,
            expectedRevision: target.revision,
          });
          if (!result.ok) return { kind: "error", text: result.error.message };
          return {
            kind: "success",
            text: wantPin ? `已收藏「${target.name}」。` : `已取消收藏「${target.name}」。`,
          };
        }

        case "tag": {
          const ref = rest[0];
          const tagText = rest.slice(1).join(" ").trim();
          if (!ref) return { kind: "error", text: "用法：/snippet tag <名称|#id> <标签1,标签2…>" };
          const { store } = await readAndMigrate();
          const found = resolveRef(alive(store), ref);
          if (found.missing) return { kind: "error", text: `未找到片段「${ref}」。` };
          if (found.ambiguous) {
            return {
              kind: "error",
              text: `有 ${found.ambiguous.length} 个片段都叫「${ref}」，无法确定：\n${candidateList(found.ambiguous).join("\n")}`,
            };
          }
          const target = found.snippet;
          const tags = tagText
            ? normalizeTags(tagText.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean))
            : [];
          const result = await saveSnippet({
            id: target.id,
            name: target.name,
            content: target.content,
            variables: target.variables,
            keepCategory: true,
            tags,
            keepTags: false,
            keepPinned: true,
            expectedRevision: target.revision,
          });
          if (!result.ok) return { kind: "error", text: result.error.message };
          return {
            kind: "success",
            text: tags.length > 0 ? `已设置「${target.name}」的标签：${tags.join("、")}。` : `已清空「${target.name}」的标签。`,
          };
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
                found.ambiguous,
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
            signal,
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
