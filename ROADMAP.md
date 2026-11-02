# dsh-prompt-snippets 技术路线

> 版本基线：`1.1.0`（工作区未提交，`index.js` 1347 行 / `client.js` 1357 行）
> 本文所有结论基于实读源码与实跑测试，非估算。
> 优先级已按评审意见调整：数据可靠性在功能之前，「面板内编辑/删除」与「占位符」同步进 v1.1，
> 「优化闭环」提前到 v1.2 首位，「使用次数」改为延迟批量写。

---

## 零、对评审意见的采纳与取舍

| 评审意见 | 处理 | 理由 / 落地方式 |
|---|---|---|
| P0：加 revision | **采纳** | 每片段一个单调递增整数，写操作走 `expectedRevision` 乐观锁；RPC 冲突返 `conflict` |
| P0：迁移测试 | **采纳** | 建 v1→v2→v3 三级迁移测试矩阵，含脏数据（缺 id、id 重复、时间戳非数字、content 非字符串） |
| P0：备份文件 | **采纳** | 保留最近一份 `snippets.json.bak`；损坏文件改为 `rename` 而非「复制后清空」 |
| P0：明确 ID 与名称匹配 | **采纳** | RPC/面板只用 `id`；命令按名称解析后转成 `id`；重名一律报歧义 + 列候选 |
| P1：面板内编辑/删除移入 v1.1 | **采纳** | 编辑做成内联表单；删除沿用已有软删除 + 撤销条 |
| P1：优化闭环提前 | **采纳（放 v1.2 首位）** | 优化结果进「对比视图」，用户接受/拒绝/再试，不再直接覆盖输入框 |
| P2：搜索保留 | **采纳** | 搜索已实现，v1.2 只补「高亮 + 命中计数 + ↑↓ 选择」 |
| P3：使用次数延迟写 | **采纳** | 内存累加，`timer.debounce` 5s 或累计 20 次后一次性落盘；进程退出前 flush |
| `--cat` 只认行尾 | **采纳（更严格）** | 只认行尾 `--cat=分类` 或行尾 `--cat 分类`；正文中间的 `--cat` 原样保留 |

**一条反向建议**：不引入 `variables` 之外的行内语法（不用 `{{x:type=enum}}` 这类内嵌 DSL）。
变量约束全部放片段元数据，正文只保留 `{{名}}` 与转义 `\{{`。理由见 §3.3。

---

## 一、版本节奏总览

| 版本 | 主题 | 阻断发布 | 预估 |
|---|---|---|---|
| **v1.1** | 数据骨架 + 面板编辑器 + 占位符 + 主题适配 | 是（首个可推荐版本） | 3.5 人日 |
| **v1.2** | 优化闭环 + 搜索增强 + 导入导出 + `--cat` 收口 | 是（体验完整） | 2.5 人日 |
| **v1.3** | 标签 / 收藏 / 最近使用 / 版本历史 / 自动备份轮换 | 否 | 3 人日 |
| **v1.4** | 可选加密的单机跨设备同步 | 否 | 4 人日 |
| **v2.0** | 团队共享 / 权限 / 审计 | 否 | 8 人日 |

依赖关系：v1.1 的数据模型（v3）是后续全部版本的地基，`revision` 与 `variables` 必须在 v1.1 定型，否则 v1.4 同步会推翻重做。

---

## 二、v1.1 详细设计

### 2.1 数据模型 v3

```jsonc
{
  "version": 3,
  "snippets": [
    {
      "id": "9f1c…",              // uuid v4，主键，永不变更
      "name": "代码审查",           // 显示名，活跃集合内唯一
      "category": "开发",          // string | null
      "content": "请审查以下代码：{{代码}}\n关注点：{{关注点}}",
      "variables": {               // 新增；键 = 正文里出现的变量名
        "代码":  { "label": "代码",  "required": true,  "default": "" },
        "关注点": { "label": "关注点", "required": false, "default": "正确性、边界、命名",
                   "options": ["正确性、边界、命名", "性能", "可读性"] }
      },
      "createdAt": 1793351927993,
      "updatedAt": 1793351927993,
      "revision": 7,               // 新增；每次内容级变更 +1，从 1 起
      "deletedAt": null,           // 非空 = 软删除（保留以支持 undo）
      "useCount": 0,               // 新增；延迟批量写
      "lastUsedAt": null           // 新增；ms，延迟批量写
    }
  ]
}
```

**字段语义约束**

| 字段 | 约束 | 违反时 |
|---|---|---|
| `id` | 非空字符串，全库唯一 | 迁移期重新生成；运行期 `save` 返 `bad-request` |
| `name` | 1–120 字符，活跃集合内唯一 | `save` 返 `conflict` 并给出占用的 id |
| `content` | ≤200 000 字符 | `bad-request` |
| `revision` | 整数 ≥1 | 缺失按 1 补齐 |
| `variables` | 键必须是 `content` 中出现过的变量名 | 多余键静默丢弃并记 warning |
| `useCount` | 整数 ≥0 | 缺失按 0 |

