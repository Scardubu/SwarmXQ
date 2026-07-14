"""
tests/agents/test_executor — Unit tests for agents.executor async parallel executor.

Covers:
  - Basic parallel execution via asyncio.gather
  - Per-step error capture (not propagated globally)
  - Mixed sync/async dispatcher support
  - Sync wrapper for legacy callers
  - Empty step list edge case
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

from agents.executor import execute_parallel, execute_parallel_sync

# ── Async dispatchers for tests ────────────────────────────────────────────────

async def _ok_dispatcher(step):
    await asyncio.sleep(0)
    return f"done:{step}"


async def _failing_dispatcher(step):
    if step == "fail-me":
        raise RuntimeError("deliberate failure")
    return f"done:{step}"


def _sync_dispatcher(step):
    """Synchronous dispatcher — should work via asyncio.to_thread wrapper."""
    return f"sync:{step}"


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_execute_parallel_basic():
    """All steps execute and return results."""
    steps = ["a", "b", "c"]
    results = asyncio.run(execute_parallel(steps, _ok_dispatcher))
    assert len(results) == 3
    assert all(r["error"] is None for r in results)
    result_values = {r["step"]: r["result"] for r in results}
    assert result_values["a"] == "done:a"
    assert result_values["b"] == "done:b"
    assert result_values["c"] == "done:c"


def test_execute_parallel_captures_errors_per_step():
    """A failing step is captured per-step; other steps still succeed."""
    steps = ["ok-1", "fail-me", "ok-2"]
    results = asyncio.run(execute_parallel(steps, _failing_dispatcher))
    assert len(results) == 3

    by_step = {r["step"]: r for r in results}
    assert by_step["ok-1"]["error"] is None
    assert by_step["ok-1"]["result"] == "done:ok-1"

    assert by_step["fail-me"]["error"] is not None
    assert "deliberate failure" in by_step["fail-me"]["error"]
    assert by_step["fail-me"]["result"] is None

    assert by_step["ok-2"]["error"] is None


def test_execute_parallel_sync_dispatcher():
    """Sync dispatcher is automatically wrapped via asyncio.to_thread."""
    steps = ["x", "y"]
    results = asyncio.run(execute_parallel(steps, _sync_dispatcher))
    assert len(results) == 2
    by_step = {r["step"]: r["result"] for r in results}
    assert by_step["x"] == "sync:x"
    assert by_step["y"] == "sync:y"


def test_execute_parallel_empty_steps():
    """Empty step list returns empty result list without error."""
    results = asyncio.run(execute_parallel([], _ok_dispatcher))
    assert results == []


def test_execute_parallel_concurrent(benchmark=None):
    """Steps execute concurrently — wall clock < serial sum.

    [V6.1-FIX-12] Patch agents.executor._SWARM_HOME to suppress event-bus
    JSONL file I/O (adds 0.3-1.5 s on RAM-pressured systems with SWARM_HOME set).
    Time the gather inside an already-running loop to exclude asyncio.run()
    startup overhead.  4 x 0.1 s serial = 0.40 s; pure gather should be < 0.25 s.
    """
    import agents.executor as _ex

    SLEEP = 0.1
    steps = ["s1", "s2", "s3", "s4"]
    elapsed_holder: list[float] = []

    async def _inner():
        async def slow_step(step):
            await asyncio.sleep(SLEEP)
            return step

        t0 = time.monotonic()
        results = await execute_parallel(steps, slow_step)
        elapsed_holder.append(time.monotonic() - t0)
        return results

    with patch.object(_ex, "_SWARM_HOME", ""):
        results = asyncio.run(_inner())

    elapsed = elapsed_holder[0]
    assert len(results) == 4
    assert all(r["error"] is None for r in results)
    # Serial: 4 x 0.1 s = 0.40 s; parallel gather (no event I/O) should be < 0.25 s
    assert elapsed < 0.25, f"Expected concurrent execution, took {elapsed:.3f}s"


def test_execute_parallel_sync_wrapper():
    """execute_parallel_sync() produces identical results to the async version."""
    steps = ["p", "q", "r"]
    results = execute_parallel_sync(steps, _sync_dispatcher)
    assert len(results) == 3
    by_step = {r["step"]: r["result"] for r in results}
    assert by_step["p"] == "sync:p"
    assert by_step["q"] == "sync:q"
    assert by_step["r"] == "sync:r"


def test_result_dict_structure():
    """Each result dict has the expected keys: step, result, error."""
    results = asyncio.run(execute_parallel(["z"], _ok_dispatcher))
    r = results[0]
    assert "step" in r
    assert "result" in r
    assert "error" in r
