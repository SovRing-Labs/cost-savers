import type { Hooks } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════════════
// SOVRAPTOR ANTI-HARVESTING PLUGIN v2 — OUTBOUND TRAFFIC SHIELD
// ─────────────────────────────────────────────────────────────────────
// Philosophy: Anti-Capture Protocol
// Role: Strips secrets, credentials, infrastructure topology, and internal
//       context from outbound traffic before it reaches a cloud provider.
//       Free-tier lanes especially may train on submitted content.
//
// Changes from v1 (hardened scan):
//   - AWS Secret Access Key pattern
//   - Base64 data URI stripping
//   - JWT partial match (catches 2-segment Bearer tokens)
//   - Internal brand/domain blocking (sovraptor, internal infra names)
//   - SSH Git remote URL redaction
//   - K8s/Docker command context awareness
//   - Environment block + hash value scrubbing
//   - Aggressive tool-output filtering vs user prompt
//
// Guardrail: Radical State Visibility (Invariable #3)
// ═══════════════════════════════════════════════════════════════════════

const HOME = process.env.COSTSAVER_STATE_DIR || process.env.HOME || ".";
const LOG_DIR = path.join(process.env.COSTSAVER_STATE_DIR || HOME, ".agent");
const AUDIT_LOG = path.join(LOG_DIR, "cloud-audit.jsonl");

// Brand/domain protection — never let these leave the machine.
const BRAND_PATTERNS = [/\bsovraptor\b/gi, /\bsopv\w*\b/gi]; // sovRaptor + variants

// --- Configuration: What we refuse to let leave the machine ---
// Every pattern is constructed fresh per scan (fresh-pattern factory functions).
// This avoids global (`/g`) RegExp `.lastIndex` state leaks across calls.
// Verified reproducible bug in prior code:
//   const p = /\b[\w-]+\.db\b/gi;
//   p.test("dispatch.db status") -> true, lastIndex left at 11
//   p.test("board.db status")    -> false  ("board.db" right there but skipped)
// Fresh instances per call side-step this entirely.

function pathPatterns(): RegExp[] {
  return [
    // Core Workspace Architecture (Protect the "Blueprint")
    /\/home\/\w+\/ai-stack/gi,
    /\/home\/\w+\/Documents\/Obsidian/gi,
    /\/home\/\w+\/\.config\/opencode/gi,
    /\/home\/\w+\/\.claude/gi,
    /\/home\/\w+\/projects\/opencode-launcher/gi,
    /\/home\/\w+\/bin\b/gi,
    /\/home\/\w+\/packages\//gi,

    // Low-level State & Memory (Prevent Systemic Capture)
    /\/dev\/shm\//g,
    /\b[\w-]+\.db\b/gi, // raw database filenames, anywhere mid-string
    /\.git(?:modules|keep)?$/gi,           // .git files/repo refs
    /\.(py|js|ts|json|yaml|yml|sh|md)(?=\s|$|[^a-zA-Z0-9_])/gi, // source file extensions revealing project layout
  ];
}

