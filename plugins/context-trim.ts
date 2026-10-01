import type { Hooks } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";

const MAX_MESSAGES = 50;
const MAX_TEXT_LENGTH = 4000;
const MAX_TOTAL_CHARS = 45000;
const DELIVERABLE_THRESHOLD = 10000;
const LOG_DIR = path.join(process.env.COSTSAVER_STATE_DIR || process.env.HOME || ".", ".agent");
const LOG_FILE = path.join(LOG_DIR, "context-trim.log");
const METRICS_FILE = path.join(LOG_DIR, "metrics.jsonl");
const REASONING_LOG = path.join(LOG_DIR, "reasoning-log.jsonl");
const EXCLUDE_FILE = path.join(LOG_DIR, "context-trim-exclude.json");
const DELIVERABLES_DIR = path.join(LOG_DIR, "deliverables");
const PROJECT_STATE_DIR = path.join(LOG_DIR, "project-state");
const ORACLE_QUEUE_FILE = path.join(LOG_DIR, ".oracle-verdict-queue.jsonl");

interface MessageEntry {
  info: {
    id: string;
    sessionID: string;
    role: string;
    [key: string]: any;
  };
  parts: Array<{
    id?: string;
    type: string;
    text?: string;
    [key: string]: any;
  }>;
}

interface SessionMetrics {
  sessionID: string;
  turns: number;
  totalCharsIn: number;
  totalCharsOut: number;
  totalTokens: number;
  truncEvents: number;
  deliverableCount: number;
  errors: string[];
  gaveup: boolean;
  stuck: boolean;
  models: Set<string>;
  startTime: string;
  lastUpdate: string;
}

const _sessionMetrics: Map<string, SessionMetrics> = new Map();

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch (e) {
    // ignore
  }
}

