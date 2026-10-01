# RESULT: Cost-Savers A/B v2 (real paired runs)

**Date:** 2026-10-01 · pre-registration: `cost-savers-AB-PREREG-v2.md` (written before any run) · runs:
`cost-savers-AB-v2.runs.jsonl` (32 runs, every token count read back from opencode's session table) · analysis:
`analyze_ab_v2.py` → `cost-savers-AB-v2.result.json`. Supersedes the simulated 2026-09-29 result.

## Verdict as pre-registered: PASS
| Criterion | Bar | Measured |
|---|---|---|
| Median paired reduction of P = tokens in + out | ≥ 20% | **89.3%** |
| One-sided Wilcoxon on paired P | p < 0.05 | **p = 0.0046** |
| Success B ≥ Success A − 5 pts | | **B 16/16 (100%) vs A 15/16 (94%)** |

## What it means (declared secondaries — read these before quoting the headline)
| Measure | Arm A (2 plugins) | Arm B (+6 cost-savers) | Change |
|---|---|---|---|
| Sum of P (in + out) | 394,512 | 173,138 | −56% |
| Sum of all processed tokens (in + out + cache read) | 1,309,670 | 1,280,506 | **−2.2%** (median −0.07%) |
| Median wall time per task | 12.0 s | 31.2 s | B slower |

* The P reduction comes almost entirely from **provider prompt-cache hits**: in 11 of 16 B runs most of the context was
  served as cache reads (billed by most providers at a fraction of fresh input) instead of fresh input. Total context
  processed was essentially unchanged on these short tasks.
* This design does not isolate *why* B hit the cache more often — the plugins may keep the prompt prefix stable
  (cache-friendly), or run order may have warmed the cache. A follow-up should randomise cache state per run.
* B's longer wall time is consistent with the cloud-pacer plugin (pacing is its purpose).
* Billing illustration (not a measurement): at a cache-read price of 10% of fresh input, billed tokens would be
  A ≈ 486,000 vs B ≈ 284,000 (≈ −42%).
* Setting: 16 short, read-only, single-question sessions on `opencode/space-bunny-free`; long multi-hour sessions,
  where context trimming should matter most, are not represented.

## Per task
| Task | A in+out | B in+out | A cache read | B cache read | reduction P | A ok | B ok |
|---|---|---|---|---|---|---|---|
| Q01 | 26,760 | 336 | 30,427 | 56,832 | 98.7% | ✓ | ✓ |
| Q02 | 315 | 166 | 56,832 | 57,712 | 47.3% | ✓ | ✓ |
| Q03 | 26,719 | 27,106 | 30,422 | 30,896 | −1.4% | ✓ | ✓ |
| Q04 | 27,011 | 26,697 | 59,094 | 30,417 | 1.2% | ✓ | ✓ |
| Q05 | 28,647 | 441 | 59,038 | 86,835 | 98.5% | ✓ | ✓ |
| Q06 | 28,887 | 25,236 | 58,969 | 32,000 | 12.6% | ✓ | ✓ |
| Q07 | 28,730 | 613 | 59,575 | 86,640 | 97.9% | ✓ | ✓ |
| Q08 | 28,257 | 979 | 117,016 | 174,545 | 96.5% | ✓ | ✓ |
| Q09 | 905 | 29,698 | 85,376 | 59,365 | −3,181.5% | ✓ | ✓ |
| Q10 | 29,791 | 26,830 | 59,498 | 60,935 | 9.9% | ✓ | ✓ |
| Q11 | 26,980 | 865 | 59,106 | 85,376 | 96.8% | ✓ | ✓ |
| Q12 | 29,441 | 4,588 | 59,077 | 86,666 | 84.4% | ✓ | ✓ |
| Q13 | 26,999 | 851 | 30,420 | 85,632 | 96.8% | ✓ | ✓ |
| Q14 | 28,913 | 1,655 | 89,472 | 85,376 | 94.3% | ✓ | ✓ |
| Q15 | 26,667 | 124 | 30,416 | 57,721 | 99.5% | ✗ | ✓ |
| Q16 | 29,490 | 26,953 | 30,420 | 30,420 | 8.6% | ✓ | ✓ |

## Earlier figures withdrawn
The release README and disclosure drafts carried "1,893,904,352 characters saved (64.1%)", "2,953,588,946 → 1,059,684,594",
"~35,000 → ~710 system-prompt characters", "38.2% → 4.6% dispatches over 100k tokens", "88.4% → 89.1% completion" and
"p < 0.001". None of these appears in any data file, script or log in the repository; they are withdrawn.
