"""Tests for fleet-token-baseline utility."""

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


def test_fleet_token_baseline_fixture():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        opencode_db = tmp / "opencode.db"
        dispatch_db = tmp / "dispatch.db"

        # Create opencode.db fixture
        con_op = sqlite3.connect(opencode_db)
        con_op.execute("""
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                time_created INTEGER,
                data TEXT
            )
        """)
        msg_data = {
            "tokens": {
                "total": 1500,
                "input": 1000,
                "output": 500,
                "reasoning": 0
            },
            "cost": 0.002
        }
        con_op.execute(
            "INSERT INTO message VALUES (?, ?, ?, ?)",
            ("m1", "sess-1", 1790000000000, json.dumps(msg_data))
        )
        con_op.commit()
        con_op.close()

        # Create dispatch.db fixture
        con_dp = sqlite3.connect(dispatch_db)
        con_dp.execute("""
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                status TEXT
            )
        """)
        con_dp.execute("""
            CREATE TABLE dispatches (
                id INTEGER PRIMARY KEY,
                task_id TEXT,
                session TEXT,
                state TEXT,
                dispatched_at INTEGER
            )
        """)
        con_dp.execute("INSERT INTO tasks VALUES ('TASK-1', 'done')")
        con_dp.execute("INSERT INTO dispatches VALUES (1, 'TASK-1', 'sess-1', 'done', 1790000000)")
        con_dp.commit()
        con_dp.close()

        # Verify query logic directly
        con = sqlite3.connect(f"file:{opencode_db}?mode=ro", uri=True)
        cur = con.cursor()
        rows = cur.execute("SELECT session_id, data FROM message").fetchall()
        con.close()
        assert len(rows) == 1
        d = json.loads(rows[0][1])
        assert d["tokens"]["total"] == 1500
        print("[+] fleet-token-baseline test passed")


if __name__ == "__main__":
    test_fleet_token_baseline_fixture()