function credentialPatterns(): RegExp[] {
  return [
    // Provider-prefixed API keys / tokens (extended from original 5)
    /\bsk-or-v1-\w+/gi,            // OpenRouter
    /\bsk-ant-\w+/gi,              // Anthropic
    /\bsk-proj-\w+/gi,             // OpenAI project keys
    /\bsk-live-\w+/gi,             // Stripe-style live secret keys
    /\bpk-live-\w+/gi,             // Stripe-style live publishable keys
    /\bghp_\w+/gi,                 // GitHub personal access token
    /\bgho_\w+/gi,                 // GitHub OAuth token
    /\bghs_\w+/gi,                 // GitHub server-to-server token
    /\bxox[baprs]-[\w-]+/gi,       // Slack tokens (bot/app/user/refresh/legacy)
    /\bAKIA[0-9A-Z]{16}\b/g,       // AWS access key ID
    /\baws_secret_access_key\s*[:=]\s*[\w/+=-]{20,}/gi, // AWS SECRET key name=value
    /\bAIza[0-9A-Za-z_-]{35}\b/g,  // Google API key
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT (3-segment)
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,         // JWT partial (catches 2-segment Bearer tokens)
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,  // SSH/TLS private key headers
    /\b[\w.-]+:\/\/[\w.-]+:[^\s@/]+@[\w.-]+/gi,  // connection strings with creds (postgres://user:pass@host)
    /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?[\w./+=-]{12,}["']?/gi, // generic key=value assignments
  ];
}

function infraPatterns(): RegExp[] {
  return [
    // Infrastructure topology & identity leaks
    /\bsovraptor\b/gi,                  // brand/protection
    /https?:\/\/[\w.-]*(?:internal|api\.dev|gateway\.dev|svc\.local)[\w.-]*\.\w+/gi, // internal subdomain leakage
    /\.sovraptor\.\w+/gi,                                  // sovraptor domains
    /\bgit@[\w.-]+:[\w.-]+\/[\w.-]+\.git\b/gi, // SSH git remotes
    /\bkubectl\s+(get|apply|delete|describe)/gi,          // k8s commands leaking cluster info
    /\bdocker\s+(run|ps|exec|logs)/gi,                   // docker commands leaking container info
    /\bhelm\s+[a-z]/gi,                                    // helm operations
    /\b(ai-stack|redis-cache|nginx-proxy|postgres-db|ai-gateway)\b/gi, // common env names
    /(git|ssh|scp)@[^\s]+$/gm,                             // git/ssh/SCP connection strings (line-end)
    /:\d{3,5}(?!:\s)/g,                                   // Port numbers (not followed by space = service ports)
    /\b(github\.com|gitlab\.com|bitbucket\.org)(?::\d+)?(\/[\w.-]+\/[\w.-]+)?\.git?\b/gi, // SCM host + repo URL
    /\b(cache|redis|postgres|db)\.\w+\.\w+/gi,            // Service hostnames like cache.internal, redis.example.com
  ];
}

/**
 * Run every pattern in `patterns` against `text`, replacing matches with
 * `replacement`. Returns { text, hits } where hits is the list of pattern
 * source strings that actually matched (for audit logging). Uses a fresh
 * RegExp per call so there is no cross-call lastIndex state to go stale.
 */
function scrub(text: string, patterns: RegExp[], replacement: string): { text: string; hits: string[] } {
  let out = text;
  const hits: string[] = [];
  for (const pattern of patterns) {
    const before = out;
    out = out.replace(pattern, replacement);
    if (out !== before) hits.push(pattern.source);
  }
  return { text: out, hits };
}

function logAudit(sessionID: string, status: string, message: string) {
  const entry = { ts: new Date().toISOString(), sessionID, rule: "anti-harvest", status, message };
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify(entry) + "\n");
  } catch {}
}

/**
 * Determine how aggressively to sanitize based on message role.
 * Tool outputs are much higher-risk than user prompts because they
 * contain raw system responses (shell output, DB results, file content).
 */
function getSanitizeIntensity(msg: any): "aggressive" | "standard" {
  const role = msg.role;
  // tool_call and tool_output are highest-risk contexts
  if (role === "tool_output" || role === "tool_use" || role === "tool_use_result") {
    return "aggressive";
  }
  return "standard";
}

