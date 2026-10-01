#!/usr/bin/env python3
"""Analyse cost-savers A/B v2 runs exactly as pre-registered (P = tokens_in + tokens_out), plus declared secondaries:
cache-read tokens and total processed tokens (in + out + cache read), success, wall time."""
import json, sqlite3, statistics
from pathlib import Path
from scipy.stats import wilcoxon

HERE = Path(__file__).resolve().parent
DB = Path.home() / ".local/share/opencode/opencode.db"
runs = [json.loads(l) for l in open(HERE / "cost-savers-AB-v2.runs.jsonl")]
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)


def cache_read(sid):
    if not sid:
        return None
    v = con.execute("select sum(json_extract(data,'$.tokens.cache.read')) from message where session_id=?", (sid,)).fetchone()[0]
    return v or 0


by = {}
for r in runs:
    r["cache_read"] = cache_read(r.get("session"))
    by.setdefault(r["task"], {})[r["arm"]] = r
pairs = [(t, d["A"], d["B"]) for t, d in sorted(by.items()) if "A" in d and "B" in d
         and d["A"].get("tokens_in") is not None and d["B"].get("tokens_in") is not None]
P = lambda r: r["tokens_in"] + r["tokens_out"]  # noqa: E731
T = lambda r: r["tokens_in"] + r["tokens_out"] + (r["cache_read"] or 0)  # noqa: E731
red = [(P(a) - P(b)) / P(a) for _, a, b in pairs]
red_total = [(T(a) - T(b)) / T(a) for _, a, b in pairs]
stat, p = wilcoxon([P(a) for _, a, _ in pairs], [P(b) for _, _, b in pairs], alternative="greater")
succ_a = sum(a["success"] for _, a, _ in pairs) / len(pairs)
succ_b = sum(b["success"] for _, _, b in pairs) / len(pairs)
res = {"n_pairs": len(pairs), "median_reduction_P": statistics.median(red), "wilcoxon_p": float(p),
       "success_A": succ_a, "success_B": succ_b, "median_reduction_total_incl_cache": statistics.median(red_total),
       "sum_P_A": sum(P(a) for _, a, _ in pairs), "sum_P_B": sum(P(b) for _, _, b in pairs),
       "sum_total_A": sum(T(a) for _, a, _ in pairs), "sum_total_B": sum(T(b) for _, _, b in pairs),
       "median_wall_A": statistics.median(a["wall_s"] for _, a, _ in pairs),
       "median_wall_B": statistics.median(b["wall_s"] for _, _, b in pairs)}
res["PASS"] = res["median_reduction_P"] >= 0.20 and p < 0.05 and succ_b >= succ_a - 0.05
print(json.dumps(res, indent=1))
print("\n| Task | A in+out | B in+out | A cache read | B cache read | reduction P | A ok | B ok |")
for t, a, b in pairs:
    print(f"| {t} | {P(a):,} | {P(b):,} | {a['cache_read']:,} | {b['cache_read']:,} | {(P(a)-P(b))/P(a):.1%} | {a['success']} | {b['success']} |")
json.dump({"summary": res, "pairs": [{"task": t, "A": a, "B": b} for t, a, b in pairs]},
          open(HERE / "cost-savers-AB-v2.result.json", "w"), indent=1)
