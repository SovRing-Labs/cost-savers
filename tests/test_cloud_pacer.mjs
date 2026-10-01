import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/cloud-pacer.ts");

test("cloud-pacer initializes pacing hooks and handles events", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-cloud-pacer-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    assert.ok(hooks["chat.params"], "chat.params hook should exist");
    assert.ok(hooks.event, "event hook should exist");

    // Local model should return immediately without delay
    await hooks["chat.params"]({ model: { id: "ollama/qwen" } }, {});

    // Rate limit event handling shouldn't crash
    await hooks.event({
      event: {
        type: "session.error",
        properties: {
          error: { status: 429, message: "Rate limit reached for openrouter" },
        },
      },
    });
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
