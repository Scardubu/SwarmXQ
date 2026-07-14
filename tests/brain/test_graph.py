"""
tests/brain/test_graph — Tests for brain.graph DAG executor.

Covers: topological ordering, parallel execution, cycle detection,
dep-failure skip, and the sync wrapper.
"""
from __future__ import annotations

import asyncio
import time

import pytest

from brain.graph import TaskGraph, TaskNode, build_graph_from_plan

# ── Async helpers ─────────────────────────────────────────────────────────────

async def _fast_dispatcher(node_id: str, task) -> str:
    await asyncio.sleep(0)  # yield control
    return f"result-{node_id}"


async def _slow_dispatcher(node_id: str, task) -> str:
    await asyncio.sleep(0.05)
    return f"result-{node_id}"


async def _fail_dispatcher(node_id: str, task) -> str:
    if node_id == "b":
        raise ValueError("deliberate failure")
    return f"result-{node_id}"


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_simple_linear_graph():
    """Nodes execute in dependency order and all complete."""
    graph = TaskGraph([
        TaskNode("a", "task-a"),
        TaskNode("b", "task-b", depends_on=["a"]),
        TaskNode("c", "task-c", depends_on=["b"]),
    ])
    results = asyncio.run(graph.execute(_fast_dispatcher))
    assert all(r.ok() for r in results.values())
    assert results["a"].result == "result-a"
    assert results["c"].result == "result-c"


def test_parallel_independent_nodes():
    """Independent nodes at the same level run concurrently (wall-clock check)."""
    graph = TaskGraph([
        TaskNode("root", "root"),
        TaskNode("p1", "parallel-1", depends_on=["root"]),
        TaskNode("p2", "parallel-2", depends_on=["root"]),
        TaskNode("p3", "parallel-3", depends_on=["root"]),
        TaskNode("join", "join", depends_on=["p1", "p2", "p3"]),
    ])
    t0 = time.monotonic()
    results = asyncio.run(graph.execute(_slow_dispatcher))
    elapsed = time.monotonic() - t0

    assert all(r.ok() for r in results.values())
    # p1/p2/p3 are parallel — should finish in ~0.1 s, not ~0.15 s (serial)
    assert elapsed < 0.20, f"Parallel nodes took too long: {elapsed:.3f}s"


def test_cycle_detection_raises():
    """A cyclic dependency graph raises ValueError before execution."""
    with pytest.raises(ValueError, match="[Cc]ycle"):
        TaskGraph([
            TaskNode("a", "task-a", depends_on=["c"]),
            TaskNode("b", "task-b", depends_on=["a"]),
            TaskNode("c", "task-c", depends_on=["b"]),
        ])


def test_unknown_dependency_raises():
    """Referencing a non-existent dep node raises ValueError."""
    with pytest.raises(ValueError):
        TaskGraph([
            TaskNode("a", "task-a", depends_on=["nonexistent"]),
        ])


def test_dep_failure_skips_downstream():
    """When a node fails, downstream nodes are skipped (not executed)."""
    graph = TaskGraph([
        TaskNode("a", "task-a"),
        TaskNode("b", "task-b", depends_on=["a"]),  # will fail
        TaskNode("c", "task-c", depends_on=["b"]),  # should skip
    ])
    results = asyncio.run(graph.execute(_fail_dispatcher, skip_on_dep_failure=True))
    assert results["a"].ok()
    assert results["b"].status == "failed"
    assert results["c"].status == "skipped"


def test_dep_failure_no_skip():
    """When skip_on_dep_failure=False, downstream nodes still attempt execution."""
    graph = TaskGraph([
        TaskNode("a", "task-a"),
        TaskNode("b", "task-b", depends_on=["a"]),   # fails
        TaskNode("c", "task-c", depends_on=["b"]),   # attempts anyway
    ])
    results = asyncio.run(graph.execute(_fail_dispatcher, skip_on_dep_failure=False))
    assert results["b"].status == "failed"
    # c attempts — _fail_dispatcher only fails "b", so c succeeds
    assert results["c"].ok()


def test_execute_sync_wrapper():
    """execute_sync() produces the same results as the async execute()."""
    graph = TaskGraph([
        TaskNode("x", "task-x"),
        TaskNode("y", "task-y", depends_on=["x"]),
    ])

    def sync_dispatcher(node_id: str, task) -> str:
        return f"sync-{node_id}"

    results = graph.execute_sync(sync_dispatcher)
    assert results["x"].result == "sync-x"
    assert results["y"].result == "sync-y"


def test_summary_dict():
    """summary() returns a correct completion count dict."""
    graph = TaskGraph([
        TaskNode("a", "task-a"),
        TaskNode("b", "task-b", depends_on=["a"]),
    ])
    results = asyncio.run(graph.execute(_fast_dispatcher))
    summary = graph.summary(results)
    assert summary["completed"] == 2
    assert summary["failed"] == 0
    assert summary["success"] is True


def test_build_graph_from_plan():
    """build_graph_from_plan correctly maps step_id ints to string node_ids."""
    plan = {
        "steps": [
            {"step_id": 1, "action": "first step",  "agent": "worker", "depends_on": []},
            {"step_id": 2, "action": "second step", "agent": "worker", "depends_on": [1]},
            {"step_id": 3, "action": "third step",  "agent": "worker", "depends_on": [1]},
        ]
    }
    graph = build_graph_from_plan(plan)
    assert "1" in graph.nodes
    assert "2" in graph.nodes
    assert "3" in graph.nodes
    assert graph.nodes["2"].depends_on == ["1"]
    assert graph.nodes["3"].depends_on == ["1"]

    results = asyncio.run(graph.execute(_fast_dispatcher))
    assert all(r.ok() for r in results.values())