**为什么 `revision` 放片段级而不是全库级**：面板是「一条片段一个编辑表单」，
冲突粒度天然是片段级。全库级 revision 会让两个人在不同片段上编辑也互相冲突，
在 v1.4 同步场景下不可用。

### 2.2 ID / 名称双轨匹配

```
        ┌──────────────────────────────────────────┐
        │  RPC / 面板 UI    →  一律用 id             │
        │  命令 / 文本输入   →  名称解析成 id 再操作   │
        └──────────────────────────────────────────┘
```

**解析器（host 侧单一实现，命令与 RPC 共用）**

```js
// resolveRef(store, ref) → 结果三态
{ kind: "id",       snippet }              // ref 命中 id
{ kind: "name",     snippet }              // 名称唯一命中
{ kind: "missing" }
{ kind: "ambiguous", candidates: [{ id, name, category, deletedAt }] }
```

**歧义处理规格（强制）**

- `/snippet rm 周报` 遇到 3 个同名 → **不删任何一个**，返回：
  ```
  有 3 个片段都叫「周报」，未执行删除。请指定其中一个：
    1. #a1b2c3  周报 [写作]
    2. #d4e5f6  周报 [开发]
    3. #789abc  周报 (已删除)
  用法：/snippet rm #a1b2c3
  ```
- `#<id 前 6 位>` 前缀匹配：命中唯一则执行，命中多个则同样报歧义并列出。
- `/snippet add <名称> …` 遇到同名活跃片段 → 沿用「更新」语义但**要求唯一**；
  若同名多于一个，报 `conflict`，提示改用 `/snippet edit #xxxxxx`。
- 已删除片段的名称不参与活跃集合的唯一性判断（见下）。
- 恢复（`undo`）时若目标名称已被新片段占用 → 报 `conflict`，提示先重命名，
  不自动加 `(2)` 后缀（自动改名会让用户找不到东西）。

**唯一性范围**：只在「活跃集合」内唯一。允许「已删除的周报」与「活跃的周报」并存，
否则删了再建同名片段会永远失败。

### 2.3 存储可靠性（P0 核心）

**当前实现的两个真实缺陷**

```js
// index.js:132-142 现状
async function quarantine(raw) {
  const target = dataPath(`snippets.corrupt-${Date.now()}.json`);
  await writeFile(target, raw, "utf8");
  await writeFile(dataPath("snippets.json"), JSON.stringify(emptyStore(), null, 2), "utf8"); // ← 缺陷 1
}
```

1. **复制后覆盖原文件**：万一 `writeFile(target)` 只写了一半就失败，
   原文件已被覆盖成空库，现场彻底丢失。
2. **无 fsync**：`writeFile` 返回只代表进了内核页缓存，
   随后 `rename` 在断电时可能指向一个内容为空的 inode。
3. **无 `.bak`**：`rename` 覆盖旧文件后，旧内容即刻不可恢复。

**目标实现**

```js
async function persist(store) {
  await mkdir(dataPath(), { recursive: true });
  const final = dataPath("snippets.json");
  const tmp   = dataPath(`snippets.${process.pid}.${Date.now()}.tmp`);
  const bak   = dataPath("snippets.json.bak");

  // 1. 写临时文件并真正落盘
  const fh = await open(tmp, "w");
  try {
    await fh.writeFile(JSON.stringify(store, null, 2), "utf8");
    await fh.sync();                       // ← fsync，防断电留空 inode
  } finally {
    await fh.close();
  }

  // 2. 轮换 .bak（只保留最近一份；失败不阻断主写入）
  try { await copyFile(final, bak); } catch (error) {
    if (error.code !== "ENOENT") { /* 记 warning，不抛 */ }
  }

  // 3. 原子替换
  try { await rename(tmp, final); }
  catch (error) { await unlink(tmp).catch(() => {}); throw error; }
}
```

```js
// 损坏隔离：改为 rename，永不覆盖原字节
async function quarantine() {
  const final  = dataPath("snippets.json");
  const target = dataPath(`snippets.corrupt-${Date.now()}.json`);
  try {
    await rename(final, target);           // ← 原字节 100% 完整搬到备份名
    return target;
  } catch (_) {
    return null;                           // 备份失败也要让主流程继续
  }
}
```

`rename` 之后 `snippets.json` 不存在，下次读取走 `ENOENT → 空库` 分支，
所以既保住了原始字节，又不会反复隔离出无数份备份。

**读取时的降级阶梯**

| 状况 | 行为 | 用户可见 |
|---|---|---|
| 主文件正常 | 正常读取 | — |
| 主文件 ENOENT | 空库 | 无提示（首次使用） |
| 主文件 JSON 非法 | `rename` 到 `.corrupt-<ts>`，空库 + warning | 面板顶部黄条 |
| 主文件结构非法（非对象 / `snippets` 非数组） | 同上 | 同上 |
| 主文件 EACCES / EIO | 抛错，不隔离（避免把权限问题误判成损坏） | 面板红字 + `restore` 提示 |
| 主文件正常但单条记录非法 | 丢弃该条，其余保留 | warning 列出丢弃条数 |

