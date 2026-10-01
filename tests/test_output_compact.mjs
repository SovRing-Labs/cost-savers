import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/output-compact.ts");

test("output-compact collapses blank lines and caps massive outputs", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-output-compact-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    const after = hooks["tool.execute.after"];
    assert.ok(after, "Tool execute after hook should exist");

    // 1. Collapses 3+ newlines into 2 newlines
    const inputMsg = "line 1\n\n\n\n\nline 2";
    const res1 = await after({ tool: "bash" }, { output: inputMsg });
    assert.equal(res1.output, "line 1\n\nline 2");

    // 2. Large read truncation (> 16000 chars)
    const largeRead = "X".repeat(20000);
    const res2 = await after({ tool: "read" }, { output: largeRead });
    assert.ok(res2.output.includes("[truncated at 16,000 chars"));
    assert.ok(res2.output.length < 20000);

    // 3. Large bash stdout truncation (>3000 chars and >45 lines)
    const largeBashLines = [];
    for (let i = 0; i < 60; i++) {
      largeBashLines.push(`log line ${i}: ` + "A".repeat(80));
    }
    const res3 = await after({ tool: "bash" }, { output: largeBashLines.join("\n") });
    assert.ok(res3.output.includes("lines /"));
    assert.ok(res3.output.includes("truncated — use grep or output redirect"));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
