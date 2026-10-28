import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const name = "prompt-snippets";
export const inject = ["connection", "commands", "webServer"];

const CHANNEL = "/prompt-snippets";

/** 解析 DSH 数据根目录（等价于 dshHomePath：$DSH_HOME 或 ~/.dsh）。 */
function resolveHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim().length > 0) return join(env.trim());
  return join(homedir(), ".dsh");
}

function dataPath(...segments) {
  return join(resolveHome(), "data", "prompt-snippets", ...segments);
}

/**
 * 数据模型（存于 <home>/data/prompt-snippets/snippets.json）：
 * { version: 1, snippets: [{ id, name, category, content, createdAt, updatedAt }] }
 * category 为字符串或 null。
 */
function emptyStore() {
  return { version: 1, snippets: [] };
}

async function load() {
  try {
    const raw = await readFile(dataPath("snippets.json"), "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.snippets)) return emptyStore();
    return data;
  } catch (error) {
    if (error && error.code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function persist(store) {
  await mkdir(dataPath(), { recursive: true });
  await writeFile(dataPath("snippets.json"), JSON.stringify(store, null, 2), "utf8");
}

function fail(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/** RPC 端点分派：list / save / delete。 */
async function dispatch(endpoint, payload) {
  const store = await load();
  switch (endpoint) {
    case "list":
      return { ok: true, value: store };

    case "save": {
      const name = typeof payload?.name === "string" ? payload.name.trim() : "";
      const content = typeof payload?.content === "string" ? payload.content : null;
      const category = typeof payload?.category === "string" && payload.category.trim()
        ? payload.category.trim()
        : null;
      if (!name) return fail("bad-request", "片段名称不能为空");
      if (content === null) return fail("bad-request", "片段内容必须是字符串");
      const now = Date.now();
      const existing = store.snippets.find((s) => s.name === name);
      if (existing) {
        existing.content = content;
        existing.category = category;
        existing.updatedAt = now;
      } else {
        store.snippets.push({ id: randomUUID(), name, category, content, createdAt: now, updatedAt: now });
      }
      await persist(store);
      return { ok: true, value: store };
    }

    case "delete": {
      const id = payload?.id;
      const before = store.snippets.length;
      store.snippets = store.snippets.filter((s) => s.id !== id);
      if (store.snippets.length === before) return fail("not-found", "未找到该片段");
      await persist(store);
      return { ok: true, value: store };
    }

    default:
      return fail("not-found", `未知操作：${String(endpoint)}`);
  }
}

export function apply(ctx) {
  // 不能用 ctx.connection.rpc.handle()：它内部用 connection 插件自己的 fiber
  // ctx 作为 owner 去读 owner.webServer，而 webServer 是 connection 的兄弟
  // entry（不在其祖先链上），属性访问会抛错导致路由未注册、请求落 405。
  // 正确做法：本插件 inject webServer，并把 owner 显式传成本插件的 ctx。
  ctx.connection.register(ctx, CHANNEL, async (endpoint, payload) => {
    try {
      return await dispatch(endpoint, payload);
    } catch (error) {
      return fail("internal", error instanceof Error ? error.message : String(error));
    }
  });

  ctx.commands.register({
    name: "snippet",
    description: "管理提示词片段：保存、列出、删除",
    input: { hint: "add <名称> <内容> [--cat <分类>] | list | rm <名称>" },
    async handler({ rawInput }) {
      const args = (rawInput ?? "").trim();
      const [verb, ...rest] = args.split(/\s+/);

      switch (verb) {
        case "":
        case "list": {
          const store = await load();
          if (store.snippets.length === 0) {
            return { kind: "success", text: "还没有保存任何片段。用 /snippet add <名称> <内容> 保存一个。" };
          }
          const lines = store.snippets.map((s, i) =>
            `${i + 1}. ${s.name}${s.category ? ` [${s.category}]` : ""}`
          );
          return { kind: "success", text: `已保存 ${store.snippets.length} 个片段：\n${lines.join("\n")}` };
        }

        case "add":
        case "save": {
          // 提取可选的 --cat <分类> / -c <分类>（可在任意位置，也支持 --cat=值）
          let category = null;
          const cleaned = [];
          for (let i = 0; i < rest.length; i++) {
            const t = rest[i];
            if (t === "--cat" || t === "-c") {
              category = (rest[i + 1] ?? "").trim() || null;
              i++;
            } else if (t.startsWith("--cat=")) {
              category = t.slice(6).trim() || null;
            } else if (t.startsWith("-c=")) {
              category = t.slice(3).trim() || null;
            } else {
              cleaned.push(t);
            }
          }
          if (cleaned.length < 2) {
            return { kind: "error", text: "用法：/snippet add <名称> <内容> [--cat <分类>]" };
          }
          const name = cleaned[0];
          const content = cleaned.slice(1).join(" ");
          const store = await load();
          const now = Date.now();
          const existing = store.snippets.find((s) => s.name === name);
          if (existing) {
            existing.content = content;
            if (category !== null) existing.category = category;
            existing.updatedAt = now;
          } else {
            store.snippets.push({ id: randomUUID(), name, category, content, createdAt: now, updatedAt: now });
          }
          await persist(store);
          return { kind: "success", text: `已${existing ? "更新" : "保存"}片段「${name}」${category ? `（分类：${category}）` : ""}。` };
        }

        case "rm":
        case "delete": {
          const name = rest[0];
          if (!name) return { kind: "error", text: "用法：/snippet rm <名称>" };
          const store = await load();
          const idx = store.snippets.findIndex((s) => s.name === name);
          if (idx < 0) return { kind: "error", text: `未找到片段「${name}」。` };
          store.snippets.splice(idx, 1);
          await persist(store);
          return { kind: "success", text: `已删除片段「${name}」。` };
        }

        default:
          return { kind: "error", text: "未知操作。用法：/snippet add <名称> <内容> [--cat <分类>] | list | rm <名称>" };
      }
    },
  });
}