注意最后一行：**单条坏数据不应该让整库进隔离**。当前 `migrate()` 已经是逐条跳过，
只需要把「跳过了几条」透出成 warning。

**并发**：沿用现有 `withLock` 串行队列。补充一条：`optimize` 不落盘，
不进队列；只有 `save`/`delete`/`restore`/`purge`/`touch` 进队列。

### 2.4 面板内编辑 / 删除

**交互形态**（不做弹窗，做行内展开，避免遮住输入框）

```
┌─ 📋 片段库 ───────────────────── × ─┐
│ 🔍 搜索…                             │
├──────────────────────────────────────┤
│ 开发                                  │
│  代码审查            ✏️  🗑            │
│  周报                ✏️  🗑            │
│  ▼ 代码审查                     [保存] │   ← 展开编辑
│   ┌────────────────────────────────┐ │
│   │ 名称  [代码审查              ] │ │
│   │ 分类  [开发                  ] │ │
│   │ 正文  [请审查以下代码：      ] │ │
│   │       [{{代码}}              ] │ │
│   │ 变量  {{代码}}  必填 ☑ 默认[ ] │ │
│   │       {{关注点}} 默认[正确性] │ │
│   └────────────────────────────────┘ │
├──────────────────────────────────────┤
│ ＋ 新建                              │
└──────────────────────────────────────┘
│ 已删除「周报」            [撤销]      │
└──────────────────────────────────────┘
```

**状态机**

```
idle ──点✏️──→ editing(draft, originalRevision)
editing ──点保存──→ saving ──ok──→ idle（列表刷新，toast「已保存」）
editing ──点保存──→ conflict（横幅：该片段已被他处修改）
conflict ──选「覆盖」──→ saving（带 forceRevision）
conflict ──选「重新载入」──→ editing（draft 丢弃）
editing ──点取消──→ 若 draft 脏，二次确认
editing ──外部点击──→ 不关闭（防误触丢草稿），只允许 ✕/取消退出
```

**变量编辑器**：从正文正则扫出 `{{x}}` 集合，与 `variables` 求并集，
新增变量给默认空定义；正文里删掉的变量在保存时从 `variables` 移除。

**删除**：沿用已实现的软删除 + 底部撤销条，不新增交互，
只把「撤销条只记住最后一条」改成「记住最近 5 条，可逐条撤销或全部撤销」。

> 状态归属：以上全部 UI 状态都在 `SnippetDock` 组件的 `useState` 里，
> 不引入额外 store，不新增 client 服务依赖。

### 2.5 占位符表单

**语法与转义（唯一权威定义）**

