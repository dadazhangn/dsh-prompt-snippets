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
    const POS_KEY = "dsh-prompt-snippets-panel-pos";

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
        // 窄屏：视口不足 340px 时收窄，永不溢出
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
      actions: { display: "flex", gap: "6px", justifyContent: "flex-end", paddingTop: "2px" },
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

    /** 面板实际占位上限：窄视口下 CSS min() 会让它比常量更小。 */
    function panelBox() {
      const vw = window.innerWidth || PANEL_W + GAP * 2;
      const vh = window.innerHeight || PANEL_H + GAP * 3;
      return {
        w: Math.min(PANEL_W, Math.max(180, vw - GAP * 2)),
        h: Math.min(PANEL_H, Math.max(140, vh - GAP * 3)),
      };
    }

    /** 裁剪到视口内，至少让标题栏完整可见（便于拖回）。 */
    function clampPos(left, top) {
      const { w } = panelBox();
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

    function SnippetDock({ inputActions, rpc }) {
      const [snippets, setSnippets] = useState([]);
      const [open, setOpen] = useState(false);
      const [panelPos, setPanelPos] = useState(null);
      const [drag, setDrag] = useState(null);
      const [error, setError] = useState(null);
      const [warning, setWarning] = useState(null);
      const [optimizing, setOptimizing] = useState(null); // 正在优化的片段 id
      const [deleting, setDeleting] = useState(null); // 正在删除的片段 id
      const [deleted, setDeleted] = useState([]); // 最近 5 条 [{id,name}]，可逐条或全部撤销
      const [query, setQuery] = useState("");
      const [notice, setNotice] = useState(null); // 短暂提示（默认值填充等），关面板后仍可见
      const [editing, setEditing] = useState(null); // 行内编辑草稿
      const [filling, setFilling] = useState(null); // 占位符表单 { snippet, values }
      const searchRef = useRef(null);
      const nameRef = useRef(null);

      const applyResult = (result) => {
        if (result && result.ok) {
          setSnippets((result.value && result.value.snippets) || []);
          setWarning((result.value && result.value.warning) || null);
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
          setPanelPos(clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY)));
        };
        const onUp = (e) => {
          const pos = clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY));
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

      // 视口变化时把面板拉回可视区（窄屏 / 旋转 / 分屏调整都会触发）
      useEffect(() => {
        if (!open) return;
        const onResize = () => {
          setPanelPos((prev) => (prev ? clampPos(prev.left, prev.top) : prev));
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, [open]);

      // 点击面板外部时关闭。
      // 例外：草稿没保存时不关——外面点一下就把写的字丢了，这个代价太高。
      useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
          if (editing && editing.dirty) return;
          const panel = document.getElementById("ps-panel");
          const btn = document.getElementById("ps-button");
          if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            setOpen(false);
          }
        };
        document.addEventListener("mousedown", onDoc, true);
        return () => document.removeEventListener("mousedown", onDoc, true);
      }, [open, editing]);

      const toggle = (e) => {
        const next = !open;
        if (next && !panelPos) {
          const saved = loadSavedPos();
          if (saved) {
            setPanelPos(clampPos(saved.left, saved.top));
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const { w, h } = panelBox();
            let left = rect.left;
            if (left + w > vw - GAP) left = Math.max(GAP, vw - w - GAP);
            let top;
            if (rect.top - h - GAP >= 0) {
              top = rect.top - h - GAP; // 优先向上展开，避免遮住输入框
            } else {
              top = rect.bottom + GAP;
              if (top + h > vh - GAP) top = Math.max(GAP, vh - h - GAP);
            }
            setPanelPos(clampPos(left, top));
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
        }
      };

      const startDrag = (e) => {
        if (!panelPos || e.button !== 0) return;
        e.preventDefault();
        setDrag({ startX: e.clientX, startY: e.clientY, left: panelPos.left, top: panelPos.top });
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

      const optimize = (snippet) => {
        if (optimizing) return;
        setOptimizing(snippet.id);
        setError(null);
        Promise.resolve(rpc.call(CHANNEL, "optimize", { content: snippet.content }))
          .then((result) => {
            setOptimizing(null);
            if (result && result.ok) {
              if (!insertText(result.value.optimized)) {
                setError("优化完成，但插入失败：请先把光标放进输入框再试。");
                return;
              }
              setError(null);
              setOpen(false);
            } else {
              setError(result && result.error ? result.error.message : "优化失败");
            }
          })
          .catch((err) => {
            setOptimizing(null);
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
        setDeleted((prev) => prev.filter((x) => x.id !== target.id));
        Promise.resolve(rpc.call(CHANNEL, "restore", { id: target.id }))
          .then((result) => {
            if (result && result.ok) applyResult(result);
            else setError(result && result.error ? result.error.message : "恢复失败");
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      const undoAll = () => {
        const targets = deleted.slice();
        if (targets.length === 0) return;
        setDeleted([]);
        Promise.all(
          targets.map((t) =>
            Promise.resolve(rpc.call(CHANNEL, "restore", { id: t.id }))
              .then((r) => !!(r && r.ok))
              .catch(() => false)
          )
        )
          .then((oks) => {
            const bad = oks.filter((x) => !x).length;
            if (bad > 0) setError(`${bad} 条恢复失败（可能名称已被占用）。`);
            load();
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      const visible = useMemo(() => filterSnippets(snippets, query), [snippets, query]);

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

      const rowOf = (s) =>
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
                style: editing && editing.id === s.id ? { ...style.item, ...style.itemEditing } : style.item,
                onClick: () => insert(s),
                title: "点击插入\n\n" + s.content,
              },
              s.name
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: style.icon,
                onClick: () => beginEdit(s),
                disabled: editing !== null && editing.id !== s.id && editing.dirty,
                title: "编辑",
                "aria-label": `编辑「${s.name}」`,
              },
              "✏️"
            ),
            h(
              "button",
              {
                type: "button",
                className: "ps-icon",
                style: optimizing === s.id ? { ...style.icon, ...style.iconBusy } : style.icon,
                onClick: () => optimize(s),
                disabled: optimizing !== null,
                title: "AI 优化后插入",
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
                disabled: deleting !== null,
                title: "删除（可撤销）",
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
          list.map(rowOf)
        )
      );

      const bodyContent = error
        ? h("div", { style: style.error }, "⚠ " + error)
        : snippets.length === 0
        ? h("div", { style: style.empty }, "还没有片段。点下面的「＋ 新建」或 /snippet add <名称> <内容> 保存一个。")
        : visible.length === 0
        ? h("div", { style: style.empty }, `没有匹配「${query}」的片段。`)
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
              },
            },
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
              h("input", {
                ref: searchRef,
                type: "text",
                className: "ps-search",
                style: style.search,
                placeholder: "搜索名称 / 分类 / 内容…",
                value: query,
                onChange: (e) => setQuery(e.target.value),
                onMouseDown: (e) => e.stopPropagation(),
                onKeyDown: (e) => {
                  if (e.key !== "Escape") return;
                  // 有表单/草稿时先退一层，不直接关面板
                  if (filling) setFilling(null);
                  else if (editing) cancelEdit();
                  else if (query) setQuery("");
                  else setOpen(false);
                },
              })
            ),
            filling ? h("div", { style: style.formWrap }, renderFillForm()) : null,
            h("div", { className: "ps-body", style: style.body }, bodyContent),
            editing && editing.id === null
              ? h("div", { style: style.formWrap }, renderEditor())
              : h(
                  "div",
                  { style: style.addRow },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "ps-ghost",
                      style: style.btnGhost,
                      onClick: beginCreate,
                      disabled: editing !== null && editing.dirty,
                      title: "新建片段",
                    },
                    "＋ 新建"
                  )
                ),
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
              "点名称插入 · ✏️ 编辑 · ✨ 优化 · 🗑 删除 · 拖动标题栏移动"
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
