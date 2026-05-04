"""
brain/graph — SwarmX V5.8 Async DAG Task Executor
===================================================
Replaces the legacy synchronous stub with a production-grade async directed
acyclic graph (DAG) executor with:

  - Topological sort for correct dependency ordering
  - Parallel execution of independent tasks (asyncio.gather)
  - Full error propagation and per-node result tracking
  - Cycle detection (raises ValueError before execution)
  - Graceful partial-failure: downstream tasks receive error payloads
    from failed dependencies rather than crashing silently

CHANGES FROM LEGACY VERSION:
  [FIX-01] Synchronous dispatcher replaced with async coroutine support.
  [FIX-02] No dependency resolution in legacy code — tasks always executed
           sequentially regardless of declared deps. Fixed: topological sort
           resolves correct execution order and independent tasks run in
           parallel via asyncio.gather().
  [FIX-03] Legacy code had no error handling — any dispatcher exception
           would propagate raw and leave remaining nodes in undefined state.
           Fixed: per-node try/except captures errors as TaskNodeResult.error.
  [ENH-01] Cycle detection via DFS before execution — prevents infinite loops.
  [ENH-02] TaskNodeResult dataclass provides structured output with status,
           result, error, and duration_s fields.
  [ENH-03] TaskGraph.execute() returns a dict[node_id, TaskNodeResult] for
           structured downstream consumption.
  [ENH-04] execute_sync() wrapper for legacy synchronous callers.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional, Union


# ─── Result dataclass ─────────────────────────────────────────────────────────

@dataclass
class TaskNodeResult:
    node_id: str
    status: str          # "complete" | "failed" | "skipped"
    result: Any = None
    error: Optional[str] = None
    duration_s: float = 0.0
    dependency_errors: list[str] = field(default_factory=list)

    def ok(self) -> bool:
        return self.status == "complete"


# ─── Task node ────────────────────────────────────────────────────────────────

class TaskNode:
    """Represents a single node in the execution graph.

    Args:
        node_id:    Unique identifier for this node (string).
        task:       Arbitrary payload passed to the dispatcher.
        depends_on: List of node_id strings this node depends on.
                    Execution is deferred until all deps complete.
    """

    def __init__(
        self,
        node_id: str,
        task: Any,
        depends_on: Optional[list[str]] = None,
    ) -> None:
        self.node_id = node_id
        self.task = task
        self.depends_on: list[str] = depends_on or []
        self.result: Optional[TaskNodeResult] = None

    def __repr__(self) -> str:
        return f"TaskNode(id={self.node_id!r}, deps={self.depends_on!r})"


# ─── DAG ─────────────────────────────────────────────────────────────────────

class TaskGraph:
    """Async DAG executor.

    Usage:
        async def my_dispatcher(node_id: str, task: Any) -> Any:
            ...

        graph = TaskGraph([
            TaskNode("a", "do A"),
            TaskNode("b", "do B", depends_on=["a"]),
            TaskNode("c", "do C", depends_on=["a"]),
            TaskNode("d", "do D", depends_on=["b", "c"]),
        ])
        results = await graph.execute(my_dispatcher)
    """

    def __init__(self, nodes: list[TaskNode]) -> None:
        self.nodes: dict[str, TaskNode] = {n.node_id: n for n in nodes}
        self._validate_ids()

    def _validate_ids(self) -> None:
        """Ensure all dependency references point to existing nodes."""
        for node in self.nodes.values():
            for dep in node.depends_on:
                if dep not in self.nodes:
                    raise ValueError(
                        f"Node '{node.node_id}' depends on unknown node '{dep}'"
                    )

    def _topological_levels(self) -> list[list[str]]:
        """
        [ENH-01] Kahn's algorithm — returns nodes grouped by execution level.
        Raises ValueError on cycle detection.

        Level 0 = no dependencies (can run immediately).
        Level k = depends only on nodes in levels < k.
        All nodes in the same level can run in parallel.
        """
        in_degree: dict[str, int] = {nid: 0 for nid in self.nodes}
        children: dict[str, list[str]] = defaultdict(list)

        for node in self.nodes.values():
            for dep in node.depends_on:
                in_degree[node.node_id] += 1
                children[dep].append(node.node_id)

        levels: list[list[str]] = []
        queue: deque[str] = deque(
            nid for nid, deg in in_degree.items() if deg == 0
        )

        while queue:
            level: list[str] = []
            next_queue: deque[str] = deque()
            while queue:
                nid = queue.popleft()
                level.append(nid)
                for child in children[nid]:
                    in_degree[child] -= 1
                    if in_degree[child] == 0:
                        next_queue.append(child)
            levels.append(level)
            queue = next_queue

        total_scheduled = sum(len(lvl) for lvl in levels)
        if total_scheduled != len(self.nodes):
            cycle_nodes = [
                nid for nid, deg in in_degree.items() if deg > 0
            ]
            raise ValueError(
                f"Cycle detected in task graph. Nodes in cycle: {cycle_nodes}"
            )

        return levels

    async def execute(
        self,
        dispatcher: Callable[[str, Any], Awaitable[Any]],
        *,
        skip_on_dep_failure: bool = True,
    ) -> dict[str, TaskNodeResult]:
        """
        Execute the graph asynchronously with topological ordering.

        Args:
            dispatcher:           async callable(node_id, task) → result.
            skip_on_dep_failure:  If True, skip nodes whose dependencies
                                  failed rather than attempting execution.

        Returns:
            dict mapping node_id → TaskNodeResult for every node.
        """
        levels = self._topological_levels()
        results: dict[str, TaskNodeResult] = {}

        for level in levels:
            # Collect tasks for this level — may skip some based on dep status
            coroutines: list[tuple[str, Any]] = []

            for node_id in level:
                node = self.nodes[node_id]

                # Check dependencies for failures
                dep_errors: list[str] = []
                for dep_id in node.depends_on:
                    dep_result = results.get(dep_id)
                    if dep_result and not dep_result.ok():
                        dep_errors.append(
                            f"dep '{dep_id}' failed: {dep_result.error or dep_result.status}"
                        )

                if dep_errors and skip_on_dep_failure:
                    results[node_id] = TaskNodeResult(
                        node_id=node_id,
                        status="skipped",
                        error="Skipped due to dependency failure(s)",
                        dependency_errors=dep_errors,
                    )
                    node.result = results[node_id]
                    continue

                coroutines.append((node_id, node.task))

            if not coroutines:
                continue

            # Execute all independent nodes in this level concurrently
            async def _run_one(node_id: str, task: Any) -> TaskNodeResult:
                t0 = time.monotonic()
                try:
                    result = await dispatcher(node_id, task)
                    node_result = TaskNodeResult(
                        node_id=node_id,
                        status="complete",
                        result=result,
                        duration_s=round(time.monotonic() - t0, 3),
                    )
                except Exception as exc:
                    node_result = TaskNodeResult(
                        node_id=node_id,
                        status="failed",
                        error=f"{type(exc).__name__}: {exc}",
                        duration_s=round(time.monotonic() - t0, 3),
                    )
                self.nodes[node_id].result = node_result
                return node_result

            level_results = await asyncio.gather(
                *[_run_one(nid, task) for nid, task in coroutines],
                return_exceptions=False,  # exceptions caught inside _run_one
            )

            for nr in level_results:
                results[nr.node_id] = nr

        return results

    def execute_sync(
        self,
        dispatcher: Callable[[str, Any], Any],
        *,
        skip_on_dep_failure: bool = True,
    ) -> dict[str, TaskNodeResult]:
        """
        [ENH-04] Synchronous wrapper for legacy callers.

        Wraps a synchronous dispatcher in an async shell and runs via
        asyncio.run(). If there is already a running event loop (e.g. in
        Jupyter or nested async contexts), use execute() directly.
        """
        async def _async_dispatcher(node_id: str, task: Any) -> Any:
            return dispatcher(node_id, task)

        try:
            return asyncio.run(
                self.execute(_async_dispatcher,
                             skip_on_dep_failure=skip_on_dep_failure)
            )
        except RuntimeError:
            # Running loop already exists — create a new thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    asyncio.run,
                    self.execute(_async_dispatcher,
                                 skip_on_dep_failure=skip_on_dep_failure),
                )
                return future.result()

    def summary(self, results: dict[str, TaskNodeResult]) -> dict[str, Any]:
        """Return a compact execution summary dict."""
        completed = [r for r in results.values() if r.ok()]
        failed    = [r for r in results.values() if r.status == "failed"]
        skipped   = [r for r in results.values() if r.status == "skipped"]
        return {
            "total":     len(results),
            "completed": len(completed),
            "failed":    len(failed),
            "skipped":   len(skipped),
            "success":   len(failed) == 0 and len(skipped) == 0,
            "errors":    {r.node_id: r.error for r in failed},
            "duration_s": {r.node_id: r.duration_s for r in results.values()},
        }


# ─── Convenience factory ──────────────────────────────────────────────────────

def build_graph_from_plan(plan: dict) -> TaskGraph:
    """
    Build a TaskGraph from a SwarmX plan dict.

    Expected plan format:
        {
            "steps": [
                {"step_id": 1, "action": "...", "depends_on": []},
                {"step_id": 2, "action": "...", "depends_on": [1]},
            ]
        }
    """
    nodes: list[TaskNode] = []
    for step in plan.get("steps", []):
        node_id = str(step.get("step_id", ""))
        raw_deps = step.get("depends_on", [])
        if isinstance(raw_deps, (int, str)):
            raw_deps = [raw_deps]
        deps = [str(d) for d in raw_deps if d]
        nodes.append(TaskNode(
            node_id=node_id,
            task={
                "step_id": step.get("step_id"),
                "agent":   step.get("agent", "worker"),
                "action":  step.get("action", step.get("objective", "")),
            },
            depends_on=deps,
        ))
    return TaskGraph(nodes)