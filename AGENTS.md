# AGENTS.md — cost-savers

For coding assistants (and people) setting this repository up. Plain steps; every command runs from the repo root.

**Status: pre-alpha, under development.** Interfaces, numbers and file layout can change without notice. Read `STATUS.md` first: what works today (each line names its test and evidence file), what is not yet tested, the known failures and the corrections.

## What it is
Six OpenCode plugins and four CLI tools that cut what coding agents send to paid models, with a pre-registered paired A/B.

## Install and check (3 commands)
```bash
git clone --depth 1 https://github.com/SovRing-Labs/cost-savers && cd cost-savers
# nothing to install beyond: node>=22.6, python3>=3.10
make test   # expect: All cost-savers tests PASSED.
```
Needs: node>=22.6, python3>=3.10.
Whole suite instead: `bash install.sh --no-gui` (python check → venv → every runnable `suite.json` test, headless; without `--no-gui` it then opens the local results page on 127.0.0.1).
Measured: 0.2s on a fresh clone (Intel i5-8365U laptop, 2026-10-16, exit 2).
Note: needs Node 22.6+ (--experimental-strip-types); the census laptop has Node 18.19, where `make test` stops at "node: bad option" — on Node 22.6+ not yet measured here; on older Node only `python3 tests/test_fleet_token_baseline.py` runs.

## What the tests mean
`suite.json` lists every claim this repository makes with its verify command, the expected output, what passing means, how the number was obtained and how to use it in your own work (9 tests, in `suite.json` at the repository root). `STATUS.md` says what works today, what is not yet tested and the known failures; the umbrella's `STATUS.md` has one row per repository.

## Where the evidence is
- `DOSSIER.md` — history, metrics and limits
- `TECHNICAL-DISCLOSURE.md` — the method, as dated prior art
- `CITATION.cff` — DOI 10.5281/zenodo.23282133

## Honest limits (from DOSSIER.md)
The A/B covers short, read-only sessions on one free model; long sessions and other providers are untested. `cloud-pacer` deliberately slows requests. Plugins target OpenCode's plugin hooks; other agent runners need adapters.

## Licence
PolyForm Small Business 1.0.0 OR PolyForm Noncommercial 1.0.0 (free trial for evaluation). Details: `LICENSING.md`.

## Guided setup through MCP
The SovRing umbrella ships an MCP server that explains, checks readiness, clones and runs these tests: https://github.com/SovRing-Labs/SovRing (README → "Paste this to your assistant"). Zero-install docs endpoint: https://gitmcp.io/SovRing-Labs/cost-savers
