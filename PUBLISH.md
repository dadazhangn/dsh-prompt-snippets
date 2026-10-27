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
├── market-index.json    # 市场索引（见下，待填真实 URL/commit）
├── LICENSE              # 建议 MIT
└── README.md            # 使用说明
```

> 注意：`package.json` 里 `name` 已统一为 `dsh-prompt-snippets`（不是 `@local/...`），
> 与 `cordis.patch.yml`、`client.js` 的 `window.__ModuleLoader__.load` id 三者一致。

---

## 二、发布前必改的 3 处占位

`market-index.json` 里有两类占位，发布前必须替换：

1. **仓库 URL（3 处）**：`https://github.com/USERNAME/dsh-prompt-snippets`
   —— 替换 `USERNAME` 为你的 GitHub 用户名；若仓库名不同，也一并改。
2. **commit SHA（1 处）**：`"commit": "0000000000000000000000000000000000000000"`
   —— 推送到 GitHub 后，用 `git rev-parse HEAD` 得到 40 位小写 hex SHA 填进去。
3. **publishTimestamp**：`market-index.json` 里 `publishTimestamp` 已填
   `1793089211`（对应 2026-10-27 附近）。若之后重新发布，更新为发布时刻的
   Unix 秒整数。

### 一次性替换命令（Linux/macOS 或 Git Bash）

```bash
USER=你的GitHub用户名
SHA=$(git rev-parse HEAD)
sed -i "s|USERNAME|$USER|g" market-index.json
sed -i "s|0000000000000000000000000000000000000000|$SHA|" market-index.json
```

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
dsh plugin install ./prompt-snippets
```

---

## 四、市场索引 JSON 校验要点（format 1）

生成/修改后建议自检（关键规则已逐条对照 `parseMarketIndex` 源码）：

- 顶层 `format` 必须是 `1`；`title` 必须含 `en`（我们用了 `{en, zh}`）。
- `plugins` 非空，`name` 唯一、符合 npm 包名规则（`dsh-prompt-snippets` ✓）。
- `versions` 非空，`version` 精确 SemVer（`1.0.0` ✓），同插件版本不重复。
- `publishTimestamp` 为 Unix 秒整数，范围 `[0, 10^11)`（`1793089211` ✓）。
- **git source**：`url` 必须 https、canonical、至少两段 path、非 tarball；
  `commit` 必须 40 位小写 hex。
- `engines.dsh` 必须合法 SemVer range（`>=0.2.1-rc.3` ✓，基于当前 DSH
  版本 `0.2.1-rc.3`；禁止 `workspace:` 前缀）。
- `icon` 用 data URL 时仅支持 SVG/PNG/JPEG/WebP base64，解码后 ≤32 KiB
  （我们的 icon 内联 base64，远小于上限 ✓）。
- `repository.url` 必须 http/https，无 query/fragment；`homepage` 同理。
- 索引里声明的 `category` 必须在顶层 `metadata.categories` 里预先声明
  （我们声明了 `productivity`、`prompting`，plugin 用 `prompting` ✓）。

---

## 五、发布步骤（按顺序）

1. 本地验证：`dsh plugin install ./prompt-snippets`，重启/刷新页面，
   输入框下方应出现「📋 片段库」；`/snippet add`、`/snippet list` 往返正常。
2. 建 GitHub 仓库，推送上面结构的所有文件。
3. 记录 commit SHA，替换 `market-index.json` 里的占位（见第二节）。
4. 把最终的 `market-index.json` 提交给市场维护方（或按市场约定的提交流程
   挂到指定位置），由其合入市场索引。
5. （可选）在 `package.json` 增补 `"author"`、`"license"`、`"homepage"` 等元数据，
   并补一份 `LICENSE`。

---

## 六、当前插件文件清单（已就绪）

| 文件 | 说明 |
|---|---|
| `index.js` | host 半：`/snippet add|list|rm` 命令 + `/prompt-snippets` RPC（list/save/delete）+ 本机 JSON 持久化 |
| `client.js` | client 半：`conversation.composer.dock` 注册「📋 片段库」面板，`inputActions.captureInsertion()+insertText` 一键插入 |
| `package.json` | bundle 声明（`dsh.bundle.patch` + `dsh.client`） |
| `cordis.patch.yml` | 插入 host 半的 loader patch |
| `locale/{en,zh}.json` | 市场显示名/描述 |
| `icon.svg` | 图标 |
| `README.md` | 使用说明 |
| `market-index.json` | 市场索引（含占位，待填真实 URL/commit） |

`/snippet add <名称> <内容> [--cat <分类>]` 已支持分类（`--cat`/`-c`），
面板按分类分组展示。
