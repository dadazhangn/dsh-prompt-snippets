# 发布到市场 —— 操作清单

本文件指导你把 `dsh-prompt-snippets` 插件发布到 DSH 插件市场。市场采用
**format 1 索引 JSON**（由 `@deepseek-ai/dsh-plugin-market-index` 校验），
插件本体从 **GitHub 仓库（git source）** 安装。

---

## 一、GitHub 仓库结构

把 `prompt-snippets/` 目录里的文件推到新仓库（仓库名建议 `dsh-prompt-snippets`），
根目录结构应为：

```
dsh-prompt-snippets/
├── index.js             # host 半：/snippet 命令 + RPC 通道 + JSON 存储
├── client.js            # client 半：输入框 dock「📋 片段库」面板
├── package.json         # bundle 声明（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml     # 插入 host 半的 loader patch
├── locale/
│   ├── en.json          # 市场显示名/描述（英文）
│   └── zh.json          # 市场显示名/描述（中文）
├── icon.svg             # 插件图标（64×64）
├── PUBLISH.md           # 本发布清单
└── README.md            # 使用说明
```

> 注意：`package.json` 里 `name` 已统一为 `dsh-prompt-snippets`（不是 `@local/...`），
> 与 `cordis.patch.yml`、`client.js` 的 `window.__ModuleLoader__.load` id 三者一致。

> **市场索引 JSON 不随插件仓库一起分发**：`market-index.json` 是市场侧元数据，
> 已分离到 `../market-submission/` 目录。安装器只读 `source.url + commit`，
> checkout 后读 `package.json`，从不读仓库里的 market-index.json；把它放进仓库
> 反而会造成「填了 commit 再提交、SHA 又变」的死循环。因此仓库里**只含纯插件本体**。

---

## 二、市场索引（已生成，位于 `../market-submission/`）

`market-index.json` 已经生成并通过 format 1 权威校验（复刻官方
`parseMarketIndex` 全部规则逐条验证），**无需再填占位**——它已含：

1. **仓库 URL**：`https://github.com/dadazhangn/dsh-prompt-snippets`
2. **commit SHA**：`80ecacd85c78201aa2354ac39c33f336c03ecc4c`（**v1.0.0 代码提交**，已推送；
   该提交的 `package.json` version 为 `1.0.0`，与索引条目一致）
3. **publishTimestamp**：`1793090155`（Unix 秒）

> ⚠️ SHA 选取规则：市场索引的 `commit` 必须指向**与 `version` 对应的代码提交**，
> 不能随便取 `master` 的 HEAD。当前 `master` 的 HEAD 是 `a8d4097`（纯文档提交），
> 若把索引指向它，安装出来的仍是 `version: 1.0.0` 的包，但版本记录会误导。
>
> **v1.1.0 尚未发布**：本地工作区有未提交的 v1.1 改动（`index.js` / `client.js` /
> `README.md` / `ROADMAP.md` / `package.json`）。按既定原则，等 PR #9994 合并后
> 再 commit + push + 升版本，届时索引需新增一条 `1.1.0` 版本记录
> （`commit` 换成新的 40 位 SHA，`publishTimestamp` 换成当时的 Unix 秒）。

---

## 三、安装方式（对最终用户）

市场安装器会根据 `source` 字段生成安装参数（见
`marketInstallTarget`，`@deepseek-ai/dsh-plugin-market-index`）：

- 本次为 **git source**，最终安装 spec 形如：
  ```
  git+https://github.com/USERNAME/dsh-prompt-snippets.git#<40-hex-commit>
  ```
- 若插件放在仓库子目录（monorepo），在 `source` 加 `"path": "子目录"`，
  安装器会自动追加 `&path:/子目录`。

本地验证安装（推到 GitHub 前可先用本地目录）：

```
dsh plugin --profile web add link:/绝对路径/dsh-prompt-snippets
```

> 注意：**仓库根目录就是插件本体**，没有 `prompt-snippets/` 子目录。
> 所以 `dsh plugin add ./prompt-snippets` 这类写法会失败；路径必须直接指到含
> `package.json` 的那一层。

---

## 四、市场索引 JSON 校验要点（format 1）

生成/修改后建议自检（关键规则已逐条对照 `parseMarketIndex` 源码）：

- 顶层 `format` 必须是 `1`；`title` 必须含 `en`（我们用了 `{en, zh}`）。
- `plugins` 非空，`name` 唯一、符合 npm 包名规则（`dsh-prompt-snippets` ✓）。
- `versions` 非空，`version` 精确 SemVer（当前 `1.1.0`），同插件版本不重复。
- `publishTimestamp` 为 Unix 秒整数，范围 `[0, 10^11)`（`1793090155` ✓）。
- **git source**：`url` 必须 https、canonical、至少两段 path、非 tarball；
  `commit` 必须 40 位小写 hex。
