# cost-savers — Dossier

*History, specification, metrics, tests and limits. Companion to `TECHNICAL-DISCLOSURE.md` and `README.md`.*

## What it is

Six OpenCode plugins and four command-line tools that cut what AI coding agents send to paid models: a minimal system
prompt, an early-turn context gate, tool-output compaction, context trimming, cross-provider pacing with 429 back-off,
and scrubbing of cloud payloads; plus token-baseline reporting, session pruning and ledger compaction. In the stack they
are the **cost savers** pillar. Stage (essay 07): tools → protocol.

## Creation history

| Date (2026) | Milestone |
|---|---|
| late Aug | `minimal-system` replaces OpenCode's verbose built-in system prompt (the "~35k per request floor" noted in its source); KV-cache keep-alive policy for local models |
| Sep | `context-trim`, `output-compact`, `sanitize-cloud-payload`, `cloud-pacer`, `context-gate` added to the fleet's live plugin list |
| 09-29 | Release prep; `seat-ledger`, `step-recovery`, `tool-lock` excluded (coupled to the private fleet or not wired) |
| 09-29 | An "A/B" result is produced by a script that simulated Arm B; caught on 10-01 and withdrawn with the untraceable character totals |
| 10-01 | Real pre-registered A/B: 32 paired runs, token counts from OpenCode's own store (below) |

## Metrics (A/B v2, 2026-10-01; evidence in `ab/`)

| Measure | Result |
|---|---|
| Pre-registered verdict | PASS (median −89.3% fresh tokens in+out, p = 0.0046, success 16/16 vs 15/16) |
| All processed tokens incl. cache reads | −2.2% |
| Interpretation | Savings come from higher provider prompt-cache hit rates; cause not isolated; long sessions not tested |
| Median wall time | 31.2 s vs 12.0 s (pacing) |

## Tests

`make test`: 6 plugin test files (node:test, 36 assertions) + the token-baseline test — all pass.

## Limits

* The A/B covers short, read-only sessions on one free model; long sessions and other providers are untested.
* `cloud-pacer` deliberately slows requests.
* Plugins target OpenCode's plugin hooks; other agent runners need adapters.

## Next measurement (planned)

Long-session A/B (multi-step build tasks) with the provider cache state randomised per run, to separate context
trimming from cache effects.

Lineage: `PROVENANCE.md`. Updates: weekly, recorded here with dates.
