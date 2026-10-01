import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/minimal-system.ts");

test("minimal-system replaces verbose system prompt with concise directive", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-minimal-system-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    const transform = hooks["experimental.chat.system.transform"];
    assert.ok(transform, "Transform hook should exist");

    const output = { system: ["Very long system prompt ".repeat(1000)] };
    await transform({}, output);

    assert.equal(output.system.length, 1);
    assert.ok(output.system[0].length < 1000, `Expected < 1000 chars, got ${output.system[0].length}`);
    assert.ok(output.system[0].includes("Be direct and tool-driven"));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
