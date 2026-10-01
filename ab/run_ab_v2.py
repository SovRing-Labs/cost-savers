#!/usr/bin/env python3
"""Cost-savers A/B v2 — REAL paired runs (pre-registered: cost-savers-AB-PREREG-v2.md). No simulated numbers anywhere:
every token count is read back from opencode's own session table after the run."""
import json, os, random, sqlite3, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TASKS = json.load(open(HERE / "ab_v2_tasks.json"))
DB = Path.home() / ".local/share/opencode/opencode.db"
MODEL = "opencode/space-bunny-free"
OUT = HERE / "cost-savers-AB-v2.runs.jsonl"
RUN_ID = time.strftime("%m%d%H%M")


def session_tokens(title):
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    row = con.execute("select id, tokens_input, tokens_output, cost from session where title=? order by time_created desc limit 1",
                      (title,)).fetchone()
    con.close()
    return row


def one(task, arm, attempt):
    title = f"ABv2-{RUN_ID}-{arm}-{task['id']}-{attempt}"
    env = dict(os.environ, XDG_CONFIG_HOME=f"/tmp/ab/{arm}")
    t0 = time.time()
    p = subprocess.run(["opencode", "run", "-m", MODEL, "--dir", "/tmp/ab/repo", "--title", title,
                        task["prompt"] + " Answer in one line."], env=env, capture_output=True, text=True, timeout=600)
    wall = time.time() - t0
    row = session_tokens(title)
    return {"task": task["id"], "arm": arm, "attempt": attempt, "title": title, "exit": p.returncode, "wall_s": round(wall, 1),
            "session": row[0] if row else None, "tokens_in": row[1] if row else None, "tokens_out": row[2] if row else None,
            "cost": row[3] if row else None, "success": task["expect"].lower() in p.stdout.lower(),
            "answer_tail": p.stdout.strip()[-200:]}


order = [(t, a) for t in TASKS for a in ("A", "B")]
random.Random(20260929).shuffle(order)
with open(OUT, "a") as f:
    for i, (t, a) in enumerate(order):
        r = one(t, a, 1)
        if r["exit"] != 0 or r["tokens_in"] is None:
            r2 = one(t, a, 2)
            r = r2 if (r2["exit"] == 0 and r2["tokens_in"] is not None) else {**r2, "failed_run": True}
        f.write(json.dumps(r) + "\n"); f.flush()
        print(f"[{i+1}/32] {a} {t['id']} in={r['tokens_in']} out={r['tokens_out']} ok={r['success']} {r['wall_s']}s", flush=True)
print("AB V2 DONE", flush=True)
