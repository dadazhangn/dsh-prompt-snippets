# DSH 提示词片段库

[English](README.md)

**别再反复重写常用提示词。** 保存一次，填写每次不同的信息，然后一键插入 DSH 输入框。

Prompt Snippets 是为 [DeepSeek Harness（DSH）](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提供的本地提示词库。你可以用分类、标签和收藏整理提示词，用 `{{占位符}}` 填入项目相关内容，也可以从可搜索面板或快捷键快速找到片段。

> **提示词保存在本机。** 片段存放在 DSH 本地数据目录。只有你主动使用「AI 优化」时，所选片段才会发送给 DSH 配置的模型服务。

## 三步开始

1. 保存提示词，例如：`审查这段 {{语言}} 代码中的错误：{{代码}}`。
2. 搜索并点击需要的片段。
3. 填写变量，完整提示词就会插入输入框。

面板可以直接浏览、编辑和整理片段，不用离开当前对话。也可以随时按 **Ctrl+Shift+K**（或 **Ctrl+Shift+P**）打开快捷搜索。

按 **↑/↓** 选择片段，按 **Enter** 打开占位符表单；在表单中按 **Tab / Shift+Tab** 切换字段，按 **Ctrl+Enter** 插入并发送，按 **Esc** 关闭。必填项未填写时，按 **Ctrl+Enter** 会聚焦到第一个待填写项。

## 安装

### 从 DSH 插件商店安装

在 [awesome-dsh-plugin 插件目录](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 搜索 **Prompt Snippets**。商店条目指向 GitHub 仓库，安装的是仓库版本。

### 使用 DSH 安装

从 npm 安装已发布版本：

```bash
dsh plugin --profile web add dsh-prompt-snippets
```

将 `web` 换成你使用的 profile。安装后重启 DSH 并刷新页面，输入框工具栏中会出现 **📋 片段库** 按钮。

### 从 GitHub 安装

直接安装仓库中的最新代码：

```bash
dsh plugin --profile web add github:dadazhangn/dsh-prompt-snippets
```

GitHub 安装跟随仓库版本；npm 安装跟随已发布的 npm 版本。本地开发时可以用 `dsh plugin --profile web add link:C:/path/to/dsh-prompt-snippets` 安装本地检出目录。

**环境要求：** DSH `>=0.2.1-rc.3`。

## 快速试用

创建一个代码审查提示词。`/snippet add` 会把第一个词作为名称，多词名称请用连字符连接：

```text
/snippet add 代码审查-安全 审查这段 {{语言}} 代码中的错误和安全问题：{{代码}} --cat=开发
```

然后点击输入框旁边的 **📋 片段库**，选择「代码审查-安全」，填写 `语言` 和 `代码`，完整内容就会插入输入框。也可以直接在面板中新建或编辑片段；面板创建支持带空格的名称。

常用命令：

| 命令 | 用途 |
|---|---|
| `/snippet list` | 列出已保存的片段 |
| `/snippet add <名称> <内容>` | 新建或更新片段 |
| `/snippet show <名称>` | 查看片段和版本号 |
| `/snippet pin <名称或 ID>` | 收藏并置顶 |
| `/snippet tag <名称或 ID> <标签>` | 添加可搜索标签 |
| `/snippet optimize <名称>` | 生成可检查的 AI 改写稿 |
| `/snippet export [文件名]` | 导出为 JSON |
| `/snippet import <文件>` | 从 JSON 导入 |

将剩余输入作为名称的命令支持带空格名称。`/snippet add` 和 `/snippet tag` 会把第一个词作为名称；命令行操作时请用单词、连字符或下划线。也可以在面板里创建带空格的名称。名称冲突时命令会列出候选项供你选择。

## 它能帮你做什么

- **更快找到提示词。** 按名称、分类、标签或正文搜索；使用片段库面板或全局快捷面板；收藏项优先显示。
- **用模板填入变化内容。** 使用 `{{变量}}`，插入时填写内容；支持默认值、必填项、下拉选项，以及 `{{date}}`、`{{time}}`、`{{datetime}}`。
- **整理并复用好用的提示词。** 添加分类和标签、收藏置顶、按最近使用排序，并查看旧版本。
- **由你决定是否采用 AI 改写。** 查看原文和改写稿、编辑结果，再选择插入或替换保存内容；不会自动覆盖原文。
- **备份和迁移自己的片段库。** 支持 JSON 导入导出；数据在本机保存，并带原子写入与备份恢复。

## AI 优化

「AI 优化」是可选功能，使用 DSH 中配置的默认模型。模型逐步生成的改写内容会显示在对比视图中；在你选择操作前，原片段保持不变。

- **插入优化版**：将检查后的文本插入输入框，不修改片段库。
- **替换片段正文**：保存检查后的文本。如果结果不完整、超过长度限制或丢失原有占位符，此操作会被禁用。
- **再试**：重新生成一份改写稿；生成后仍可编辑再决定如何使用。

只有你主动开始优化时，所选片段才会发送到配置的模型服务。其他片段库操作不会把正文发送到外部服务。

## 数据与恢复

片段库存放在 `<DSH_HOME>/data/prompt-snippets/snippets.json`。未设置 `DSH_HOME` 时使用 `~/.dsh`。

写入通过临时文件和原子替换完成，并轮换保留 `.bak` 备份；损坏的数据会另存恢复副本。删除可以撤销，每条片段最多保留 20 个旧版本。导入支持合并、替换和预演模式。

## 参与项目

欢迎提交问题反馈、功能建议和 Pull Request。反馈问题时请附上 DSH 版本和复现步骤。

本地运行检查：

```bash
npm ci
npm test
npm run lint
```

测试使用临时 `DSH_HOME`，不会读取或修改你的真实片段库。

如果 Prompt Snippets 帮你节省了时间，欢迎[给仓库点个 Star](https://github.com/dadazhangn/dsh-prompt-snippets)，或推荐给其他 DSH 用户。

## 许可

MIT，详见 [LICENSE](LICENSE)。