- `engines.dsh` 必须合法 SemVer range（`>=0.2.1-rc.3` ✓，基于当前 DSH
  版本 `0.2.1-rc.3`；禁止 `workspace:` 前缀）。
- `icon` 用 data URL 时仅支持 SVG/PNG/JPEG/WebP base64，解码后 ≤32 KiB
  （我们的 icon 内联 base64，远小于上限 ✓）。
- `repository.url` 必须 http/https，无 query/fragment；`homepage` 同理。
- 索引里声明的 `category` 必须在顶层 `metadata.categories` 里预先声明
  （我们声明了 `productivity`、`prompting`，plugin 用 `prompting` ✓）。
- **`publishTimestamp` 只用于排序展示**，不参与安装解析；但 `versions` 数组需按时间递增，
  新版本追加在末尾，旧版本不要删（用户可能锁在旧版本上）。

---

## 五、发布步骤（按顺序）

### v1.0.0（已发布，PR #9994）

1. 本地验证：`dsh plugin --profile web add link:/绝对路径/dsh-prompt-snippets`，
   重启/刷新页面，输入框下方应出现「📋 片段库」；`/snippet add`、`/snippet list` 往返正常。
2. 建 GitHub 仓库 `dsh-prompt-snippets`，把上面结构的所有文件（纯插件本体）推上去。
3. 确认线上 HEAD 与本地一致后，`../market-submission/market-index.json` 里的
   commit SHA 即为有效值（不一致则用 `git rev-parse HEAD` 更新）。
4. 把 `../market-submission/market-index.json` 提交给市场维护方（或按市场约定
   的提交流程挂到指定位置），由其合入市场索引。

### v1.1.0（本地就绪，等 PR #9994 合并后执行）

> 前置条件：PR #9994 被合并。此前**不 commit、不 push、不升版本**，
> 避免与维护者的审阅基线冲突。

1. `node --check index.js && node --check client.js` 两文件通过。
2. 跑全量测试（四套件 **253 条**）全绿，且真实 `snippets.json` 的
   `LastWriteTime` 前后不变。
3. `git add -A && git commit -m "feat: v1.1.0 数据可靠性 + 面板内编辑 + 占位符表单"`。
4. `git push origin master`，`git rev-parse HEAD` 取新 SHA。
5. 更新 `../market-submission/market-index.json`：在 `versions` 数组末尾追加
   ```json
   { "version": "1.1.0", "publishTimestamp": <当前 Unix 秒>,
     "source": { "type": "git", "url": "https://github.com/dadazhangn/dsh-prompt-snippets",
                 "commit": "<新 40 位 SHA>" },
     "engines": { "dsh": ">=0.2.1-rc.3" } }
   ```
6. 提交索引更新给市场维护方。

### 可选（不影响发布）

- 在 `package.json` 增补 `"author"`、`"license"`、`"homepage"` 等元数据，
  并补一份 `LICENSE`（若补，需同步加进 `package.json` 的 `files` 与仓库）。

---

## 六、当前插件文件清单（v1.1.0）

| 文件 | 说明 |
|---|---|
| `index.js` | host 半（1347 行）：`/snippet add·list·show·rm·undo·mv·optimize` 七个命令 + `/prompt-snippets` RPC（10 个端点）+ 本机 JSON 持久化（原子写、fsync、串行队列、损坏自愈、v1/v2→v3 迁移含 pre-v3 备份） |
| `client.js` | client 半（1357 行）：`conversation.composer.dock` 注册「📋 片段库」面板，含分类分组、搜索、行内编辑/新建、冲突横幅、占位符表单、最近 5 条撤销、主题 token、窄屏自适应 |
| `package.json` | bundle 声明（`dsh.bundle.patch` + `dsh.client`），version `1.1.0` |
| `cordis.patch.yml` | 插入 host 半的 loader patch |
| `locale/{en,zh}.json` | 市场显示名/描述 |
| `icon.svg` | 图标 |
| `README.md` | 使用说明 |
| `ROADMAP.md` | 技术路线（v1.1 详细设计 + v1.2/1.3/2.0 概要） |
| `PUBLISH.md` | 发布清单（本文件） |
| `../market-submission/market-index.json` | 市场索引（独立于仓库，不随包分发） |

### 命令一览

```
/snippet add <名称> <内容> [--cat=<分类>]   保存或更新
/snippet list                              列出全部（按分类分组）
/snippet show <名称|#id前缀>                查看正文与变量
/snippet rm <名称|#id前缀>                  软删除（可撤销）
/snippet undo <名称|#id前缀>                恢复软删除
/snippet mv <旧名> <新名>                    改名
/snippet optimize <名称>                    用默认模型优化（结果显示在对话）
```

`--cat` / `-c` **只认行尾**：正文中间的 `--cat` 按字面保留；要在正文结尾真的写
`--cat`，用 `--` 终止符（`/snippet add 说明 结尾是 -- --cat`）。
