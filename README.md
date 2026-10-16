# cost-savers: Agent Context Optimization & Token Reduction Suite

<!-- status-badges (REPO-ACCESS-C) -->
[![status: pre-alpha (under development)](https://img.shields.io/badge/status-pre--alpha%20%28under%20development%29-orange)](STATUS.md) **Status: pre-alpha, under development** — what works today, what is untested and what failed: [`STATUS.md`](STATUS.md)

[![defensive publication: DOI 10.5281/zenodo.23282133](https://img.shields.io/badge/defensive%20publication-DOI%2010.5281%2Fzenodo.23282133-blue)](https://doi.org/10.5281/zenodo.23282133) **Defensive publication:** [`TECHNICAL-DISCLOSURE.md`](TECHNICAL-DISCLOSURE.md) · DOI [10.5281/zenodo.23282133](https://doi.org/10.5281/zenodo.23282133)
<!-- /status-badges -->

**Version:** 0.1.0  
**Licensor:** Juan Carlos De Santiago  
**Licence:** Dual **PolyForm Small Business 1.0.0 OR PolyForm Noncommercial 1.0.0** (user's choice). See `LICENSING.md`.  
**Prior Art Disclosure:** Published defensively as prior art; see `TECHNICAL-DISCLOSURE.md`.

---

## 1. Overview

`cost-savers` is the production token-reduction and cost-control layer developed for the Sovereign Raptor agent fleet. As autonomous agents operate over long sessions (50+ turns), uncurated context accumulation rapidly consumes model context windows, inflates per-turn inference costs, degrades attention accuracy, and leaks sensitive local file system paths or credentials to cloud providers.

This package provides a modular set of agent harness plugins (compatible with the OpenCode plugin architecture) and supporting CLI tools:

1. **`context-trim.ts`**: Sliding-window message pruning with character ceilings per turn. Truncates stale multi-turn tool outputs, caps message lists to 50 entries, and bounds overall session character budgets without breaking task deliverables.
2. **`minimal-system.ts`**: Replaces verbose built-in system prompts (~35k tokens floor) with a compact 1-sentence autonomous directive.
3. **`output-compact.ts`**: Strips tool output noise, collapses multi-newline runs, trims line whitespace, and applies head/tail truncation to large shell and file reads.
4. **`sanitize-cloud-payload.ts`**: Intercepts outgoing requests to cloud models, redacting AWS/OpenAI/cloud credentials, private keys, local absolute user paths, database filenames, and internal infrastructure identifiers.
5. **`cloud-pacer.ts`**: Enforces rate pacing across cloud providers and handles HTTP 429 backoff gracefully.
6. **`context-gate.ts`**: Protects the first 3 turns of an agent session by gating broad reads of logs or schedules, forcing targeted orientation.
7. **`bin/fleet-token-baseline`**: Offline analytical tool joining session metrics to compute token burn, cost, and efficiency across tasks.
8. **`bin/session-prune`**: Safe garbage collector for zero-cost disposable worker/probe sessions.
9. **`bin/token-compactor-weekly` & `bin/token-ledger-compact.py`**: Compaction and rollup tools for token accounting ledgers.

---

## 2. Measured Impact

A pre-registered A/B with real paired agent runs (2026-10-01; `ab/` in this repository: pre-registration, frozen
tasks, harness, all 32 run records with token counts read from opencode's session store, analysis, result):

| Measure (16 paired tasks) | Without the six plugins | With them | Change |
|---|---|---|---|
| Tokens in + out (pre-registered metric) | 394,512 | 173,138 | median −89.3% per task, Wilcoxon p = 0.0046 |
| All processed tokens incl. provider cache reads | 1,309,670 | 1,280,506 | −2.2% |
| Tasks answered correctly | 15 / 16 | 16 / 16 | |
| Median wall time | 12.0 s | 31.2 s | slower (pacing) |

The pre-registered verdict is PASS. Read it with the second row: the fresh-token saving comes from far more provider
prompt-cache hits (cache reads are billed at a fraction of fresh input by most providers); total context processed was
essentially unchanged on these short, read-only tasks, and the design does not isolate whether the plugins cause the
higher cache-hit rate. Long multi-hour sessions, where trimming should matter most, were not tested. Earlier figures
in drafts of this document (character totals from "443 sessions", "p < 0.001") had no traceable data and are withdrawn.

History, metrics and limits: `DOSSIER.md`.

---

## 3. Installation & Configuration

### For OpenCode Users

Add the plugins to your `opencode.jsonc` or `opencode.json` configuration file under the `plugin` array:

```jsonc
{
  "plugin": [
    "./plugins/minimal-system.ts",
    "./plugins/context-gate.ts",
    "./plugins/output-compact.ts",
    "./plugins/context-trim.ts",
    "./plugins/cloud-pacer.ts",
    "./plugins/sanitize-cloud-payload.ts"
  ]
}
```

### Environment Variables

The plugins support portable path configuration via environment variables:
- `COSTSAVER_STATE_DIR`: Directory where metrics logs (`metrics.jsonl`, audit logs) are written. Defaults to `~/.agent` or `./.agent`.

---

## 4. Verification

Run the test suite:
```bash
make test
```
Requires Node.js v22+ and Python 3.10+.
