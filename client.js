window.__ModuleLoader__.load({
  id: "dsh-prompt-snippets",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect } = React;

    const CHANNEL = "/prompt-snippets";

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
        position: "absolute",
        zIndex: 1000,
        marginTop: "4px",
        width: "280px",
        maxHeight: "360px",
        overflow: "auto",
        borderRadius: "8px",
        border: "1px solid #d0d7de",
        background: "var(--color-bg, #fff)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
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

      const insert = (snippet) => {
        try {
          const span = inputActions.captureInsertion();
          inputActions.insertText(snippet.content, span);
        } catch (_) {
          /* 插入失败时忽略，用户可手动复制 */
        }
        setOpen(false);
      };

      return h("div", { style: { ...style.dock, position: "relative" } },
        h("button", {
          type: "button",
          style: style.button,
          onClick: () => { setOpen(!open); if (!open) load(); },
          title: "提示词片段库",
        }, "📋 片段库"),
        open && h("div", { style: style.panel },
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