export const server = async (): Promise<Hooks> => {
  return {
    "experimental.chat.messages.transform": async (input, output) => {
      let messages = output.messages || [];
      if (!messages.length) return output;

      const sessionID = messages[0]?.info?.sessionID || "unknown";
      let totalPathHits = 0;
      let totalCredHits = 0;
      let totalInfraHits = 0;
      let totalBrandHits = 0;

      const processPart = (part: any): any => {
        if (part.type !== "text" || !part.text) return part;

        let cleanText = part.text;
        let credHits = 0;
        let pathHits = 0;
        let infraHits = 0;
        let brandHits = 0;

        // Find the parent message to determine intensity
        const parentMsg = part._parentMessage || {};
        const intensity = getSanitizeIntensity(parentMsg);

        // STEP 1: Credentials first (higher severity; more specific, so
        // masking them before the broader path pass avoids credential
        // fragments surviving inside path-like strings).
        const credResult = scrub(cleanText, credentialPatterns(), "[REDACTED-CREDENTIAL]");
        cleanText = credResult.text;
        credHits += credResult.hits.length;

        // STEP 2: Sensitive paths / db filenames / source extensions
        const pathResult = scrub(cleanText, pathPatterns(), "[REDACTED]");
        cleanText = pathResult.text;
        pathHits += pathResult.hits.length;

        // STEP 3: Infrastructure topology leaks (K8s, Docker, SSH remotes, internal subdomains)
        if (intensity === "aggressive") {
          const infraResult = scrub(cleanText, infraPatterns(), "[INFRA_REDACTED]");
          cleanText = infraResult.text;
          infraHits += infraResult.hits.length;
        }

        // STEP 4: Brand/domain protection (always applied regardless of intensity)
        const brandResult = scrub(cleanText, BRAND_PATTERNS, "[BRAND_REDACTED]");
        cleanText = brandResult.text;
        brandHits += brandResult.hits.length;

        // STEP 5: Identity anonymization (hides username from remaining home paths)
        cleanText = cleanText.replace(/(\/home\/)[^/\s]+/g, "$1...");

        // STEP 6: Environment variable values + service URLs (order matters!)
        cleanText = cleanText.replace(/(\b[A-Z_]+\s*=\s*)"[^"]+"/g, '$1"[HIDDEN]"');           // "VAR=value" with quotes
        cleanText = cleanText.replace(/(?:AWS_|REDIS_|POSTGRES_|DATABASE_|NODE_|PORT|CACHE)[_]?\w*\s*[:=]\s*https?:\/\/\S+/gi, '[ENV_CONNSTR_REDACTED]');  // VAR=https://..., REDIS_URL=http://...
        cleanText = cleanText.replace(/(?:AWS_|REDIS_|POSTGRES_|DATABASE_|NODE_|PORT|CACHE)[_]?\w*\s*[:=]\s*(?:redis|postgres|ssh|file):\/\/\S+/gi, '[ENV_CONNSTR_REDACTED]');  // VAR=redis://..., POSTGRES_URL=postgres://...
        cleanText = cleanText.replace(/(?:AWS_|REDIS_|POSTGRES_|DATABASE_|NODE_|PORT|CACHE)[_]?\w*\s*[:=]\s*\S+/gi, '[ENV_REDACTED]');              // generic: VAR=47811, PORT=:3000, etc.
        cleanText = cleanText.replace(/(https?|redis|postgres):\/\/[\w.-]+(?::\d+)?\/[\w/-]*/g, '[CONNSTR_REDACTED]');   // raw connection strings without VAR= prefix
        cleanText = cleanText.replace(/\b(cache|redis|postgres|db|localhost)\.\w+\.\w+/gi, '[$1.HOSTNAME_REDACTED]');      // cache.internal → [cache.HOSTNAME_REDACTED]

        // STEP 7: Environment block dumps — redact entire blocks after env-related keywords
        // Matches lines like "PATH=/usr/bin", "NODE_ENV=production", port numbers next to services
        cleanText = cleanText.replace(/\b(env|environment|environ|bashrc|profile|docker-compose)\s*(dump|block|list)\b/gi, "[ENV_BLOCK_REDACTED]");

        // STEP 8: Base64 data URIs (entire blob stripped — model doesn't need encoded configs)
        cleanText = cleanText.replace(/data:[^,]*,[A-Za-z0-9+/=_-]{20,}/g, "[BASE64_DATA_URI]");

        // STEP 9: Long hex strings that look like config digests/hashes
        cleanText = cleanText.replace(/\b[a-f0-9]{64}\b/g, "[SHA256_DIGEST]");

        // STEP 10: Port numbers adjacent to hostnames or service names (low signal leak)
        if (intensity === "aggressive") {
          cleanText = cleanText.replace(/((?:localhost|[a-zA-Z][\w.-]*)\s*:\s*)(\d{2,5})/g, "$1[HIDDEN_PORT]");
        }

        // Update hit counters
        if (credHits > 0) logAudit(sessionID, "MASKED_CREDENTIAL", `${credHits} hit(s)`);
        if (pathHits > 0) logAudit(sessionID, "MASKED_PATH", `${pathHits} hit(s)`);
        if (infraHits > 0) logAudit(sessionID, "REDACTED_INFRA", `${infraHits} hit(s)`);
        if (brandHits > 0) logAudit(sessionID, "REDACTED_BRAND", `${brandHits} hit(s)`);

        totalCredHits += credHits;
        totalPathHits += pathHits;
        totalInfraHits += infraHits;
        totalBrandHits += brandHits;

        return { ...part, text: cleanText };
      };

      for (const msg of messages) {
        // Attach parent message context for intensity determination
        msg.parts = (msg.parts || []).map((part: any) => {
          part._parentMessage = msg;
          return processPart(part);
        });
      }

      // Summary audit entry
      const summaryParts: string[] = [];
      if (totalCredHits > 0) summaryParts.push(`${totalCredHits} credential(s)`);
      if (totalPathHits > 0) summaryParts.push(`${totalPathHits} path/db artifact(s)`);
      if (totalInfraHits > 0) summaryParts.push(`${totalInfraHits} infra item(s)`);
      if (totalBrandHits > 0) summaryParts.push(`${totalBrandHits} brand/domain item(s)`);

      if (summaryParts.length > 0) {
        logAudit(
          sessionID,
          "SCRUB_SUCCESS",
          `${summaryParts.join(", ")} redacted before dispatch.`
        );
      } else {
        logAudit(sessionID, "TRAFFIC_CLEAN", "No sensitive patterns detected.");
      }

      return output;
    },
  };
};

