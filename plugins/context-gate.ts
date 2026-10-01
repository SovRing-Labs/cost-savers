import type { Hooks } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";

// T72/C1 — Context gating plugin: blocks broad file reads during session startup.
// Enforces ~/.agent/begin-session.md protocol. Reversible: remove from opencode.jsonc plugin[].
//
// Rules (first 3 turns of ANY session):
// - ALLOW: spawn-briefs/<task>.txt, common.txt, BOOTSTRAP.md
// - BLOCK: LOG.md, PLAN.md, SCHEDULE.json, events.jsonl, dispatch-ledger.jsonl
// - ALLOW ALL: after turn 3 (agent has claimed + oriented)
//
// Violations logged to ~/.agent/context-violations.jsonl

const VIOLATION_LOG = path.join(process.env.HOME!, ".agent", "context-violations.jsonl");
const ALLOWED_EARLY = [
  /spawn-briefs\/.*\.txt$/,
  /spawn-briefs\/.*\.md$/,
  /control-center\/governance\/BOOTSTRAP\.md$/,
  /control-center\/governance\/COMMANDER-CODEX\.md$/,
  /control-center\/governance\/COMMANDER-GENR\.md$/,
  /begin-session\.md$/,
];
const BLOCKED_EARLY = [
  /control-center\/LOG\.md$/,
  /control-center\/PLAN\.md$/,
  /control-center\/SCHEDULE\.json$/,
  /control-center\/events\.jsonl$/,
  /control-center\/dispatch-ledger\.jsonl$/,
  /\/LOG\.md$/,
];

function isAllowedEarly(filePath: string): boolean {
  return ALLOWED_EARLY.some(re => re.test(filePath));
}

function isBlockedEarly(filePath: string): boolean {
  return BLOCKED_EARLY.some(re => re.test(filePath));
}

function logViolation(sessionID: string, tool: string, file: string) {
  const entry = {
    ts: new Date().toISOString(),
    sessionID,
    tool,
    file,
    rule: "early-read-blocked",
  };
  try {
    fs.appendFileSync(VIOLATION_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    // Silently ignore logging failures
  }
}

export const server = async (): Promise<Hooks> => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "read") {
        return output;
      }
      
      const { sessionID } = input;
      const args = output.args as { path?: string; file?: string };
      const filePath = args.path || args.file || "";
      
      if (!filePath) {
        return output;
      }
      
      // Redirect any hallucinated _Wiki path to canonical BOOTSTRAP.md
      if (filePath.includes("_Wiki")) {
        output.args.path = "BOOTSTRAP.md";
        output.args.file = undefined;
        return output;
      }
      
      // Check if this is an early-turn session (simplified: check for violation log entry)
      // A proper implementation would track turns per session; for now we gate based on file patterns
      // and let the agent self-enforce after turn 3 via begin-session.md
      
      if (isBlockedEarly(filePath)) {
        logViolation(sessionID, "read", filePath);
        // Replace the path with a safe stub that returns empty content
        // This blocks the read without crashing the agent
        output.args.path = "/dev/null";
        output.args.file = undefined;
      }
      
      return output;
    },
  };
};
