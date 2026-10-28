window.__ModuleLoader__.load({
  id: "dsh-prompt-snippets",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect } = React;

    const CHANNEL = "/prompt-snippets";
    const Z_TOP = 2147483647;

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
        width: "280px",
        maxHeight: "380px",
        overflow: "auto",
        borderRadius: "8px",
        border: "1px solid #d0d7de",
        background: "#ffffff",
        color: "#1f2328",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
        padding: "6px",
      },
      group: { fontWeight: 600, fontSize: "11px", opacity: 0.7, padding: "6px 8px 2px", textTransform: "uppercase", letterSpacing: "0.03em" },
      item: {
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "7px 8px",
        fontSize: "13px",
        borderRadius: "5px",
        border: "none",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
      },
      itemHover: { background: "rgba(36,123,191,0.12)" },
      empty: { padding: "12px 8px", fontSize: "12px", opacity: 0.7 },
      error: { padding: "12px 8px", fontSize: "12px", color: "#d23" },
      refresh: { marginLeft: "auto", fontSize: "11px", opacity: 0.6 },
    };

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
      const [error, setError] = useState(null);

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
        if (next) {
          const rect = e.currentTarget.getBoundingClientRect();
          const vh = window.innerHeight;
          const vw = window.innerWidth;
          const panelW = 280;
          let left = rect.left;
          if (left + panelW > vw - 8) left = Math.max(8, vw - panelW - 8);
          // 向上展开：优先在按钮上方，空间不足则向下
          const panelH = 380;
          let top;
          if (rect.top - panelH - 8 >= 0) {
            top = rect.top - panelH - 8;
          } else {
            top = rect.bottom + 8;
          }
          setPanelPos({ left, top });
        }
        setOpen(next);
        if (next) load();
      };

      const insert = (snippet) => {
        try {
          const span = inputActions.captureInsertion();
          inputActions.insertText(snippet.content, span);
        } catch (_) {
          /* 插入失败时忽略，用户可手动复制 */
        }
        setOpen(false);
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
          style: { ...style.panel, left: panelPos ? panelPos.left + "px" : "8px", top: panelPos ? panelPos.top + "px" : "8px" },
        },
          error
            ? h("div", { style: style.error }, "⚠ " + error)
            : snippets.length === 0
              ? h("div", { style: style.empty }, "还没有片段。用 /snippet add <名称> <内容> 保存一个。")
              : groupByCategory(snippets).map(([category, list]) =>
                  h("div", { key: category || "__none__" },
                    category ? h("div", { style: style.group }, category) : null,
                    list.map((s) =>
                      h("button", {
                        key: s.id,
                        type: "button",
                        style: style.item,
                        onClick: () => insert(s),
                        title: s.content,
                      }, s.name)
                    )
                  )
                )
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
