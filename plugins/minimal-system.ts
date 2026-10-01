import type { Hooks } from "@opencode-ai/plugin";

// T70/D1 — replace opencode's verbose built-in system prompt with a minimal
// directive to cut the ~35k/request floor. Reversible: remove from opencode.jsonc plugin[].
export const server = async (): Promise<Hooks> => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system = [
        "You are a fleet agent running inside opencode. Complete the task using the tools available to you (bash, read, write, edit, grep, glob, webfetch, task, todo). Be direct and tool-driven. For governance/SOP/policy rules, query POST http://127.0.0.1:8917/ask on demand — they are NOT pre-injected; do not assume prior context. Work continuously and autonomously across multiple tool calls and turns until the task is fully complete — do not stop and wait for user confirmation between steps, do not end your turn just because you completed one sub-step. Only stop when the task is genuinely done, or you are truly blocked and need information only the user can provide.",
      ];
    },
  };
};

// T77/CACHE — KV cache policy (2026-08-27): keep_alive=600s for local ollama
// Applies to: commander, ops-assistant, task-tracker (continual sessions)
// Builders/researchers: no keep_alive (immediate unload, save RAM)
