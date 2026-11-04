# 提示词片段库（Prompt Snippets）

[![CI](https://github.com/dadazhangn/dsh-prompt-snippets/actions/workflows/ci.yml/badge.svg)](https://github.com/dadazhangn/dsh-prompt-snippets/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/feature-map.svg" alt="Prompt Snippets 占位符三态填充流程" width="800">
</p>

保存并一键插入可复用的提示词片段，支持分类与 `{{占位符}}`。

一个让「常用提示词」随手可得、不重复造轮子的 DSH 插件。片段数据保存在本机
`<DSH_HOME>/data/prompt-snippets/snippets.json`。默认只存本机、不上传任何内容；
**仅当你主动点击 ✨ AI 优化时，才会把当前那一条片段文本发送给你配置的模型服务**
（用于生成优化建议），除此之外不与网络通信。

## 安装

```bash
dsh plugin --profile web add dsh-prompt-snippets
```

`web` 换成你实际使用的 profile 名即可（本机 profile 在 `~/.dsh/profiles/<名字>`）。
装完重启 DSH，刷新页面，输入框下方会出现「📋 片段库」按钮。

也可以从 GitHub 装（版本由仓库 HEAD 决定，不跟随 npm 发布）：

```bash
dsh plugin --profile web add github:dadazhangn/dsh-prompt-snippets
```

本地源码调试用路径安装：

```bash
dsh plugin --profile web add link:C:/path/to/dsh-prompt-snippets
```

### Install (English)

```bash
dsh plugin --profile web add dsh-prompt-snippets
```

Or install straight from GitHub (`github:dadazhangn/dsh-prompt-snippets`), which
tracks the repository HEAD instead of the published npm version. Then restart DSH
and reload the page.

## 功能

- **保存片段**：`/snippet add <名称> <内容>` 保存一段提示词（同名即更新）。
- **分类**：用 `--cat=<分类>`（或 `-c=<分类>`）指定分类，例如
  `/snippet add 代码审查 请审查以下代码：{{代码}} --cat=开发`；面板按分类分组展示。
  **分类参数只认行尾**：正文中间的 `--cat` 会按字面保留，不会被当成参数吃掉。
  想在正文结尾真的写 `--cat`，用 `--` 结束选项：`/snippet add 说明 结尾是 -- --cat`。
  更新内容时不带 `--cat` 会保留原分类，不会被清空。
- **列出 / 查看 / 删除 / 恢复 / 改名**：`/snippet list`、`/snippet show <名称>`、
  `/snippet rm <名称>`、`/snippet undo <名称>`、`/snippet mv <旧名> <新名>`。
  重名时不会瞎删，会列出候选让你用 `#id前缀` 精确指定。
- **一键插入**：输入框下方「📋 片段库」按钮展开面板，按分类浏览，点击片段即插入当前
  草稿。插入失败（草稿在面板打开期间被改动、或输入框正在提交）会在面板内说明原因。
- **面板内编辑 / 新建**：点 ✏️ 在原行下方展开编辑器，改名称、分类、正文，并直接维护
  变量（必填勾选 + 默认值）；面板底部「＋ 新建」同样在面板内完成创建，全程不用敲命令。
  保存走乐观锁：两个标签同时改同一条时，后保存者看到冲突横幅，可选「覆盖」或
  「重新载入」服务器版本。草稿没保存时点面板外部不会关闭面板，取消也要二次确认。
- **搜索**：按名称、分类、正文实时筛选，打开面板自动聚焦。命中词在名称里高亮标记，
  右侧实时显示 `当前/总数` 命中计数；键盘 `↑` `↓` 移动选中、`Enter` 插入选中项、`Esc` 逐层退出。
  无命中时给出「＋ 新建『搜索词』」按钮，点一下把搜索词预填为新片段名。
- **删除可撤销**：点 🗑 删除后底部出现撤销条，记住最近 5 条，可逐条恢复或一键全部撤销。
- **AI 优化（对比后决定）**：点 ✨ 用当前默认模型改写片段，结果进「原文 / 优化后」双栏对比，
  不直接插入、也不自动落盘。**优化后那一栏可直接编辑**——微调后再决定怎么用。对比视图里给出
  字节数变化与占位符保全标记（丢了哪个 `{{x}}` 会点名，字节数随编辑实时重算），
  按钮为「插入优化版」「替换片段正文」「再试」「保留原文插入」「✕」：
  - 「插入优化版」只进输入框，不动库里的片段；插入的是你编辑后的文本；
  - 「替换片段正文」是**唯一会落盘**的动作，带 `expectedRevision` 乐观锁；冲突时只提供
    「用优化版覆盖（force）」与「放弃」，不做自动合并；
  - 优化结果超长或丢了占位符时「替换片段正文」禁用，`title` 写明原因；把超长部分删短后自动解除；
  - 「再试」最多 3 次，之后置灰；「取消」走 `AbortController`，host 回 `aborted` 时静默收起；
  - 当前未配置默认模型时 ✨ 直接置灰，`title` 说明原因，不会等到点击才报错。
- **`{{占位符}}` 智能填充**：正文里写 `{{主题}}` 之类占位符，点击片段时：
  - 无占位符 → 直接插入；
  - 占位符全部非必填且都有默认值 → 按默认值直接插入，并提示「可在 ✏️ 里改」；
  - 有必填占位符（或旧数据缺变量元数据）→ 弹表单逐项填写，必填为空时「插入」禁用，
    也可选「保留占位符插入」原样插入。

  `\{{字面量}}` 转义后插入的是字面 `{{字面量}}`；同名占位符只问一次，全实例填同一个值。
- **动态变量**：`{{date}}` / `{{time}}` / `{{datetime}}` 是内置宏变量，插入时用本地时间实时
  替换（`date` = `YYYY-MM-DD`、`time` = `HH:mm`、`datetime` = `YYYY-MM-DD HH:mm:ss`），
  不弹表单、也不进变量元数据；正文里只有动态变量的片段点一下即可直插。
- **内置模板包**：首次运行（数据文件尚不存在）自动预置一组高频片段（代码审查、Git 提交信息、
  Bug 排查、周报、日报、翻译润色、会议纪要、学习计划），给你一个冷启动起点。删掉后不重灌，
  已有数据文件（哪怕清空成 0 条）也不会再注入。
- **导入 / 导出**：`/snippet export [文件名]` 把全部片段导出成 JSON，落在
  `<DSH_HOME>/data/prompt-snippets/exports/` 下；`/snippet import <文件路径>` 导回来，
  `--replace` 用文件内容替换现有库（未出现在文件里的片段软删除，仍可 `/snippet undo`），
  `--dry` 只预演不写入。面板底部同样有「⬇ 导出」「⬆ 导入」两个按钮，导入填路径即可
  （面板拿不到宿主文件系统，路径由 host 侧读取；省略目录与 `.json` 后缀时回落到 `exports/`）。
- **深浅色主题跟随**：面板全部使用 DSH 主题 token，浅色 / 深色自动适配，无白底刺眼。
- **窄屏可用**：面板宽度取 `min(340px, 100vw - 16px)`，窗口缩到 320px 也不溢出，
  并会在视口变化后自动拉回可视区。
- **可拖动可记忆**：拖标题栏移动面板，位置记在浏览器本地，下次打开还在原处。
- **可缩放可记忆**：面板四条边和四个角都能拖（像 Windows 窗口），拖边缘调宽高（最小 200×160），
  松手后尺寸记在浏览器本地，下次打开沿用上次大小；缩到超出视口会自动收窄拉回。
- **标签**：`/snippet tag <名称> <标签1、标签2…>` 给片段打标签（逗号/顿号/空格分隔，最多 32 个、
  每个最长 24 字）；`add`/`save` 也能用 `--tag=` 带上。面板里标签以圆角 chip 显示在名称后。
- **收藏置顶**：`/snippet pin <名称>` 收藏、`/snippet unpin <名称>` 取消（`add` 也可 `--pin`）。
  面板顶部有「全部 / ★ 收藏 / 最近使用」三个视图切换按钮，收藏视图只看置顶项，
  最近使用按 `lastUsedAt` 降序、最多 20 条。
- **版本历史**：每次保存前的旧内容自动留档（每片段最多 20 版、单片段历史体积超限丢最旧）。
  面板里点 🕘 展开该片段的历史，可回看历次正文；`/snippet show` 也会显示 revision 号。
- **命令面板（全局快捷唤起）**：任意时刻按 `Ctrl+Shift+K`（或 `Ctrl+Shift+P`）弹出片段搜索
  浮层，输入关键字即时过滤（名称/分类/标签/正文），`↑` `↓` 选择、`Enter` 插入、`Esc` 关闭；
  收藏片段自动置顶，无需先点开 dock 面板。选中后按 `Ctrl+Enter`（Mac `Cmd+Enter`）则是
  **插入并立即发送**；带必填占位符的片段仍需先填表单，无法直接发送。`↑` `↓` 切换选中项时
  列表自动滚动跟随，始终把选中项保持在可视区内。

## 使用

```
/snippet add 代码审查  请审查以下代码并指出问题：{{代码}}
/snippet add 周报  总结本周工作：{{要点}} --cat=写作
/snippet list
/snippet show 周报
/snippet rm 代码审查
/snippet undo 代码审查
/snippet mv 周报 日报
/snippet pin 周报
/snippet tag 周报 工作、总结
/snippet optimize 周报
/snippet export 我的片段
/snippet import 我的片段.json --dry
/snippet import 我的片段.json
```

然后在任意会话里，点击输入框下方的「📋 片段库」→ 点击片段名 → 内容插入草稿。
要改内容或改分类，不必再敲命令：面板里点 ✏️ 直接改，改完点「保存」。

## 数据

- 文件：`<DSH_HOME>/data/prompt-snippets/snippets.json`（DSH_HOME 未设置时为 `~/.dsh`）。
- 结构（`version: 4`）：
  ```json
  {
    "version": 4,
    "snippets": [
      {
        "id": "uuid",
        "name": "名称",
        "category": "分类或 null",
        "content": "正文",
        "variables": { "变量名": { "label": "…", "default": "…", "options": ["…"], "required": false } },
        "tags": ["标签"],
        "pinned": false,
        "pinnedAt": null,
        "createdAt": 0,
        "updatedAt": 0,
        "deletedAt": null,
        "revision": 1,
        "useCount": 0,
        "lastUsedAt": null
      }
    ]
  }
  ```
- **写入是原子的**：先写同目录临时文件 → `fsync` → 轮换 `.bak` → `rename` 覆盖。
  进程中断不会留下半个 JSON，最坏情况是文件停在上一份完整内容。
- **写入是串行的**：并发保存/删除排队执行，不会互相覆盖。
- **每次都留 `.bak`**：`snippets.json.bak` 永远是上一次成功写入的完整 JSON，
  手滑改坏也能逐字节恢复。
- **备份轮换**：`.bak` 写新值前先逐级后移成 `.bak.1` / `.bak.2` … 最多保留 7 份，
  `.bak` 始终是最新一份，更早的历史可回查。
- **损坏自愈**：文件不是合法 JSON 或结构不可识别时，会备份成
  `snippets.corrupt-<时间戳>.json`（最多保留 5 份），插件以空库继续运行并在面板顶部
  提示，不会卡死；第二次读取不会再重复备份。
- **旧版本自动迁移**：`version: 1` / `version: 2` / `version: 3` 的文件在首次读取时补齐
  `id` / `revision` / `variables` / `useCount` / `tags` / `pinned` 等字段并升级到 `version: 4`，
  迁移写入前先把**原始字节**存成 `snippets.json.pre-v4.bak`（一次性，已存在则保留
  更早的那份、不覆盖），原有片段与时间戳保持不变。迁移是幂等的：第二次读取不再写盘。
- **保守处理异常数据**：无法识别的条目会被丢弃并给出 `warning` 计数；重复 `id`
  会被修复；`revision` 非法值归一到 1。
- **不认识的更新版本只读**：文件 `version` 大于插件支持的版本时只读跳过加载，
  原文件一字不改，避免旧插件写坏新数据。
- **删除是软删除**：`deletedAt` 非空即视为已删除，记录仍留在文件里，所以
  `/snippet undo` 能立刻恢复；确实不想要了可以直接编辑该文件清掉。

## 结构

bundle 结构：host 半（`index.js`，命令 + RPC + JSON 存储）、client 半（`client.js`，
输入框 dock 面板 UI）。

```
index.js            host 半：/snippet 命令 + /prompt-snippets RPC + JSON 持久化
client.js           client 半：conversation.composer.dock 面板
package.json        bundle 声明（dsh.bundle.patch + dsh.client + engines.dsh）
cordis.patch.yml    插入 host 半的 loader patch
locale/{en,zh}.json 市场显示名与描述
icon.svg            图标
LICENSE             MIT
test/               测试套件（随仓库分发，不进 npm 包）
.github/workflows   GitHub Actions 自动验证
```

## 兼容性

要求 DSH `>=0.2.1-rc.3`（`package.json` 的 `engines.dsh`）。市场在安装前会按这条
检查宿主版本，不满足时禁用「安装」按钮并说明原因。


## 测试

仓库 `test/` 目录里有一组自测脚本（随仓库分发，不进 npm 包），当前覆盖 **466 条断言**：

| 套件 | 覆盖 |
|---|---|
| `v110-host-test.mjs` | 迁移矩阵与迁移前备份、存储可靠性、双轨匹配、占位符扫描、`--cat` 收口、能力握手、只读保护、标签/收藏/版本历史、首次预置模板包（177） |
| `optimize-test.mjs` | 优化流的分支与降级（14） |
| `io-test.mjs` | 导入/导出命令：落盘、文件名安全、后缀回退、merge/replace/dry、往返一致、同名去重、大小限制、一键打开（78） |
| `client-test.mjs` | 渲染、搜索高亮、命中计数、键盘导航、插入、占位符表单、行内编辑、冲突处理、多条撤销、优化三态对比（含优化后编辑）、导入导出按钮、使用统计 touch、主题 token、窄屏、窗口缩放、标签/收藏/视图切换/版本历史、命令面板、动态变量（191） |
| `client-error-test.mjs` | 插入失败的报错链路（6） |

测试通过 `isolate-home.mjs` 把 `DSH_HOME` 顶到系统临时目录，**绝不读写真实片段库**。

每次 push、发 tag（`v*`）、提 PR 时，GitHub Actions 会自动跑「语法检查 + 这 5 个套件」（见
`.github/workflows/ci.yml`），任何一步失败都会在 PR 上打红叉阻止合并。本地运行：

```bash
npm test
```
