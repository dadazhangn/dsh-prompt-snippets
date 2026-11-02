# 提示词片段库（Prompt Snippets）

保存并一键插入可复用的提示词片段，支持分类与 `{{占位符}}`。

一个让「常用提示词」随手可得、不重复造轮子的 DSH 插件。片段数据保存在本机
`<DSH_HOME>/data/prompt-snippets/snippets.json`，纯本地、无任何网络上传。

## 安装

本仓库根目录就是插件本体，直接从 GitHub 安装：

```bash
dsh plugin --profile web add github:dadazhangn/dsh-prompt-snippets
```

`web` 换成你实际使用的 profile 名即可（本机 profile 在 `~/.dsh/profiles/<名字>`）。
装完重启 DSH，刷新页面，输入框下方会出现「📋 片段库」按钮。

本地源码调试用路径安装：

```bash
dsh plugin --profile web add link:C:/path/to/dsh-prompt-snippets
```

### Install (English)

```bash
dsh plugin --profile web add github:dadazhangn/dsh-prompt-snippets
```

This repository root *is* the plugin bundle; install straight from GitHub with the
command above, then restart DSH and reload the page.

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
- **搜索**：按名称、分类、正文实时筛选，打开面板自动聚焦，`Esc` 清空。
- **删除可撤销**：点 🗑 删除后底部出现撤销条，记住最近 5 条，可逐条恢复或一键全部撤销。
- **AI 优化**：点 ✨ 用当前默认模型改写片段，优化结果插入输入框。
- **`{{占位符}}` 智能填充**：正文里写 `{{主题}}` 之类占位符，点击片段时：
  - 无占位符 → 直接插入；
  - 占位符全部非必填且都有默认值 → 按默认值直接插入，并提示「可在 ✏️ 里改」；
  - 有必填占位符（或旧数据缺变量元数据）→ 弹表单逐项填写，必填为空时「插入」禁用，
    也可选「保留占位符插入」原样插入。

  `\{{字面量}}` 转义后插入的是字面 `{{字面量}}`；同名占位符只问一次，全实例填同一个值。
- **深浅色主题跟随**：面板全部使用 DSH 主题 token，浅色 / 深色自动适配，无白底刺眼。
- **窄屏可用**：面板宽度取 `min(340px, 100vw - 16px)`，窗口缩到 320px 也不溢出，
  并会在视口变化后自动拉回可视区。
- **可拖动可记忆**：拖标题栏移动面板，位置记在浏览器本地，下次打开还在原处。

## 使用

```
/snippet add 代码审查  请审查以下代码并指出问题：{{代码}}
/snippet add 周报  总结本周工作：{{要点}} --cat=写作
/snippet list
/snippet show 周报
/snippet rm 代码审查
/snippet undo 代码审查
/snippet mv 周报 日报
/snippet optimize 周报
```

然后在任意会话里，点击输入框下方的「📋 片段库」→ 点击片段名 → 内容插入草稿。
要改内容或改分类，不必再敲命令：面板里点 ✏️ 直接改，改完点「保存」。

## 数据

- 文件：`<DSH_HOME>/data/prompt-snippets/snippets.json`（DSH_HOME 未设置时为 `~/.dsh`）。
- 结构（`version: 3`）：
  ```json
  {
    "version": 3,
    "snippets": [
      {
        "id": "uuid",
        "name": "名称",
        "category": "分类或 null",
        "content": "正文",
        "variables": { "变量名": { "label": "…", "default": "…", "options": ["…"], "required": false } },
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
- **损坏自愈**：文件不是合法 JSON 或结构不可识别时，会备份成
  `snippets.corrupt-<时间戳>.json`（最多保留 5 份），插件以空库继续运行并在面板顶部
  提示，不会卡死；第二次读取不会再重复备份。
- **旧版本自动迁移**：`version: 1` / `version: 2` 的文件在首次读取时补齐
  `id` / `revision` / `variables` / `useCount` 等字段并升级到 `version: 3`，
  迁移写入前先把**原始字节**存成 `snippets.json.pre-v3.bak`（一次性，已存在则保留
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
package.json        bundle 声明（dsh.bundle.patch + dsh.client）
cordis.patch.yml    插入 host 半的 loader patch
locale/{en,zh}.json 市场显示名与描述
icon.svg            图标
```

## 测试

仓库外的工作区里有一组自测脚本（不随包发布），当前覆盖 **253 条断言**：

| 套件 | 覆盖 |
|---|---|
| `v110-host-test.mjs` | 迁移矩阵与迁移前备份、存储可靠性、双轨匹配、占位符扫描、`--cat` 收口、能力握手（153） |
| `optimize-test.mjs` | 优化流的分支与降级（14） |
| `client-test.mjs` | 渲染、搜索、插入、占位符表单、行内编辑、冲突处理、多条撤销、主题 token、窄屏（80） |
| `client-error-test.mjs` | 插入失败的报错链路（6） |

测试通过 `isolate-home.mjs` 把 `DSH_HOME` 顶到系统临时目录，**绝不读写真实片段库**。
