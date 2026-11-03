window.__ModuleLoader__.load({
  id: "dsh-prompt-snippets",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

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

.ps-btn:hover, .ps-icon:hover, .ps-item:hover, .ps-undo:hover,
.ps-primary:hover, .ps-ghost:hover { background: ${C.surfaceHover} !important; }
.ps-primary:disabled, .ps-ghost:disabled { background: transparent !important; }
.ps-close:hover { color: var(--dsw-alias-label-primary); }

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
      dock: { display: "inline-flex", gap: "4px", alignItems: "center", padding: "2px 0" },
      button: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        fontSize: "12px",
        lineHeight: "1.5",
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
      checkWrap: { display: "inline-flex", alignItems: "center", gap: "3px", color: C.textDim, flexShrink: 0 },
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

    /** 大小写不敏感、命中名称/分类/内容任一处。 */
    function filterSnippets(snippets, query) {
      const q = query.trim().toLowerCase();
      if (!q) return snippets;
      return snippets.filter((s) => {
        const hay = `${s.name}\n${s.category || ""}\n${s.content}`.toLowerCase();
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
     *   direct   —— 没有变量，直接插入
     *   defaults —— 变量全都非必填且都有默认值，按默认值直接插入
     *   form     —— 有必填变量，或缺默认值 / 没有 variables 元数据（旧数据），弹表单
     */
    function fillPlan(snippet) {
      const { names } = scanPlaceholders(snippet.content || "");
      if (names.length === 0) return { kind: "direct" };
      const vars = snippet.variables || {};
      const allDefaulted = names.every((n) => {
        const d = vars[n];
        return !!d && d.required !== true && typeof d.default === "string" && d.default.trim() !== "";
      });
      return allDefaulted ? { kind: "defaults" } : { kind: "form" };
    }

    /** 正文里出现的变量名（首次出现顺序），供变量编辑器与表单共用。 */
    function varNamesOf(content) {
      return scanPlaceholders(content || "").names;
    }

    /** 撤销栈上限：ROADMAP §2.4「记住最近 5 条」。 */
    const MAX_UNDO = 5;

    /** 把 throw 出来的任意值转成一句能看的错误文案。 */
    function msgOf(err) {
      if (!err) return "未知错误";
      if (typeof err === "string") return err;
      return String(err.message || err);
    }

    /** 字节数（UTF-8）：对比栏要显示「42 → 118」，按字节比按字数更贴近 token 量。 */
    function byteLen(text) {
      const s = String(text || "");
      if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
      return s.length;
    }

    /** 与 host 侧 MAX_CONTENT 一致：编辑后实时重算是否超长，不能只信 host 首次返回的 truncated。 */
    const MAX_CONTENT = 200_000;

    function SnippetDock({ inputActions, rpc }) {
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
      const searchRef = useRef(null);
      const nameRef = useRef(null);
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
          setError(result && result.error ? result.error.message : "读取失败");
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

      // 拖拽：依赖 drag 起始快照，mousemove 用快照计算，结束保存
      useEffect(() => {
        if (!drag) return;
        const onMove = (e) => {
          setPanelPos(clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY), panelSize));
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
          setPanelSize(size);
          setPanelPos(pos);
          return { size, pos };
        };
        const onMove = (e) => { apply(e); };
        const onUp = (e) => {
          const { size, pos } = apply(e);
          saveSize(size);
          savePos(pos);
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

      // ────────── 插入：直插 / 按默认值插 / 弹表单 ──────────
      const insert = (snippet) => {
        const plan = fillPlan(snippet);
        if (plan.kind === "form") {
          setFilling({ snippet, values: {} });
          setError(null);
          return;
        }
        const { tokens } = scanPlaceholders(snippet.content);
        const { text } = renderContent(tokens, snippet.variables || {}, {});
        if (!insertText(text)) {
          setError("插入失败：请先把光标放进输入框再试（草稿可能在面板打开期间被改动）。");
          return;
        }
        touch(snippet.id);
        setError(null);
        setOpen(false);
        if (plan.kind === "defaults") setNotice("已用默认值填充，可在 ✏️ 里改");
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
          setError("插入失败：请先把光标放进输入框再试。");
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
          setError("插入失败：请先把光标放进输入框再试。");
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
        setEditing({
          id: snippet.id,
          name: snippet.name,
          category: snippet.category || "",
          content: snippet.content,
          variables: { ...(snippet.variables || {}) },
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
        setEditing({
          id: null,
          name: "",
          category: "",
          content: "",
          variables: {},
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
          return { ...prev, variables: { ...prev.variables, [name]: next }, dirty: true, confirmCancel: false };
        });
      };

      const cancelEdit = () => {
        const cur = editing;
        if (!cur) return;
        // 脏草稿要二次确认：先变按钮文案，再点一次才真丢
        if (cur.dirty && !cur.confirmCancel) {
          setEditing({ ...cur, confirmCancel: true, hint: "草稿还没保存，再点一次「确认放弃」才会丢弃。" });
          return;
        }
        setEditing(null);
      };

      const saveDraft = (force) => {
        const cur = editing;
        if (!cur || cur.busy) return;
        const name = cur.name.trim();
        if (!name) {
          setEditing({ ...cur, hint: "片段名称不能为空。" });
          return;
        }
        const payload = {
          name,
          content: cur.content,
          category: cur.category.trim() ? cur.category.trim() : null,
          variables: cur.variables,
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
              setNotice(cur.id ? "已保存" : "已新建");
              return;
            }
            const err = result && result.error;
            if (err && err.code === "conflict") {
              setEditing((prev) => (prev ? { ...prev, busy: false, conflict: err.message } : prev));
            } else {
              setEditing((prev) => (prev ? { ...prev, busy: false, hint: err ? err.message : "保存失败" } : prev));
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
                originalRevision: Number.isInteger(s.revision) ? s.revision : null,
                dirty: false,
                busy: false,
                conflict: null,
                hint: "已载入服务器上的最新版本。",
                confirmCancel: false,
              });
              // 不能拿 get 的结果去 applyResult：它的 value 只有 snippet，没有 snippets，
              // 会顺手把列表刷成空。列表刷新单独走 load()。
              load();
            } else {
              setEditing((prev) => (prev ? { ...prev, hint: "重新载入失败：该片段可能已被删除。" } : prev));
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
                  : prev
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
              prev ? { ...prev, busy: false, stopping: false, error: err.message || "优化失败" } : prev
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
          setError(optAvail.reason || "当前未配置默认模型，无法优化");
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
          setError("插入失败：请先把光标放进输入框再试（草稿可能在面板打开期间被改动）。");
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
          setError("插入失败：请先把光标放进输入框再试（草稿可能在面板打开期间被改动）。");
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
              setReview((prev) => (prev ? { ...prev, saving: false, conflict: err.message || "该片段已被他处修改" } : prev));
              return;
            }
            setReview((prev) => (prev ? { ...prev, saving: false, error: err.message || "替换失败" } : prev));
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
        Promise.resolve(rpc.call(CHANNEL, "export", { write: "" }))
          .then((result) => {
            setExporting(false);
            if (result && result.ok) {
              const path = (result.value && result.value.path) || "";
              setExportPath(path);
              setNotice(`已导出 ${result.value.count} 条`);
              setError(null);
            } else {
              setError(result && result.error ? result.error.message : "导出失败");
            }
          })
          .catch((err) => {
            setExporting(false);
            setError(String((err && err.message) || err));
          });
      };

      const doImport = () => {
        if (importing) return;
        const target = importPath.trim();
        if (!target) {
          setError("请填写要导入的 JSON 文件路径。");
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
              setNotice(`导入 ${p.added} 条${p.skipped ? `，跳过 ${p.skipped}` : ""}${p.updated ? `，更新 ${p.updated}` : ""}`);
              setImportOpen(false);
              setImportPath("");
              setImportReplace(false);
              setError(null);
              load(); // 列表变了，重新拉一次
            } else {
              setError(result && result.error ? result.error.message : "导入失败");
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
              setError(result && result.error ? result.error.message : "删除失败");
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
            } else setError(result && result.error ? result.error.message : "恢复失败");
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
              .catch(() => null)
          )
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

      const visible = useMemo(() => filterSnippets(snippets, query), [snippets, query]);
      // §3.2 键盘导航：selected 是 visible 数组下标；query/snippets 一变就复位到 -1，
      // 避免旧的选中下标指向不同条目。
      useEffect(() => {
        setSelected(-1);
      }, [query, snippets]);
      const selectedSnippet = selected >= 0 && selected < visible.length ? visible[selected] : null;
      const trimmedQuery = query.trim();

      // ────────── 渲染：编辑器 ──────────
      const renderEditor = () => {
        const e = editing;
        const names = varNamesOf(e.content);
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
                  "覆盖"
                ),
                h(
                  "button",
                  { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: reloadDraft },
                  "重新载入"
                )
              )
            : null,
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, "名称"),
            h("input", {
              ref: nameRef,
              type: "text",
              className: "ps-input",
              style: style.input,
              value: e.name,
              placeholder: "片段名称",
              onChange: (ev) => patchDraft({ name: ev.target.value }),
            })
          ),
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, "分类"),
            h("input", {
              type: "text",
              className: "ps-input",
              style: style.input,
              value: e.category,
              placeholder: "留空表示不分类",
              onChange: (ev) => patchDraft({ category: ev.target.value }),
            })
          ),
          h(
            "label",
            { style: style.field },
            h("span", { style: style.label }, "正文（用 {{变量名}} 标记占位符，\\{{ 输出字面量）"),
            h("textarea", {
              className: "ps-textarea",
              style: style.textarea,
              value: e.content,
              onChange: (ev) => patchDraft({ content: ev.target.value }),
            })
          ),
          names.length > 0
            ? h(
                "div",
                null,
                h("div", { style: style.label }, "变量"),
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
                      "必填"
                    ),
                    h("input", {
                      type: "text",
                      className: "ps-input",
                      style: { ...style.input, flex: "1 1 90px", width: "auto" },
                      value: typeof d.default === "string" ? d.default : "",
                      placeholder: "默认值（可空）",
                      onChange: (ev) => setVar(nm, { default: ev.target.value }),
                    })
                  );
                })
              )
            : null,
          e.hint ? h("div", { style: style.hintInline }, e.hint) : null,
          h(
            "div",
            { style: style.actions },
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: cancelEdit },
              e.confirmCancel ? "确认放弃" : "取消"
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
              e.busy ? "保存中…" : "保存"
            )
          )
        );
      };

      // ────────── 渲染：占位符表单 ──────────
      const renderFillForm = () => {
        const cur = filling;
        const names = varNamesOf(cur.snippet.content);
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
            return h(
              "label",
              { key: nm, style: style.field },
              h("span", { style: style.label }, (typeof d.label === "string" && d.label ? d.label : nm) + (required ? " · 必填" : "")),
              h("input", {
                type: "text",
                className: "ps-input",
                style: style.input,
                value: typeof cur.values[nm] === "string" ? cur.values[nm] : "",
                placeholder: typeof d.default === "string" ? d.default : "",
                onChange: (ev) => setFillValue(nm, ev.target.value),
              })
            );
          }),
          h(
            "div",
            { style: style.actions },
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: () => setFilling(null) },
              "取消"
            ),
            h(
              "button",
              { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: insertRaw },
              "保留占位符插入"
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
              "插入"
            )
          )
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
          ? "优化结果超过单条片段上限，请先精简"
          : lost.length > 0
          ? `优化结果丢失了占位符 ${lost.map((n) => `{{${n}}}`).join("、")}`
          : "把片段正文替换成优化后的版本";
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
                h("div", { style: style.label }, "原文"),
                h("div", { style: style.reviewPane }, cur.original)
              ),
              h(
                "div",
                { style: style.reviewCol },
                h("div", { style: style.label }, cur.busy ? "优化后" : "优化后（可编辑）"),
                h(
                  "textarea",
                  {
                    className: "ps-textarea",
                    style: style.reviewInput,
                    value: cur.busy ? "" : cur.optimized,
                    disabled: cur.busy,
                    placeholder: cur.busy ? (cur.stopping ? "正在取消…" : "生成中…") : "（空）",
                    onChange: (ev) =>
                      setReview((prev) => (prev ? { ...prev, optimized: ev.target.value } : prev)),
                  }
                )
              )
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
                      : `占位符 ${before.map((n) => `{{${n}}}`).join("、")} 已保留 ✓`
                  )
                : null,
              cur.retries > 0 ? h("span", null, `已重试 ${cur.retries} 次`) : null,
              overLong ? h("span", { style: style.reviewLost }, "⚠ 超出长度上限") : null
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
                    "用优化版覆盖"
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ps-ghost",
                      style: style.btnGhost,
                      onClick: () => setReview((prev) => (prev ? { ...prev, conflict: null } : prev)),
                    },
                    "放弃"
                  )
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
                  title: "不采用优化结果，插入原始片段",
                },
                "保留原文插入"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: style.btnGhost,
                  onClick: stopOptimize,
                  title: cur.busy ? "取消这次优化" : "关闭对比视图",
                },
                cur.busy ? (cur.stopping ? "取消中…" : "取消") : "✕"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-ghost",
                  style: canRetry ? style.btnGhost : { ...style.btnGhost, ...style.btnDisabled },
                  onClick: retryOptimize,
                  disabled: !canRetry,
                  title: canRetry ? "重新生成一次（不累积）" : `已重试 ${MAX_RETRY} 次`,
                },
                canRetry ? "再试" : `已重试 ${MAX_RETRY} 次`
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
                cur.saving ? "替换中…" : "替换片段正文"
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-primary",
                  style: cur.busy || !cur.optimized ? { ...style.btnPrimary, ...style.btnDisabled } : style.btnPrimary,
                  onClick: insertOptimized,
                  disabled: cur.busy || !cur.optimized,
                  title: "把优化后的文本插入输入框",
                },
                "插入优化版"
              )
            )
          )
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
                title: "点击插入\n\n" + s.content,
              },
              highlightText(s.name, trimmedQuery)
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: readOnly ? { ...style.icon, ...style.iconBusy } : style.icon,
                onClick: () => beginEdit(s),
                disabled: readOnly || (editing !== null && editing.id !== s.id && editing.dirty),
                title: readOnly ? "片段库处于只读状态，禁止编辑" : "编辑",
                "aria-label": `编辑「${s.name}」`,
              },
              "✏️"
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
                title: optAvail.available ? "AI 优化（对比后决定）" : optAvail.reason || "当前未配置默认模型",
                "aria-label": `AI 优化「${s.name}」`,
              },
              optimizing === s.id ? "…" : "✨"
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: { ...style.icon, ...style.del },
                onClick: () => remove(s),
                disabled: readOnly || deleting !== null,
                title: readOnly ? "片段库处于只读状态，禁止删除" : "删除（可撤销）",
                "aria-label": `删除「${s.name}」`,
              },
              deleting === s.id ? "…" : "🗑"
            )
          ),
          editing && editing.id === s.id ? renderEditor() : null
        );

      const listContent = groupByCategory(visible).map(([category, list]) =>
        h(
          "div",
          { key: category || "__none__" },
          category ? h("div", { style: style.group }, category) : null,
          list.map((s) => rowOf(s, visible.indexOf(s)))
        )
      );

      const bodyContent = error
        ? h("div", { style: style.error }, "⚠ " + error)
        : snippets.length === 0
        ? h("div", { style: style.empty }, "还没有片段。点下面的「＋ 新建」或 /snippet add <名称> <内容> 保存一个。")
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
                title: "把搜索词作为新片段名称",
              },
              trimmedQuery ? `＋ 新建「${trimmedQuery}」` : "＋ 新建片段"
            )
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
            title: "提示词片段库",
            "aria-expanded": open ? "true" : "false",
          },
          "📋 片段库"
        ),
        notice ? h("span", { className: "ps-notice", style: style.notice }, notice) : null,
        open &&
          h(
            "div",
            {
              id: "ps-panel",
              className: "ps-panel",
              role: "dialog",
              "aria-label": "片段库",
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
            h("div", { style: style.resizeN, onMouseDown: startResize("n"), title: "拖动调整高度", "aria-label": "调整高度" }),
            h("div", { style: style.resizeS, onMouseDown: startResize("s"), title: "拖动调整高度", "aria-label": "调整高度" }),
            h("div", { style: style.resizeW, onMouseDown: startResize("w"), title: "拖动调整宽度", "aria-label": "调整宽度" }),
            h("div", { style: style.resizeE, onMouseDown: startResize("e"), title: "拖动调整宽度", "aria-label": "调整宽度" }),
            h("div", { style: style.resizeNW, onMouseDown: startResize("nw"), title: "拖动调整大小", "aria-label": "调整大小" }),
            h("div", { style: style.resizeSW, onMouseDown: startResize("sw"), title: "拖动调整大小", "aria-label": "调整大小" }),
            h("div", { style: style.resizeSE, onMouseDown: startResize("se"), title: "拖动调整大小", "aria-label": "调整大小" }),
            h(
              "div",
              { style: style.header, onMouseDown: startDrag, title: "拖动标题栏可移动面板" },
              h("span", { style: style.headerTitle }, "📋 片段库"),
              h(
                "button",
                {
                  type: "button",
                  className: "ps-close",
                  style: style.close,
                  title: "关闭",
                  "aria-label": "关闭片段库",
                  onMouseDown: (e) => e.stopPropagation(),
                  onClick: () => setOpen(false),
                },
                "×"
              )
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
                  placeholder: "搜索名称 / 分类 / 内容…",
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
                  : null
              )
            ),
            review ? renderReview() : null,
            filling ? h("div", { style: style.formWrap }, renderFillForm()) : null,
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
                        title: readOnly ? "片段库处于只读状态，禁止新建" : "新建片段",
                      },
                      "＋ 新建"
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "ps-ghost",
                        style: exporting ? { ...style.btnGhost, ...style.btnDisabled } : style.btnGhost,
                        onClick: exportAll,
                        disabled: exporting || snippets.length === 0,
                        title: "把所有片段导出成 JSON 文件，存在数据目录的 exports/ 下",
                      },
                      exporting ? "导出中…" : "⬇ 导出"
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
                        title: readOnly ? "片段库处于只读状态，禁止导入" : "从导出的 JSON 文件导入片段",
                      },
                      "⬆ 导入"
                    )
                  )
                ),
            importOpen
              ? h(
                  "div",
                  { style: style.formWrap },
                  h(
                    "div",
                    { style: style.editor },
                    h("div", { style: style.label }, "导入文件路径"),
                    h("input", {
                      type: "text",
                      className: "ps-input",
                      style: style.input,
                      value: importPath,
                      placeholder: "留空或写文件名时取 exports/snippets.json",
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
                      h("span", { style: style.label }, "替换模式（未出现在文件里的片段会被移入垃圾桶）")
                    ),
                    h(
                      "div",
                      { style: style.actions },
                      h(
                        "button",
                        { type: "button", className: "ps-ghost", style: style.btnGhost, onClick: () => setImportOpen(false) },
                        "取消"
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
                        importing ? "导入中…" : "导入"
                      )
                    )
                  )
                )
              : null,
            exportPath
              ? h(
                  "div",
                  { style: style.exportBar },
                  h("span", { style: style.exportText, title: exportPath }, "📄 " + exportPath)
                )
              : null,
            deleted.length > 0
              ? h(
                  "div",
                  { style: style.undoBar },
                  h(
                    "span",
                    { style: style.undoText },
                    deleted.length === 1 ? `已删除「${deleted[0].name}」` : `已删除 ${deleted.length} 条`
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
                      "↩ " + d.name
                    )
                  ),
                  deleted.length > 1
                    ? h(
                        "button",
                        { type: "button", className: "ps-undo", style: style.undoBtn, onClick: undoAll },
                        "全部撤销"
                      )
                    : null
                )
              : null,
            h(
              "div",
              { style: style.hint },
              "点名称插入 · ✏️ 编辑 · ✨ 优化 · 🗑 删除 · 拖标题栏移动 · 拖边缘调大小"
            )
          )
      );
    }

    return {
      inject: ["slots", "connection"],
      apply(ctx) {
        ctx.effect(() => mountCss(THEME_CSS, "dsh-prompt-snippets/theme.css"), "prompt-snippets theme");
        const rpc = ctx.connection.rpc;
        ctx.slots.inject("conversation.composer.dock", () =>
          ctx.slots.register(
            {
              name: "conversation.composer.dock",
              id: "prompt-snippets",
              order: 50,
              inject: () => ({ rpc }),
            },
            SnippetDock
          )
        );
      },
    };
  },
});
