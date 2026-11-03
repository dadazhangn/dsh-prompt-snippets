// 测试专用：把 DSH_HOME 顶到临时目录，杜绝测试读写真实片段库。
// 必须在 import 插件的 index.js 之前被 import（脚本第一行）。
// 想保留现场排查时：$env:SNIP_TEST_HOME='某个目录'; node xxx-test.mjs
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const explicit = process.env.SNIP_TEST_HOME;
const root = explicit ? explicit : mkdtempSync(join(tmpdir(), "snip-home-"));

process.env.DSH_HOME = root;

export const TEST_HOME = root;
export const TEST_DIR = join(root, "data", "prompt-snippets");
export const TEST_FILE = join(TEST_DIR, "snippets.json");
export const TEST_BAK = join(TEST_DIR, "snippets.json.bak");

mkdirSync(TEST_DIR, { recursive: true });

// 明确告诉人：真实数据目录没被碰
const real = process.env.SNIP_REAL_HOME;
if (real && explicit === undefined) {
  console.log(`[isolate-home] DSH_HOME -> ${root}（真实目录 ${real} 未被访问）`);
}
