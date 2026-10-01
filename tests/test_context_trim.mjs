import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/context-trim.ts");

test("context-trim trims message history and caps length", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-context-trim-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    const transform = hooks["experimental.chat.messages.transform"];
    assert.ok(transform, "Transform hook should exist");

    const messages = [];
    for (let i = 0; i < 80; i++) {
      messages.push({
        info: { id: `msg-${i}`, sessionID: "test-sess", role: i % 2 === 0 ? "user" : "assistant" },
        parts: [{ type: "text", text: `Message ${i}: ` + "X".repeat(5000) }],
      });
    }

    const output = await transform({}, { messages });
    assert.ok(output.messages.length <= 50, `Expected <= 50 messages, got ${output.messages.length}`);
    for (const msg of output.messages) {
      for (const part of msg.parts) {
        if (part.type === "text" && part.text) {
          assert.ok(part.text.length <= 5500, `Text too long: ${part.text.length}`);
        }
      }
    }
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
