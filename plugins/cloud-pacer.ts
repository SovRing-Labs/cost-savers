import type { Hooks } from "@opencode-ai/plugin";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

// ═══════════════════════════════════════════════════════════════════════════════
// CLOUD PACER PLUGIN — SOVEREIGN STREAM STAGGERING & 429 SHIELD (all cloud providers)
//
// Formerly openrouter-pacer.ts (OpenRouter-only). Generalized 2026-09-23 after
// discovering the new Vertex key was getting 429'd with zero pacing — this plugin
// only ever covered providerID === "openrouter" / "openrouter-free" and silently
// no-op'd (0 delay) for every other provider, Vertex included.
//
// 1. Isolated Per-Provider Buckets: Separate /dev/shm state files per account
// 2. Sliding-Window Burst Leaky Bucket: per-provider cap + micro-gap (see PROVIDER_PROFILES)
// 3. Atomic POSIX File Locking: O_CREAT|O_EXCL atomic spinlock with stale-lock auto-break
// 4. Dynamic 429 Interceptor & Backoff Telemetry: Intercepts 429s, cools RAM state, triggers lane-catalog cooldown
//
// Local/self-hosted providers (ollama, vllm-remote) are exempt — no cloud quota to protect.
// Unknown cloud providers fall back to DEFAULT_CLOUD_PROFILE rather than running unpaced.
// ═══════════════════════════════════════════════════════════════════════════════

const SHM_DIR = fs.existsSync("/dev/shm") ? "/dev/shm" : "/tmp";
const LOG_DIR = path.join(process.env.COSTSAVER_STATE_DIR || process.env.HOME || ".", ".agent");
const LOG_FILE = path.join(LOG_DIR, "cloud-pacer.log");
const LANE_CATALOG_BIN = "bin/lane-catalog.py";

interface ProviderProfile {
  maxPerWindow: number;
  windowMs: number;
  microGapMs: number;
}

// Known cloud providers, tuned per their actual limits. This is a per-ACCOUNT
// (shared-key) bucket — correct for OpenRouter/Groq, where the real quota is
// pooled across every model under one key, not per model.
const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  "openrouter": { maxPerWindow: 18, windowMs: 60_000, microGapMs: 300 },
  "openrouter-free": { maxPerWindow: 18, windowMs: 60_000, microGapMs: 300 },
  // Fallback for any google-vertex model without its own entry in
  // VERTEX_MODEL_PROFILES below (see PER_MODEL_BUCKET_PROVIDERS).
  "google-vertex": { maxPerWindow: 4, windowMs: 60_000, microGapMs: 1000 },
  "groq": { maxPerWindow: 25, windowMs: 60_000, microGapMs: 200 },
};

// Providers where different MODELS under the same account genuinely have
// different, independently-enforced quota (confirmed for google-vertex via
// Cloud Quotas API: pinned model IDs like gemini-3.8-flash have no explicit
// quota row yet — NOT_ENOUGH_USAGE_HISTORY, running on a thin unpublished
// default — while gemini-flash-latest has shown zero 429s in practice).
// Pooling these under one account-level bucket would throttle the healthy
// model down to the starved one's rate for no reason. Listed providers get
// a bucket keyed by account+model instead of just account.
const PER_MODEL_BUCKET_PROVIDERS = new Set(["google-vertex"]);