function logMetrics(entry: object) {
  try {
    fs.appendFileSync(METRICS_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    // ignore
  }
}

function logReasoning(sessionID: string, role: string, text: string) {
  const entry = {
    ts: new Date().toISOString(),
    sessionID,
    role,
    text,
  };
  try {
    fs.appendFileSync(REASONING_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    // ignore
  }
}

function getExcludedSessions(): Set<string> {
  try {
    if (fs.existsSync(EXCLUDE_FILE)) {
      const data = fs.readFileSync(EXCLUDE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch (e) {
    // ignore parse errors
  }
  return new Set();
}

function ensureDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    // ignore
  }
}

function getOrCreateMetrics(sessionID: string): SessionMetrics {
  if (!_sessionMetrics.has(sessionID)) {
    _sessionMetrics.set(sessionID, {
      sessionID,
      turns: 0,
      totalCharsIn: 0,
      totalCharsOut: 0,
      totalTokens: 0,
      truncEvents: 0,
      deliverableCount: 0,
      errors: [],
      gaveup: false,
      stuck: false,
      models: new Set(),
      startTime: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
    });
  }
  return _sessionMetrics.get(sessionID)!;
}

function saveDeliverable(sessionID: string, role: string, text: string): string {
  ensureDir(DELIVERABLES_DIR);
  const timestamp = Date.now();
  const safeRole = role.replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `${safeRole}_${timestamp}.txt`;
  const filepath = path.join(DELIVERABLES_DIR, filename);

  const entry = {
    ts: new Date().toISOString(),
    sessionID,
    role,
    filename,
    length: text.length,
  };

  try {
    fs.writeFileSync(filepath, text);
    const manifestPath = path.join(DELIVERABLES_DIR, "manifest.jsonl");
    fs.appendFileSync(manifestPath, JSON.stringify(entry) + "\n");
    log(`[${sessionID}] DELIVERABLE SAVED: ${filename} (${text.length} chars)`);
    return filename;
  } catch (e) {
    log(`[${sessionID}] DELIVERABLE SAVE FAILED: ${e}`);
    return "";
  }
}

function trackDeliverable(sessionID: string) {
  const metrics = getOrCreateMetrics(sessionID);
  metrics.deliverableCount++;
  metrics.lastUpdate = new Date().toISOString();
}

function trackTruncEvent(sessionID: string) {
  const metrics = getOrCreateMetrics(sessionID);
  metrics.truncEvents++;
  metrics.lastUpdate = new Date().toISOString();
  log(`[${sessionID}] TRUNC_EVENT #${metrics.truncEvents}`);
}

function trackTurn(sessionID: string, model?: string) {
  const metrics = getOrCreateMetrics(sessionID);
  metrics.turns++;
  if (model) metrics.models.add(model);
  metrics.lastUpdate = new Date().toISOString();
}

function trackError(sessionID: string, error: string) {
  const metrics = getOrCreateMetrics(sessionID);
  const errorType = categorizeError(error);
  if (!metrics.errors.includes(errorType)) {
    metrics.errors.push(errorType);
  }
  metrics.lastUpdate = new Date().toISOString();
  log(`[${sessionID}] ERROR: ${errorType}`);
}

function categorizeError(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("timeout")) return "TIMEOUT";
  if (lower.includes("rate limit") || lower.includes("429")) return "RATE_LIMIT";
  if (lower.includes("401") || lower.includes("auth")) return "AUTH_ERROR";
  if (lower.includes("500") || lower.includes("server error")) return "SERVER_ERROR";
  if (lower.includes("connection")) return "CONNECTION_ERROR";
  if (lower.includes("memory") || lower.includes("oom")) return "MEMORY_ERROR";
  if (lower.includes("context") || lower.includes("limit")) return "CONTEXT_LIMIT";
  return "UNKNOWN";
}

const ORACLE_VERDICT_RE = /``````oracle-verdict\s*\n?(.*?)\n?``````/gs;

interface OracleVerdictEntry {
  task: string;
  lens: string;
  verdict: string;
  confidence: string;
  verified: number;
  queued_at: string;
}

function extractOracleVerdicts(messages: MessageEntry[], sessionID: string): void {
  const seen = new Set<string>();
  const assistantTexts: string[] = [];

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        const isAssistant = msg.info.role === "assistant";
        if (isAssistant) assistantTexts.push(part.text);
        const matches = [...part.text.matchAll(ORACLE_VERDICT_RE)];
        for (const match of matches) {
          try {
            const data = JSON.parse(match[1].trim());
            const key = `${data.task || "?"}|${data.lens || "?"}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const entry: OracleVerdictEntry = {
              task: data.task || "UNKNOWN",
              lens: data.lens || "UNKNOWN",
              verdict: data.verdict || "UNKNOWN",
              confidence: data.confidence || "LOW",
              verified: 1,
              queued_at: new Date().toISOString(),
            };
            appendOracleQueue(entry, sessionID);
          } catch {
            // malformed JSON — fail silently per spec
          }
        }
      }
    }
  }

  // If final assistant message has no verdict block, flag it
  const finalAssistant = [...messages].reverse().find(m => m.info.role === "assistant");
  const finalText = finalAssistant?.parts.find(p => p.type === "text")?.text || "";
  const hasVerdict = ORACLE_VERDICT_RE.test(finalText);
  if (!hasVerdict && finalText.length > 200) {
    // Flag missing verdict on sessions that look like oracle runs
    const title = messages[0]?.info?.id || sessionID;
    if (/oracle|oracle-/i.test(title) || /T\d+/.test(title)) {
      log(`[${sessionID}] ORACLE VERDICT MISSING in final message — flagging unverified`);
    }
  }
}

function appendOracleQueue(entry: OracleVerdictEntry, sessionID: string): void {
  try {
    const line = JSON.stringify(entry);
    fs.appendFileSync(ORACLE_QUEUE_FILE, line + "\n");
    log(`[${sessionID}] ORACLE VERDICT QUEUED: ${entry.task}/${entry.lens} -> ${entry.verdict}`);
  } catch (e) {
    log(`[${sessionID}] ORACLE QUEUE WRITE FAILED: ${e}`);
  }
}

function detectCompletionState(text: string): { gaveup?: boolean; stuck?: boolean } {
  const lower = text.toLowerCase();
  if (lower.includes("gaveup") || lower.includes("gave up") || lower.includes("放弃")) {
    return { gaveup: true };
  }
  if (lower.includes("stuck") || lower.includes("blocked") || lower.includes("deadlock")) {
    return { stuck: true };
  }
  return {};
}

function flushMetrics(sessionID: string) {
  const metrics = _sessionMetrics.get(sessionID);
  if (!metrics) return;

  logMetrics({
    type: "session_summary",
    sessionID: metrics.sessionID,
    turns: metrics.turns,
    totalCharsIn: metrics.totalCharsIn,
    totalCharsOut: metrics.totalCharsOut,
    totalTokens: metrics.totalTokens,
    truncEvents: metrics.truncEvents,
    deliverableCount: metrics.deliverableCount,
    errorCount: metrics.errors.length,
    errors: metrics.errors,
    gaveup: metrics.gaveup,
    stuck: metrics.stuck,
    models: Array.from(metrics.models),
    duration: Date.now() - new Date(metrics.startTime).getTime(),
  });
}

const PREAMBLE_PATTERNS = [
  /^based on my analysis,?/i,
  /^let me (?:analyze|think|check|look)/i,
  /^i believe,?/i,
  /^it appears,?/i,
  /^it seems,?/i,
  /^from the (?:provided|above)/i,
  /^looking at the/i,
  /^reviewing the/i,
  /^in summary,?/i,
  /^to summarize,?/i,
  /^in conclusion,?/i,
  /^the key findings,?/i,
  /^the main points,?/i,
  /^however,?/i,
  /^therefore,?/i,
  /^consequently,?/i,
  /^additionally,?/i,
  /^moreover,?/i,
  /^that said,?/i,
  /^having said that,?/i,
  /^as an? ai[^,]*?,?/i,
  /^i'?m (?:an? )?ai[^,]*?,?/i,
  /^as a language model[^,]*?,?/i,
  /^i (?:cannot|can't|couldn't)[^,]*?,?/i,
  /^i (?:do not|don't|don'?t have)[^,]*?,?/i,
];

const NOISE_PATTERNS = [
  /^[\-\=\*]{3,}$/gm,
  /^_{3,}$/gm,
  /^\[{3,}\]$/gm,
  /<[^>]{1,50}>/g,
  /&[a-z]+;/gi,
  /\\u[0-9a-f]{4}/gi,
  /\[?[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\]?/g,
  /https?:\/\/[^\s]{1,100}/g,
  /(?:Token|Usage):\s*[\d,]+/gi,
  /(?:Latency|Speed):\s*[\d.]+\s*(?:ms|s)/gi,
  /(?:Cost|Estimated):\s*\$?[\d.]+/gi,
  /Note:.*$/gim,
  /Disclaimer:.*$/gim,
  /\*+\s*(?:optional|note|warning)\s*\*+/gi,
  /\.\.\./g,
  /,{2,}/g,
  /;{2,}/g,
  /:{3,}/g,
  /\({2,}/g,
  /\){2,}/g,
  /\[{2,}/g,
  /\]{2,}/g,
  /\|{2,}/g,
  /_{3,}/g,
  /-{3,}/g,
  /^#{1,6}\s*$/gm,
  /^>\s*$/gm,
  /^`{3,}\s*$/gm,
  /```$/gm,
  /^\s*\|\s*.+\|\s*$/gm,
  /\|(?:\s|.+\s)?\|/g,
  /^[-*+]\s{2,}/gm,
  /^(\d+)\.\s{2,}/gm,
  /\(\s{0,3}\d{1,4}\s{0,3}\)/g,
  /\[\s{0,3}\d{1,4}\s{0,3}\]/g,
  /^\s*\^\[\d+\]\s*$/gm,
  /^\s*\[?\^\d+\]?\s*$/gm,
  /#{1,6}\s/g,
  /\*\*(.*?)\*\*/g,
  /__(.*?)__/g,
  /~~(.*?)~~/g,
  /`{1,3}(.*?)`{1,3}/gs,
  /<!--[\s\S]*?-->/g,
  /<\?[\s\S]*?\?>/g,
  /<style[\s\S]*?<\/style>/gi,
  /<script[\s\S]*?<\/script>/gi,
];

function stripPreamble(text: string): string {
  let result = text;
  for (const pattern of PREAMBLE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.replace(/\s+/g, " ").trim();
}

function stripNoise(text: string): string {
  let result = text;
  for (const pattern of NOISE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [${text.length - maxLen} chars truncated]`;
}

function countTotalChars(messages: MessageEntry[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.text) total += part.text.length;
    }
  }
  return total;
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function processTextPart(part: any, sessionID: string, role: string, maxLen: number): any {
  if (part.type !== "text" || !part.text) return part;
  // Skip assistant chat messages — only compress tool/user outputs
  if (role === "assistant") return part;

  let text = stripPreamble(part.text);
  text = stripNoise(text);

  if (text.length > DELIVERABLE_THRESHOLD) {
    const filename = saveDeliverable(sessionID, role, text);
    trackDeliverable(sessionID);
    if (filename) {
      text = `[DELIVERABLE: ${filename} — ${text.length} chars saved to ~/.agent/deliverables/]\n\n`
           + text.slice(0, maxLen)
           + `\n... [FULL CONTENT SAVED: ${filename}]`;
    }
  } else if (text.length > maxLen) {
    text = truncateText(text, maxLen);
    trackTruncEvent(sessionID);
  }

  return { ...part, text };
}

function compactMessageContent(msg: MessageEntry, sessionID: string, maxLen: number): MessageEntry {
  const newParts = msg.parts.map(part => {
    if (part.type === "text" && part.text) {
      return processTextPart(part, sessionID, msg.info.role, maxLen);
    }
    return part;
  });
  return { ...msg, parts: newParts };
}

export const server = async (): Promise<Hooks> => {
  return {
    "experimental.chat.messages.transform": async (input, output) => {
      let messages = output.messages as MessageEntry[];

      if (!messages || messages.length === 0) {
        return output;
      }

      const sessionID = messages[0]?.info?.sessionID || "unknown";

      const excluded = getExcludedSessions();
      if (excluded.has(sessionID)) {
        log(`[${sessionID}] BYPASSED — session is in exclude list`);
        return output;
      }

      const originalCount = messages.length;
      const originalCharCount = countTotalChars(messages);

      trackTurn(sessionID);

      extractOracleVerdicts(messages, sessionID);

      for (const msg of messages) {
        for (const part of msg.parts) {
          if (part.type === "reasoning" && part.text) {
            logReasoning(sessionID, msg.info.role, part.text);
          }
          if (part.type === "text" && part.text) {
            const state = detectCompletionState(part.text);
            const metrics = getOrCreateMetrics(sessionID);
            if (state.gaveup) metrics.gaveup = true;
            if (state.stuck) metrics.stuck = true;
          }
        }
      }

      for (let i = 0; i < messages.length; i++) {
        // Skip assistant chat messages — only truncate tool outputs
        if (messages[i].info.role === "assistant") continue;
        messages[i].parts = messages[i].parts.map(part => {
          if (part.type === "text" && part.text) {
            return processTextPart(part, sessionID, messages[i].info.role, MAX_TEXT_LENGTH);
          }
          return part;
        });
      }

      const afterCleanCount = countTotalChars(messages);

      if (messages.length > MAX_MESSAGES) {
        const systemMessages = messages.filter(m => m.info.role === "system");
        const otherMessages = messages.filter(m => m.info.role !== "system");
        const preservedOther = otherMessages.slice(-MAX_MESSAGES);
        messages = [...systemMessages, ...preservedOther];
        trackTruncEvent(sessionID);
      }

      let totalChars = countTotalChars(messages);
      if (totalChars > MAX_TOTAL_CHARS) {
        const ratio = MAX_TOTAL_CHARS / totalChars;
        const targetLen = Math.floor(MAX_TEXT_LENGTH * ratio);
        messages = messages.map(msg => {
          // Skip assistant chat messages — only truncate tool outputs
          if (msg.info.role === "assistant") return msg;
          return compactMessageContent(msg, sessionID, Math.max(targetLen, 1000));
        });
        trackTruncEvent(sessionID);
      } else {
        messages = messages.map(msg => {
          // Skip assistant chat messages — only truncate tool outputs
          if (msg.info.role === "assistant") return msg;
          return compactMessageContent(msg, sessionID, MAX_TEXT_LENGTH);
        });
      }

      const newCharCount = countTotalChars(messages);
      const newCount = messages.length;

      const metrics = getOrCreateMetrics(sessionID);
      metrics.totalCharsIn += originalCharCount;
      metrics.totalCharsOut += newCharCount;
      metrics.totalTokens += estimateTokens(originalCharCount);
      metrics.lastUpdate = new Date().toISOString();

      const charsSaved = originalCharCount - newCharCount;
      const cleanSaved = originalCharCount - afterCleanCount;
      const pctReduced = originalCharCount > 0
        ? ((1 - newCharCount / originalCharCount) * 100).toFixed(1)
        : "0.0";

      if (charsSaved > 500 || originalCount > MAX_MESSAGES || metrics.truncEvents > 0) {
        log(`[${sessionID}] T${metrics.turns} | msgs: ${originalCount}→${newCount} | chars: ${originalCharCount}→${newCharCount} | trunc: ${metrics.truncEvents} | del: ${metrics.deliverableCount} | saved: ${pctReduced}%`);
      }

      if (metrics.turns % 50 === 0) {
        flushMetrics(sessionID);
      }

      output.messages = messages;
      return output;
    },
  };
};
