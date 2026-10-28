window.__ModuleLoader__.load({
  id: "dsh-prompt-snippets",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect } = React;

    const CHANNEL = "/prompt-snippets";
    const Z_TOP = 2147483647;
    const PANEL_W = 320;
    const PANEL_H = 400;
    const POS_KEY = "dsh-prompt-snippets-panel-pos";

    // —— 轻量内联样式 ——
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
        border: "1px solid #d0d7de",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      },
      panel: {
        position: "fixed",
        zIndex: Z_TOP,
        width: PANEL_W + "px",
        maxHeight: PANEL_H + "px",
        overflow: "auto",
        borderRadius: "8px",
        border: "1px solid #d0d7de",
        background: "#ffffff",
        color: "#1f2328",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
        display: "flex",
        flexDirection: "column",
      },
      header: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 8px",
        borderBottom: "1px solid #e4e8ec",
        cursor: "move",
        userSelect: "none",
        fontSize: "12px",
        fontWeight: 600,
      },
      headerTitle: { flex: 1 },
      close: {
        border: "none",
        background: "transparent",
        fontSize: "16px",
        lineHeight: 1,
        cursor: "pointer",
        color: "inherit",
        opacity: 0.6,
        padding: "0 2px",
      },
      body: { overflow: "auto", padding: "6px" },
      group: { fontWeight: 600, fontSize: "11px", opacity: 0.7, padding: "6px 8px 2px", textTransform: "uppercase", letterSpacing: "0.03em" },
      itemRow: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        width: "100%",
      },
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
        color: "inherit",
        cursor: "pointer",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      optimize: {
        border: "1px solid transparent",
        background: "transparent",
        fontSize: "13px",
        lineHeight: 1,
        cursor: "pointer",
        padding: "4px 6px",
        borderRadius: "5px",
        opacity: 0.7,
        flexShrink: 0,
      },
      optimizeBusy: { opacity: 0.4, cursor: "default" },
      empty: { padding: "12px 8px", fontSize: "12px", opacity: 0.7 },
      error: { padding: "12px 8px", fontSize: "12px", color: "#d23" },
      hint: { padding: "4px 8px 6px", fontSize: "10px", opacity: 0.5, borderTop: "1px solid #e4e8ec" },
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
      try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (_) {}
    }
    function clampPos(left, top) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      left = Math.max(8, Math.min(left, vw - PANEL_W - 8));
      top = Math.max(8, Math.min(top, vh - 60));
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

    function SnippetDock({ inputActions, rpc }) {
      const [snippets, setSnippets] = useState([]);
      const [open, setOpen] = useState(false);
      const [panelPos, setPanelPos] = useState(null);
      const [drag, setDrag] = useState(null);
      const [error, setError] = useState(null);
      const [optimizing, setOptimizing] = useState(null); // 正在优化的片段 id

      const load = () => {
        Promise.resolve(rpc.call(CHANNEL, "list", {}))
          .then((result) => {
            if (result && result.ok) setSnippets(result.value.snippets || []);
            else setError(result && result.error ? result.error.message : "读取失败");
          })
          .catch((err) => setError(String((err && err.message) || err)));
      };

      useEffect(() => {
        load();
      }, []);

      // 拖拽：依赖 drag 起始快照，mousemove 用快照计算，结束保存
      useEffect(() => {
        if (!drag) return;
        const onMove = (e) => {
          const pos = clampPos(drag.left + (e.clientX - drag.startX), drag.top + (e.clientY - drag.startY));
          setPanelPos(pos);
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

      // 点击面板外部时关闭
      useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
          const panel = document.getElementById("ps-panel");
          const btn = document.getElementById("ps-button");
          if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            setOpen(false);
          }
        };
        document.addEventListener("mousedown", onDoc, true);
        return () => document.removeEventListener("mousedown", onDoc, true);
      }, [open]);

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
            let left = rect.left;
            if (left + PANEL_W > vw - 8) left = Math.max(8, vw - PANEL_W - 8);
            let top;
            if (rect.top - PANEL_H - 8 >= 0) {
              top = rect.top - PANEL_H - 8;
            } else {
              top = rect.bottom + 8;
              if (top + PANEL_H > vh - 8) top = Math.max(8, vh - PANEL_H - 8);
            }
            setPanelPos(clampPos(left, top));
          }
        }
        setOpen(next);
        if (next) load();
      };

      const startDrag = (e) => {
        if (!panelPos || e.button !== 0) return;
        e.preventDefault();
        setDrag({ startX: e.clientX, startY: e.clientY, left: panelPos.left, top: panelPos.top });
      };

      const insertText = (text) => {
        try {
          const span = inputActions.captureInsertion();
          inputActions.insertText(text, span);
          return true;
        } catch (_) {
          return false;
        }
      };

      const insert = (snippet) => {
        insertText(snippet.content);
        setOpen(false);
      };

      const optimize = (snippet) => {
        if (optimizing) return;
        setOptimizing(snippet.id);
        setError(null);
        Promise.resolve(rpc.call(CHANNEL, "optimize", { content: snippet.content }))
          .then((result) => {
            setOptimizing(null);
            if (result && result.ok) {
              const text = result.value.optimized;
              insertText(text);
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

      return h("div", { style: style.dock },
        h("button", {
          id: "ps-button",
          type: "button",
          style: style.button,
          onClick: toggle,
          title: "提示词片段库",
        }, "📋 片段库"),
        open && h("div", {
          id: "ps-panel",
          style: { ...style.panel, left: (panelPos ? panelPos.left : 8) + "px", top: (panelPos ? panelPos.top : 8) + "px" },
        },
          h("div", {
            style: style.header,
            onMouseDown: startDrag,
            title: "拖动标题栏可移动面板",
          },
            h("span", { style: style.headerTitle }, "📋 片段库"),
            h("button", {
              type: "button",
              style: style.close,
              title: "关闭",
              onMouseDown: (e) => e.stopPropagation(),
              onClick: () => setOpen(false),
            }, "×")
          ),
          h("div", { style: style.body },
            error
              ? h("div", { style: style.error }, "⚠ " + error)
              : snippets.length === 0
                ? h("div", { style: style.empty }, "还没有片段。用 /snippet add <名称> <内容> 保存一个。")
                : groupByCategory(snippets).map(([category, list]) =>
                    h("div", { key: category || "__none__" },
                      category ? h("div", { style: style.group }, category) : null,
                      list.map((s) =>
                        h("div", { key: s.id, style: style.itemRow },
                          h("button", {
                            type: "button",
                            style: style.item,
                            onClick: () => insert(s),
                            title: "点击插入\n\n" + s.content,
                          }, s.name),
                          h("button", {
                            type: "button",
                            style: optimizing === s.id ? { ...style.optimize, ...style.optimizeBusy } : style.optimize,
                            onClick: () => optimize(s),
                            disabled: optimizing !== null,
                            title: "AI 优化后插入",
                          }, optimizing === s.id ? "…" : "✨")
                        )
                      )
                    )
                  )
          ),
          h("div", { style: style.hint }, "点名称插入原文 · ✨ AI 优化后插入 · 拖动标题栏移动")
        )
      );
    }

    return {
      inject: ["slots", "connection"],
      apply(ctx) {
        const rpc = ctx.connection.rpc;
        ctx.slots.inject("conversation.composer.dock", () =>
          ctx.slots.register({
            name: "conversation.composer.dock",
            id: "prompt-snippets",
            order: 50,
            inject: () => ({ rpc }),
          }, SnippetDock)
        );
      },
    };
  },
});