// Per-model overrides for providers in PER_MODEL_BUCKET_PROVIDERS. Falls back
// to PROVIDER_PROFILES[account] for any model not listed here.
const MODEL_PROFILE_OVERRIDES: Record<string, Record<string, ProviderProfile>> = {
  "google-vertex": {
    // Raised to 50/min per J's request 2026-09-23 — note this is a client-side
    // pacing cap only, not real Google-side quota. That project quota row still
    // doesn't exist (NOT_ENOUGH_USAGE_HISTORY as of this date); raising this cap
    // lets more requests fire but doesn't create real capacity, so 429s on this
    // specific model are expected to continue or increase until Google grants
    // a formal quota tier.
    "gemini-3.8-flash": { maxPerWindow: 50, windowMs: 60_000, microGapMs: 100 },
    "gemini-3.5-flash": { maxPerWindow: 4, windowMs: 60_000, microGapMs: 1000 },
    "gemini-2.5-pro": { maxPerWindow: 4, windowMs: 60_000, microGapMs: 1000 },
    "gemini-2.5-flash": { maxPerWindow: 4, windowMs: 60_000, microGapMs: 1000 },
    // The -latest alias has shown no 429s in practice — likely resolves to a
    // release with its own separate, healthier quota. Paced normally, not
    // throttled down to the pinned models' starved rate.
    "gemini-flash-latest": { maxPerWindow: 20, windowMs: 60_000, microGapMs: 300 },
  },
};

// Providers with no cloud quota to protect — always 0 delay.
const UNPACED_PROVIDERS = new Set(["ollama", "vllm-remote"]);

// Fallback for any cloud provider we don't have a tuned profile for yet.
// Better to pace conservatively than let a new provider run wide open.
const DEFAULT_CLOUD_PROFILE: ProviderProfile = { maxPerWindow: 10, windowMs: 60_000, microGapMs: 500 };

const LOCK_TIMEOUT_MS = 6_000;          // Max time to wait for file lock
const LOCK_STALE_MS = 10_000;           // Stale lock expiration

interface PacerState {
  account: string;
  timestamps: number[];
  coolUntil: number;
  coolReason: string;
  lastUpdated: number;
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // Fail-open for logging
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPacerPaths(account: string) {
  const safeAccount = account.replace(/[^a-zA-Z0-9_\-]/g, "_");
  return {
    statePath: path.join(SHM_DIR, `cloud-pacer-${safeAccount}.json`),
    lockPath: path.join(SHM_DIR, `cloud-pacer-${safeAccount}.lock`),
  };
}

function acquireLockSync(lockPath: string): boolean {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    try {
      // O_CREAT | O_EXCL is atomic across all processes
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o666);
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      fs.closeSync(fd);
      return true;
    } catch (err: any) {
      if (err.code === "EEXIST") {
        // Lock exists. Check for staleness
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // File might have been unlinked in between; retry
          continue;
        }
      }
      // Sleep a tiny randomized interval to prevent lockstep thundering herds
      const jitter = 10 + Math.floor(Math.random() * 20);
      const endWait = Date.now() + jitter;
      while (Date.now() < endWait) { /* busy sleep */ }
    }
  }
  return false;
}

function releaseLockSync(lockPath: string) {
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Ignore unlink race
  }
}

