# Changelog

本文件记录 `dsh-prompt-snippets` 每个发布版本的用户可见变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.4.0] - 2026-11-06

### 新增

- **AI 优化流式透传**：点击 ✨ 优化后，对比视图会实时显示模型逐段生成的内容，不再全程静止、最后一次性蹦出。底层从一次性的 RPC 调用改为走 `/api/prompt-snippets/optimize-stream` 流式接口（NDJSON），生成进度即时可见。
- **AI 优化提速（maxTokens 自适应）**：优化请求的 `maxTokens` 从固定 2000 改为按输入长度自适应（短输入 600 / 中等 900 / 长输入 1200 封顶），减少模型扩写冗长输出的倾向，明显加快生成。

### 修复

- **片段库按钮位置**：按钮从输入框卡片下方的独立一行（`conversation.composer.dock`）改挂到输入框工具条（`conversation.input.right`，与权限控件、模型选择器同排），修复 Claude 样式等主题下按钮消失或孤行的问题（#5、#6）。
- **窄窗口按钮撑高**：工具条按钮加 `flex: none` + 文字不折行，窄窗口下不再被压缩折行撑高。
- **收藏置顶复选框字号**：显式声明字号，不再继承会话字体放大一号（#2）。

### 工程化

- **i18n 接入平台 locale 服务**：client 端全部硬编码文案接入 DSH 官方 locale（`ctx.locale.register/bind/subscribe`），随平台语言切换。
- **ESLint 门禁**：新增 ESLint 8 配置与 `npm run lint`，并在 CI 中强制执行。
- **CI Windows 矩阵**：GitHub Actions 增加 `windows-latest` runner，覆盖目标用户主平台。
- **README 徽章与措辞**：补充 npm version / downloads / License 徽章，同步按钮位置描述。

## [1.3.1] - 2026-11-04

### 修复

- Gemini review 8 处问题修复。
- 命令面板快捷键、滚动跟随、插入并发送等细节修正。

## [1.3.0] - 2026-11-03

### 新增

- 标签 / 收藏 / 最近使用。
- 版本历史（每片段保留最近 20 版）。
- 命令面板（Ctrl+Shift+K）。
- 动态变量（date / time / datetime）。
- 内置模板包冷启动。
- README 功能示意图。

## [1.2.0] - 2026-11-03

### 新增

- AI 优化闭环（三态对比视图：原文 / 优化后 / 覆盖或插入）。
- 搜索增强。
- 导入导出。
- 数据可靠性补丁。
- 窗口缩放。

## [1.1.0] - 2026-11-02

### 新增

- 数据可靠性（原子写 / .bak 轮换 / 损坏自愈 / 旧版本迁移）。
- 面板内编辑。
- 占位符表单（必填 / 默认值 / 枚举下拉）。
- 主题适配（浅色 / 深色）。

## [1.0.0] - 2026-10-27

### 新增

- `/snippet` 命令（保存 / 列出 / 查看 / 删除 / 恢复 / 改名）。
- 侧栏一键插入。
