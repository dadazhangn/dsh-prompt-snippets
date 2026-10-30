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

- **保存片段**：用 `/snippet add <名称> <内容>` 保存一段提示词（同名即更新）。
- **分类**：保存时用 `--cat <分类>`（或 `-c`）指定分类，例如
  `/snippet add 代码审查 请审查以下代码：{{代码}} --cat 开发`；面板会按分类分组展示。
- **列出 / 删除**：`/snippet list` 查看全部；`/snippet rm <名称>` 删除。
- **一键插入**：在输入框下方的「📋 片段库」按钮展开面板，按分类浏览，点击片段
  即可把它插入当前输入框草稿。
- **`{{占位符}}`**：片段文本里可直接写 `{{主题}}` 之类占位符，插入后自行替换。

## 使用

```
/snippet add 代码审查  请审查以下代码并指出问题：{{代码}}
/snippet add 周报  总结本周工作：{{要点}} --cat 写作
/snippet list
/snippet rm 代码审查
```

然后在任意会话里，点击输入框下方的「📋 片段库」→ 点击片段名 → 内容插入草稿。

## 数据

- 文件：`<DSH_HOME>/data/prompt-snippets/snippets.json`（DSH_HOME 未设置时为 `~/.dsh`）。
- 结构：`{ "version": 1, "snippets": [{ "id", "name", "category", "content", "createdAt", "updatedAt" }] }`

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