function readStateSync(statePath: string, account: string): PacerState {
  try {
    if (fs.existsSync(statePath)) {
      const data = fs.readFileSync(statePath, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore parse errors, return default
  }
  return {
    account,
    timestamps: [],
    coolUntil: 0,
    coolReason: "",
    lastUpdated: Date.now(),
  };
}

function writeStateSync(statePath: string, state: PacerState) {
  try {
    const tmpPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    // Direct write fallback
    try {
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch {
      // Ignore
    }
  }
}

function getProfile(account: string, modelID: string): ProviderProfile {
  if (PER_MODEL_BUCKET_PROVIDERS.has(account)) {
    const override = MODEL_PROFILE_OVERRIDES[account]?.[modelID];
    if (override) return override;
  }
  return PROVIDER_PROFILES[account] || DEFAULT_CLOUD_PROFILE;
}

/** Bucket key: account+model for providers with per-model quota, else just account. */
function getBucketKey(account: string, modelID: string): string {
  return PER_MODEL_BUCKET_PROVIDERS.has(account) ? `${account}:${modelID}` : account;
}

/**
 * Resolve the pacer "account" bucket for a request. Returns null for
 * local/self-hosted providers (no pacing needed) or when the provider
 * can't be identified at all (fail-open rather than guess).
 */
function resolveAccount(input: {
  model?: { providerID?: string; id?: string; api?: { url?: string } };
  provider?: { info?: { id?: string } };
}): string | null {
  const providerID = input.model?.providerID || input.provider?.info?.id || "";
  const modelID = input.model?.id || "";
  const apiUrl = input.model?.api?.url || "";

  if (UNPACED_PROVIDERS.has(providerID)) {
    return null;
  }

  if (providerID === "openrouter-free" || modelID.startsWith("openrouter-free/")) {
    return "openrouter-free";
  }
  if (providerID === "openrouter" || modelID.startsWith("openrouter/") || apiUrl.includes("openrouter.ai")) {
    return "openrouter";
  }
  if (
    providerID === "vertexii" ||
    providerID === "google-vertex" ||
    apiUrl.includes("aiplatform.googleapis.com") ||
    (apiUrl.includes("googleapis.com") && /gemini|vertex/i.test(modelID))
  ) {
    return "google-vertex";
  }
  if (providerID === "groq" || apiUrl.includes("api.groq.com")) {
    return "groq";
  }

  if (!providerID) {
    return null; // Can't identify provider at all — fail open rather than guess
  }

  // Unknown cloud provider: pace conservatively rather than let it run wide open
  return providerID;
}

async function paceRequest(account: string, modelName: string): Promise<void> {
  const bucketKey = getBucketKey(account, modelName);
  const { statePath, lockPath } = getPacerPaths(bucketKey);
  const profile = getProfile(account, modelName);

  let waitMs = 0;
  const locked = acquireLockSync(lockPath);
  if (!locked) {
    log(`[${bucketKey}] WARN: Lock acquisition timed out; fail-open with 300ms fallback`);
    await sleep(300);
    return;
  }

  try {
    const now = Date.now();
    const state = readStateSync(statePath, bucketKey);

    // 1. Check active cooldown
    if (state.coolUntil > now) {
      const coolRemaining = state.coolUntil - now;
      log(`[${bucketKey}] ACTIVE COOLDOWN: ${coolRemaining}ms remaining (Reason: ${state.coolReason})`);
      if (coolRemaining <= 60_000) {
        // Wait out short cooldowns
        waitMs = coolRemaining;
      }
    }

    // 2. Sliding window purge
    const validTimestamps = state.timestamps.filter((t) => t > now - profile.windowMs);

    // 3. Compute next target time
    const lastTimestamp = validTimestamps.length > 0 ? validTimestamps[validTimestamps.length - 1] : 0;
    let targetTime = Math.max(now, lastTimestamp + profile.microGapMs);

    if (validTimestamps.length >= profile.maxPerWindow) {
      // Burst ceiling reached: wait until the oldest request falls outside the window
      const oldestIndex = validTimestamps.length - profile.maxPerWindow;
      const oldestTimestamp = validTimestamps[oldestIndex];
      const windowClearTime = oldestTimestamp + profile.windowMs + 100;
      targetTime = Math.max(targetTime, windowClearTime);
    }

    // 4. Reserve targetTime slot
    validTimestamps.push(targetTime);
    state.timestamps = validTimestamps;
    state.lastUpdated = Date.now();
    writeStateSync(statePath, state);

    waitMs = Math.max(waitMs, targetTime - now);
  } finally {
    // Release atomic lock immediately so other processes are never blocked
    releaseLockSync(lockPath);
  }

  if (waitMs > 0) {
    log(`[${bucketKey}] Pacing stream for ${waitMs}ms | model=${modelName} | cap=${profile.maxPerWindow}/${profile.windowMs}ms`);
    await sleep(waitMs);
  }
}

function cooldownBucket(bucketKey: string, backoffSeconds: number, errMsg: string) {
  const { statePath, lockPath } = getPacerPaths(bucketKey);
  if (acquireLockSync(lockPath)) {
    try {
      const state = readStateSync(statePath, bucketKey);
      state.coolUntil = Date.now() + backoffSeconds * 1000;
      state.coolReason = errMsg.slice(0, 100);
      state.lastUpdated = Date.now();
      writeStateSync(statePath, state);
    } finally {
      releaseLockSync(lockPath);
    }
  }
}

function handle429Error(account: string, modelId: string, errorObj: any) {
  const errMsg = String(errorObj?.message || errorObj?.responseBody || JSON.stringify(errorObj) || "");

  // Determine backoff duration
  let backoffSeconds = 60; // default 60s for transient per-minute limits
  let isDaily = false;

  if (errMsg.includes("free-models-per-day") || errMsg.includes("daily")) {
    backoffSeconds = 3600; // 1 hour bench for daily quotas
    isDaily = true;
  } else {
    // Check for retry-after header or text
    const match = errMsg.match(/retry[- ]after[: ]+(\d+)/i);
    if (match) {
      backoffSeconds = Math.max(10, parseInt(match[1], 10));
    }
  }

  log(`[${account}] 429 INTERCEPTED: ${errMsg.slice(0, 150)} -> Backoff: ${backoffSeconds}s (daily=${isDaily})`);

  // Update RAM-disk pacer state. The event hook usually can't attribute a
  // 429 to a specific model, so for per-model-bucketed providers we cool
  // every known model bucket for this account (small, bounded list) plus
  // the base account bucket — safer to over-cool a healthy model briefly
  // than to silently miss cooling the one that actually 429'd.
  if (modelId) {
    cooldownBucket(getBucketKey(account, modelId), backoffSeconds, errMsg);
  } else if (PER_MODEL_BUCKET_PROVIDERS.has(account)) {
    cooldownBucket(account, backoffSeconds, errMsg);
    for (const knownModel of Object.keys(MODEL_PROFILE_OVERRIDES[account] || {})) {
      cooldownBucket(getBucketKey(account, knownModel), backoffSeconds, errMsg);
    }
  } else {
    cooldownBucket(account, backoffSeconds, errMsg);
  }

  // Bench lane in SQLite lane-catalog so dispatcherd re-routes automatically
  const laneId = modelId ? `${account}/${modelId}`.replace(`${account}/${account}/`, `${account}/`) : "";
  if (laneId && fs.existsSync(LANE_CATALOG_BIN)) {
    exec(`python3 ${LANE_CATALOG_BIN} --cooldown "${laneId}" ${backoffSeconds}`, (err, stdout, stderr) => {
      if (err) {
        log(`[${account}] lane-catalog cooldown failed for ${laneId}: ${stderr || err.message}`);
      } else {
        log(`[${account}] lane-catalog benched ${laneId} for ${backoffSeconds}s`);
      }
    });
  }
}

/** Best-effort account resolution from a session.error event (no model object available). */
function resolveAccountFromError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("openrouter-free")) return "openrouter-free";
  if (lower.includes("openrouter")) return "openrouter";
  if (lower.includes("vertexii") || lower.includes("google-vertex") || lower.includes("vertex") || lower.includes("aiplatform") || lower.includes("resource_exhausted") || lower.includes("resource exhausted")) return "google-vertex";
  if (lower.includes("groq")) return "groq";
  return "unknown-cloud";
}

export const server = async (): Promise<Hooks> => {
  return {
    "chat.params": async (input, output) => {
      const account = resolveAccount(input);
      if (!account) {
        return; // Local provider or unidentifiable: 0 delay
      }
      const modelName = input.model?.id || "unknown";
      await paceRequest(account, modelName);
    },

    event: async (input) => {
      if (input.event?.type === "session.error") {
        const err = (input.event as any)?.properties?.error;
        if (!err) return;

        const statusCode = err.statusCode || err.status;
        const msg = String(err.message || "");
        if (statusCode === 429 || msg.includes("Rate limit") || msg.includes("429") || msg.toLowerCase().includes("resource_exhausted")) {
          const account = resolveAccountFromError(msg);
          handle429Error(account, "", err);
        }
      }
    },
  };
};
