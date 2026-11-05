window.__ModuleLoader__.load({
  id: "dsh-prompt-snippets",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

    // ── i18n：字典命名空间与文案表 ──
    // 接入 DSH 官方 locale 服务（ctx.locale.register/bind/subscribe），
    // 语言切换时通过 subscribe 触发重渲染。测试环境无 locale 服务时降级到 zh。
    const NS = "prompt-snippets";
    const zh = {
      "error.unknown": "未知错误",
      "error.readFailed": "读取失败",
      "error.sendFailed": "发送失败：请确认输入框里有内容再试。",
      "error.insertFailed": "插入失败：请先把光标放进输入框再试。",
      "error.insertFailedDraft": "插入失败：请先把光标放进输入框再试（草稿可能在面板打开期间被改动）。",
      "error.optimizeFailed": "优化失败",
      "error.noModel": "当前未配置默认模型，无法优化",
      "error.exportFailed": "导出失败",
      "error.importFailed": "导入失败",
      "error.deleteFailed": "删除失败",
      "error.restoreFailed": "恢复失败",
      "error.saveFailed": "保存失败",
      "error.nameEmpty": "片段名称不能为空。",
      "error.reloadFailed": "重新载入失败：该片段可能已被删除。",
      "error.replaceFailed": "替换失败",
      "error.conflict": "该片段已被他处修改",
      "error.importPathEmpty": "请填写要导入的 JSON 文件路径。",
      "notice.defaultsFilled": "已用默认值填充，可在 ✏️ 里改",
      "notice.saved": "已保存",
      "notice.created": "已新建",
      "notice.loadedLatest": "已载入服务器上的最新版本。",
      "notice.imported": "导入 {added} 条{skipped}{updated}",
      "notice.importedSkipped": "，跳过 {n}",
      "notice.importedUpdated": "，更新 {n}",
      "notice.historyInserted": "已插入旧版内容",
      "edit.confirmDiscard": "草稿还没保存，再点一次「确认放弃」才会丢弃。",
      "edit.overwrite": "覆盖",
      "edit.reload": "重新载入",
      "edit.name": "名称",
      "edit.namePlaceholder": "片段名称",
      "edit.category": "分类",
      "edit.categoryPlaceholder": "留空表示不分类",
      "edit.tags": "标签（逗号分隔）",
      "edit.tagsPlaceholder": "如：代码、常用、审查",
      "edit.pinned": "收藏置顶",
      "edit.content": "正文（用 {{变量名}} 标记占位符，\{{ 输出字面量）",
      "edit.variables": "变量",
      "edit.required": "必填",
      "edit.defaultPlaceholder": "默认值（可空）",
      "edit.enumPlaceholder": "选项（逗号/顿号分隔，可空）",
      "edit.enumTitle": "填了选项后，插入时会变成下拉框，用户只能从这些选项里选",
      "edit.cancel": "取消",
      "edit.confirmCancel": "确认放弃",
      "edit.saving": "保存中…",
      "edit.save": "保存",
      "fill.requiredSuffix": " · 必填",
      "fill.empty": "（不填）",
      "fill.cancel": "取消",
      "fill.keepRaw": "保留占位符插入",
      "fill.insert": "插入",
      "review.overLong": "优化结果超过单条片段上限，请先精简",
      "review.replacePrompt": "把片段正文替换成优化后的版本",
      "review.original": "原文",
      "review.optimized": "优化后",
      "review.optimizedEditable": "优化后（可编辑）",
      "review.generating": "生成中…",
      "review.stopping": "正在取消…",
      "review.empty": "（空）",
      "review.overLongWarning": "⚠ 超出长度上限",
      "review.applyOverwrite": "用优化版覆盖",
      "review.discard": "放弃",
      "review.keepOriginal": "保留原文插入",
      "review.keepOriginalTitle": "不采用优化结果，插入原始片段",
      "review.cancelOptimize": "取消这次优化",
      "review.close": "关闭对比视图",
      "review.cancelling": "取消中…",
      "review.cancel": "取消",
      "review.retryTitle": "重新生成一次（不累积）",
      "review.retryMaxTitle": "已重试 {n} 次",
      "review.retry": "再试",
      "review.replacing": "替换中…",
      "review.replaceContent": "替换片段正文",
      "review.insertOptimized": "插入优化版",
      "review.insertOptimizedTitle": "把优化后的文本插入输入框",
      "item.insertTitle": "点击插入\n\n{content}",
      "item.edit": "编辑",
      "item.editReadonly": "片段库处于只读状态，禁止编辑",
      "item.history": "查看历史版本",
      "item.optimize": "AI 优化（对比后决定）",
      "item.noModel": "当前未配置默认模型",
      "item.delete": "删除（可撤销）",
      "item.deleteReadonly": "片段库处于只读状态，禁止删除",
      "palette.searchPlaceholder": "搜索片段（名称 / 分类 / 标签 / 内容）…",
      "palette.empty": "还没有片段，点 dock 的「＋ 新建」保存一个。",
      "palette.noMatch": "没有匹配「{query}」的片段。",
      "palette.noCategory": "（无分类）",
      "palette.hint": "↑↓ 选择 · Enter 插入 · Ctrl+Enter 插入并发送 · Esc 关闭 · Ctrl+Shift+K 唤起",
      "history.loading": "加载中…",
      "history.empty": "暂无历史版本（每次保存前的内容会留档，最多 20 版）",
      "history.insertTitle": "把这一版的内容插入输入框",
      "history.insert": "插入旧版",
      "panel.empty": "还没有片段。点下面的「＋ 新建」或 /snippet add <名称> <内容> 保存一个。",
      "panel.newFromQuery": "＋ 新建「{query}」",
      "panel.new": "＋ 新建片段",
      "panel.newTitle": "把搜索词作为新片段名称",
      "panel.title": "提示词片段库",
      "panel.button": "📋 片段库",
      "panel.ariaLabel": "片段库",
      "panel.resizeHeight": "拖动调整高度",
      "panel.resizeWidth": "拖动调整宽度",
      "panel.resizeSize": "拖动调整大小",
      "panel.dragTitle": "拖动标题栏可移动面板",
      "panel.close": "关闭",
      "panel.closeAria": "关闭片段库",
      "panel.searchPlaceholder": "搜索名称 / 分类 / 内容…",
      "panel.all": "全部",
      "panel.pinned": "★ 收藏",
      "panel.pinnedTitle": "只看收藏置顶的片段",
      "panel.recent": "最近使用",
      "panel.recentTitle": "按最近使用排序（最多 20 条）",
      "panel.newBtn": "＋ 新建",
      "panel.newBtnTitle": "新建片段",
      "panel.newBtnReadonly": "片段库处于只读状态，禁止新建",
      "panel.exporting": "导出中…",
      "panel.export": "⬇ 导出",
      "panel.exportTitle": "把所有片段导出成 JSON 文件，存在数据目录的 exports/ 下",
      "panel.importing": "导入中…",
      "panel.import": "⬆ 导入",
      "panel.importTitle": "从导出的 JSON 文件导入片段",
      "panel.importReadonly": "片段库处于只读状态，禁止导入",
      "panel.importPathLabel": "导入文件路径",
      "panel.importPathPlaceholder": "留空或写文件名时取 exports/snippets.json",
      "panel.importReplaceLabel": "替换模式（未出现在文件里的片段会被移入垃圾桶）",
      "panel.cancel": "取消",
      "panel.importBtn": "导入",
      "panel.openFile": "打开",
      "panel.openFileTitle": "在系统文件管理器中打开这个文件",
      "panel.undoAll": "全部撤销",
      "panel.footer": "点名称插入 · ✏️ 编辑 · ✨ 优化 · 🗑 删除 · 拖标题栏移动 · 拖边缘调大小",
    };
    const en = {
      "error.unknown": "Unknown error",
      "error.readFailed": "Failed to load",
      "error.sendFailed": "Send failed: make sure the composer has content and try again.",
      "error.insertFailed": "Insert failed: place the cursor in the composer first.",
      "error.insertFailedDraft": "Insert failed: place the cursor in the composer first (the draft may have changed while the panel was open).",
      "error.optimizeFailed": "Optimize failed",
      "error.noModel": "No default model configured — cannot optimize",
      "error.exportFailed": "Export failed",
      "error.importFailed": "Import failed",
      "error.deleteFailed": "Delete failed",
      "error.restoreFailed": "Restore failed",
      "error.saveFailed": "Save failed",
      "error.nameEmpty": "Snippet name cannot be empty.",
      "error.reloadFailed": "Reload failed: the snippet may have been deleted.",
      "error.replaceFailed": "Replace failed",
      "error.conflict": "This snippet was modified elsewhere",
      "error.importPathEmpty": "Enter the path of the JSON file to import.",
      "notice.defaultsFilled": "Filled with defaults — edit in ✏️",
      "notice.saved": "Saved",
      "notice.created": "Created",
      "notice.loadedLatest": "Loaded the latest version from the server.",
      "notice.imported": "Imported {added}{skipped}{updated}",
      "notice.importedSkipped": ", skipped {n}",
      "notice.importedUpdated": ", updated {n}",
      "notice.historyInserted": "Inserted old version content",
      "edit.confirmDiscard": "Draft not saved — click \"Discard\" again to discard it.",
      "edit.overwrite": "Overwrite",
      "edit.reload": "Reload",
      "edit.name": "Name",
      "edit.namePlaceholder": "Snippet name",
      "edit.category": "Category",
      "edit.categoryPlaceholder": "Leave empty for no category",
      "edit.tags": "Tags (comma-separated)",
      "edit.tagsPlaceholder": "e.g. code, common, review",
      "edit.pinned": "Pin to top",
      "edit.content": "Content (use {{variable}} for placeholders, \\{{ for literal)",
      "edit.variables": "Variables",
      "edit.required": "Required",
      "edit.defaultPlaceholder": "Default (optional)",
      "edit.enumPlaceholder": "Options (comma-separated, optional)",
      "edit.enumTitle": "With options set, the insert form shows a dropdown limited to these choices",
      "edit.cancel": "Cancel",
      "edit.confirmCancel": "Discard",
      "edit.saving": "Saving…",
      "edit.save": "Save",
      "fill.requiredSuffix": " · required",
      "fill.empty": "(leave empty)",
      "fill.cancel": "Cancel",
      "fill.keepRaw": "Insert with placeholders",
      "fill.insert": "Insert",
      "review.overLong": "Optimized result exceeds the snippet length limit — please shorten first",
      "review.replacePrompt": "Replace the snippet content with the optimized version",
      "review.original": "Original",
      "review.optimized": "Optimized",
      "review.optimizedEditable": "Optimized (editable)",
      "review.generating": "Generating…",
      "review.stopping": "Cancelling…",
      "review.empty": "(empty)",
      "review.overLongWarning": "⚠ Exceeds length limit",
      "review.applyOverwrite": "Overwrite with optimized",
      "review.discard": "Discard",
      "review.keepOriginal": "Insert original",
      "review.keepOriginalTitle": "Discard the optimized result and insert the original snippet",
      "review.cancelOptimize": "Cancel this optimization",
      "review.close": "Close comparison view",
      "review.cancelling": "Cancelling…",
      "review.cancel": "Cancel",
      "review.retryTitle": "Regenerate once (not cumulative)",
      "review.retryMaxTitle": "Retried {n} times",
      "review.retry": "Retry",
      "review.replacing": "Replacing…",
      "review.replaceContent": "Replace snippet content",
      "review.insertOptimized": "Insert optimized",
      "review.insertOptimizedTitle": "Insert the optimized text into the composer",
      "item.insertTitle": "Click to insert\n\n{content}",
      "item.edit": "Edit",
      "item.editReadonly": "Snippet store is read-only — editing disabled",
      "item.history": "View version history",
      "item.optimize": "AI optimize (compare before deciding)",
      "item.noModel": "No default model configured",
      "item.delete": "Delete (undoable)",
      "item.deleteReadonly": "Snippet store is read-only — deleting disabled",
      "palette.searchPlaceholder": "Search snippets (name / category / tag / content)…",
      "palette.empty": "No snippets yet — click \"＋ New\" on the dock to save one.",
      "palette.noMatch": "No snippets matching \"{query}\".",
      "palette.noCategory": "(no category)",
      "palette.hint": "↑↓ Select · Enter Insert · Ctrl+Enter Insert & Send · Esc Close · Ctrl+Shift+K Open",
      "history.loading": "Loading…",
      "history.empty": "No history yet (each save keeps the previous version, up to 20)",
      "history.insertTitle": "Insert this version's content into the composer",
      "history.insert": "Insert old version",
      "panel.empty": "No snippets yet. Click \"＋ New\" below or /snippet add <name> <content> to save one.",
      "panel.newFromQuery": "＋ New \"{query}\"",
      "panel.new": "＋ New snippet",
      "panel.newTitle": "Use the search term as the new snippet name",
      "panel.title": "Prompt Snippets",
      "panel.button": "📋 Snippets",
      "panel.ariaLabel": "Snippet panel",
      "panel.resizeHeight": "Drag to resize height",
      "panel.resizeWidth": "Drag to resize width",
      "panel.resizeSize": "Drag to resize",
      "panel.dragTitle": "Drag the title bar to move the panel",
      "panel.close": "Close",
      "panel.closeAria": "Close snippet panel",
      "panel.searchPlaceholder": "Search name / category / content…",
      "panel.all": "All",
      "panel.pinned": "★ Pinned",
      "panel.pinnedTitle": "Show only pinned snippets",
      "panel.recent": "Recent",
      "panel.recentTitle": "Sort by recently used (up to 20)",
      "panel.newBtn": "＋ New",
      "panel.newBtnTitle": "New snippet",
      "panel.newBtnReadonly": "Snippet store is read-only — creating disabled",
      "panel.exporting": "Exporting…",
      "panel.export": "⬇ Export",
      "panel.exportTitle": "Export all snippets to a JSON file under exports/ in the data directory",
      "panel.importing": "Importing…",
      "panel.import": "⬆ Import",
      "panel.importTitle": "Import snippets from an exported JSON file",
      "panel.importReadonly": "Snippet store is read-only — importing disabled",
      "panel.importPathLabel": "Import file path",
      "panel.importPathPlaceholder": "Leave empty or use a filename for exports/snippets.json",
      "panel.importReplaceLabel": "Replace mode (snippets not in the file are moved to trash)",
      "panel.cancel": "Cancel",
      "panel.importBtn": "Import",
      "panel.openFile": "Open",
      "panel.openFileTitle": "Open this file in the system file manager",
      "panel.undoAll": "Undo all",
      "panel.footer": "Click name to insert · ✏️ Edit · ✨ Optimize · 🗑 Delete · Drag title to move · Drag edge to resize",
    };

    // 样式插入走两条路：优先平台 seed builtin `styles`（自带生命周期清理），
    // 拿不到就退回 ui-theme 官方同款做法（document.head + ctx.effect 清理）。
    // 都不能让 bundle 挂掉：配色主体是内联 var(--dsw-*)，CSS 只补伪类与滚动条。
    let stylesBuiltin = null;
    try {
      stylesBuiltin = require("styles");
    } catch (_) {
      stylesBuiltin = null;
    }

    /** 把一段 CSS 挂到文档上，返回值是清理函数。 */
    function mountCss(css, label) {
      if (stylesBuiltin && typeof stylesBuiltin.insert === "function") {
        return stylesBuiltin.insert(css);
      }
      if (typeof document === "undefined") return () => {};
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-prompt-snippets";
      tag.dataset.pluginCss = label;
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    const CHANNEL = "/prompt-snippets";
    const Z_TOP = 2147483647;
    // 面板尺寸是上限，实际由 CSS min() 与视口共同决定；clampPos 按上限做保守裁剪。
    const PANEL_W = 340;
    const PANEL_H = 440;
    const GAP = 8;
    // 自定义尺寸的下限：太小就没法用了；上限由视口与 PANEL_W/H 共同约束
    const MIN_W = 200;
    const MIN_H = 160;
    const POS_KEY = "dsh-prompt-snippets-panel-pos";
    const SIZE_KEY = "dsh-prompt-snippets-panel-size";

    // ── 主题 token（全部为 ui-theme 已注册的 --dsw-* 别名，浅深两套自动跟随） ──
    // 坑一：bg-layer-1 与 bg-layer-2 在浅色下都是 #ffffff，
    //       所以「次级面 / hover 底」不能直接用 layer-2，否则浅色主题零视觉反馈。
    //       统一从 label-primary 派生半透明叠加层：浅色下压深、深色下提亮，两端都可见。
    // 坑二：elevation token 自带 0.5px 发丝描边，用了它就不能再写 border，否则双层轮廓。
    const tint = (pct) =>
      `color-mix(in srgb, var(--dsw-alias-label-primary) ${pct}%, transparent)`;
    // 主操作按钮的品牌色叠层：没有 inverse/on-brand token，用 brand-primary 的半透明叠加
    // 做「品牌色 tint 按钮」，与 ghost（透明底）拉开层次，又始终跟随主题。
    const brandTint = (pct) =>
      `color-mix(in srgb, var(--dsw-alias-brand-primary) ${pct}%, transparent)`;
    const C = {
      surface: "var(--dsw-alias-bg-layer-1)",
      surfaceAlt: tint(4),
      surfaceHover: tint(7),
      border: "var(--dsw-alias-border-l2)",
      borderSubtle: "var(--dsw-alias-border-l1)",
      text: "var(--dsw-alias-label-primary)",
      textDim: "var(--dsw-alias-label-secondary)",
      danger: "var(--dsw-alias-state-error-primary)",
      elevation: "var(--dsw-elevation-prominent)",
    };

    // 只有两类事必须落 CSS：伪类（hover / focus-visible）与焦点环。
    // 滚动条不写——ui-theme 的 scrollbar.css 已有全局 ::-webkit-scrollbar 规则，
    // 自己再写一套会和它打架（Chrome 121+ 一旦用 scrollbar-color 就禁用 webkit 伪元素）。
    const THEME_CSS = `
.ps-panel, .ps-panel * { box-sizing: border-box; }

/* 关键：面板整体（含边缘拖拽把手）标记为 no-drag。
   DSH 是 frameless 窗口，顶部标题栏是 -webkit-app-region: drag 的拖拽区；
   面板贴顶（与窗口上缘平齐）时，若不显式 no-drag，按在把手上的拖动会被
   标题栏 drag 区域「穿透」接管，变成拖动整个 DSH 窗口而不是缩放面板。 */
.ps-panel, .ps-panel * { -webkit-app-region: no-drag; }

/* 交互反馈统一加过渡：颜色/背景/边框/阴影 110ms，避免 hover 瞬间跳变 */
.ps-btn, .ps-icon, .ps-item, .ps-undo, .ps-close, .ps-view,
.ps-primary, .ps-ghost, .ps-search, .ps-input, .ps-textarea {
  transition: background-color 110ms ease, color 110ms ease, border-color 110ms ease, box-shadow 110ms ease;
}

/* 面板打开淡入（transform 只影响本面板，不参与宿主 dock 的居中重排） */
.ps-panel { animation: ps-panel-in 120ms ease; }
@keyframes ps-panel-in {
  from { opacity: 0; transform: translateY(3px) scale(0.985); }
  to { opacity: 1; transform: none; }
}

.ps-btn:hover, .ps-icon:hover, .ps-item:hover, .ps-undo:hover,
.ps-primary:hover, .ps-ghost:hover { background: ${C.surfaceHover} !important; }
.ps-view:hover { background: ${C.surfaceHover} !important; }
/* 主操作按钮：品牌色 tint，hover 加深，与 ghost 拉开层次 */
.ps-primary { background: ${brandTint(14)} !important; border-color: ${brandTint(36)} !important; color: ${C.text} !important; }
.ps-primary:hover { background: ${brandTint(22)} !important; border-color: ${brandTint(50)} !important; }
.ps-close:hover { background: ${C.surfaceHover}; color: var(--dsw-alias-label-primary); }
.ps-primary:disabled, .ps-ghost:disabled { background: transparent !important; }

/* 与 ui-theme focus.css 同语义：颜色回退到业务主色，pointer 模态由上游规则统一抑制 */
.ps-btn:focus-visible, .ps-icon:focus-visible, .ps-item:focus-visible,
.ps-undo:focus-visible, .ps-close:focus-visible, .ps-search:focus-visible,
.ps-primary:focus-visible, .ps-ghost:focus-visible,
.ps-input:focus-visible, .ps-textarea:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}

/* 编辑区内的输入框沿用搜索框的描边：聚焦时用业务主色，否则普通边框 */
.ps-input:focus, .ps-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }

/* warn 只有前景色 token、没有配套底色：先给中性兜底，再用 color-mix 从前景派生 */
.ps-warn {
  color: var(--dsw-alias-state-warn-primary);
  background: ${C.surfaceAlt};
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, var(--dsw-alias-bg-layer-1));
  border-bottom-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);
}
`;

    const style = {
      dock: { display: "inline-flex", gap: "4px", alignItems: "center", flex: "none", minWidth: 0 },
      button: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        // 工具栏里的同级控件（模型选择器、加号按钮）都是固定 28px 高、flex:none、
        // 文字 nowrap。这里也对齐：固定高度 + 不被 flex 压缩 + 文字永不折行。
        // 否则窄窗口下按钮被压缩，文字折行会把按钮纵向撑高（“变高”的真正来源）。
        boxSizing: "border-box",
        flex: "none",
        whiteSpace: "nowrap",
        height: "28px",
        padding: "0 8px",
        fontSize: "12px",
        lineHeight: "20px",
        borderRadius: "6px",
        border: "1px solid " + C.border,
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      },
      panel: {
        position: "fixed",
        zIndex: Z_TOP,
        // 窄屏：视口不足时收窄，永不溢出
        width: `min(${PANEL_W}px, calc(100vw - ${GAP * 2}px))`,
        maxHeight: `min(${PANEL_H}px, calc(100vh - ${GAP * 3}px))`,
        overflow: "hidden",
        borderRadius: "10px",
        // elevation token 自带 0.5px 发丝描边，故 border 置 0，避免双层轮廓
        border: "0",
        background: C.surface,
        color: C.text,
        boxShadow: C.elevation,
        display: "flex",
        flexDirection: "column",
      },
      // 八个方向 resize 把手（像 Windows 窗口：四边 + 四角都能拖）。
      // absolute 定位、z-index 抬到内容之上，边条 8px 比角 20px 细，避免误触。
      // 关键：面板 border-radius 10px + overflow:hidden 会把「角把手」靠外一圈裁掉，
      // 若角把手太小，真正能点到的斜向区域只剩一条细缝，手一偏就落到边条上变成单向。
      // 所以角把手做成 20×20，保证圆角内仍有足够大的可抓取面积；把手保持透明，不画斜纹。
      resizeN: { position: "absolute", zIndex: 2, top: 0, left: 10, right: 10, height: 8, cursor: "ns-resize", userSelect: "none", touchAction: "none" },
      resizeS: { position: "absolute", zIndex: 2, bottom: 0, left: 10, right: 10, height: 8, cursor: "ns-resize", userSelect: "none", touchAction: "none" },
      resizeW: { position: "absolute", zIndex: 2, left: 0, top: 10, bottom: 10, width: 8, cursor: "ew-resize", userSelect: "none", touchAction: "none" },
      resizeE: { position: "absolute", zIndex: 2, right: 0, top: 10, bottom: 10, width: 8, cursor: "ew-resize", userSelect: "none", touchAction: "none" },
      resizeNW: { position: "absolute", zIndex: 2, left: 0, top: 0, width: 20, height: 20, cursor: "nwse-resize", userSelect: "none", touchAction: "none" },
      resizeSW: { position: "absolute", zIndex: 2, left: 0, bottom: 0, width: 20, height: 20, cursor: "nesw-resize", userSelect: "none", touchAction: "none" },
      resizeSE: { position: "absolute", zIndex: 2, right: 0, bottom: 0, width: 20, height: 20, cursor: "nwse-resize", userSelect: "none", touchAction: "none" },
      header: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 8px",
        borderBottom: "1px solid " + C.borderSubtle,
        cursor: "move",
        userSelect: "none",
        fontSize: "12px",
        fontWeight: 600,
        flexShrink: 0,
      },
      headerTitle: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      close: {
        border: "none",
        background: "transparent",
        fontSize: "16px",
        lineHeight: 1,
        cursor: "pointer",
        color: C.textDim,
        padding: "0 2px",
        borderRadius: "4px",
      },
      searchWrap: {
        padding: "6px 8px",
        borderBottom: "1px solid " + C.borderSubtle,
        background: C.surfaceAlt,
        flexShrink: 0,
      },
      searchRow: { display: "flex", alignItems: "center", gap: "6px" },
      search: {
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        fontSize: "12px",
        borderRadius: "5px",
        border: "1px solid " + C.border,
        outline: "none",
        background: C.surface,
        color: C.text,
      },
      body: { overflow: "auto", padding: "6px", flex: 1, minHeight: 0 },
      group: {
        fontWeight: 600,
        fontSize: "11px",
        color: C.textDim,
        padding: "6px 8px 2px",
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        // 分类标题在长列表里要吸附在顶部，滚动时不丢上下文
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: C.surface,
      },
      itemRow: { display: "flex", alignItems: "center", gap: "4px", width: "100%" },
      item: {
        display: "block",
        flex: 1,
        minWidth: 0,
        textAlign: "left",
        padding: "7px 8px",
        fontSize: "13px",
        borderRadius: "5px",
        border: "none",
        background: "transparent",
        color: C.text,
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      itemSelected: {
        // 键盘 ↑↓ 导航的选中态：与 hover 同源（label-primary 派生半透明叠加），浅深都可见
        background: C.surfaceHover,
      },
      // §3.2 搜索高亮：brand 主色 20% 透明，命中片段在名称里标出（正文不进列表，命中靠名称+分类）
      mark: {
        background: "color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)",
        color: "inherit",
        borderRadius: "2px",
        padding: "0 1px",
      },
      searchCount: {
        flexShrink: 0,
        fontSize: "11px",
        color: C.textDim,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      },
      // ── v1.3 标签 / 收藏 / 视图切换 / 版本历史 ──
      tagChip: {
        display: "inline-block",
        fontSize: "10px",
        lineHeight: 1,
        padding: "2px 6px",
        borderRadius: "999px",
        background: C.surfaceHover,
        color: C.textDim,
        marginLeft: "4px",
        verticalAlign: "middle",
        maxWidth: "90px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      pinStar: { color: "var(--dsw-alias-state-warn-primary)", marginRight: "2px" },
      viewBar: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderBottom: "1px solid " + C.borderSubtle,
        background: C.surfaceAlt,
        flexShrink: 0,
      },
      viewBtn: {
        border: "1px solid " + C.border,
        background: "transparent",
        color: C.textDim,
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "11px",
        cursor: "pointer",
        flexShrink: 0,
      },
      viewBtnActive: {
        border: "1px solid " + C.border,
        background: C.surfaceHover,
        color: C.text,
        borderRadius: "999px",
        padding: "2px 10px",
        fontSize: "11px",
        cursor: "pointer",
        flexShrink: 0,
      },
      groupStar: { color: "var(--dsw-alias-state-warn-primary)" },
      historyWrap: {
        padding: "0 8px 6px",
        flexShrink: 0,
        maxHeight: "60%",
        overflow: "auto",
      },
      historyBox: {
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px",
        margin: "2px 0 4px",
        borderRadius: "6px",
        border: "1px solid " + C.border,
        background: C.surfaceAlt,
      },
      historyRow: {
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "4px 0",
        borderBottom: "1px solid " + C.borderSubtle,
        fontSize: "11px",
      },
      historyMeta: { flexShrink: 0, color: C.textDim, minWidth: "52px", fontVariantNumeric: "tabular-nums" },
      historyContent: {
        flex: 1,
        minWidth: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        color: C.text,
        maxHeight: "120px",
        overflow: "auto",
      },
      historyLink: {
        color: "var(--dsw-alias-brand-primary)",
        cursor: "pointer",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      },
      // ── v1.3 命令面板（全局快捷唤起 overlay） ──
      paletteOverlay: {
        position: "fixed",
        inset: 0,
        zIndex: Z_TOP - 1,
        background: "rgba(0,0,0,0.28)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
      },
      paletteBox: {
        marginTop: "12vh",
        width: "min(520px, calc(100vw - 32px))",
        maxHeight: "min(420px, calc(100vh - 24vh))",
        display: "flex",
        flexDirection: "column",
        borderRadius: "10px",
        border: "1px solid " + C.border,
        background: C.surface,
        boxShadow: "0 12px 40px rgba(0,0,0,0.32)",
        overflow: "hidden",
      },
      paletteInput: {
        border: "none",
        borderBottom: "1px solid " + C.borderSubtle,
        background: "transparent",
        color: C.text,
        fontSize: "14px",
        padding: "12px 14px",
        outline: "none",
        fontFamily: "inherit",
      },
      paletteList: { overflowY: "auto", padding: "6px", flex: 1, minHeight: 0 },
      paletteRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        border: "1px solid transparent",
        background: "transparent",
        color: C.text,
        fontSize: "13px",
        padding: "8px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      },
      paletteRowActive: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        border: "1px solid transparent",
        background: C.surfaceHover,
        color: C.text,
        fontSize: "13px",
        padding: "8px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
      },
      paletteName: { flexShrink: 0, fontWeight: "600" },
      paletteMeta: {
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: C.textDim,
        fontSize: "11px",
      },
      paletteHint: { color: C.textDim, fontSize: "11px", padding: "6px 14px", borderTop: "1px solid " + C.borderSubtle },
      icon: {
        border: "1px solid transparent",
        background: "transparent",
        fontSize: "13px",
        lineHeight: 1,
        cursor: "pointer",
        padding: "4px 6px",
        borderRadius: "5px",
        color: C.textDim,
        flexShrink: 0,
      },
      iconBusy: { opacity: 0.4, cursor: "default" },
      del: { color: C.danger },
      empty: { padding: "12px 8px", fontSize: "12px", color: C.textDim },
      error: { padding: "12px 8px", fontSize: "12px", color: C.danger },
      warn: { padding: "6px 8px", fontSize: "11px", flexShrink: 0 },
      undoBar: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 8px",
        fontSize: "11px",
        borderTop: "1px solid " + C.borderSubtle,
        background: C.surfaceAlt,
        color: C.text,
        flexShrink: 0,
      },
      undoText: {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: C.textDim,
      },
      undoBtn: {
        border: "1px solid " + C.border,
        background: "transparent",
        borderRadius: "5px",
        padding: "2px 8px",
        fontSize: "11px",
        cursor: "pointer",
        color: C.text,
        flexShrink: 0,
      },
      hint: {
        padding: "4px 8px 6px",
        fontSize: "10px",
        color: C.textDim,
        opacity: 0.85,
        borderTop: "1px solid " + C.borderSubtle,
        flexShrink: 0,
      },
      // ── 行内编辑 / 新建 / 占位符表单 ──
      editor: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px",
        margin: "2px 0 4px",
        borderRadius: "6px",
        border: "1px solid " + C.border,
        background: C.surfaceAlt,
      },
      field: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
      label: { fontSize: "11px", color: C.textDim },
      input: {
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        fontSize: "12px",
        borderRadius: "5px",
        border: "1px solid " + C.border,
        outline: "none",
        background: C.surface,
        color: C.text,
        fontFamily: "inherit",
      },
      select: {
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        fontSize: "12px",
        borderRadius: "5px",
        border: "1px solid " + C.border,
        outline: "none",
        background: C.surface,
        color: C.text,
        fontFamily: "inherit",
        cursor: "pointer",
      },
      textarea: {
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        fontSize: "12px",
        borderRadius: "5px",
        border: "1px solid " + C.border,
        outline: "none",
        background: C.surface,
        color: C.text,
        fontFamily: "inherit",
        resize: "vertical",
        minHeight: "64px",
        lineHeight: "1.5",
      },
      varRow: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
        padding: "3px 0",
        fontSize: "11px",
      },
      varName: { fontFamily: "ui-monospace, monospace", color: C.text, flexShrink: 0 },
      // fontSize 必须显式给：checkWrap 的直接父级（editor / body / panel）都没有字号，
      // 不写就会一路继承到上层会话容器，跟随用户的对话字体设置，出现「收藏置顶」比周围标签大一号。
      checkWrap: {
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        color: C.textDim,
        flexShrink: 0,
        fontSize: "11px",
      },
      actions: { display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap", paddingTop: "2px" },
      btnPrimary: {
        border: "1px solid " + C.border,
        background: C.surfaceHover,
        color: C.text,
        borderRadius: "5px",
        padding: "3px 12px",
        fontSize: "12px",
        cursor: "pointer",
        flexShrink: 0,
      },
      btnGhost: {
        border: "1px solid " + C.border,
        background: "transparent",
        color: C.textDim,
        borderRadius: "5px",
        padding: "3px 10px",
        fontSize: "12px",
        cursor: "pointer",
        flexShrink: 0,
      },
      btnDisabled: { opacity: 0.45, cursor: "default" },
      conflict: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
        padding: "6px 8px",
        fontSize: "11px",
        borderBottom: "1px solid " + C.borderSubtle,
        background: C.surfaceAlt,
        color: C.danger,
        flexShrink: 0,
      },
      addRow: {
        padding: "6px 8px",
        borderTop: "1px solid " + C.borderSubtle,
        flexShrink: 0,
      },
      addRowInner: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
      exportBar: {
        display: "flex",
        alignItems: "center",
        padding: "4px 8px",
        borderTop: "1px solid " + C.borderSubtle,
        fontSize: "11px",
        color: C.textDim,
        flexShrink: 0,
      },
      exportText: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        direction: "rtl",
        textAlign: "left",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      formWrap: { padding: "0 8px 6px", flexShrink: 0, maxHeight: "60%", overflow: "auto" },
      hintInline: { fontSize: "11px", color: C.danger, paddingTop: "2px" },
      notice: {
        fontSize: "11px",
        color: C.textDim,
        padding: "2px 6px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "220px",
      },
      itemEditing: { background: C.surfaceHover },
      undoChip: {
        border: "1px solid " + C.border,
        background: "transparent",
        borderRadius: "999px",
        padding: "1px 8px",
        fontSize: "10px",
        cursor: "pointer",
        color: C.text,
        maxWidth: "110px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        flexShrink: 0,
      },
      // ── §3.1 三态对比视图 ──
      reviewWrap: {
        padding: "0 8px 6px",
        flexShrink: 0,
        maxHeight: "68%",
        overflow: "auto",
      },
      reviewBox: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px",
        margin: "2px 0 4px",
        borderRadius: "6px",
        border: "1px solid " + C.border,
        background: C.surfaceAlt,
      },
      reviewCols: { display: "flex", gap: "6px", alignItems: "stretch" },
      reviewCol: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" },
      reviewPane: {
        flex: 1,
        minHeight: "72px",
        maxHeight: "160px",
        overflow: "auto",
        padding: "5px 7px",
        borderRadius: "5px",
        border: "1px solid " + C.borderSubtle,
        background: C.surface,
        color: C.text,
        fontSize: "11px",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "inherit",
      },
      // 优化后可编辑：与 reviewPane 同尺寸，但可输入、可纵向拉高
      reviewInput: {
        flex: 1,
        width: "100%",
        boxSizing: "border-box",
        minHeight: "72px",
        maxHeight: "160px",
        overflow: "auto",
        padding: "5px 7px",
        borderRadius: "5px",
        border: "1px solid " + C.border,
        background: C.surface,
        color: C.text,
        fontSize: "11px",
        lineHeight: 1.5,
        fontFamily: "inherit",
        resize: "vertical",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      },
      reviewMeta: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        fontSize: "10px",
        color: C.textDim,
      },
      reviewKeep: { color: C.text },
      reviewLost: { color: C.danger },
    };

    function loadSavedPos() {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (typeof p.left === "number" && typeof p.top === "number") return p;
        }
      } catch (_) {}
      return null;
    }
    function savePos(pos) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch (_) {}
    }

    /** 读/写自定义尺寸；坏数据一律忽略回默认。 */
    function loadSavedSize() {
      try {
        const raw = localStorage.getItem(SIZE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (typeof s.w === "number" && typeof s.h === "number") return s;
        }
      } catch (_) {}
      return null;
    }
    function saveSize(size) {
      try {
        localStorage.setItem(SIZE_KEY, JSON.stringify(size));
      } catch (_) {}
    }

    /** 把自定义尺寸夹到 [MIN, 视口上限] 内。上限不取默认 PANEL_W/H——用户要能放大也能缩小。 */
    function clampSize(w, h) {
      const vw = window.innerWidth || PANEL_W + GAP * 2;
      const vh = window.innerHeight || PANEL_H + GAP * 3;
      const maxW = Math.max(MIN_W, vw - GAP * 2);
      const maxH = Math.max(MIN_H, vh - GAP * 3);
      return {
        w: Math.round(Math.max(MIN_W, Math.min(w, maxW))),
        h: Math.round(Math.max(MIN_H, Math.min(h, maxH))),
      };
    }

    /** 面板当前实际占位尺寸：优先自定义尺寸，回退默认，再按视口收窄。 */
    function panelBox(size) {
      const vw = window.innerWidth || PANEL_W + GAP * 2;
      const vh = window.innerHeight || PANEL_H + GAP * 3;
      const baseW = size ? size.w : PANEL_W;
      const baseH = size ? size.h : PANEL_H;
      return {
        w: Math.min(baseW, Math.max(MIN_W, vw - GAP * 2)),
        h: Math.min(baseH, Math.max(MIN_H, vh - GAP * 3)),
      };
    }

    /** 裁剪到视口内，至少让标题栏完整可见（便于拖回）。 */
    function clampPos(left, top, size) {
      const { w } = panelBox(size);
      const vw = window.innerWidth || w + GAP * 2;
      const vh = window.innerHeight || 600;
      left = Math.max(GAP, Math.min(left, vw - w - GAP));
      top = Math.max(GAP, Math.min(top, vh - 48));
      return { left, top };
    }

    function groupByCategory(snippets) {
      const groups = new Map();
      for (const s of snippets) {
        const key = s.category || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
      return [...groups.entries()];
    }

    /** 大小写不敏感、命中名称/分类/标签/内容任一处。 */
    function filterSnippets(snippets, query) {
      const q = query.trim().toLowerCase();
      if (!q) return snippets;
      return snippets.filter((s) => {
        const hay = `${s.name}\n${s.category || ""}\n${(s.tags || []).join(" ")}\n${s.content}`.toLowerCase();
        return hay.includes(q);
      });
    }

    /**
     * §3.2 搜索高亮：把名称里命中 q 的片段包进 <mark>（样式 key style.mark）。
     * 返回 React 节点数组；q 为空时原样返回字符串，避免无谓的数组包装。
     * 大小写不敏感，用 indexOf 推进，不依赖 RegExp（q 可能含正则元字符）。
     */
    function highlightText(text, q) {
      if (!q) return text;
      const lower = String(text).toLowerCase();
      const needle = q.toLowerCase();
      let from = 0;
      let idx = lower.indexOf(needle, from);
      if (idx === -1) return text;
      const out = [];
      while (idx !== -1) {
        if (idx > from) out.push(text.slice(from, idx));
        out.push(h("mark", { style: style.mark }, text.slice(idx, idx + needle.length)));
        from = idx + needle.length;
        idx = lower.indexOf(needle, from);
      }
      if (from < text.length) out.push(text.slice(from));
      return out;
    }

    // ── 占位符：与 host 半同一套规则（index.js scanPlaceholders 的镜像） ──
    // 客户端必须自己扫一遍才能判断「点了该直插还是弹表单」，
    // 而插入必须在本地一次成型——不能先问 host 再插，否则中间用户可能改了草稿。
    const VAR_NAME_RE = /^[\p{L}\p{N}_-]{1,40}$/u;

    // 动态宏变量：插入时用本地时间实时替换，不弹表单、不进 variables 元数据。
    // 与 index.js 的 DYNAMIC_VAR_NAMES 保持一致。
    const DYNAMIC_VAR_NAMES = new Set(["date", "time", "datetime"]);

    const isDynamic = (name) => DYNAMIC_VAR_NAMES.has(name);

    /** 计算动态变量的即时值；非动态变量返回 null。 */
    function dynamicValue(name) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      if (name === "date") return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (name === "time") return `${p(d.getHours())}:${p(d.getMinutes())}`;
      if (name === "datetime") {
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      }
      return null;
    }

    function parseVarAt(content, at) {
      if (content.slice(at, at + 2) !== "{{") return null;
      const close = content.indexOf("}}", at + 2);
      if (close === -1) return null;
      const inner = content.slice(at + 2, close);
      if (!VAR_NAME_RE.test(inner)) return null;
      return { name: inner, end: close + 2 };
    }

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
        if (ch === "\\") {
          let n = 0;
          while (content[i + n] === "\\") n++;
          if (content.slice(i + n, i + n + 2) === "{{") {
            const parsed = parseVarAt(content, i + n);
            if (parsed) {
              text += "\\".repeat(Math.floor(n / 2));
              if (n % 2 === 1) {
                text += content.slice(i + n, parsed.end);
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
        if (ch === "{" && content[i + 1] === "{") {
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

    function renderContent(tokens, variables, values) {
      let text = "";
      const missing = [];
      for (const tk of tokens) {
        if (tk.kind === "text") {
          text += tk.text;
          continue;
        }
        // 动态宏变量（{{date}}/{{time}}/{{datetime}}）直接替换，不参与校验
        const dyn = isDynamic(tk.name) ? dynamicValue(tk.name) : null;
        if (dyn !== null) {
          text += dyn;
          continue;
        }
        const def = (variables && variables[tk.name]) || {};
        const raw = values && typeof values[tk.name] === "string" ? values[tk.name] : "";
        const effective = raw.trim() !== "" ? raw : typeof def.default === "string" ? def.default : "";
        if (effective === "" && def.required === true && !missing.includes(tk.name)) missing.push(tk.name);
        text += effective;
      }
      return { text, missing };
    }

    /**
     * 点击片段时该走哪条路（ROADMAP §2.5 表单触发规则表）：
     *   direct   —— 没有变量（或只有动态宏变量），直接插入
     *   defaults —— 变量全都非必填且都有默认值，按默认值直接插入
     *   form     —— 有必填变量，或缺默认值 / 没有 variables 元数据（旧数据），弹表单
     * 动态宏变量（{{date}}/{{time}}/{{datetime}}）不算变量：不触发表单、不参与必填判断。
     */
    function fillPlan(snippet) {
      const { names } = scanPlaceholders(snippet.content || "");
      const userVars = names.filter((n) => !isDynamic(n));
      if (userVars.length === 0) return { kind: "direct" };
      const vars = snippet.variables || {};
      const allDefaulted = userVars.every((n) => {
        const d = vars[n];
        return !!d && d.required !== true && typeof d.default === "string" && d.default.trim() !== "";
      });
      return allDefaulted ? { kind: "defaults" } : { kind: "form" };
    }

    /** 正文里出现的变量名（首次出现顺序，含动态宏变量），供变量编辑器与表单共用。 */
    function varNamesOf(content) {
      return scanPlaceholders(content || "").names;
    }

    /** 撤销栈上限：ROADMAP §2.4「记住最近 5 条」。 */
    const MAX_UNDO = 5;

    /** 把 throw 出来的任意值转成一句能看的错误文案。 */
    // t 由 SnippetDock 闭包传入（参数），此处直接用全局兜底。
    function msgOf(err) {
      if (!err) return zh["error.unknown"];
      if (typeof err === "string") return err;
      return String(err.message || err);
    }

    /** 字节数（UTF-8）：对比栏要显示「42 → 118」，按字节比按字数更贴近 token 量。 */
    function byteLen(text) {
      const s = String(text || "");
      if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
      return s.length;
    }

    /** 时间戳（秒或毫秒）→ 本地时间字符串；坏值回退「-」。 */
    function fmtTime(t) {
      if (!Number.isFinite(t)) return "-";
      const d = new Date(t < 1e12 ? t * 1000 : t);
      if (Number.isNaN(d.getTime())) return "-";
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    /** 与 host 侧 MAX_CONTENT 一致：编辑后实时重算是否超长，不能只信 host 首次返回的 truncated。 */
    const MAX_CONTENT = 200_000;

    function SnippetDock({ inputActions, rpc, t, localeSubscribe }) {
      // locale 切换时强制重渲染（t 是外部绑定的纯函数，不会随 locale 自动更新）。
      // 用 useState 而非 useEffect，避免 hook 槽位偏移影响既有测试。
      const [, setLocaleRev] = useState(0);
      if (localeSubscribe) localeSubscribe(() => setLocaleRev((n) => n + 1));
      const [snippets, setSnippets] = useState([]);
      const [readOnly, setReadOnly] = useState(false); // host 只读保护：version 更高 / 隔离失败时禁用一切写操作
      const [open, setOpen] = useState(false);
      const [panelPos, setPanelPos] = useState(null);
      const [panelSize, setPanelSize] = useState(null); // {w, h}，null = 用默认；右下角拖拽调整
      const [drag, setDrag] = useState(null);
      const [resizing, setResizing] = useState(null); // {startX, startY, w, h} 尺寸拖拽快照
      const [error, setError] = useState(null);
      const [warning, setWarning] = useState(null);
      const [optimizing, setOptimizing] = useState(null); // 正在优化的片段 id
      // §3.1 三态对比视图：优化结果不落盘、不直插，先摆出原文/优化后让用户决定
      const [review, setReview] = useState(null); // {snippet, original, optimized, truncated, retries, busy, conflict, saving, stopping}
      const [optAvail, setOptAvail] = useState({ available: true, reason: null }); // 模型可用性，预置可用
      const [deleting, setDeleting] = useState(null); // 正在删除的片段 id
      const [exporting, setExporting] = useState(false); // 正在导出
      const [exportPath, setExportPath] = useState(null); // 上次导出的落盘路径
      const [importOpen, setImportOpen] = useState(false); // 导入路径输入框是否展开
      const [importPath, setImportPath] = useState(""); // 导入文件路径
      const [importReplace, setImportReplace] = useState(false); // 替换而非合并
      const [importing, setImporting] = useState(false); // 正在导入
      const [deleted, setDeleted] = useState([]); // 最近 5 条 [{id,name}]，可逐条或全部撤销
      const [query, setQuery] = useState("");
      const [selected, setSelected] = useState(-1); // §3.2 键盘 ↑↓ 导航：visible 扁平数组的下标，-1 = 未选中
      const [notice, setNotice] = useState(null); // 短暂提示（默认值填充等），关面板后仍可见
      const [editing, setEditing] = useState(null); // 行内编辑草稿
      const [filling, setFilling] = useState(null); // 占位符表单 { snippet, values }
      const [view, setView] = useState("all"); // v1.3 视图切换：all / pinned / recent
      const [history, setHistory] = useState(null); // v1.3 版本历史面板 { id, list, busy }
      // v1.3 命令面板：全局快捷唤起（Ctrl+Shift+K / Ctrl+Shift+P），独立于 dock 面板
      const [paletteOpen, setPaletteOpen] = useState(false);
      const [paletteQuery, setPaletteQuery] = useState("");
      const [paletteSelected, setPaletteSelected] = useState(-1);
      const paletteInputRef = useRef(null);
      const paletteListRef = useRef(null);
      const searchRef = useRef(null);
      const nameRef = useRef(null);
      // 面板 DOM 引用：拖拽/缩放期间直接改 style.left/top/width/height，
      // 不触发 React 全量 re-render（那是拖拽卡顿的根因），松手才 commit 进 state。
      const panelRef = useRef(null);
      // toggle 里要读当前 review/busy，但又不能把 review 放进它的依赖（每次渲染都会重建），
      // 用一个跟随渲染更新的 ref 取快照。
      const reviewRef = useRef(null);
      reviewRef.current = review;

      const applyResult = (result) => {
        if (result && result.ok) {
          setSnippets((result.value && result.value.snippets) || []);
          setWarning((result.value && result.value.warning) || null);
          setReadOnly((result.value && result.value.readOnly) === true);
          setError(null);
        } else {
          setError(result && result.error ? result.error.message : t("error.readFailed"));
        }
      };

      const load = () => {
        Promise.resolve(rpc.call(CHANNEL, "list", {}))
          .then(applyResult)
          .catch((err) => setError(String((err && err.message) || err)));
      };

      useEffect(() => {
        load();
      }, []);

      // ── v1.3 命令面板：全局快捷唤起 Ctrl+Shift+K / Ctrl+Shift+P ──
      // 打开时把 dock 面板关掉，避免两个入口打架；focus 交给 palette input。
      useEffect(() => {
        if (!paletteOpen) return;
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setPaletteOpen(false);
          }
        };
        document.addEventListener("keydown", onKey, true);
        setTimeout(() => {
          if (paletteInputRef.current) paletteInputRef.current.focus();
        }, 0);
        return () => document.removeEventListener("keydown", onKey, true);
      }, [paletteOpen]);

      useEffect(() => {
        const onKey = (e) => {
          // 用 e.code（物理键位）而非 e.key：Shift+K 会让 e.key 变成大写 "K"，
          // 导致 Ctrl+Shift+K 永远匹配不到小写 "k"。
          if (e.code === "KeyK" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
            e.preventDefault();
            setPaletteOpen(true);
            setOpen(false);
          } else if (e.code === "KeyP" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
            e.preventDefault();
            setPaletteOpen(true);
            setOpen(false);
          }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
      }, []);

      // 命令面板结果：按名称/分类/标签搜索；清空时列出全部（有收藏的置顶）。
      const paletteResults = useMemo(() => {
        const q = paletteQuery.trim().toLowerCase();
        const pool = q ? filterSnippets(snippets, paletteQuery) : snippets;
        const sorted = pool.slice().sort((a, b) => {
          const pa = a.pinned === true ? 1 : 0;
          const pb = b.pinned === true ? 1 : 0;
          if (pa !== pb) return pb - pa;
          return (b.lastUsedAt || b.updatedAt || 0) - (a.lastUsedAt || a.updatedAt || 0);
        });
        return sorted.slice(0, 30);
      }, [snippets, paletteQuery]);

      // 选中项变化时，把对应的列表行滚进可视区（否则上下键切换超过可视高度后不跟随）。
      useEffect(() => {
        if (!paletteOpen || paletteSelected < 0 || !paletteListRef.current) return;
        const el = paletteListRef.current;
        const row = el.querySelector(`[data-ps-index="${paletteSelected}"]`);
        if (!row) return;
        const elTop = el.getBoundingClientRect().top;
        const rowTop = row.getBoundingClientRect().top;
        const rowBottom = row.getBoundingClientRect().bottom;
        if (rowTop < elTop) {
          el.scrollTop += rowTop - elTop;
        } else if (rowBottom > el.getBoundingClientRect().bottom) {
          el.scrollTop += rowBottom - el.getBoundingClientRect().bottom;
        }
      }, [paletteOpen, paletteSelected]);

      const _openPalette = () => {
        setPaletteQuery("");
        setPaletteSelected(-1);
        setPaletteOpen(true);
        setOpen(false);
      };

      const closePalette = () => {
        setPaletteOpen(false);
        setPaletteQuery("");
        setPaletteSelected(-1);
      };

      const paletteChoose = (snippet, sendAfter = false) => {
        closePalette();
        insert(snippet, sendAfter);
      };

      // §3.1：启动时问一次模型可用性。拿不到就不降级为「假装可用」——
      // 保持预置的可用状态，让点击时的错误提示兜底（老 host 没有这个字段）。
      useEffect(() => {
        Promise.resolve(rpc.call(CHANNEL, "capabilities", {}))
          .then((result) => {
            const opt = result && result.ok && result.value && result.value.optimize;
            if (opt && typeof opt.available === "boolean") {
              setOptAvail({ available: opt.available, reason: opt.reason || null });
            }
          })
          .catch(() => {});
      }, []);

      // notice 自动消失，避免长期占位
      useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 2600);
        return () => clearTimeout(timer);
      }, [notice]);

      // 拖拽：依赖 drag 起始快照，mousemove 用快照计算，结束保存。
      // 性能：移动期间直接改 DOM（不 setState），松手才 setPanelPos commit，
      // 避免每个 mousemove 都触发整个 dock 组件 re-render 造成卡顿。
      useEffect(() => {
        if (!drag) return;
        const el = panelRef.current;
        const onMove = (e) => {
          const pos = clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY), panelSize);
          if (el) {
            el.style.left = pos.left + "px";
            el.style.top = pos.top + "px";
          } else {
            setPanelPos(pos);
          }
        };
        const onUp = (e) => {
          const pos = clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY), panelSize);
          setPanelPos(pos);
          savePos(pos);
          setDrag(null);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
      }, [drag]);

      // 尺寸拖拽：八个方向把手按住拉，实时改面板宽高/位置，松手保存
      useEffect(() => {
        if (!resizing) return;
        const el = panelRef.current;
        const apply = (e) => {
          const dx = e.clientX - resizing.startX;
          const dy = e.clientY - resizing.startY;
          const { dir, left, top } = resizing;
          // 新几何 = 起始几何 + 方向增量；北/西方向要同步反向平移 left/top，保持对边不动
          let w = resizing.w;
          let h = resizing.h;
          let nl = left;
          let nt = top;
          if (dir.includes("e")) w = resizing.w + dx;
          if (dir.includes("s")) h = resizing.h + dy;
          if (dir.includes("w")) { w = resizing.w - dx; nl = left + dx; }
          if (dir.includes("n")) { h = resizing.h - dy; nt = top + dy; }
          const size = clampSize(w, h);
          // 北/西夹取后，按实际尺寸回算位置，避免缩到下限时对边漂移
          if (dir.includes("w")) nl = left + (resizing.w - size.w);
          if (dir.includes("n")) nt = top + (resizing.h - size.h);
          const pos = clampPos(nl, nt, size);
          return { size, pos };
        };
        const onMove = (e) => {
          const { size, pos } = apply(e);
          if (el) {
            el.style.left = pos.left + "px";
            el.style.top = pos.top + "px";
            el.style.width = size.w + "px";
            el.style.height = size.h + "px";
            el.style.maxHeight = "none";
          } else {
            setPanelSize(size);
            setPanelPos(pos);
          }
        };
        const onUp = (e) => {
          const { size, pos } = apply(e);
          saveSize(size);
          savePos(pos);
          setPanelSize(size);
          setPanelPos(pos);
          setResizing(null);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
      }, [resizing]);

      // 视口变化时把面板拉回可视区（窄屏 / 旋转 / 分屏调整都会触发）
      useEffect(() => {
        if (!open) return;
        const onResize = () => {
          setPanelPos((prev) => (prev ? clampPos(prev.left, prev.top, panelSize) : prev));
          setPanelSize((prev) => (prev ? clampSize(prev.w, prev.h) : prev));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, [open]);

      // 点击面板外部时关闭。
      // 例外：草稿没保存时不关——外面点一下就把写的字丢了，这个代价太高。
      // 对比视图同理：优化结果是花了模型调用换来的，别被一次误点丢掉。
      useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
          if (editing && editing.dirty) return;
          if (review) return;
          const panel = document.getElementById("ps-panel");
          const btn = document.getElementById("ps-button");
          if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            setOpen(false);
          }
        };
        document.addEventListener("mousedown", onDoc, true);
        return () => document.removeEventListener("mousedown", onDoc, true);
      }, [open, editing, review]);

      const toggle = (e) => {
        const next = !open;
        if (next) {
          // 首次打开时读回自定义尺寸；位置沿用已保存的，没有才定位
          if (!panelSize) {
            const sz = loadSavedSize();
            if (sz) setPanelSize(sz);
          }
          if (!panelPos) {
            const saved = loadSavedPos();
            if (saved) {
              setPanelPos(clampPos(saved.left, saved.top, panelSize));
            } else {
              const rect = e.currentTarget.getBoundingClientRect();
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const { w, h } = panelBox(panelSize);
              let left = rect.left;
              if (left + w > vw - GAP) left = Math.max(GAP, vw - w - GAP);
              let top;
              if (rect.top - h - GAP >= 0) {
                top = rect.top - h - GAP; // 优先向上展开，避免遮住输入框
              } else {
                top = rect.bottom + GAP;
                if (top + h > vh - GAP) top = Math.max(GAP, vh - h - GAP);
              }
              setPanelPos(clampPos(left, top, panelSize));
            }
          }
        }
        setOpen(next);
        if (next) {
          load();
          // 打开后自动聚焦搜索框，直接打字即可筛选
          setTimeout(() => {
            if (searchRef.current) searchRef.current.focus();
          }, 0);
        } else {
          setQuery("");
          // 关面板不丢草稿：editing 保留，重新打开还能接着改
          setFilling(null);
          // 对比视图也保留（结果是花了模型调用换来的），但流要停：
          // 面板已不可见，继续跑只会白烧 token
          if (reviewRef.current && reviewRef.current.busy) {
            const controller = abortRef.current;
            if (controller) controller.abort();
            setOptimizing(null);
            setReview((prev) => (prev ? { ...prev, busy: false, stopping: false } : prev));
          }
        }
      };

      const startDrag = (e) => {
        if (!panelPos || e.button !== 0) return;
        e.preventDefault();
        setDrag({ startX: e.clientX, startY: e.clientY, left: panelPos.left, top: panelPos.top });
      };

      const startResize = (dir) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.button !== 0) return;
        const { w, h } = panelBox(panelSize);
        setResizing({ dir, startX: e.clientX, startY: e.clientY, left: panelPos ? panelPos.left : GAP, top: panelPos ? panelPos.top : GAP, w, h });
      };

      // inputActions.insertText 会返回 false：草稿版本已变（面板打开期间用户改过字），
      // 或输入框正在 adjudicating/submitting/disposed。必须把返回值透传出去，
      // 否则用户只看到「点了没反应」。
      const insertText = (text) => {
        try {
          const span = inputActions.captureInsertion();
          return inputActions.insertText(text, span) === true;
        } catch (_) {
          return false;
        }
      };

      // 使用统计：插入成功即 touch，让 useCount / lastUsedAt 真实生效。
      // 失败不报错——统计是尽力而为，不该挡住插入。
      const touch = (snippetId) => {
        if (!snippetId) return;
        Promise.resolve(rpc.call(CHANNEL, "touch", { ids: [snippetId] })).catch(() => {});
      };

      // 发送当前草稿（Ctrl+Enter 插入并发送时调用；失败不打断，交给用户手动补救）。
      const submitDraft = () => {
        try {
          inputActions.submit();
        } catch (_) {
          setError(t("error.sendFailed"));
        }
      };

      // ────────── 插入：直插 / 按默认值插 / 弹表单 ──────────
      // sendAfter：插入成功后立即发送草稿。带必填占位符的片段仍需先填表单，
      // 无法自动发送，此时降级为「弹表单、填完手动发送」。
      const insert = (snippet, sendAfter = false) => {
        const plan = fillPlan(snippet);
        if (plan.kind === "form") {
          setFilling({ snippet, values: {} });
          setError(null);
          // 从命令面板（palette）触发时主面板是关闭的，表单渲染在 open 面板内部，
          // 必须同时打开主面板并定位，否则「按回车后表单被吞」。
          if (!open) {
            if (!panelPos) {
              const saved = loadSavedPos();
              setPanelPos(saved ? clampPos(saved.left, saved.top, panelSize) : clampPos(GAP, GAP, panelSize));
            }
            setOpen(true);
          }
          return;
        }
        const { tokens } = scanPlaceholders(snippet.content);
        const { text } = renderContent(tokens, snippet.variables || {}, {});
        if (!insertText(text)) {
          setError(t("error.insertFailedDraft"));
          return;
        }
        touch(snippet.id);
        setError(null);
        setOpen(false);
        if (sendAfter) {
          submitDraft();
        } else if (plan.kind === "defaults") {
          setNotice(t("notice.defaultsFilled"));
        }
      };

      const setFillValue = (name, value) => {
        setFilling((prev) => (prev ? { ...prev, values: { ...prev.values, [name]: value } } : prev));
      };

      const submitFill = () => {
        const cur = filling;
        if (!cur) return;
        const { tokens } = scanPlaceholders(cur.snippet.content);
        const { text, missing } = renderContent(tokens, cur.snippet.variables || {}, cur.values);
        if (missing.length > 0) return; // 按钮已禁用，这里只是兜底
        if (!insertText(text)) {
          setError(t("error.insertFailed"));
          return;
        }
        touch(cur.snippet.id);
        setFilling(null);
        setError(null);
        setOpen(false);
      };

      const insertRaw = () => {
        const cur = filling;
        if (!cur) return;
        if (!insertText(cur.snippet.content)) {
          setError(t("error.insertFailed"));
          return;
        }
        touch(cur.snippet.id);
        setFilling(null);
        setError(null);
        setOpen(false);
      };

      // ────────── 行内编辑 ──────────
      const beginEdit = (snippet) => {
        if (editing && editing.dirty) return; // 不偷偷丢别人的草稿
        setFilling(null);
        setHistory(null);
        setEditing({
          id: snippet.id,
          name: snippet.name,
          category: snippet.category || "",
          content: snippet.content,
          variables: { ...(snippet.variables || {}) },
          tags: Array.isArray(snippet.tags) ? snippet.tags.slice() : [],
          pinned: snippet.pinned === true,
          originalRevision: Number.isInteger(snippet.revision) ? snippet.revision : null,
          dirty: false,
          busy: false,
          conflict: null,
          hint: null,
          confirmCancel: false,
        });
        setTimeout(() => {
          if (nameRef.current) nameRef.current.focus();
        }, 0);
      };

      const beginCreate = () => {
        if (editing && editing.dirty) return;
        setFilling(null);
        setHistory(null);
        setEditing({
          id: null,
          name: "",
          category: "",
          content: "",
          variables: {},
          tags: [],
          pinned: false,
          originalRevision: null,
          dirty: false,
          busy: false,
          conflict: null,
          hint: null,
          confirmCancel: false,
        });
        setTimeout(() => {
          if (nameRef.current) nameRef.current.focus();
        }, 0);
      };

      const patchDraft = (patch) => {
        setEditing((prev) => (prev ? { ...prev, ...patch, dirty: true, confirmCancel: false } : prev));
      };

      const setVar = (name, patch) => {
        setEditing((prev) => {
          if (!prev) return prev;
          const current = prev.variables[name] || {};
          const next = { ...current, ...patch };
          // 清空非必填的无意义字段，让落盘数据保持干净
          if (next.label === "") delete next.label;
          if (next.default === "" && next.required !== true) delete next.default;
          if (next.required !== true) delete next.required;
          if (!Array.isArray(next.options) || next.options.length === 0) delete next.options;
          return { ...prev, variables: { ...prev.variables, [name]: next }, dirty: true, confirmCancel: false };
        });
      };

      const cancelEdit = () => {
        const cur = editing;
        if (!cur) return;
        // 脏草稿要二次确认：先变按钮文案，再点一次才真丢
        if (cur.dirty && !cur.confirmCancel) {
          setEditing({ ...cur, confirmCancel: true, hint: t("edit.confirmDiscard") });
          return;
        }
        setEditing(null);
      };

      const saveDraft = (force) => {
        const cur = editing;
        if (!cur || cur.busy) return;
        const name = cur.name.trim();
        if (!name) {
          setEditing({ ...cur, hint: t("error.nameEmpty") });
          return;
        }
        const payload = {
          name,
          content: cur.content,
          category: cur.category.trim() ? cur.category.trim() : null,
          variables: cur.variables,
          tags: cur.tags,
          pinned: cur.pinned === true,
        };
        if (cur.id) payload.id = cur.id;
        if (force) {
          payload.force = true;
        } else if (cur.originalRevision !== null) {
          payload.expectedRevision = cur.originalRevision;
        }
        setEditing({ ...cur, busy: true, hint: null, conflict: null });
        Promise.resolve(rpc.call(CHANNEL, "save", payload))
          .then((result) => {
            if (result && result.ok) {
              applyResult(result);
              setEditing(null);
              setNotice(cur.id ? t("notice.saved") : t("notice.created"));
              return;
            }
            const err = result && result.error;
            if (err && err.code === "conflict") {
              setEditing((prev) => (prev ? { ...prev, busy: false, conflict: err.message } : prev));
            } else {
              setEditing((prev) => (prev ? { ...prev, busy: false, hint: err ? err.message : t("error.saveFailed") } : prev));
            }
          })
          .catch((err) => {
            setEditing((prev) => (prev ? { ...prev, busy: false, hint: String((err && err.message) || err) } : prev));
          });
      };

      /** 冲突时「重新载入」：把服务器当前版本拉回草稿，丢弃本地改动。 */
      const reloadDraft = () => {
        const cur = editing;
        if (!cur || !cur.id) return;
        Promise.resolve(rpc.call(CHANNEL, "get", { id: cur.id }))
          .then((result) => {
            if (result && result.ok && result.value && result.value.snippet) {
              const s = result.value.snippet;
              setEditing({
                id: s.id,
                name: s.name,
                category: s.category || "",
                content: s.content,
                variables: { ...(s.variables || {}) },
                tags: Array.isArray(s.tags) ? s.tags.slice() : [],
                pinned: s.pinned === true,
                originalRevision: Number.isInteger(s.revision) ? s.revision : null,
                dirty: false,
                busy: false,
                conflict: null,
                hint: t("notice.loadedLatest"),
                confirmCancel: false,
              });
              // 不能拿 get 的结果去 applyResult：它的 value 只有 snippet，没有 snippets，
              // 会顺手把列表刷成空。列表刷新单独走 load()。
              load();
            } else {
              setEditing((prev) => (prev ? { ...prev, hint: t("error.reloadFailed") } : prev));
            }
          })
          .catch((err) => {
            setEditing((prev) => (prev ? { ...prev, hint: String((err && err.message) || err) } : prev));
          });
      };

      // ────────── §3.1 优化闭环：三态对比（不落盘、不直插）──────────
      // 老实现直接把 optimized 塞进输入框：用户看不到差异、不能拒绝，原文也回不去。
      // 现在只把结果摆进 review，落盘只发生在「替换片段正文」那一次 save。
      const MAX_RETRY = 3;
      const abortRef = useRef(null);

      const runOptimize = (snippet, retries, signal) => {
        Promise.resolve(rpc.call(CHANNEL, "optimize", { content: snippet.content }, signal))
          .then((result) => {
            setOptimizing(null);
            if (result && result.ok) {
              const value = result.value || {};
              setReview((prev) =>
                prev
                  ? {
                    ...prev,
                    optimized: String(value.optimized || ""),
                    truncated: value.truncated === true,
                    retries,
                    busy: false,
                    stopping: false,
                    error: null,
                  }
                  : prev,
              );
              return;
            }
            const err = (result && result.error) || {};
            // 用户主动取消不是错误：静默收起对比视图
            if (err.code === "aborted") {
              setReview(null);
              return;
            }
            setReview((prev) =>
              prev ? { ...prev, busy: false, stopping: false, error: err.message || t("error.optimizeFailed") } : prev,
            );
          })
          .catch((e) => {
            setOptimizing(null);
            setReview((prev) => (prev ? { ...prev, busy: false, stopping: false, error: msgOf(e) } : prev));
          });
      };

      const optimize = (snippet) => {
        if (optimizing) return;
        if (!optAvail.available) {
          setError(optAvail.reason || t("error.noModel"));
          return;
        }
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        abortRef.current = controller;
        setOptimizing(snippet.id);
        setError(null);
        setFilling(null);
        setReview({
          snippet,
          original: snippet.content,
          optimized: "",
          truncated: false,
          retries: 0,
          busy: true,
          stopping: false,
          saving: false,
          conflict: null,
          error: null,
        });
        runOptimize(snippet, 0, controller ? controller.signal : undefined);
      };

      const retryOptimize = () => {
        const cur = review;
        if (!cur || cur.busy || cur.retries >= MAX_RETRY) return;
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        abortRef.current = controller;
        setOptimizing(cur.snippet.id);
        setReview({ ...cur, busy: true, stopping: false, error: null, conflict: null, retries: cur.retries + 1 });
        runOptimize(cur.snippet, cur.retries + 1, controller ? controller.signal : undefined);
      };

      const stopOptimize = () => {
        const cur = review;
        if (!cur) return;
        if (!cur.busy) {
          setReview(null);
          return;
        }
        if (cur.stopping) return;
        setReview({ ...cur, stopping: true });
        const controller = abortRef.current;
        if (controller) controller.abort();
        // host 未接 signal 时也能退出：直接收起，不把用户困在等流里
        setOptimizing(null);
      };

      // 插入优化版：和普通插入同一条路，插入失败要把话说清楚
      const insertOptimized = () => {
        const cur = review;
        if (!cur || !cur.optimized) return;
        if (!insertText(cur.optimized)) {
          setError(t("error.insertFailedDraft"));
          return;
        }
        touch(cur.snippet.id);
        setReview(null);
        setError(null);
        setOpen(false);
      };

      const insertOriginal = () => {
        const cur = review;
        if (!cur) return;
        if (!insertText(cur.original)) {
          setError(t("error.insertFailedDraft"));
          return;
        }
        touch(cur.snippet.id);
        setReview(null);
        setError(null);
        setOpen(false);
      };

      /** 替换片段正文：唯一会落盘的动作，必须带 expectedRevision。 */
      const saveOptimized = (force) => {
        const cur = review;
        if (!cur || cur.busy || cur.saving) return;
        // 编辑后以实时字节数为准；force 覆盖仍放行超长（用户明确要覆盖）
        if (byteLen(cur.optimized) > MAX_CONTENT && !force) return;
        const s = cur.snippet;
        const payload = {
          id: s.id,
          name: s.name,
          content: cur.optimized,
          variables: s.variables || {},
        };
        // category 用 keepCategory 显式继承，避免把分类改没
        payload.keepCategory = true;
        if (force) payload.force = true;
        else if (typeof s.revision === "number") payload.expectedRevision = s.revision;
        setReview({ ...cur, saving: true, conflict: null, error: null });
        Promise.resolve(rpc.call(CHANNEL, "save", payload))
          .then((result) => {
            if (result && result.ok) {
              applyResult(result);
              setReview(null);
              setNotice(`已替换「${s.name}」正文`);
              return;
            }
            const err = (result && result.error) || {};
            if (err.code === "conflict") {
              setReview((prev) => (prev ? { ...prev, saving: false, conflict: err.message || t("error.conflict") } : prev));
              return;
            }
            setReview((prev) => (prev ? { ...prev, saving: false, error: err.message || t("error.replaceFailed") } : prev));
          })
          .catch((e) => {
            setReview((prev) => (prev ? { ...prev, saving: false, error: msgOf(e) } : prev));
          });
      };

      // ── 导出 / 导入（v1.2 §3.3）──
      // 导出：host 侧写到 <home>/data/prompt-snippets/exports/，这里只把路径告诉用户。
      // 导入：host 侧读文件，这里只传路径 + 模式。面板不做文件选择器——
      //   client 拿不到宿主文件系统，让用户在命令里填路径是最小惊讶的做法。
      const exportAll = () => {
        if (exporting) return;
        setExporting(true);
        setError(null);
        setExportPath(null);
        // write 让 host 侧落盘并回传绝对路径；文件名留空则用 host 的默认名。
        // reveal:true 让 host 用系统文件管理器直接打开/选中这个文件，免去手动找目录。
        Promise.resolve(rpc.call(CHANNEL, "export", { write: "", reveal: true }))
          .then((result) => {
            setExporting(false);
            if (result && result.ok) {
              const path = (result.value && result.value.path) || "";
              setExportPath(path);
              setNotice(`已导出 ${result.value.count} 条`);
              setError(null);
            } else {
              setError(result && result.error ? result.error.message : t("error.exportFailed"));
            }
          })
          .catch((err) => {
            setExporting(false);
            setError(String((err && err.message) || err));
          });
      };

      /** 在系统文件管理器中打开导出文件（复用 host 的 reveal 能力）。 */
      const revealExport = (path) => {
        if (!path) return;
        Promise.resolve(rpc.call(CHANNEL, "export", { revealPath: path })).catch(() => {});
      };

      const doImport = () => {
        if (importing) return;
        const target = importPath.trim();
        if (!target) {
          setError(t("error.importPathEmpty"));
          return;
        }
        setImporting(true);
        setError(null);
        setExportPath(null);
        Promise.resolve(rpc.call(CHANNEL, "import", { path: target, mode: importReplace ? "replace" : "merge" }))
          .then((result) => {
            setImporting(false);
            if (result && result.ok) {
              const p = result.value.plan;
              setNotice(t("notice.imported", { added: p.added, skipped: p.skipped ? t("notice.importedSkipped", { n: p.skipped }) : "", updated: p.updated ? t("notice.importedUpdated", { n: p.updated }) : "" }));
              setImportOpen(false);
              setImportPath("");
              setImportReplace(false);
              setError(null);
              load(); // 列表变了，重新拉一次
            } else {
              setError(result && result.error ? result.error.message : t("error.importFailed"));
            }
          })
          .catch((err) => {
            setImporting(false);
            setError(String((err && err.message) || err));
          });
      };

      const remove = (snippet) => {
        if (deleting) return;
        setDeleting(snippet.id);
        setError(null);
        Promise.resolve(rpc.call(CHANNEL, "delete", { id: snippet.id }))
          .then((result) => {
            setDeleting(null);
            if (result && result.ok) {
              applyResult(result);
              setDeleted((prev) => [{ id: snippet.id, name: snippet.name }, ...prev].slice(0, MAX_UNDO));
              // 删掉的正是正在编辑的那条：草稿没有意义了
              setEditing((prev) => (prev && prev.id === snippet.id ? null : prev));
            } else {
              setError(result && result.error ? result.error.message : t("error.deleteFailed"));
            }
          })
          .catch((err) => {
            setDeleting(null);
            setError(String((err && err.message) || err));
          });
      };

      const undoOne = (target) => {
        Promise.resolve(rpc.call(CHANNEL, "restore", { id: target.id }))
          .then((result) => {
            if (result && result.ok) {
              // 成功才从撤销条移除，失败保留入口让用户能重试（P1-5）
              setDeleted((prev) => prev.filter((x) => x.id !== target.id));
              applyResult(result);
            } else setError(result && result.error ? result.error.message : t("error.restoreFailed"));
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      const undoAll = () => {
        const targets = deleted.slice();
        if (targets.length === 0) return;
        Promise.all(
          targets.map((t) =>
            Promise.resolve(rpc.call(CHANNEL, "restore", { id: t.id }))
              .then((r) => (r && r.ok ? t.id : null))
              .catch(() => null),
          ),
        )
          .then((okIds) => {
            const good = okIds.filter((x) => x !== null);
            const bad = okIds.length - good.length;
            if (good.length > 0) {
              // 成功的从撤销条移除，失败的原样保留（P1-5）
              setDeleted((prev) => prev.filter((x) => !good.includes(x.id)));
            }
            if (bad > 0) setError(`${bad} 条恢复失败（可能名称已被占用）。`);
            load();
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      // v1.3 视图过滤：先按 query 搜索，再按 view 收窄（all/pinned/recent）。
      const base = useMemo(() => filterSnippets(snippets, query), [snippets, query]);
      const visible = useMemo(() => {
        if (view === "pinned") return base.filter((s) => s.pinned === true);
        if (view === "recent") {
          const ts = (s) =>
            Number.isFinite(s.lastUsedAt) ? s.lastUsedAt : Number.isFinite(s.updatedAt) ? s.updatedAt : 0;
          return base.slice().sort((a, b) => ts(b) - ts(a)).slice(0, 20);
        }
        return base;
      }, [base, view]);
      // §3.2 键盘导航：selected 是 visible 数组下标；query/snippets/view 一变就复位到 -1，
      // 避免旧的选中下标指向不同条目。
      useEffect(() => {
        setSelected(-1);
      }, [query, snippets, view]);
      const selectedSnippet = selected >= 0 && selected < visible.length ? visible[selected] : null;
      const trimmedQuery = query.trim();

      // ────────── 渲染：编辑器 ──────────
      const renderEditor = () => {
        const e = editing;
        // 动态宏变量（date/time/datetime）由插入时自动替换，不提供元数据编辑
        const names = varNamesOf(e.content).filter((n) => !isDynamic(n));
        return h(
          "div",
          { style: style.editor },
          e.conflict
            ? h(
              "div",
              { style: style.conflict },
              h("span", { style: { flex: 1, minWidth: 0 } }, "⚠ " + e.conflict),
              h(
                "button",
                { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: () => saveDraft(true) },
                t("edit.overwrite"),
              ),
              h(
                "button",
                { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: reloadDraft },
                t("edit.reload"),
              ),
            )
            : null,
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, t("edit.name")),
            h("input", {
              ref: nameRef,
              type: "text",
              className: "ps-input",
              style: style.input,
              value: e.name,
              placeholder: t("edit.namePlaceholder"),
              onChange: (ev) => patchDraft({ name: ev.target.value }),
            }),
          ),
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, t("edit.category")),
            h("input", {
              type: "text",
              className: "ps-input",
              style: style.input,
              value: e.category,
              placeholder: t("edit.categoryPlaceholder"),
              onChange: (ev) => patchDraft({ category: ev.target.value }),
            }),
          ),
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, t("edit.tags")),
            h("input", {
              type: "text",
              className: "ps-input",
              style: style.input,
              value: (e.tags || []).join("、"),
              placeholder: t("edit.tagsPlaceholder"),
              onChange: (ev) => {
                const tags = ev.target.value
                  .split(/[,，、]/)
                  .map((t) => t.trim())
                  .filter(Boolean);
                patchDraft({ tags });
              },
            }),
          ),
          h(
            "label",
            { style: { ...style.checkWrap, padding: "4px 0" } },
            h("input", {
              type: "checkbox",
              checked: e.pinned === true,
              onChange: (ev) => patchDraft({ pinned: ev.target.checked }),
            }),
            t("edit.pinned"),
          ),
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, t("edit.content")),
            h("textarea", {
              className: "ps-textarea",
              style: style.textarea,
              value: e.content,
              onChange: (ev) => patchDraft({ content: ev.target.value }),
            }),
          ),
          names.length > 0
            ? h(
              "div",
              null,
              h("div", { style: style.label }, t("edit.variables")),
              names.map((nm) => {
                const d = e.variables[nm] || {};
                return h(
                  "div",
                  { key: nm, style: style.varRow },
                  h("span", { style: style.varName }, "{{" + nm + "}}"),
                  h(
                    "label",
                    { style: style.checkWrap },
                    h("input", {
                      type: "checkbox",
                      checked: d.required === true,
                      onChange: (ev) => setVar(nm, { required: ev.target.checked }),
                    }),
                    t("edit.required"),
                  ),
                  h("input", {
                    type: "text",
                    className: "ps-input",
                    style: { ...style.input, flex: "1 1 90px", width: "auto" },
                    value: typeof d.default === "string" ? d.default : "",
                    placeholder: t("edit.defaultPlaceholder"),
                    onChange: (ev) => setVar(nm, { default: ev.target.value }),
                  }),
                  h("input", {
                    type: "text",
                    className: "ps-input",
                    style: { ...style.input, flex: "1 1 90px", width: "auto" },
                    value: Array.isArray(d.options) ? d.options.join("、") : "",
                    placeholder: t("edit.enumPlaceholder"),
                    title: t("edit.enumTitle"),
                    onChange: (ev) => {
                      const options = ev.target.value
                        .split(/[,，、]/)
                        .map((t) => t.trim())
                        .filter(Boolean);
                      setVar(nm, options.length > 0 ? { options } : { options: undefined });
                    },
                  }),
                );
              }),
            )
            : null,
          e.hint ? h("div", { style: style.hintInline }, e.hint) : null,
          h(
            "div",
            { style: style.actions },
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: cancelEdit },
              e.confirmCancel ? t("edit.confirmCancel") : t("edit.cancel"),
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-primary",
                style: e.busy ? { ...style.btnPrimary, ...style.btnDisabled } : style.btnPrimary,
                disabled: e.busy,
                onClick: () => saveDraft(false),
              },
              e.busy ? t("edit.saving") : t("edit.save"),
            ),
          ),
        );
      };

      // ────────── 渲染：占位符表单 ──────────
      const renderFillForm = () => {
        const cur = filling;
        // 动态宏变量（date/time/datetime）不弹输入框，插入时自动替换，只列用户变量
        const names = varNamesOf(cur.snippet.content).filter((n) => !isDynamic(n));
        const vars = cur.snippet.variables || {};
        const { tokens } = scanPlaceholders(cur.snippet.content);
        const { missing } = renderContent(tokens, vars, cur.values);
        const blocked = missing.length > 0;
        return h(
          "div",
          { style: style.editor },
          h("div", { style: style.label }, `填写「${cur.snippet.name}」的占位符`),
          names.map((nm) => {
            const d = vars[nm] || {};
            const required = d.required === true;
            const opts = Array.isArray(d.options) ? d.options : [];
            const label = (typeof d.label === "string" && d.label ? d.label : nm) + (required ? t("fill.requiredSuffix") : "");
            const val = typeof cur.values[nm] === "string" ? cur.values[nm] : "";
            // 长文本变量（变量名带「代码/原文/记录/要点/说明/内容/text/body」或已含换行）用 textarea，
            // 单行 input 会吃掉换行，粘贴多行代码/会议记录没法看。
            const multiline =
              /代码|code|原文|记录|要点|说明|内容|text|body/i.test(nm) || (typeof val === "string" && val.includes("\n"));
            return h(
              "label",
              { key: nm, style: style.field },
              h("span", { style: style.label }, label),
              opts.length > 0
                ? h(
                  "select",
                  {
                    className: "ps-select",
                    style: style.select,
                    value: val,
                    onChange: (ev) => setFillValue(nm, ev.target.value),
                  },
                  // 非必填给一个空选项，让用户能「不填」（走变量名留空语义）
                  !required ? h("option", { value: "" }, t("fill.empty")) : null,
                  opts.map((o) => h("option", { key: o, value: o }, o)),
                )
                : multiline
                  ? h("textarea", {
                    className: "ps-textarea",
                    style: { ...style.textarea, minHeight: "54px" },
                    value: val,
                    placeholder: typeof d.default === "string" ? d.default : "",
                    onChange: (ev) => setFillValue(nm, ev.target.value),
                  })
                  : h("input", {
                    type: "text",
                    className: "ps-input",
                    style: style.input,
                    value: val,
                    placeholder: typeof d.default === "string" ? d.default : "",
                    onChange: (ev) => setFillValue(nm, ev.target.value),
                  }),
            );
          }),
          h(
            "div",
            { style: style.actions },
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: () => setFilling(null) },
              t("fill.cancel"),
            ),
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: insertRaw },
              t("fill.keepRaw"),
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-primary",
                style: blocked ? { ...style.btnPrimary, ...style.btnDisabled } : style.btnPrimary,
                disabled: blocked,
                onClick: submitFill,
              },
              t("fill.insert"),
            ),
          ),
        );
      };

      /** §3.1 三态对比视图：原文 / 优化后并排，落盘与否由用户决定。 */
      const renderReview = () => {
        const cur = review;
        if (!cur) return null;
        // 客户端独立再校验一次占位符：host 也校验，但传输/降级路径不能只信上游
        const before = scanPlaceholders(cur.original).names;
        const after = new Set(scanPlaceholders(cur.optimized).names);
        const lost = before.filter((n) => !after.has(n));
        // 编辑后超长要实时重算，不能沿用 host 首次返回的 truncated 标记（用户可能已删短）
        const overLong = byteLen(cur.optimized) > MAX_CONTENT;
        const retryLeft = MAX_RETRY - cur.retries;
        const canRetry = !cur.busy && retryLeft > 0;
        const canReplace = !cur.busy && !cur.saving && !overLong && lost.length === 0 && !!cur.optimized;
        const optTitle = overLong
          ? t("review.overLong")
          : lost.length > 0
            ? `优化结果丢失了占位符 ${lost.map((n) => `{{${n}}}`).join("、")}`
            : t("review.replacePrompt");
        return h(
          "div",
          { style: style.reviewWrap },
          h(
            "div",
            { style: style.reviewBox },
            h("div", { style: style.label }, `✨ 优化「${cur.snippet.name}」`),
            h(
              "div",
              { style: style.reviewCols },
              h(
                "div",
                { style: style.reviewCol },
                h("div", { style: style.label }, t("review.original")),
                h("div", { style: style.reviewPane }, cur.original),
              ),
              h(
                "div",
                { style: style.reviewCol },
                h("div", { style: style.label }, cur.busy ? t("review.optimized") : t("review.optimizedEditable")),
                h(
                  "textarea",
                  {
                    className: "ps-textarea",
                    style: style.reviewInput,
                    value: cur.busy ? "" : cur.optimized,
                    disabled: cur.busy,
                    placeholder: cur.busy ? (cur.stopping ? t("review.stopping") : t("review.generating")) : t("review.empty"),
                    onChange: (ev) =>
                      setReview((prev) => (prev ? { ...prev, optimized: ev.target.value } : prev)),
                  },
                ),
              ),
            ),
            h(
              "div",
              { style: style.reviewMeta },
              h("span", null, `字节 ${byteLen(cur.original)} → ${byteLen(cur.optimized)}`),
              before.length > 0
                ? h(
                  "span",
                  { style: lost.length > 0 ? style.reviewLost : style.reviewKeep },
                  lost.length > 0
                    ? `占位符丢失：${lost.map((n) => `{{${n}}}`).join("、")}`
                    : `占位符 ${before.map((n) => `{{${n}}}`).join("、")} 已保留 ✓`,
                )
                : null,
              cur.retries > 0 ? h("span", null, `已重试 ${cur.retries} 次`) : null,
              overLong ? h("span", { style: style.reviewLost }, t("review.overLongWarning")) : null,
            ),
            cur.conflict
              ? h(
                "div",
                { style: style.conflict },
                h("span", { style: style.reviewLost }, cur.conflict),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ps-ghost",
                    style: style.btnGhost,
                    onClick: () => saveOptimized(true),
                    disabled: cur.saving,
                  },
                  t("review.applyOverwrite"),
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ps-ghost",
                    style: style.btnGhost,
                    onClick: () => setReview((prev) => (prev ? { ...prev, conflict: null } : prev)),
                  },
                  t("review.discard"),
                ),
              )
              : null,
            cur.error ? h("div", { style: style.hintInline }, "⚠ " + cur.error) : null,
            h(
              "div",
              { style: style.actions },
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: style.btnGhost,
                  onClick: insertOriginal,
                  disabled: cur.busy,
                  title: t("review.keepOriginalTitle"),
                },
                t("review.keepOriginal"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: style.btnGhost,
                  onClick: stopOptimize,
                  title: cur.busy ? t("review.cancelOptimize") : t("review.close"),
                },
                cur.busy ? (cur.stopping ? t("review.cancelling") : t("review.cancel")) : "✕",
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: canRetry ? style.btnGhost : { ...style.btnGhost, ...style.btnDisabled },
                  onClick: retryOptimize,
                  disabled: !canRetry,
                  title: canRetry ? t("review.retryTitle") : t("review.retryMaxTitle", { n: MAX_RETRY }),
                },
                canRetry ? t("review.retry") : t("review.retryMaxTitle", { n: MAX_RETRY }),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: canReplace ? style.btnGhost : { ...style.btnGhost, ...style.btnDisabled },
                  onClick: () => saveOptimized(false),
                  disabled: !canReplace,
                  title: optTitle,
                },
                cur.saving ? t("review.replacing") : t("review.replaceContent"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-primary",
                  style: cur.busy || !cur.optimized ? { ...style.btnPrimary, ...style.btnDisabled } : style.btnPrimary,
                  onClick: insertOptimized,
                  disabled: cur.busy || !cur.optimized,
                  title: t("review.insertOptimizedTitle"),
                },
                t("review.insertOptimized"),
              ),
            ),
          ),
        );
      };

      const rowOf = (s, idx) =>
        h(
          "div",
          { key: s.id },
          h(
            "div",
            { style: style.itemRow },
            h(
              "button",
              {
                type: "button",
                className: "ps-item",
                style:
                  editing && editing.id === s.id
                    ? { ...style.item, ...style.itemEditing }
                    : selected === idx
                      ? { ...style.item, ...style.itemSelected }
                      : style.item,
                onClick: () => insert(s),
                onMouseEnter: () => setSelected(idx),
                title: t("item.insertTitle", { content: s.content }),
              },
              ...(s.pinned === true ? [h("span", { style: style.pinStar }, "★ ")] : []),
              highlightText(s.name, trimmedQuery),
              ...((s.tags || []).map((t) => h("span", { key: t, style: style.tagChip }, t))),
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: readOnly ? { ...style.icon, ...style.iconBusy } : style.icon,
                onClick: () => beginEdit(s),
                disabled: readOnly || (editing !== null && editing.id !== s.id && editing.dirty),
                title: readOnly ? t("item.editReadonly") : t("item.edit"),
                "aria-label": `编辑「${s.name}」`,
              },
              "✏️",
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: history && history.id === s.id ? { ...style.icon, ...style.itemEditing } : style.icon,
                onClick: () => showHistory(s),
                title: t("item.history"),
                "aria-label": `历史「${s.name}」`,
              },
              "🕘",
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style:
                  optimizing === s.id
                    ? { ...style.icon, ...style.iconBusy }
                    : optAvail.available
                      ? style.icon
                      : { ...style.icon, ...style.iconBusy },
                onClick: () => optimize(s),
                // 无默认模型时直接置灰：不要留到点击才报错（ROADMAP §3.1）
                disabled: optimizing !== null || !optAvail.available,
                title: optAvail.available ? t("item.optimize") : optAvail.reason || t("item.noModel"),
                "aria-label": `AI 优化「${s.name}」`,
              },
              optimizing === s.id ? "…" : "✨",
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: { ...style.icon, ...style.del },
                onClick: () => remove(s),
                disabled: readOnly || deleting !== null,
                title: readOnly ? t("item.deleteReadonly") : t("item.delete"),
                "aria-label": `删除「${s.name}」`,
              },
              deleting === s.id ? "…" : "🗑",
            ),
          ),
          editing && editing.id === s.id ? renderEditor() : null,
        );

      const listContent = groupByCategory(visible).map(([category, list]) =>
        h(
          "div",
          { key: category || "__none__" },
          category
            ? h(
              "div",
              { style: style.group },
              category,
              view === "pinned" ? h("span", { style: style.groupStar }, " ★") : null,
            )
            : null,
          list.map((s) => rowOf(s, visible.indexOf(s))),
        ),
      );

      const showHistory = (snippet) => {
        if (history && history.id === snippet.id) {
          setHistory(null);
          return;
        }
        setHistory({ id: snippet.id, name: snippet.name, list: [], busy: true });
        Promise.resolve(rpc.call(CHANNEL, "history", { id: snippet.id }))
          .then((result) => {
            const list = result && result.ok && result.value ? result.value.history || [] : [];
            setHistory((prev) => (prev && prev.id === snippet.id ? { ...prev, list, busy: false } : prev));
          })
          .catch(() => {
            setHistory((prev) => (prev && prev.id === snippet.id ? { ...prev, list: [], busy: false } : prev));
          });
      };

      const renderPalette = () => {
        if (!paletteOpen) return null;
        return h(
          "div",
          { style: style.paletteOverlay, onMouseDown: (e) => { if (e.target === e.currentTarget) closePalette(); } },
          h(
            "div",
            { style: style.paletteBox },
            h("input", {
              ref: paletteInputRef,
              type: "text",
              className: "ps-search",
              style: style.paletteInput,
              placeholder: t("palette.searchPlaceholder"),
              value: paletteQuery,
              onChange: (e) => {
                setPaletteQuery(e.target.value);
                setPaletteSelected(-1);
              },
              onKeyDown: (e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (paletteResults.length === 0) return;
                  setPaletteSelected((prev) => (prev + 1) % paletteResults.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (paletteResults.length === 0) return;
                  setPaletteSelected((prev) => (prev <= 0 ? paletteResults.length - 1 : prev - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = paletteSelected >= 0 ? paletteResults[paletteSelected] : paletteResults[0];
                  // Enter 插入；Ctrl+Enter / Meta+Enter 插入并立即发送。
                  if (pick) paletteChoose(pick, e.ctrlKey || e.metaKey);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closePalette();
                }
              },
            }),
            h(
              "div",
              { style: style.paletteList, ref: paletteListRef },
              paletteResults.length === 0
                ? h("div", { style: style.empty }, snippets.length === 0 ? t("palette.empty") : t("palette.noMatch", { query: paletteQuery }))
                : paletteResults.map((s, i) =>
                  h(
                    "button",
                    {
                      key: s.id,
                      type: "button",
                      className: "ps-item",
                      "data-ps-index": i,
                      style: i === paletteSelected ? style.paletteRowActive : style.paletteRow,
                      onMouseEnter: () => setPaletteSelected(i),
                      onClick: () => paletteChoose(s),
                    },
                    s.pinned === true ? h("span", { style: style.pinStar }, "★ ") : null,
                    h("span", { style: style.paletteName }, highlightText(s.name, paletteQuery.trim())),
                    h(
                      "span",
                      { style: style.paletteMeta },
                      [s.category, (s.tags || []).join(" · ")].filter(Boolean).join(" · ") || t("palette.noCategory"),
                    ),
                  ),
                ),
            ),
            h(
              "div",
              { style: style.paletteHint },
              t("palette.hint"),
            ),
          ),
        );
      };

      const renderHistory = () => {
        const hh = history;
        if (!hh) return null;
        return h(
          "div",
          { style: style.historyWrap },
          h(
            "div",
            { style: style.historyBox },
            h("div", { style: style.label }, `历史版本 ·「${hh.name}」`),
            hh.busy
              ? h("div", { style: style.hintInline }, t("history.loading"))
              : hh.list.length === 0
                ? h("div", { style: style.hintInline }, t("history.empty"))
                : hh.list.map((v, i) =>
                  h(
                    "div",
                    { key: i, style: style.historyRow },
                    h("span", { style: style.historyMeta }, `#${v.revision ?? i + 1}`),
                    h(
                      "div",
                      { style: style.historyContent },
                      h(
                        "div",
                        { style: { color: C.textDim, fontSize: "10px" } },
                        `保存于 ${fmtTime(v.at)} · `,
                        h(
                          "span",
                          {
                            style: style.historyLink,
                            role: "button",
                            tabIndex: 0,
                            onClick: () => {
                              if (!insertText(v.content)) {
                                setError(t("error.insertFailed"));
                                return;
                              }
                              setError(null);
                              setNotice(t("notice.historyInserted"));
                            },
                            onKeyDown: (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                if (!insertText(v.content)) {
                                  setError(t("error.insertFailed"));
                                  return;
                                }
                                setError(null);
                                setNotice(t("notice.historyInserted"));
                              }
                            },
                            title: t("history.insertTitle"),
                          },
                          t("history.insert"),
                        ),
                      ),
                      v.content,
                    ),
                  ),
                ),
          ),
        );
      };

      const bodyContent = error
        ? h("div", { style: style.error }, "⚠ " + error)
        : snippets.length === 0
          ? h("div", { style: style.empty }, t("panel.empty"))
          : visible.length === 0
            ? h(
              "div",
              { style: style.empty },
              `没有匹配「${query}」的片段。`,
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: { ...style.btnGhost, marginTop: "8px" },
                  onClick: () => {
                    setQuery("");
                    setSelected(-1);
                    beginCreate();
                    setTimeout(() => {
                      if (nameRef.current) nameRef.current.value = trimmedQuery;
                      if (nameRef.current) nameRef.current.focus();
                    }, 0);
                  },
                  title: t("panel.newTitle"),
                },
                trimmedQuery ? t("panel.newFromQuery", { query: trimmedQuery }) : t("panel.new"),
              ),
            )
            : listContent;

      return h(
        "div",
        { style: style.dock },
        h(
          "button",
          {
            id: "ps-button",
            type: "button",
            className: "ps-btn",
            style: style.button,
            onClick: toggle,
            title: t("panel.title"),
            "aria-expanded": open ? "true" : "false",
          },
          t("panel.button"),
        ),
        notice ? h("span", { className: "ps-notice", style: style.notice }, notice) : null,
        renderPalette(),
        open &&
          h(
            "div",
            {
              id: "ps-panel",
              className: "ps-panel",
              ref: panelRef,
              role: "dialog",
              "aria-label": t("panel.ariaLabel"),
              style: {
                ...style.panel,
                left: (panelPos ? panelPos.left : GAP) + "px",
                top: (panelPos ? panelPos.top : GAP) + "px",
                // 自定义尺寸（已按视口夹取）才覆盖默认的 min() 收窄；无自定义时沿用 style.panel
                // 关键：高度必须用 height 固定，不能用 maxHeight——maxHeight 只是上限，
                // 内容不足时面板不会撑到指定高，拖右下角「放大高度」会看起来没反应。
                // 固定 height 后 body 靠 flex:1 + overflow:auto 滚动，行为正确。
                ...(panelSize
                  ? { width: panelSize.w + "px", height: panelSize.h + "px", maxHeight: "none" }
                  : {}),
              },
            },
            h("div", { style: style.resizeN, onMouseDown: startResize("n"), title: t("panel.resizeHeight"), "aria-label": t("panel.resizeHeight") }),
            h("div", { style: style.resizeS, onMouseDown: startResize("s"), title: t("panel.resizeHeight"), "aria-label": t("panel.resizeHeight") }),
            h("div", { style: style.resizeW, onMouseDown: startResize("w"), title: t("panel.resizeWidth"), "aria-label": t("panel.resizeWidth") }),
            h("div", { style: style.resizeE, onMouseDown: startResize("e"), title: t("panel.resizeWidth"), "aria-label": t("panel.resizeWidth") }),
            h("div", { style: style.resizeNW, onMouseDown: startResize("nw"), title: t("panel.resizeSize"), "aria-label": t("panel.resizeSize") }),
            h("div", { style: style.resizeSW, onMouseDown: startResize("sw"), title: t("panel.resizeSize"), "aria-label": t("panel.resizeSize") }),
            h("div", { style: style.resizeSE, onMouseDown: startResize("se"), title: t("panel.resizeSize"), "aria-label": t("panel.resizeSize") }),
            h(
              "div",
              { style: style.header, onMouseDown: startDrag, title: t("panel.dragTitle") },
              h("span", { style: style.headerTitle }, t("panel.button")),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-close",
                  style: style.close,
                  title: t("panel.close"),
                  "aria-label": t("panel.closeAria"),
                  onMouseDown: (e) => e.stopPropagation(),
                  onClick: () => setOpen(false),
                },
                "×",
              ),
            ),
            warning ? h("div", { className: "ps-warn", style: style.warn }, "⚠ " + warning) : null,
            h(
              "div",
              { style: style.searchWrap },
              h(
                "div",
                { style: style.searchRow },
                h("input", {
                  ref: searchRef,
                  type: "text",
                  className: "ps-search",
                  style: style.search,
                  placeholder: t("panel.searchPlaceholder"),
                  value: query,
                  onChange: (e) => {
                    setQuery(e.target.value);
                    setSelected(-1);
                  },
                  onMouseDown: (e) => e.stopPropagation(),
                  onKeyDown: (e) => {
                    // §3.2 键盘导航：↑↓ 移动选中，Enter 插入选中，Esc 分层退出
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (visible.length === 0) return;
                      setSelected((prev) => (prev + 1) % visible.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (visible.length === 0) return;
                      setSelected((prev) => (prev <= 0 ? visible.length - 1 : prev - 1));
                      return;
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (selectedSnippet) insert(selectedSnippet);
                      return;
                    }
                    if (e.key !== "Escape") return;
                    // 有表单/草稿/对比视图时先退一层，不直接关面板
                    if (review) {
                      if (review.busy) stopOptimize();
                      else setReview(null);
                    } else if (filling) setFilling(null);
                    else if (editing) cancelEdit();
                    else if (query) setQuery("");
                    else setOpen(false);
                  },
                }),
                query.trim()
                  ? h("span", { style: style.searchCount }, `${selected >= 0 ? selected + 1 : "-"}/${visible.length}`)
                  : null,
              ),
            ),
            review ? renderReview() : null,
            filling ? h("div", { style: style.formWrap }, renderFillForm()) : null,
            h(
              "div",
              { style: style.viewBar },
              h(
                "button",
                {
                  type: "button",
                  className: "ps-view",
                  style: view === "all" ? style.viewBtnActive : style.viewBtn,
                  onClick: () => setView("all"),
                },
                t("panel.all"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-view",
                  style: view === "pinned" ? style.viewBtnActive : style.viewBtn,
                  onClick: () => setView("pinned"),
                  title: t("panel.pinnedTitle"),
                },
                t("panel.pinned"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-view",
                  style: view === "recent" ? style.viewBtnActive : style.viewBtn,
                  onClick: () => setView("recent"),
                  title: t("panel.recentTitle"),
                },
                t("panel.recent"),
              ),
            ),
            history ? renderHistory() : null,
            h("div", { className: "ps-body", style: style.body }, bodyContent),
            editing && editing.id === null
              ? h("div", { style: style.formWrap }, renderEditor())
              : h(
                "div",
                { style: style.addRow },
                h("span", { style: style.addRowInner },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ps-ghost",
                      style: readOnly ? { ...style.btnGhost, ...style.btnDisabled } : style.btnGhost,
                      onClick: beginCreate,
                      disabled: readOnly || (editing !== null && editing.dirty),
                      title: readOnly ? t("panel.newBtnReadonly") : t("panel.newBtnTitle"),
                    },
                    t("panel.newBtn"),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ps-ghost",
                      style: exporting ? { ...style.btnGhost, ...style.btnDisabled } : style.btnGhost,
                      onClick: exportAll,
                      disabled: exporting || snippets.length === 0,
                      title: t("panel.exportTitle"),
                    },
                    exporting ? t("panel.exporting") : t("panel.export"),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ps-ghost",
                      style: importOpen ? { ...style.btnGhost, ...style.itemEditing } : style.btnGhost,
                      onClick: () => {
                        setImportOpen((prev) => !prev);
                        setError(null);
                      },
                      disabled: readOnly,
                      title: readOnly ? t("panel.importReadonly") : t("panel.importTitle"),
                    },
                    t("panel.import"),
                  ),
                ),
              ),
            importOpen
              ? h(
                "div",
                { style: style.formWrap },
                h(
                  "div",
                  { style: style.editor },
                  h("div", { style: style.label }, t("panel.importPathLabel")),
                  h("input", {
                    type: "text",
                    className: "ps-input",
                    style: style.input,
                    value: importPath,
                    placeholder: t("panel.importPathPlaceholder"),
                    onChange: (e) => setImportPath(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === "Enter") doImport();
                      if (e.key === "Escape") setImportOpen(false);
                    },
                  }),
                  h(
                    "label",
                    { style: style.checkWrap },
                    h("input", {
                      type: "checkbox",
                      checked: importReplace,
                      onChange: (e) => setImportReplace(e.target.checked),
                    }),
                    h("span", { style: style.label }, t("panel.importReplaceLabel")),
                  ),
                  h(
                    "div",
                    { style: style.actions },
                    h(
                      "button",
                      { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: () => setImportOpen(false) },
                      t("panel.cancel"),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "ps-primary",
                        style: importing ? { ...style.btnPrimary, ...style.btnDisabled } : style.btnPrimary,
                        disabled: importing,
                        onClick: doImport,
                      },
                      importing ? t("panel.importing") : t("panel.importBtn"),
                    ),
                  ),
                ),
              )
              : null,
            exportPath
              ? h(
                "div",
                { style: style.exportBar },
                h("span", { style: style.exportText, title: exportPath }, "📄 " + exportPath),
                h(
                  "button",
                  {
                    type: "button",
                    className: "ps-ghost",
                    style: { ...style.btnGhost, padding: "1px 8px", fontSize: "11px" },
                    onClick: () => revealExport(exportPath),
                    title: t("panel.openFileTitle"),
                  },
                  t("panel.openFile"),
                ),
              )
              : null,
            deleted.length > 0
              ? h(
                "div",
                { style: style.undoBar },
                h(
                  "span",
                  { style: style.undoText },
                  deleted.length === 1 ? `已删除「${deleted[0].name}」` : `已删除 ${deleted.length} 条`,
                ),
                deleted.map((d) =>
                  h(
                    "button",
                    {
                      key: d.id,
                      type: "button",
                      className: "ps-undo",
                      style: style.undoChip,
                      onClick: () => undoOne(d),
                      title: `恢复「${d.name}」`,
                    },
                    "↩ " + d.name,
                  ),
                ),
                deleted.length > 1
                  ? h(
                    "button",
                    { type: "button", className: "ps-undo", style: style.undoBtn, onClick: undoAll },
                    t("panel.undoAll"),
                  )
                  : null,
              )
              : null,
            h(
              "div",
              { style: style.hint },
              t("panel.footer"),
            ),
          ),
      );
    }

    return {
      inject: ["slots", "connection", "locale"],
      apply(ctx) {
        ctx.effect(() => mountCss(THEME_CSS, "dsh-prompt-snippets/theme.css"), "prompt-snippets theme");
        const rpc = ctx.connection.rpc;
        // 注册 i18n 字典并绑定翻译函数；测试环境无 locale 服务时降级到 zh。
        let t;
        let localeSubscribe = null;
        if (ctx.locale && typeof ctx.locale.register === "function") {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), "prompt-snippets dictionaries");
          t = ctx.locale.bind(NS);
          localeSubscribe = ctx.locale.subscribe.bind(ctx.locale);
        } else {
          t = (key, params) => {
            const template = zh[key] ?? key;
            if (!params) return template;
            return template.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m));
          };
        }
        ctx.slots.inject("conversation.input.right", () =>
          ctx.slots.register(
            {
              name: "conversation.input.right",
              id: "prompt-snippets",
              order: 10,
              inject: () => ({ rpc, t, localeSubscribe }),
            },
            SnippetDock,
          ),
        );
      },
    };
  },
});
