import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.resolve(__dirname, "../plugins/context-gate.ts");

test("context-gate blocks broad file reads early in session", async () => {
  assert.ok(fs.existsSync(pluginPath), `Plugin must exist at ${pluginPath}`);
  const rawCode = fs.readFileSync(pluginPath, "utf8").replace('import { Hooks }', 'import type { Hooks }');
  const tmpFile = path.join("/tmp", `test-context-gate-${Date.now()}.ts`);
  fs.writeFileSync(tmpFile, rawCode);

  try {
    const { server } = await import(tmpFile);
    const hooks = await server();
    const before = hooks["tool.execute.before"];
    assert.ok(before, "Tool execute before hook should exist");

    // 1. Blocked early file -> replaced with /dev/null
    const resBlocked = await before(
      { tool: "read", sessionID: "s1" },
      { args: { path: "control-center/PLAN.md" } }
    );
    assert.equal(resBlocked.args.path, "/dev/null");

    // 2. Allowed file passes through
    const resAllowed = await before(
      { tool: "read", sessionID: "s1" },
      { args: { path: "spawn-briefs/TASK-001.md" } }
    );
    assert.equal(resAllowed.args.path, "spawn-briefs/TASK-001.md");

    // 3. Hallucinated _Wiki path redirected to BOOTSTRAP.md
    const resWiki = await before(
      { tool: "read", sessionID: "s1" },
      { args: { path: "/some/_Wiki/Rules.md" } }
    );
    assert.ok(resWiki.args.path.endsWith("BOOTSTRAP.md"));
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});