| 输入 | 输出 | 说明 |
|---|---|---|
| `{{标题}}` | 变量 | 变量名允许 `[\p{L}\p{N}_-]{1,40}` |
| `\{{标题}}` | 字面量 `{{标题}}` | 反斜杠转义，反斜杠本身不输出 |
| `\\{{标题}}` | `\` + 变量 | 两个反斜杠 = 一个转义后的反斜杠 + 变量 |
| `{{ }}` / `{{}}` | 原样保留 | 名称不合法，不视为变量 |
| `{{{x}}}` | `{` + 变量 + `}` | 贪婪左界，按最内层匹配 |

实现用单趟扫描而非全局正则替换，避免 `\\{{` 这类组合被正则回溯吃掉：

```js
const VAR_NAME = /^[\p{L}\p{N}_-]{1,40}$/u;
function scanPlaceholders(content) {
  // 返回 { tokens: [{kind:'text'|'var'|'escape', ...}], names: string[] }
}
function render(tokens, values) { /* 未填且非必填 → 用 default；必填为空 → 抛 */ }
```

**表单触发规则**

| 片段情况 | 点击行为 |
|---|---|
| 无 `{{…}}` | 直接插入（保持现有体验） |
| 有变量且全部非必填、都有 default | 直接按 default 插入，插入后 toast「已用默认值填充，可在 ✏️ 里改」 |
| 有必填变量 | 弹表单，必填项空则「插入」按钮禁用 |
| 有变量但无 `variables` 元数据（旧数据） | 弹表单，全部按「非必填、无默认」处理 |

**「同名变量只问一次」**：变量集合按键去重（首次出现顺序），
表单每个键只渲染一个输入框，渲染时全部实例填同一个值。

**插入后光标位置**：表单填完 → `render()` 出最终纯文本 → 一次
`inputActions.insertText(text, span)`。因为是一次插入，光标自然落在末尾，
不存在「定位到第 N 个变量」的需求，也就不需要 `selection` 操控 API。
若用户选「保留占位符插入」，插入原文，光标同样在末尾。

> 这一条是对评审意见的收敛：不做「插入后跳到下一个占位符」。
> 理由是 `insertText` 只接受纯文本 + span，不提供光标搬运，
> 而硬做需要操作 contenteditable 内部选区，属于会随上游改版失效的私有操作。

### 2.6 主题适配（深浅色 + 窄屏）

**当前问题是硬编码浅色**：`background:"#ffffff"` / `color:"#1f2328"` / `border:"1px solid #d0d7de"`，
共 17 处十六进制色值，深色主题下会白底刺眼。

**方案：全部换成 DSH 主题 token**（已通过 `client Theme.listTokens` 核实存在）

| 用途 | token |
|---|---|
| 面板底 | `var(--dsw-alias-bg-overlay)` |
| 次级面（撤销条、搜索区） | `var(--dsw-alias-bg-layer-2)` |
| 边框 | `var(--dsw-alias-border-l1)` / 强调用 `--dsw-alias-border-l2` |
| 主文字 | `var(--dsw-alias-label-primary)` |
| 次文字 | `var(--dsw-alias-label-secondary)` |
| 危险（删除） | `var(--dsw-alias-state-error-primary)` |
| 警告条 | `var(--dsw-alias-state-warn-primary)` |
| 成功 | `var(--dsw-alias-state-success-primary)` |
| 高亮/选中 | `var(--dsw-alias-brand-primary)` |

不需要监听 `theme/change`：token 是 CSS 变量，系统主题切换时浏览器自动重算，
内联样式写 `var(...)` 即可跟随。只有一处例外——画在 `<canvas>` 或需要
JS 读色值的地方才要监听，本项目没有。

**窄屏**：`width` 从固定 `340px` 改为
`min(340px, calc(100vw - 16px))`，`maxHeight` 改 `min(440px, calc(100vh - 24px))`，
`clampPos()` 已有边界裁剪，只需把常量换成读取 `window.innerWidth/Height`。

### 2.7 `--cat` 歧义收口

**现状缺陷**：`index.js:432-451` 扫描**所有位置**的 `--cat`/`-c`，
所以 `/snippet add 说明 用法是 --cat 空格 分类` 会把正文里的 `--cat` 当参数吃掉。

**新规则（严格行尾）**

```
/snippet add <名称> <正文…> --cat=<分类>     ← 优先，无歧义
/snippet add <名称> <正文…> --cat <分类>     ← 仅当 --cat 是倒数第二个 token
/snippet add <名称> <正文…> -c=<分类>        ← 同上
```

判定顺序：

1. 若最后一个 token 形如 `--cat=X` / `-c=X` → 取出 X 作分类，从正文移除该 token。
2. 否则若倒数第二个 token 恰为 `--cat` / `-c` → 最后一个 token 作分类。
3. 其他一切位置的 `--cat` / `-c` **保持原样**，作为正文的一部分。
4. 取出的分类为空串 → 视为「显式清空分类」，不是「未提供」。

要表达「正文结尾确实要写 `--cat`」，用 `--` 终止符：
`/snippet add 说明 结尾是 -- --cat`。

**兼容性**：旧的「任意位置」写法会变成正文的一部分，属于行为变更，
需在 README 迁移说明里明确列出，并在命令解析时若检测到正文中出现
`--cat`（非行尾）追加一行提示：「正文里的 `--cat` 已按字面保留；
要设置分类请写在行尾或使用 `--cat=`」。

### 2.8 v1.1 RPC 契约（定稿）

通道 `POST /prompt-snippets/<endpoint>`，envelope 沿用现有
`{type:"client-request", rpcId, method, payload}`，返回
`{ok:true, value}` / `{ok:false, error:{code, message, details}}`。

| endpoint | payload | value | 进锁 | 错误码 |
|---|---|---|---|---|
| `capabilities` | `{}` | `{protocol, storeVersion, endpoints[], channel}` | 否 | — |
| `list` | `{}` | `{version, snippets[], warning?}` | 是（可能迁移） | `internal` |
| `get` | `{id}` | `{snippet, warning?}` | 否 | `bad-request` `not-found` |
| `save` | `{id?, name, category?, keepCategory?, content, variables?, expectedRevision?, force?, ref?}` | `{snippet, created}` | 是 | `bad-request` `conflict` `not-found` |
| `delete` | `{id?\|ref?, expectedRevision?}` | `{snippets[]}` | 是 | `not-found` `conflict` |
| `restore` | `{id?\|ref?, expectedRevision?}` | `{snippets[]}` | 是 | `not-found` `conflict` |
| `optimize` | `{content}` 或 `{id}` | `{optimized, original}` | 否 | `bad-request` `unavailable` `aborted` `internal` |
| `touch` | `{ids[]}` | `{}` | 是（合并队列） | — |
| `export` | `{ids?}` | `{json, count, warning?}` | 是（可能迁移） | `internal` |
| `import` | `{json, mode?:"merge"\|"replace", dryRun?}` | `{plan:{added,updated,skipped,conflicts[],dropped}, version, snippets[], dryRun?}` | 是 | `bad-request` |

> 10 个端点全部已实现（`index.js:1082` `dispatch()` 的 switch 逐条落地，`ENDPOINTS` 常量与之同源）。
> `capabilities` 是 client 半的握手前置：client 启动时用它确认 host 不是旧代码，
> 避免「面板存在但端点缺失」时给出莫名其妙的报错。
> 上表 `payload` 列已按实现对 `delete`/`restore` 补上 `ref`（名称或 `#id前缀` 双轨），
> 对 `save` 补上 `keepCategory`（更新时不带 `category` 则保留原分类）与 `ref`。
>
> **`export` / `import` 是 v1.2 的 host 侧预置**：后端逻辑（`buildExport` L910、
> `importSnippets` L966，含 `merge`/`replace` 与 `dryRun`）已实现并有用例，
> 但**尚未接任何命令或面板按钮**——这是 §3.3 的 UI 接线活，不算 v1.1 交付范围。
> 好处是 v1.2 只需补 UI，不用再动存储层。

**`save` 的 id 语义**

| 传入 | 行为 |
|---|---|
| 无 `id` | 新建。名称若被活跃片段占用 → `conflict`（附占用者 id） |
| 有 `id` 且存在 | 更新。`expectedRevision` 不匹配 → `conflict`（附当前 revision）；`force:true` 跳过检查 |
| 有 `id` 但不存在 | `not-found`（不静默新建，防止 id 打错变成脏数据） |
| 有 `id` 且已软删除 | `conflict`，提示先 `restore` |

**`conflict` 错误的 `details` 统一形状**：

```jsonc
{ "conflict": "revision" | "name" | "deleted",
  "current": { "id": "…", "revision": 9, "name": "周报" } }
```

客户端据此决定弹「覆盖/重载」还是「改名」。

### 2.9 v1.1 验收标准

> 状态图例：`[x]` 已实现并有用例覆盖；`[ ]` 未实现或仅靠人工验证。

**已交付（本机 client-test.mjs 80 条 + v110-host-test.mjs 153 条覆盖）**

- [x] 数据 v2 → v3 迁移零丢失，`revision` 全部补齐且从 1 起
- [x] 迁移写入前生成 `snippets.json.pre-v3.bak`，内容是**原始字节**；已有该备份时不被覆盖
- [x] 存在 `.bak`，且 `.bak` 内容 = 上一次成功写入的完整 JSON
- [x] 两个浏览器标签同时编辑同一片段 → 后保存者收到 `conflict` 横幅，选「覆盖」后成功
- [x] 造 3 条同名「周报」→ `/snippet rm 周报` 不删除任何一条，列出 3 个候选
- [x] 面板内新建 / 编辑 / 删除 / 撤销 全流程可用，无需打开命令行
- [x] 含 `{{代码}}` 的片段点击后弹表单，必填为空时「插入」禁用
- [x] `\{{标题}}` 插入后输出字面量 `{{标题}}`
- [x] 深色主题下无白底块，所有边框可见
- [x] 窗口宽 320px 时面板不溢出，可完整操作
- [x] `/snippet add 说明 用法是 --cat 空格 分类` → 正文完整保留 `--cat`
- [x] `/snippet add 周报 内容 --cat=写作` → 分类为「写作」

**待人工验证（测试装置无法覆盖：需要真实进程崩溃 / 真实浏览器）**

- [ ] 手动把 `snippets.json` 写坏 → 重启后面板出黄条，备份文件字节与原文件**逐字节相同**（`fc /b` 比对通过）
- [ ] 断电模拟（写入中途 kill）→ 文件要么是旧内容要么是新内容，无半截 JSON

---

## 三、v1.2 详细设计

### 3.1 优化闭环（本版首位）

**现状问题**：`optimize` 只有两条路——命令把结果打到对话里（不可用），
或面板 ✨ 直接把结果覆盖进输入框（用户无法比较、无法拒绝、原文已丢）。

**目标**：三态对比视图。

```
┌─ ✨ 优化：代码审查 ──────────────── × ─┐
│ 原文                   优化后          │
│ ┌──────────────┐ ┌──────────────┐    │
│ │ 请审查以下   │ │ 你是资深代码 │    │
│ │ 代码：       │ │ 审查员。请逐 │    │
│ │ {{代码}}     │ │ 行审查：     │    │
│ │              │ │ {{代码}}     │    │
│ └──────────────┘ └──────────────┘    │
│ 字节 42 → 118  占位符 {{代码}} 已保留 ✓│
├──────────────────────────────────────┤
│ [插入优化版]  [替换片段正文]  [再试]  │
│ [保留原文插入]                    ✕   │
└──────────────────────────────────────┘
```

**关键约束**

- 优化**不落盘**。`optimize` 只返回 `{optimized, original}`，落盘只发生在
  用户点「替换片段正文」→ 走 `save` 带 `expectedRevision`。
- **占位符保全校验**：`optimize` 与客户端各做一次。host 侧在返回前比对
  `scanPlaceholders(original).names` 与 `scanPlaceholders(optimized).names`，
  缺任何一个 → `internal`「优化结果丢失了占位符 `{{x}}`，请再试」。
  现有 `OPTIMIZE_SYSTEM` 第 3 条已要求保留，但提示词不保证，必须代码校验。
- **超长截断**：`optimized` 超过 `MAX_CONTENT` → 不报错，返回并标记
  `truncated:true`，客户端「替换正文」按钮禁用并说明原因。
- **再试**：客户端保留原始 `content`，点「再试」重新调 `optimize`（非累积），
  最多 3 次后按钮禁用并提示「已重试 3 次」。
- **取消**：`optimize` 在 host 侧走 `llm.stream({signal})`，
  面板 ✕ 触发 `AbortController.abort()` → host 返 `aborted`，客户端静默。
- **无模型降级**：`ctx.get("llm")` 或 `currentSelection()` 为空时，
  ✨ 按钮置灰并 `title` 说明「当前未配置默认模型」，不留到点击才报错。

**「替换片段正文」的 revision 风险**：优化期间别处可能改过该片段。
点击「替换」时若 `expectedRevision` 已过期 → 弹 `conflict`，选项：
「用我的优化版覆盖（force）」/「放弃」——不提供「合并」，合并两段自然语言没有正确解。

### 3.2 搜索增强

| 项 | 规格 |
|---|---|
| 高亮 | 命中片段在名称/分类/正文里用 `<mark>` 等价的背景色（`--dsw-alias-brand-primary` 20% 透明）标出 |
| 命中计数 | 搜索框右侧 `3/12` |
| 键盘 | `↑↓` 在结果间移动选中，`Enter` 插入选中，`Esc` 清空（已有），再 `Esc` 关闭 |
| 空态 | 「没有匹配『xx』的片段」+「新建这个片段」快捷按钮（带入搜索词作名称） |
| 性能 | 片段 <2000 条时纯前端过滤足够；超过则先在 host 侧 `list` 返回精简索引（不含 content），按需 `get` |

最后一行是给 v2.0 团队场景留的口子，v1.2 不实现，只确保 `list` 的返回形状
允许后续加 `fields` 参数。

### 3.3 导入 / 导出

| endpoint | payload | 说明 |
|---|---|---|
| `export` | `{ids?: string[]}` | 无 `ids` = 全量活跃片段；返回 `{json, count}`。`json` 是 v3 结构的子集，不含 `id`（导出用名称标识，导入时重新分配 id） |
| `import` | `{json, mode: "merge"\|"replace", dryRun?}` | `merge` 跳过同名；`replace` 清空后导入；`dryRun:true` 只返回将发生的变化 |

**`dryRun` 的返回形状**（面板据此画确认框）：

```jsonc
{ "added": 12, "updated": 3, "skipped": 2, "conflicts": [{ "name": "周报", "reason": "name" }] }
```

**不导出 `useCount` / `lastUsedAt`** —— 这两个是本地使用统计，跨设备合并没有意义。
**不导出 `deletedAt`** —— 导出「当前视图」，不含垃圾桶。

### 3.4 `--cat` 收口后的文档与提示（见 §2.7）

---

## 四、v1.3 / v1.4 / v2.0 概要

### 4.1 v1.3 组织与可追溯

| 功能 | 数据变更 | 备注 |
|---|---|---|
| 标签 | `tags: string[]` | 与 `category` 并存：分类是单选层级，标签是多选切面 |
| 收藏 | `pinned: boolean` + `pinnedAt` | 面板顶部独立分区，不参与分类分组 |
| 最近使用 | `useCount` / `lastUsedAt` 改为真数据（延迟写） + 派生「最近 10 条」视图 | 不新增字段，用已有两个 |
| 版本历史 | 新增 `snippets.history/<id>.json`，保留最近 20 版 `{revision, content, variables, at}` | 与主库分离，避免主库膨胀；体积上限 2MB/片段，超了丢最旧 |
| 备份轮换 | `snippets.json.bak.1..7`，每次成功写后轮转，保留 7 天 | 只保留 `.bak` 一份的话，连坏两次就带不动 |

**使用次数的延迟写细则**

```js
// host 侧
let pending = new Map();          // id → { delta, lastAt }
const flush = debounce(async () => { /* 一次事务写回 */ }, 5000);

function touch(ids) {
  for (const id of ids) {
    const cur = pending.get(id) ?? { delta: 0, lastAt: 0 };
    cur.delta += 1; cur.lastAt = Date.now();
    pending.set(id, cur);
  }
  if (pending.size >= 20) flushNow(); else flush();
}
```

进程退出 flush：`ctx.effect(() => () => { flushNow(); })`。
最坏情况丢 5 秒统计，可接受（评审要求正是「不怕丢几次计数，怕的是每次插入都写盘」）。

### 4.2 v1.4 同步（单机跨设备）

- 存储改为可切换后端：`file`（默认）| `webdav`（可选）
- 加密：`age`-style 对称加密（`crypto.scrypt` 派生 + `aes-256-gcm`），
  口令**不落盘**，只存 salt + 校验块；每次启动输入一次，会话内缓存
- 冲突：以 `(id, revision)` 为向量，两边独立递增，冲突时保留双版本让用户选
- 明确不做：自动后台轮询（改成手动「同步」按钮 + 退出前提示）
- 明确不做：服务端。用户自带 WebDAV 地址与凭据，凭据走 `ctx.credentials`

### 4.3 v2.0 团队

- 权限模型：`owner` / `editor` / `viewer`，作用域 = 片段集合
- 审计：`snippets.audit.log` 追加写，记录 `{at, actor, action, id, before, after}`
- 共享：导出为签名包（Ed25519），导入方验签
- 这一版需要 host 侧鉴权，`ctx.connection.admit()` 拿到 `peer.principal` 才有身份，
  是本项目唯一需要改 `dsh.client.inject` 与 RPC 授权的版本

---

## 五、迁移矩阵

| 起点 | 目标 | 动作 | 幂等 | 回滚 |
|---|---|---|---|---|
| 无文件 | v3 | 空库 | 是 | 删文件 |
| v1（无 id / 无 deletedAt） | v3 | 补 `id`（uuid）、`deletedAt:null`、`revision:1`、`variables:{}`、`useCount:0` | 是 | 从 `.bak` 还原（v1 不会被覆盖，先备份再迁移） |
| v2（有 id / 有 deletedAt） | v3 | 补 `revision:1`、`variables:{}`、`useCount:0` | 是 | 同上 |
| v3 | v3 | 逐条补缺失字段（局部修复） | 是 | — |
| 未知更高版本（用户降级） | — | **拒绝加载并保留原文件**，warning 提示「数据来自更新版本」 | — | 无需 |

**迁移必须遵守的两条硬规则**

1. 迁移前先 `persist` 一份当前内容到 `snippets.json.pre-v3.bak`（一次性）。
2. 迁移写回只在「确实有字段变化」时发生（沿用现有 `needsMigration` 思路，
   扩展到检查 `revision` / `variables` / `useCount`）。

**迁移测试矩阵**（P0 要求）

| 用例 | 断言 |
|---|---|
| v1 两片段（真实生产数据副本） | 迁移后片段数、名称、正文、`createdAt` 全不变；`id` 非空且唯一 |
| v1 里某条缺 `name` | 该条被丢弃，warning 报「丢弃 1 条」 |
| v1 里某条 `content` 是数字 | 该条被丢弃，其余保留 |
| v2 里两条 `id` 相同 | 保留第一条，第二条重新分配 id，warning 报「修复 1 条重复 id」 |
| v2 里 `deletedAt` 是字符串 `"0"` | 归一为 `null`（非数字一律视为未删除） |
| v3 里 `revision` 是 `0` 或负数 | 归一为 1 |
| v3 里 `variables` 有正文中不存在的键 | 丢弃该键，warning |
| 未来版本 `version: 9` | 拒绝加载，原文件不动，面板红字 |
| 迁移过程被 kill（文件已写一半） | 下次启动读到 `.bak`，数据回退到迁移前，不丢片段 |
| 连续迁移两次 | 第二次不产生任何写入（幂等） |

---

## 六、测试矩阵总览

**计划与实际落地**：v1.1 原计划拆成 8 个套件（167 条），实际按「host 一体 / 优化流 / client 正向 / client 错误链」四个套件落地，共 **253 条全通**。拆分维度合并但覆盖面不减——host 侧的 storage/migrate/resolve/placeholder/command 五组都以分组形式存在于同一个套件内。

| 计划套件 | 计划数 | 实际落点 | 实际数 |
|---|---|---|---|
| `host-crud-test` | 38 | `v110-host-test.mjs` | 归入 153 |
| `storage-test` | 26 | `v110-host-test.mjs` | 归入 153 |
| `migrate-test` | 10 | `v110-host-test.mjs` §2.x（含 pre-v3 备份 5 条边界） | 归入 153 |
| `resolve-test` | 18 | `v110-host-test.mjs` | 归入 153 |
| `placeholder-test` | 22 | `v110-host-test.mjs` + `client-test.mjs` 表单组 | 归入两套 |
| `command-test` | 20 | `v110-host-test.mjs` `--cat` 收口组 | 归入 153 |
| `client-render-test` | 30 | `client-test.mjs`（扩到覆盖编辑态/冲突态/变量表单/撤销条/空态） | 80 |
| `client-theme-test` | 3 | `client-test.mjs` token 静态审计组 | 归入 80 |
| （新增） | — | `optimize-test.mjs` 优化流分支与降级 | 14 |
| （新增） | — | `client-error-test.mjs` 插入失败报错链路 | 6 |
| **合计** | **167** | | **253** |

四套件：`v110-host-test` 153 · `optimize-test` 14 · `client-test` 80 · `client-error-test` 6。

现有 99 个 v1.0 用例全部保留为回归基线（并入 `v110-host-test`）。

**主题测试的做法**（无需真实浏览器）：
`client.js` 源码里断言硬编码色值匹配数为 0，
且 `style` 表里每个颜色字段都包含 `var(--dsw-`。另有行为断言：
hover/次级面由 `--dsw-alias-label-primary` 经 `color-mix` 派生（而非 `bg-layer-2`，
浅色下 layer-1 与 layer-2 同为 `#ffffff`，用它做 hover 会零反馈），
不重复声明滚动条规则（避免与 ui-theme 的 `scrollbar-color` 打架）。
这套静态 + 行为断言足以防住「改样式时手滑写回硬编码色」的回归。

---

## 七、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `insertText` 的 `draftRev` 在面板打开期间频繁变化 | 插入失败率高 | 已改为透传返回值 + 面板内提示；进一步在表单确认时重新 `captureInsertion()`（即每次插入前现取 span，不复用打开面板时的那份） |
| 上游改 `conversation.composer.dock` 的 props | 面板拿不到 `inputActions` | slot 组件内做 `inputActions == null` 防御，缺失时按钮置灰 + 提示，而不是抛错白屏 |
| 上游改 `ctx.connection.register` 签名 | 全插件失效 | 启动时 `typeof ctx.connection.register === "function"` 守卫，失败在面板显示明确错误；已在注里记下为什么不用 `rpc.handle()` |
| 变量名与 Markdown / 代码块冲突 | 正文里 `{{` 被误判 | 转义规则已定义；再补一条：三反引号代码块内的 `{{x}}` **仍然**按变量处理（用户可能就要在代码模板里插值），但表单里标记为「位于代码块内」 |
| `.bak` 与 `.corrupt-*` 无限增长 | 磁盘占用 | `.corrupt-*` 只保留最近 5 份；`.bak` v1.3 起轮换 7 份 |
| 大片段（200KB）渲染卡顿 | 面板卡 | 列表只渲染名称+分类；正文只在编辑态渲染，且超过 20KB 用 `<textarea>` 而非受控实时预览 |

---

## 八、工作量拆分

| 版本 | 模块 | 人日 |
|---|---|---|
| v1.1 | 数据模型 v3 + 迁移 + 迁移测试 | 0.8 |
| v1.1 | 存储可靠性（fsync/`.bak`/隔离改 rename） | 0.5 |
| v1.1 | 双轨匹配 + 歧义/冲突错误码 + RPC 改造 | 0.7 |
| v1.1 | 面板编辑/新建/冲突横幅 | 0.8 |
| v1.1 | 占位符扫描 + 表单 | 0.5 |
| v1.1 | 主题 token + 窄屏 + `--cat` 收口 | 0.2 |
| **v1.1 合计** | | **3.5** |
| v1.2 | 优化闭环（对比视图 + 占位符保全校验 + 取消/重试） | 1.2 |
| v1.2 | 搜索增强 | 0.4 |
| v1.2 | 导入导出（含 dryRun） | 0.7 |
| v1.2 | 文档与商店条目更新 | 0.2 |
| **v1.2 合计** | | **2.5** |

---

## 九、发布闸口

每个版本必须同时满足才推：

1. `node --check` 两个文件通过；`package.json` 可解析
2. 全量测试通过且用例数只增不减
3. 真实 `snippets.json` 副本上跑一遍迁移，`diff` 确认只多不少
4. 面板在深色/浅色/320px 三态下各截图一次人工确认
5. `README.md` 的安装命令与 `package.json` 的 `private` 状态一致
   （维护者上轮拒审就是因为这两处不一致）
6. 升 `version`（行为变更升 minor，纯修复升 patch），
   同步 `market-index.json` 的 `version` / `commit` / `publishTimestamp`

---

## 十、与当前工作区状态的衔接

| 项 | v1.1 前现状 | 当前实际状态 |
|---|---|---|
| `package.json` | `version: 1.1.0`、`private: true` | 保持 `private: true`（走 git source 安装）；`version` 仍 `1.1.0`，**等 PR #9994 合并后才升 `1.2.0`** |
| `index.js` | 515 行，v2 存储，无 revision（预计重写到 ~780 行） | **1347 行**，v3 存储、revision、pre-v3 备份、`--cat` 行尾收口、optimize/export/import 全部就位 |
| `client.js` | 523 行，浅色硬编码，无编辑态（预计重写到 ~900 行） | **1357 行**，主题 token、行内编辑、冲突横幅、占位符表单、最近 5 条撤销、窄屏自适应全部就位 |
| 测试 | 99 条 | **253 条全通**（153 + 14 + 80 + 6），真实数据零接触 |
| 仓库状态 | 工作区有 5 个文件未提交，HEAD = `a8d4097` | 仍在本地未提交，HEAD 不变 |
| PR #9994 | `open` / `held: author` / head `56de478` | 仍待维护者重审 |

> 按既定原则：本路线全部为**本地实施**，PR 合并前不 commit、不 push。
> 上表「当前实际状态」两栏的行数为实测值（`Get-Content | Measure`），非估算。
>
> **v1.1 完成度**：§2.1–§2.7 全部落地，§2.9 验收 14 条中 12 条已由自动化用例覆盖，
> 余 2 条（真实进程崩溃 / 断电模拟）需人工验证。§2.8 RPC 契约按设计实现，
> 通道 `POST /prompt-snippets/<endpoint>`，10 个 endpoint 全部可用。
