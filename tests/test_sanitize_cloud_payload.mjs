import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/sanitize-cloud-payload.ts");

test("sanitize-cloud-payload redacts credentials, paths, and internal infra", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-sanitize-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    const transform = hooks["experimental.chat.messages.transform"];
    assert.ok(transform, "Transform hook should exist");

    const messages = [
      {
        info: { id: "m1", sessionID: "test-sess", role: "user" },
        parts: [
          {
            type: "text",
            text: "Here is my secret AKIAIOSFODNN7EXAMPLE and private key -----BEGIN RSA PRIVATE KEY----- and dispatch.db and sovraptor system",
          },
        ],
      },
    ];

    const output = await transform({}, { messages });
    const scrubbed = output.messages[0].parts[0].text;

    assert.ok(!scrubbed.includes("AKIAIOSFODNN7EXAMPLE"), "AWS key must be redacted");
    assert.ok(!scrubbed.includes("BEGIN RSA PRIVATE KEY"), "Private key header must be redacted");
    assert.ok(!scrubbed.includes("dispatch.db"), "DB artifact must be redacted");
    assert.ok(!scrubbed.includes("sovraptor"), "Brand pattern must be redacted");
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
