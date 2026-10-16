> **Status: under development — pre-alpha.** Interfaces, numbers and file layout can change without notice.

# cost-savers — status

Last checked: 2026-10-16, Linux laptop (Intel i5-8365U, 8 threads), on a clean copy of this repo. 6 of 9 suite tests work today; 9 of 9 can run without special hardware. Each line below names its test id in `suite.json` and the evidence file it rests on.

## Works today

- **CS1** Six OpenCode plugins: 6 test files pass (36 assertions) — PASS 2026-10-16 (`# fail 0`); evidence: `DOSSIER.md`, `Makefile`, `tests/test_minimal_system.mjs`, `tests/test_output_compact.mjs`.
- **CS2** Token-baseline tool test (fixture only) — PASS 2026-10-16 (`[+] fleet-token-baseline test passed`); evidence: `tests/test_fleet_token_baseline.py`, `bin/fleet-token-baseline`.
- **CS3** Pre-registered A/B verdict: PASS (median -89.3% fresh tokens, p = 0.0046, 16/16 vs 15/16) — PASS 2026-10-16 (`PASS n=16 median_reduction_P=89.3% p=0.0046 success A 15/16 B 16/16`); evidence: `ab/cost-savers-AB-v2.result.json`, `ab/cost-savers-AB-v2-RESULT.md`, `ab/cost-savers-AB-PREREG-v2.md`.
- **CS6** Independent recomputation of the A/B headline from the 32 run records (stdlib only) — PASS 2026-10-16 (`recomputed: n=16 sumP 394512 -> 173138, median reduction 89.3%, exact one-sided Wilcoxon p=0.0046, success 15/`); evidence: `ab/cost-savers-AB-v2.runs.jsonl`, `ab/analyze_ab_v2.py`, `ab/cost-savers-AB-v2-RESULT.md`.
- **CS7** A/B integrity: 16 frozen tasks, 32 runs, fixed shuffle seed, pre-registered before the runs — PASS 2026-10-16 (`16 tasks, 32 runs, seed 20260929, prereg says written BEFORE any run`); evidence: `ab/ab_v2_tasks.json`, `ab/cost-savers-AB-v2.runs.jsonl`, `ab/run_ab_v2.py`, `ab/cost-savers-AB-PREREG-v2.md`.
- **CS9** Release scan: no leaks, no development paths, nothing vendored — PASS 2026-10-16 (`scan recorded; no /home/<user>/ path in the tree`); evidence: `release-scan.txt`, `PROVENANCE.md`.

## Not yet tested

- Every suite row ran on the test laptop.

## Known failures and honest negatives

- **CS4** Negative qualifier: processed tokens including cache reads barely changed (-2.2%). A negative-leaning result kept on purpose. A randomised-cache long-session A/B is listed in the DOSSIER as the planned next measurement; it has not been run. Recorded and re-checked 2026-10-16 (PASS); evidence: `ab/cost-savers-AB-v2.result.json`, `ab/cost-savers-AB-v2-RESULT.md`, `README.md`
- **CS5** Negative qualifier: the plugin arm was slower (median 31.2 s vs 12.0 s). Latency here was measured on a free model with provider-side variance; no repeat of the timing is recorded. Recorded and re-checked 2026-10-16 (PASS); evidence: `ab/cost-savers-AB-v2.result.json`, `ab/cost-savers-AB-v2-RESULT.md`, `README.md`
- **CS8** Withdrawn earlier figures stay withdrawn (simulated Arm B on 09-29). The withdrawn script (run_ab_eval.py) is not shipped, so the simulation itself cannot be inspected here. Recorded and re-checked 2026-10-16 (PASS); evidence: `DOSSIER.md`, `ab/cost-savers-AB-v2-RESULT.md`, `ab/cost-savers-AB-PREREG-v2.md`
- Quick test `make test` on a fresh copy, load 32.44: **FAIL** — last line `make: *** [Makefile:4: test] Error 9`.
- The Node tests need Node >= 22.6 (`--experimental-strip-types`); the Makefile does not say so. On Node 18 the quick test fails and the suite runner SKIPs CS1. Node 22 itself: not yet measured here.

## Corrections

- No corrections touch this repo.

## How to re-check

- One file, any python3 >= 3.8: download [`sovring-suite.pyz`](https://github.com/SovRing-Labs/SovRing/releases/latest/download/sovring-suite.pyz), then `python3 sovring-suite.pyz --run cost-savers` (headless) or `python3 sovring-suite.pyz` (local page on 127.0.0.1).
- From this checkout: `bash install.sh` (checks python, prepares a venv, runs the suite headless, then opens the page; `--no-gui` to skip the page).
- Quick test only: `node --experimental-strip-types --test tests/test_*.mjs && python3 tests/test_fleet_token_baseline.py`.

## Defensive publication

- `TECHNICAL-DISCLOSURE.md` — on public GitHub since 2026-10-01
- DOI: [10.5281/zenodo.23282133](https://doi.org/10.5281/zenodo.23282133) (Zenodo, see `CITATION.cff`)
- Licence: PolyForm Small Business 1.0.0 OR PolyForm Noncommercial 1.0.0 (your choice); PolyForm Free Trial 1.0.0 for evaluation; data and shard format CC-BY-4.0
