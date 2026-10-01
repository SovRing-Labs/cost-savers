# A/B evidence (2026-10-01)

* `cost-savers-AB-PREREG-v2.md` — pre-registration, written before any run.
* `ab_v2_tasks.json` — the 16 frozen read-only questions and expected answers (over a clone of
  github.com/SovRing-Labs/omnitool).
* `run_ab_v2.py` — harness: 32 runs shuffled with seed 20260929; each arm gets its own opencode config directory
  (`XDG_CONFIG_HOME=/tmp/ab/A|B`, differing only in the six plugins); token counts are read back from opencode's
  session database after each run. To reproduce: copy your opencode config into `/tmp/ab/A/opencode` and
  `/tmp/ab/B/opencode`, set the two `plugin` arrays, clone omnitool to `/tmp/ab/repo`, run the script.
* `cost-savers-AB-v2.runs.jsonl` — every run as recorded (session id, tokens, wall time, success, answer tail).
* `analyze_ab_v2.py` → `cost-savers-AB-v2.result.json`, summarised in `cost-savers-AB-v2-RESULT.md`.
