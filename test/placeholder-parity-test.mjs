import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanPlaceholders } from "../index.js";

const source = await readFile(new URL("../client.js", import.meta.url), "utf8");
const begin = source.indexOf("    function parseVarAt(content, at) {");
const end = source.indexOf("\n    function renderContent(", begin);
assert(begin >= 0 && end > begin, "client placeholder scanner source is present");
const clientScan = new Function("VAR_NAME_RE", `${source.slice(begin, end)}\nreturn scanPlaceholders;`)(
  /^[\p{L}\p{N}_-]{1,40}$/u,
);

const samples = [
  "plain text",
  "{{变量}} 与 {{name_2}}",
  "\\{{escaped}} / \\\\{{active}}",
  "{{}} {{ 空格 }} {{{nested}}}",
  "重复 {{变量}} 再次 {{变量}}",
  "尾部反斜杠 \\",
];

for (const sample of samples) {
  assert.deepEqual(clientScan(sample), scanPlaceholders(sample), `placeholder scanner mismatch: ${sample}`);
}

console.log(`PASS  host/client placeholder scanner parity (${samples.length} cases)`);
