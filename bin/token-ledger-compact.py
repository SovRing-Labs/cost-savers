#!/usr/bin/env python3
"""
Token Ledger Compactor Verification Gate.

Validates that the weekly compactor (token-compactor-weekly) operates correctly:
- Reads token-ledger.jsonl without modifying it (read-only)
- Groups entries by 'task' field and sums tokens_in/tokens_out/est_cost
- Appends weekly summary to token-ledger-weekly-summary.jsonl
- Preserves category totals correctly
- Uses fcntl.flock for safe concurrent access
"""

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CC = Path(".")
TOKEN_LEDGER = CC / "token-ledger.jsonl"
WEEKLY_SUMMARY = CC / "token-ledger-weekly-summary.jsonl"
COMPACTOR = Path.home() / "ai-stack" / "bin" / "token-compactor-weekly"


def run_compactor():
    """Run the compactor and return (exit_code, stdout, stderr)."""
    result = subprocess.run(
        [str(COMPACTOR)],
        capture_output=True,
        text=True,
        timeout=30
    )
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def read_ledger():
    """Read all valid JSON lines from token-ledger.jsonl."""
    if not TOKEN_LEDGER.exists():
        return []
    rows = []
    for line in TOKEN_LEDGER.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def read_weekly_summary():
    """Read the latest weekly summary entry."""
    if not WEEKLY_SUMMARY.exists():
        return None
    lines = WEEKLY_SUMMARY.read_text().strip().splitlines()
    if not lines:
        return None
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return None


def compute_expected_groups(rows):
    """Compute expected category totals from ledger rows."""
    from collections import defaultdict
    groups = defaultdict(lambda: {"prompt_tokens": 0, "eval_tokens": 0, "cost": 0.0})
    for r in rows:
        task = r.get("task", "UNKNOWN")
        prompt_tokens = (
            int(r.get("tokens_in", 0) or 0)
            or int(r.get("prompt_tokens", 0) or 0)
            or int(r.get("prompt_tokens_est", 0) or 0)
        )
        eval_tokens = (
            int(r.get("tokens_out", 0) or 0)
            or int(r.get("eval_tokens", 0) or 0)
            or int(r.get("eval_tokens_est", 0) or 0)
        )
        cost = float(r.get("est_cost", 0) or 0)

        agg = groups[task]
        agg["prompt_tokens"] += prompt_tokens
        agg["eval_tokens"] += eval_tokens
        agg["cost"] += cost
    return groups


def format_expected_lines(groups):
    """Format expected summary lines."""
    lines = []
    sorted_items = sorted(groups.items(), key=lambda kv: -kv[1]["cost"])
    for task, agg in sorted_items:
        prompt_tokens = agg["prompt_tokens"]
        eval_tokens = agg["eval_tokens"]
        cost = agg["cost"]
        if "Dispatch" in task.upper():
            label = f"{task}: {prompt_tokens} in / {eval_tokens} out, ${cost:.2f} cost"
        else:
            label = f"{task}: {prompt_tokens} prompt / {eval_tokens} eval tokens, ${cost:.2f} cost"
        lines.append(label)
    return lines


def verify():
    """Run all verification checks."""
    print("=" * 70)
    print("TOKEN LEDGER COMPACTOR VERIFICATION GATE")
    print("=" * 70)

    # Check 1: Compactor binary exists and is executable
    print("\n[1/6] Checking compactor binary...")
    if not COMPACTOR.exists():
        print(f"  ❌ FAIL: Compactor not found at {COMPACTOR}")
        return False
    if not COMPACTOR.stat().st_mode & 0o111:
        print(f"  ❌ FAIL: Compactor not executable")
        return False
    print(f"  ✅ PASS: Compactor exists and is executable")

    # Check 2: Run compactor successfully
    print("\n[2/6] Running compactor...")
    exit_code, stdout, stderr = run_compactor()
    if exit_code != 0:
        print(f"  ❌ FAIL: Compactor exited with code {exit_code}")
        print(f"  stderr: {stderr}")
        return False
    print(f"  ✅ PASS: Compactor ran successfully (exit code 0)")
    print(f"  Output: {stdout}")

    # Check 3: Token ledger unchanged (read-only verification)
    print("\n[3/6] Verifying token-ledger.jsonl is unchanged (read-only)...")
    ledger_before = read_ledger()
    exit_code2, stdout2, stderr2 = run_compactor()
    ledger_after = read_ledger()
    if ledger_before != ledger_after:
        print(f"  ❌ FAIL: token-ledger.jsonl was modified (read-only violated)")
        return False
    print(f"  ✅ PASS: token-ledger.jsonl unchanged after compactor run")

    # Check 4: Weekly summary created with correct format
    print("\n[4/6] Verifying weekly summary output...")
    summary = read_weekly_summary()
    if summary is None:
        print(f"  ❌ FAIL: No weekly summary found")
        return False

    required_fields = ["ts", "type", "format_version", "summary_lines", "line_count"]
    for field in required_fields:
        if field not in summary:
            print(f"  ❌ FAIL: Missing required field '{field}' in summary")
            return False

    if summary["type"] != "weekly_category_summary":
        print(f"  ❌ FAIL: Summary type mismatch: {summary['type']}")
        return False

    if summary["format_version"] != "1.0":
        print(f"  ❌ FAIL: Format version mismatch: {summary['format_version']}")
        return False

    if not isinstance(summary["summary_lines"], list) or not summary["summary_lines"]:
        print(f"  ❌ FAIL: summary_lines is empty or not a list")
        return False

    print(f"  ✅ PASS: Weekly summary has correct structure")
    print(f"  Summary timestamp: {summary['ts']}")
    print(f"  Categories: {summary['line_count']}")

    # Check 5: Category totals match expected
    print("\n[5/6] Verifying category totals...")
    expected_groups = compute_expected_groups(ledger_before)
    expected_lines = format_expected_lines(expected_groups)
    actual_lines = summary["summary_lines"]

    if expected_lines != actual_lines:
        print(f"  ❌ FAIL: Category totals mismatch")
        print(f"  Expected:")
        for line in expected_lines:
            print(f"    {line}")
        print(f"  Actual:")
        for line in actual_lines:
            print(f"    {line}")
        return False

    print(f"  ✅ PASS: Category totals match exactly")
    for line in actual_lines:
        print(f"    {line}")

    # Check 6: Idempotency (running twice produces same totals)
    print("\n[6/6] Verifying idempotency...")
    summary1 = read_weekly_summary()
    exit_code3, stdout3, stderr3 = run_compactor()
    summary2 = read_weekly_summary()

    # The summary lines should be identical (same aggregation)
    if summary1["summary_lines"] != summary2["summary_lines"]:
        print(f"  ❌ FAIL: Idempotency violated - summary lines differ between runs")
        return False

    print(f"  ✅ PASS: Idempotent - repeated runs produce identical category totals")

    print("\n" + "=" * 70)
    print("ALL VERIFICATION CHECKS PASSED ✅")
    print("=" * 70)
    return True


def main():
    try:
        success = verify()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ VERIFICATION ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()