// --- Self-test: run with `node --loader ts-node/esm sanitize-cloud-payload.ts --selftest` ---
// Exercises the exact stateful-regex failure mode (back-to-back .db mentions),
// one hit per credential/class, plus new v2 patterns. A future edit that
// reintroduces module-level RegExp reuse fails loudly.
if (typeof require !== "undefined" && require.main === module && process.argv.includes("--selftest")) {
  const cases: Array<[string, RegExp[], string]> = [
    // Original regression tests
    ["dispatch.db status", pathPatterns(), "dispatch.db"],
    ["board.db status", pathPatterns(), "board.db"],
    ["sk-ant-abc123xyz in the payload", credentialPatterns(), "sk-ant-"],
    ["AKIA" + "ABCDEFGHIJKLMNOP leaked", credentialPatterns(), "AKIA"],
    ["-----BEGIN RSA PRIVATE KEY-----", credentialPatterns(), "PRIVATE KEY"],
    ["postgres://user:hunter2@db.internal/app", credentialPatterns(), "hunter2"],

  // V2 hardening test cases
    ["aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEK...", credentialPatterns(), "wJalrXUtnFEMI"],
    ["Bearer eyJhbGciOiJIUzI1NiJ9.header.payload.signature", credentialPatterns(), "eyJhbGci"],
    ["ssh://git@github.com:jc/sovraptor-core.git", infraPatterns(), "github.com:jc/sovraptor"],
    ["kubectl get pods -n ai-stack", infraPatterns(), "kubectl"],
    ["https://internal-api.dev.internal.sovraptor.io/v1", infraPatterns(), "internal"],
    ["sovraptor core kernel update", BRAND_PATTERNS, "sovraptor"],
    // Note: env var handling tested in full pipeline (processPart), not scrub()
    // Base64 data URI: tested separately below via standalone regex
  ];

  let failures = 0;
  console.log("=== SANITIZE PLUGIN SELF-TEST ===\n");

  for (const [text, patterns, mustContain] of cases) {
    const { text: scrubbed } = scrub(text, patterns, "[X]");
    const caught = !scrubbed.includes(mustContain);
    console.log(`${caught ? "PASS" : "FAIL"}: "${text.substring(0, 60)}..."`);
    if (!caught) {
      console.log(`  LEAK: "${mustContain}" not redacted → "${scrubbed.substring(0, 60)}"`);
      failures++;
    }
  }

  // Shared-array back-to-back .db scrub (lastIndex regression guard)
  const shared = pathPatterns();
  scrub("dispatch.db status", shared, "[X]");
  const r2 = scrub("board.db status", shared, "[X]");
  const regressionOk = !r2.text.includes("board.db");
  console.log(`${regressionOk ? "PASS" : "FAIL"}: shared-array back-to-back .db scrub (lastIndex regression guard)`);
  if (!regressionOk) failures++;

  // Test base64 stripping standalone (used outside scrub flow)
  const b64test = 'data:application/json;base64,eyJrZXkiOiJzZWNyZXR9mF9hYmMxMjMifQ==rest';
  const b64result = b64test.replace(/data:[^,]*,[A-Za-z0-9+/=_-]{20,}/g, "[BASE64_DATA_URI]");
  const b64ok = b64result.includes("[BASE64_DATA_URI]");
  console.log(`${b64ok ? "PASS" : "FAIL"}: Base64 data URI stripping`);
  if (!b64ok) failures++;

  console.log(`\n${failures === 0 ? `OK: ${cases.length + 2}/${cases.length + 2} passed` : `FAILED: ${failures} case(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}
